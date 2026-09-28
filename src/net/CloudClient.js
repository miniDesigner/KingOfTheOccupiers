/**
 * CloudClient — 云端存档同步封装（三通道：浏览器 fetch / 微信 wx.request / 微信云函数 wx.cloud.callFunction）
 *
 * 设计原则（与 server-backend-design.md / cloud-migration-design.md 一致）：
 *   - 本地优先：save() 先写本地，再异步推云端；失败静默，下次再推。
 *   - 权威结算：settle() 只上报「胜负 + 模式 + 对手」，服务端用同款纯函数重算奖励。
 *   - 乐观锁：putProfile 带 version，409 冲突时拉最新重试一次。
 *
 * 通道选择（优先级从高到低）：
 *   1. 云函数通道（isCloud()）：微信小游戏真机 + wx.cloud 可用 → wx.cloud.callFunction。
 *      - openid 免密登录（login 无需 token），天然免域名白名单。
 *   2. HTTP 通道（isWx() 的 wx.request / isBrowser() 的 fetch）：本地开发/浏览器预览。
 *
 * 默认关闭（CLOUD_ENABLED=false），由 ProfileManager.enableCloud() 激活。
 */

const DEFAULT_BASE = 'http://127.0.0.1:8891';
const TOKEN_KEY = 'territory_king_cloud_token';

// 云函数环境 ID（与 cloudbaserc.json 的 envId 一致）
const CLOUD_ENV_ID = 'minigame-prod-d5g02fq8e40658692';

let _base = DEFAULT_BASE;
let _enabled = false;
let _token = null;
let _loggedIn = false;    // 云函数通道的「已登录」标记（openid 免密，无 token）
let _serverVersion = 0;
let _pending = null;      // 待推送的存档快照
let _pushTimer = null;
const PUSH_DEBOUNCE_MS = 800;

// ==================== 环境判断 ====================
function isWx() {
  return typeof wx !== 'undefined' && typeof wx.request === 'function';
}
function isBrowser() {
  return typeof fetch === 'function';
}
// 云函数通道是否可用：微信环境 + wx.cloud.callFunction 存在（真机/支持云开发的 IDE）
function isCloud() {
  return typeof wx !== 'undefined' && typeof wx.cloud === 'object'
    && typeof wx.cloud.callFunction === 'function' && typeof wx.cloud.init === 'function';
}

// ==================== 存储（双环境） ====================
function _storageGet(key) {
  if (typeof wx !== 'undefined' && typeof wx.getStorageSync === 'function') {
    try { return wx.getStorageSync(key) || null; } catch { return null; }
  }
  try { return localStorage.getItem(key); } catch { return null; }
}
function _storageSet(key, val) {
  if (typeof wx !== 'undefined' && typeof wx.setStorageSync === 'function') {
    try { wx.setStorageSync(key, val); } catch {}
  } else {
    try { localStorage.setItem(key, val); } catch {}
  }
}

// ==================== 底层 HTTP ====================
function _raw(method, path, body) {
  const url = _base + path;
  const headers = { 'Content-Type': 'application/json' };
  if (_token) headers['Authorization'] = 'Bearer ' + _token;

  if (isWx()) {
    return new Promise((resolve, reject) => {
      wx.request({
        url,
        method,
        data: body,
        header: headers,
        success: res => resolve({ status: res.statusCode, data: res.data }),
        fail: err => reject(new Error('wx.request failed: ' + ((err && err.errMsg) || 'unknown'))),
      });
    });
  }
  if (isBrowser()) {
    return fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined })
      .then(async res => ({ status: res.status, data: await res.json().catch(() => ({})) }));
  }
  return Promise.reject(new Error('no HTTP transport (fetch/wx.request) available'));
}

// ==================== 底层云函数调用 ====================
let _cloudInited = false;
function _ensureCloudInit() {
  if (!_cloudInited && isCloud()) {
    try {
      wx.cloud.init({ env: CLOUD_ENV_ID, traceUser: true });
      _cloudInited = true;
    } catch (e) {
      console.warn('[Cloud] wx.cloud.init failed:', e && e.message || e);
    }
  }
  return _cloudInited;
}

/**
 * 调云函数。统一解包 res.result（wx.cloud.callFunction 的返回在 result 字段）。
 * 云函数内部错误（result.ok === false 或 result.error）→ reject（带 status）。
 * statusCode 约定：云函数在 result.statusCode 里回传（如 404/403/409），
 * 以便复用 HTTP 通道的乐观锁重试逻辑（err.status）。
 */
function _callCloud(name, data) {
  _ensureCloudInit();
  return new Promise((resolve, reject) => {
    wx.cloud.callFunction({
      name,
      data: data || {},
      success: res => {
        const r = res && res.result;
        if (!r || r.ok === false) {
          const err = new Error((r && r.error) || ('cloud fn ' + name + ' failed'));
          err.status = (r && r.statusCode) || 500;
          err.data = r;
          reject(err);
          return;
        }
        resolve(r);
      },
      fail: err => {
        const e = new Error('wx.cloud.callFunction ' + name + ' failed: ' + ((err && err.errMsg) || 'unknown'));
        e.status = 0;
        reject(e);
      },
    });
  });
}

async function request(method, path, body) {
  const { status, data } = await _raw(method, path, body);
  if (status >= 200 && status < 300) return data;
  const err = new Error((data && data.error) || ('HTTP ' + status));
  err.status = status;
  err.data = data;
  throw err;
}

// ==================== 配置 ====================
function configure(opts = {}) {
  if (opts.baseUrl) _base = opts.baseUrl;
  if (opts.enabled !== undefined) _enabled = !!opts.enabled;
}
function enable(baseUrl) { _enabled = true; if (baseUrl) _base = baseUrl; }
function disable() { _enabled = false; }
function isEnabled() { return _enabled; }
function getBaseUrl() { return _base; }

// ==================== token ====================
function setToken(t) { _token = t; if (t) _storageSet(TOKEN_KEY, t); }
function getToken() { return _token; }

// ==================== 客户端 API ====================
async function login(uid, nickname) {
  // 云函数通道：openid 免密，无需 token（openid 由 wxContext 自动注入）
  if (isCloud()) {
    const r = await _callCloud('login', { uid, nickname });
    // 云函数登录无 token；openid 已由服务端绑定，无需客户端保存
    _loggedIn = true;
    return r;
  }
  // HTTP 通道：guest 登录换取 token
  const r = await request('POST', '/api/auth/guest', { uid, nickname });
  setToken(r.token);
  _loggedIn = true;
  return r;
}

async function getProfile() {
  if (isCloud()) {
    const r = await _callCloud('getProfile', {});
    if (r && typeof r.version === 'number') _serverVersion = r.version;
    return r;
  }
  const r = await request('GET', '/api/profile');
  if (r && typeof r.version === 'number') _serverVersion = r.version;
  return r;
}

async function putProfile(version, data, power) {
  if (isCloud()) {
    const r = await _callCloud('putProfile', { version, data, power });
    if (r && typeof r.version === 'number') _serverVersion = r.version;
    return r;
  }
  const r = await request('PUT', '/api/profile', { version, data, power });
  if (r && typeof r.version === 'number') _serverVersion = r.version;
  return r;
}

async function settle(result, mode, opts = {}) {
  if (isCloud()) {
    return _callCloud('settle', { result, mode, ...opts });
  }
  return request('POST', '/api/profile/settle', { result, mode, ...opts });
}

// ==================== 防抖推送 ====================
function schedulePush(payload) {
  if (!_enabled) return;
  _pending = payload; // 最新快照覆盖旧快照
  if (_pushTimer) clearTimeout(_pushTimer);
  _pushTimer = setTimeout(flushPush, PUSH_DEBOUNCE_MS);
}

async function flushPush() {
  _pushTimer = null;
  if (!_enabled || !_pending) return;
  const payload = _pending;
  _pending = null;
  try {
    if (!_loggedIn && !_token) await login(payload.uid, payload.nickname);
    const r = await putProfile(_serverVersion, payload.data, payload.power);
    console.log('[Cloud] profile synced → v' + r.version);
  } catch (e) {
    if (e && e.status === 409) {
      // 乐观锁冲突：拉最新后重试一次
      try {
        const prof = await getProfile();
        _serverVersion = prof.version;
        const r2 = await putProfile(_serverVersion, payload.data, payload.power);
        console.log('[Cloud] profile synced (after conflict) → v' + r2.version);
      } catch (e2) {
        console.warn('[Cloud] push retry failed:', e2 && e2.message || e2);
      }
    } else {
      console.warn('[Cloud] push failed:', e && e.message || e);
    }
  }
}

const CloudClient = {
  configure, enable, disable, isEnabled, getBaseUrl,
  setToken, getToken,
  login, getProfile, putProfile, settle,
  schedulePush, flushPush,
};

export { CloudClient };
export default CloudClient;
