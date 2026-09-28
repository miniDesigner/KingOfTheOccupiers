/**
 * config.js — 服务端集中配置
 * 全部可被环境变量覆盖，默认值面向本地开发 / Demo 阶段。
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const PORT = parseInt(process.env.TK_PORT || '8891', 10);
export const HOST = process.env.TK_HOST || '127.0.0.1';

// SQLite 单文件库路径（默认 server/tk.db）
export const DB_PATH = process.env.TK_DB_PATH || path.join(__dirname, 'tk.db');

// JWT 签名密钥（生产环境务必用环境变量覆盖）
export const JWT_SECRET = process.env.TK_JWT_SECRET || 'territory-king-dev-secret-change-me-in-prod';

// token 有效期
export const CLIENT_TOKEN_TTL = 1000 * 60 * 60 * 24 * 30; // 客户端 30 天
export const ADMIN_TOKEN_TTL = 1000 * 60 * 60 * 12;      // 后台 12 小时

// 默认超管种子账号（首次启动脚本 init-admin 写入）
export const DEFAULT_ADMIN = {
  username: process.env.TK_ADMIN_USER || 'admin',
  password: process.env.TK_ADMIN_PASS || 'admin123',
  role: 'superadmin',
};

// 存档字段修改白名单的数值上限（与客户端 addCurrency 的 cap 一致）
// 货币上限统一拉到 8 位数 99999999（约 1 亿）—— PM 2026-09-07 提需
// 钻石/星尘的上限提到与金币一致，避免卡成长末期的「钱发不出去」体验
export const CURRENCY_CAPS = { gold: 99999999, diamond: 99999999, stardust: 99999999 };
export const TROPHIES_CAP = 99999;
