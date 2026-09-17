// 把 B 站原始动态 item 规整为内部 FeedItem
// 所有字段都用可选链取值，解析失败返回 null 而不是抛错

import { typeLabelOf, SUMMARY_MAX_LENGTH } from './constants.js';

export function isPinned(raw) {
  const tag = raw?.modules?.module_tag?.text;
  return tag === '置顶' || tag === '置頂';
}

function normalizeUrl(url) {
  if (!url) return '';
  const value = String(url);
  if (value.startsWith('//')) return `https:${value}`;
  if (value.startsWith('http://')) return value.replace('http://', 'https://');
  if (value.startsWith('https://')) return value;
  if (value.startsWith('/')) return `https://www.bilibili.com${value}`;
  return value;
}

export function truncate(text, max = SUMMARY_MAX_LENGTH) {
  const value = String(text || '').replace(/\s+/g, ' ').trim();
  if (value.length <= max) return value;
  return `${value.slice(0, max)}…`;
}

// 从 module_dynamic 中按 major 类型抽出标题/摘要/封面/链接
function extractMajor(major) {
  if (!major) return null;
  const type = major.type;

  switch (type) {
    case 'MAJOR_TYPE_ARCHIVE': {
      const a = major.archive || {};
      return {
        title: a.title || '',
        summary: a.desc || '',
        cover: a.cover || '',
        url: a.bvid ? `https://www.bilibili.com/video/${a.bvid}` : normalizeUrl(a.jump_url)
      };
    }
    case 'MAJOR_TYPE_UGC_SEASON': {
      const s = major.ugc_season || {};
      return {
        title: s.title || '',
        summary: s.desc || '',
        cover: s.cover || '',
        url: normalizeUrl(s.jump_url)
      };
    }
    case 'MAJOR_TYPE_PGC': {
      const p = major.pgc || {};
      return {
        title: p.title || '',
        summary: '',
        cover: p.cover || '',
        url: p.epid
          ? `https://www.bilibili.com/bangumi/play/ep${p.epid}`
          : normalizeUrl(p.jump_url)
      };
    }
    case 'MAJOR_TYPE_ARTICLE': {
      const a = major.article || {};
      return {
        title: a.title || '',
        summary: a.desc || '',
        cover: Array.isArray(a.covers) ? a.covers[0] || '' : '',
        url: a.id ? `https://www.bilibili.com/read/cv${a.id}` : normalizeUrl(a.jump_url)
      };
    }
    case 'MAJOR_TYPE_OPUS': {
      const o = major.opus || {};
      const pics = Array.isArray(o.pics) ? o.pics : [];
      return {
        title: o.title || '',
        summary: o.summary?.text || '',
        cover: pics[0]?.url || '',
        url: normalizeUrl(o.jump_url)
      };
    }
    case 'MAJOR_TYPE_DRAW': {
      const d = major.draw || {};
      const items = Array.isArray(d.items) ? d.items : [];
      return {
        title: '',
        summary: '',
        cover: items[0]?.src || '',
        url: ''
      };
    }
    case 'MAJOR_TYPE_LIVE_RCMD': {
      let live = {};
      try {
        live = JSON.parse(major.live_rcmd?.content || '{}');
      } catch (err) {
        live = {};
      }
      const info = live.live_play_info || {};
      return {
        title: info.title || '',
        summary: info.area_name || '',
        cover: info.cover || '',
        url: info.room_id ? `https://live.bilibili.com/${info.room_id}` : ''
      };
    }
    case 'MAJOR_TYPE_LIVE': {
      const l = major.live || {};
      return {
        title: l.title || '',
        summary: l.desc_first || '',
        cover: l.cover || '',
        url: l.id ? `https://live.bilibili.com/${l.id}` : normalizeUrl(l.jump_url)
      };
    }
    case 'MAJOR_TYPE_MUSIC': {
      const m = major.music || {};
      return {
        title: m.title || '',
        summary: m.label || '',
        cover: m.cover || '',
        url: m.id ? `https://www.bilibili.com/audio/au${m.id}` : normalizeUrl(m.jump_url)
      };
    }
    case 'MAJOR_TYPE_COURSES': {
      const c = major.courses || {};
      return {
        title: c.title || '',
        summary: c.sub_title || c.desc || '',
        cover: c.cover || '',
        url: normalizeUrl(c.jump_url)
      };
    }
    case 'MAJOR_TYPE_MEDIALIST': {
      const m = major.medialist || {};
      return {
        title: m.title || '',
        summary: m.sub_title || '',
        cover: m.cover || '',
        url: normalizeUrl(m.jump_url)
      };
    }
    case 'MAJOR_TYPE_COMMON': {
      const c = major.common || {};
      return {
        title: c.title || '',
        summary: c.desc || '',
        cover: c.cover || '',
        url: normalizeUrl(c.jump_url)
      };
    }
    case 'MAJOR_TYPE_APPLET': {
      const a = major.applet || {};
      return {
        title: a.title || '',
        summary: a.sub_title || '',
        cover: '',
        url: normalizeUrl(a.jump_url)
      };
    }
    case 'MAJOR_TYPE_NONE': {
      return {
        title: '',
        summary: major.none?.tips || '源动态已被作者删除',
        cover: '',
        url: ''
      };
    }
    default: {
      // 未知 major 类型：尽力从常见字段里捞一把
      const guess = major[Object.keys(major).find((k) => k !== 'type')] || {};
      return {
        title: guess.title || '',
        summary: guess.desc || guess.sub_title || '',
        cover: guess.cover || '',
        url: normalizeUrl(guess.jump_url)
      };
    }
  }
}

export function parseDynamicItem(raw, fallback = {}) {
  try {
    const id = raw?.id_str;
    if (!id) return null;

    const author = raw?.modules?.module_author || {};
    const dynamic = raw?.modules?.module_dynamic || {};
    const major = extractMajor(dynamic.major) || { title: '', summary: '', cover: '', url: '' };

    const descText = dynamic.desc?.text || '';
    const type = raw?.type || 'DYNAMIC_TYPE_NONE';

    let title = major.title || '';
    let summary = descText || major.summary || '';

    // 转发：把原动态的内容拼进摘要，方便一眼看出转了什么
    if (type === 'DYNAMIC_TYPE_FORWARD' && raw?.orig) {
      const orig = parseDynamicItem(raw.orig, { skipAuthor: true });
      if (orig) {
        const origName = orig.name ? `@${orig.name}：` : '';
        const origText = orig.title || orig.summary || '';
        const quoted = `${origName}${origText}`.trim();
        summary = [descText, quoted ? `转发 ${quoted}` : ''].filter(Boolean).join(' ｜ ');
      }
    }

    if (!title && !summary) {
      summary = typeLabelOf(type);
    }

    const url = major.url || `https://t.bilibili.com/${id}`;

    return {
      id: String(id),
      uid: String(author.mid || fallback.uid || ''),
      name: author.name || fallback.name || '',
      face: normalizeUrl(author.face || fallback.face || ''),
      type,
      typeLabel: typeLabelOf(type),
      title: truncate(title, 80),
      summary: truncate(summary, SUMMARY_MAX_LENGTH),
      cover: normalizeUrl(major.cover || ''),
      url,
      pubTs: Number(author.pub_ts) || 0,
      read: false
    };
  } catch (err) {
    console.warn('[bili-notifier] 解析动态失败，已跳过', err);
    return null;
  }
}

export function parseDynamicList(items, fallback = {}) {
  if (!Array.isArray(items)) return [];
  return items
    .filter((raw) => !isPinned(raw))
    .map((raw) => parseDynamicItem(raw, fallback))
    .filter(Boolean);
}
