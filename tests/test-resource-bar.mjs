/**
 * 资源栏统一显示冒烟测试
 * 验证：
 *  1. 所有独立界面（布阵/科技/商店/任务/通行证/招募/排行榜）叠加绘制统一资源栏
 *  2. 布阵界面兵种详情弹窗打开时，资源栏绘制在弹窗之后（弹窗之上可见）
 *  3. 各界面左上角货币簇包含 💰💎⭐🏆 四项（P16：资源统一移左上角）
 */
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

// ===== 浏览器全局 stub =====
global.document = {
  createElement: () => ({ getContext: () => null, style: {} }),
  addEventListener: () => {},
  removeEventListener: () => {},
  getElementById: () => null,
};
global.window = { addEventListener: () => {}, removeEventListener: () => {} };
global.localStorage = {
  _d: {},
  getItem(k) { return this._d[k] ?? null; },
  setItem(k, v) { this._d[k] = String(v); },
  removeItem(k) { delete this._d[k]; },
};
global.fetch = async (path) => {
  const rel = String(path).replace('../', '');
  const fs = await import('fs');
  const fp = join(ROOT, rel);
  const content = fs.readFileSync(fp, 'utf-8');
  return { ok: true, json: async () => JSON.parse(content) };
};

const { default: ConfigLoader, syncConfigToStatics } = await import('../src/config.js');
await ConfigLoader.init();
syncConfigToStatics();

const { RenderSystem } = await import('../src/system/RenderSystem.js');

// ===== Canvas 2D 上下文 stub（记录调用） =====
// 任意方法返回值：可继续链式调用任意方法/属性（如 createLinearGradient().addColorStop）
const makeAny = () => {
  const f = () => any;
  const any = new Proxy(f, {
    get: (t, p) => {
      if (p === Symbol.toPrimitive || p === 'valueOf' || p === 'toString') return () => 0;
      return any;
    },
    apply: () => any,
  });
  return any;
};

function makeCtx() {
  const calls = [];
  const ctx = {
    calls,
    canvas: { width: 720, height: 1280 },
  };
  const handler = {
    get(target, prop) {
      if (prop === 'calls') return calls;
      if (prop in target) return target[prop];
      // 方法调用均记录；返回值支持链式调用
      return (...args) => { calls.push({ m: String(prop), args }); return makeAny(); };
    },
    set(target, prop, value) { target[prop] = value; return true; },
  };
  return new Proxy(ctx, handler);
}

// fillText 便捷提取
const textsOf = (ctx) => ctx.calls.filter(c => c.m === 'fillText').map(c => c.args[0]);

let pass = 0, fail = 0;
const assert = (cond, msg) => {
  if (cond) { pass++; console.log(`  ✓ ${msg}`); }
  else { fail++; console.error(`  ✗ ${msg}`); }
};

const W = 360, H = 640;
const profile = { gold: 12345, diamond: 67, stardust: 890, trophies: 2345, getTechNodeLevel: () => 0 };
const ladderTier = { color: '#22d3ee', name: '黄金' };

function renderScreenAt(state) {
  const ctx = makeCtx();
  const rs = new RenderSystem(ctx, W, H);
  const gameState = Object.assign({
    profile, ladderTier,
    metaScrollY: 0,
    screenState: 'tech_panel',
  }, state);
  rs.renderScreen(gameState, { cameraX: 0, cameraY: 0, scale: 1 }, 0.016);
  return { ctx, rs, gameState };
}

console.log('\n=== 1. 各独立界面叠加统一资源栏 ===');
const screens = ['deploy_select', 'tech_panel', 'shop', 'quest', 'battle_pass', 'gacha', 'leaderboard'];
for (const s of screens) {
  const { ctx } = renderScreenAt({ screenState: s });
  const texts = textsOf(ctx);
  assert(
    texts.includes('12345') && texts.includes('67') && texts.includes('890') && texts.includes('2345'),
    `${s}: 货币簇显示 💰12345 💎67 ⭐890 🏆2345`
  );
  // 顶栏底色应在货币文字之前绘制
  const fillRects = ctx.calls.filter(c => c.m === 'fillRect');
  const barBg = fillRects.find(c => c.args[2] === W && c.args[3] === 50);
  const firstValue = ctx.calls.findIndex(c => c.m === 'fillText' && c.args[0] === '12345');
  const barBgIdx = ctx.calls.indexOf(barBg);
  assert(!!barBg && barBgIdx >= 0 && barBgIdx < firstValue, `${s}: 顶栏底色(0,0,${W},50)先于货币文字`);
}

console.log('\n=== 2. 兵种详情弹窗打开时资源栏仍在其上绘制 ===');
{
  const ctx = makeCtx();
  const rs = new RenderSystem(ctx, W, H);
  const order = [];
  const origPopup = rs._drawUnitDetailPanel.bind(rs);
  const origBar = rs._drawResourceBar.bind(rs);
  rs._drawUnitDetailPanel = (gs) => { order.push('popup'); origPopup(gs); };
  rs._drawResourceBar = (gs) => { order.push('bar'); origBar(gs); };
  const unit = {
    id: 'swordsman', name: '剑士', icon: '⚔', quality: 3, level: 2,
    combatStyles: ['melee'], attackCoeff: 1.0, hpCoeff: 1.0, speedCoeff: 1.0,
    rangeCoeff: 1.0, productionCoeff: 1.0, productionSpeed: 1.0, attackRange: 1,
    recruitRequired: 2, recruitCount: 3, upgradeCost: { starDust: 100, gold: 200 },
    skills: [],
  };
  rs.renderScreen({
    screenState: 'deploy_select',
    profile, ladderTier,
    metaScrollY: 0,
    deploymentSummary: { units: [] },
    collectedSynergies: [],
    collectedUnits: [],
    deployDrag: { active: false },
    unitDetailId: 'swordsman',
    unitDetailData: unit,
  }, { cameraX: 0, cameraY: 0, scale: 1 }, 0.016);

  assert(order.includes('popup'), '兵种详情面板被绘制');
  assert(order.includes('bar'), '资源栏被绘制');
  assert(order.indexOf('popup') < order.indexOf('bar'), '资源栏绘制于弹窗之后（叠加在弹窗之上）');
  const texts = textsOf(ctx);
  assert(texts.includes('12345') && texts.includes('890'), '弹窗之上货币簇内容完整');
}

console.log('\n=== 3. 羁绊详情/招募弹窗同场景 ===');
{
  const ctx = makeCtx();
  const rs = new RenderSystem(ctx, W, H);
  const order = [];
  const origBar = rs._drawResourceBar.bind(rs);
  rs._drawResourceBar = (gs) => { order.push('bar'); origBar(gs); };
  rs.renderScreen({
    screenState: 'deploy_select',
    profile, ladderTier,
    metaScrollY: 0,
    deploymentSummary: { units: [] },
    collectedSynergies: [],
    collectedUnits: [],
    deployDrag: { active: false },
    showRecruitPanel: true,
    recruitableUnits: [],
    synergyDetailId: 'synergy_x',
    synergyDetailData: { id: 'synergy_x', name: '测试羁绊', quality: 2, effects: [], level: 1 },
  }, { cameraX: 0, cameraY: 0, scale: 1 }, 0.016);
  assert(order.includes('bar'), '招募/羁绊弹窗场景资源栏仍绘制');
}

console.log('\n=== 4. 货币簇位于左上角且不越界 ===');
{
  const { ctx } = renderScreenAt({ screenState: 'tech_panel' });
  const fillRects = ctx.calls.filter(c => c.m === 'fillRect');
  // 簇背景：宽 120 高 42，左缘距屏幕左边界 8
  const cluster = fillRects.find(c => c.args[2] === 120 && c.args[3] === 42);
  assert(!!cluster, '货币簇背景 120×42 存在');
  if (cluster) {
    const [x, y, w, h] = cluster.args;
    assert(x >= 8 - 0.01, `簇左缘 ${x} ≥ 8（留 8px 左边距）`);
    assert(x + w <= W, `簇右缘 ${x + w} ≤ ${W}（不越界）`);
    assert(y >= 0 && y + h <= 50, `簇纵向 ${y}~${y + h} 位于顶栏 0~50 内`);
    // P16：资源簇定位左上角，返回按钮已移左下角，顶部不再冲突
    assert(x === 8, `簇左缘 ${x} 定位左上角(=8)`);
  }
}

console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
process.exit(fail > 0 ? 1 : 0);
