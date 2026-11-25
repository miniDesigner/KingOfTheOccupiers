/**
 * 商店列表滚动上界守护测试（2026-11-25）
 * 问题：商店 metaScrollY 无上界，列表被一路推走后只剩背景与底部按钮。
 * 口径：与任务/成就一致 —— 最后一张卡片（或短列表的福利日历说明卡）
 *       底边贴到可视区底就停，Game 的滚动增量与 gameState 双处收敛。
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
  else { failed++; console.error(`  ❌ ${msg}`); }
}

const ConfigLoader = (await import('../src/data/ConfigLoader.js')).default;
await ConfigLoader.init();
const { RenderSystem, subpageClipBottom } = await import('../src/system/RenderSystem.js');

const W = 430, H = 854;
const mkCats = (counts) => counts.map((c, i) => ({ categoryId: `c${i}`, items: Array.from({ length: c }, (_, j) => ({ id: `i${i}_${j}` })) }));

console.log('=== 测试1: 长列表滚到上界时最后一张卡片贴底 ===');
{
  const cats = mkCats([2, 12, 3, 1]);
  const tab = 1;
  const maxScroll = RenderSystem.shopMaxScroll(cats, tab, W, H);
  assert(maxScroll > 0, `长列表存在可滚范围（实际 ${maxScroll}）`);
  const L = RenderSystem.shopLayout(W, cats.length, H);
  const lastY = RenderSystem.shopItemTop(cats[tab].items.length - 1, maxScroll, L);
  const bottom = lastY + L.itemH;
  assert(Math.abs(bottom - subpageClipBottom(H)) < 0.001,
    `滚到上界时最后一张卡片贴可视区底（实际 ${bottom} / ${subpageClipBottom(H)}）`);
  assert(RenderSystem.shopMaxScroll(cats, 0, W, H) >= 0,
    '带福利日历的短分类上界非负');
}

console.log('=== 测试2: 短列表/空列表上界为 0（不产生反向空白） ===');
{
  const cats = mkCats([2, 5, 3, 1]);
  assert(RenderSystem.shopMaxScroll(cats, 0, W, H) === 0, '2 件商品的免费页不可滚');
  assert(RenderSystem.shopMaxScroll(cats, 3, W, H) === 0, '1 件商品的分类不可滚');
  assert(RenderSystem.shopMaxScroll([], 0, W, H) === 0, '空列表上界为 0');
  assert(RenderSystem.shopMaxScroll(cats, 99, W, H) === 0, '越界分页上界为 0');
}

console.log('=== 测试3: Game 按商店内容计算上界并双处收敛 ===');
{
  const gameSrc = rf(ROOT + 'src/game/Game.js', 'utf-8');
  assert(gameSrc.includes("this.screenState === 'shop'"), 'Game 存在商店分支');
  assert(gameSrc.includes('RenderSystem.shopMaxScroll('), '商店分支调用 shopMaxScroll 计算上界');
  assert(gameSrc.includes('Math.min(metaMaxScroll, Math.max(0, this.metaScrollY + dy))'),
    '滚动增量按 metaMaxScroll 收敛（商店共用）');
  assert(gameSrc.includes('this.screenState === \'deploy_select\' ? this.deployMaxScroll() : metaMaxScroll'),
    'gameState 的 metaScrollY 对商店同样收敛');
  const rsSrc = rf(ROOT + 'src/system/RenderSystem.js', 'utf-8');
  assert(rsSrc.includes('contentBottom - subpageClipBottom(screenHeight)'),
    '商店上界与绘制/命中共用 subpageClipBottom 底边');
}

console.log(`\n结果: ${passed} 通过, ${failed} 失败`);
process.exit(failed > 0 ? 1 : 0);
