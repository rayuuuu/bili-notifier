// 桌面通知与图标徽章
// notificationId → 动态链接/ID 的映射存 chrome.storage.session，避免 SW 重启后丢失

import { getUnreadCount, markRead } from '../lib/store.js';

const SESSION_KEY = 'notificationMap';
const BADGE_COLOR = '#fb7299';

function defaultIcon() {
  return chrome.runtime.getURL('icons/icon128.png');
}

export async function updateBadge(count) {
  const unread = typeof count === 'number' ? count : await getUnreadCount();
  let text = '';
  if (unread > 99) {
    text = '99+';
  } else if (unread > 0) {
    text = String(unread);
  }
  await chrome.action.setBadgeText({ text });
  if (text) {
    await chrome.action.setBadgeBackgroundColor({ color: BADGE_COLOR });
  }
}

async function readMap() {
  if (!chrome.storage.session) return {};
  const raw = await chrome.storage.session.get(SESSION_KEY);
  return raw[SESSION_KEY] || {};
}

async function writeMap(map) {
  if (!chrome.storage.session) return;
  await chrome.storage.session.set({ [SESSION_KEY]: map });
}

async function remember(notificationId, payload) {
  const map = await readMap();
  map[notificationId] = payload;
  await writeMap(map);
}

async function forget(notificationId) {
  const map = await readMap();
  const payload = map[notificationId];
  if (payload) {
    delete map[notificationId];
    await writeMap(map);
  }
  return payload;
}

function createNotification(id, options) {
  return new Promise((resolve) => {
    try {
      chrome.notifications.create(id, options, (createdId) => {
        if (chrome.runtime.lastError) {
          console.warn('[bili-notifier] 创建通知失败', chrome.runtime.lastError.message);
          resolve('');
          return;
        }
        resolve(createdId || id);
      });
    } catch (err) {
      console.warn('[bili-notifier] 创建通知异常', err);
      resolve('');
    }
  });
}

async function notifyOne(item) {
  const notificationId = `dyn-${item.id}`;
  const body = item.title && item.summary && item.title !== item.summary
    ? `${item.title}\n${item.summary}`
    : (item.title || item.summary || '');

  const options = {
    type: 'basic',
    iconUrl: item.face || defaultIcon(),
    title: `${item.name} 发布了新${item.typeLabel}`,
    message: body || item.typeLabel,
    contextMessage: 'B站动态提醒',
    silent: false
  };

  let created = await createNotification(notificationId, options);
  if (!created && options.iconUrl !== defaultIcon()) {
    // 远程头像加载失败时退回本地图标
    created = await createNotification(notificationId, { ...options, iconUrl: defaultIcon() });
  }
  if (created) {
    await remember(created, { url: item.url, ids: [item.id] });
  }
}

async function notifySummary(subscription, items) {
  const notificationId = `sum-${subscription.uid}-${Date.now()}`;
  const options = {
    type: 'basic',
    iconUrl: subscription.face || defaultIcon(),
    title: `${subscription.name} 还有 ${items.length} 条新动态`,
    message: items.map((item) => `· ${item.title || item.summary}`).join('\n').slice(0, 300),
    contextMessage: 'B站动态提醒'
  };

  let created = await createNotification(notificationId, options);
  if (!created && options.iconUrl !== defaultIcon()) {
    created = await createNotification(notificationId, { ...options, iconUrl: defaultIcon() });
  }
  if (created) {
    await remember(created, {
      url: `https://space.bilibili.com/${subscription.uid}/dynamic`,
      ids: items.map((item) => item.id)
    });
  }
}

// 单个 UP 主单轮最多弹 maxPerUser 条，超出的合并为一条汇总通知
export async function notifyNewItems(subscription, items, settings) {
  if (!settings || !settings.notificationsEnabled) return;
  if (!items || items.length === 0) return;

  const max = Math.max(1, Number(settings.maxNotificationsPerUser) || 3);
  const sorted = [...items].sort((a, b) => (b.pubTs || 0) - (a.pubTs || 0));
  const head = sorted.slice(0, max);
  const rest = sorted.slice(max);

  for (const item of head) {
    await notifyOne(item);
  }
  if (rest.length > 0) {
    await notifySummary(subscription, rest);
  }
}

export async function handleNotificationClicked(notificationId) {
  const payload = await forget(notificationId);
  if (payload) {
    if (Array.isArray(payload.ids) && payload.ids.length > 0) {
      await markRead(payload.ids);
    }
    if (payload.url) {
      await chrome.tabs.create({ url: payload.url });
    }
  }
  try {
    await chrome.notifications.clear(notificationId);
  } catch (err) {
    // 通知可能已被系统清理，忽略
  }
  await updateBadge();
}

export async function handleNotificationClosed(notificationId) {
  await forget(notificationId);
}
