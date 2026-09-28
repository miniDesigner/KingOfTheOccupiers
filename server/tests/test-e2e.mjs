/**
 * tests/test-e2e.mjs — 端到端测试（零 npm 依赖，Node 内置 fetch）
 *
 * 覆盖 Phase A~C 全链路：
 *   客户端：guest 登录 → 拉档 → 推档（乐观锁）→ 权威结算
 *   后台：管理员登录 → 玩家检索 → 详情 → 白名单改档 → 封禁 → 统计 → 操作日志
 *
 * 用法：node tests/test-e2e.mjs
 */
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

// ---- 先设环境变量（必须在动态 import 前） ----
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tk-server-e2e-'));
process.env.TK_DB_PATH = path.join(tmpDir, 'test.db');
process.env.TK_JWT_SECRET = 'e2e-test-secret';
process.env.TK_ADMIN_USER = 'admin';
process.env.TK_ADMIN_PASS = 'admin123';

const PORT = 18891;

// 动态 import（环境变量已就绪）
const { startServer } = await import('../app.js');
const { closeDb } = await import('../db/index.js');
const { hashPassword } = await import('../utils/password.js');
const { createAdmin, countAdmins } = await import('../db/dao.js');

let passed = 0, failed = 0;
function ok(cond, name) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.error(`  ✗ ${name}`); }
}

async function api(method, urlPath, { token, body } = {}) {
  const res = await fetch(`http://127.0.0.1:${PORT}${urlPath}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

async function main() {
  console.log('=== 初始化：建库 + 种子超管 ===');
  const server = startServer(PORT);
  if (countAdmins() === 0) {
    createAdmin({ username: 'admin', passwordHash: hashPassword('admin123'), role: 'superadmin' });
  }
  ok(countAdmins() === 1, '默认超管已创建');

  console.log('\n=== Phase A：客户端登录 + 存档读写 ===');
  const uid = 'u_test_' + Date.now().toString(36);
  const r1 = await api('POST', '/api/auth/guest', { body: { uid, nickname: '测试领主' } });
  ok(r1.status === 200 && r1.json.token, 'guest 登录返回 token');
  ok(r1.json.uid === uid, '登录 uid 回显一致');
  const clientToken = r1.json.token;

  const r2 = await api('GET', '/api/profile', { token: clientToken });
  ok(r2.status === 200 && r2.json.version === 0 && r2.json.data === null, '首次拉档为空 (version=0)');

  const saveData = { nickname: '测试领主', gold: 500, diamond: 2000, stardust: 200, trophies: 0, pvpWins: 0, totalGames: 0, highestTrophies: 0, claimedTierRewards: [] };
  const r3 = await api('PUT', '/api/profile', { token: clientToken, body: { version: 0, data: saveData, power: 1234 } });
  ok(r3.status === 200 && r3.json.version === 1, '首存成功 (version=1)');

  const r4 = await api('GET', '/api/profile', { token: clientToken });
  ok(r4.status === 200 && r4.json.data.gold === 500, '拉回存档金币=500');

  // 乐观锁冲突
  const r5 = await api('PUT', '/api/profile', { token: clientToken, body: { version: 0, data: saveData } });
  ok(r5.status === 409, '乐观锁：过期 version 返回 409');

  console.log('\n=== Phase C：服务端权威结算 ===');
  const beforeGold = r4.json.data.gold;
  const r6 = await api('POST', '/api/profile/settle', { token: clientToken, body: { result: 'win', mode: 'ai', difficulty: 'normal' } });
  ok(r6.status === 200 && r6.json.result === 'win', '结算成功');
  ok(r6.json.rewards.trophyDelta > 0, `奖杯增加 ${r6.json.rewards.trophyDelta}`);
  ok(r6.json.profile.gold > beforeGold, `金币增加 ${beforeGold} → ${r6.json.profile.gold}`);
  ok(r6.json.profile.trophies > 0, `奖杯 > 0 (${r6.json.profile.trophies})`);
  ok(r6.json.profile.totalGames === 1 && r6.json.profile.pvpWins === 1, '战绩计数正确');

  console.log('\n=== Phase B：运营后台 ===');
  const a1 = await api('POST', '/api/admin/login', { body: { username: 'admin', password: 'admin123' } });
  ok(a1.status === 200 && a1.json.token, '管理员登录成功');
  const adminToken = a1.json.token;

  const a2 = await api('GET', `/api/admin/players?keyword=${uid}`, { token: adminToken });
  ok(a2.status === 200 && a2.json.total === 1, '按 uid 检索到玩家');

  const a3 = await api('GET', `/api/admin/players/${uid}`, { token: adminToken });
  ok(a3.status === 200 && a3.json.profile.gold > beforeGold, '玩家详情含完整存档');

  const a4 = await api('PUT', `/api/admin/players/${uid}`, { token: adminToken, body: { patch: { gold: 8888, nickname: '改档领主' } } });
  ok(a4.status === 200 && a4.json.changedPaths.includes('gold'), '白名单改金币成功');
  ok(a4.json.after.gold === 8888, '改后金币=8888');

  // 禁止字段
  const a5 = await api('PUT', `/api/admin/players/${uid}`, { token: adminToken, body: { patch: { uid: 'hack' } } });
  ok(a5.status === 400, '禁止修改 uid 被拒绝');

  const a6 = await api('POST', `/api/admin/players/${uid}/ban`, { token: adminToken, body: { status: 'banned', reason: '测试封禁' } });
  ok(a6.status === 200 && a6.json.status === 'banned', '封禁成功');
  // 封禁后客户端结算应被拒
  const a7 = await api('POST', '/api/profile/settle', { token: clientToken, body: { result: 'win', mode: 'ai' } });
  ok(a7.status === 403, '封禁后结算被拒绝');

  const a8 = await api('GET', '/api/admin/stats/overview', { token: adminToken });
  ok(a8.status === 200 && a8.json.totalPlayers >= 1, '统计总览返回玩家数');
  ok(Array.isArray(a8.json.tierDist) && a8.json.totalMatches >= 1, '统计含段位分布与对局数');

  const a9 = await api('GET', '/api/admin/logs', { token: adminToken });
  ok(a9.status === 200 && a9.json.total >= 2, '操作日志有改档+封禁记录');

  console.log('\n=== 结果 ===');
  console.log(`通过 ${passed}，失败 ${failed}`);
  console.log(`测试库路径：${process.env.TK_DB_PATH}`);

  server.close();
  closeDb();
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => {
  console.error('测试异常：', e);
  process.exit(1);
});
