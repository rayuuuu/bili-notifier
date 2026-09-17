// Options 页：订阅管理、轮询设置、登录状态、风控告警

import { MESSAGE_TYPES, POLL_INTERVAL_OPTIONS } from '../lib/constants.js';
import { sendMessage, formatRelativeTime, formatDuration, el } from '../lib/ui-utils.js';

const dom = {
  warning: document.getElementById('warning'),
  loginStatus: document.getElementById('login-status'),
  refreshLogin: document.getElementById('refresh-login'),
  addForm: document.getElementById('add-form'),
  uidInput: document.getElementById('uid-input'),
  addBtn: document.getElementById('add-btn'),
  addMsg: document.getElementById('add-msg'),
  subList: document.getElementById('sub-list'),
  subEmpty: document.getElementById('sub-empty'),
  interval: document.getElementById('interval'),
  notify: document.getElementById('notify'),
  saveMsg: document.getElementById('save-msg')
};

const ADD_ERRORS = {
  INVALID_INPUT: 'UID 无效或用户不存在',
  NOT_FOUND: 'UID 无效或用户不存在',
  DUPLICATE: '已订阅该 UP 主',
  RISK_CONTROL: '请求被 B 站风控拦截，请稍后再试',
  ERROR: '添加失败，请稍后再试'
};

function showMessage(node, text, kind) {
  node.textContent = text;
  node.className = `msg ${kind || ''}`.trim();
  node.classList.toggle('hidden', !text);
}

function renderLoginStatus(state) {
  const wbi = state.wbi || {};
  const injector = state.injector || {};
  const loggedIn = Boolean(wbi.isLogin) || Boolean(injector.isLogin);

  if (loggedIn) {
    const name = wbi.uname ? `（${wbi.uname}）` : '';
    dom.loginStatus.textContent = `已登录 B 站${name}`;
    dom.loginStatus.className = 'login-status ok';
    return;
  }

  if (wbi.fetchedAt || injector.cookieCount) {
    dom.loginStatus.textContent = '匿名模式：当前未检测到 B 站登录态，仅能获取公开动态，部分动态可能不可见。';
    dom.loginStatus.className = 'login-status anon';
    return;
  }

  dom.loginStatus.textContent = '尚未检测过登录状态，点击下方按钮检测。';
  dom.loginStatus.className = 'login-status';
}

function renderWarning(runtime) {
  const backoffUntil = Number(runtime && runtime.backoffUntil) || 0;
  if (backoffUntil > Date.now()) {
    const remaining = formatDuration(backoffUntil - Date.now());
    dom.warning.textContent = `已触发 B 站风控，自动检查暂停约 ${remaining}（可在 popup 中手动「立即检查」）。原因：${runtime.lastError || '未知'}`;
    dom.warning.classList.remove('hidden');
    return;
  }
  if (runtime && runtime.lastError) {
    dom.warning.textContent = `上次检查出现问题：${runtime.lastError}`;
    dom.warning.classList.remove('hidden');
    return;
  }
  dom.warning.classList.add('hidden');
}

function renderSubscriptions(subscriptions) {
  dom.subList.replaceChildren();
  dom.subEmpty.classList.toggle('hidden', subscriptions.length > 0);

  for (const sub of subscriptions) {
    const item = el('li', 'sub-item');

    const face = document.createElement('img');
    face.className = 'face';
    face.alt = '';
    face.referrerPolicy = 'no-referrer';
    if (sub.face) face.src = sub.face;

    const meta = el('div', 'meta');
    meta.append(el('div', 'name', sub.name || `UID ${sub.uid}`));
    const detail = sub.addedAt ? `UID ${sub.uid} · 添加于 ${formatRelativeTime(sub.addedAt)}` : `UID ${sub.uid}`;
    meta.append(el('div', 'uid', detail));

    const spaceLink = document.createElement('a');
    spaceLink.className = 'btn';
    spaceLink.textContent = '主页';
    spaceLink.href = `https://space.bilibili.com/${sub.uid}/dynamic`;
    spaceLink.target = '_blank';
    spaceLink.rel = 'noreferrer';

    const remove = el('button', 'btn danger', '删除');
    remove.type = 'button';
    remove.addEventListener('click', async () => {
      remove.disabled = true;
      try {
        await sendMessage({ type: MESSAGE_TYPES.REMOVE_SUBSCRIPTION, uid: sub.uid });
        await refresh();
        showMessage(dom.addMsg, `已删除 ${sub.name || sub.uid}`, 'ok');
      } catch (err) {
        remove.disabled = false;
        showMessage(dom.addMsg, `删除失败：${err.message}`, 'error');
      }
    });

    item.append(face, meta, spaceLink, remove);
    dom.subList.append(item);
  }
}

function renderSettings(settings) {
  const minutes = Number(settings.pollIntervalMinutes) || 5;
  const allowed = POLL_INTERVAL_OPTIONS.includes(minutes) ? minutes : 5;
  dom.interval.value = String(allowed);
  dom.notify.checked = Boolean(settings.notificationsEnabled);
}

async function refresh() {
  const state = await sendMessage({ type: MESSAGE_TYPES.GET_STATE });
  if (!state) return;
  renderSubscriptions(state.subscriptions || []);
  renderSettings(state.settings || {});
  renderLoginStatus(state);
  renderWarning(state.runtime);
}

dom.addForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const input = dom.uidInput.value.trim();
  if (!input) {
    showMessage(dom.addMsg, '请先输入 UID 或空间链接', 'error');
    return;
  }

  dom.addBtn.disabled = true;
  dom.addBtn.textContent = '添加中…';
  showMessage(dom.addMsg, '');

  try {
    const res = await sendMessage({ type: MESSAGE_TYPES.ADD_SUBSCRIPTION, input });
    if (res && res.ok) {
      dom.uidInput.value = '';
      await refresh();
      showMessage(dom.addMsg, `已订阅 ${res.subscription.name}，从现在起的新动态会通知你。`, 'ok');
    } else {
      const reason = (res && res.reason) || 'ERROR';
      showMessage(dom.addMsg, ADD_ERRORS[reason] || ADD_ERRORS.ERROR, 'error');
    }
  } catch (err) {
    showMessage(dom.addMsg, `添加失败：${err.message}`, 'error');
  } finally {
    dom.addBtn.disabled = false;
    dom.addBtn.textContent = '添加';
  }
});

async function saveSettings() {
  showMessage(dom.saveMsg, '');
  try {
    await sendMessage({
      type: MESSAGE_TYPES.SAVE_SETTINGS,
      settings: {
        pollIntervalMinutes: Number(dom.interval.value) || 5,
        notificationsEnabled: dom.notify.checked
      }
    });
    showMessage(dom.saveMsg, '已保存', 'ok');
  } catch (err) {
    showMessage(dom.saveMsg, `保存失败：${err.message}`, 'error');
  }
}

dom.interval.addEventListener('change', saveSettings);
dom.notify.addEventListener('change', saveSettings);

dom.refreshLogin.addEventListener('click', async () => {
  dom.refreshLogin.disabled = true;
  dom.loginStatus.textContent = '检测中…';
  dom.loginStatus.className = 'login-status';
  try {
    const res = await sendMessage({ type: MESSAGE_TYPES.REFRESH_LOGIN });
    if (res && res.ok) {
      renderLoginStatus({ wbi: { isLogin: res.isLogin, uname: res.uname, fetchedAt: Date.now() }, injector: res.injector });
    } else {
      dom.loginStatus.textContent = `检测失败：${(res && res.message) || '未知错误'}`;
      dom.loginStatus.className = 'login-status anon';
    }
  } catch (err) {
    dom.loginStatus.textContent = `检测失败：${err.message}`;
    dom.loginStatus.className = 'login-status anon';
  } finally {
    dom.refreshLogin.disabled = false;
  }
});

refresh().catch((err) => {
  dom.loginStatus.textContent = `读取状态失败：${err.message}`;
});
