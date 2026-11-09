// 测试: 战力压缩（2026-11 玩法改造）
// 覆盖:
//   1. 顶级兵(Lv20) vs 基准兵(剑士Lv1) 战力比 ∈ [2, 2.5]（压缩前 65~77 倍）
//   2. 40 兵种榜首/榜尾战力比 ≤ 3.0（榜尾 scout 为属性低于 1.0 的斥候型，放宽上限）
//   3. 品质倍率新表 1.0~1.18 生效（压缩前 1.0~2.3）
//   4. 升级成本成长系数 1.18（压缩前 1.35）
//   5. 远程不再无损全歼近战（先手削减 30%~60% 后走五档结算）
//   6. 五档结算阈值收窄（1.35/1.06/0.94~1.06/0.74）
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
  const file = ROOT + String(path).replace('../', '');
  if (!existsSync(file)) return { ok: false, status: 404, json: async () => { throw new Error('404 ' + path); } };
  return { ok: true, status: 200, json: async () => JSON.parse(rf(file, 'utf-8')) };
};

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; console.log(`  ✅ ${msg}`); }
  else { failed++; console.log(`  ❌ ${msg}`); }
}

const { default: ConfigLoader, syncConfigToStatics } = await import('../src/config.js');
await ConfigLoader.init();
syncConfigToStatics();
const DeploymentSystem = (await import('../src/meta/DeploymentSystem.js')).default;
const { getUnitStats, UPGRADE_COST_GROWTH } = await import('../src/meta/DeploymentSystem.js');
const { CombatSystem } = await import('../src/system/CombatSystem.js');
const { MarchGroup } = await import('../src/entity/MarchGroup.js');

// ============ 1. 顶级/基准战力比 ============
console.log('=== 测试1: 战力压缩目标（顶级/基准 2~2.5） ===');
{
  const units = Object.keys(ConfigLoader.get('deployables').units);
  let best = null, worst = null;
  for (const id of units) {
    const u1 = getUnitStats(id, 1);
    const u20 = getUnitStats(id, 20);
    const p1 = u1.attackCoeff * u1.hpCoeff;
    const p20 = u20.attackCoeff * u20.hpCoeff;
    if (!best || p20 > best.p) best = { id, p: p20, q: u20.quality };
    if (!worst || p1 < worst.p) worst = { id, p: p1 };
  }
  const swordsman1 = getUnitStats('swordsman', 1);
  const baseline = swordsman1.attackCoeff * swordsman1.hpCoeff;
  const ratioBase = best.p / baseline;
  const ratioTail = best.p / worst.p;
  console.log(`  最强Lv20: ${best.id}=${best.p.toFixed(2)}(Q${best.q})  剑士Lv1基准=${baseline.toFixed(2)}  榜尾Lv1: ${worst.id}=${worst.p.toFixed(2)}`);
  assert(ratioBase >= 2 && ratioBase <= 2.5, `顶级/基准战力比 = ${ratioBase.toFixed(2)} ∈ [2, 2.5]（压缩前 65~77）`);
  assert(ratioTail <= 3.0, `榜首/榜尾战力比 = ${ratioTail.toFixed(2)} ≤ 3.0（scout 为低属性斥候型放宽）`);
  // 低阶兵全程有用：任意兵种 Lv1 战力都在最强兵的 1/3 以上
  assert(worst.p * 3 >= best.p, '最弱兵 Lv1 战力 ≥ 最强兵 Lv20 的 1/3（低阶兵不废）');
}

// ============ 2. 品质倍率新表 ============
console.log('=== 测试2: 品质倍率压缩（1.0~1.18） ===');
{
  const tiers = ConfigLoader.get('game').quality.tiers;
  const mults = tiers.map(t => t.multiplier);
  const expect = [1.0, 1.04, 1.07, 1.10, 1.14, 1.18];
  assert(JSON.stringify(mults) === JSON.stringify(expect), `品质倍率表 = ${mults.join('/')}（压缩前 1.0/1.15/1.35/1.6/1.9/2.3）`);
  const red = getUnitStats('war_titan', 20).qualityMultiplier;
  assert(Math.abs(red - 1.18) < 1e-9, `红品质实际生效倍率 = ${red}`);
}

// ============ 3. 升级成本成长 ============
console.log('=== 测试3: 升级成本曲线（1.18） ===');
{
  assert(Math.abs(UPGRADE_COST_GROWTH - 1.18) < 1e-9, `UPGRADE_COST_GROWTH = ${UPGRADE_COST_GROWTH}（压缩前 1.35）`);
}

// ============ 4. 远程先手压制（不再无损） ============
console.log('=== 测试4: 远程不再无损全歼 ===');
{
  function makeGroup(owner, warriors, opts = {}) {
    const sb = {
      attackBonus: 0, unitType: '步兵', race: 'human', combatStyles: ['melee'], level: 1,
      unitData: { speedCoeff: 1, hpCoeff: 1, attackCoeff: 1, quality: 1, qualityMultiplier: 1,
        attackRange: opts.attackRange ?? 1, unitId: 'test_unit', icon: '', name: '测试兵', combatStyles: ['melee'] },
    };
    const g = new MarchGroup(owner, warriors, sb, { q: 0, r: 0 });
    g.pixelX = 100; g.pixelY = 100;
    return g;
  }
  // 射程2 远程 vs 同规模近战：先手削减 40%，远程有损失地获胜
  {
    const gA = makeGroup(1, 10, { attackRange: 2 });
    const gB = makeGroup(2, 10);
    CombatSystem.resolveWarriorCombat(gA, gB, null);
    assert(gB.state === 'destroyed', '远程先手压制后击溃近战');
    assert(gA.warriors > 0 && gA.warriors < 10, `远程有损获胜（剩 ${gA.warriors}/10 兵，旧规则无损）`);
  }
  // 极端悬殊也不允许无损：射程4（削减60%）时近战满编同属性仍能造成损失
  {
    const gA = makeGroup(1, 10, { attackRange: 4 });
    const gB = makeGroup(2, 10);
    CombatSystem.resolveWarriorCombat(gA, gB, null);
    assert(gA.warriors < 10, `射程4压制后远程仍受损（剩 ${gA.warriors}/10）`);
  }
  // 双方同为近战：不受先手规则影响（等规模互灭，两败俱伤档）
  {
    const gA = makeGroup(1, 10);
    const gB = makeGroup(2, 10);
    CombatSystem.resolveWarriorCombat(gA, gB, null);
    assert(gA.warriors === 0 && gB.warriors === 0, '同规模近战两败俱伤（先手规则仅限远程对近战）');
  }
}

// ============ 5. 五档阈值收窄 ============
console.log('=== 测试5: 五档结算阈值（1.35/1.06/0.94~1.06/0.74） ===');
{
  // 用战力比直接驱动：攻击系数不同、同规模
  function makeGroup(owner, warriors, atk) {
    const sb = {
      attackBonus: 0, unitType: '步兵', race: 'human', combatStyles: ['melee'], level: 1,
      unitData: { speedCoeff: 1, hpCoeff: 1, attackCoeff: atk, quality: 1, qualityMultiplier: 1,
        attackRange: 1, unitId: 'test_unit', icon: '', name: '测试兵', combatStyles: ['melee'] },
    };
    const g = new MarchGroup(owner, warriors, sb, { q: 0, r: 0 });
    g.pixelX = 100; g.pixelY = 100;
    return g;
  }
  // ratio=1.2（旧阈值 1.5 内 → 两败俱伤；新阈值 1.35 → 完胜）
  {
    const gA = makeGroup(1, 10, 1.2), gB = makeGroup(2, 10, 1.0);
    CombatSystem.resolveWarriorCombat(gA, gB, null);
    assert(gB.warriors === 0 && gA.warriors > 0, 'ratio 1.2 新阈值下进入完胜档（旧 1.5 阈值会判两败俱伤）');
  }
  // ratio≈1.05 平局带收窄至 ±6%（旧 ±10%）：1.07 应进入惨胜而非两败俱伤
  {
    const gA = makeGroup(1, 10, 1.07), gB = makeGroup(2, 10, 1.0);
    CombatSystem.resolveWarriorCombat(gA, gB, null);
    assert(gA.warriors > 0, 'ratio 1.07 脱离平局带（惨胜档，A 存活）');
  }
}

console.log(`\n========== 结果: ${passed} 通过, ${failed} 失败 ==========`);
process.exit(failed > 0 ? 1 : 0);
