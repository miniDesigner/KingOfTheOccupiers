/**
 * routes/index.js — 路由表（方法 + 路径正则 → 服务层 handler）
 */
import { readJson, requireClient, requireAdmin } from '../middleware/auth.js';
import * as authService from '../services/auth.js';
import * as profileService from '../services/profile.js';
import * as adminService from '../services/admin.js';

// 路由定义：method / pattern(命名分组) / auth 要求 / handler
const ROUTES = [
  // ---- 客户端认证 ----
  { method: 'POST', path: '/api/auth/guest', auth: 'none', handler: ({ body }) => authService.guestLogin(body) },
  { method: 'POST', path: '/api/auth/login', auth: 'none', handler: ({ body }) => authService.wxLogin(body) },

  // ---- 客户端存档 ----
  { method: 'GET', path: '/api/profile', auth: 'client', handler: ({ auth }) => profileService.getProfile(auth.uid) },
  { method: 'PUT', path: '/api/profile', auth: 'client', handler: ({ auth, body }) => profileService.putProfile(auth.uid, body) },
  { method: 'POST', path: '/api/profile/settle', auth: 'client', handler: ({ auth, body }) => profileService.settleProfile(auth.uid, body) },

  // ---- 后台认证 ----
  { method: 'POST', path: '/api/admin/login', auth: 'none', handler: ({ body }) => adminService.adminLogin(body.username, body.password) },
  { method: 'GET', path: '/api/admin/me', auth: 'admin', handler: ({ auth }) => ({ username: auth.sub, role: auth.role }) },

  // ---- 玩家管理 ----
  { method: 'GET', path: '/api/admin/players', auth: 'admin', handler: ({ query }) => adminService.searchPlayers(query) },
  { method: 'GET', path: '/api/admin/players/:id', auth: 'admin', handler: ({ params }) => adminService.getPlayerDetail(params.id) },
  { method: 'PUT', path: '/api/admin/players/:id', auth: 'operator', handler: ({ params, body, auth }) => adminService.updatePlayer(params.id, body.patch || body, auth) },
  { method: 'POST', path: '/api/admin/players/:id/ban', auth: 'operator', handler: ({ params, body, auth }) => adminService.banPlayer(params.id, body, auth) },

  // ---- 统计 / 日志 ----
  { method: 'GET', path: '/api/admin/stats/overview', auth: 'admin', handler: () => adminService.getStats() },
  { method: 'GET', path: '/api/admin/logs', auth: 'admin', handler: ({ query }) => adminService.getLogs(query) },

  // ---- 公告 ----
  { method: 'GET', path: '/api/admin/announcements', auth: 'admin', handler: () => adminService.listAnnouncements() },
  { method: 'POST', path: '/api/admin/announcements', auth: 'superadmin', handler: ({ body, auth }) => adminService.createAnnouncement(body, auth) },
  { method: 'PUT', path: '/api/admin/announcements/:id', auth: 'superadmin', handler: ({ params, body, auth }) => adminService.updateAnnouncement(Number(params.id), body, auth) },
  { method: 'DELETE', path: '/api/admin/announcements/:id', auth: 'superadmin', handler: ({ params, auth }) => adminService.deleteAnnouncement(Number(params.id), auth) },

  // ---- 管理员 ----
  { method: 'GET', path: '/api/admin/users', auth: 'superadmin', handler: () => adminService.listAdmins() },
  { method: 'POST', path: '/api/admin/users', auth: 'superadmin', handler: ({ body, auth }) => adminService.createAdminUser(body, auth) },
  { method: 'DELETE', path: '/api/admin/users/:id', auth: 'superadmin', handler: ({ params, auth }) => adminService.deleteAdminUser(Number(params.id), auth) },
];

function pathToRegex(path) {
  const re = path.replace(/:[^/]+/g, '([^/]+)');
  return new RegExp(`^${re}$`);
}
function extractParams(path, pathname) {
  const keys = [...path.matchAll(/:([^/]+)/g)].map(m => m[1]);
  const re = pathToRegex(path);
  const m = pathname.match(re);
  if (!m) return null;
  const params = {};
  keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); });
  return params;
}

const AUTH_RANK = { readonly: 0, operator: 1, superadmin: 2 };

/** 分发请求，返回 { status, data } 或抛错 */
export async function dispatch(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = url.pathname;
  const query = Object.fromEntries(url.searchParams.entries());

  // 找路由
  let matched = null;
  let params = null;
  for (const r of ROUTES) {
    if (r.method !== req.method) continue;
    const p = extractParams(r.path, pathname);
    if (p) { matched = r; params = p; break; }
  }
  if (!matched) return { status: 404, data: { error: 'not found' } };

  // 鉴权
  let auth = null;
  try {
    if (matched.auth === 'client') auth = requireClient(req);
    else if (matched.auth === 'admin') auth = requireAdmin(req);
    else if (matched.auth === 'operator') auth = requireAdmin(req, 'operator');
    else if (matched.auth === 'superadmin') auth = requireAdmin(req, 'superadmin');
  } catch (e) {
    return { status: e.status || 401, data: { error: e.message } };
  }

  // 请求体（POST/PUT/DELETE）
  let body = {};
  if (['POST', 'PUT', 'DELETE'].includes(req.method)) {
    body = await readJson(req);
  }

  const result = await matched.handler({ params, query, body, auth, req, res });
  return { status: 200, data: result ?? {} };
}

export { AUTH_RANK };
