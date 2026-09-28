/**
 * tests/test-cloud-settle-core.mjs — 云函数结算核心单元测试（零依赖，不连云）
 *
 * 验证 cloudfunctions/shared/settle-core.js 与 server/services/profile.js 的结算逻辑一致：
 *   - 战斗奖励（胜负货币）
 *   - 战绩记录（totalGames/pvpWins/连击）
 *   - 天梯结算（ai 难度档 / pvp Elo）
 *
 * 用法：node tests/test-cloud-settle-core.mjs
 */
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// 云函数 shared 在 territory-king-developer/cloudfunctions/shared/，从 server/tests/ 往上两级
const require = createRequire(path.join(__dirname, '../../cloudfunctions/shared/settle-core.js'));

const { attachCurrency, settle, grantBattleRewards, recordBattleResult } = require('../../cloudfunctions/shared/settle-core.js');
const Ladder = require('../../cloudfunctions/shared/LadderSystem.js');

let passed = 0, failed = 0;
function ok(cond, name) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.error(`  ✗ ${name}`); }
}

function freshProfile() {
  return attachCurrency({ trophies: 0, gold: 0, diamond: 0, stardust: 0 });
}

console.log('=== 1. 战斗奖励（胜负货币） ===');
{
  const p = freshProfile();
  const r = grantBattleRewards(p, true);
  ok(r.gold >= 80 && r.gold < 120, `胜利金币在 80~120 区间（实际 ${r.gold}）`);
  ok(r.stardust >= 3 && r.stardust <= 5, `胜利星尘 3~5（实际 ${r.stardust}）`);
  ok(p.gold === r.gold && p.stardust === r.stardust, '货币已挂到 profile');

  const p2 = freshProfile();
  const r2 = grantBattleRewards(p2, false);
  ok(r2.gold >= 15 && r2.gold < 30, `失败金币 15~30（实际 ${r2.gold}）`);
  ok(r2.stardust === 1, '失败星尘恒为 1');
}

console.log('\n=== 2. 战绩记录 ===');
{
  const p = freshProfile();
  recordBattleResult(p, true);
  recordBattleResult(p, true);
  recordBattleResult(p, false);
  ok(p.totalGames === 3, 'totalGames=3');
  ok(p.pvpWins === 2, 'pvpWins=2');
  ok(p.pvpWinStreak === 0, '失败后连击归零');
  ok(p.totalWins === 2, 'totalWins=2');
  ok(p.pvpLosses === 1, 'pvpLosses=1');
}

console.log('\n=== 3. AI 天梯结算（难度档） ===');
{
  const p = freshProfile();
  const r = settle(p, { result: 'win', mode: 'ai', difficulty: 'normal' });
  ok(r.result === 'win', 'settle 返回 win');
  ok(r.rewards.trophyDelta > 0, `胜利奖杯 delta>0（实际 ${r.rewards.trophyDelta}）`);
  ok(p.trophies === r.rewards.trophies, '奖杯已写入 profile');
  ok(r.rewards.tier === 'bronze', '初始青铜段位');
  ok(r.rewards.tierUp === false, '未升段');
}

console.log('\n=== 4. PvP Elo 结算 ===');
{
  const p = freshProfile();
  p.trophies = 1000;
  const r = settle(p, { result: 'win', mode: 'snapshot', oppTrophies: 800 });
  ok(r.result === 'win', 'pvp 返回 win');
  // 我方(1000) > 对手(800)，赢弱手应得少分，但至少 ELO_MIN_FLOW=10
  ok(r.rewards.trophyDelta >= 10, `Elo 胜利 delta>=10（实际 ${r.rewards.trophyDelta}）`);
  ok(r.mode === 'snapshot', 'mode 回显 snapshot');
}

console.log('\n=== 5. 失败结算（保底段位） ===');
{
  const p = freshProfile();
  p.trophies = 50; // 青铜(0~200)，失败会掉杯但保底 >= 段位下限
  const r = settle(p, { result: 'lose', mode: 'ai', difficulty: 'normal' });
  ok(r.result === 'lose', '返回 lose');
  ok(p.trophies >= 0, `奖杯不为负（实际 ${p.trophies}）`);
  ok(r.rewards.trophyDelta <= 0, '失败 delta<=0');
}

console.log('\n=== 6. 货币上限（8 位封顶） ===');
{
  const p = freshProfile();
  p.gold = 99999998;
  p.addCurrency('gold', 100);
  ok(p.gold === 99999999, '金币封顶 99999999');
}

console.log('\n=== 7. LadderSystem 一致性（getTier 阈值） ===');
{
  const cases = [[0,'bronze'],[200,'silver'],[400,'gold'],[700,'platinum'],[1000,'diamond'],[1300,'master'],[1600,'grandmaster'],[1900,'king']];
  for (const [t, key] of cases) {
    ok(Ladder.getTier(t).key === key, `奖杯 ${t} → ${key}`);
  }
}

console.log(`\n结果：${passed} 通过 / ${failed} 失败`);
if (failed > 0) process.exit(1);
