// WBI 签名：api.bilibili.com 的多数 web 接口要求携带 w_rid + wts
// 密钥来自 x/web-interface/nav 的 wbi_img.img_url / sub_url，每日更替，按天缓存

import { md5 } from './md5.js';
import { getWbiCache, saveWbiCache } from './store.js';

export const NAV_URL = 'https://api.bilibili.com/x/web-interface/nav';

// 固定的 64 项重排表
const mixinKeyEncTab = [
  46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35,
  27, 43, 5, 49, 33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13,
  37, 48, 7, 16, 24, 55, 40, 61, 26, 17, 0, 1, 60, 51, 30, 4,
  22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11, 36, 20, 34, 44, 52
];

export function getMixinKey(imgKey, subKey) {
  const raw = `${imgKey || ''}${subKey || ''}`;
  return mixinKeyEncTab
    .map((index) => raw[index])
    .join('')
    .slice(0, 32);
}

// 从 https://i0.hdslb.com/bfs/wbi/7cd084941338484aae1ad9425b84077c.png 取出 key
function keyFromUrl(url) {
  if (!url) return '';
  const name = String(url).split('/').pop() || '';
  return name.split('.')[0] || '';
}

// 不带签名的 nav 请求：既拿 WBI 密钥，也拿登录态
export async function fetchNavInfo() {
  const res = await fetch(NAV_URL, { credentials: 'omit', cache: 'no-store' });
  if (!res.ok) {
    throw new Error(`nav 请求失败：HTTP ${res.status}`);
  }
  const json = await res.json();
  const data = json && json.data ? json.data : {};
  return {
    isLogin: Boolean(data.isLogin),
    uname: data.uname || '',
    mid: data.mid ? String(data.mid) : '',
    imgKey: keyFromUrl(data.wbi_img && data.wbi_img.img_url),
    subKey: keyFromUrl(data.wbi_img && data.wbi_img.sub_url)
  };
}

function isSameDay(timestamp) {
  if (!timestamp) return false;
  const a = new Date(timestamp);
  const b = new Date();
  return a.getFullYear() === b.getFullYear()
    && a.getMonth() === b.getMonth()
    && a.getDate() === b.getDate();
}

export async function getWbiKeys(forceRefresh = false) {
  const cached = await getWbiCache();
  if (!forceRefresh && cached && cached.imgKey && cached.subKey && isSameDay(cached.fetchedAt)) {
    return cached;
  }

  try {
    const nav = await fetchNavInfo();
    if (!nav.imgKey || !nav.subKey) {
      throw new Error('nav 响应中缺少 wbi_img 密钥');
    }
    return saveWbiCache({ ...nav, fetchedAt: Date.now() });
  } catch (err) {
    // 刷新失败时退回旧缓存，尽量不中断本轮轮询
    if (cached && cached.imgKey && cached.subKey) {
      return cached;
    }
    throw err;
  }
}

export async function encWbi(params, options = {}) {
  const { imgKey, subKey } = await getWbiKeys(Boolean(options.forceRefresh));
  return signWbi(params, getMixinKey(imgKey, subKey));
}

// 纯函数：便于在 Console 中用固定密钥断言
export function signWbi(params, mixinKey, wtsOverride) {
  const wts = wtsOverride || Math.round(Date.now() / 1000);
  const merged = { ...params, wts };
  const query = Object.keys(merged)
    .sort()
    .map((key) => {
      const value = String(merged[key] === undefined || merged[key] === null ? '' : merged[key])
        .replace(/[!'()*]/g, '');
      return `${encodeURIComponent(key)}=${encodeURIComponent(value)}`;
    })
    .join('&');
  return `${query}&w_rid=${md5(query + mixinKey)}`;
}
