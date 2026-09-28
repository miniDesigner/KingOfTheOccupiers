/**
 * db/dao.js — 数据访问层（屏蔽 SQLite 细节，后续可平移 MySQL/PG）
 * 所有 SQL 增删改查集中于此；冗余列唯一入口 syncRedundantColumns()。
 */
import { getDb } from './index.js';
import { getTier } from '../shared/meta/LadderSystem.js';

// 预编译语句缓存（按 SQL 文本）
const _cache = new Map();
function stmt(sql) {
  let s = _cache.get(sql);
  if (!s) { s = getDb().prepare(sql); _cache.set(sql, s); }
  return s;
}

// ==================== 冗余列 ====================

/**
 * 从存档 JSON（PlayerProfile.serialize() 输出）解析出 accounts 冗余检索列。
 * tier 由 getTier(trophies) 权威计算，不信任客户端传值。
 * power 客户端在 PUT/settle 时显式传（服务端无 PowerSystem 依赖），缺省保留原值语义。
 */
export function computeRedundantColumns(data, powerOverride) {
  const d = data || {};
  const trophies = Number(d.trophies) || 0;
  return {
    gold: Number(d.gold) || 0,
    diamond: Number(d.diamond) || 0,
    stardust: Number(d.stardust) || 0,
    trophies,
    tier: getTier(trophies).key,
    pvp_wins: Number(d.pvpWins) || 0,
    total_games: Number(d.totalGames) || 0,
    ...(typeof powerOverride === 'number' && powerOverride >= 0 ? { power: powerOverride } : {}),
  };
}

export function syncRedundantColumns(accountId, data, powerOverride) {
  const cols = computeRedundantColumns(data, powerOverride);
  stmt(`
    UPDATE accounts SET
      gold=?, diamond=?, stardust=?, trophies=?, tier=?, pvp_wins=?, total_games=?,
      updated_at=?
    WHERE id=?
  `).run(
    cols.gold, cols.diamond, cols.stardust, cols.trophies, cols.tier,
    cols.pvp_wins, cols.total_games, Date.now(), accountId
  );
  if (typeof cols.power === 'number') {
    stmt(`UPDATE accounts SET power=? WHERE id=?`).run(cols.power, accountId);
  }
}

// ==================== accounts ====================

export function getAccountByUid(uid) {
  return stmt(`SELECT * FROM accounts WHERE uid=?`).get(uid) || null;
}
export function getAccountByOpenid(openid) {
  if (!openid) return null;
  return stmt(`SELECT * FROM accounts WHERE openid=?`).get(openid) || null;
}
export function getAccountById(id) {
  return stmt(`SELECT * FROM accounts WHERE id=?`).get(id) || null;
}

export function createAccount({ id, uid, openid = null, nickname }) {
  const now = Date.now();
  stmt(`
    INSERT INTO accounts (id, uid, openid, nickname, created_at, last_login_at, status)
    VALUES (?, ?, ?, ?, ?, ?, 'active')
  `).run(id, uid, openid, nickname, now, now);
  return getAccountById(id);
}

export function touchLogin(id) {
  stmt(`UPDATE accounts SET last_login_at=? WHERE id=?`).run(Date.now(), id);
}

export function setAccountStatus(id, status, reason = null, until = null) {
  stmt(`UPDATE accounts SET status=?, ban_reason=?, ban_until=? WHERE id=?`)
    .run(status, reason, until, id);
  return getAccountById(id);
}

export function updateAccountNickname(id, nickname) {
  stmt(`UPDATE accounts SET nickname=?, updated_at=? WHERE id=?`).run(nickname, Date.now(), id);
}

/**
 * 玩家检索（分页 + 筛选 + 排序）
 */
export function listAccounts({
  keyword = '', tier = '', status = '',
  minTrophies = null, maxTrophies = null,
  sort = 'created_at', order = 'desc', page = 1, pageSize = 50,
} = {}) {
  const where = [];
  const params = [];
  if (keyword) {
    where.push(`(nickname LIKE ? OR uid = ? OR openid = ?)`);
    params.push(`%${keyword}%`, keyword, keyword);
  }
  if (tier) {
    const tiers = tier.split(',').map(s => s.trim()).filter(Boolean);
    if (tiers.length) {
      where.push(`tier IN (${tiers.map(() => '?').join(',')})`);
      params.push(...tiers);
    }
  }
  if (status) { where.push(`status = ?`); params.push(status); }
  if (minTrophies !== null && minTrophies !== '') { where.push(`trophies >= ?`); params.push(Number(minTrophies)); }
  if (maxTrophies !== null && maxTrophies !== '') { where.push(`trophies <= ?`); params.push(Number(maxTrophies)); }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  // 排序字段白名单，防注入
  const sortable = { created_at: 1, last_login_at: 1, trophies: 1, gold: 1, power: 1, nickname: 1, tier: 1, updated_at: 1 };
  const sortCol = sortable[sort] ? sort : 'created_at';
  const orderDir = order === 'asc' ? 'ASC' : 'DESC';

  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const size = Math.min(500, Math.max(1, parseInt(pageSize, 10) || 50));
  const offset = (pageNum - 1) * size;

  const total = stmt(`SELECT COUNT(*) c FROM accounts ${whereSql}`).get(...params).c;
  const rows = stmt(`SELECT * FROM accounts ${whereSql} ORDER BY ${sortCol} ${orderDir} LIMIT ? OFFSET ?`)
    .all(...params, size, offset);

  return { total, page: pageNum, pageSize: size, rows };
}

// ==================== profiles ====================

export function getProfile(accountId) {
  return stmt(`SELECT * FROM profiles WHERE account_id=?`).get(accountId) || null;
}

/**
 * 写入存档（乐观锁）
 * @param {string} accountId
 * @param {object|string} data  存档对象或 JSON 字符串
 * @param {number} expectedVersion 客户端持有的版本号；-1 表示强制覆盖（首次/管理员）
 * @returns {{ok:boolean, version:number, conflict?:boolean}}
 */
export function upsertProfile(accountId, data, expectedVersion = -1) {
  const dataStr = typeof data === 'string' ? data : JSON.stringify(data);
  const now = Date.now();
  const existing = getProfile(accountId);

  if (existing) {
    // 乐观锁：客户端版本号不匹配则拒绝
    if (expectedVersion >= 0 && existing.version !== expectedVersion) {
      return { ok: false, conflict: true, version: existing.version };
    }
    const nextVersion = existing.version + 1;
    stmt(`UPDATE profiles SET data=?, version=?, updated_at=? WHERE account_id=?`)
      .run(dataStr, nextVersion, now, accountId);
    return { ok: true, version: nextVersion };
  }

  const nextVersion = 1;
  stmt(`INSERT INTO profiles (account_id, data, version, updated_at) VALUES (?, ?, ?, ?)`)
    .run(accountId, dataStr, nextVersion, now);
  return { ok: true, version: nextVersion };
}

/** 覆盖存档版本号（供权威结算内部使用，绕过乐观锁） */
export function writeProfileAuthoritative(accountId, data) {
  const dataStr = typeof data === 'string' ? data : JSON.stringify(data);
  const now = Date.now();
  const existing = getProfile(accountId);
  const nextVersion = existing ? existing.version + 1 : 1;
  stmt(`INSERT INTO profiles (account_id, data, version, updated_at) VALUES (?, ?, ?, ?)
        ON CONFLICT(account_id) DO UPDATE SET data=excluded.data, version=excluded.version, updated_at=excluded.updated_at`)
    .run(accountId, dataStr, nextVersion, now);
  return nextVersion;
}

// ==================== admin_users ====================

export function getAdminByUsername(username) {
  return stmt(`SELECT * FROM admin_users WHERE username=?`).get(username) || null;
}
export function listAdmins() {
  return stmt(`SELECT id, username, role, created_at FROM admin_users ORDER BY id`).all();
}
export function createAdmin({ username, passwordHash, role = 'operator' }) {
  stmt(`INSERT INTO admin_users (username, password_hash, role, created_at) VALUES (?, ?, ?, ?)`)
    .run(username, passwordHash, role, Date.now());
  return getAdminByUsername(username);
}
export function deleteAdmin(id) {
  stmt(`DELETE FROM admin_users WHERE id=?`).run(id);
}
export function countAdmins() {
  return stmt(`SELECT COUNT(*) c FROM admin_users`).get().c;
}

// ==================== operation_logs ====================

export function insertLog({ adminId = null, adminName = null, action, target = null, detail = null }) {
  stmt(`INSERT INTO operation_logs (admin_id, admin_name, action, target, detail, created_at) VALUES (?, ?, ?, ?, ?, ?)`)
    .run(adminId, adminName, action, target, detail ? JSON.stringify(detail) : null, Date.now());
}
export function listLogs({ adminName = '', action = '', page = 1, pageSize = 50 } = {}) {
  const where = [];
  const params = [];
  if (adminName) { where.push(`admin_name = ?`); params.push(adminName); }
  if (action) { where.push(`action = ?`); params.push(action); }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const size = Math.min(500, Math.max(1, parseInt(pageSize, 10) || 50));
  const offset = (pageNum - 1) * size;
  const total = stmt(`SELECT COUNT(*) c FROM operation_logs ${whereSql}`).get(...params).c;
  const rows = stmt(`SELECT * FROM operation_logs ${whereSql} ORDER BY id DESC LIMIT ? OFFSET ?`).all(...params, size, offset);
  return { total, page: pageNum, pageSize: size, rows };
}

// ==================== announcements ====================

export function createAnnouncement({ type = 'notice', title, content = '', enabled = 1, startAt = null, endAt = null }) {
  const r = stmt(`INSERT INTO announcements (type, title, content, enabled, start_at, end_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(type, title, content, enabled ? 1 : 0, startAt, endAt, Date.now());
  return stmt(`SELECT * FROM announcements WHERE id=?`).get(r.lastInsertRowid);
}
export function listAnnouncements() {
  return stmt(`SELECT * FROM announcements ORDER BY id DESC`).all();
}
export function updateAnnouncement(id, patch) {
  const existing = stmt(`SELECT * FROM announcements WHERE id=?`).get(id);
  if (!existing) return null;
  const merged = { ...existing, ...patch };
  stmt(`UPDATE announcements SET type=?, title=?, content=?, enabled=?, start_at=?, end_at=? WHERE id=?`)
    .run(merged.type, merged.title, merged.content, merged.enabled ? 1 : 0, merged.start_at, merged.end_at, id);
  return stmt(`SELECT * FROM announcements WHERE id=?`).get(id);
}
export function deleteAnnouncement(id) {
  stmt(`DELETE FROM announcements WHERE id=?`).run(id);
}

// ==================== match_records ====================

export function insertMatch({ accountId, mode, result, opp = null, trophiesDelta = 0 }) {
  stmt(`INSERT INTO match_records (account_id, mode, result, opp, trophies_delta, created_at) VALUES (?, ?, ?, ?, ?, ?)`)
    .run(accountId, mode, result, opp, trophiesDelta, Date.now());
}
export function countMatches() {
  return stmt(`SELECT COUNT(*) c FROM match_records`).get().c;
}
export function countMatchesByMode() {
  return stmt(`SELECT mode, COUNT(*) c, SUM(CASE WHEN result='win' THEN 1 ELSE 0 END) wins FROM match_records GROUP BY mode`).all();
}

// ==================== 统计 ====================

export function overviewStats() {
  const totalPlayers = stmt(`SELECT COUNT(*) c FROM accounts`).get().c;
  const banned = stmt(`SELECT COUNT(*) c FROM accounts WHERE status='banned'`).get().c;
  const totalMatches = countMatches();
  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
  const dau = stmt(`SELECT COUNT(*) c FROM accounts WHERE last_login_at >= ?`).get(todayStart.getTime()).c;

  const tierDist = stmt(`SELECT tier, COUNT(*) c FROM accounts GROUP BY tier ORDER BY c DESC`).all();
  const totalGold = stmt(`SELECT COALESCE(SUM(gold),0) s FROM accounts`).get().s;
  const totalDiamond = stmt(`SELECT COALESCE(SUM(diamond),0) s FROM accounts`).get().s;
  const totalStardust = stmt(`SELECT COALESCE(SUM(stardust),0) s FROM accounts`).get().s;

  return {
    totalPlayers, banned, totalMatches, dau,
    tierDist, totalGold, totalDiamond, totalStardust,
  };
}
