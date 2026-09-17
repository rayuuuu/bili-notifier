// chrome.storage.local 的薄封装：集中管理 settings / subscriptions / feed / runtime

import {
  STORAGE_KEYS,
  DEFAULT_SETTINGS,
  DEFAULT_RUNTIME,
  FEED_LIMIT
} from './constants.js';

async function readKey(key, fallback) {
  const raw = await chrome.storage.local.get(key);
  const value = raw[key];
  return value === undefined || value === null ? fallback : value;
}

async function writeKey(key, value) {
  await chrome.storage.local.set({ [key]: value });
}

export async function getSettings() {
  const stored = await readKey(STORAGE_KEYS.settings, {});
  return { ...DEFAULT_SETTINGS, ...stored };
}

export async function saveSettings(patch) {
  const merged = { ...(await getSettings()), ...patch };
  await writeKey(STORAGE_KEYS.settings, merged);
  return merged;
}

export async function getSubscriptions() {
  const list = await readKey(STORAGE_KEYS.subscriptions, []);
  return Array.isArray(list) ? list : [];
}

export async function saveSubscriptions(list) {
  await writeKey(STORAGE_KEYS.subscriptions, list);
  return list;
}

export async function findSubscription(uid) {
  const list = await getSubscriptions();
  return list.find((item) => item.uid === String(uid)) || null;
}

export async function addSubscription(subscription) {
  const list = await getSubscriptions();
  if (list.some((item) => item.uid === subscription.uid)) {
    return { ok: false, reason: 'DUPLICATE', subscriptions: list };
  }
  const next = [...list, subscription];
  await saveSubscriptions(next);
  return { ok: true, subscriptions: next };
}

export async function removeSubscription(uid) {
  const target = String(uid);
  const list = await getSubscriptions();
  const next = list.filter((item) => item.uid !== target);
  await saveSubscriptions(next);

  // 同时清理该 UP 主的缓存动态
  const feed = await getFeed();
  const nextFeed = feed.filter((item) => item.uid !== target);
  if (nextFeed.length !== feed.length) {
    await writeKey(STORAGE_KEYS.feed, nextFeed);
  }
  return { subscriptions: next, feed: nextFeed };
}

export async function updateSubscription(uid, patch) {
  const target = String(uid);
  const list = await getSubscriptions();
  let changed = false;
  const next = list.map((item) => {
    if (item.uid !== target) return item;
    changed = true;
    return { ...item, ...patch };
  });
  if (changed) {
    await saveSubscriptions(next);
  }
  return next;
}

export async function getFeed() {
  const list = await readKey(STORAGE_KEYS.feed, []);
  return Array.isArray(list) ? list : [];
}

export async function saveFeed(list) {
  await writeKey(STORAGE_KEYS.feed, list);
  return list;
}

// 追加新条目：按 id 去重、按 pubTs 倒序、裁剪至 FEED_LIMIT
export async function pushFeedItems(items) {
  if (!items || items.length === 0) {
    return getFeed();
  }
  const feed = await getFeed();
  const byId = new Map();
  for (const item of feed) {
    byId.set(String(item.id), item);
  }
  for (const item of items) {
    const id = String(item.id);
    const existing = byId.get(id);
    // 已存在的条目保留其已读状态
    byId.set(id, existing ? { ...item, read: existing.read } : item);
  }
  const merged = Array.from(byId.values())
    .sort((a, b) => (b.pubTs || 0) - (a.pubTs || 0))
    .slice(0, FEED_LIMIT);
  await saveFeed(merged);
  return merged;
}

export async function markRead(ids) {
  const targets = new Set((Array.isArray(ids) ? ids : [ids]).map(String));
  const feed = await getFeed();
  let changed = false;
  const next = feed.map((item) => {
    if (item.read || !targets.has(String(item.id))) return item;
    changed = true;
    return { ...item, read: true };
  });
  if (changed) {
    await saveFeed(next);
  }
  return next.filter((item) => !item.read).length;
}

export async function markAllRead() {
  const feed = await getFeed();
  const next = feed.map((item) => (item.read ? item : { ...item, read: true }));
  await saveFeed(next);
  return 0;
}

export async function getUnreadCount() {
  const feed = await getFeed();
  return feed.filter((item) => !item.read).length;
}

export async function getRuntime() {
  const stored = await readKey(STORAGE_KEYS.runtime, {});
  return { ...DEFAULT_RUNTIME, ...stored };
}

export async function saveRuntime(patch) {
  const merged = { ...(await getRuntime()), ...patch };
  await writeKey(STORAGE_KEYS.runtime, merged);
  return merged;
}

export async function getWbiCache() {
  return readKey(STORAGE_KEYS.wbiKeys, null);
}

export async function saveWbiCache(value) {
  await writeKey(STORAGE_KEYS.wbiKeys, value);
  return value;
}
