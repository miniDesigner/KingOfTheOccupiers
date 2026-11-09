// 测试: 视觉放大（2026-11 玩法改造）
// 覆盖:
//   1. hex.size = 52（压缩前 32）
//   2. 11×7 棋盘像素尺寸：宽 ~689 / 高 ~884（750 宽屏 fitScale=1，格面观感 = 旧 20×11 @32）
//   3. fitScale 适配公式下限 0.5（Game.js / InputSystem 一致）
//   4. 兵种圆盘直径 ≤ 纵向格心距（多队堆叠不重叠）
//   5. 建筑图标/等级/血量字号放大（24/13/14）
const noop = () => {};
const canvasStub = { width: 400, height: 700, addEventListener: noop, removeEventListener: noop };
global.document = { getElementById: () => canvasStub, addEventListener: noop, removeEventListener: noop, body: { appendChild: noop }, hidden: false };
global.window = { innerWidth: 400, innerHeight: 700, requestAnimationFrame: () => 0, addEventListener: noop, removeEventListener: noop, AudioContext: class {} };
global.requestAnimationFrame = () => 0;
global.localStorage = { _d: {}, getItem(k) { return this._d[k] ?? null; }, setItem(k, v) { this._d[k] = String(v); }, removeItem(k) { delete this._d[k]; } };
global.wx = {};
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
const { HexMap } = await import('../src/world/HexMap.js');
const { BOARD_LAYOUTS } = await import('../src/data/levels.js');

// ============ 1. 格子尺寸 ============
console.log('=== 测试1: hex.size = 52 ===');
const HEX_SIZE = ConfigLoader.get('game').hex.size;
assert(HEX_SIZE === 52, `hex.size = ${HEX_SIZE}（改造前 32，单格面积 ×2.64）`);

// ============ 2. 棋盘像素尺寸 ============
console.log('=== 测试2: 11×7 棋盘像素尺寸 ===');
{
  const layout = BOARD_LAYOUTS[0]; // plains 无障碍
  const map = new HexMap();
  map.generate(layout.cols, layout.rows, []);
  assert(layout.rows === 11 && layout.cols === 7, `全部布局行列 = 11×7（77 格，改造前 20×11=220 格）`);
  const b = map.getBounds();
  console.log(`  棋盘: ${b.width.toFixed(0)} × ${b.height.toFixed(0)} px（@size=${map.size}）`);
  // 理论值: 宽 (7-0.5)·√3·52 + 2·52 ≈ 689；高 (11-1)·1.5·52 + 2·52 ≈ 884
  assert(Math.abs(b.width - 689) < 12, `棋盘宽 ≈ 689（实际 ${b.width.toFixed(0)}）`);
  assert(Math.abs(b.height - 884) < 12, `棋盘高 ≈ 884（实际 ${b.height.toFixed(0)}）`);
  assert(map.getAllTiles().length === 77, `总格数 = 77（实际 ${map.getAllTiles().length}）`);
}

// ============ 3. 相机适配 ============
console.log('=== 测试3: fitScale 适配（750 宽屏） ===');
{
  const map = new HexMap();
  map.generate(7, 11, []);
  const b = map.getBounds();
  // Game.js initBattle 的相机适配公式
  const fit = (screenW, screenH) => Math.max(0.5, Math.min(
    1, screenW / (b.width + 40), (screenH * 0.86) / (b.height + 40)));
  const s750 = fit(750, 1334);
  const s1080 = fit(1080, 1920);
  console.log(`  750×1334 → ${s750.toFixed(3)}；1080×1920 → ${s1080.toFixed(3)}`);
  assert(s750 >= 0.9 && s750 <= 1.0, `750 屏 fitScale ∈ [0.9, 1]（实际 ${s750.toFixed(3)}，满幅显示）`);
  assert(s1080 === 1.0, `1080 屏 fitScale = 1（实际 ${s1080.toFixed(3)}）`);
  assert(fit(320, 500) >= 0.5, `极小屏仍被下限 0.5 托底（实际 ${fit(320, 500).toFixed(3)}，旧下限 0.35）`);
}

// ============ 4. 兵种圆盘不重叠 ============
console.log('=== 测试4: 兵种圆盘尺寸约束 ===');
{
  // RenderSystem.js:677 新公式（与源码同步维护）
  const baseRadius = (warriors, quality) => 10 + Math.min(8, warriors / 4) + (quality - 1) * 0.6;
  const maxR = baseRadius(200, 6); // 满编+红品质上限
  const cellPitch = 1.5 * HEX_SIZE; // 纵向格心距
  console.log(`  圆盘最大半径 = ${maxR.toFixed(1)}（直径 ${(maxR * 2).toFixed(0)}），纵向格心距 = ${cellPitch}`);
  assert(maxR * 2 <= cellPitch, `圆盘直径 ≤ 格心距（${(maxR * 2).toFixed(0)} ≤ ${cellPitch}，上下相邻两队不重叠）`);
  assert(baseRadius(20, 1) === 15, `小队白品质半径 = 15（最小可见性提升，旧公式 12）`);
}

// ============ 5. 渲染字号常量 ============
console.log('=== 测试5: 渲染字号放大常量 ===');
{
  const src = rf(ROOT + 'src/system/RenderSystem.js', 'utf-8');
  assert(src.includes('bold 24px sans-serif'), '建筑图标字号 24（旧 15）');
  assert(src.includes("'13px sans-serif'"), '建筑等级字号 13（旧 9）');
  assert(src.includes('bold 14px sans-serif'), '兵种有效生命值字号 14（旧 10）');
  assert(src.includes('baseRadius * 1.5'), '兵种图标字号倍率 ×1.5（旧 ×1.3）');
  const srcGame = rf(ROOT + 'src/game/Game.js', 'utf-8');
  assert(srcGame.includes('Math.max(0.5, fitScale)'), 'Game.js 相机下限 0.5（旧 0.35）');
  const srcInput = rf(ROOT + 'src/system/InputSystem.js', 'utf-8');
  const clamps = (srcInput.match(/Math\.max\(0\.5, Math\.min\(2\.0/g) || []).length;
  assert(clamps === 2, `InputSystem 滚轮/双指两处钳制 0.5~2.0（实际 ${clamps} 处）`);
}

console.log(`\n========== 结果: ${passed} 通过, ${failed} 失败 ==========`);
process.exit(failed > 0 ? 1 : 0);
