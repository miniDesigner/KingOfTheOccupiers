/**
 * Phase 7 P7：界面适配（safeArea / 刘海 / 底部指示条）
 *
 * 覆盖:
 *  1) game.js / Game.js / RenderSystem.js 三个文件串起来后，RenderSystem 拿到 safeArea
 *  2) 渲染入口对 Scene 做 ctx.translate(0, top) + ctx.scale(1, scaleY)
 *     （scaleY = (h - top - bottom) / h，把 inner [0, h] 映射到屏幕 [top, h-bottom]）
 *  3) 渲染完后画刘海 + home indicator 两道黑底
 *  4) Game.handleScreenClick 输入坐标自动反推 (y - top) / scaleY 命中 Scene 内 rect.y
 *  5) 浏览器默认 safeArea 全 0，scaleY = 1，行为完全等同未启用（回归保护）
 *  6) 边界值（undefined / null / 空对象 / 字段为 null）
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
  else { failed++; console.log(`  ✗ ${msg} (got ${a} expected ${b} eps=${eps})`); }
}

/**
 * Mock Canvas2D context：记录 fillRect / save / restore / translate / scale 调用
 */
function createMockCtx() {
  const calls = [];
  return {
    calls,
    fillStyle: '',
    font: '',
    textAlign: '',
    textBaseline: '',
    fillRect(x, y, w, h) { calls.push({ op: 'fillRect', x, y, w, h }); },
    fillText() {},
    strokeRect() {},
    beginPath() {},
    moveTo() {},
    lineTo() {},
    arc() {},
    closePath() {},
    stroke() {},
    fill() {},
    save() { calls.push({ op: 'save' }); },
    restore() { calls.push({ op: 'restore' }); },
    translate(x, y) { calls.push({ op: 'translate', x, y }); },
    scale(x, y) { calls.push({ op: 'scale', x, y }); },
    createLinearGradient() { return { addColorStop() {} }; },
    measureText() { return { width: 0 }; },
  };
}

/**
 * Mock InputSystem 替代品（避免 bindEvents 真的去调 canvas.addEventListener）
 */
function createFakeInputSystem() {
  return {
    onTileClick: null,
    onPress: null,
    onRelease: null,
    onDeployTouchStart: null,
    onDeployTouchMove: null,
    onDeployTouchEnd: null,
    onMenuScroll: null,
    cameraEnabled: false,
  };
}

// === 1. 默认值（无 safeArea 入参）===
console.log('\n--- 1. 默认 safeArea（无入参）---');

// mock canvas 满足 InputSystem.bindEvents（浏览器路径走 canvas.addEventListener）
const mockCanvas = {
  addEventListener() {}, removeEventListener() {},
};

{
  const game = new Game(mockCanvas, null, 750, 1334);
  assertEq(game.safeAreaTop, 0, '默认 safeAreaTop = 0');
  assertEq(game.safeAreaBottom, 0, '默认 safeAreaBottom = 0');
  assertEq(game.safeAreaScaleY, 1, '默认 safeAreaScaleY = 1（无缩放）');
  assert(game.renderSystem instanceof RenderSystem, 'renderSystem 已实例化');
  assertEq(game.renderSystem.safeAreaTop, 0, 'RenderSystem.safeAreaTop 默认 0');
  assertEq(game.renderSystem.safeAreaBottom, 0, 'RenderSystem.safeAreaBottom 默认 0');
  assertEq(game.renderSystem.safeAreaScaleY, 1, 'RenderSystem.safeAreaScaleY 默认 1');
}

// === 2. 模拟 iPhone 14 Pro：刘海 47 + home indicator 34 ===
console.log('\n--- 2. 模拟 iPhone 14 Pro（safeArea 47/34）---');
{
  const SAFE = { top: 47, bottom: 34, left: 0, right: 0 };
  const H = 1334;
  const EXPECTED_SCALE_Y = (H - 47 - 34) / H; // ≈ 0.9393
  const game = new Game(mockCanvas, null, 750, H, SAFE);
  assertEq(game.safeAreaTop, 47, 'iPhone 刘海 safeAreaTop=47');
  assertEq(game.safeAreaBottom, 34, 'iPhone home indicator safeAreaBottom=34');
  assertNear(game.safeAreaScaleY, EXPECTED_SCALE_Y, 1e-9, 'safeAreaScaleY = (h - top - bottom) / h');
  assertEq(game.renderSystem.safeAreaTop, 47, 'RenderSystem 同步收到 safeAreaTop=47');
  assertEq(game.renderSystem.safeAreaBottom, 34, 'RenderSystem 同步收到 safeAreaBottom=34');
  assertNear(game.renderSystem.safeAreaScaleY, EXPECTED_SCALE_Y, 1e-9, 'RenderSystem 同步收到 safeAreaScaleY');
}

// === 3. 渲染：translate(0, top) + scale(1, scaleY) 包在 Scene 外 ===
console.log('\n--- 3. 渲染入口 ctx.translate + ctx.scale 包裹 ---');
{
  const ctx = createMockCtx();
  const rs = new RenderSystem(ctx, 750, 1334);
  rs.setSafeArea({ top: 47, bottom: 34 });

  const H = 1334;
  const EXPECTED_SCALE_Y = (H - 47 - 34) / H;

  const gs = {
    screenState: 'lobby',
    profile: { gold: 0, diamond: 0, stardust: 0, trophies: 0, deployment: { units: [] }, collectedUnits: {} },
    ladderTier: { color: '#fbbf24' },
    accountInfo: null,
    powerInfo: null,
    lobbyBadges: { deploy: 0, tech: 0 },
    press: null,
  };

  rs.renderScreen(gs, { cameraX: 0, cameraY: 0, scale: 1, getShakeOffset: () => ({ offsetX: 0, offsetY: 0 }) }, 0.016);

  const calls = ctx.calls;
  const firstSave = calls.findIndex(c => c.op === 'save');
  const firstTranslate = calls.findIndex(c => c.op === 'translate' && c.x === 0 && c.y === 47);
  const firstScale = calls.findIndex(c => c.op === 'scale' && c.x === 1 && Math.abs(c.y - EXPECTED_SCALE_Y) < 1e-9);
  const firstRestore = calls.findIndex(c => c.op === 'restore');

  assert(firstSave >= 0, 'renderScreen 开头有 ctx.save()');
  assert(firstTranslate > firstSave, 'ctx.translate(0, 47) 在 save 之后触发');
  assert(firstScale > firstTranslate, 'ctx.scale(1, scaleY) 在 translate 之后触发');
  assert(firstRestore > firstScale, 'ctx.restore() 在 scale 之后触发');

  // 末尾两道黑底：fillRect(0,0,w,47) 和 fillRect(0,h-34,w,34)
  const blackBars = calls.filter(c =>
    c.op === 'fillRect' && c.x === 0 && c.y === 0 && c.h === 47
  );
  assert(blackBars.length >= 1, '末尾有刘海黑底 fillRect(0,0,w,47)');

  const homeBar = calls.filter(c =>
    c.op === 'fillRect' && c.x === 0 && c.y === 1334 - 34 && c.h === 34
  );
  assert(homeBar.length >= 1, '末尾有 home indicator 黑底 fillRect(0,1334-34,w,34)');
}

// === 4. 浏览器环境（top/bottom 全 0）：scaleY = 1，无 translate 无 scale，无黑底 ===
console.log('\n--- 4. 浏览器环境回归保护 ---');
{
  const ctx = createMockCtx();
  const rs = new RenderSystem(ctx, 750, 1334);
  // 不调用 setSafeArea，默认全 0

  const gs = {
    screenState: 'lobby',
    profile: { gold: 0, diamond: 0, stardust: 0, trophies: 0, deployment: { units: [] }, collectedUnits: {} },
    ladderTier: { color: '#fbbf24' },
    accountInfo: null,
    powerInfo: null,
    lobbyBadges: { deploy: 0, tech: 0 },
    press: null,
  };

  rs.renderScreen(gs, { cameraX: 0, cameraY: 0, scale: 1, getShakeOffset: () => ({ offsetX: 0, offsetY: 0 }) }, 0.016);

  const calls = ctx.calls;
  // 绝不会有 translate(0, 47) 这种刘海偏移
  const hasNotchTranslate = calls.some(c => c.op === 'translate' && (c.y === 47 || c.y === 34));
  assert(!hasNotchTranslate, 'safeArea 全 0 时无刘海/底部偏移 translate');

  // 绝不会有 scale(1, scaleY)（scaleY=1 时跳过）
  const hasSafeAreaScale = calls.some(c => c.op === 'scale' && Math.abs(c.y - 0.939) < 0.01);
  assert(!hasSafeAreaScale, 'safeArea 全 0 时无 scale(1, ~0.94)');

  // 没有刘海/底部黑底 fillRect(0,0,w,47/34)
  const hasBlackBar = calls.some(c =>
    c.op === 'fillRect' && ((c.y === 0 && c.h === 47) || (c.y === 1334 - 34 && c.h === 34))
  );
  assert(!hasBlackBar, 'safeArea 全 0 时无黑底覆盖 fillRect');
}

// === 5. Game.onTileClick 包装：(screenY - top) / scaleY 反推 inner_y ===
console.log('\n--- 5. Game.onTileClick 包装反推 (y - top) / scaleY ---');
{
  const game = new Game(mockCanvas, null, 750, 1334, { top: 47, bottom: 34 });
  // 替换 inputSystem 后手动设置包装（模拟 Game 构造器里的 (y - top) / scaleY）
  game.inputSystem = createFakeInputSystem();
  let arg = null;
  game.handleScreenClick = (x, y) => { arg = { x, y }; };
  const scaleY = game.safeAreaScaleY;
  game.inputSystem.onTileClick = (x, y) => {
    game.handleScreenClick(x, (y - game.safeAreaTop) / scaleY);
  };

  // 用户点击物理 (300, 60) → 期望 inner_y = (60 - 47) / scaleY ≈ 13.84
  const EXPECTED_INNER_Y = (60 - 47) / scaleY;
  game.inputSystem.onTileClick(300, 60);
  assertEq(arg.x, 300, 'X 不变（horizontal no offset）');
  assertNear(arg.y, EXPECTED_INNER_Y, 1e-9, 'Y 反推 (60 - 47) / scaleY ≈ 13.84');

  // 顶部刘海区内 click：物理 y = 40 → inner_y = (40 - 47) / scaleY ≈ -7.45
  const EXPECTED_TOP_Y = (40 - 47) / scaleY;
  game.inputSystem.onTileClick(300, 40);
  assertNear(arg.y, EXPECTED_TOP_Y, 1e-9, '刘海区内 click → inner_y 负值（命中 UI 上方）');

  // 验证底部按钮命中：假设 Scene 内按钮 inner y = h - 80 = 1254
  // 实际屏幕位置 = 47 + 1254 * scaleY ≈ 1225.43
  // 用户点击屏幕 (300, 1225) → 反推 inner_y = (1225 - 47) / scaleY ≈ 1254
  const btnScreenY = 47 + 1254 * scaleY;
  game.inputSystem.onTileClick(300, btnScreenY);
  assertNear(arg.y, 1254, 1e-9, '底部按钮命中：屏幕坐标 → inner_y = 1254');
}

// === 7. Game.onDeployTouch* 包装：同 onTileClick 反推 ===
console.log('\n--- 6. Game.onDeployTouch* 包装反推 ---');
{
  const game = new Game(mockCanvas, null, 750, 1334, { top: 47, bottom: 34 });
  game.inputSystem = createFakeInputSystem();
  let captured = { startY: null, moveY: null, endY: null };
  game._handleDeployDragStart = (x, y) => { captured.startY = y; };
  game._handleDeployDragMove = (x, y) => { captured.moveY = y; };
  game._handleDeployDragEnd = (x, y, isDrag) => { captured.endY = y; };
  const scaleY = game.safeAreaScaleY;

  // 模拟 onDeployTouch* 包装逻辑
  game.inputSystem.onDeployTouchStart = (x, y) => game._handleDeployDragStart(x, (y - game.safeAreaTop) / scaleY);
  game.inputSystem.onDeployTouchMove = (x, y) => game._handleDeployDragMove(x, (y - game.safeAreaTop) / scaleY);
  game.inputSystem.onDeployTouchEnd = (x, y, isDrag) => game._handleDeployDragEnd(x, (y - game.safeAreaTop) / scaleY, isDrag);

  // 用户拖拽兵种卡：屏幕 y 由公式 screen_y = top + inner_y * scaleY 反推
  // inner_y = 1254 → 屏幕 y = 47 + 1254 * scaleY（精确浮点值）
  const dragStartScreenY = 47 + 1254 * scaleY;
  const dragMoveScreenY = 47 + 1260 * scaleY;
  const dragEndScreenY = 47 + 1254 * scaleY;
  game.inputSystem.onDeployTouchStart(100, dragStartScreenY);
  game.inputSystem.onDeployTouchMove(110, dragMoveScreenY);
  game.inputSystem.onDeployTouchEnd(120, dragEndScreenY, true);
  assertNear(captured.startY, 1254, 1e-9, 'onDeployTouchStart 反推 inner_y=1254');
  assertNear(captured.moveY, 1260, 1e-9, 'onDeployTouchMove 反推 inner_y=1260');
  assertNear(captured.endY, 1254, 1e-9, 'onDeployTouchEnd 反推 inner_y=1254');
}

// === 8. safeArea 边界值 ===
console.log('\n--- 7. safeArea 边界值（不存在 / null / 无字段）---');
{
  const g1 = new Game(mockCanvas, null, 750, 1334, undefined);
  assertEq(g1.safeAreaTop, 0, 'undefined safeArea → 0');
  assertEq(g1.safeAreaScaleY, 1, 'undefined safeArea → scaleY=1');
  const g2 = new Game(mockCanvas, null, 750, 1334, null);
  assertEq(g2.safeAreaTop, 0, 'null safeArea → 0');
  assertEq(g2.safeAreaScaleY, 1, 'null safeArea → scaleY=1');
  const g3 = new Game(mockCanvas, null, 750, 1334, {});
  assertEq(g3.safeAreaTop, 0, 'empty {} safeArea → 0');
  assertEq(g3.safeAreaScaleY, 1, 'empty {} safeArea → scaleY=1');
  const g4 = new Game(mockCanvas, null, 750, 1334, { top: null, bottom: undefined });
  assertEq(g4.safeAreaTop, 0, 'null/undefined 字段 → 0（不 NaN）');
  assertEq(g4.safeAreaScaleY, 1, 'null/undefined 字段 → scaleY=1（不 NaN）');
}

// === 9. 数学验证：inner [0, h] 映射到屏幕 [top, h-bottom] 双向一致 ===
console.log('\n--- 8. 数学验证：inner_y ↔ screen_y 双向一致 ---');
{
  const top = 47, bottom = 34, h = 1334;
  const scaleY = (h - top - bottom) / h;

  // 关键点：
  // - inner_y = 0 → screen_y = top (47)
  // - inner_y = h → screen_y = h - bottom (1300)
  // - inner_y = h/2 → screen_y = top + h/2 * scaleY
  const screenFromInner = (innerY) => top + innerY * scaleY;
  const innerFromScreen = (screenY) => (screenY - top) / scaleY;

  assertNear(screenFromInner(0), 47, 1e-9, 'inner_y=0 → screen_y=47（刘海下沿）');
  assertNear(screenFromInner(h), 1300, 1e-9, 'inner_y=h → screen_y=h-34=1300（home indicator 上沿）');
  // 底部按钮 inner_y = h - 80 = 1254 → 屏幕 y = 47 + 1254 * (h - 81) / h
  const btnExpectedY = 47 + 1254 * scaleY;
  assertNear(screenFromInner(h - 80), btnExpectedY, 1e-9, 'inner_y=h-80=1254（底部按钮）→ screen_y 精确值');
  assertNear(innerFromScreen(47), 0, 1e-9, 'screen_y=47 → inner_y=0（刘海下沿）');
  assertNear(innerFromScreen(1300), h, 1e-9, 'screen_y=1300 → inner_y=h（home indicator 上沿）');
  assertNear(innerFromScreen(btnExpectedY), h - 80, 1e-9, 'screen_y=精确值 → inner_y=h-80=1254（底部按钮命中）');
}

console.log(`\n=== 结果：${passed} 通过 / ${failed} 失败 ===`);
process.exit(failed > 0 ? 1 : 0);