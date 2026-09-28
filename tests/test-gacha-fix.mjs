/**
 * 十连保底修复验证测试
 * 运行: node test-gacha-fix.mjs
 *
 * 验证点:
 * 1. 十连保底触发时，第10抽强制Q4+（前9抽全Q1时）
 * 2. 效果恰好发放10次（无双重发放）——星尘/招募进度增量与结果显示完全一致
 * 3. 保底计数器正确重置
 */
import { readFileSync } from 'fs';
import DeploymentSystem from '../src/meta/DeploymentSystem.js';
import ConfigLoader from '../src/data/ConfigLoader.js';
import ProfileManager from '../src/meta/ProfileManager.js';

// --- 加载真实配置并打补丁 ---
const deployables = JSON.parse(
  readFileSync(new URL('../config/deployables.json', import.meta.url), 'utf-8')
);
ConfigLoader.getSafe = (key) => (key === 'deployables' ? deployables : null);
ConfigLoader.get = (key) => (key === 'deployables' ? deployables : null);

// --- 初始化存档 ---
const profile = ProfileManager.load();
profile.gold = 100000;
profile.stardust = 0;
profile.gachaPityCount = 0;
// 清空收集状态便于追踪
profile.collectedUnits = {};
// 模拟初始拥有：剑士(Q1) — 让前9抽全部重复
profile.collectedUnits.swordsman = { level: 1, recruitCount: 0 };

const Q4_UNITS = Object.keys(deployables.units).filter(
  (k) => !k.startsWith('_') && deployables.units[k].quality === 4
);

// --- 用确定性随机数强制触发保底场景 ---
// Math.random()=0.05 → 品质判定落入Q1(40%)；单位选取pool[0]
const realRandom = Math.random;
Math.random = () => 0.05;

let pass = 0, fail = 0;
function check(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  [PASS] ${name}`); }
  else { fail++; console.log(`  [FAIL] ${name} ${detail}`); }
}

console.log('=== 测试1: 十连保底触发（前9抽Q1重复，第10抽强制Q4+） ===');
const sdBefore = profile.stardust;
const recruitBefore = profile.collectedUnits.swordsman.recruitCount;
const ownedBefore = new Set(Object.keys(profile.collectedUnits));

const res = DeploymentSystem.gachaMultiDraw();

check('抽卡成功', res.success === true);
check('返回10个结果', res.results.length === 10, `实际${res.results.length}`);
check('前9抽均为Q1', res.results.slice(0, 9).every((r) => r.quality === 1));
check('第10抽为Q4+（保底触发）', res.results[9].quality >= 4, `实际Q${res.results[9].quality}`);

console.log('=== 测试2: 无双重发放（效果恰好10次） ===');
// 期望增量：9次Q1重复(5星尘+2招募each) + 1次第10抽(Q4新单位解锁，0星尘)
// 旧bug代码会额外发放原第10抽的Q1重复效果(+5星尘+2招募)
const sdDelta = profile.stardust - sdBefore;
const recruitDelta = profile.collectedUnits.swordsman.recruitCount - recruitBefore;
check('星尘增量 = 9×5 = 45（非50）', sdDelta === 45, `实际${sdDelta}`);
check('剑士招募增量 = 9×2 = 18（非20）', recruitDelta === 18, `实际${recruitDelta}`);

const newUnits = Object.keys(profile.collectedUnits).filter(
  (u) => !ownedBefore.has(u)
);
check('新解锁单位数 = 1（第10抽Q4单位，非2）', newUnits.length === 1, `实际${newUnits.length}: ${newUnits.join(',')}`);
check('新解锁单位 = 第10抽显示的单位', newUnits[0] === res.results[9].unitId,
  `存档:${newUnits[0]} vs 显示:${res.results[9].unitId}`);
check('新解锁单位品质为Q4', deployables.units[newUnits[0]]?.quality === 4);

console.log('=== 测试3: 保底计数器状态 ===');
check('保底计数已重置为0', profile.gachaPityCount === 0, `实际${profile.gachaPityCount}`);

console.log('=== 测试4: 正常随机十连 ×1000（统计性验证） ===');
Math.random = realRandom;
let guaranteeViolations = 0;
let effectMismatches = 0;
for (let t = 0; t < 1000; t++) {
  profile.gold = 100000;
  profile.stardust = 0; // 重置避免触发99,999上限截断（正常游戏有持续消耗）
  profile.gachaPityCount = 0;
  const snapshotSd = profile.stardust;
  const snapshotOwned = new Set(Object.keys(profile.collectedUnits));
  const snapshotRecruit = {};
  for (const [u, d] of Object.entries(profile.collectedUnits)) snapshotRecruit[u] = d.recruitCount || 0;

  const r = DeploymentSystem.gachaMultiDraw();
  if (!r.success || !r.results.some((x) => x.quality >= 4)) guaranteeViolations++;

  // 核对星尘增量与结果一致
  let expectedSd = 0;
  for (const item of r.results) {
    if (!item.isNew && item.duplicateReward) expectedSd += item.duplicateReward.stardust;
  }
  if (profile.stardust - snapshotSd !== expectedSd) effectMismatches++;

  // 核对新单位
  const nowOwned = new Set(Object.keys(profile.collectedUnits));
  for (const item of r.results) {
    if (item.isNew && !nowOwned.has(item.unitId)) effectMismatches++;
  }
}
check('1000次十连全部满足Q4+保底', guaranteeViolations === 0, `违例${guaranteeViolations}次`);
check('1000次十连星尘/解锁账目全部一致', effectMismatches === 0, `不一致${effectMismatches}次`);

console.log(`\n结果: ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
