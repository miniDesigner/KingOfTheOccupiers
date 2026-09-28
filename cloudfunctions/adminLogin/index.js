/**
 * 云函数 adminLogin — 后台管理员登录
 *
 * 入参：{ username, password }
 * 出参：{ ok, token, username, role }
 *
 * 用 shared/password.js 的 scrypt 校验 + shared/token.js 签 JWT。
 * 种子超管：admin / admin123（首次由 adminRouter 的 ensureDefaultAdmin 或手工写入）。
 *
 * 同时兼容两种调用：
 *   1. wx.cloud.callFunction：event = { username, password }
 *   2. HTTP 触发（静态托管 admin 前端用 fetch 调）：event = { httpMethod, body(JSON 字符串), headers }
 *      → 返回 { statusCode, headers(CORS), body(JSON 字符串) }
 */
const cloud = require('wx-server-sdk');
const dao = require('./shared/db.js');
const { verifyPassword, hashPassword } = require('./shared/password.js');
const { signToken } = require('./shared/token.js');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

// 与 server/config.js 一致
const JWT_SECRET = process.env.TK_JWT_SECRET || 'territory-king-dev-secret-change-me-in-prod';
const ADMIN_TOKEN_TTL = 1000 * 60 * 60 * 12; // 12 小时

/** 判断是否 HTTP 触发（而非 wx.cloud.callFunction） */
function isHttpEvent(event) {
  return event && typeof event.httpMethod === 'string';
}

/** 从 HTTP event 解出 body 对象（body 是 JSON 字符串） */
function parseHttpBody(event) {
  if (!event || event.body == null) return {};
  if (typeof event.body === 'object') return event.body;
  try { return JSON.parse(event.body); } catch (e) { return {}; }
}

/** 包装 HTTP 响应（带 CORS 头，返回给静态托管跨域调用） */
function httpResponse(statusCode, data) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
    body: JSON.stringify(data),
  };
}

async function doLogin({ username, password }) {
  // 懒种子默认超管：首次部署 admin_users 为空时自动建 admin/admin123
  try {
    const count = await dao.countAdmins();
    if (count === 0) {
      await dao.createAdmin({ username: 'admin', passwordHash: hashPassword('admin123'), role: 'superadmin' });
      console.log('[adminLogin] seeded default superadmin: admin/admin123');
    }
  } catch (e) {
    console.warn('[adminLogin] ensureDefaultAdmin failed:', e && e.message || e);
  }

  if (!username || !password) return { ok: false, error: 'username and password required', statusCode: 400 };

  const admin = await dao.getAdminByUsername(username);
  if (!admin || !verifyPassword(password, admin.passwordHash)) {
    return { ok: false, error: 'invalid username or password', statusCode: 401 };
  }

  const token = signToken(
    { sub: admin.username, role: admin.role, aid: admin._id || admin.id, type: 'admin' },
    JWT_SECRET,
    ADMIN_TOKEN_TTL
  );

  return { ok: true, token, username: admin.username, role: admin.role };
}

exports.main = async (event) => {
  // HTTP 触发分支
  if (isHttpEvent(event)) {
    if (event.httpMethod === 'OPTIONS') return httpResponse(204, {});
    const body = parseHttpBody(event);
    const result = await doLogin(body);
    const code = result.ok ? 200 : (result.statusCode || 500);
    return httpResponse(code, result);
  }
  // wx.cloud.callFunction 分支
  return doLogin(event || {});
};
