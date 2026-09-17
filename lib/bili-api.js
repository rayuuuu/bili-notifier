// B 站接口封装与错误归一

import { encWbi } from './wbi.js';

export { fetchNavInfo } from './wbi.js';
export { fetchAnonymousBuvid } from './header-injector.js';

const SPACE_FEED_URL = 'https://api.bilibili.com/x/polymer/web-dynamic/v1/feed/space';
const USER_CARD_URL = 'https://api.bilibili.com/x/web-interface/card';

// 被风控时 B 站会返回这些 code，或直接给 HTTP 412
const RISK_CONTROL_CODES = [-352, -799, -509];

export class BiliApiError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'BiliApiError';
    this.code = code;
  }
}

export class RiskControlError extends BiliApiError {
  constructor(message, code) {
    super(message, code);
    this.name = 'RiskControlError';
  }
}

export class AuthError extends BiliApiError {
  constructor(message, code) {
    super(message, code);
    this.name = 'AuthError';
  }
}

async function requestJson(baseUrl, params, options = {}) {
  const query = await encWbi(params, { forceRefresh: Boolean(options.forceRefreshKeys) });
  const res = await fetch(`${baseUrl}?${query}`, {
    credentials: 'omit',
    cache: 'no-store',
    headers: { Accept: 'application/json, text/plain, */*' }
  });

  if (res.status === 412) {
    throw new RiskControlError('请求被 B 站风控拦截（HTTP 412）', 412);
  }
  if (!res.ok) {
    throw new BiliApiError(`HTTP ${res.status}`, res.status);
  }

  const json = await res.json();
  const code = json && typeof json.code === 'number' ? json.code : -1;
  if (code === 0) {
    return json.data;
  }
  const message = (json && json.message) || '未知错误';
  if (RISK_CONTROL_CODES.includes(code)) {
    throw new RiskControlError(`请求被 B 站风控拦截（${code}: ${message}）`, code);
  }
  if (code === -101 || code === -401 || code === -403) {
    throw new AuthError(`鉴权失败（${code}: ${message}）`, code);
  }
  throw new BiliApiError(`${message}（${code}）`, code);
}

// 拉取某个 UP 主的空间动态
export async function fetchSpaceDynamics(hostMid, options = {}) {
  const params = {
    offset: '',
    host_mid: String(hostMid),
    timezone_offset: -480,
    platform: 'web',
    features: 'itemOpusStyle,listOnlyfans,opusBigCover,onlyfansVote',
    web_location: '333.999'
  };

  let data;
  try {
    data = await requestJson(SPACE_FEED_URL, params, options);
  } catch (err) {
    // WBI 密钥失效时会以鉴权错误的形式返回，强制刷新一次后重试
    if (err instanceof AuthError && !options.retried) {
      data = await requestJson(SPACE_FEED_URL, params, { forceRefreshKeys: true });
    } else {
      throw err;
    }
  }

  const items = data && Array.isArray(data.items) ? data.items : [];
  return items;
}

// 用户名片：用于校验 UID 是否存在并回填昵称/头像（该接口无需 WBI 签名）
export async function fetchUserCard(mid) {
  const res = await fetch(`${USER_CARD_URL}?mid=${encodeURIComponent(String(mid))}&photo=false`, {
    credentials: 'omit',
    cache: 'no-store',
    headers: { Accept: 'application/json, text/plain, */*' }
  });

  if (res.status === 412) {
    throw new RiskControlError('请求被 B 站风控拦截（HTTP 412）', 412);
  }
  if (!res.ok) {
    throw new BiliApiError(`HTTP ${res.status}`, res.status);
  }

  const json = await res.json();
  const code = json && typeof json.code === 'number' ? json.code : -1;
  if (code !== 0) {
    const message = (json && json.message) || '未知错误';
    if (RISK_CONTROL_CODES.includes(code)) {
      throw new RiskControlError(`请求被 B 站风控拦截（${code}: ${message}）`, code);
    }
    throw new BiliApiError(`${message}（${code}）`, code);
  }

  const card = (json.data && json.data.card) || {};
  return {
    uid: String(card.mid || mid),
    name: card.name || '',
    face: String(card.face || '').replace(/^http:/, 'https:')
  };
}
