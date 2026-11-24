// 测试: 大厅界面「上阵兵种预览」自适应（P11 补漏 —— 硬编码 slotW=70 导致 6 满编溢出）
// 1) 6 满编在多种屏宽下 slotW 总宽 ≤ 屏宽，且居中不溢出
// 2) 3 上阵（少编）时 slotW 被 maxW=70 钳制，不拉伸过大
// 3) lobby 渲染冒烟（6 满编，iPhone 5 320 极窄屏）无异常
// 4) 2026-11-24：常规屏大厅上阵卡与布阵上阵槽同尺寸，极矮屏退回 65 兜底
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

const { rowItemWidth, rowStartX, LAYOUT_MIN, LAYOUT_DESIGN_MAX, lobbyDeployCardH, DEPLOY_UNIT_SLOT_H } = await import('../src/system/Layout.js');
const ConfigLoader = (await import('../src/data/ConfigLoader.js')).default;
const { Game } = await import('../src/game/Game.js');
const ProfileManager = (await import('../src/meta/ProfileManager.js')).default;

const FULL_SIX = ['swordsman', 'archer', 'spearman', 'scout', 'militia', 'slinger'];

console.log('=== 测试1: 6 满编上阵预览多屏宽不溢出 ===');
{
  const gap = 5, padX = 8;
  const widths = [320, 339, 360, 375, 390, 414, 430];
  for (const w of widths) {
    const slotW = rowItemWidth(6, gap, w, padX, LAYOUT_MIN.lobbySlot, LAYOUT_DESIGN_MAX.lobbySlot);
    const total = 6 * slotW + 5 * gap;
    assert(total <= w, `屏宽 ${w}: 槽宽 ${slotW.toFixed(1)} → 总宽 ${total.toFixed(1)} ≤ ${w}`);
    const startX = rowStartX(6, slotW, gap, w);
    assert(startX >= 0 && startX + total <= w, `屏宽 ${w}: 居中不溢出 (startX=${startX.toFixed(1)})`);
    assert(slotW >= LAYOUT_MIN.lobbySlot, `屏宽 ${w}: 槽宽 ${slotW.toFixed(1)} ≥ min ${LAYOUT_MIN.lobbySlot}`);
  }
}

console.log('=== 测试2: 少编时 maxW=70 钳制不拉伸 ===');
{
  const gap = 5, padX = 8;
  const slotW3 = rowItemWidth(3, gap, 375, padX, LAYOUT_MIN.lobbySlot, LAYOUT_DESIGN_MAX.lobbySlot);
  assert(slotW3 <= 70, `3 上阵 375 屏: 槽宽 ${slotW3.toFixed(1)} ≤ max 70（不拉伸）`);
  const total3 = 3 * slotW3 + 2 * gap;
  assert(total3 <= 375, `3 上阵 375 屏: 总宽 ${total3.toFixed(1)} ≤ 375`);
}

console.log('=== 测试3: lobby 渲染冒烟（6 满编，320 屏）===');
{
  await ConfigLoader.init();
  const game = new Game(canvasStub, ctxProxy, 320, 568); // iPhone 5 极窄屏
  await game.start();
  // 强制 6 满编
  const profile = ProfileManager.get();
  profile.deployment = profile.deployment || {};
  profile.deployment.units = FULL_SIX.slice();
  profile.collectedUnits = profile.collectedUnits || {};
  for (const id of FULL_SIX) profile.collectedUnits[id] = { level: 5, quality: 2 };
  game.screenState = 'lobby';
  let err = null;
  try { game.render(0.016); } catch (e) { err = e; }
  assert(!err, `6 满编 lobby 渲染无异常${err ? '(' + err.message + ')' : ''}`);
}

console.log('=== 测试4: 大厅上阵卡与布阵上阵槽同尺寸（极矮屏例外）===');
{
  const { RenderSystem } = await import('../src/system/RenderSystem.js');
  for (const screenH of [667, 812, 932]) {
    assert(lobbyDeployCardH(screenH) === DEPLOY_UNIT_SLOT_H,
      `屏高 ${screenH}: 大厅卡高 ${lobbyDeployCardH(screenH)} = 布阵槽高 ${DEPLOY_UNIT_SLOT_H}`);
    assert(lobbyDeployCardH(screenH) === RenderSystem.deployLayout(375, screenH).slot.h,
      `屏高 ${screenH}: 大厅卡高与布阵槽高同源`);
  }
  assert(lobbyDeployCardH(568) === 65, 'iPhone5 极矮屏仍用 65 兜底，不挤掉段位区');
  const w = 375;
  const lobbyW = rowItemWidth(6, 5, w, 8, LAYOUT_MIN.unitSlot, LAYOUT_DESIGN_MAX.unitSlot);
  assert(Math.abs(lobbyW - RenderSystem.deployLayout(w, 812).slot.w) < 0.01,
    `大厅槽宽 ${lobbyW.toFixed(1)} 与布阵槽宽一致`);
}

console.log(`\n结果: ${passed} 通过, ${failed} 失败`);
process.exit(failed === 0 ? 0 : 1);
