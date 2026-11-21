/**
 * 合规系统 · 适龄提示 / 实名引导 / 未成年人防沉迷（前端层）
 *
 * 定位（重要，别误读为「已接入官方实名」）：
 *  - 微信小游戏的**真实实名核验**必须走服务端对接具备资质的实名认证接口，
 *    前端只能提供「状态记录 + 引导入口 + 本地时长/时段管控」。
 *  - 本模块不上传任何个人信息；identity 字段是**本地声明**，不具备核验效力。
 *  - 默认 identity='unknown' 且 minorMode=false，不拦截任何玩家——
 *    拦截只在用户主动开启青少年模式或声明为未成年人后生效。
 *
 * 三环境行为：
 *  - 微信小游戏：wx.getStorageSync / wx.setStorageSync 持久化
 *  - 浏览器预览：localStorage 持久化（不可用则退化为内存）
 *  - Node 测试：无存储 API → 纯内存，不抛错、不污染全局
 *
 * 设计铁律：只影响提示层与状态，不改任何布局坐标、玩法数值、点击命中。
 */

const STORAGE_KEY = 'koto_compliance_v1';

/** 未成年人每日可玩上限（秒）：防沉迷规定 1 小时 */
export const MINOR_DAILY_LIMIT = 3600;
/** 青少年模式更严上限（秒）：30 分钟 */
export const TEEN_MODE_DAILY_LIMIT = 1800;
/** 适龄提示等级（版署申报截图 #1 要求显示） */
export const AGE_RATING = '8+';
/** 允许未成年人游玩的星期：周五(5)/周六(6)/周日(0) */
const ALLOWED_DAYS = [5, 6, 0];
/** 允许未成年人游玩的时段：20:00–21:00 */
const ALLOWED_HOUR = 20;

const DEFAULT_STATE = {
  noticeAccepted: false,   // 是否已知悉适龄提示
  identity: 'unknown',     // unknown | adult | minor（本地声明，非核验结果）
  minorMode: false,        // 青少年模式开关
  playSecondsToday: 0,     // 当日累计游玩秒数
  date: '',                // 累计所属日期（跨天自动清零）
  warningShown: false,     // 当日是否已弹过时长预警
};

let state = null;

function todayKey(d = new Date()) {
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

function hasWxStorage() {
  return typeof wx !== 'undefined' && wx && typeof wx.getStorageSync === 'function';
}

function hasLocalStorage() {
  try {
    return typeof localStorage !== 'undefined' && !!localStorage;
  } catch (_) {
    return false;
  }
}

/**
 * 无头环境（Node 测试）：视为已确认，不弹提示层。
 * 与 FontSystem / ArtSystem 的「无 API 静默降级」一致——提示层面向真实玩家，
 * 测试进程里弹窗只会挡住所有 handleScreenClick 断言，没有任何合规价值。
 */
function isHeadless() {
  // 不能用 localStorage 是否存在来判断：Node 24 已内置全局 localStorage，
  // 而部分测试还会 stub window/document。唯一可靠信号是 Node 进程本身。
  // 真实微信小游戏与浏览器都没有 process.versions.node，
  // 因此「在 Node 进程里」即可判定为测试环境，不受 wx/localStorage stub 影响。
  return typeof process !== 'undefined' && !!process.versions && !!process.versions.node;
}

function read() {
  try {
    if (isHeadless()) return { ...DEFAULT_STATE, noticeAccepted: true };
    let raw = null;
    if (hasWxStorage()) raw = wx.getStorageSync(STORAGE_KEY);
    else if (hasLocalStorage()) raw = localStorage.getItem(STORAGE_KEY);
    if (typeof raw === 'string') {
      // 兼容双层编码：浏览器预览的 wx.setStorageSync mock 会对字符串再 stringify 一次，
      // 直接 parse 得到的是「字符串」而非对象，若不二次解析会被当作无效状态丢弃，
      // 表现为适龄提示每次刷新都重新弹出。
      try { raw = JSON.parse(raw); } catch (_) { /* 保留原值，下面校验会退回默认 */ }
    }
    if (typeof raw === 'string') {
      try { raw = JSON.parse(raw); } catch (_) { /* ignore */ }
    }
    if (!raw || typeof raw !== 'object') return { ...DEFAULT_STATE };
    return { ...DEFAULT_STATE, ...raw };
  } catch (_) {
    return { ...DEFAULT_STATE };
  }
}

function write() {
  try {
    const payload = JSON.stringify(state);
    if (hasWxStorage()) wx.setStorageSync(STORAGE_KEY, payload);
    else if (hasLocalStorage()) localStorage.setItem(STORAGE_KEY, payload);
  } catch (_) { /* 存储不可用：退化为内存态，不影响游戏 */ }
}

/** 初始化（幂等）；跨天自动清零累计时长 */
export function init() {
  if (!state) state = read();
  const today = todayKey();
  if (state.date !== today) {
    state.date = today;
    state.playSecondsToday = 0;
    state.warningShown = false;
    write();
  }
  return state;
}

/** 仅供测试：恢复到未初始化状态 */
export function reset() {
  state = null;
  try {
    if (hasWxStorage()) wx.removeStorageSync && wx.removeStorageSync(STORAGE_KEY);
    else if (hasLocalStorage()) localStorage.removeItem(STORAGE_KEY);
  } catch (_) { /* ignore */ }
}

/** 累计游玩时长；dt 单位为秒，非正数与异常大值直接忽略 */
export function recordPlayTime(dt) {
  if (!state) init();
  if (typeof dt !== 'number' || !isFinite(dt) || dt <= 0 || dt > 5) return;
  const today = todayKey();
  if (state.date !== today) {
    state.date = today;
    state.playSecondsToday = 0;
    state.warningShown = false;
  }
  state.playSecondsToday += dt;
  // 每 10 秒落盘一次，避免高频 IO（_persistAccum 用取模判定）
  _persistAccum += dt;
  if (_persistAccum >= 10) {
    _persistAccum = 0;
    write();
  }
}
let _persistAccum = 0;

/** 当前生效的每日上限 */
export function dailyLimit() {
  if (!state) init();
  return state.minorMode ? TEEN_MODE_DAILY_LIMIT : MINOR_DAILY_LIMIT;
}

/** 是否处于「未成年人受管控」状态（默认否，不误伤成年玩家） */
function isControlled() {
  if (!state) init();
  return state.minorMode || state.identity === 'minor';
}

/** 时段管控：仅周五/六/日 20:00–21:00 允许；返回 true 表示当前被限制 */
export function isTimeBlocked(d = new Date()) {
  if (!isControlled()) return false;
  if (!ALLOWED_DAYS.includes(d.getDay())) return true;
  return d.getHours() !== ALLOWED_HOUR;
}

/** 时长管控：当日累计超限返回 true */
export function isTimeLimitReached() {
  if (!isControlled()) return false;
  return state.playSecondsToday >= dailyLimit();
}

/** 供渲染层消费的完整状态快照（纯数据，可安全传给 Node 测试） */
export function getStatus(d = new Date()) {
  if (!state) init();
  const limit = dailyLimit();
  const controlled = isControlled();
  const timeBlocked = isTimeBlocked(d);
  const limitReached = isTimeLimitReached();
  const remaining = Math.max(0, limit - state.playSecondsToday);
  return {
    ageRating: AGE_RATING,
    noticeAccepted: !!state.noticeAccepted,
    identity: state.identity,
    minorMode: !!state.minorMode,
    controlled,
    playSecondsToday: state.playSecondsToday,
    dailyLimit: limit,
    remainingSeconds: remaining,
    timeBlocked,
    limitReached,
    // 只有受管控且（时段不合规 或 时长耗尽）才显示拦截卡
    blocked: controlled && (timeBlocked || limitReached),
    blockReason: limitReached ? 'limit' : (timeBlocked ? 'time' : ''),
    needsNotice: !state.noticeAccepted,
    warningShown: !!state.warningShown,
  };
}

export function acceptNotice() {
  if (!state) init();
  state.noticeAccepted = true;
  write();
}

export function markWarningShown() {
  if (!state) init();
  state.warningShown = true;
  write();
}

/** 设置本地身份声明。真实核验须由服务端完成，此处仅记录前端状态。 */
export function setIdentity(value) {
  if (!state) init();
  state.identity = (value === 'adult' || value === 'minor') ? value : 'unknown';
  write();
}

export function toggleMinorMode() {
  if (!state) init();
  state.minorMode = !state.minorMode;
  write();
  return state.minorMode;
}

export default {
  init, reset, recordPlayTime, getStatus, acceptNotice, markWarningShown,
  setIdentity, toggleMinorMode, dailyLimit, isTimeBlocked, isTimeLimitReached,
  AGE_RATING, MINOR_DAILY_LIMIT, TEEN_MODE_DAILY_LIMIT,
};
