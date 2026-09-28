/**
 * db/index.js — SQLite 数据库初始化（node:sqlite，零依赖）
 * 建表 SQL 与 server-backend-design.md §3.1 完全一致。
 */
import { DatabaseSync } from 'node:sqlite';
import { DB_PATH } from '../config.js';

let db = null;

const SCHEMA_SQL = `
-- 玩家账号表：身份 + 高频检索冗余列
CREATE TABLE IF NOT EXISTS accounts (
  id             TEXT PRIMARY KEY,
  uid            TEXT NOT NULL UNIQUE,
  openid         TEXT UNIQUE,
  nickname       TEXT NOT NULL,
  created_at     INTEGER NOT NULL,
  last_login_at  INTEGER,
  status         TEXT NOT NULL DEFAULT 'active',
  ban_reason     TEXT,
  ban_until      INTEGER,

  gold           INTEGER NOT NULL DEFAULT 0,
  diamond        INTEGER NOT NULL DEFAULT 0,
  stardust       INTEGER NOT NULL DEFAULT 0,
  trophies       INTEGER NOT NULL DEFAULT 0,
  tier           TEXT    NOT NULL DEFAULT 'bronze',
  power          INTEGER NOT NULL DEFAULT 0,
  pvp_wins       INTEGER NOT NULL DEFAULT 0,
  total_games    INTEGER NOT NULL DEFAULT 0,
  updated_at     INTEGER
);

-- 存档表：完整存档 JSON blob（与 PlayerProfile.serialize() 一一对应）
CREATE TABLE IF NOT EXISTS profiles (
  account_id  TEXT PRIMARY KEY,
  data        TEXT NOT NULL,
  version     INTEGER NOT NULL DEFAULT 0,
  updated_at  INTEGER NOT NULL
);

-- 运营后台管理员
CREATE TABLE IF NOT EXISTS admin_users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'operator',
  created_at    INTEGER NOT NULL
);

-- 操作日志（改前→改后快照）
CREATE TABLE IF NOT EXISTS operation_logs (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  admin_id   INTEGER,
  admin_name TEXT,
  action     TEXT NOT NULL,
  target     TEXT,
  detail     TEXT,
  created_at INTEGER NOT NULL
);

-- 公告 / 运营开关
CREATE TABLE IF NOT EXISTS announcements (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  type       TEXT NOT NULL DEFAULT 'notice',
  title      TEXT NOT NULL,
  content    TEXT,
  enabled    INTEGER NOT NULL DEFAULT 1,
  start_at   INTEGER,
  end_at     INTEGER,
  created_at INTEGER NOT NULL
);

-- 对局记录
CREATE TABLE IF NOT EXISTS match_records (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id     TEXT NOT NULL,
  mode           TEXT NOT NULL,
  result         TEXT NOT NULL,
  opp            TEXT,
  trophies_delta INTEGER NOT NULL DEFAULT 0,
  created_at     INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_accounts_tier   ON accounts(tier);
CREATE INDEX IF NOT EXISTS idx_accounts_troph  ON accounts(trophies);
CREATE INDEX IF NOT EXISTS idx_accounts_nick   ON accounts(nickname);
CREATE INDEX IF NOT EXISTS idx_logs_admin      ON operation_logs(admin_id);
CREATE INDEX IF NOT EXISTS idx_logs_time       ON operation_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_match_account   ON match_records(account_id);
`;

/** 初始化数据库（幂等）：建库 + 建表，返回单例 */
export function initDb() {
  if (db) return db;
  db = new DatabaseSync(DB_PATH);
  db.exec(SCHEMA_SQL);
  return db;
}

/** 获取数据库单例（未初始化抛错，防止误用） */
export function getDb() {
  if (!db) throw new Error('[db] database not initialized. Call initDb() first.');
  return db;
}

/** 关闭数据库（测试用） */
export function closeDb() {
  if (db) { db.close(); db = null; }
}
