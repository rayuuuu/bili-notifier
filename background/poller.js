// 轮询编排：串行遍历订阅 → diff 新动态 → 写入 feed → 通知 → 更新徽章
// 风控时按指数退避跳过若干轮

import {
  fetchSpaceDynamics,
  fetchUserCard,
  RiskControlError,
  BiliApiError
} from '../lib/bili-api.js';
import { parseDynamicList } from '../lib/dynamic-parser.js';
import { refreshCookieRule } from '../lib/header-injector.js';
import {
  getSettings,
  getSubscriptions,
  updateSubscription,
  pushFeedItems,
  getRuntime,
  saveRuntime,
  findSubscription,
  addSubscription,
  getUnreadCount
} from '../lib/store.js';
import { notifyNewItems, updateBadge } from './notifier.js';

const JITTER_MIN_MS = 800;
const JITTER_MAX_MS = 1500;
const MAX_BACKOFF_MINUTES = 120;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function randomJitter() {
  return JITTER_MIN_MS + Math.floor(Math.random() * (JITTER_MAX_MS - JITTER_MIN_MS + 1));
}

// 动态 id_str 是单调递增的雪花 ID，用大整数比较比时间戳更可靠
export function compareIds(a, b) {
  const left = String(a || '0');
  const right = String(b || '0');
  try {
    const x = BigInt(left);
    const y = BigInt(right);
    if (x > y) return 1;
    if (x < y) return -1;
    return 0;
  } catch (err) {
    if (left.length !== right.length) return left.length > right.length ? 1 : -1;
    if (left === right) return 0;
    return left > right ? 1 : -1;
  }
}

function maxId(items) {
  return items.reduce((acc, item) => (compareIds(item.id, acc) > 0 ? String(item.id) : acc), '0');
}

export function parseUidInput(input) {
  const value = String(input || '').trim();
  if (!value) return '';
  if (/^\d+$/.test(value)) return value;
  const match = value.match(/space\.bilibili\.com\/(\d+)/i);
  if (match) return match[1];
  const digits = value.match(/(\d{3,})/);
  return digits ? digits[1] : '';
}

async function enterBackoff(runtime, settings, message) {
  const level = Math.min((Number(runtime.backoffLevel) || 0) + 1, 6);
  const base = Math.max(1, Number(settings.pollIntervalMinutes) || 5);
  const minutes = Math.min(base * Math.pow(2, level), MAX_BACKOFF_MINUTES);
  await saveRuntime({
    backoffLevel: level,
    backoffUntil: Date.now() + minutes * 60 * 1000,
    lastError: message
  });
  console.warn(`[bili-notifier] 触发风控退避 ${minutes} 分钟：${message}`);
}

export async function runPollCycle(opts = {}) {
  const manual = Boolean(opts.manual);
  const settings = await getSettings();
  const runtime = await getRuntime();

  if (!manual && runtime.backoffUntil && runtime.backoffUntil > Date.now()) {
    return { newCount: 0, errors: [], skipped: true, backoffUntil: runtime.backoffUntil };
  }

  const subscriptions = await getSubscriptions();
  if (subscriptions.length === 0) {
    await saveRuntime({ lastCheckAt: Date.now(), lastError: null });
    return { newCount: 0, errors: [], skipped: false };
  }

  try {
    await refreshCookieRule();
  } catch (err) {
    console.warn('[bili-notifier] 刷新请求头规则失败，继续尝试请求', err);
  }

  const errors = [];
  let newCount = 0;
  let riskControlled = false;

  for (let i = 0; i < subscriptions.length; i += 1) {
    const sub = subscriptions[i];
    if (i > 0) {
      await sleep(randomJitter());
    }

    try {
      const raw = await fetchSpaceDynamics(sub.uid);
      const parsed = parseDynamicList(raw, { uid: sub.uid, name: sub.name, face: sub.face });
      if (parsed.length === 0) {
        continue;
      }

      const newest = parsed.reduce(
        (acc, item) => (compareIds(item.id, acc.id) > 0 ? item : acc),
        parsed[0]
      );
      const cursor = maxId(parsed);

      const patch = { lastSeenId: cursor };
      if (newest.name) patch.name = newest.name;
      if (newest.face) patch.face = newest.face;

      if (!sub.lastSeenId) {
        // 首次订阅只建立基线，不产生通知
        await updateSubscription(sub.uid, patch);
        continue;
      }

      const fresh = parsed.filter((item) => compareIds(item.id, sub.lastSeenId) > 0);
      await updateSubscription(sub.uid, patch);

      if (fresh.length === 0) {
        continue;
      }

      newCount += fresh.length;
      await pushFeedItems(fresh);
      await notifyNewItems({ ...sub, ...patch }, fresh, settings);
    } catch (err) {
      if (err instanceof RiskControlError) {
        riskControlled = true;
        await enterBackoff(runtime, settings, err.message);
        errors.push({ uid: sub.uid, message: err.message, risk: true });
        break;
      }
      const message = err && err.message ? err.message : String(err);
      errors.push({ uid: sub.uid, message, api: err instanceof BiliApiError });
      console.warn(`[bili-notifier] 拉取 ${sub.uid} 动态失败：${message}`);
    }
  }

  if (!riskControlled) {
    await saveRuntime({
      lastCheckAt: Date.now(),
      backoffLevel: 0,
      backoffUntil: 0,
      lastError: errors.length > 0 ? errors[0].message : null
    });
  } else {
    await saveRuntime({ lastCheckAt: Date.now() });
  }

  await updateBadge(await getUnreadCount());
  return { newCount, errors, skipped: false };
}

// 首次订阅：校验 UID、回填昵称/头像、建立 lastSeenId 基线（不通知）
export async function bootstrapSubscription(input) {
  const uid = parseUidInput(input);
  if (!uid) {
    return { ok: false, reason: 'INVALID_INPUT' };
  }

  const existing = await findSubscription(uid);
  if (existing) {
    return { ok: false, reason: 'DUPLICATE' };
  }

  try {
    await refreshCookieRule();
  } catch (err) {
    console.warn('[bili-notifier] 刷新请求头规则失败', err);
  }

  let name = '';
  let face = '';
  let lastSeenId = '';

  try {
    const raw = await fetchSpaceDynamics(uid);
    const parsed = parseDynamicList(raw, { uid });
    if (parsed.length > 0) {
      const newest = parsed.reduce(
        (acc, item) => (compareIds(item.id, acc.id) > 0 ? item : acc),
        parsed[0]
      );
      name = newest.name || '';
      face = newest.face || '';
      lastSeenId = maxId(parsed);
    }
  } catch (err) {
    if (err instanceof RiskControlError) {
      return { ok: false, reason: 'RISK_CONTROL', message: err.message };
    }
    // 动态拉取失败时仍尝试用名片接口校验 UID
    console.warn(`[bili-notifier] 拉取 ${uid} 动态失败：${err && err.message}`);
  }

  if (!name) {
    try {
      const card = await fetchUserCard(uid);
      if (!card.name) {
        return { ok: false, reason: 'NOT_FOUND' };
      }
      name = card.name;
      face = face || card.face;
    } catch (err) {
      if (err instanceof RiskControlError) {
        return { ok: false, reason: 'RISK_CONTROL', message: err.message };
      }
      return { ok: false, reason: 'NOT_FOUND', message: err && err.message };
    }
  }

  const subscription = {
    uid,
    name,
    face,
    lastSeenId,
    addedAt: Date.now()
  };

  const result = await addSubscription(subscription);
  if (!result.ok) {
    return { ok: false, reason: result.reason };
  }
  return { ok: true, subscription };
}
