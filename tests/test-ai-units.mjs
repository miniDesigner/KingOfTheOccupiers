/**
 * AI 兵种一致化测试
 * 验证：
 *  1. generateAiDeployment 产出与玩家 bundle 同构（units key 1~4 + 完整兵种字段）
 *  2. 难度分层：easy/normal/hard/nightmare 品质上限逐档放宽
 *     （easy 永不出现 Q3+，nightmare 必能出现 Q5+）
 *  3. 等级基准：难度越高等级越高（养成模拟，无 skillTier/powerRatio 修正）
 *  4. fixedUnits 固定配置：传入 4 个兵种 ID 时跳过随机
 *  5. 接线：buildBattleConfig AI 一致化输出（无作弊字段）；Game.initBattle 生成 AI bundle
 */
const noop = () => {};
global.document = {
  getElementById: () => null,
  addEventListener: noop, removeEventListener: noop,
  createElement: () => ({ getContext: () => null, style: {} }),
  body: { appendChild: noop, removeChild: noop },
  hidden: false,
};
global.window = {
  innerWidth: 400, innerHeight: 700, devicePixelRatio: 1,
  addEventListener: noop, removeEventListener: noop,
  requestAnimationFrame: () => 0, cancelAnimationFrame: noop,
};
global.localStorage = { _d: {}, getItem(k) { return this._d[k] ?? null; }, setItem(k, v) { this._d[k] = String(v); }, removeItem(k) { delete this._d[k]; } };
Object.defineProperty(global, 'navigator', { value: { userAgent: 'node-test' }, configurable: true });
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

const PowerSystem = (await import('../src/meta/PowerSystem.js')).default;
const DeploymentSystem = (await import('../src/meta/DeploymentSystem.js')).default;
const { buildBattleConfig, BOARD_LAYOUTS } = await import('../src/data/levels.js');

// 玩家 bundle 字段基准（同构校验用）
const playerBundle = DeploymentSystem.generateBundle();
const PLAYER_STAT_FIELDS = playerBundle.units[1] ? Object.keys(playerBundle.units[1]).sort() : [];

// 难度 → 期望品质上限（与 PowerSystem 内部常量一致的断言表）
const MAX_Q = { easy: 2, normal: 3, hard: 5, nightmare: 6 };

console.log('=== 测试1: bundle 同构与字段完整性 ===');
{
  const b = PowerSystem.generateAiDeployment('normal', null, () => 0.5);
  const keys = Object.keys(b.units || {}).map(Number).sort((a, b) => a - b);
  assert(JSON.stringify(keys) === JSON.stringify([1, 2, 3, 4]), `units key = [1,2,3,4] (实际 ${JSON.stringify(keys)})`);
  assert(Array.isArray(b.synergies) && b.synergies.length === 0, 'synergies 为空数组（AI 不配羁绊卡）');
  assert(typeof b.buildingUpgrades === 'object' && Object.keys(b.buildingUpgrades).length === 0, 'buildingUpgrades 为空对象（AI 建筑与未强化玩家一致）');

  const s = b.units[1];
  assert(s && typeof s.name === 'string' && s.name.length > 0, `units[1] 有兵种名 (${s?.name})`);
  assert(typeof s.attackCoeff === 'number' && s.attackCoeff > 0, `attackCoeff=${s?.attackCoeff} 有效`);
  assert(typeof s.hpCoeff === 'number' && s.hpCoeff > 0, `hpCoeff=${s?.hpCoeff} 有效`);
  assert(typeof s.speedCoeff === 'number' && s.speedCoeff > 0, `speedCoeff=${s?.speedCoeff} 有效`);
  assert(typeof s.productionSpeed === 'number' && s.productionSpeed > 0, `productionSpeed=${s?.productionSpeed} 有效（不再固定 1.0）`);
  assert(typeof s.quality === 'number' && s.quality >= 1 && s.quality <= 6, `quality=${s?.quality} 在 1~6`);
  assert(Array.isArray(s.skills), 'skills 数组存在（技能解锁轴与玩家一致）');
  assert(Array.isArray(s.combatStyles) && s.combatStyles.length > 0, `combatStyles=${JSON.stringify(s?.combatStyles)} 非空`);
  assert(s.attackRange >= 1, `attackRange=${s?.attackRange} ≥ 1`);

  if (PLAYER_STAT_FIELDS.length > 0) {
    const aiFields = Object.keys(b.units[1]).sort();
    const missing = PLAYER_STAT_FIELDS.filter(f => !aiFields.includes(f));
    const extra = aiFields.filter(f => !PLAYER_STAT_FIELDS.includes(f));
    assert(missing.length === 0, `AI stats 字段覆盖玩家字段（缺: ${missing.join(',') || '无'}）`);
    assert(extra.length === 0, `AI stats 无多余字段（多: ${extra.join(',') || '无'}）`);
  } else {
    console.log('  ⚠️ 玩家 bundle 为空，跳过字段集对比（存档环境问题）');
  }
}

console.log('=== 测试2: 难度品质分层（采样 200 次） ===');
{
  for (const diff of ['easy', 'normal', 'hard', 'nightmare']) {
    let sawHighQ = 0, maxSeen = 0;
    for (let i = 0; i < 200; i++) {
      const b = PowerSystem.generateAiDeployment(diff, null, Math.random);
      for (const u of Object.values(b.units)) {
        maxSeen = Math.max(maxSeen, u.quality);
        if (u.quality > MAX_Q[diff]) { sawHighQ++; }
      }
    }
    assert(sawHighQ === 0, `${diff}: 200 次采样从未出现品质 > ${MAX_Q[diff]}（实际最高 ${maxSeen}）`);
  }
  // nightmare 池必须包含 Q5+ 兵种（否则难度分层失效）
  let sawQ5 = 0;
  for (let i = 0; i < 200; i++) {
    const b = PowerSystem.generateAiDeployment('nightmare', null, Math.random);
    for (const u of Object.values(b.units)) if (u.quality >= 5) sawQ5++;
  }
  assert(sawQ5 > 0, `nightmare 能出现 Q5+ 兵种（${sawQ5} 次）`);
}

console.log('=== 测试3: 等级基准（养成模拟，无 skillTier/powerRatio 修正） ===');
{
  const easy = PowerSystem.generateAiDeployment('easy', null, () => 0.5);
  const normal = PowerSystem.generateAiDeployment('normal', null, () => 0.5);
  const hard = PowerSystem.generateAiDeployment('hard', null, () => 0.5);
  const nightmare = PowerSystem.generateAiDeployment('nightmare', null, () => 0.5);
  const avgLvl = (b) => Object.values(b.units).reduce((a, u) => a + u.level, 0) / Object.values(b.units).length;

  const lv = { easy: avgLvl(easy), normal: avgLvl(normal), hard: avgLvl(hard), nightmare: avgLvl(nightmare) };
  assert(lv.normal > lv.easy, `normal(${lv.normal.toFixed(1)}) > easy(${lv.easy.toFixed(1)}) 等级基准递增`);
  assert(lv.hard > lv.normal, `hard(${lv.hard.toFixed(1)}) > normal(${lv.normal.toFixed(1)})`);
  assert(lv.nightmare > lv.hard, `nightmare(${lv.nightmare.toFixed(1)}) > hard(${lv.hard.toFixed(1)})`);

  // 等级钳制：nightmare（基准 14 + 槽位浮动）不超过 MAX_UNIT_LEVEL(20)
  const cap = PowerSystem.generateAiDeployment('nightmare', null, () => 0.5);
  const maxLvl = Math.max(...Object.values(cap.units).map(u => u.level));
  assert(maxLvl <= 20, `等级钳制 ≤ 20（实际 ${maxLvl}）`);
}

console.log('=== 测试4: fixedUnits 固定配置 ===');
{
  const fixed = ['swordsman', 'archer', 'knight', 'mage'];
  const b = PowerSystem.generateAiDeployment('hard', fixed, Math.random);
  const ids = Object.values(b.units).map(u => u.id);
  assert(ids.length === 4, `固定配置产出 4 个单位（实际 ${ids.length}）`);
  assert(JSON.stringify(ids.sort()) === JSON.stringify([...fixed].sort()), `兵种 ID 与固定列表一致 (${ids.join(',')})`);
  const u = b.units[1];
  assert(u.level >= 10, `固定配置仍应用难度等级基准（hard → Lv${u.level} ≥ 10）`);
}

console.log('=== 测试5: 接线（levels → Game，AI 一致化无作弊字段） ===');
{
  const cfg = buildBattleConfig(BOARD_LAYOUTS[0], 1200);
  const enemy = cfg.enemies[0];
  assert(enemy.skillTier === undefined, 'enemyConfig 不再输出 skillTier');
  assert(enemy.powerRatio === undefined, 'enemyConfig 不再输出 powerRatio');
  assert(enemy.warriorRateMult === undefined, 'enemyConfig 不再输出 warriorRateMult');
  assert(enemy.initialGold === 150, `enemyConfig.initialGold = ${enemy.initialGold}（与玩家一致）`);
  assert(['easy', 'normal', 'hard', 'nightmare'].includes(enemy.ai), `enemyConfig.ai = ${enemy.ai} 合法`);

  // 模拟 Game.initBattle 的接线逻辑：按 enemyConfig 生成 AI bundle 并断言可用
  const aiBundle = PowerSystem.generateAiDeployment(enemy.ai);
  assert(Object.keys(aiBundle.units).length === 4, `接线后 AI bundle 4 槽位可用（${Object.keys(aiBundle.units).length}）`);
}

console.log(`\n结果: ${passed} 通过, ${failed} 失败`);
process.exit(failed > 0 ? 1 : 0);
