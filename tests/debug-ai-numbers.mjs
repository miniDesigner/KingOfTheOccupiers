// 数值调试脚本：AI 出兵速度 vs 玩家 对照分析
// 运行: node tests/debug-ai-numbers.mjs
// 分析链路:
//   AI等效产速 = 兵营基础warriorRate × 兵种productionSpeed(按1/q权重从bundle 4槽选兵) × warriorRateMult(难度×段位×战力比)
//   玩家等效产速 = 兵营基础warriorRate × 兵种productionSpeed(按1/q权重从上阵6兵种选兵) × 1.0
const noop = () => {};
const ctxProxy = new Proxy({}, {
  get: (t, p) => p === 'canvas' ? canvasStub : ((...args) => {
    if (p === 'measureText') return { width: 50 };
    if (p === 'createLinearGradient' || p === 'createRadialGradient') return { addColorStop: noop };
    return undefined;
  }),
  set: () => true,
});
const canvasStub = {
  width: 400, height: 700, style: {},
  getContext: () => ctxProxy, addEventListener: noop, removeEventListener: noop,
  getBoundingClientRect: () => ({ left: 0, top: 0, width: 400, height: 700 }),
};
global.document = {
  getElementById: () => canvasStub, addEventListener: noop, removeEventListener: noop,
  createElement: () => canvasStub, body: { appendChild: noop, removeChild: noop }, hidden: false,
};
global.window = {
  innerWidth: 400, innerHeight: 700, devicePixelRatio: 1,
  addEventListener: noop, removeEventListener: noop, requestAnimationFrame: (cb) => 0,
  cancelAnimationFrame: noop, AudioContext: class {},
  location: { href: 'http://127.0.0.1:8890/preview/index.html', reload: noop },
};
global.requestAnimationFrame = () => 0;
global.localStorage = { _d: {}, getItem(k) { return this._d[k] ?? null; }, setItem(k, v) { this._d[k] = String(v); }, removeItem(k) { delete this._d[k]; } };
global.wx = {
  shareAppMessage(cfg) { global.__lastShare = cfg; },
  createInnerAudioContext() {
    return { src: '', loop: false, volume: 1, play: noop, pause: noop, stop: noop, seek: noop, destroy: noop, onEnded: noop, onError: noop, onCanplay: noop };
  },
};
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

const ConfigLoader = (await import('../src/data/ConfigLoader.js')).default;
await ConfigLoader.init();
const { getTierAiSettings, generateAiDeployment } = await import('../src/meta/PowerSystem.js');
const deployables = ConfigLoader.getSafe('deployables');

// 确定性随机源
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

const unitsById = {};
for (const [id, u] of Object.entries(deployables.units || {})) unitsById[id] = u;

// 1/q 权重下的加权平均产速（模拟兵营从池中选兵的期望产速）
// 兼容原始配置(baseStats嵌套)与展开后配置(顶层 attackCoeff)
function weightedAvgSpeed(unitList) {
  const list = unitList.filter(u => u && (u.attackCoeff !== undefined || u.baseStats?.attackCoeff !== undefined));
  if (!list.length) return 0;
  let wSum = 0, psSum = 0;
  for (const u of list) { const w = 1 / (u.quality || 1); wSum += w; psSum += w * (u.productionSpeed ?? 1.0); }
  return psSum / wSum;
}

// 玩家对照：初始6兵种
const PLAYER_UNITS = ['swordsman', 'archer', 'knight', 'berserker', 'crossbowman', 'paladin'];
const playerList = PLAYER_UNITS.map(id => unitsById[id]).filter(Boolean);
const playerSpeed = weightedAvgSpeed(playerList);   // Lv1兵营期望产速(×1)
const playerGold = 150;
const BARB = { 1: 1, 2: 2, 3: 4, 4: 6 };  // 兵营基础产速
const THRESHOLD = 8;  // 编组阈值

console.log('════════════ 玩家基准 ════════════');
console.log(`初始6兵种: ${playerList.map(u => `${u.name}(${u.quality}品)`).join(' ')}`);
console.log(`兵营选兵期望产速(1/q权重): ${playerSpeed.toFixed(3)}`);
console.log(`Lv1兵营等效产速: ${(1 * playerSpeed).toFixed(3)} → 一组(${THRESHOLD}兵)间隔 ${(THRESHOLD / (1 * playerSpeed)).toFixed(1)}s`);
console.log(`Lv4兵营等效产速: ${(6 * playerSpeed).toFixed(3)} → 一组间隔 ${(THRESHOLD / (6 * playerSpeed)).toFixed(1)}s`);
console.log(`初始金币: ${playerGold}`);

// 段位奖杯表
const TIERS = [
  { key: 'bronze', trophies: 0 }, { key: 'silver', trophies: 300 }, { key: 'gold', trophies: 700 },
  { key: 'platinum', trophies: 1200 }, { key: 'diamond', trophies: 1800 }, { key: 'master', trophies: 2500 },
  { key: 'grandmaster', trophies: 3200 }, { key: 'king', trophies: 4000 },
];

console.log('\n════════════ AI 各段位×难度 出兵速度（当前数值，采样 300 局/段位）════════════');
console.log('段位       | 难度      | 概率 | 初始金 | mult | 兵种产速 | 等效产速 | ×玩家 | 平均品质 | 平均等级 | Lv1一组间隔');
const DIFFS = ['easy', 'normal', 'hard', 'nightmare'];
const rows = [];
for (const tier of TIERS) {
  const stats = {};  // diff -> 聚合
  for (let i = 0; i < 300; i++) {
    const rand = mulberry32(tier.trophies * 1000 + i);
    const s = getTierAiSettings(tier.trophies, rand);
    const bundle = generateAiDeployment(s.difficulty, null, rand);
    const slotUnits = Object.values(bundle.units || {}).filter(u => u && u.attackCoeff !== undefined);
    const spd = weightedAvgSpeed(slotUnits);
    const eff = spd * 1.0;
    const d = s.difficulty;
    if (!stats[d]) stats[d] = { n: 0, mult: 0, spd: 0, eff: 0, q: 0, lvl: 0, gold: 0 };
    const st = stats[d];
    st.n++; st.mult += 1.0; st.spd += spd; st.eff += eff;
    st.q += slotUnits.reduce((a, u) => a + (u.quality || 1), 0) / Math.max(1, slotUnits.length);
    st.lvl += slotUnits.reduce((a, u) => a + (u.level || 1), 0) / Math.max(1, slotUnits.length);
    st.gold += 150;
  }
  for (const d of DIFFS) {
    const st = stats[d];
    if (!st || !st.n) continue;
    const mult = st.mult / st.n, spd = st.spd / st.n, eff = st.eff / st.n;
    const ratio = eff / (1 * playerSpeed);
    const q = st.q / st.n, lvl = st.lvl / st.n, gold = st.gold / st.n;
    const interval = THRESHOLD / eff;
    rows.push({ tier: tier.key, diff: d, prob: st.n / 300, gold, mult, spd, eff, ratio, q, lvl, interval });
    console.log(
      `${tier.key.padEnd(10)} | ${d.padEnd(9)} | ${(st.n / 300).toFixed(2)} | ${gold.toFixed(0).padStart(4)} | ${mult.toFixed(2)} | ${spd.toFixed(2)} | ${eff.toFixed(2)} | ${ratio.toFixed(2)}× | ${q.toFixed(1)} | ${lvl.toFixed(1).padStart(3)} | ${interval.toFixed(1)}s`
    );
  }
}

console.log('\n════════════ 极端场景（nightmare × king 段位）════════════');
{
  const s2 = getTierAiSettings(4000, mulberry32(999));
  const bundle = generateAiDeployment('nightmare', null, mulberry32(123));
  const slotUnits = Object.values(bundle.units || {}).filter(u => u && u.attackCoeff !== undefined);
  const spd = weightedAvgSpeed(slotUnits);
  const mult = 1.0;
  const eff = spd * mult;
  console.log(`nightmare AI 兵种产速 ${spd.toFixed(3)} × mult ${mult.toFixed(3)} = 等效 ${eff.toFixed(3)}`);
  console.log(`vs 玩家 ${(1 * playerSpeed).toFixed(3)} → ${(eff / (1 * playerSpeed)).toFixed(2)}倍; Lv1一组间隔 ${(THRESHOLD / eff).toFixed(1)}s vs 玩家 ${(THRESHOLD / playerSpeed).toFixed(1)}s`);
}

console.log('\n════════════ 结论 ════════════');
const worst = rows.reduce((a, b) => (b.ratio > a.ratio ? b : a), rows[0]);
console.log(`最大倍率: ${worst.tier}/${worst.diff} → ${worst.ratio.toFixed(2)}× 玩家`);
console.log(`nightmare 全段位平均倍率: ${(rows.filter(r => r.diff === 'nightmare').reduce((a, r) => a + r.ratio, 0) / Math.max(1, rows.filter(r => r.diff === 'nightmare').length)).toFixed(2)}×`);
console.log('一致化后: warriorRateMult 恒 1.0，AI 产速由兵种 productionSpeed 决定（与玩家同规则）');
console.log('难度差异改为由兵种品质上限/等级基准/技能档位体现');
