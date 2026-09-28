/**
 * services/auth.js — 客户端认证（游客登录 + 微信登录占位）
 */
import * as dao from '../db/dao.js';
import { signToken } from '../utils/token.js';
import { JWT_SECRET, CLIENT_TOKEN_TTL } from '../config.js';

/**
 * 游客登录：按 uid 查找/创建账号，返回客户端 token。
 * 服务端规范身份 = uid（跨设备稳定），accounts.id 镜像 uid。
 * @param {{uid:string, nickname?:string, deviceId?:string}} body
 */
export function guestLogin({ uid, nickname, deviceId }) {
  if (!uid || typeof uid !== 'string') {
    throw httpError(400, 'missing uid');
  }

  let account = dao.getAccountByUid(uid);
  if (!account) {
    const nick = (nickname && nickname.trim()) || '领主_' + Math.random().toString(16).slice(2, 6);
    account = dao.createAccount({ id: uid, uid, nickname: nick.slice(0, 12) });
  }

  // 封禁校验
  if (account.status === 'banned') {
    const until = account.ban_until;
    if (!until || until > Date.now()) {
      throw httpError(403, 'account banned', { reason: account.ban_reason, until: account.ban_until });
    }
  }

  dao.touchLogin(account.id);

  const token = signToken({ sub: uid, uid, type: 'client' }, JWT_SECRET, CLIENT_TOKEN_TTL);
  return {
    token,
    uid: account.uid,
    accountId: account.id,
    nickname: account.nickname,
    status: account.status,
    profile: null, // 客户端需再 GET /api/profile 拉取
  };
}

/**
 * 微信登录（Phase D）：wx.login code → code2Session → openid。
 * 当前阶段未配置 appid/secret，返回 501 提示。
 */
export function wxLogin(body) {
  throw httpError(501, 'wechat login not configured yet. Use /api/auth/guest for Phase A-C.');
}

export function httpError(status, message, extra = null) {
  const e = new Error(message);
  e.status = status;
  if (extra) e.extra = extra;
  return e;
}
