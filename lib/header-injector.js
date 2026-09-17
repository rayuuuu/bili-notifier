// 用 chrome.cookies 读取 B 站 Cookie，并通过 declarativeNetRequest 动态规则注入请求头。
// Cookie / Referer / Origin 在 fetch 中属于 forbidden headers，无法直接设置，只能走 DNR。

import { STORAGE_KEYS } from './constants.js';

const RULE_ID = 1;
const COOKIE_DOMAIN = 'bilibili.com';
const REFERER = 'https://space.bilibili.com/';
const ORIGIN = 'https://space.bilibili.com';
const SPI_URL = 'https://api.bilibili.com/x/frontend/finger/spi';

// 只注入这些 Cookie，避免把无关的一大串都发出去
const COOKIE_WHITELIST = [
  'SESSDATA',
  'bili_jct',
  'DedeUserID',
  'DedeUserID__ckMd5',
  'sid',
  'buvid3',
  'buvid4',
  'b_nut',
  'buvid_fp',
  'bili_ticket'
];

let refreshTimer = null;
let lastState = { isLogin: false, hasBuvid: false, cookieCount: 0 };

export function getInjectorState() {
  return { ...lastState };
}

async function getStoredBuvid() {
  const raw = await chrome.storage.local.get(STORAGE_KEYS.anonBuvid);
  return raw[STORAGE_KEYS.anonBuvid] || '';
}

// 未登录时也需要一个 buvid3，否则动态接口会直接拒绝
export async function fetchAnonymousBuvid() {
  const cached = await getStoredBuvid();
  if (cached) return cached;
  try {
    const res = await fetch(SPI_URL, { credentials: 'omit', cache: 'no-store' });
    const json = await res.json();
    const buvid = (json && json.data && json.data.b_3) || '';
    if (buvid) {
      await chrome.storage.local.set({ [STORAGE_KEYS.anonBuvid]: buvid });
    }
    return buvid;
  } catch (err) {
    console.warn('[bili-notifier] 获取匿名 buvid3 失败', err);
    return '';
  }
}

async function buildCookieHeader() {
  let cookies = [];
  try {
    cookies = await chrome.cookies.getAll({ domain: COOKIE_DOMAIN });
  } catch (err) {
    console.warn('[bili-notifier] 读取 Cookie 失败', err);
  }

  const picked = new Map();
  for (const cookie of cookies) {
    if (!COOKIE_WHITELIST.includes(cookie.name)) continue;
    if (!cookie.value) continue;
    // 同名 Cookie 可能存在多个域，优先取 .bilibili.com 上的
    const existing = picked.get(cookie.name);
    if (!existing || cookie.domain === '.bilibili.com') {
      picked.set(cookie.name, cookie.value);
    }
  }

  if (!picked.has('buvid3')) {
    const anon = await fetchAnonymousBuvid();
    if (anon) {
      picked.set('buvid3', anon);
    }
  }

  lastState = {
    isLogin: picked.has('SESSDATA'),
    hasBuvid: picked.has('buvid3'),
    cookieCount: picked.size
  };

  return Array.from(picked.entries())
    .map(([name, value]) => `${name}=${value}`)
    .join('; ');
}

export async function refreshCookieRule() {
  const cookieHeader = await buildCookieHeader();
  const requestHeaders = [
    { header: 'Referer', operation: 'set', value: REFERER },
    { header: 'Origin', operation: 'set', value: ORIGIN }
  ];
  if (cookieHeader) {
    requestHeaders.push({ header: 'Cookie', operation: 'set', value: cookieHeader });
  }

  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: [RULE_ID],
    addRules: [
      {
        id: RULE_ID,
        priority: 1,
        action: { type: 'modifyHeaders', requestHeaders },
        condition: {
          urlFilter: '||api.bilibili.com/',
          // Service Worker 内的 fetch 被归为 xmlhttprequest，个别情况为 other
          resourceTypes: ['xmlhttprequest', 'other']
        }
      }
    ]
  });

  return getInjectorState();
}

// Cookie 变化很频繁，做个防抖
export function scheduleCookieRuleRefresh(delayMs = 1500) {
  if (refreshTimer) {
    clearTimeout(refreshTimer);
  }
  refreshTimer = setTimeout(() => {
    refreshTimer = null;
    refreshCookieRule().catch((err) => {
      console.warn('[bili-notifier] 刷新请求头规则失败', err);
    });
  }, delayMs);
}

export function watchCookies() {
  if (!chrome.cookies || !chrome.cookies.onChanged) return;
  chrome.cookies.onChanged.addListener((change) => {
    const domain = change && change.cookie && change.cookie.domain;
    if (!domain || !domain.includes(COOKIE_DOMAIN)) return;
    if (!COOKIE_WHITELIST.includes(change.cookie.name)) return;
    scheduleCookieRuleRefresh();
  });
}
