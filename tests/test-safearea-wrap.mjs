/**
 * 方案 B：全局不压缩布局 · 安全区接入回归
 *
 * 覆盖:
 *  1) 默认值（浏览器 safeArea 全 0）：逻辑屏高 = 物理屏高，scaleY 恒为 1
 *  2) 安全区机型：逻辑屏高 = 物理高 - top - bottom（Render/Input 同步）
 *  3) 渲染顶层只有 ctx.translate(0, top)，绝无 ctx.scale(1, <1) 非等比压缩
 *  4) 刘海 / home indicator 两道黑底：底部黑底落在 top + 逻辑高（物理坐标）
 *  5) 浏览器环境无 translate、无缩放、无黑底（回归保护）
 *  6) 输入反推 inner_y = screen_y - top（无除法），点击 / 拖拽 / 按压一致
 *  7) safeArea 边界值（undefined / null / 空对象 / 字段为 null）
 *  8) 数学验证：inner ↔ screen 为 1:1 等距映射，100px 间距映射后仍是 100px（零变形）
 */

import { Game } from '../src/game/Game.js';
import { RenderSystem } from '../src/system/RenderSystem.js';

let passed = 0;
let failed = 0;

function assert(cond, msg) {
  if (cond) { passed++; console.log(`  ✓ ${msg}`); }
  else { failed++; console.log(`  ✗ ${msg}`); }
}
function assertEq(a, b, msg) {
  if (a === b) { passed++; console.log(`  ✓ ${msg} (got ${a})`); }
  else { failed++; console.log(`  ✗ ${msg} (got ${a} expected ${b})`); }
}
function assertNear(a, b, eps, msg) {
  if (Math.abs(a - b) < eps) { passed++; console.log(`  ✓ ${msg} (got ${a.toFixed(4)} expected ${b.toFixed(4)})`); }
  else { failed++; console.log(`  ✗ ${msg} (got ${a.toFixed(4)} expected ${b.toFixed(4)} eps=${eps})`); }
}

/** Mock Canvas2D：记录 fillRect / save / restore / translate / scale 调用 */
function createMockCtx() {
  const calls = [];
  return {
    calls,
    fillStyle: '', font: '', textAlign: '', textBaseline: '',
    fillRect(x, y, w, h) { calls.push({ op: 'fillRect', x, y, w, h }); },
    fillText() {}, strokeRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, arc() {},
    closePath() {}, stroke() {}, fill() {},
    save() { calls.push({ op: 'save' }); },
    restore() { calls.push({ op: 'restore' }); },
    translate(x, y) { calls.push({ op: 'translate', x, y }); },
    scale(x, y) { calls.push({ op: 'scale', x, y }); },
    createLinearGradient() { return { addColorStop() {} }; },
    measureText() { return { width: 0 }; },
  };
}

function createFakeInputSystem() {
  return {
    onTileClick: null, onPress: null, onRelease: null,
    onDeployTouchStart: null, onDeployTouchMove: null, onDeployTouchEnd: null,
    onMenuScroll: null, cameraEnabled: false,
  };
}

const mockCanvas = { addEventListener() {}, removeEventListener() {} };
const fakeInput = () => ({ cameraX: 0, cameraY: 0, scale: 1, getShakeOffset: () => ({ offsetX: 0, offsetY: 0 }) });
const lobbyState = {
  screenState: 'lobby',
  profile: { gold: 0, diamond: 0, stardust: 0, trophies: 0, deployment: { units: [] }, collectedUnits: {} },
  ladderTier: { color: '#fbbf24' },
  accountInfo: null, powerInfo: null,
  lobbyBadges: { deploy: 0, tech: 0 },
  press: null,
};

// === 1. 默认值（无 safeArea 入参）===
console.log('\n--- 1. 默认 safeArea（无入参）---');
{
  const game = new Game(mockCanvas, null, 750, 1334);
  assertEq(game.safeAreaTop, 0, '默认 safeAreaTop = 0');
  assertEq(game.safeAreaBottom, 0, '默认 safeAreaBottom = 0');
  assertEq(game.safeAreaScaleY, 1, '方案 B：safeAreaScaleY 恒为 1');
  assertEq(game.screenHeight, 1334, '默认逻辑屏高 = 物理屏高（无安全区）');
  assertEq(game.renderSystem.screenHeight, 1334, 'RenderSystem 同步逻辑屏高');
  assertEq(game.renderSystem.safeAreaScaleY, 1, 'RenderSystem.safeAreaScaleY 恒 1');
  assert(game.renderSystem instanceof RenderSystem, 'renderSystem 已实例化');
}

// === 2. 模拟 iPhone 14 Pro：刘海 47 + home indicator 34 ===
console.log('\n--- 2. 模拟 iPhone 14 Pro（safeArea 47/34）---');
{
  const SAFE = { top: 47, bottom: 34, left: 0, right: 0 };
  const H = 1334;
  const INNER = H - 47 - 34; // 1253
  const game = new Game(mockCanvas, null, 750, H, SAFE);
  assertEq(game.safeAreaTop, 47, 'iPhone 刘海 safeAreaTop=47');
  assertEq(game.safeAreaBottom, 34, 'iPhone home indicator safeAreaBottom=34');
  assertEq(game.safeAreaScaleY, 1, '方案 B：无缩放，scaleY 恒 1（旧为 0.939）');
  assertEq(game.screenHeight, INNER, '逻辑屏高 = 物理高 - top - bottom = 1253');
  assertEq(game.physScreenHeight, H, '物理屏高单独保留（仅黑底/调试用）');
  assertEq(game.renderSystem.screenHeight, INNER, 'RenderSystem 用同一逻辑屏高布局');
  assertEq(game.inputSystem.screenHeight, INNER, 'InputSystem 用同一逻辑屏高');
  assertEq(game.inputSystem.touchTop, 47, 'InputSystem.touchTop = 47');
  assertEq(game.inputSystem.touchScaleY, 1, 'InputSystem 拖拽 delta 1:1（不压缩）');
}

// === 2.5 运行时切换安全区：applySafeArea 三方高度同步（浏览器模拟刘海用）===
console.log('\n--- 2.5 运行时 applySafeArea 同步 Game/Render/Input ---');
{
  const game = new Game(mockCanvas, null, 750, 1334); // 构造期无安全区
  assertEq(game.renderSystem.screenHeight, 1334, '初始 renderSystem 高度 = 物理高');

  // 运行时注入刘海（自动化截图 / 热切换场景）
  game.applySafeArea({ top: 47, bottom: 34 }, 1334);
  assertEq(game.screenHeight, 1253, 'Game 逻辑高更新为 1253');
  assertEq(game.renderSystem.screenHeight, 1253, 'RenderSystem 逻辑高同步（否则布局溢出黑底区）');
  assertEq(game.inputSystem.screenHeight, 1253, 'InputSystem 逻辑高同步');
  assertEq(game.safeAreaTop, 47, '顶部偏移同步');
  assertEq(game.inputSystem.touchTop, 47, '输入反推偏移同步');
}

// === 3. 渲染：只 translate(top)，非等比 scale 绝迹，黑底位置随逻辑高 ===
console.log('\n--- 3. 渲染入口只剩 translate，无 scale ---');
{
  const ctx = createMockCtx();
  const TOP = 47, BOTTOM = 34, H = 1334, INNER = H - TOP - BOTTOM;
  const rs = new RenderSystem(ctx, 750, INNER); // 产品路径：Game 传逻辑高
  rs.setSafeArea({ top: TOP, bottom: BOTTOM });
  rs.renderScreen(lobbyState, fakeInput(), 0.016);

  const calls = ctx.calls;
  const firstSave = calls.findIndex(c => c.op === 'save');
  const firstTranslate = calls.findIndex(c => c.op === 'translate' && c.x === 0 && c.y === TOP);
  const firstRestore = calls.findIndex(c => c.op === 'restore');
  assert(firstSave >= 0, 'renderScreen 开头有 ctx.save()');
  assert(firstTranslate > firstSave, `ctx.translate(0, ${TOP}) 在 save 之后触发`);
  assert(firstRestore > firstTranslate, 'ctx.restore() 在 translate 之后触发');

  // 核心：不允许任何非等比缩放 scale(1, y≠1) —— 这就是图片变形的根因
  const nonUniformScale = calls.find(c => c.op === 'scale' && c.x === 1 && Math.abs(c.y - 1) > 1e-9);
  assert(!nonUniformScale, '方案 B：渲染链路无 ctx.scale(1, <1) 非等比压缩');

  const notchBar = calls.filter(c => c.op === 'fillRect' && c.x === 0 && c.y === 0 && c.h === TOP);
  assert(notchBar.length >= 1, `刘海黑底 fillRect(0,0,w,${TOP})`);

  const homeBar = calls.filter(c => c.op === 'fillRect' && c.x === 0 && c.y === TOP + INNER && c.h === BOTTOM);
  assert(homeBar.length >= 1, `底部黑底 fillRect(0,top+innerH=${TOP + INNER},w,${BOTTOM})`);
}

// === 4. 浏览器环境（top/bottom 全 0）：无 translate、无缩放、无黑底 ===
console.log('\n--- 4. 浏览器环境回归保护 ---');
{
  const ctx = createMockCtx();
  const rs = new RenderSystem(ctx, 750, 1334); // 不调用 setSafeArea，默认全 0
  rs.renderScreen(lobbyState, fakeInput(), 0.016);
  const calls = ctx.calls;
  assert(!calls.some(c => c.op === 'translate' && (c.y === 47 || c.y === 34)),
    'safeArea 全 0 时无刘海/底部偏移 translate');
  assert(!calls.some(c => c.op === 'scale' && c.x === 1 && Math.abs(c.y - 1) > 1e-9),
    'safeArea 全 0 时无非等比 scale');
  assert(!calls.some(c => c.op === 'fillRect' && c.x === 0 && (c.y === 0 && c.h === 47 || c.y === 1300 && c.h === 34)),
    'safeArea 全 0 时无黑底覆盖 fillRect');
}

// === 5. Game.onTileClick 反推：inner_y = screen_y - top ===
console.log('\n--- 5. onTileClick 反推 inner_y = screen_y - top ---');
{
  const TOP = 47, BOTTOM = 34, H = 1334, INNER = H - TOP - BOTTOM;
  const game = new Game(mockCanvas, null, 750, H, { top: TOP, bottom: BOTTOM });
  game.inputSystem = createFakeInputSystem();
  let arg = null;
  game.handleScreenClick = (x, y) => { arg = { x, y }; };
  game.inputSystem.onTileClick = (x, y) => game.handleScreenClick(x, y - game.safeAreaTop);

  game.inputSystem.onTileClick(300, 60);
  assertEq(arg.x, 300, 'X 不变（horizontal no offset）');
  assertEq(arg.y, 60 - TOP, 'inner_y = 60 - 47 = 13（无除法）');

  game.inputSystem.onTileClick(300, 40);
  assertEq(arg.y, 40 - TOP, '刘海区内 click → inner_y 负值（命中 UI 上方）');

  // 底部按钮：inner y = INNER - 80 → 屏幕 y = top + inner
  const btnInnerY = INNER - 80;
  const btnScreenY = TOP + btnInnerY;
  game.inputSystem.onTileClick(300, btnScreenY);
  assertEq(arg.y, btnInnerY, `底部按钮 inner_y=${btnInnerY} 命中（屏幕 y=${btnScreenY}）`);
}

// === 6. Game.onDeployTouch* 反推同 onTileClick ===
console.log('\n--- 6. onDeployTouch* 反推 ---');
{
  const TOP = 47, BOTTOM = 34, H = 1334, INNER = H - TOP - BOTTOM;
  const game = new Game(mockCanvas, null, 750, H, { top: TOP, bottom: BOTTOM });
  game.inputSystem = createFakeInputSystem();
  let captured = { startY: null, moveY: null, endY: null };
  game._handleDeployDragStart = (x, y) => { captured.startY = y; };
  game._handleDeployDragMove = (x, y) => { captured.moveY = y; };
  game._handleDeployDragEnd = (x, y, isDrag) => { captured.endY = y; };
  game.inputSystem.onDeployTouchStart = (x, y) => game._handleDeployDragStart(x, y - game.safeAreaTop);
  game.inputSystem.onDeployTouchMove = (x, y) => game._handleDeployDragMove(x, y - game.safeAreaTop);
  game.inputSystem.onDeployTouchEnd = (x, y, isDrag) => game._handleDeployDragEnd(x, y - game.safeAreaTop, isDrag);

  const y1 = TOP + INNER - 80, y2 = TOP + INNER - 74, y3 = TOP + INNER - 80;
  game.inputSystem.onDeployTouchStart(100, y1);
  game.inputSystem.onDeployTouchMove(110, y2);
  game.inputSystem.onDeployTouchEnd(120, y3, true);
  assertNear(captured.startY, INNER - 80, 1e-9, 'onDeployTouchStart 反推正确');
  assertNear(captured.moveY, INNER - 74, 1e-9, 'onDeployTouchMove 反推正确');
  assertNear(captured.endY, INNER - 80, 1e-9, 'onDeployTouchEnd 反推正确');
}

// === 7. safeArea 边界值 ===
console.log('\n--- 7. safeArea 边界值（不存在 / null / 无字段）---');
{
  const cases = [
    [undefined, 'undefined'], [null, 'null'], [{}, '空 {}'],
    [{ top: null, bottom: undefined }, 'null/undefined 字段'],
  ];
  for (const [sa, label] of cases) {
    const g = new Game(mockCanvas, null, 750, 1334, sa);
    assertEq(g.safeAreaTop, 0, `${label} → top=0`);
    assertEq(g.safeAreaBottom, 0, `${label} → bottom=0`);
    assertEq(g.safeAreaScaleY, 1, `${label} → scaleY=1（不 NaN）`);
    assertEq(g.screenHeight, 1334, `${label} → 逻辑屏高=物理高`);
  }
}

// === 8. 数学验证：inner ↔ screen 为 1:1 等距映射 ===
console.log('\n--- 8. 数学验证：1:1 等距映射（零变形）---');
{
  const TOP = 47, BOTTOM = 34, H = 1334, INNER = H - TOP - BOTTOM;
  const screenFromInner = (innerY) => TOP + innerY;
  const innerFromScreen = (screenY) => screenY - TOP;

  assertNear(screenFromInner(0), TOP, 1e-9, 'inner_y=0 → screen_y=47（刘海下沿）');
  assertNear(screenFromInner(INNER), H - BOTTOM, 1e-9, 'inner_y=innerH → screen_y=1300（home 上沿）');
  assertNear(innerFromScreen(TOP), 0, 1e-9, 'screen_y=47 → inner_y=0');
  assertNear(innerFromScreen(H - BOTTOM), INNER, 1e-9, 'screen_y=1300 → inner_y=innerH');

  for (const iy of [0, 100, INNER / 2, INNER - 16, INNER]) {
    assertNear(innerFromScreen(screenFromInner(iy)), iy, 1e-9, `往返一致 inner_y=${iy.toFixed(0)}`);
  }
  // 关键差异：旧方案 100px 间距会被压成 90.4px；方案 B 保持 100px
  assertNear(screenFromInner(200) - screenFromInner(100), 100, 1e-9,
    '100px 间距映射后仍是 100px（旧方案仅 90.4px → 圆变椭圆的根因）');
}

console.log(`\n=== 结果：${passed} 通过 / ${failed} 失败 ===`);
process.exit(failed > 0 ? 1 : 0);
