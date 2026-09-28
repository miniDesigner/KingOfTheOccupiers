/**
 * scripts/init-admin.js — 初始化默认超管账号（幂等）
 * 用法：node scripts/init-admin.js
 */
import { initDb, closeDb } from '../db/index.js';
import { countAdmins, createAdmin, getAdminByUsername } from '../db/dao.js';
import { hashPassword } from '../utils/password.js';
import { DEFAULT_ADMIN } from '../config.js';

initDb();

const existing = getAdminByUsername(DEFAULT_ADMIN.username);
if (existing) {
  console.log(`[init-admin] 超管已存在：${DEFAULT_ADMIN.username} (role=${existing.role})，跳过。`);
} else if (countAdmins() === 0) {
  createAdmin({ username: DEFAULT_ADMIN.username, passwordHash: hashPassword(DEFAULT_ADMIN.password), role: DEFAULT_ADMIN.role });
  console.log(`[init-admin] 已创建默认超管：`);
  console.log(`   用户名: ${DEFAULT_ADMIN.username}`);
  console.log(`   密码:   ${DEFAULT_ADMIN.password}`);
  console.log(`   角色:   ${DEFAULT_ADMIN.role}`);
  console.log('   ⚠️ 生产环境请立即修改密码（或设置 TK_ADMIN_USER / TK_ADMIN_PASS 环境变量后重建）。');
} else {
  console.log(`[init-admin] 已有其他管理员，未创建默认超管（用户名 ${DEFAULT_ADMIN.username} 未占用时才会创建）。`);
  if (!existing) {
    createAdmin({ username: DEFAULT_ADMIN.username, passwordHash: hashPassword(DEFAULT_ADMIN.password), role: DEFAULT_ADMIN.role });
    console.log(`[init-admin] 已补充创建默认超管 ${DEFAULT_ADMIN.username}。`);
  }
}

closeDb();
