/**
 * cloudfunctions/shared/token.js — 极简 JWT（HMAC-SHA256），零依赖
 * 从 server/utils/token.js 平移（CommonJS 版），用于 admin 后台鉴权。
 */
const crypto = require('node:crypto');

function b64url(buf) {
  return Buffer.from(buf).toString('base64url');
}

function signToken(payload, secret, ttlMs) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const nowSec = Math.floor(Date.now() / 1000);
  const body = { ...payload, iat: nowSec, exp: Math.floor((Date.now() + ttlMs) / 1000) };
  const h = b64url(JSON.stringify(header));
  const p = b64url(JSON.stringify(body));
  const sig = crypto.createHmac('sha256', secret).update(`${h}.${p}`).digest('base64url');
  return `${h}.${p}.${sig}`;
}

function verifyToken(token, secret) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [h, p, sig] = parts;
  const expected = crypto.createHmac('sha256', secret).update(`${h}.${p}`).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  let body;
  try { body = JSON.parse(Buffer.from(p, 'base64url').toString('utf8')); }
  catch { return null; }
  if (body.exp && Date.now() / 1000 > body.exp) return null;
  return body;
}

module.exports = { signToken, verifyToken };
