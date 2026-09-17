// Service Worker 入口：初始化、alarm 调度、消息路由、通知事件

import { ALARM_NAME, MESSAGE_TYPES } from '../lib/constants.js';
import {
  getSettings,
  saveSettings,
  getSubscriptions,
  getFeed,
  getRuntime,
  markRead,
  markAllRead,
  removeSubscription,
  getUnreadCount,
  getWbiCache
} from '../lib/store.js';
import { refreshCookieRule, watchCookies, getInjectorState } from '../lib/header-injector.js';
import { getWbiKeys } from '../lib/wbi.js';
import { runPollCycle, bootstrapSubscription } from './poller.js';
import {
  updateBadge,
  handleNotificationClicked,
  handleNotificationClosed
} from './notifier.js';

async function ensureAlarm(force = false) {
  const settings = await getSettings();
  const minutes = Math.max(1, Number(settings.pollIntervalMinutes) || 5);
  const existing = await chrome.alarms.get(ALARM_NAME);
  if (!force && existing && existing.periodInMinutes === minutes) {
    return;
  }
  await chrome.alarms.create(ALARM_NAME, {
    delayInMinutes: 1,
    periodInMinutes: minutes
  });
}

async function initialize() {
  await getSettings();
  await ensureAlarm();
  await updateBadge();
  try {
    await refreshCookieRule();
  } catch (err) {
    console.warn('[bili-notifier] 初始化请求头规则失败', err);
  }
}

watchCookies();

chrome.runtime.onInstalled.addListener(() => {
  initialize().catch((err) => console.error('[bili-notifier] onInstalled failed', err));
});

chrome.runtime.onStartup.addListener(() => {
  initialize().catch((err) => console.error('[bili-notifier] onStartup failed', err));
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== ALARM_NAME) return;
  runPollCycle()
    .then((result) => {
      if (result.skipped) {
        console.info('[bili-notifier] 处于风控退避中，跳过本轮');
      } else {
        console.info(`[bili-notifier] 本轮发现 ${result.newCount} 条新动态`);
      }
    })
    .catch((err) => console.error('[bili-notifier] 轮询失败', err));
});

chrome.notifications.onClicked.addListener((notificationId) => {
  handleNotificationClicked(notificationId)
    .catch((err) => console.error('[bili-notifier] 处理通知点击失败', err));
});

chrome.notifications.onClosed.addListener((notificationId) => {
  handleNotificationClosed(notificationId).catch(() => {});
});

async function handleMessage(message) {
  switch (message && message.type) {
    case MESSAGE_TYPES.GET_STATE: {
      const [feed, subscriptions, settings, runtime, wbi] = await Promise.all([
        getFeed(),
        getSubscriptions(),
        getSettings(),
        getRuntime(),
        getWbiCache()
      ]);
      return {
        feed,
        subscriptions,
        settings,
        runtime,
        wbi,
        injector: getInjectorState(),
        unreadCount: feed.filter((item) => !item.read).length
      };
    }
    case MESSAGE_TYPES.POLL_NOW: {
      const result = await runPollCycle({ manual: true });
      return result;
    }
    case MESSAGE_TYPES.ADD_SUBSCRIPTION: {
      const result = await bootstrapSubscription(message.input);
      return result;
    }
    case MESSAGE_TYPES.REMOVE_SUBSCRIPTION: {
      await removeSubscription(message.uid);
      const unreadCount = await getUnreadCount();
      await updateBadge(unreadCount);
      return { ok: true, unreadCount };
    }
    case MESSAGE_TYPES.MARK_READ: {
      const unreadCount = await markRead(message.ids || []);
      await updateBadge(unreadCount);
      return { unreadCount };
    }
    case MESSAGE_TYPES.MARK_ALL_READ: {
      await markAllRead();
      await updateBadge(0);
      return { unreadCount: 0 };
    }
    case MESSAGE_TYPES.REFRESH_LOGIN: {
      try {
        await refreshCookieRule();
        const keys = await getWbiKeys(true);
        return {
          ok: true,
          isLogin: Boolean(keys.isLogin),
          uname: keys.uname || '',
          injector: getInjectorState()
        };
      } catch (err) {
        return {
          ok: false,
          message: String(err && err.message ? err.message : err),
          injector: getInjectorState()
        };
      }
    }
    case MESSAGE_TYPES.SAVE_SETTINGS: {
      const settings = await saveSettings(message.settings || {});
      await ensureAlarm(true);
      return { ok: true, settings };
    }
    default:
      return { ok: false, reason: 'UNKNOWN_MESSAGE' };
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  handleMessage(message)
    .then(sendResponse)
    .catch((err) => {
      console.error('[bili-notifier] message failed', message, err);
      sendResponse({
        ok: false,
        reason: 'ERROR',
        message: String(err && err.message ? err.message : err)
      });
    });
  return true;
});
