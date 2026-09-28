/**
 * cloudfunctions/shared/db.js — 云开发数据库访问层（wx-server-sdk）
 *
 * 职责：把 server/db/dao.js 的 SQLite CRUD 平移到云数据库集合。
 * 集合设计（与 server-backend-design.md §3.1 对应）：
 *   - accounts      玩家账号（openid 唯一索引，冗余检索列）
 *   - profiles      存档 blob（account_id 唯一，乐观锁 version）
 *   - match_records 对局记录
 *
 * 注：admin_users / operation_logs / announcements 三个运营侧表**不迁云**（后台留本地 SQLite）。
 *
 * 云数据库差异：
 *   - 主键：SQLite 自增 id → 云数据库自动 `_id`（string），业务主键用 account_id / openid 唯一索引
 *   - 无事务跨文档原子性（乐观锁用 version 字段 + 条件更新近似模拟）
 */

const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;

const COLLECTIONS = {
  accounts: 'accounts',
  profiles: 'profiles',
  matchRecords: 'match_records',
  adminUsers: 'admin_users',
  operationLogs: 'operation_logs',
  announcements: 'announcements',
};

// ==================== 冗余列 ====================
// 与 server/db/dao.js computeRedundantColumns 完全一致
function computeRedundantColumns(data, powerOverride) {
  const d = data || {};
  const trophies = Number(d.trophies) || 0;
  const tier = require('./LadderSystem.js').getTier(trophies).key;
  const cols = {
    gold: Number(d.gold) || 0,
    diamond: Number(d.diamond) || 0,
    stardust: Number(d.stardust) || 0,
    trophies,
    tier,
    pvpWins: Number(d.pvpWins) || 0,
    totalGames: Number(d.totalGames) || 0,
  };
  if (typeof powerOverride === 'number' && powerOverride >= 0) cols.power = powerOverride;
  return cols;
}

// ==================== accounts ====================

/** 按 openid 查账号 */
async function getAccountByOpenid(openid) {
  if (!openid) return null;
  const res = await db.collection(COLLECTIONS.accounts).where({ openid }).limit(1).get();
  return res.data[0] || null;
}

/** 按 account_id 查账号 */
async function getAccountById(id) {
  const res = await db.collection(COLLECTIONS.accounts).where({ accountId: id }).limit(1).get();
  return res.data[0] || null;
}

/** 创建账号（openid 唯一，accountId 业务主键） */
async function createAccount({ accountId, uid, openid, nickname }) {
  const now = Date.now();
  const doc = {
    accountId,
    uid,
    openid,
    nickname,
    createdAt: now,
    lastLoginAt: now,
    status: 'active',
    banReason: null,
    banUntil: null,
    gold: 0, diamond: 0, stardust: 0, trophies: 0, tier: 'bronze', power: 0,
    pvpWins: 0, totalGames: 0, updatedAt: now,
  };
  await db.collection(COLLECTIONS.accounts).add({ data: doc });
  return doc;
}

/** 更新 last_login_at */
async function touchLogin(accountId) {
  await db.collection(COLLECTIONS.accounts).where({ accountId }).update({
    data: { lastLoginAt: Date.now() },
  });
}

/** 同步冗余列 */
async function syncRedundantColumns(accountId, data, powerOverride) {
  const cols = computeRedundantColumns(data, powerOverride);
  await db.collection(COLLECTIONS.accounts).where({ accountId }).update({
    data: { ...cols, updatedAt: Date.now() },
  });
}

// ==================== profiles ====================

/** 读存档（返回 { version, data } 或 null） */
async function getProfile(accountId) {
  const res = await db.collection(COLLECTIONS.profiles).where({ accountId }).limit(1).get();
  const row = res.data[0];
  if (!row) return null;
  return { version: row.version, data: row.data, updatedAt: row.updatedAt };
}

/**
 * 写存档（乐观锁）
 * @param {string} accountId
 * @param {object} data
 * @param {number} expectedVersion 客户端持有版本；-1 强制覆盖（首存）
 * @returns {{ok:boolean, version:number, conflict?:boolean}}
 */
async function upsertProfile(accountId, data, expectedVersion = -1) {
  const existing = await getProfile(accountId);
  if (existing) {
    if (expectedVersion >= 0 && existing.version !== expectedVersion) {
      return { ok: false, conflict: true, version: existing.version };
    }
    const nextVersion = existing.version + 1;
    await db.collection(COLLECTIONS.profiles).where({ accountId }).update({
      data: { data, version: nextVersion, updatedAt: Date.now() },
    });
    return { ok: true, version: nextVersion };
  }
  const nextVersion = 1;
  await db.collection(COLLECTIONS.profiles).add({
    data: { accountId, data, version: nextVersion, updatedAt: Date.now() },
  });
  return { ok: true, version: nextVersion };
}

/** 权威写回（绕过乐观锁） */
async function writeProfileAuthoritative(accountId, data) {
  const existing = await getProfile(accountId);
  const nextVersion = existing ? existing.version + 1 : 1;
  const col = db.collection(COLLECTIONS.profiles);
  if (existing) {
    await col.where({ accountId }).update({ data: { data, version: nextVersion, updatedAt: Date.now() } });
  } else {
    await col.add({ data: { accountId, data, version: nextVersion, updatedAt: Date.now() } });
  }
  return nextVersion;
}

// ==================== match_records ====================

async function insertMatch({ accountId, mode, result, opp = null, trophiesDelta = 0 }) {
  await db.collection(COLLECTIONS.matchRecords).add({
    data: { accountId, mode, result, opp, trophiesDelta, createdAt: Date.now() },
  });
}

// ==================== admin_users ====================

async function getAdminByUsername(username) {
  const res = await db.collection(COLLECTIONS.adminUsers).where({ username }).limit(1).get();
  return res.data[0] || null;
}

async function listAdmins() {
  const res = await db.collection(COLLECTIONS.adminUsers).orderBy('createdAt', 'asc').get();
  return res.data.map(a => ({ id: a._id, username: a.username, role: a.role, createdAt: a.createdAt }));
}

async function createAdmin({ username, passwordHash, role = 'operator' }) {
  const data = { username, passwordHash, role, createdAt: Date.now() };
  const r = await db.collection(COLLECTIONS.adminUsers).add({ data });
  return { id: r._id, username, role, createdAt: data.createdAt };
}

async function deleteAdmin(id) {
  await db.collection(COLLECTIONS.adminUsers).doc(id).remove();
}

async function countAdmins() {
  const res = await db.collection(COLLECTIONS.adminUsers).count();
  return res.total;
}

// ==================== operation_logs ====================

async function insertLog({ adminId = null, adminName = null, action, target = null, detail = null }) {
  await db.collection(COLLECTIONS.operationLogs).add({
    data: { adminId, adminName, action, target, detail, createdAt: Date.now() },
  });
}

async function listLogs({ adminName = '', action = '', page = 1, pageSize = 50 } = {}) {
  const where = {};
  if (adminName) where.adminName = adminName;
  if (action) where.action = action;
  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const size = Math.min(500, Math.max(1, parseInt(pageSize, 10) || 50));
  const skip = (pageNum - 1) * size;
  const totalRes = await db.collection(COLLECTIONS.operationLogs).where(where).count();
  const res = await db.collection(COLLECTIONS.operationLogs).where(where)
    .orderBy('createdAt', 'desc').skip(skip).limit(size).get();
  return { total: totalRes.total, page: pageNum, pageSize: size, rows: res.data };
}

// ==================== announcements ====================

async function createAnnouncement({ type = 'notice', title, content = '', enabled = 1, startAt = null, endAt = null }) {
  const data = { type, title, content, enabled: enabled ? 1 : 0, startAt, endAt, createdAt: Date.now() };
  const r = await db.collection(COLLECTIONS.announcements).add({ data });
  return { id: r._id, ...data };
}

async function listAnnouncements() {
  const res = await db.collection(COLLECTIONS.announcements).orderBy('createdAt', 'desc').get();
  return res.data.map(a => ({ id: a._id, type: a.type, title: a.title, content: a.content, enabled: a.enabled, startAt: a.startAt, endAt: a.endAt, createdAt: a.createdAt }));
}

async function updateAnnouncement(id, patch) {
  try {
    await db.collection(COLLECTIONS.announcements).doc(id).update({ data: patch });
    const res = await db.collection(COLLECTIONS.announcements).doc(id).get();
    const a = res.data;
    return { id, type: a.type, title: a.title, content: a.content, enabled: a.enabled, startAt: a.startAt, endAt: a.endAt, createdAt: a.createdAt };
  } catch (e) {
    return null;
  }
}

async function deleteAnnouncement(id) {
  await db.collection(COLLECTIONS.announcements).doc(id).remove();
}

// ==================== 玩家检索 / 封禁 / 昵称 ====================

/** 玩家检索（分页 + 筛选 + 排序，云数据库版） */
async function listAccounts({ keyword = '', tier = '', status = '', minTrophies = null, maxTrophies = null, sort = 'createdAt', order = 'desc', page = 1, pageSize = 50 } = {}) {
  const where = {};
  if (keyword) {
    // 云数据库不支持 LIKE，用正则近似（昵称/uid/openid 前缀匹配）
    const kw = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    where.nickname = db.RegExp({ regexp: kw, options: 'i' });
  }
  if (tier) {
    const tiers = tier.split(',').map(s => s.trim()).filter(Boolean);
    if (tiers.length) where.tier = _.in(tiers);
  }
  if (status) where.status = status;
  if (minTrophies !== null && minTrophies !== '') where.trophies = _.gte(Number(minTrophies));
  if (maxTrophies !== null && maxTrophies !== '') where.trophies = where.trophies ? _.and(where.trophies, _.lte(Number(maxTrophies))) : _.lte(Number(maxTrophies));

  const sortable = { createdAt: 1, lastLoginAt: 1, trophies: 1, gold: 1, power: 1, nickname: 1, tier: 1, updatedAt: 1 };
  const sortCol = sortable[sort] ? sort : 'createdAt';
  const orderDir = order === 'asc' ? 'asc' : 'desc';

  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const size = Math.min(500, Math.max(1, parseInt(pageSize, 10) || 50));
  const skip = (pageNum - 1) * size;

  const totalRes = await db.collection(COLLECTIONS.accounts).where(where).count();
  const res = await db.collection(COLLECTIONS.accounts).where(where)
    .orderBy(sortCol, orderDir).skip(skip).limit(size).get();
  return { total: totalRes.total, page: pageNum, pageSize: size, rows: res.data };
}

async function setAccountStatus(accountId, status, reason = null, until = null) {
  await db.collection(COLLECTIONS.accounts).where({ accountId }).update({
    data: { status, banReason: reason, banUntil: until, updatedAt: Date.now() },
  });
  return await getAccountById(accountId);
}

async function updateAccountNickname(accountId, nickname) {
  await db.collection(COLLECTIONS.accounts).where({ accountId }).update({
    data: { nickname, updatedAt: Date.now() },
  });
}

// ==================== 统计 ====================

async function overviewStats() {
  const totalPlayers = (await db.collection(COLLECTIONS.accounts).count()).total;
  const banned = (await db.collection(COLLECTIONS.accounts).where({ status: 'banned' }).count()).total;
  const totalMatches = (await db.collection(COLLECTIONS.matchRecords).count()).total;

  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
  const dau = (await db.collection(COLLECTIONS.accounts).where({ lastLoginAt: _.gte(todayStart.getTime()) }).count()).total;

  // 段位分布（云数据库无 GROUP BY，聚合层遍历）
  const tierKeys = ['bronze', 'silver', 'gold', 'platinum', 'diamond', 'master', 'grandmaster', 'king'];
  const tierDist = [];
  for (const key of tierKeys) {
    const c = (await db.collection(COLLECTIONS.accounts).where({ tier: key }).count()).total;
    if (c > 0) tierDist.push({ tier: key, c });
  }
  tierDist.sort((a, b) => b.c - a.c);

  return { totalPlayers, banned, totalMatches, dau, tierDist, totalGold: null, totalDiamond: null, totalStardust: null };
}

module.exports = {
  db, _, COLLECTIONS,
  getAccountByOpenid, getAccountById, createAccount, touchLogin, syncRedundantColumns,
  getProfile, upsertProfile, writeProfileAuthoritative,
  insertMatch,
  // admin
  getAdminByUsername, listAdmins, createAdmin, deleteAdmin, countAdmins,
  insertLog, listLogs,
  createAnnouncement, listAnnouncements, updateAnnouncement, deleteAnnouncement,
  listAccounts, setAccountStatus, updateAccountNickname,
  overviewStats,
};
