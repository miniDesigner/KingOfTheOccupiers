// 测试: 滚动列表裁剪（P14 —— 商店/科技/任务/成就/通行证滚动内容不再盖住顶部按钮）
// 1) 5 个可滚动界面在 metaScrollY=0 与 500（大幅上滚）时渲染冒烟无异常
// 2) 结构守护：每个滚动界面都成对调用 _beginScrollClip/_endScrollClip，且 topY 参数正确
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

const ConfigLoader = (await import('../src/data/ConfigLoader.js')).default;
const { Game } = await import('../src/game/Game.js');
const { RenderSystem } = await import('../src/system/RenderSystem.js');

console.log('=== 测试1: 5 个滚动界面大滚动量渲染冒烟 ===');
{
  await ConfigLoader.init();
  const scenes = ['tech_panel', 'shop', 'quest', 'achievement', 'battle_pass'];
  for (const scene of scenes) {
    const game = new Game(canvasStub, ctxProxy, 320, 568); // iPhone 5 极窄屏
    await game.start();
    game.screenState = scene;
    for (const scroll of [0, 500]) {
      game.metaScrollY = scroll;
      let err = null;
      try { game.render(0.016); } catch (e) { err = e; }
      assert(!err, `${scene} scrollY=${scroll} 渲染无异常${err ? '(' + err.message + ')' : ''}`);
    }
  }
}

console.log('=== 测试2: 滚动裁剪结构守护（begin/end 成对 + topY 正确）===');
{
  const src = (await import('node:fs')).readFileSync(
    new URL('../src/system/RenderSystem.js', import.meta.url), 'utf-8'
  );
  // 2026-11-25：商店/科技页签下移到底部，列表内容顶统一 88，裁剪底用 subpageClipBottom(h)
  const subpageClip = 'this._beginScrollClip(ctx, w, h, SUBPAGE_CONTENT_TOP, subpageClipBottom(h))';
  const subpageCount = src.split(subpageClip).length - 1;
  assert(subpageCount === 2, `商店/科技两处底部分页裁剪（实际 ${subpageCount}）`);
  // 其它滚动界面裁剪起点不变
  for (const { label, topY } of [
    { label: '任务列表', topY: 88 },
    { label: '成就列表', topY: 88 },
    { label: '通行证奖励', topY: 100 },
  ]) {
    assert(src.includes(`this._beginScrollClip(ctx, w, h, ${topY})`),
      `${label} 裁剪 topY=${topY} 存在`);
  }
  const begins = (src.match(/this\._beginScrollClip\(/g) || []).length;
  const ends = (src.match(/this\._endScrollClip\(ctx\);/g) || []).length;
  assert(begins === ends, `begin(${begins}) 与 end(${ends}) 成对`);
  assert(begins === 5, `共 5 个滚动界面启用裁剪（实际 ${begins}）`);

  // P21：底部裁剪——滚动内容不进入左下角返回按钮区域（修复与返回按钮重叠）
  assert(src.includes('const BACK_BTN = { x: 16, w: 80, h: 35, bottom: 16 }'),
    '返回按钮几何抽为模块常量（单一真相源）');
  assert(src.includes('const bottomY = bottomOverride == null'),
    '_beginScrollClip 支持底部分页界面的 bottomOverride 裁剪底');
  assert(src.includes('function subpageClipBottom(screenH)'),
    '底部分页裁剪底 subpageClipBottom 为单一真相源');

  // Game 命中同步：通用列表仍用 scrollViewportBottom，商店/科技改用 subpageViewportBottom
  const gameSrc = (await import('node:fs')).readFileSync(
    new URL('../src/game/Game.js', import.meta.url), 'utf-8'
  );
  const vpCount = (gameSrc.match(/scrollViewportBottom/g) || []).length;
  assert(vpCount >= 4, `Game.scrollViewportBottom 定义+3处通用调用（实际 ${vpCount}）`);
  const svpCount = (gameSrc.match(/subpageViewportBottom/g) || []).length;
  assert(svpCount >= 3, `Game.subpageViewportBottom 定义+商店/科技2处调用（实际 ${svpCount}）`);
}

console.log(`\n结果: ${passed} 通过, ${failed} 失败`);
process.exit(failed === 0 ? 0 : 1);
