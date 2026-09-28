/**
 * 云函数 adminRouter — 后台管理路由（单函数复合，用 event.action 分发）
 *
 * 入参：{ action, token, ...params }
 * action 列表（对应 server/routes/index.js 的 admin 路由）：
 *   me / players / playerDetail / updatePlayer / banPlayer
 *   stats / logs / listAnnouncements / createAnnouncement / updateAnnouncement / deleteAnnouncement
 *   listAdmins / createAdmin / deleteAdmin
 *
 * 鉴权：token 来自 adminLogin 签发的 JWT；部分写操作要求 operator/superadmin 角色。
 */
const cloud = require('wx-server-sdk');
const dao = require('./shared/db.js');
const { verifyToken } = require('./shared/token.js');
const { hashPassword } = require('./shared/password.js');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const JWT_SECRET = process.env.TK_JWT_SECRET || 'territory-king-dev-secret-change-me-in-prod';
const CURRENCY_CAPS = { gold: 99999999, diamond: 99999999, stardust: 99999999 };
const TROPHIES_CAP = 99999;
const MAX_UNIT_LEVEL = 20;

const AUTH_RANK = { readonly: 0, operator: 1, superadmin: 2 };

function httpError(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}

// 字段白名单（与 server/services/admin.js WHITELIST 一致）
const WHITELIST = {
  gold:          { type: 'int', min: 0, max: CURRENCY_CAPS.gold },
  diamond:       { type: 'int', min: 0, max: CURRENCY_CAPS.diamond },
  stardust:      { type: 'int', min: 0, max: CURRENCY_CAPS.stardust },
  trophies:      { type: 'int', min: 0, max: TROPHIES_CAP, recalcTier: true },
  nickname:      { type: 'string', min: 1, max: 12, trim: true },
  tutorialStep:  { type: 'int', min: -1, max: 4 },
  'battlePass.level': { type: 'int', min: 0, max: 9999 },
  'battlePass.exp':   { type: 'int', min: 0, max: 999999 },
};
const UNIT_LEVEL_RE = /^collectedUnits\.(.+)\.level$/;
const FORBIDDEN_PREFIXES = ['uid', 'openid', 'accountId', 'version', 'deployment', 'collectedUnits.'];

function getAtPath(obj, path) { return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj); }
function setAtPath(obj, path, value) {
  const keys = path.split('.');
  let cur = obj;
  for (let i = 0; i < keys.length - 1; i++) { if (cur[keys[i]] == null) cur[keys[i]] = {}; cur = cur[keys[i]]; }
  cur[keys[keys.length - 1]] = value;
}

function applyWhitelistPatch(profileData, patch) {
  const before = {}, after = {};
  const changedPaths = [];
  for (const [path, rawValue] of Object.entries(patch || {})) {
    if (FORBIDDEN_PREFIXES.some(p => path.startsWith(p))) throw httpError(400, `field not allowed to modify: ${path}`);
    let value = rawValue;
    let rule = WHITELIST[path];
    const unitMatch = !rule && path.match(UNIT_LEVEL_RE);
    if (unitMatch) {
      const unitId = unitMatch[1];
      if (!profileData.collectedUnits || !profileData.collectedUnits[unitId]) throw httpError(400, `unit not collected: ${unitId}`);
      rule = { type: 'int', min: 1, max: MAX_UNIT_LEVEL };
    }
    if (!rule) throw httpError(400, `unknown field: ${path}`);
    if (rule.type === 'int') {
      value = Number(value);
      if (!Number.isInteger(value)) throw httpError(400, `field must be integer: ${path}`);
      if (value < rule.min || value > rule.max) throw httpError(400, `field out of range [${rule.min}, ${rule.max}]: ${path}`);
    } else if (rule.type === 'string') {
      value = String(value);
      if (rule.trim) value = value.trim();
      if (value.length < rule.min || value.length > rule.max) throw httpError(400, `string length out of range: ${path}`);
    }
    const oldValue = getAtPath(profileData, path);
    if (oldValue === value) continue;
    before[path] = oldValue;
    setAtPath(profileData, path, value);
    after[path] = value;
    changedPaths.push(path);
  }
  return { before, after, changed: changedPaths.length > 0, changedPaths };
}

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

// ============ 字段命名映射（云数据库驼峰 → 前端下划线） ============
// 前端 server/admin/app.js 渲染层沿用本地 SQLite 的下划线字段命名，
// 而云数据库 accounts/operationLogs 是驼峰。这里在返回前统一转成下划线，
// 让前端渲染层零改动。
function mapAccount(a) {
  if (!a) return a;
  return {
    // 前端「uid」列 + onclick 传参都走主键：云版主键是 accountId（本地 SQLite 是 uid）
    uid: a.accountId || a.uid,
    accountId: a.accountId,
    openid: a.openid,
    nickname: a.nickname,
    status: a.status,
    tier: a.tier,
    trophies: a.trophies,
    power: a.power,
    gold: a.gold,
    diamond: a.diamond,
    stardust: a.stardust,
    created_at: a.createdAt,
    last_login_at: a.lastLoginAt,
    ban_reason: a.banReason,
    ban_until: a.banUntil,
    pvp_wins: a.pvpWins,
    total_games: a.totalGames,
  };
}
function mapLog(l) {
  if (!l) return l;
  return {
    created_at: l.createdAt,
    admin_name: l.adminName,
    action: l.action,
    target: l.target,
    detail: l.detail,
  };
}
function mapAdmin(a) {
  if (!a) return a;
  return { id: a.id, username: a.username, role: a.role, created_at: a.createdAt };
}

/** 懒种子默认超管：admin_users 集合为空时自动建 admin/admin123（superadmin） */
let _seedChecked = false;
async function ensureDefaultAdmin() {
  if (_seedChecked) return;
  _seedChecked = true;
  try {
    const count = await dao.countAdmins();
    if (count === 0) {
      await dao.createAdmin({ username: 'admin', passwordHash: hashPassword('admin123'), role: 'superadmin' });
      console.log('[adminRouter] seeded default superadmin: admin/admin123');
    }
  } catch (e) {
    // 种子失败不阻塞主流程（可能集合未建），登录时再暴露
    console.warn('[adminRouter] ensureDefaultAdmin failed:', e && e.message || e);
  }
}

async function route(event) {
  const { action, token, ...params } = event || {};

  // 懒种子默认超管（首次部署后台能直接登录）
  await ensureDefaultAdmin();

  // 鉴权（除 login 外都需要 token）
  let auth = null;
  if (token) auth = verifyToken(token, JWT_SECRET);
  if (!auth) return { ok: false, error: 'unauthorized', statusCode: 401 };

  const requireRank = (rank) => {
    if (AUTH_RANK[auth.role] < AUTH_RANK[rank]) throw httpError(403, 'insufficient permission');
  };

  try {
    switch (action) {
      case 'me':
        return { ok: true, username: auth.sub, role: auth.role };

      case 'players': {
        requireRank('readonly');
        const res = await dao.listAccounts(params);
        return { ok: true, total: res.total, page: res.page, pageSize: res.pageSize, rows: (res.rows || []).map(mapAccount) };
      }

      case 'playerDetail': {
        requireRank('readonly');
        const account = await dao.getAccountById(params.id);
        if (!account) throw httpError(404, 'player not found');
        const profile = await dao.getProfile(params.id);
        return { ok: true, account: mapAccount(account), profile: profile ? profile.data : null, profileVersion: profile ? profile.version : 0 };
      }

      case 'updatePlayer': {
        requireRank('operator');
        const uid = params.id;
        const account = await dao.getAccountById(uid);
        if (!account) throw httpError(404, 'player not found');
        const profile = await dao.getProfile(uid);
        const profileData = profile ? profile.data : {};
        const { before, after, changedPaths } = applyWhitelistPatch(profileData, params.patch || {});
        if (!changedPaths.length) throw httpError(400, 'no fields changed');
        let nicknameChanged = false;
        if (changedPaths.includes('nickname')) { await dao.updateAccountNickname(uid, profileData.nickname); nicknameChanged = true; }
        const version = await dao.writeProfileAuthoritative(uid, profileData);
        await dao.syncRedundantColumns(uid, profileData, account.power);
        await dao.insertLog({ adminId: auth.aid || null, adminName: auth.sub, action: 'player.update', target: uid, detail: { before, after, changedPaths } });
        return { ok: true, uid, version, changedPaths, before, after, nicknameChanged };
      }

      case 'banPlayer': {
        requireRank('operator');
        const uid = params.id;
        const account = await dao.getAccountById(uid);
        if (!account) throw httpError(404, 'player not found');
        const newStatus = params.status === 'banned' ? 'banned' : 'active';
        const updated = await dao.setAccountStatus(uid, newStatus, params.reason || null, params.until || null);
        await dao.insertLog({ adminId: auth.aid || null, adminName: auth.sub, action: newStatus === 'banned' ? 'player.ban' : 'player.unban', target: uid, detail: { before: account.status, after: newStatus } });
        return { ok: true, ...updated };
      }

      case 'stats':
        requireRank('readonly');
        return { ok: true, ...(await dao.overviewStats()) };

      case 'logs': {
        requireRank('readonly');
        const res = await dao.listLogs(params);
        return { ok: true, total: res.total, page: res.page, pageSize: res.pageSize, rows: (res.rows || []).map(mapLog) };
      }

      case 'listAnnouncements':
        requireRank('readonly');
        return { ok: true, rows: await dao.listAnnouncements() };

      case 'createAnnouncement':
        requireRank('superadmin');
        return { ok: true, announcement: await dao.createAnnouncement(params) };

      case 'updateAnnouncement':
        requireRank('superadmin');
        return { ok: true, announcement: await dao.updateAnnouncement(params.id, params.patch || {}) };

      case 'deleteAnnouncement':
        requireRank('superadmin');
        await dao.deleteAnnouncement(params.id);
        return { ok: true };

      case 'listAdmins':
        requireRank('superadmin');
        return { ok: true, rows: (await dao.listAdmins()).map(mapAdmin) };

      case 'createAdmin':
        requireRank('superadmin');
        if (!params.username || !params.password) throw httpError(400, 'username and password required');
        if (!['superadmin', 'operator', 'readonly'].includes(params.role)) throw httpError(400, 'invalid role');
        const a = await dao.createAdmin({ username: params.username, passwordHash: hashPassword(params.password), role: params.role });
        await dao.insertLog({ adminId: auth.aid || null, adminName: auth.sub, action: 'admin.create', target: params.username, detail: { role: params.role } });
        return { ok: true, admin: a };

      case 'deleteAdmin':
        requireRank('superadmin');
        const admins = await dao.listAdmins();
        const target = admins.find(x => x.id === params.id);
        if (!target) throw httpError(404, 'admin not found');
        if (target.username === 'admin') throw httpError(400, 'cannot delete default superadmin');
        await dao.deleteAdmin(params.id);
        await dao.insertLog({ adminId: auth.aid || null, adminName: auth.sub, action: 'admin.delete', target: target.username });
        return { ok: true };

      default:
        return { ok: false, error: 'unknown action: ' + action, statusCode: 400 };
    }
  } catch (e) {
    return { ok: false, error: e.message, statusCode: e.status || 500 };
  }
}

exports.main = async (event) => {
  // HTTP 触发分支
  if (isHttpEvent(event)) {
    if (event.httpMethod === 'OPTIONS') return httpResponse(204, {});
    const body = parseHttpBody(event);
    const result = await route(body);
    const code = result.ok ? 200 : (result.statusCode || 500);
    return httpResponse(code, result);
  }
  // wx.cloud.callFunction 分支
  return route(event || {});
};
