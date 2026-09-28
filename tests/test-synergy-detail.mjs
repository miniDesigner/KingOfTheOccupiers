// 测试: 2026-09-09 改造后的自动羁绊系统
// 验证 SynergySystem.calculateSynergiesFromUnits + getAutoSynergyPanelData
//   - 4 类 style 羁绊按上阵兵种自动派生
//   - 等级 = 该 style 兵种数（线性，1-6）
//   - 多 tag 兵种贡献给每个 style
//   - 建筑不参与 styleCount 计算（验证与 buildings 解耦）
//   - 旧 collectedSynergies 字段已从 PlayerProfile 移除

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
  requestAnimationFrame: (cb) => 0,
  cancelAnimationFrame: noop,
  AudioContext: class {},
  location: { href: 'http://127.0.0.1:8890/preview/index.html', reload: noop },
};
global.requestAnimationFrame = () => 0;
global.localStorage = { _d: {}, getItem(k) { return this._d[k] ?? null; }, setItem(k, v) { this._d[k] = String(v); }, removeItem(k) { delete this._d[k]; } };
Object.defineProperty(global, 'navigator', { value: { userAgent: 'node-test' }, configurable: true });
global.performance = { now: () => Date.now() };
global.alert = noop;
global.Audio = class { constructor() { this.volume = 1; } play() { return Promise.resolve(); } pause() {} addEventListener() {} };
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

const { SynergySystem } = await import('../src/system/SynergySystem.js');
const ConfigLoader = (await import('../src/data/ConfigLoader.js')).default;

// 触发 ConfigLoader 初始化 + 加载 deployables 配置
await ConfigLoader.init();
const config = ConfigLoader.getSafe('deployables');

// 工具：构造最小 unit 对象（仅测时用）
const mkUnit = (id, combatStyles) => ({ id, name: id, combatStyles });

console.log('=== 测试1: calculateSynergiesFromUnits 基础派生 ===');
{
  // 3 个 melee + 2 个 ranged + 1 个 defense + 1 个 magic → 各自 Lv.x/6
  const units = [
    mkUnit('swordsman', ['melee']),  // melee +1
    mkUnit('knight', ['melee', 'defense']),  // melee +1, defense +1
    mkUnit('berserker', ['melee']),  // melee +1
    mkUnit('archer', ['ranged']),  // ranged +1
    mkUnit('crossbowman', ['ranged']),  // ranged +1
    mkUnit('shieldbearer', ['melee', 'defense']),  // melee +1, defense +1
    mkUnit('mage', ['magic']),  // magic +1
  ];

  const data = SynergySystem.calculateSynergiesFromUnits(units);
  assert(data.styleCount.melee === 4, `styleCount.melee=4 (含多 tag 共计)${data.styleCount.melee}`);
  assert(data.styleCount.ranged === 2, `styleCount.ranged=2`);
  assert(data.styleCount.defense === 2, `styleCount.defense=2 (knight + shieldbearer)`);
  assert(data.styleCount.magic === 1, `styleCount.magic=1`);
  assert(data.activeSynergies.warriors_will.level === 4, `勇士意志 Lv.4`);
  assert(data.activeSynergies.ranged_volley.level === 2, `远程齐射 Lv.2`);
  assert(data.activeSynergies.fortress.level === 2, `堡垒之盾 Lv.2`);
  assert(data.activeSynergies.arcane_surge.level === 1, `奥术涌动 Lv.1`);
  // 各等级加成验证：warriors_will Lv.4 = +20% attackBonus
  assert(data.attackBonus === 0.20, `warriors_will Lv.4 attackBonus=0.20 (实际=${data.attackBonus})`);
  // ranged_volley Lv.2 = +10% speedBonus
  assert(data.speedBonus === 0.10, `ranged_volley Lv.2 speedBonus=0.10 (实际=${data.speedBonus})`);
  // fortress Lv.2 = +10% buildingHpBonus + +6% damageReduction
  assert(data.buildingHpBonus === 0.10, `fortress Lv.2 buildingHpBonus=0.10`);
  assert(data.damageReduction === 0.06, `fortress Lv.2 damageReduction=0.06`);
  // arcane_surge Lv.1 = +4% critBonus + +2% damageBonus
  assert(data.critBonus === 0.04, `arcane_surge Lv.1 critBonus=0.04`);
  assert(data.damageBonus === 0.02, `arcane_surge Lv.1 damageBonus=0.02`);
}

console.log('=== 测试2: 等级线性映射（clamp 1-6）===');
{
  // 上阵 8 个 melee → Lv.6 (clamp)
  const units = Array(8).fill(0).map((_, i) => mkUnit(`u${i}`, ['melee']));
  const data = SynergySystem.calculateSynergiesFromUnits(units);
  assert(data.activeSynergies.warriors_will.level === 6, `8 melee → Lv.6 (clamp)`);
  assert(data.activeSynergies.warriors_will.bonus.attackBonus === 0.30, `Lv.6 attackBonus=0.30`);
  // 上阵 0 个 melee → Lv.0 (未激活)
  const data2 = SynergySystem.calculateSynergiesFromUnits([mkUnit('a', ['ranged'])]);
  assert(data2.activeSynergies.warriors_will.level === 0, `0 melee → Lv.0 未激活`);
  assert(data2.activeSynergies.warriors_will.bonus === null, `Lv.0 bonus=null`);
  assert(data2.attackBonus === 0, `未激活时 attackBonus=0`);
}

console.log('=== 测试3: 建筑不参与 styleCount 计算 ===');
{
  // 直接传 units（不模拟 buildings），验证建筑无关
  const units = [
    mkUnit('swordsman', ['melee']),
    mkUnit('archer', ['ranged']),
  ];
  const data = SynergySystem.calculateSynergiesFromUnits(units);
  // 假设玩家有 10 个 melee 建筑（不应影响 styleCount）
  // 验证：仅 unitList 参与计算
  assert(data.styleCount.melee === 1, `仅 1 melee 兵种 → styleCount.melee=1（建筑不计入）`);
  assert(data.styleCount.ranged === 1, `仅 1 ranged 兵种 → styleCount.ranged=1`);
}

console.log('=== 测试4: 接受 deploymentBundle 形态 ===');
{
  // 模拟 DeploymentBundle 结构 { units: {1: unit, 2: unit, ...} }
  const bundle = {
    units: {
      1: mkUnit('swordsman', ['melee']),
      2: mkUnit('knight', ['melee', 'defense']),
      3: mkUnit('archer', ['ranged']),
      4: mkUnit('mage', ['magic']),
    },
    synergies: [],
    buildingUpgrades: {},
  };
  const data = SynergySystem.calculateSynergiesFromUnits(bundle);
  assert(data.styleCount.melee === 2, `bundle.melee=2`);
  assert(data.styleCount.defense === 1, `bundle.defense=1 (knight)`);
  assert(data.styleCount.ranged === 1, `bundle.ranged=1`);
  assert(data.styleCount.magic === 1, `bundle.magic=1`);
}

console.log('=== 测试5: getAutoSynergyPanelData 排序与字段 ===');
{
  // 构造 player mock（只 deploymentBundle）
  const player = {
    deploymentBundle: {
      units: {
        1: mkUnit('swordsman', ['melee']),
        2: mkUnit('archer', ['ranged']),
        3: mkUnit('mage', ['magic']),
      },
    },
  };
  const panel = SynergySystem.getAutoSynergyPanelData(player);
  assert(panel.length === 4, `返回 4 个羁绊（实际=${panel.length}）`);
  // 排序：warriors_will/arcane_surge/magic/ranged 都是 Lv.1 → count 排序
  assert(panel[0].style === 'melee' || panel[0].style === 'ranged' || panel[0].style === 'magic', `首个 entry 是激活 style`);
  assert(panel.every((s) => s.styleName), `每项含 styleName 中文`);
  assert(panel.some((s) => s.id === 'warriors_will' && s.style === 'melee'), `warriors_will 是 melee style`);
  assert(panel.some((s) => s.id === 'ranged_volley' && s.style === 'ranged'), `ranged_volley 是 ranged style`);
  assert(panel.some((s) => s.id === 'fortress' && s.level === 0), `fortress 无 defense 兵种 → Lv.0`);
  // 未上阵 defense：bonus=null
  const fortressEntry = panel.find((s) => s.id === 'fortress');
  assert(fortressEntry.bonus === null, `fortress Lv.0 时 bonus=null`);
}

console.log('=== 测试6: 旧 API 已彻底移除 ===');
{
  const DeploymentSystem = (await import('../src/meta/DeploymentSystem.js')).default;
  // 验证旧 API 不再存在
  assert(typeof DeploymentSystem.unlockSynergy === 'undefined', 'unlockSynergy 已移除');
  assert(typeof DeploymentSystem.upgradeSynergy === 'undefined', 'upgradeSynergy 已移除');
  assert(typeof DeploymentSystem.setDeployedSynergy === 'undefined', 'setDeployedSynergy 已移除');
  assert(typeof DeploymentSystem.getCollectedSynergyList === 'undefined', 'getCollectedSynergyList 已移除');
  assert(typeof DeploymentSystem.getSynergyStats === 'undefined', 'getSynergyStats 已移除');
}

console.log('=== 测试7: PlayerProfile 不再含 collectedSynergies ===');
{
  const ProfileManager = (await import('../src/meta/ProfileManager.js')).default;
  const PlayerProfile = (await import('../src/meta/PlayerProfile.js')).PlayerProfile;
  // 清空 localStorage（避免残留旧档）
  global.localStorage._d = {};
  ProfileManager.load();
  const profile = ProfileManager.get() || new PlayerProfile();
  assert(profile.collectedSynergies === undefined, 'profile.collectedSynergies 已从字段中移除');
  // 旧 JSON 兼容（即使存档里有 collectedSynergies，运行时也不报错）
  const oldData = {
    nickname: 'test', gold: 0, diamond: 0, stardust: 0,
    collectedUnits: {}, collectedSynergies: { warriors_will: { level: 3 } },
    deployment: { units: ['swordsman'], synergies: ['warriors_will'] },
    buildingUpgrades: { barracks: 1, arrow_tower: 1, gold_mine: 1 },
    pvpWins: 0, pvpLosses: 0, pvpWinStreak: 0, pvpMaxStreak: 0,
  };
  const migrated = PlayerProfile.fromJSON(oldData);
  assert(migrated.deployment.units.length === 6, '旧档 units 自动补齐 6 槽（与新部署无关）');
  assert(Array.isArray(migrated.deployment.synergies), '旧档 deployment.synergies 字段保留为空数组');
  // 注：旧档 collectedSynergies 字段被忽略（不报错即可）
  assert(migrated.collectedSynergies === undefined, '迁移后不引入 collectedSynergies 字段');
}

console.log('=== 测试8: 数值表（4 类羁绊 Lv.6 上限）===');
{
  const levels = config.synergies;
  // 勇士意志 Lv.6 attackBonus = 0.30
  assert(levels.warriors_will.levels['6'].attackBonus === 0.30, '勇士意志 Lv.6 = +30% attack');
  // 远程齐射 Lv.3 + firstStrike，Lv.6 = +30% speed + firstStrike
  assert(levels.ranged_volley.levels['3'].firstStrike === true, '远程齐射 Lv.3 起含 firstStrike');
  assert(levels.ranged_volley.levels['6'].speedBonus === 0.30, '远程齐射 Lv.6 speedBonus=0.30');
  // 堡垒之盾 Lv.6 = +30% buildingHpBonus + +18% damageReduction
  assert(levels.fortress.levels['6'].buildingHpBonus === 0.30, '堡垒之盾 Lv.6 buildingHpBonus=0.30');
  assert(levels.fortress.levels['6'].damageReduction === 0.18, '堡垒之盾 Lv.6 damageReduction=0.18');
  // 奥术涌动 Lv.6 = +24% critBonus + +12% damageBonus
  assert(levels.arcane_surge.levels['6'].critBonus === 0.24, '奥术涌动 Lv.6 critBonus=0.24');
  assert(levels.arcane_surge.levels['6'].damageBonus === 0.12, '奥术涌动 Lv.6 damageBonus=0.12');
}

console.log('=== 测试9: 与 Player.synergyBonuses 链路 ===');
{
  const { Player } = await import('../src/entity/Player.js');
  const player = new Player(1, '测试', '#fff', false);
  player.deploymentBundle = {
    units: {
      1: mkUnit('swordsman', ['melee']),
      2: mkUnit('knight', ['melee', 'defense']),
      3: mkUnit('archer', ['ranged']),
      4: mkUnit('mage', ['magic']),
      5: mkUnit('priest', ['magic']),
      6: mkUnit('templar', ['melee', 'defense']),
    },
  };
  SynergySystem.updatePlayerSynergies(player, null);
  // 统计：melee=3 (swordsman+knight+templar), ranged=1, defense=2 (knight+templar), magic=2
  assert(player.styleCount.melee === 3, `player.styleCount.melee=3`);
  assert(player.activeSynergies.warriors_will.level === 3, `warriors_will Lv.3 = +15% attack`);
  assert(player.synergyBonuses.attackBonus === 0.15, `synergyBonuses.attackBonus=0.15`);
  assert(player.activeSynergies.arcane_surge.level === 2, `arcane_surge Lv.2 = +8% crit + +4% damage`);
  assert(player.synergyBonuses.critBonus === 0.08, `synergyBonuses.critBonus=0.08`);
  assert(player.synergyBonuses.damageBonus === 0.04, `synergyBonuses.damageBonus=0.04`);
  assert(player.activeSynergies.fortress.level === 2, `fortress Lv.2 = +10% buildingHp + +6% damageReduction`);
  assert(player.synergyBonuses.buildingHpBonus === 0.10, `synergyBonuses.buildingHpBonus=0.10`);
  assert(player.synergyBonuses.damageReduction === 0.06, `synergyBonuses.damageReduction=0.06`);
}

console.log(`\n结果: ${passed} 通过, ${failed} 失败`);
process.exit(failed === 0 ? 0 : 1);