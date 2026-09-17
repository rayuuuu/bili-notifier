// 集中定义存储 key、默认设置与动态类型映射

export const STORAGE_KEYS = {
  settings: 'settings',
  subscriptions: 'subscriptions',
  feed: 'feed',
  wbiKeys: 'wbiKeys',
  runtime: 'runtime',
  anonBuvid: 'anonBuvid'
};

export const DEFAULT_SETTINGS = {
  pollIntervalMinutes: 5,
  notificationsEnabled: true,
  maxNotificationsPerUser: 3
};

export const POLL_INTERVAL_OPTIONS = [1, 3, 5, 10, 30];

export const DEFAULT_RUNTIME = {
  lastCheckAt: 0,
  lastError: null,
  backoffUntil: 0,
  backoffLevel: 0
};

// feed 缓存条目全局上限，超出按时间裁剪
export const FEED_LIMIT = 200;

// popup 展示的最大条目数
export const POPUP_FEED_LIMIT = 50;

export const ALARM_NAME = 'bili-poll';

// 通知正文截断长度
export const SUMMARY_MAX_LENGTH = 120;

// 动态类型 → 中文标签
export const DYNAMIC_TYPE_LABELS = {
  DYNAMIC_TYPE_AV: '视频',
  DYNAMIC_TYPE_UGC_SEASON: '合集视频',
  DYNAMIC_TYPE_PGC: '番剧',
  DYNAMIC_TYPE_PGC_UNION: '番剧',
  DYNAMIC_TYPE_DRAW: '图文',
  DYNAMIC_TYPE_WORD: '文字',
  DYNAMIC_TYPE_ARTICLE: '专栏',
  DYNAMIC_TYPE_FORWARD: '转发',
  DYNAMIC_TYPE_MUSIC: '音频',
  DYNAMIC_TYPE_LIVE: '直播',
  DYNAMIC_TYPE_LIVE_RCMD: '直播',
  DYNAMIC_TYPE_MEDIALIST: '收藏夹',
  DYNAMIC_TYPE_COMMON_SQUARE: '活动',
  DYNAMIC_TYPE_COMMON_VERTICAL: '活动',
  DYNAMIC_TYPE_COURSES_SEASON: '课程',
  DYNAMIC_TYPE_SUBSCRIPTION_NEW: '订阅',
  DYNAMIC_TYPE_APPLET: '小程序',
  DYNAMIC_TYPE_NONE: '动态'
};

export const DEFAULT_TYPE_LABEL = '动态';

export function typeLabelOf(type) {
  return DYNAMIC_TYPE_LABELS[type] || DEFAULT_TYPE_LABEL;
}

export const MESSAGE_TYPES = {
  POLL_NOW: 'POLL_NOW',
  GET_STATE: 'GET_STATE',
  ADD_SUBSCRIPTION: 'ADD_SUBSCRIPTION',
  REMOVE_SUBSCRIPTION: 'REMOVE_SUBSCRIPTION',
  MARK_READ: 'MARK_READ',
  MARK_ALL_READ: 'MARK_ALL_READ',
  SAVE_SETTINGS: 'SAVE_SETTINGS',
  REFRESH_LOGIN: 'REFRESH_LOGIN'
};
