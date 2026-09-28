// 测试: 科技树界面最多两列 + 自适应布局
// 1) techNodeWidth / techTabWidth 在多屏宽下不溢出且居中
// 2) 配置层所有节点 col <= 1（最多两列，含 mil_synergy 从 col=2 挪到 col=1）
// 3) tech_panel 4 个分支渲染冒烟无异常
// 4) 命中框与渲染同源（Game 用同一 techNodeWidth/techTabWidth）
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

const { techNodeWidth, techTabWidth, rowStartX } = await import('../src/system/Layout.js');
const ConfigLoader = (await import('../src/data/ConfigLoader.js')).default;
const { Game } = await import('../src/game/Game.js');

console.log('=== 测试1: 科技树节点（2列）多屏宽不溢出 ===');
{
  const widths = [320, 339, 360, 375, 390, 414, 430];
  for (const w of widths) {
    const nodeW = techNodeWidth(w);
    const total = 2 * nodeW + 10; // 2 列 + 1 gap
    assert(total <= w, `屏宽 ${w}: 节点宽 ${nodeW.toFixed(1)} → 总宽 ${total.toFixed(1)} ≤ ${w}`);
    assert(nodeW >= 120 && nodeW <= 150, `屏宽 ${w}: 节点宽 ${nodeW.toFixed(1)} ∈ [120,150]`);
    const startX = rowStartX(2, nodeW, 10, w);
    assert(startX >= 0 && startX + total <= w, `屏宽 ${w}: 居中不溢出 (startX=${startX.toFixed(1)})`);
  }
}

console.log('=== 测试2: 科技树分支标签（4个）多屏宽不溢出 ===');
{
  const widths = [320, 339, 360, 375, 390, 414];
  for (const w of widths) {
    const tabW = techTabWidth(w);
    const total = 4 * tabW + 3 * 4;
    assert(total <= w, `屏宽 ${w}: tab 宽 ${tabW.toFixed(1)} → 总宽 ${total.toFixed(1)} ≤ ${w}`);
    const startX = rowStartX(4, tabW, 4, w);
    assert(startX >= 0, `屏宽 ${w}: tab 起始 X ≥ 0 (startX=${startX.toFixed(1)})`);
  }
}

console.log('=== 测试3: 配置层所有节点 col <= 1（最多两列）===');
{
  await ConfigLoader.init();
  const tech = ConfigLoader.getSafe('techTree');
  assert(!!tech && !!tech.branches, 'techTree 配置已加载');
  let maxCol = 0;
  const offenders = [];
  for (const [bk, branch] of Object.entries(tech.branches)) {
    for (const node of branch.nodes) {
      const col = node.position?.col ?? 0;
      if (col > maxCol) maxCol = col;
      if (col > 1) offenders.push(`${bk}/${node.id}=col${col}`);
    }
  }
  assert(maxCol <= 1, `所有节点最大 col=${maxCol}（应 ≤1，最多两列）`);
  assert(offenders.length === 0, `无越界节点${offenders.length ? ': ' + offenders.join(',') : ''}`);
}

console.log('=== 测试4: tech_panel 4 分支渲染冒烟 ===');
{
  const game = new Game(canvasStub, ctxProxy, 320, 568); // iPhone 5 极窄屏
  await game.start();
  game.screenState = 'tech_panel';
  const branches = Object.keys(ConfigLoader.getSafe('techTree').branches);
  for (const bk of branches) {
    game.selectedTechBranch = bk;
    game.metaScrollY = 0;
    let err = null;
    try { game.render(0.016); } catch (e) { err = e; }
    assert(!err, `分支 ${bk} 渲染无异常${err ? '(' + err.message + ')' : ''}`);
  }
}

console.log(`\n结果: ${passed} 通过, ${failed} 失败`);
process.exit(failed === 0 ? 0 : 1);
