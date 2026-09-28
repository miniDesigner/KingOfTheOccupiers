/**
 * InputSystem 微信 / 浏览器双环境绑定测试
 *
 * 关键背景：WX Canvas2D 没有 addEventListener()，必须用 wx.onTouchStart/Move/End。
 * 浏览器 DOM canvas 走 addEventListener 路径（含 mouse/wheel 桌面调试）。
 *
 * 覆盖：
 *   1. WX 环境：bindEvents 调用 wx.onTouchStart/Move/End，**不**调用 canvas.addEventListener
 *   2. WX 环境：不绑定 mouse/wheel（手机端无鼠标）
 *   3. WX 环境：模拟触摸事件 → onTileClick 触发
 *   4. WX 环境：onPress / onRelease 按压回调链通
 *   5. WX 环境：双指缩放 distance 计算
 *   6. WX 环境：touchcancel 复用 end 逻辑
 *   7. 浏览器环境：addEventListener 走 DOM 路径（含 mouse/wheel）
 *   8. 浏览器环境：wx.onTouchStart 不被调用
 *   9. 跨环境：构造期无 wx 时不抛
 *  10. 跨环境：handleTap 在 onTileClick=null 时 console.warn 不抛
 */

import { InputSystem } from '../src/system/InputSystem.js';

let pass = 0, fail = 0;
const results = [];

function assert(label, cond) {
  if (cond) { pass++; results.push({ label, ok: true }); }
  else { fail++; results.push({ label, ok: false }); }
}

/**
 * 构造一个带 spy 的 fake canvas（DOM 风格）
 */
function makeDomCanvas() {
  const listeners = {};
  return {
    _listeners: listeners,
    addEventListener(type, cb) { listeners[type] = cb; },
    removeEventListener(type) { delete listeners[type]; },
  };
}

/**
 * 模拟 WX 触摸 API，记录注册的回调
 */
function installWxTouchShim() {
  const cbs = {};
  globalThis.wx = {
    onTouchStart(cb) { cbs.onTouchStart = cb; },
    onTouchMove(cb)  { cbs.onTouchMove = cb; },
    onTouchEnd(cb)   { cbs.onTouchEnd = cb; },
    onTouchCancel(cb){ cbs.onTouchCancel = cb; },
  };
  return cbs;
}

function uninstallWx() {
  delete globalThis.wx;
}

// ============ 1. WX 环境 ============
console.log('\n=== [1] WX 环境：wx.onTouchStart/Move/End 路径 ===');

{
  const cbs = installWxTouchShim();
  const canvas = makeDomCanvas(); // 即便有 addEventListener 也不应被调
  const input = new InputSystem(canvas, 375, 667);

  assert('WX-1.1  调用了 wx.onTouchStart', typeof cbs.onTouchStart === 'function');
  assert('WX-1.2  调用了 wx.onTouchMove', typeof cbs.onTouchMove === 'function');
  assert('WX-1.3  调用了 wx.onTouchEnd', typeof cbs.onTouchEnd === 'function');
  assert('WX-1.4  调用了 wx.onTouchCancel', typeof cbs.onTouchCancel === 'function');
  assert('WX-1.5  未调用 canvas.addEventListener (touchstart)', !canvas._listeners.touchstart);
  assert('WX-1.6  未调用 canvas.addEventListener (mousedown)', !canvas._listeners.mousedown);
  assert('WX-1.7  未调用 canvas.addEventListener (wheel)', !canvas._listeners.wheel);

  // 模拟 touchstart → onTileClick 链路
  let clicked = null;
  input.onTileClick = (x, y) => { clicked = { x, y }; };
  cbs.onTouchStart({ touches: [{ clientX: 100, clientY: 200 }] });
  cbs.onTouchEnd({ changedTouches: [{ clientX: 100, clientY: 200 }] });
  assert('WX-1.8  touchstart→end 触发 onTileClick(100,200)', clicked && clicked.x === 100 && clicked.y === 200);

  // onPress / onRelease 链路
  let pressed = null, released = null;
  input.onPress = (x, y) => { pressed = { x, y }; };
  input.onRelease = (x, y) => { released = { x, y }; };
  cbs.onTouchStart({ touches: [{ clientX: 50, clientY: 60 }] });
  cbs.onTouchEnd({ changedTouches: [{ clientX: 50, clientY: 60 }] });
  assert('WX-1.9  onPress(50,60) 触发', pressed && pressed.x === 50);
  assert('WX-1.10 onRelease(50,60) 触发', released && released.x === 50);

  // 双指缩放
  input.cameraEnabled = true;
  cbs.onTouchStart({
    touches: [
      { clientX: 0,  clientY: 0 },
      { clientX: 100, clientY: 0 },
    ],
  });
  const scaleBefore = input.scale;
  cbs.onTouchMove({
    touches: [
      { clientX: 0,  clientY: 0 },
      { clientX: 200, clientY: 0 }, // 距离翻倍
    ],
  });
  assert('WX-1.11 双指 distance 翻倍 → scale 增大', input.scale > scaleBefore);

  // touchcancel 复用 end 逻辑
  let cancelClicked = null;
  input.onTileClick = (x, y) => { cancelClicked = { x, y }; };
  cbs.onTouchStart({ touches: [{ clientX: 30, clientY: 40 }] });
  cbs.onTouchCancel({ changedTouches: [{ clientX: 30, clientY: 40 }] });
  assert('WX-1.12 touchcancel 复用 end → 触发 onTileClick', cancelClicked && cancelClicked.x === 30);

  uninstallWx();
}

// ============ 2. 浏览器环境 ============
console.log('\n=== [2] 浏览器环境：addEventListener DOM 路径 ===');

{
  const canvas = makeDomCanvas();
  // 确保全局无 wx（或 wx 无 onTouchStart）
  uninstallWx();
  const input = new InputSystem(canvas, 375, 667);

  assert('BR-2.1  绑定了 canvas.addEventListener touchstart', typeof canvas._listeners.touchstart === 'function');
  assert('BR-2.2  绑定了 canvas.addEventListener touchmove', typeof canvas._listeners.touchmove === 'function');
  assert('BR-2.3  绑定了 canvas.addEventListener touchend', typeof canvas._listeners.touchend === 'function');
  assert('BR-2.4  绑定了 canvas.addEventListener mousedown', typeof canvas._listeners.mousedown === 'function');
  assert('BR-2.5  绑定了 canvas.addEventListener wheel', typeof canvas._listeners.wheel === 'function');

  // DOM touchstart → onTileClick
  let clicked = null;
  input.onTileClick = (x, y) => { clicked = { x, y }; };
  canvas._listeners.touchstart({ touches: [{ clientX: 10, clientY: 20 }] });
  canvas._listeners.touchend({ changedTouches: [{ clientX: 10, clientY: 20 }] });
  assert('BR-2.6  DOM touchstart→end 触发 onTileClick', clicked && clicked.x === 10);

  // DOM mousedown/mouseup
  let mouseClicked = null;
  input.onTileClick = (x, y) => { mouseClicked = { x, y }; };
  canvas._listeners.mousedown({ clientX: 70, clientY: 80 });
  canvas._listeners.mouseup({ clientX: 70, clientY: 80 });
  assert('BR-2.7  DOM mousedown→mouseup 触发 onTileClick', mouseClicked && mouseClicked.x === 70);

  // wheel：cameraEnabled=false + onMenuScroll → 触发滚动
  let scrolled = 0;
  input.onMenuScroll = (dy) => { scrolled = dy; };
  canvas._listeners.wheel({ deltaY: 50, preventDefault() {} });
  assert('BR-2.8  菜单态 wheel → onMenuScroll(50)', scrolled === 50);
}

// ============ 3. 跨环境健壮性 ============
console.log('\n=== [3] 跨环境健壮性 ===');

{
  uninstallWx();
  const canvas = makeDomCanvas();

  // 无任何全局 wx
  assert('CR-3.1  无 wx 时构造不抛', (() => {
    try { new InputSystem(canvas, 100, 100); return true; }
    catch (e) { console.error(e); return false; }
  })());

  // wx 存在但 onTouchStart 不是 function（兼容层）
  globalThis.wx = { getStorageSync() { return ''; } };
  assert('CR-3.2  wx 无 onTouchStart 时降级 DOM', (() => {
    try {
      const inp = new InputSystem(canvas, 100, 100);
      return typeof canvas._listeners.touchstart === 'function';
    } catch (e) { console.error(e); return false; }
  })());

  uninstallWx();
}

// ============ 4. handleTap console.warn 兜底 ============
console.log('\n=== [4] handleTap 兜底 ===');

{
  const canvas = makeDomCanvas();
  uninstallWx();
  const input = new InputSystem(canvas, 100, 100);
  // onTileClick 未设 → handleTap → console.warn 但不抛
  const origWarn = console.warn;
  let warned = false;
  console.warn = (...args) => { if (String(args[0]).includes('onTileClick')) warned = true; };
  try {
    input.handleTap(1, 2);
    assert('HW-4.1  onTileClick=null 时 console.warn 不抛', warned);
  } finally {
    console.warn = origWarn;
  }
}

// ============ 汇总 ============
console.log(`\n========== ${pass} passed / ${fail} failed ==========`);
if (fail > 0) {
  for (const r of results) {
    if (!r.ok) console.log('  ✗', r.label);
  }
  process.exit(1);
}

// 防止 lint 误判 unused
void results;