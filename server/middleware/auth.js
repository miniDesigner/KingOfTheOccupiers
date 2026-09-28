/**
 * middleware/auth.js — 请求体读取 + token 鉴权
 */
import { verifyToken } from '../utils/token.js';
import { JWT_SECRET } from '../config.js';

export function httpError(status, message, extra = null) {
  const e = new Error(message);
  e.status = status;
  if (extra) e.extra = extra;
  return e;
}

/** 读取 JSON 请求体（含 Content-Length 上限保护） */
export function readJson(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    let size = 0;
    req.on('data', chunk => {
      size += chunk.length;
      if (size > 5 * 1024 * 1024) { reject(httpError(413, 'body too large')); req.destroy(); return; }
      raw += chunk;
    });
    req.on('end', () => {
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); }
      catch { reject(httpError(400, 'invalid JSON body')); }
    });
    req.on('error', reject);
  });
}

/** 从 Authorization 头取 Bearer token */
export function getBearerToken(req) {
  const h = req.headers['authorization'] || '';
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : null;
}

/** 客户端鉴权：返回 payload {uid} 或抛 401 */
export function requireClient(req) {
  const token = getBearerToken(req);
  const payload = token ? verifyToken(token, JWT_SECRET) : null;
  if (!payload || payload.type !== 'client') throw httpError(401, 'unauthorized');
  return payload;
}

/** 后台鉴权：返回 payload {sub, role, aid} 或抛 401/403 */
export function requireAdmin(req, requiredRole = null) {
  const token = getBearerToken(req);
  const payload = token ? verifyToken(token, JWT_SECRET) : null;
  if (!payload || payload.type !== 'admin') throw httpError(401, 'admin unauthorized');
  const rank = { readonly: 0, operator: 1, superadmin: 2 };
  if (requiredRole && rank[payload.role] < rank[requiredRole]) {
    throw httpError(403, `requires ${requiredRole} role`);
  }
  return payload;
}
