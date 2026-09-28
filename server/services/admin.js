/**
 * services/admin.js — 运营后台业务（登录 / 玩家检索 / 查改 / 封禁 / 统计 / 公告 / 管理员）
 */
import * as dao from '../db/dao.js';
import { hashPassword, verifyPassword } from '../utils/password.js';
import { signToken } from '../utils/token.js';
import { JWT_SECRET, ADMIN_TOKEN_TTL, CURRENCY_CAPS, TROPHIES_CAP } from '../config.js';
import { getTier } from '../shared/meta/LadderSystem.js';

const MAX_UNIT_LEVEL = 20;

export function httpError(status, message, extra = null) {
  const e = new Error(message);
  e.status = status;
  if (extra) e.extra = extra;
  return e;
}

// ==================== 登录 ====================

export function adminLogin(username, password) {
  const admin = dao.getAdminByUsername(username);
  if (!admin || !verifyPassword(password, admin.password_hash)) {
    throw httpError(401, 'invalid username or password');
  }
  const token = signToken({ sub: admin.username, role: admin.role, aid: admin.id, type: 'admin' }, JWT_SECRET, ADMIN_TOKEN_TTL);
  return { token, username: admin.username, role: admin.role };
}

// ==================== 玩家检索 / 详情 ====================

export function searchPlayers(query = {}) {
  return dao.listAccounts(query);
}

export function getPlayerDetail(uid) {
  const account = dao.getAccountById(uid);
  if (!account) throw httpError(404, 'player not found');
  const profile = dao.getProfile(uid);
  return {
    account,
    profile: profile ? JSON.parse(profile.data) : null,
    profileVersion: profile ? profile.version : 0,
  };
}

// ==================== 字段白名单修改 ====================

// 允许后台修改的字段路径 + 校验器
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
// 兵种等级：collectedUnits.<unitId>.level（动态校验，需该兵种已收集）
const UNIT_LEVEL_RE = /^collectedUnits\.(.+)\.level$/;

// 禁止修改的身份/结构字段
const FORBIDDEN_PREFIXES = ['uid', 'openid', 'accountId', 'version', 'deployment', 'collectedUnits.'];

function getAtPath(obj, path) {
  return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}
function setAtPath(obj, path, value) {
  const keys = path.split('.');
  let cur = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    if (cur[keys[i]] == null) cur[keys[i]] = {};
    cur = cur[keys[i]];
  }
  cur[keys[keys.length - 1]] = value;
}

/**
 * 校验并应用字段白名单 patch，返回 { before, after, changed }。
 * 非法字段抛 400；未变化字段跳过。
 */
export function applyWhitelistPatch(profileData, patch) {
  const before = {};
  const after = {};
  const changedPaths = [];

  for (const [rawPath, rawValue] of Object.entries(patch)) {
    const path = rawPath;
    // 禁止字段
    if (FORBIDDEN_PREFIXES.some(p => path.startsWith(p))) {
      throw httpError(400, `field not allowed to modify: ${path}`);
    }

    let value = rawValue;
    let rule = WHITELIST[path];

    // 兵种等级特殊规则
    const unitMatch = !rule && path.match(UNIT_LEVEL_RE);
    if (unitMatch) {
      const unitId = unitMatch[1];
      if (!profileData.collectedUnits || !profileData.collectedUnits[unitId]) {
        throw httpError(400, `unit not collected: ${unitId}`);
      }
      rule = { type: 'int', min: 1, max: MAX_UNIT_LEVEL };
    }

    if (!rule) throw httpError(400, `unknown field: ${path}`);

    // 类型/范围校验
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
    if (oldValue === value) continue; // 未变化跳过

    before[path] = oldValue;
    setAtPath(profileData, path, value);
    after[path] = value;
    changedPaths.push(path);
  }

  // trophies 改动后重算 tier（冗余列在保存时统一 sync）
  return { before, after, changed: changedPaths.length > 0, changedPaths };
}

// ==================== 玩家数据修改（写日志） ====================

export function updatePlayer(uid, patch, admin) {
  const account = dao.getAccountById(uid);
  if (!account) throw httpError(404, 'player not found');

  const profileRow = dao.getProfile(uid);
  const profileData = profileRow ? JSON.parse(profileRow.data) : {};

  const { before, after, changedPaths } = applyWhitelistPatch(profileData, patch || {});
  if (!changedPaths) {
    throw httpError(400, 'no fields changed');
  }

  // 昵称同步到 accounts 表
  let nicknameChanged = false;
  if (changedPaths.includes('nickname')) {
    dao.updateAccountNickname(uid, profileData.nickname);
    nicknameChanged = true;
  }

  // 写回存档（权威，绕过乐观锁）+ 同步冗余列
  const version = dao.writeProfileAuthoritative(uid, profileData);
  dao.syncRedundantColumns(uid, profileData, account.power);

  // 操作日志
  dao.insertLog({
    adminId: admin.aid || null,
    adminName: admin.sub || admin.username || 'unknown',
    action: 'player.update',
    target: uid,
    detail: { before, after, changedPaths },
  });

  return {
    uid,
    version,
    changedPaths,
    before,
    after,
    nicknameChanged,
    account: dao.getAccountById(uid),
  };
}

// ==================== 封禁 / 解封 ====================

export function banPlayer(uid, { status, reason, until }, admin) {
  const account = dao.getAccountById(uid);
  if (!account) throw httpError(404, 'player not found');

  const newStatus = status === 'banned' ? 'banned' : 'active';
  const updated = dao.setAccountStatus(uid, newStatus, reason || null, until || null);

  dao.insertLog({
    adminId: admin.aid || null,
    adminName: admin.sub || admin.username || 'unknown',
    action: newStatus === 'banned' ? 'player.ban' : 'player.unban',
    target: uid,
    detail: { before: account.status, after: newStatus, reason: reason || null, until: until || null },
  });

  return updated;
}

// ==================== 统计 / 日志 / 公告 / 管理员 ====================

export function getStats() { return dao.overviewStats(); }
export function getLogs(query = {}) { return dao.listLogs(query); }

export function createAnnouncement(payload, admin) {
  const a = dao.createAnnouncement(payload);
  dao.insertLog({ adminId: admin.aid || null, adminName: admin.sub || admin.username, action: 'announcement.create', target: String(a.id), detail: { title: a.title } });
  return a;
}
export function listAnnouncements() { return dao.listAnnouncements(); }
export function updateAnnouncement(id, patch, admin) {
  const a = dao.updateAnnouncement(id, patch);
  if (!a) throw httpError(404, 'announcement not found');
  dao.insertLog({ adminId: admin.aid || null, adminName: admin.sub || admin.username, action: 'announcement.update', target: String(id), detail: { title: a.title } });
  return a;
}
export function deleteAnnouncement(id, admin) {
  dao.deleteAnnouncement(id);
  dao.insertLog({ adminId: admin.aid || null, adminName: admin.sub || admin.username, action: 'announcement.delete', target: String(id) });
  return { ok: true };
}

export function listAdmins() { return dao.listAdmins(); }
export function createAdminUser({ username, password, role }, admin) {
  if (!username || !password) throw httpError(400, 'username and password required');
  if (!['superadmin', 'operator', 'readonly'].includes(role)) throw httpError(400, 'invalid role');
  const a = dao.createAdmin({ username, passwordHash: hashPassword(password), role });
  dao.insertLog({ adminId: admin.aid || null, adminName: admin.sub || admin.username, action: 'admin.create', target: username, detail: { role } });
  return { id: a.id, username: a.username, role: a.role, createdAt: a.created_at };
}
export function deleteAdminUser(id, admin) {
  const target = dao.listAdmins().find(a => a.id === id);
  if (!target) throw httpError(404, 'admin not found');
  if (target.username === 'admin') throw httpError(400, 'cannot delete default superadmin');
  dao.deleteAdmin(id);
  dao.insertLog({ adminId: admin.aid || null, adminName: admin.sub || admin.username, action: 'admin.delete', target: target.username });
  return { ok: true };
}

export { getTier };
