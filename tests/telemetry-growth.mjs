// 养成数值修正 · 离线埋点实测（L3 运行实测）
// 复用真实 src 代码：数值探针（getUnitStats/calculatePlayerPower）+ 对局模拟（sim-balance-phase6）
// 用法：
//   node tests/telemetry-growth.mjs --root . --label current --games 20 --out /tmp/current.json
//   node tests/telemetry-growth.mjs --root E:/GitRep/_kotoc_baseline_160a703 --label baseline --games 20 --out /tmp/baseline.json
//
// 设计原则（遵守验证契约）：
//   - 对局部分直接调用 sim-balance-phase6.mjs，脚本本身两版零改动 → 配对 A/B 唯一差别是养成修正 5 变量
//   - 数值探针 import 指定 root 的真实函数，不改任何源码
//   - 跑前写死信号（见 REPORT_SIGNALS），事后不得追认
//   - 本脚本只测量，不改配置、不改源码（除 sim-balance 自身写它的 results json）

const noop = () => {};
const { readFileSync: rf, existsSync, writeFileSync, mkdirSync } = await import('node:fs');
const { fileURLToPath: fURL, pathToFileURL } = await import('node:url');
const path = await import('node:path');

// ========== 跑前写死的验收信号（契约 2.2 的落地判据） ==========
const REPORT_SIGNALS = {
  pass: [
    '交叉探针成立：current 的 fresh 胜率相对 baseline 偏移在 [-5pp, +5pp]（V1 对 Lv1 无效），且 late 胜率提升 ≥ 5pp（V1 对 Lv20 生效）',
    '满配战力/王者带 ≤ 1.3',
    '等效达标天数（达到 baseline Lv20 同等战力所需养成投入）较 197 天口径缩短至 60~90 天区间',
  ],
  fail: [
    '任一难度档胜率偏移 > 10pp（对局侧失控）',
    '满配战力溢出王者带 > 1.3 倍',
  ],
  confounded: '本轮 5 变量联合释放；对局侧仅 V1 进战斗链路（结构性隔离），其余 4 变量对胜率的理论效应为 0，但养成/经济侧仍 confounded',
  stop: '金币负增长 / 死循环 / 存档损坏 / 战力 NaN 或溢出',
};

// ========== 参数 ==========
const args = process.argv.slice(2);
function argOf(name, def) {
  const i = args.indexOf('--' + name);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
}
const ROOT_ARG = argOf('root', '.');
const LABEL = argOf('label', 'current');
const GAMES = parseInt(argOf('games', '20'), 10);
const SEED = parseInt(argOf('seed', '20261126'), 10);
const MAPS = argOf('maps', 'plains,twin_canyon,tri_lanes');
const OUT = argOf('out', null);
const ROOT = path.resolve(ROOT_ARG);
const ROOT_URL = pathToFileURL(ROOT + path.sep).href;

console.log(`[telemetry] root=${ROOT} label=${LABEL} games=${GAMES} seed=${SEED}`);

// ========== 环境 stub（浏览器/wx 依赖）==========
const canvasStub = { width: 400, height: 700, addEventListener: noop, removeEventListener: noop };
global.document = { getElementById: () => canvasStub, addEventListener: noop, removeEventListener: noop, body: { appendChild: noop }, hidden: false };
global.window = { innerWidth: 400, innerHeight: 700, requestAnimationFrame: () => 0, addEventListener: noop, removeEventListener: noop, AudioContext: class {} };
global.requestAnimationFrame = () => 0;
global.localStorage = { _d: {}, getItem(k) { return this._d[k] ?? null; }, setItem(k, v) { this._d[k] = String(v); }, removeItem(k) { delete this._d[k]; } };
global.wx = {};
global.performance = { now: () => Date.now() };
global.alert = noop;
global.fetch = async (p) => {
  const file = path.join(ROOT, String(p).replace('../', ''));
  if (!existsSync(file)) return { ok: false, status: 404, json: async () => { throw new Error('404 ' + p); } };
  return { ok: true, status: 200, json: async () => JSON.parse(rf(file, 'utf-8')) };
};

// ========== 加载指定 root 的真实模块（动态 import，各版本独立实例）==========
const ConfigLoader = (await import(ROOT_URL + 'src/config.js?telemetry=' + LABEL)).default;
await ConfigLoader.init();
const { syncConfigToStatics } = await import(ROOT_URL + 'src/config.js?telemetry2=' + LABEL);
syncConfigToStatics();
const Dep = await import(ROOT_URL + 'src/meta/DeploymentSystem.js?telemetry=' + LABEL);
const Pow = await import(ROOT_URL + 'src/meta/PowerSystem.js?telemetry=' + LABEL);
const ProfileManager = await import(ROOT_URL + 'src/meta/ProfileManager.js?telemetry=' + LABEL);

const deployCfg = ConfigLoader.get('deployables');
const shopCfg = ConfigLoader.get('shop');

// ========== 探针 1：关键常量（确认 5 变量真值）==========
const constants = {
  GROWTH_SCALE: Dep.GROWTH_SCALE,
  UPGRADE_COST_GROWTH: Dep.UPGRADE_COST_GROWTH,
  BASE_FLATTEN: Dep.BASE_FLATTEN,
  MAX_UNIT_LEVEL: Dep.MAX_UNIT_LEVEL,
  TIER_POWER_REFERENCE: Pow.TIER_POWER_REFERENCE,
  shopStardust: {
    s: shopCfg.items?.find?.(i => i.id === 'buy_stardust_s') || shopCfg.goods?.find?.(i => i.id === 'buy_stardust_s') || null,
    m: shopCfg.items?.find?.(i => i.id === 'buy_stardust_m') || shopCfg.goods?.find?.(i => i.id === 'buy_stardust_m') || null,
  },
};

// ========== 探针 2：剑士成长曲线 + 等效达标投入 ==========
// 剑士 Q1：成本/属性基准。LEVEL_COST 用真实 upgradeCost.starDust × UPGRADE_COST_GROWTH^(lv-1) 累加
const SWORD = 'swordsman';
const swordCfg = deployCfg.units[SWORD];
const STARDUST_PER_DAY = 62; // 零氪日投放（广告关，当前状态）—— 契约口径常量，两版钉死

function cumulativeStardustTo(level) {
  const base = swordCfg.upgradeCost?.starDust || swordCfg.upgradeCost?.stardust || 0;
  let sum = 0;
  for (let lv = 1; lv < level; lv++) sum += Math.floor(base * Math.pow(constants.UPGRADE_COST_GROWTH, lv - 1));
  return sum;
}

function unitRow(level) {
  const stats = Dep.getUnitStats(SWORD, level);
  return {
    level,
    attackCoeff: +stats.attackCoeff.toFixed(4),
    hpCoeff: +stats.hpCoeff.toFixed(4),
    power: Pow.calculateUnitPower(SWORD, level),
    cumStardust: cumulativeStardustTo(level),
    days: +(cumulativeStardustTo(level) / STARDUST_PER_DAY).toFixed(1),
    skills: stats.skills?.length || 0,
  };
}
const growthCurve = [1, 5, 6, 10, 12, 18, 20].map(unitRow);

// V1 生效范围探针：三档等级 × 6 上阵兵的攻击/生命系数（确定性，不依赖对局随机）
const DEPLOY_UNITS = (deployCfg.defaultDeployment?.units || []).filter(Boolean);
const v1Scope = {};
for (const lv of [1, 8, 20]) {
  v1Scope['L' + lv] = DEPLOY_UNITS.map(id => {
    const s = Dep.getUnitStats(id, lv);
    return { id, atk: +s.attackCoeff.toFixed(4), hp: +s.hpCoeff.toFixed(4), power: Pow.calculateUnitPower(id, lv) };
  });
}
const v1ScopeSummary = {};
for (const lv of [1, 8, 20]) {
  const rows = v1Scope['L' + lv];
  v1ScopeSummary['L' + lv] = {
    avgAtk: +(rows.reduce((a, r) => a + r.atk, 0) / rows.length).toFixed(4),
    avgHp: +(rows.reduce((a, r) => a + r.hp, 0) / rows.length).toFixed(4),
    avgPower: +(rows.reduce((a, r) => a + r.power, 0) / rows.length).toFixed(1),
  };
}

// 等效达标：达到"baseLine 的 Lv20 攻击系数 / 战力"在当前版本需要几级 + 多少星尘
// 用真实 getUnitStats 扫描 Lv1..20，找首个 ≥ 阈值的等级（阈值由调用方在汇总阶段注入）
function findLevelForAttack(targetAtk) {
  for (let lv = 1; lv <= constants.MAX_UNIT_LEVEL; lv++) {
    if (Dep.getUnitStats(SWORD, lv).attackCoeff >= targetAtk) return lv;
  }
  return null;
}
function findLevelForPower(targetPower) {
  for (let lv = 1; lv <= constants.MAX_UNIT_LEVEL; lv++) {
    if (Pow.calculateUnitPower(SWORD, lv) >= targetPower) return lv;
  }
  return null;
}

// ========== 探针 3：满配战力 vs 段位带 ==========
// 满配 = 6 兵 Lv20 高品质 + 建筑满 + 科技满（用真实 calculatePlayerPower，构造 profile）
const TOP_UNITS = ['archdragon', 'war_titan', 'dragonling', 'phoenix', 'war_elephant', 'death_knight'];
function buildMaxProfile() {
  const techTreeCfg = ConfigLoader.get('techTree');
  const techTree = {};
  for (const [branchKey, branch] of Object.entries(techTreeCfg.branches || {})) {
    for (const node of (branch.nodes || [])) techTree[node.id] = node.maxLevel || 1;
  }
  const collectedUnits = {};
  for (const id of TOP_UNITS) collectedUnits[id] = { level: constants.MAX_UNIT_LEVEL };
  return {
    collectedUnits,
    deployment: { units: [...TOP_UNITS], synergies: [] },
    buildingUpgrades: { barracks: 4, arrow_tower: 3, gold_mine: 3 },
    techTree,
    trophies: 99999,
  };
}
const maxProfile = buildMaxProfile();
const maxPower = Pow.calculatePlayerPower(maxProfile);
const kingRef = constants.TIER_POWER_REFERENCE[constants.TIER_POWER_REFERENCE.length - 1];
const maxPowerRatio = +(maxPower.total / kingRef).toFixed(3);

// 新玩家基线（默认 6 兵 Lv1 + 建筑 Lv1）战力
const freshProfile = {
  collectedUnits: Object.fromEntries((deployCfg.defaultDeployment?.units || []).filter(Boolean).map(id => [id, { level: 1 }])),
  deployment: { units: [...(deployCfg.defaultDeployment?.units || [])], synergies: [] },
  buildingUpgrades: { barracks: 1, arrow_tower: 1, gold_mine: 1 },
  techTree: {}, trophies: 0,
};
const freshPower = Pow.calculatePlayerPower(freshProfile);

// ========== 探针 4：AIPlayer 决策链路（结构性归因佐证）==========
// 统计 V2~V5 影响的模块是否出现在 AIPlayer / CombatSystem / MarchSystem / EconomySystem
// 这里只记录结论文本，具体 grep 在汇总阶段做
const structuralAttribution = {
  V1_GROWTH_SCALE: 'getUnitStats() 每级成长 → 进战斗（玩家 Lv>1、AI Lv3~16 均生效；Lv1 玩家不生效）',
  V2_exchange_rate: 'shop.json 商品字段 → ShopSystem 经济 → 不进单局战斗公式',
  V3_daily_limit: 'ShopSystem.dailyPurchaseLimit → 局外限购 → 不进单局战斗公式',
  V4_tier_band: 'PowerSystem.TIER_POWER_REFERENCE → getLobbyPowerInfo ratio 显示 → 不进战斗/AI 难度（2026-09-09 已解耦）',
  V5_hero_ticket: 'RenderSystem/Game toast 过滤 → 纯展示 → 不进战斗',
};

// ========== 探针 5：真实对局模拟（调用 sim-balance-phase6，两版脚本零改动）==========
const { spawnSync } = await import('node:child_process');
const simScript = path.join(ROOT, 'tests/sim-balance-phase6.mjs');
const resultsJson = path.join(ROOT, 'tests/sim-results-phase6.json');

function runSims(profile) {
  const cmd = process.execPath;
  const argv = [simScript, '--games', String(GAMES), '--seed', String(SEED),
    '--diffs', 'easy,normal,hard,nightmare', '--maps', MAPS, '--profile', profile];
  const r = spawnSync(cmd, argv, { cwd: ROOT, encoding: 'utf-8', maxBuffer: 32 * 1024 * 1024 });
  if (r.status !== 0) {
    console.error(`[telemetry] sim failed for ${profile}:`, r.stderr?.slice(-2000));
    throw new Error('sim failed: ' + profile);
  }
  const data = JSON.parse(rf(resultsJson, 'utf-8'));
  return data.results;
}

const simByProfile = {};
for (const profile of ['fresh', 'mid', 'late']) {
  simByProfile[profile] = runSims(profile);
  console.log(`[telemetry] ${LABEL}/${profile}: ${simByProfile[profile].length} games`);
}

// 聚合胜率/时长（区分超时）
function agg(results) {
  const won = results.filter(r => r.result === 'won').length;
  const lost = results.filter(r => r.result === 'lost').length;
  const timeout = results.length - won - lost;
  return {
    games: results.length,
    winRate: +(100 * won / results.length).toFixed(1),
    loseRate: +(100 * lost / results.length).toFixed(1),
    timeoutRate: +(100 * timeout / results.length).toFixed(1),
    avgDuration: +(results.reduce((a, r) => a + r.duration, 0) / results.length).toFixed(1),
  };
}
const simSummary = {};
for (const profile of Object.keys(simByProfile)) {
  simSummary[profile] = { overall: agg(simByProfile[profile]), byDiff: {} };
  for (const d of ['easy', 'normal', 'hard', 'nightmare']) {
    simSummary[profile].byDiff[d] = agg(simByProfile[profile].filter(r => r.diff === d));
  }
}

// ========== 导出 ==========
const report = {
  meta: {
    label: LABEL,
    root: ROOT,
    commit: (() => { try { return rf(path.join(ROOT, '.git/HEAD'), 'utf-8').trim(); } catch (_) { return 'unknown'; } })(),
    timestamp: new Date().toISOString(),
    games: GAMES, seed: SEED, maps: MAPS, stardustPerDay: STARDUST_PER_DAY,
  },
  signalsDefinedBeforeRun: REPORT_SIGNALS,
  constants,
  growthCurve,
  v1Scope,
  v1ScopeSummary,
  maxPower: { ...maxPower, kingRef, ratioToKing: maxPowerRatio },
  freshPower,
  structuralAttribution,
  simSummary,
  simRawCount: Object.fromEntries(Object.entries(simByProfile).map(([k, v]) => [k, v.length])),
};

const json = JSON.stringify(report, null, 2);
if (OUT) {
  const outPath = path.resolve(OUT);
  mkdirSync(path.dirname(outPath), { recursive: true });
  writeFileSync(outPath, json, 'utf-8');
  console.log(`[telemetry] wrote ${outPath}`);
} else {
  console.log(json);
}

// 控制台速览
console.log(`\n--- ${LABEL} 速览 ---`);
console.log(`常量: GROWTH_SCALE=${constants.GROWTH_SCALE} COST_GROWTH=${constants.UPGRADE_COST_GROWTH} 王者带=${kingRef}`);
console.log(`剑士曲线: ${growthCurve.map(r => `L${r.level}:${r.power}战/${r.cumStardust}尘/${r.days}天`).join('  ')}`);
console.log(`满配战力=${maxPower.total} 王者带比=${maxPowerRatio}  新玩家战力=${freshPower.total}`);
for (const p of ['fresh', 'mid', 'late']) {
  const s = simSummary[p];
  console.log(`${p.padEnd(6)} 整体胜率${s.overall.winRate}% 时长${s.overall.avgDuration}s | ` +
    ['easy', 'normal', 'hard', 'nightmare'].map(d => `${d}:${s.byDiff[d].winRate}%`).join(' '));
}
