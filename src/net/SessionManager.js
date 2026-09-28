/**
 * 账号体系（会话管理）——本地持久化身份
 *
 * 目标：让联机对战「知道谁是谁」。uid 是跨对局的稳定身份标识，
 * 首次进入生成本地游客身份并持久化，后续恢复同一 uid。
 *
 * 真实环境：wx.login → 后端 code2Session → openid → 生成 uid/token
 * 本地环境（浏览器/开发）：生成本地游客 uid（无服务端），持久化到 localStorage。
 * 通过可注入的 authProvider 支持生产接微信登录，不影响上层逻辑。
 *
 * 关键约束：uid / openid / token 属「呈现层 + 握手层」数据，
 * 绝不进入帧同步世界状态 / 命令 / checksum。
 */

import { AccountManager } from '../meta/AccountManager.js';

const STORAGE_KEY = 'territory_king_session';

export class SessionManager {
  constructor(authProvider = null) {
    // authProvider：生产环境注入 wx.login→code2Session 实现；为空则走本地游客身份
    this.authProvider = authProvider || null;
    this.uid = null;
    this.token = null;
    this.openid = null;
  }

  /** 判断是否为微信环境（wx.setStorageSync 可用） */
  static isWxEnv() {
    return typeof wx !== 'undefined' && typeof wx.setStorageSync === 'function';
  }

  /** 读取本地持久化身份（双环境：wx storage / localStorage） */
  static _readStorage() {
    if (SessionManager.isWxEnv()) {
      try { return wx.getStorageSync(STORAGE_KEY) || null; } catch (e) { return null; }
    }
    try {
      if (typeof localStorage === 'undefined') return null;
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }

  /** 写入本地持久化身份 */
  static _writeStorage(data) {
    if (SessionManager.isWxEnv()) {
      try { wx.setStorageSync(STORAGE_KEY, data); } catch (e) {}
    } else {
      try { if (typeof localStorage !== 'undefined') localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); } catch (e) {}
    }
  }

  /** 生成随机本地 uid */
  static generateUID() {
    return 'u_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 10);
  }

  /** 生成随机本地 token */
  static generateToken() {
    return 'tk_' + Math.random().toString(36).slice(2, 12);
  }

  /**
   * 登录流程（幂等：先恢复持久化身份，再决定是否需要新身份）
   * @returns {Promise<{openid:string|null, uid:string, token:string|null}>}
   */
  async init() {
    // 多账号模型：uid 由 AccountManager 统一管理（Game.start 先 AccountManager.init()）。
    // 本地游客无 token/openid，身份稳定由账号元数据保证。
    const cur = AccountManager.getCurrent();
    if (cur && cur.uid) {
      this.uid = cur.uid;
      this.token = null;
      this.openid = null;
      return this._identity();
    }

    // 旧单账号 fallback（AccountManager 未初始化：独立使用/旧测试向后兼容）
    // 1. 恢复本地持久化身份（uid 稳定可识别，是联机「谁是谁」的基础）
    const saved = SessionManager._readStorage();
    if (saved && saved.uid) {
      this.uid = saved.uid;
      this.token = saved.token || null;
      this.openid = saved.openid || null;
      return this._identity();
    }

    // 2. 若注入真实认证源（生产 wx.login→code2Session），走服务端登录
    if (this.authProvider) {
      try {
        const s = await this.authProvider.code2Session();
        this.openid = s && s.openid ? s.openid : null;
        this.uid = s && s.uid ? s.uid : SessionManager.generateUID();
        this.token = s && s.token ? s.token : null;
        this._persist();
        return this._identity();
      } catch (e) {
        console.warn('[SessionManager] code2Session failed, fallback to local identity:', e);
      }
    }

    // 3. 兜底：生成本地游客身份（浏览器/开发环境，无服务端）
    this.openid = null;
    this.uid = SessionManager.generateUID();
    this.token = SessionManager.generateToken();
    this._persist();
    return this._identity();
  }

  /** 当前身份快照 */
  _identity() {
    return { openid: this.openid, uid: this.uid, token: this.token };
  }

  /** 持久化当前身份 */
  _persist() {
    SessionManager._writeStorage({ uid: this.uid, token: this.token, openid: this.openid });
  }

  getUID() { return this.uid; }
  getToken() { return this.token; }
  getOpenid() { return this.openid; }
}
