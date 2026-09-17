// Popup：跨 UP 主合并的最近动态列表、未读高亮、全部已读、立即检查

import { MESSAGE_TYPES, POPUP_FEED_LIMIT } from '../lib/constants.js';
import { sendMessage, formatRelativeTime, el } from '../lib/ui-utils.js';

const dom = {
  list: document.getElementById('list'),
  empty: document.getElementById('empty'),
  toast: document.getElementById('toast'),
  status: document.getElementById('status'),
  pollNow: document.getElementById('poll-now'),
  markAll: document.getElementById('mark-all'),
  openOptions: document.getElementById('open-options'),
  goOptions: document.getElementById('go-options')
};

let toastTimer = null;

function showToast(text) {
  if (!text) {
    dom.toast.classList.add('hidden');
    return;
  }
  dom.toast.textContent = text;
  dom.toast.classList.remove('hidden');
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => dom.toast.classList.add('hidden'), 4000);
}

function renderStatus(runtime) {
  const lastCheckAt = Number(runtime && runtime.lastCheckAt) || 0;
  const parts = [];
  parts.push(lastCheckAt ? `上次检查：${formatRelativeTime(lastCheckAt)}` : '尚未检查过');
  if (runtime && Number(runtime.backoffUntil) > Date.now()) {
    parts.push('已触发风控，自动检查暂停中');
  }
  dom.status.textContent = parts.join(' · ');
}

function buildItem(item) {
  const node = el('div', `item${item.read ? '' : ' unread'}`);
  node.tabIndex = 0;

  const face = document.createElement('img');
  face.className = 'face';
  face.alt = '';
  face.referrerPolicy = 'no-referrer';
  if (item.face) face.src = item.face;

  const body = el('div', 'body');
  const head = el('div', 'head');
  head.append(el('span', 'name', item.name || `UID ${item.uid}`));
  head.append(el('span', 'tag', item.typeLabel || '动态'));
  head.append(el('span', 'time', formatRelativeTime(item.pubTs ? item.pubTs * 1000 : 0)));
  body.append(head);

  const text = item.title && item.summary && item.title !== item.summary
    ? `${item.title} — ${item.summary}`
    : (item.title || item.summary || item.typeLabel || '');
  body.append(el('div', 'text', text));

  node.append(face, body);

  const open = async () => {
    if (item.url) {
      await chrome.tabs.create({ url: item.url });
    }
    if (!item.read) {
      try {
        await sendMessage({ type: MESSAGE_TYPES.MARK_READ, ids: [item.id] });
      } catch (err) {
        console.warn('标记已读失败', err);
      }
      item.read = true;
      node.classList.remove('unread');
    }
    window.close();
  };

  node.addEventListener('click', open);
  node.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      open();
    }
  });

  return node;
}

function renderFeed(feed, subscriptions) {
  const items = [...feed]
    .sort((a, b) => (b.pubTs || 0) - (a.pubTs || 0))
    .slice(0, POPUP_FEED_LIMIT);

  dom.list.replaceChildren();

  if (subscriptions.length === 0) {
    dom.empty.classList.remove('hidden');
    dom.list.classList.add('hidden');
    return;
  }

  dom.empty.classList.add('hidden');
  dom.list.classList.remove('hidden');

  if (items.length === 0) {
    const hint = el('div', 'empty');
    hint.append(el('p', 'empty-title', '暂时还没有抓到动态'));
    hint.append(el('p', 'empty-desc', '已订阅的 UP 主发布新动态后会出现在这里。'));
    dom.list.append(hint);
    return;
  }

  for (const item of items) {
    dom.list.append(buildItem(item));
  }
}

async function refresh() {
  const state = await sendMessage({ type: MESSAGE_TYPES.GET_STATE });
  if (!state) return;
  renderFeed(state.feed || [], state.subscriptions || []);
  renderStatus(state.runtime);
}

dom.pollNow.addEventListener('click', async () => {
  dom.pollNow.disabled = true;
  dom.pollNow.textContent = '检查中…';
  showToast('');
  try {
    const res = await sendMessage({ type: MESSAGE_TYPES.POLL_NOW });
    await refresh();
    if (res && res.newCount > 0) {
      showToast(`发现 ${res.newCount} 条新动态`);
    } else if (res && res.errors && res.errors.length > 0) {
      showToast(`检查失败：${res.errors[0].message}`);
    } else {
      showToast('暂无更新');
    }
  } catch (err) {
    showToast(`检查失败：${err.message}`);
  } finally {
    dom.pollNow.disabled = false;
    dom.pollNow.textContent = '立即检查';
  }
});

dom.markAll.addEventListener('click', async () => {
  dom.markAll.disabled = true;
  try {
    await sendMessage({ type: MESSAGE_TYPES.MARK_ALL_READ });
    await refresh();
  } catch (err) {
    showToast(`操作失败：${err.message}`);
  } finally {
    dom.markAll.disabled = false;
  }
});

dom.openOptions.addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
});

dom.goOptions.addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
});

refresh().catch((err) => {
  dom.status.textContent = `读取状态失败：${err.message}`;
});
