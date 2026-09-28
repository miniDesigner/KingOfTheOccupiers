// 测试: 可升级角标口径统一
// 1) DeploymentSystem.isUnitUpgradeable 与 upgradeUnit 校验一致（等级/招募/星尘/金币）
// 2) 条件不足时卡片角标不亮（isUnitUpgradeable 为 false）
// 3) TechTreeSystem.getUpgradeableNodeCount 与 canUpgrade 口径一致
// 4) 大厅渲染（含 lobbyBadges 角标）无异常
const noop = () => {};
const ctxProxy = new Proxy({}, {
  get: (t, p) => {
    if (p === 'canvas') return canvasStub;
    return (...args) => {
      if (p === 'measureText') return { width: 50 };
      if (p === 'createLinearGradient' || p === 'createRadialGradient') return { addColorStop: noop };
      return undefined;
    };
  },
  set: () => true,
});
const canvasStub = {
  width: 400, height: 700, style: {},
  getContext: () => ctxProxy,
  addEventListener: noop, removeEventListener: noop,
  getBoundingClientRect: () => ({ left: 0, top: 0, width: 400, height: 700 }),
};
global.document = {
  getElementById: () => canvasStub,
  addEventListener: noop, removeEventListener: noop,
  createElement: () => canvasStub,
  body: { appendChild: noop, removeChild: noop },
  hidden: false,
};
global.window = {
  innerWidth: 400, innerHeight: 700, devicePixelRatio: 1,
  addEventListener: noop, removeEventListener: noop,
  removeEventListener: noop,
  requestAnimationFrame: noop,
};
global.localStorage = {
  _d: {},
  getItem(k) { return this._d[k] ?? null; },
  setItem(k, v) { this._d[k] = String(v); },
  removeItem(k) { delete this._d[k]; },
};
global.fetch = async (path) => {
  const { readFileSync: rf } = await import('node:fs');
  const { fileURLToPath: fURL } = await import('node:url');
  const { dirname, join } = await import('node:path');
  const ROOT = dirname(dirname(fURL(import.meta.url)));
  const p = path.replace(/^\.?\/?/, '').replace(/^config\//, 'config/');
  const file = join(ROOT, p.startsWith('/') ? p.slice(1) : p);
  return { ok: true, json: async () => JSON.parse(rf(file, 'utf-8')) };
};

global.requestAnimationFrame = () => 0;
Object.defineProperty(global, 'navigator', { value: { userAgent: 'node-test' }, configurable: true });
global.performance = { now: () => Date.now() };
global.Audio = class { constructor() { this.volume = 1; } play() { return Promise.resolve(); } pause() {} addEventListener() {} };

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; console.log('  ✅ ' + msg); }
  else { failed++; console.error('  ❌ ' + msg); }
}

const { Game } = await import('../src/game/Game.js');
const DeploymentSystem = (await import('../src/meta/DeploymentSystem.js')).default;
const ProfileManager = (await import('../src/meta/ProfileManager.js')).default;
const TechTreeSystem = (await import('../src/meta/TechTreeSystem.js')).default;
const { UPGRADE_COST_GROWTH, MAX_UNIT_LEVEL } = await import('../src/meta/DeploymentSystem.js');
const { default: ConfigLoader, syncConfigToStatics } = await import('../src/config.js');
await ConfigLoader.init();
syncConfigToStatics();

const game = new Game(canvasStub, ctxProxy, 400, 700);
await game.start();

console.log('=== 测试1: isUnitUpgradeable 与 upgradeUnit 校验一致 ===');
{
  const profile = ProfileManager.get();
  // 选一个已收集兵种
  const unitId = Object.keys(profile.collectedUnits)[0];
  const unitCfg = ConfigLoader.get('deployables').units[unitId];
  const collected = profile.collectedUnits[unitId];
  assert(!!collected && !!unitCfg, `测试兵种 ${unitId} 存在`);

  // 场景A: 资源清零 → 不可升级（即使招募次数足够）
  profile.stardust = 0; profile.gold = 0;
  collected.recruitCount = 999999; // 招募次数拉满
  assert(DeploymentSystem.isUnitUpgradeable(unitId) === false,
    '资源为0时不可升级（旧角标逻辑会误亮）');

  // 场景B: 资源充足 + 招募足够 → 可升级，且 upgradeUnit 实际成功
  const growth = Math.pow(UPGRADE_COST_GROWTH, collected.level - 1);
  const needStar = Math.ceil((unitCfg.upgradeCost?.starDust || 0) * growth);
  const needGold = Math.ceil((unitCfg.upgradeCost?.gold || 0) * growth);
  profile.stardust = needStar; profile.gold = needGold;
  const lvBefore = collected.level;
  assert(DeploymentSystem.isUnitUpgradeable(unitId) === true, '资源恰好足够时可升级');
  const result = DeploymentSystem.upgradeUnit(unitId);
  assert(result.success === true, `upgradeUnit 实际成功(${result.reason || 'Lv.' + result.newLevel})`);
  assert(collected.level === lvBefore + 1, '等级 +1');

  // 场景C: 招募不足但资源充足 → 不可升级
  collected.recruitCount = 0;
  const recruitBase = unitCfg.recruitRequired || 0;
  if (recruitBase > 0) {
    assert(DeploymentSystem.isUnitUpgradeable(unitId) === false, '招募次数不足时不可升级');
  } else {
    console.log('  ⚠️ 该兵种无招募需求，跳过招募场景');
  }

  // 场景D: 满级 → 不可升级
  collected.recruitCount = 999999;
  collected.level = MAX_UNIT_LEVEL;
  assert(DeploymentSystem.isUnitUpgradeable(unitId) === false, `满级(Lv.${MAX_UNIT_LEVEL})时不可升级`);
}

console.log('=== 测试2: getUpgradeableUnitCount 正确计数 ===');
{
  const profile = ProfileManager.get();
  // 所有收集兵种招募次数拉满（测试1曾把 swordsman 设为满级，排除干扰）
  for (const c of Object.values(profile.collectedUnits)) c.recruitCount = 999999;
  profile.stardust = 0; profile.gold = 0; // 全部不可升级
  assert(DeploymentSystem.getUpgradeableUnitCount() === 0, '资源为0时计数=0');
  profile.stardust = 99999999; profile.gold = 99999999;
  const cnt = DeploymentSystem.getUpgradeableUnitCount();
  assert(cnt > 0, `资源充足且有招募达标的兵种时计数>0 (实际 ${cnt})`);
  // 逐个核对计数与逐兵种判定一致
  const manual = Object.keys(profile.collectedUnits)
    .filter((id) => DeploymentSystem.isUnitUpgradeable(id)).length;
  assert(cnt === manual, `计数与逐兵种判定一致 (${cnt} === ${manual})`);
}

console.log('=== 测试3: TechTreeSystem.getUpgradeableNodeCount 口径一致 ===');
{
  const profile = ProfileManager.get();
  const branches = TechTreeSystem.getBranches();
  const manualCount = (stardust) => {
    profile.stardust = stardust;
    let n = 0;
    for (const branch of Object.values(branches)) {
      for (const node of branch.nodes) {
        if (TechTreeSystem.canUpgrade(node.id).ok) n++;
      }
    }
    return n;
  };
  assert(TechTreeSystem.getUpgradeableNodeCount() === manualCount(profile.stardust),
    '星尘充足时计数与 canUpgrade 口径一致');
  assert(manualCount(0) === 0, '星尘为0时可升级节点=0');
  assert(TechTreeSystem.getUpgradeableNodeCount() === 0, '星尘为0时计数=0');
}

console.log('=== 测试4: 大厅渲染（含 lobbyBadges 角标）无异常 ===');
{
  const profile = ProfileManager.get();
  profile.stardust = 99999999; profile.gold = 99999999;
  game.screenState = 'lobby';
  let err = null;
  try { game.render(0.016); } catch (e) { err = e; }
  assert(!err, `大厅渲染无异常${err ? '(' + err.message + ')' : ''}`);
  // 资源清零再渲染一次（badgeCount=0 路径）
  profile.stardust = 0; profile.gold = 0;
  err = null;
  try { game.render(0.016); } catch (e) { err = e; }
  assert(!err, `角标为0时大厅渲染无异常${err ? '(' + err.message + ')' : ''}`);
}

console.log(`\n结果: ${passed} 通过, ${failed} 失败`);
process.exit(failed === 0 ? 0 : 1);
