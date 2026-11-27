/**
 * PlatformTracker — 小程序数据管理平台埋点 SDK
 *
 * 协议依据：项目资产《小程序接入数据平台说明》v2.1 + 官方 client/tracker.js v3.1。
 * 本模块 = 官方 SDK 全能力 + 工程健壮性增强（不直接照搬官方 CommonJS 文件）：
 *   - 官方能力：app_launch/login 新口径、heartbeat 心跳、trackAd、trackEconomy、
 *     顶层 amount/currency/reason/session_id/channel/server_id 透传、getAnnouncements
 *   - 增强点：enabled 开关、非真微信环境 noop、稳定 player_id 绑定后再发、
 *     extra 敏感键过滤（PIPL）、事件名校验、队列上限、切后台 flush
 *
 * 为什么不用官方 tracker.js 原文件：
 *   1. 官方文件是 CommonJS，本项目全 ES module；
 *   2. 官方文件用 'anonymous_'+Date.now() 当 player_id —— 平台自己在修复报告里
 *      警告这会导致 DAU 虚高；本项目用 AccountManager.getUID() 稳定 uid；
 *   3. 官方文件没有 enabled 开关 / 环境降级 / 敏感字段过滤 / 入口事件回填。
 *
 * 设计铁律：埋点失败绝不影响游戏 —— 所有网络/存储异常静默吞掉。
 */

import PLATFORM_CONFIG from './PlatformConfig.js';

const EVENT_NAME_RE = /^[a-z_][a-z0-9_]{0,63}$/;
const EXTRA_KEY_RE = /^[a-zA-Z][a-zA-Z0-9_]{0,31}$/;
const SENSITIVE_KEY_RE = /pass(word)?|phone|mobile|idcard|id_card|token|secret|openid|unionid|email|credential/i;
const REGISTER_FLAG_KEY = 'tk_platform_registered';
const MAX_QUEUE = 200;

// v3.1 新增的顶层字段白名单（官方 SDK 从 params 透传，平台入库按顶层字段统计）
const PASSTHROUGH_KEYS = ['session_id', 'channel', 'server_id', 'amount', 'currency', 'reason'];

let _cfg = { ...PLATFORM_CONFIG };
let _queue = [];
let _playerId = null;
let _timer = null;
let _heartbeatTimer = null;
let _flushing = false;
let _hideHookBound = false;

/** 真微信运行时：有 wx.request，且不是浏览器预览 shim */
function _isRealWx() {
  return typeof wx !== 'undefined' && !!wx && typeof wx.request === 'function' && wx.__tkBrowser !== true;
}

/** 本地存储读（微信 / 浏览器 / Node 三环境兜底） */
function _storageGet(key) {
  try {
    if (typeof wx !== 'undefined' && wx && typeof wx.getStorageSync === 'function') {
      return wx.getStorageSync(key);
    }
    if (typeof localStorage !== 'undefined') return localStorage.getItem(key);
  } catch (e) { /* 存储不可用视为未记录 */ }
  return null;
}

/** 本地存储写 */
function _storageSet(key, value) {
  try {
    if (typeof wx !== 'undefined' && wx && typeof wx.setStorageSync === 'function') {
      wx.setStorageSync(key, value);
      return;
    }
    if (typeof localStorage !== 'undefined') localStorage.setItem(key, String(value));
  } catch (e) { /* 存储失败不影响上报 */ }
}

/** extra 字段清洗：只保留短字符串/有限数字/布尔，剔除敏感键 */
function _sanitizeExtra(extra) {
  if (!extra || typeof extra !== 'object' || Array.isArray(extra)) return undefined;
  const out = {};
  let count = 0;
  for (const [key, value] of Object.entries(extra)) {
    if (count >= 16) break;
    if (!EXTRA_KEY_RE.test(key) || SENSITIVE_KEY_RE.test(key)) continue;
    if (typeof value === 'string') out[key] = value.slice(0, 128);
    else if (typeof value === 'number' && Number.isFinite(value)) out[key] = value;
    else if (typeof value === 'boolean') out[key] = value;
    else continue;
    count++;
  }
  return count > 0 ? out : undefined;
}

/** 启动/停止定时批量上报（只在真微信 + 启用时启动，避免 Node 测试挂进程） */
function _ensureTimer() {
  const shouldRun = _cfg.enabled && _isRealWx();
  if (shouldRun && !_timer) {
    _timer = setInterval(flush, Math.max(1000, _cfg.flushIntervalMs));
  } else if (!shouldRun && _timer) {
    clearInterval(_timer);
    _timer = null;
  }
}

/** 绑定稳定用户 ID；入口事件会在绑定后一次性 flush */
function setPlayerId(id) {
  if (typeof id !== 'string' || !id) return false;
  const changed = _playerId !== id;
  _playerId = id.slice(0, 128);
  if (changed || _queue.length > 0) flush();
  return true;
}

/**
 * 上报一个事件。玩家 ID 未就绪时事件留在队列，等 setPlayerId 后统一发送。
 * @param {string} event 事件名（小写下划线，见 v2.1 事件字典）
 * @param {object} [params] { level, scene, client_version, extra, session_id, channel,
 *                            server_id, amount, currency, reason }
 * @returns {boolean} 是否已入队
 */
function track(event, params = {}) {
  if (!_cfg.enabled) return false;
  if (typeof event !== 'string' || !EVENT_NAME_RE.test(event)) return false;

  const item = {
    event,
    platform: 'wechat',
    ts: Date.now(),
  };
  if (typeof params.client_version === 'string') item.client_version = params.client_version.slice(0, 32);
  else if (_cfg.clientVersion) item.client_version = String(_cfg.clientVersion).slice(0, 32);
  if (params.level !== undefined && Number.isFinite(Number(params.level))) item.level = Number(params.level);
  if (typeof params.scene === 'string' && params.scene) item.scene = params.scene.slice(0, 64);
  const extra = _sanitizeExtra(params.extra);
  if (extra) item.extra = extra;
  // v3.1 顶层字段透传（金额单位分；amount 必须是整数）
  for (const key of PASSTHROUGH_KEYS) {
    let value = params[key];
    if (value === undefined || value === null) continue;
    if (key === 'amount') {
      value = Number(value);
      if (!Number.isFinite(value)) continue;
      value = Math.trunc(value);
    } else if (typeof value === 'string') {
      value = value.slice(0, 64);
    } else if (typeof value !== 'number' && typeof value !== 'boolean') {
      continue;
    }
    item[key] = value;
  }
  if (_playerId) item.player_id = _playerId;

  if (_queue.length >= MAX_QUEUE) _queue.shift(); // 极端情况下丢弃最老事件，防内存膨胀
  _queue.push(item);

  if (_cfg.debug) console.log('[PlatformTracker] track:', item.event, 'queue:', _queue.length);
  if (_queue.length >= Math.max(1, _cfg.batchSize)) flush();
  return true;
}

/** 首次启动上报 register（用于看板「新增用户」），幂等且跨会话持久 */
function registerOnce() {
  if (!_cfg.enabled) return false;
  if (_storageGet(REGISTER_FLAG_KEY)) return false;
  _storageSet(REGISTER_FLAG_KEY, 1);
  return track('register', { scene: 'boot' });
}

/** 广告事件快捷方法（对应看板「广告变现」）；action: impression / click / reward */
function trackAd(action, params = {}) {
  const map = { impression: 'ad_impression', click: 'ad_click', reward: 'ad_reward' };
  return track(map[action] || ('ad_' + action), params);
}

/** 经济流水快捷方法（货币/道具变动，用于经济对账）；kind: currency / item */
function trackEconomy(kind, amount, reason, params = {}) {
  const event = kind === 'item' ? 'item_change' : 'currency_change';
  return track(event, { ...params, amount, reason });
}

/**
 * 启动心跳：每 heartbeatIntervalMs 上报一次在线，驱动看板「实时在线/峰值/分服在线」。
 * 只在真微信 + 启用时启动，避免 Node 测试挂定时器。
 */
function startHeartbeat(params = {}) {
  if (!_cfg.enabled || !_isRealWx() || _heartbeatTimer) return false;
  const beat = () => track('heartbeat', params);
  beat();
  _heartbeatTimer = setInterval(beat, Math.max(60 * 1000, _cfg.heartbeatIntervalMs || 5 * 60 * 1000));
  return true;
}

/** 停止心跳 */
function stopHeartbeat() {
  if (_heartbeatTimer) {
    clearInterval(_heartbeatTimer);
    _heartbeatTimer = null;
    return true;
  }
  return false;
}

/** 拉取平台公告（已发布 + 全体），返回 Promise<公告数组>；失败返回空数组 */
function getAnnouncements(limit = 50) {
  if (!_cfg.enabled || !_isRealWx()) return Promise.resolve([]);
  return new Promise((resolve) => {
    try {
      wx.request({
        url: _cfg.announcementUrl,
        method: 'POST',
        header: { 'Content-Type': 'application/json' },
        data: JSON.stringify({ appKey: _cfg.appKey, limit }),
        success(res) {
          if (res && res.statusCode === 200 && res.data && res.data.ok) {
            resolve(Array.isArray(res.data.announcements) ? res.data.announcements : []);
          } else resolve([]);
        },
        fail() { resolve([]); },
      });
    } catch (e) { resolve([]); }
  });
}

/** 立即发送队列中的事件，返回本批条数；失败静默丢弃（埋点允许丢，不允许卡游戏） */
function flush() {
  if (!_cfg.enabled || !_isRealWx() || _flushing || !_playerId || _queue.length === 0) return 0;
  const batch = _queue.splice(0, Math.max(1, _cfg.batchSize));
  // 入口阶段事件入队时玩家 ID 尚未就绪，发送前统一回填，
  // 否则看板拿不到 player_id 就无法做 DAU / 新增去重。
  for (const ev of batch) {
    if (!ev.player_id) ev.player_id = _playerId;
  }
  const payload = { appKey: _cfg.appKey, events: batch };
  _flushing = true;
  if (_cfg.debug) console.log('[PlatformTracker] flush:', batch.length, 'events');
  try {
    wx.request({
      url: _cfg.reportUrl,
      method: 'POST',
      header: { 'Content-Type': 'application/json' },
      data: JSON.stringify(payload),
      success(res) {
        if (_cfg.debug && res && res.statusCode !== 200) {
          console.warn('[PlatformTracker] report status:', res.statusCode);
        }
      },
      fail() { /* 静默：网络失败不重试，避免堆积 */ },
      complete() {
        _flushing = false;
        if (_queue.length >= Math.max(1, _cfg.batchSize)) flush();
      },
    });
  } catch (e) {
    _flushing = false;
    if (_cfg.debug) console.warn('[PlatformTracker] report threw:', e && e.message);
  }
  return batch.length;
}

/** 运行时覆盖配置（如从服务端注入 appKey，避免写死在仓库） */
function configure(patch = {}) {
  if (!patch || typeof patch !== 'object') return { ..._cfg };
  _cfg = { ..._cfg, ...patch };
  _ensureTimer();
  return { ..._cfg };
}

/** 切后台立即 flush（只绑定一次） */
function _bindHideHook() {
  if (_hideHookBound || !_isRealWx() || typeof wx.onHide !== 'function') return;
  wx.onHide(() => flush());
  _hideHookBound = true;
}

/** 测试/排障用快照，勿用于业务逻辑 */
function getState() {
  return {
    enabled: _cfg.enabled,
    appKey: _cfg.appKey,
    reportUrl: _cfg.reportUrl,
    playerId: _playerId,
    queueLength: _queue.length,
    flushing: _flushing,
    heartbeatActive: !!_heartbeatTimer,
  };
}

_ensureTimer();
_bindHideHook();

const api = {
  track, registerOnce, setPlayerId, configure, flush, getState,
  trackAd, trackEconomy, startHeartbeat, stopHeartbeat, getAnnouncements,
};
export {
  track, registerOnce, setPlayerId, configure, flush, getState,
  trackAd, trackEconomy, startHeartbeat, stopHeartbeat, getAnnouncements,
};
export default api;
