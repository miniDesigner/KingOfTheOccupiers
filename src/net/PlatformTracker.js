/**
 * PlatformTracker — 小程序数据管理平台埋点 SDK（按平台文档协议实现）
 *
 * 协议要点（见项目资产《小程序接入数据平台说明》v1.0）：
 *   - POST {reportUrl}，body = { appKey, events: [...] }
 *   - 满 batchSize 条或每 flushIntervalMs 毫秒批量上报，切后台立即 flush
 *   - 事件名正则 ^[a-z_][a-z0-9_]{0,63}$，非法事件丢弃
 *   - 看板口径：DAU = game_start 去重 player_id；新增 = register 去重 player_id
 *
 * 设计约束：
 *   1. 埋点失败绝不影响游戏：所有网络/存储异常静默吞掉
 *   2. 浏览器预览（wx.__tkBrowser）与 Node 测试环境自动 noop，不发真实请求
 *   3. player_id 由业务在账号就绪后绑定（Game.start → AccountManager.init 之后），
 *      入口阶段事件先入队，绑定完成再 flush，避免游客账号切换导致 DAU 重复计数
 *   4. extra 白名单化，过滤 password/phone/openid 等敏感键，满足 PIPL 合规要求
 */

import PLATFORM_CONFIG from './PlatformConfig.js';

const EVENT_NAME_RE = /^[a-z_][a-z0-9_]{0,63}$/;
const EXTRA_KEY_RE = /^[a-zA-Z][a-zA-Z0-9_]{0,31}$/;
const SENSITIVE_KEY_RE = /pass(word)?|phone|mobile|idcard|id_card|token|secret|openid|unionid|email|credential/i;
const REGISTER_FLAG_KEY = 'tk_platform_registered';
const MAX_QUEUE = 200;

let _cfg = { ...PLATFORM_CONFIG };
let _queue = [];
let _playerId = null;
let _timer = null;
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
 * @param {string} event 事件名（小写下划线）
 * @param {object} [params] { level, scene, client_version, extra }
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

/** 运行时覆盖配置（如从服务端注入正式 appKey，避免写死在仓库） */
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
  };
}

_ensureTimer();
_bindHideHook();

export { track, registerOnce, setPlayerId, configure, flush, getState };
export default { track, registerOnce, setPlayerId, configure, flush, getState };
