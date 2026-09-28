// 测试: 击杀敌人兵种获取金币（击杀赏金机制）
// 覆盖: 完胜赏金 / 等级加成 / 惨胜双方互得 / 两败俱伤双向 / 战争掠夺加成 /
//       players 省略兼容 / 远程无损击杀 / 守方击杀赏金 / MarchSystem 集成 / 配置读取
const noop = () => {};
const canvasStub = { width: 400, height: 700, addEventListener: noop, removeEventListener: noop };
global.document = { getElementById: () => canvasStub, addEventListener: noop, removeEventListener: noop, body: { appendChild: noop }, hidden: false };
global.window = { innerWidth: 400, innerHeight: 700, requestAnimationFrame: () => 0, addEventListener: noop, removeEventListener: noop, AudioContext: class {} };
global.requestAnimationFrame = () => 0;
global.localStorage = { _d: {}, getItem(k) { return this._d[k] ?? null; }, setItem(k, v) { this._d[k] = String(v); }, removeItem(k) { delete this._d[k]; } };
global.wx = {};
global.performance = { now: () => Date.now() };
global.alert = noop;
const { readFileSync: rf, existsSync } = await import('node:fs');
const { fileURLToPath: fURL } = await import('node:url');
const ROOT = fURL(new URL('..', import.meta.url));
global.fetch = async (path) => {
  const file = ROOT + path.replace('../', '');
  if (!existsSync(file)) return { ok: false, status: 404, json: async () => { throw new Error('404 ' + path); } };
  return { ok: true, status: 200, json: async () => JSON.parse(rf(file, 'utf-8')) };
};

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; console.log(`  ✅ ${msg}`); }
  else { failed++; console.log(`  ❌ ${msg}`); }
}

// 初始化配置
const { default: ConfigLoader, syncConfigToStatics, getKillGoldPerWarrior, getKillGoldLevelStep } = await import('../src/config.js');
await ConfigLoader.init();
syncConfigToStatics();

const { CombatSystem } = await import('../src/system/CombatSystem.js');
const { MarchSystem } = await import('../src/system/MarchSystem.js');
const { MarchGroup } = await import('../src/entity/MarchGroup.js');
const { Player } = await import('../src/entity/Player.js');

// ========== 工具 ==========
function makePlayer(id) {
  return new Player(id, `P${id}`, '#3b82f6', false, 'normal');
}

function makeGroup(owner, warriors, level = 1, opts = {}) {
  const sb = {
    attackBonus: 0,
    unitType: '步兵',
    race: 'human',
    combatStyles: ['melee'],
    level,
    unitData: {
      speedCoeff: 1, hpCoeff: 1,
      attackCoeff: opts.attackCoeff ?? 1,
      quality: 1, qualityMultiplier: 1,
      attackRange: opts.attackRange ?? 1,
      unitId: 'test_unit', icon: '', name: '测试兵',
      combatStyles: ['melee'],
    },
  };
  const g = new MarchGroup(owner, warriors, sb, { q: 0, r: 0 });
  g.pixelX = 100; g.pixelY = 100;
  return g;
}

// ============ 0. 配置读取 ============
console.log('=== 测试0: 配置读取 ===');
assert(getKillGoldPerWarrior() === 2, 'killGoldPerWarrior = 2');
assert(getKillGoldLevelStep() === 0.5, 'killGoldLevelStep = 0.5');

// ============ 1. 完胜：击杀方获得全额赏金 ============
console.log('=== 测试1: 完胜赏金 ===');
{
  const pA = makePlayer(1), pB = makePlayer(2);
  const goldA0 = pA.gold, goldB0 = pB.gold;
  const gA = makeGroup(1, 100);  // 战力100
  const gB = makeGroup(2, 10);   // 战力10 → ratio 10 完胜
  CombatSystem.resolveWarriorCombat(gA, gB, [pA, pB]);
  assert(gB.warriors === 0 && gB.state === 'destroyed', 'B全灭');
  assert(gA.isAlive(), 'A存活');
  assert(pA.gold === goldA0 + 20, `A获得赏金20(10兵×2金), 实得${pA.gold - goldA0}`);
  assert(gA.warriors === 90, '完胜方也损失部分战士(100→90)');
  assert(pB.gold === goldB0 + 20, `B击杀A损失的10兵也得20, 实得${pB.gold - goldB0}`);
}

// ============ 2. 等级加成 ============
console.log('=== 测试2: 敌方兵种等级加成 ===');
{
  const pA = makePlayer(1), pB = makePlayer(2);
  const goldA0 = pA.gold;
  const gA = makeGroup(1, 100);
  const gB = makeGroup(2, 10, 3);  // Lv3 → 单价 2+0.5×2=3
  CombatSystem.resolveWarriorCombat(gA, gB, [pA, pB]);
  assert(pA.gold === goldA0 + 30, `Lv3单价3金, 10兵=30, 实得${pA.gold - goldA0}`);
}

// ============ 3. 惨胜：双方互得赏金 ============
console.log('=== 测试3: 惨胜双向赏金 ===');
{
  const pA = makePlayer(1), pB = makePlayer(2);
  const goldA0 = pA.gold, goldB0 = pB.gold;
  const gA = makeGroup(1, 12);  // ratio 1.2 → A惨胜
  const gB = makeGroup(2, 10);
  CombatSystem.resolveWarriorCombat(gA, gB, [pA, pB]);
  assert(gB.warriors === 0, 'B全灭');
  assert(gA.warriors === 3 && gA.isAlive(), 'A剩30%(3兵)');
  assert(pA.gold === goldA0 + 20, `A击杀10兵得20, 实得${pA.gold - goldA0}`);
  assert(pB.gold === goldB0 + 18, `B击杀9兵得18, 实得${pB.gold - goldB0}`);
}

// ============ 4. 两败俱伤：双向全额 ============
console.log('=== 测试4: 两败俱伤双向赏金 ===');
{
  const pA = makePlayer(1), pB = makePlayer(2);
  const goldA0 = pA.gold, goldB0 = pB.gold;
  const gA = makeGroup(1, 10);
  const gB = makeGroup(2, 10);
  CombatSystem.resolveWarriorCombat(gA, gB, [pA, pB]);
  assert(!gA.isAlive() && !gB.isAlive(), '双方全灭');
  assert(pA.gold === goldA0 + 20 && pB.gold === goldB0 + 20, '双方各得击杀10兵赏金20');
}

// ============ 5. 战争掠夺局外加成 ============
console.log('=== 测试5: 战争掠夺加成 ===');
{
  const pA = makePlayer(1), pB = makePlayer(2);
  pA._metaWarPlunder = 0.5;  // +50%
  const goldA0 = pA.gold;
  const gA = makeGroup(1, 100);
  const gB = makeGroup(2, 10);
  CombatSystem.resolveWarriorCombat(gA, gB, [pA, pB]);
  assert(pA.gold === goldA0 + 30, `掠夺+50%: 20×1.5=30, 实得${pA.gold - goldA0}`);
}

// ============ 6. players 省略兼容（不崩溃） ============
console.log('=== 测试6: players省略兼容 ===');
{
  let ok = true;
  try {
    const gA = makeGroup(1, 100);
    const gB = makeGroup(2, 10);
    CombatSystem.resolveWarriorCombat(gA, gB);
    assert(gB.state === 'destroyed', '战斗结算正常');
  } catch (e) { ok = false; console.log('    异常:', e.message); }
  assert(ok, '不传 players 不抛异常');
}

// ============ 7. 远程无损击杀 ============
console.log('=== 测试7: 远程vs近战 ===');
{
  const pA = makePlayer(1), pB = makePlayer(2);
  const goldA0 = pA.gold, goldB0 = pB.gold;
  const gA = makeGroup(1, 10, 1, { attackRange: 2 });  // 远程
  const gB = makeGroup(2, 10);                          // 近战
  CombatSystem.resolveWarriorCombat(gA, gB, [pA, pB]);
  assert(gB.state === 'destroyed' && gA.warriors === 10, '远程无损击溃近战');
  assert(pA.gold === goldA0 + 20 && pB.gold === goldB0, '仅击杀方得赏金');
}

// ============ 8. 守方击杀赏金（攻城失败全灭） ============
console.log('=== 测试8: 守方击杀赏金 ===');
{
  const pA = makePlayer(1), pB = makePlayer(2);
  const goldB0 = pB.gold;
  const gA = makeGroup(1, 10, 2);  // Lv2攻方
  const tile = {
    q: 0, r: 0, owner: 2,
    building: {
      getDefense: () => 999, isHeadquarters: () => false,
      takeDamage: noop, defenseBonus: 0, currentHp: 100,
      variantColor: '#fff', color: '#fff',
    },
  };
  const hexMapStub = { size: 30 };
  CombatSystem.resolveBuildingCombat(gA, tile, [pA, pB], hexMapStub);
  assert(gA.warriors === 0 && gA.state === 'destroyed', '近战攻城失败全灭');
  assert(pB.gold === goldB0 + 25, `守方击杀10兵Lv2(单价2.5)得25, 实得${pB.gold - goldB0}`);
}

// ============ 9. MarchSystem 集成：fighting_warrior 透传 players ============
console.log('=== 测试9: MarchSystem 集成 ===');
{
  const pA = makePlayer(1), pB = makePlayer(2);
  const goldA0 = pA.gold;
  const gA = makeGroup(1, 100);
  const gB = makeGroup(2, 10);
  gA.state = 'fighting_warrior'; gA.fightTarget = gB; gA.combatTimer = 5;
  gB.state = 'fighting_warrior'; gB.fightTarget = gA; gB.combatTimer = 5;
  MarchSystem.update(10, [gA, gB], { size: 30 }, CombatSystem, [pA, pB]);
  assert(gB.state === 'destroyed', '战斗已结算');
  assert(pA.gold === goldA0 + 20, `经MarchSystem获得赏金20, 实得${pA.gold - goldA0}`);
}

// ============ 10. 同归扣除复活（复活战士不计击杀） ============
console.log('=== 测试10: 复活战士不计击杀 ===');
{
  const pA = makePlayer(1), pB = makePlayer(2);
  const goldA0 = pA.gold, goldB0 = pB.gold;
  const gA = makeGroup(1, 10);
  const gB = makeGroup(2, 10);
  // 给B复活能力：复活2人
  gB.synergyBonuses = { reviveChance: 1.0, reviveCount: 2 };
  CombatSystem.resolveWarriorCombat(gA, gB, [pA, pB]);
  assert(gB.warriors === 2 && gB.isAlive(), 'B复活2人存活');
  // A实际击杀 = 10 - 2 = 8 → 赏金16
  assert(pA.gold === goldA0 + 16, `复活扣除后击杀8兵得16, 实得${pA.gold - goldA0}`);
  // B击杀A 10人 → 20
  assert(pB.gold === goldB0 + 20, 'B击杀A全额赏金');
}

console.log(`\n========== 结果: ${passed} 通过, ${failed} 失败 ==========`);
process.exit(failed > 0 ? 1 : 0);
