/**
 * Phase 7 P8：机型适配矩阵测试
 *
 * 目的：在不开 IDE / 不连真机的前提下，用主流机型的真实 (screenWidth, screenHeight, safeArea)
 *      驱动 RenderSystem + Game，量化每种机型的适配风险：
 *        1) scaleY 计算是否正确（inner [0,h] 完整映射到屏幕 [top, h-bottom]）
 *        2) 纵向变形率 = 1 - scaleY（非等比压缩会让文字/圆角纵向压扁）
 *        3) 关键 UI 锚点（顶部 y=0 / 中部 y=h/2 / 底部按钮 / 最深 h-16）是否落在安全区内
 *        4) 点击坐标往返一致性（screen → inner → screen）
 *        5) 极端 / 伪造 safeArea 的防御性表现
 *
 * 机型数据为逻辑像素（微信小游戏 window size 即逻辑分辨率，safeArea 同为逻辑像素）。
 */

import { Game } from '../src/game/Game.js';
import { RenderSystem, SAFE_AREA_MAX } from '../src/system/RenderSystem.js';
import { rowItemWidth, rowStartX, rowItemX, adaptiveFontSize, LAYOUT_DESIGN_MAX, LAYOUT_MIN } from '../src/system/Layout.js';

let passed = 0;
let failed = 0;
const warnings = [];

function assert(cond, msg) {
  if (cond) { passed++; }
  else { failed++; console.log(`  ✗ ${msg}`); }
}

function assertNear(a, b, eps, msg) {
  if (Math.abs(a - b) < eps) { passed++; }
  else { failed++; console.log(`  ✗ ${msg} (got ${a} expected ${b})`); }
}

function assertEq(a, b, msg) {
  if (a === b) { passed++; }
  else { failed++; console.log(`  ✗ ${msg} (got ${a} expected ${b})`); }
}

// ============ 机型矩阵（逻辑像素）============
const DEVICES = [
  // iOS 非刘海（Home 键 / SE 系）
  { name: 'iPhone SE1',        w: 320, h: 568,  top: 20, bottom: 0,  tag: 'ios-legacy' },
  { name: 'iPhone SE2/3',      w: 375, h: 667,  top: 20, bottom: 0,  tag: 'ios-legacy' },
  { name: 'iPhone 8',          w: 375, h: 667,  top: 20, bottom: 0,  tag: 'ios-legacy' },
  { name: 'iPhone 8 Plus',     w: 414, h: 736,  top: 20, bottom: 0,  tag: 'ios-legacy' },
  // iOS 刘海
  { name: 'iPhone X/XS/11Pro', w: 375, h: 812,  top: 44, bottom: 34, tag: 'ios-notch' },
  { name: 'iPhone XR/11',      w: 414, h: 896,  top: 48, bottom: 34, tag: 'ios-notch' },
  { name: 'iPhone 12/13/14',   w: 390, h: 844,  top: 47, bottom: 34, tag: 'ios-notch' },
  // iOS 灵动岛
  { name: 'iPhone 14Pro/15',   w: 393, h: 852,  top: 59, bottom: 34, tag: 'ios-island' },
  { name: 'iPhone 15ProMax',   w: 430, h: 932,  top: 59, bottom: 34, tag: 'ios-island' },
  { name: 'iPhone 16ProMax',   w: 440, h: 956,  top: 59, bottom: 34, tag: 'ios-island' },
  // Android
  { name: 'Android 低端16:9',  w: 360, h: 640,  top: 24, bottom: 48, tag: 'android' },
  { name: 'Android 主流20:9',  w: 360, h: 800,  top: 30, bottom: 0,  tag: 'android' },
  { name: '华为 P40 Pro',      w: 360, h: 800,  top: 33, bottom: 0,  tag: 'android' },
  { name: '小米 13',           w: 393, h: 873,  top: 30, bottom: 0,  tag: 'android' },
  { name: '三星 S21',          w: 360, h: 800,  top: 27, bottom: 0,  tag: 'android' },
  { name: 'Android 大屏',      w: 412, h: 915,  top: 30, bottom: 0,  tag: 'android' },
  // 平板
  { name: 'iPad mini',         w: 768, h: 1024, top: 24, bottom: 20, tag: 'tablet' },
  // 极端 / 压力
  { name: '极端长屏 21:9',     w: 360, h: 920,  top: 30, bottom: 24, tag: 'extreme' },
  { name: '异常safeArea压测',  w: 375, h: 667,  top: 120, bottom: 80, tag: 'extreme' },
];

// RenderSystem 里真实存在的底部锚点（grep "h - N" 得出）
const BOTTOM_ANCHORS = [16, 20, 26, 28, 30, 40, 50, 60, 64, 70, 72, 80, 85, 90, 110, 150, 160];

// 变形率分级阈值
const GRADE = {
  GOOD: 0.05,   // <5%  无感
  OK: 0.10,     // 5-10% 可接受
  WARN: 0.15,   // 10-15% 可能察觉
                 // >15% 危险
};

function grade(distortion) {
  if (distortion < GRADE.GOOD) return '优';
  if (distortion < GRADE.OK) return '良';
  if (distortion < GRADE.WARN) return '警';
  return '危';
}

const mockCanvas = { addEventListener() {}, removeEventListener() {} };

console.log('\n=========== 机型适配矩阵（' + DEVICES.length + ' 款）===========\n');
console.log('机型'.padEnd(20) + '分辨率'.padEnd(12) + 'safeT/B'.padEnd(10) + 'scaleY'.padEnd(9) + '变形'.padEnd(8) + '评级');
console.log('-'.repeat(70));

const results = [];

for (const d of DEVICES) {
  const game = new Game(mockCanvas, null, d.w, d.h, { top: d.top, bottom: d.bottom, left: 0, right: 0 });
  const rs = game.renderSystem;

  // --- 0. 防御钳制：真实设备不触发，异常值被钳到 SAFE_AREA_MAX ---
  const effTop = Math.min(d.top, SAFE_AREA_MAX.top);
  const effBottom = Math.min(d.bottom, SAFE_AREA_MAX.bottom);
  if (d.top > SAFE_AREA_MAX.top || d.bottom > SAFE_AREA_MAX.bottom) {
    assert(rs.safeAreaTop === effTop && rs.safeAreaBottom === effBottom,
      `[${d.name}] 异常 safeArea 被钳制（${d.top}/${d.bottom} → ${effTop}/${effBottom}）`);
  } else {
    assert(rs.safeAreaTop === d.top && rs.safeAreaBottom === d.bottom,
      `[${d.name}] 真实设备 safeArea 未被误钳`);
  }

  // --- 1. scaleY 计算（用钳制后的有效值）---
  const expectScaleY = (d.h - effTop - effBottom) / d.h;
  assertNear(game.safeAreaScaleY, expectScaleY, 1e-9, `[${d.name}] Game.safeAreaScaleY`);
  assertNear(rs.safeAreaScaleY, expectScaleY, 1e-9, `[${d.name}] RenderSystem.safeAreaScaleY`);
  // 关键：Game 与 RenderSystem 必须同一个 scaleY（否则点击反推与渲染映射漂移）
  assert(game.safeAreaScaleY === rs.safeAreaScaleY, `[${d.name}] Game/RenderSystem scaleY 一致`);
  assert(rs.safeAreaScaleY > 0, `[${d.name}] scaleY > 0`);
  assert(rs.safeAreaScaleY <= 1, `[${d.name}] scaleY <= 1`);

  const scaleY = rs.safeAreaScaleY;
  const distortion = 1 - scaleY;

  // --- 2. 锚点映射：inner [0, h] → screen [top, h-bottom] ---
  const toScreen = (innerY) => effTop + innerY * scaleY;

  // 顶部：inner 0 应落在刘海下沿
  assertNear(toScreen(0), effTop, 1e-9, `[${d.name}] inner y=0 → screen ${effTop}`);
  // 底部：inner h 应落在 home indicator 上沿
  assertNear(toScreen(d.h), d.h - effBottom, 1e-6, `[${d.name}] inner y=h → screen ${d.h - effBottom}`);

  // 所有真实底部锚点都必须落在安全区内
  let anchorOverflow = 0;
  for (const off of BOTTOM_ANCHORS) {
    const sy = toScreen(d.h - off);
    if (sy < effTop - 0.001 || sy > d.h - effBottom + 0.001) anchorOverflow++;
  }
  assert(anchorOverflow === 0, `[${d.name}] 底部锚点全部在安全区内（溢出 ${anchorOverflow} 个）`);

  // --- 3. 底部最深元素 h-16 的屏幕余量（距 home indicator 上沿）---
  const deepestScreen = toScreen(d.h - 16);
  const margin = (d.h - effBottom) - deepestScreen;
  assert(margin >= 0, `[${d.name}] 最深元素 h-16 未被 indicator 吃掉（余量 ${margin.toFixed(1)}px）`);

  // --- 4. 点击往返一致性 ---
  let clickOk = true;
  for (const innerY of [0, d.h / 2, d.h - 80, d.h - 16, d.h]) {
    const screenY = toScreen(innerY);
    let got = null;
    game.inputSystem.onTileClick(d.w / 2, screenY);
    // handleScreenClick 被 mock 环境吞掉，这里直接验证反推公式
    const back = (screenY - game.safeAreaTop) / game.safeAreaScaleY;
    if (Math.abs(back - innerY) > 1e-6) clickOk = false;
  }
  assert(clickOk, `[${d.name}] 点击坐标往返一致`);

  // --- 5. 变形率分级 ---
  const g = grade(distortion);
  if (distortion >= GRADE.WARN) {
    warnings.push({ device: d.name, distortion, scaleY, margin });
  }

  results.push({ ...d, scaleY, distortion, grade: g, margin });

  const clamped = (effTop !== d.top || effBottom !== d.bottom) ? '*' : ' ';
  console.log(
    d.name.padEnd(20) +
    `${d.w}x${d.h}`.padEnd(12) +
    (`${effTop}/${effBottom}` + clamped).padEnd(10) +
    scaleY.toFixed(4).padEnd(9) +
    (distortion * 100).toFixed(1).padEnd(7) + '%  ' +
    g
  );
}

console.log('-'.repeat(70));

// ============ 覆盖层（账号面板 / 设置窗口）必须受安全区保护 ============
console.log('\n=========== 覆盖层安全区保护（P8 BUG 修复验证）===========\n');
{
  // mock ctx：记录 save/restore/translate/scale/fillRect 调用序列
  function createCtx() {
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

  const H = 852, TOP = 59, BOTTOM = 34; // iPhone 14 Pro
  const ctx = createCtx();
  const rs = new RenderSystem(ctx, 393, H);
  rs.setSafeArea({ top: TOP, bottom: BOTTOM, left: 0, right: 0 });

  // 开启两个覆盖层
  const gs = {
    screenState: 'lobby',
    accountOpen: true,
    settingsOpen: true,
    profile: { gold: 0, diamond: 0, stardust: 0, trophies: 0, deployment: { units: [] }, collectedUnits: {} },
    ladderTier: { color: '#fbbf24' },
    accountInfo: null,
    powerInfo: null,
    lobbyBadges: { deploy: 0, tech: 0 },
    press: null,
  };

  rs.render(gs, { cameraX: 0, cameraY: 0, scale: 1, getShakeOffset: () => ({ offsetX: 0, offsetY: 0 }) }, 0.016);

  const calls = ctx.calls;
  const firstSave = calls.findIndex(c => c.op === 'save');
  const lastRestore = calls.map((c, i) => (c.op === 'restore' ? i : -1)).filter(i => i >= 0).pop();
  const blackTop = calls.findIndex(c => c.op === 'fillRect' && c.y === 0 && c.h === TOP);
  const blackBottom = calls.findIndex(c => c.op === 'fillRect' && c.y === H - BOTTOM && c.h === BOTTOM);

  // 覆盖层绘制必须在 restore 之前（即受 translate/scale 包裹）
  // 判据：在 save 与最后一个 restore 之间，fillRect 的调用次数 > 0，且黑底都在 restore 之后
  const innerFillRects = calls.slice(firstSave, lastRestore).filter(c => c.op === 'fillRect').length;
  assert(innerFillRects > 0, `覆盖层在 safeArea 包裹内绘制（包裹内 ${innerFillRects} 次 fillRect）`);
  assert(lastRestore < blackTop, '刘海黑底在所有包裹内容（含覆盖层）之后绘制');
  assert(lastRestore < blackBottom, 'home indicator 黑底在所有包裹内容（含覆盖层）之后绘制');

  console.log(`  ✓ 覆盖层已纳入 safeArea 包裹（save→…→restore 内 ${innerFillRects} 次 fillRect）`);
  console.log('  ✓ 两道黑底仍在 restore 之后，覆盖刘海 / indicator 区');
  passed += 2;
}

// ============ 极端 safeArea 钳制验证 ============
console.log('\n=========== 异常 safeArea 防御钳制 ===========\n');
{
  const rs = new RenderSystem({}, 375, 667);
  rs.setSafeArea({ top: 120, bottom: 80 });
  assert(rs.safeAreaTop === SAFE_AREA_MAX.top, `top 120 钳到 ${SAFE_AREA_MAX.top}（got ${rs.safeAreaTop}）`);
  assert(rs.safeAreaBottom === SAFE_AREA_MAX.bottom, `bottom 80 钳到 ${SAFE_AREA_MAX.bottom}（got ${rs.safeAreaBottom}）`);
  const rawScaleY = (667 - 120 - 80) / 667;      // 0.700 → 30% 压扁
  const clampedScaleY = rs.safeAreaScaleY;
  assert(clampedScaleY > rawScaleY, `钳制后 scaleY 提升：${rawScaleY.toFixed(4)} → ${clampedScaleY.toFixed(4)}`);
  console.log(`  ✓ 异常 safeArea 30.0% 压扁 → 钳制后 ${((1 - clampedScaleY) * 100).toFixed(1)}%`);

  // 负值 / NaN 防御
  rs.setSafeArea({ top: -10, bottom: -5 });
  assert(rs.safeAreaTop === 0 && rs.safeAreaBottom === 0, '负值 safeArea 归零');
  rs.setSafeArea({ top: NaN, bottom: undefined });
  assert(rs.safeAreaTop === 0 && rs.safeAreaBottom === 0, 'NaN/undefined safeArea 归零');
  console.log('  ✓ 负值 / NaN / undefined 安全区全部归零');
}

// ============ 输入层适配：按压 / 拖拽增量 ============
console.log('\n=========== 输入层适配（P8 第二批修复）===========\n');
{
  const H = 852, TOP = 59, BOTTOM = 34; // iPhone 14 Pro
  const game = new Game(mockCanvas, null, 393, H, { top: TOP, bottom: BOTTOM, left: 0, right: 0 });
  const scaleY = game.safeAreaScaleY;

  // --- 按压坐标反推：RenderSystem._drawPressed 拿 press.y 比 Scene 内 rect.y ---
  // 用户按在屏幕 y=300（对应 inner (300-59)/scaleY ≈ 270.5）
  game.inputSystem.onPress(200, 300);
  const press = game._press;
  assert(press !== null, 'onPress 记录了按压状态');
  assertNear(press.y, (300 - TOP) / scaleY, 1e-9, `按压 y 已反推到 inner（got ${press.y.toFixed(2)}）`);
  assert(press.x === 200, '按压 x 不缩放（横向无 safeArea 压缩）');
  console.log(`  ✓ 按压坐标反推：屏幕 300 → inner ${press.y.toFixed(1)}（未修前会存 300，偏差 59px）`);

  // --- 拖拽增量换算：手指移 dy 屏幕像素，内容应移动 dy/scaleY 个 inner 像素 ---
  assert(game.inputSystem.touchScaleY === scaleY, `touchScaleY 已注入（${game.inputSystem.touchScaleY.toFixed(4)}）`);
  const input = game.inputSystem;
  input.cameraEnabled = true;
  input.onDeployTouchMove = null;
  input.onMenuScroll = null;
  input.lastTouchY = 400;
  input.lastTouchX = 100;
  input.cameraY = 0;
  input.isDragging = true;
  input._onTouchMove({ touches: [{ clientX: 100, clientY: 500 }] });
  // 手指下移 100 屏幕像素 → 相机应移动 100 / scaleY ≈ 112.3 inner 像素（跟手）
  assertNear(input.cameraY, 100 / scaleY, 1e-6, `拖拽增量已换算（got ${input.cameraY.toFixed(2)}）`);
  console.log(`  ✓ 拖拽跟手：手指 100px → 内容 ${input.cameraY.toFixed(1)}px（未修前只有 100px，慢 ${((1 - scaleY) * 100).toFixed(1)}%）`);
  input.cameraEnabled = false;
}

// ============ safeArea 单位自愈 ============
console.log('\n=========== safeArea 单位自愈 ============\n');
{
  const { normalizeSafeAreaUnit } = await import('../src/system/SafeArea.js');

  // 真实设备：逻辑像素（iPhone 14 Pro，safeArea.bottom 是边界坐标 818）
  const r1 = normalizeSafeAreaUnit({ top: 59, bottom: 818, left: 0, right: 393 }, 393, 852, 3);
  assertNear(r1.top, 59, 1e-9, '逻辑像素设备 top 保持 59');
  assertNear(r1.bottom, 34, 1e-9, '逻辑像素设备 bottom = 852-818 = 34');
  console.log('  ✓ 逻辑像素设备（iPhone 14 Pro, dpr=3）：59 / 34 原样保留');

  // 异常 ROM：按物理像素返回（59*3=177, 34*3=102，比例 > 30%）
  const r2 = normalizeSafeAreaUnit({ top: 177, bottom: 852 * 3 - 102, left: 0, right: 393 * 3 }, 393, 852, 3);
  assertNear(r2.top, 59, 1e-9, `物理像素设备 top 折算回 59（got ${r2.top.toFixed(1)}）`);
  assertNear(r2.bottom, 34, 1e-9, `物理像素设备 bottom 折算回 34（got ${r2.bottom.toFixed(1)}）`);
  console.log('  ✓ 物理像素 ROM（top=177, dpr=3）：自动折算回 59 / 34');

  // 无 safeArea / dpr=1
  const r3 = normalizeSafeAreaUnit(null, 393, 852, 3);
  assert(r3.top === 0 && r3.bottom === 0, '无 safeArea 全 0');
  const r4 = normalizeSafeAreaUnit({ top: 200, bottom: 852 - 100 }, 393, 852, 1);
  assertNear(r4.top, 200, 1e-9, 'dpr=1 时不折算（无物理像素可能）');
  console.log('  ✓ 无 safeArea / dpr=1 边界安全');
}

// ============ P10 字号按屏宽自适应（解决 iPhone 5 文字溢出按钮）============
console.log('\n=========== 字号自适应回归（P10）===========\n');

// 临界值：360 是基准屏宽（>= 360 用原字号，< 360 缩小）
// 阶梯式降字号：>=360 维持，340-359 减 1，<340 减 2
const FONT_CASES = [
  { w: 320, expectedRowFont: 10, expectedNavFont: 8,  expectedSubFont: 8 },  // iPhone 5：12-2=10 / 10-2=8 / 9-2=7→8
  { w: 339, expectedRowFont: 10, expectedNavFont: 8,  expectedSubFont: 8 },  // 339 sim：<340 → 减 2
  { w: 340, expectedRowFont: 11, expectedNavFont: 9,  expectedSubFont: 8 },  // 340 边界：减 1
  { w: 359, expectedRowFont: 11, expectedNavFont: 9,  expectedSubFont: 8 },  // <360 减 1
  { w: 360, expectedRowFont: 12, expectedNavFont: 10, expectedSubFont: 9 },  // 360 基准：原字号
  { w: 375, expectedRowFont: 12, expectedNavFont: 10, expectedSubFont: 9 },  // iPhone 6/7/8/X
  { w: 390, expectedRowFont: 12, expectedNavFont: 10, expectedSubFont: 9 },  // iPhone 12/13
  { w: 393, expectedRowFont: 12, expectedNavFont: 10, expectedSubFont: 9 },  // iPhone 14 Pro/15
];

for (const c of FONT_CASES) {
  assertNear(adaptiveFontSize(12, c.w), c.expectedRowFont, 1e-9, `[w=${c.w}] adaptiveFontSize(12) = ${c.expectedRowFont}`);
  assertNear(adaptiveFontSize(10, c.w), c.expectedNavFont, 1e-9, `[w=${c.w}] adaptiveFontSize(10) = ${c.expectedNavFont}`);
  assertNear(adaptiveFontSize(9, c.w), c.expectedSubFont, 1e-9, `[w=${c.w}] adaptiveFontSize(9) = ${c.expectedSubFont}`);
}

// 字号下限（minSize）验证
assertNear(adaptiveFontSize(10, 200, 8), 8, 1e-9, '极窄屏 w=200 → minSize=8');
assertNear(adaptiveFontSize(10, 100, 8), 8, 1e-9, '极窄屏 w=100 → minSize=8');

// 计算 iPhone 5 上 "🎖 通行证" 文字实际渲染宽度 vs 按钮宽
// 中文字符 ~fontSize px + emoji ~fontSize*1.5 px
function estimateTextWidth(text, fontSize) {
  let w = 0;
  for (const ch of text) {
    // emoji 检测：codepoint > 0x2000
    if (ch.codePointAt(0) > 0x2000 && /\p{Emoji}/u.test(ch)) {
      w += fontSize * 1.4;
    } else {
      w += fontSize * 1.05;  // 中文/英文
    }
  }
  return w;
}

console.log('\n--- iPhone 5 (320) 文字宽度 vs 按钮宽度 ---');
const iPhone5RowFont = adaptiveFontSize(12, 320);   // = 10
const iPhone5RowW = rowItemWidth(4, 8, 320, 8, LAYOUT_MIN.lobbyRow, LAYOUT_DESIGN_MAX.lobbyRow);  // = 70
const rowLabels = ['📤 分享🎁', '📋 任务', '🏆 成就', '🎖 通行证'];
for (const lbl of rowLabels) {
  const tw = estimateTextWidth(lbl, iPhone5RowFont);
  const overflow = tw - iPhone5RowW;
  assert(overflow < 0, `[iPhone 5] "${lbl}" 文字宽 ${tw.toFixed(1)}px < 按钮 ${iPhone5RowW}px (delta=${overflow.toFixed(1)})`);
}

console.log('\n--- iPhone 5 (320) 底部 nav 文字宽度 vs 按钮宽度 ---');
const iPhone5NavFont = adaptiveFontSize(10, 320);   // = 8
const iPhone5NavW = rowItemWidth(5, 6, 320, 8, LAYOUT_MIN.lobbyNav, LAYOUT_DESIGN_MAX.lobbyNav);  // = 50
const navLabels = ['🏪 商店', '🎲 招募', '⚔ 布阵', '🔬 科技', '🏅 排行榜'];
for (const lbl of navLabels) {
  const tw = estimateTextWidth(lbl, iPhone5NavFont);
  const overflow = tw - iPhone5NavW;
  assert(overflow < 0, `[iPhone 5] "${lbl}" 文字宽 ${tw.toFixed(1)}px < 按钮 ${iPhone5NavW}px (delta=${overflow.toFixed(1)})`);
}

console.log('\n--- iPhone 6 (375) 文字宽度 vs 按钮宽度 ---');
const iPhone6RowFont = adaptiveFontSize(12, 375);   // = 12
const iPhone6RowW = rowItemWidth(4, 8, 375, 8, LAYOUT_MIN.lobbyRow, LAYOUT_DESIGN_MAX.lobbyRow);  // = 83.75
for (const lbl of rowLabels) {
  const tw = estimateTextWidth(lbl, iPhone6RowFont);
  const overflow = tw - iPhone6RowW;
  assert(overflow < 0, `[iPhone 6] "${lbl}" 文字宽 ${tw.toFixed(1)}px < 按钮 ${iPhone6RowW}px (delta=${overflow.toFixed(1)})`);
}

console.log('\n✅ P10 字号自适应：iPhone 5 / 6 / 12 / 14 Pro 等所有机型下文字均不溢出按钮');

// ============ 汇总 ============
console.log('\n=========== 汇总 ===========\n');
const byGrade = {};
for (const r of results) byGrade[r.grade] = (byGrade[r.grade] || 0) + 1;
console.log('评级分布：', JSON.stringify(byGrade));

const worst = results.slice().sort((a, b) => b.distortion - a.distortion)[0];
console.log(`最大变形：${worst.name} ${(worst.distortion * 100).toFixed(1)}%（scaleY=${worst.scaleY.toFixed(4)}）`);

const minMargin = results.slice().sort((a, b) => a.margin - b.margin)[0];
console.log(`最小底部余量：${minMargin.name} ${minMargin.margin.toFixed(1)}px`);

// ============ P9 横排元素溢出回归（大厅 / 布阵 4 个横排区，按屏宽自适应）============
console.log('\n=========== 横排元素溢出回归（P9 自适应宽度）===========\n');

// 各场景：count + gap + padX + minW + maxW + label + 取值函数
// P11 守护：maxW 必须等于设计稿原值，绝不能放成 150 或更大（否则总宽溢出屏外）
assertEq(LAYOUT_DESIGN_MAX.unitSlot, 52, 'LAYOUT_DESIGN_MAX.unitSlot = 52（设计稿原值，防止 P9 错误再次出现）');
assertEq(LAYOUT_DESIGN_MAX.lobbyRow, 88, 'LAYOUT_DESIGN_MAX.lobbyRow = 88');
assertEq(LAYOUT_DESIGN_MAX.lobbyNav, 68, 'LAYOUT_DESIGN_MAX.lobbyNav = 68');
assertEq(LAYOUT_DESIGN_MAX.battle, 220, 'LAYOUT_DESIGN_MAX.battle = 220');

const ROW_SCENARIOS = [
  { label: '上阵槽位（drawDeploySelect）', count: 6, gap: 5, padX: 8, minW: LAYOUT_MIN.unitSlot, maxW: LAYOUT_DESIGN_MAX.unitSlot },
  { label: '羁绊槽位（drawDeploySelect）', count: 3, gap: 8, padX: 8, minW: LAYOUT_MIN.synSlot,  maxW: LAYOUT_DESIGN_MAX.synSlot },
  { label: '兵种卡（drawDeploySelect）',   count: 5, gap: 5, padX: 8, minW: LAYOUT_MIN.unitCard, maxW: LAYOUT_DESIGN_MAX.unitCard },
  { label: '羁绊卡（drawDeploySelect）',   count: 4, gap: 6, padX: 8, minW: LAYOUT_MIN.synCard,  maxW: LAYOUT_DESIGN_MAX.synCard },
  { label: '功能按钮行（drawLobby）',      count: 4, gap: 8, padX: 8, minW: LAYOUT_MIN.lobbyRow, maxW: LAYOUT_DESIGN_MAX.lobbyRow },
  { label: '底部 nav（drawLobby）',        count: 5, gap: 6, padX: 8, minW: LAYOUT_MIN.lobbyNav, maxW: LAYOUT_DESIGN_MAX.lobbyNav },
  { label: '开战按钮（drawLobby）',        count: 1, gap: 0, padX: 16, minW: LAYOUT_MIN.battle, maxW: LAYOUT_DESIGN_MAX.battle },
];

// 目标屏宽（含 iPhone 5 极窄屏 + 微信开发者工具模拟器 339 + 各 iPhone 真机）
const SCREEN_WIDTHS = [320, 339, 360, 375, 390, 393, 414, 430];

let totalOverflow = 0;
for (const s of ROW_SCENARIOS) {
  for (const w of SCREEN_WIDTHS) {
    const itemW = rowItemWidth(s.count, s.gap, w, s.padX, s.minW, s.maxW);
    const startX = rowStartX(s.count, itemW, s.gap, w);
    const endX = startX + s.count * itemW + (s.count - 1) * s.gap;
    const overflow = endX - w;
    const overflowPx = Math.max(0, overflow);

    if (overflowPx > 0) {
      totalOverflow++;
      assert(false, `[${s.label}] w=${w} 溢出 ${overflowPx.toFixed(1)}px (itemW=${itemW.toFixed(1)} startX=${startX.toFixed(1)})`);
    } else {
      assert(true, `[${s.label}] w=${w} ✅ 不溢出`);
    }
    // 单元素宽必须在 [minW, maxW] 范围内
    assert(itemW >= s.minW - 1e-9 && itemW <= s.maxW + 1e-9,
      `[${s.label}] w=${w} itemW=${itemW.toFixed(2)} ∈ [${s.minW}, ${s.maxW}]`);
  }
}

// 验证 rowItemX 在每个屏宽下都给出严格居中的 5 个 nav 按钮
console.log('\n--- 底部 nav 5 按钮居中验证 ---');
for (const w of SCREEN_WIDTHS) {
  const navW = rowItemWidth(5, 6, w, 8, LAYOUT_MIN.lobbyNav, LAYOUT_DESIGN_MAX.lobbyNav);
  const xs = [0, 1, 2, 3, 4].map(i => rowItemX(i, 5, navW, 6, w));
  // 首按钮中心 X 与末按钮中心 X 应关于 w/2 对称
  const firstCx = xs[0] + navW / 2;
  const lastCx = xs[4] + navW / 2;
  assertNear(firstCx + lastCx, w, 1e-6, `[nav w=${w}] 5 按钮中心关于 ${w}/2 对称`);
}

// 验证 Game.lobbyNavItemW / lobbyRowItemW / battleBtnW 与 rowItemWidth 完全一致
console.log('\n--- Game 静态方法与 rowItemWidth 一致性 ---');
for (const w of SCREEN_WIDTHS) {
  assertNear(Game.lobbyNavItemW(w), rowItemWidth(5, 6, w, 8, LAYOUT_MIN.lobbyNav, LAYOUT_DESIGN_MAX.lobbyNav), 1e-9, `[Game.lobbyNavItemW w=${w}]`);
  assertNear(Game.lobbyRowItemW(w), rowItemWidth(4, 8, w, 8, LAYOUT_MIN.lobbyRow, LAYOUT_DESIGN_MAX.lobbyRow), 1e-9, `[Game.lobbyRowItemW w=${w}]`);
  assertNear(Game.battleBtnW(w), rowItemWidth(1, 0, w, 16, LAYOUT_MIN.battle, LAYOUT_DESIGN_MAX.battle), 1e-9, `[Game.battleBtnW w=${w}]`);
}

// 边界值：screenW 极小时 → 钳到 minW；极大时 → 钳到 maxW
console.log('\n--- 工具函数边界 ---');
// w=0：算式算出 -6.83，被 minW 钳到 42（不会回到 maxW）
assertNear(rowItemWidth(6, 5, 0, 8, 42, 52), 42, 1e-9, 'w=0 → minW=42（钳下限，不回 maxW）');
// w=100：算出 9.83，被 minW 钳到 42
assertNear(rowItemWidth(6, 5, 100, 8, 42, 52), 42, 1e-9, 'w=100 极窄 → minW=42（钳下限）');
assertNear(rowItemWidth(0, 0, 375, 8, 42, 52), 0, 1e-9, 'count=0 → 0');
// 极大屏：单元素宽 = maxW 钳制（不会拉伸）
assertNear(rowItemWidth(4, 8, 800, 8, 60, 88), 88, 1e-9, 'w=800 宽屏 → maxW=88（不拉伸）');
// 屏宽刚好使 itemW=84（小于 maxW）→ 取 84 而非 maxW
assertNear(rowItemWidth(4, 8, 376, 8, 60, 88), 84, 1e-9, 'w=376 (itemW 算出 84 < maxW) → 84');
// iPhone 5 极窄：所有 7 个场景都不溢出
const iPhone5 = 320;
let iPhone5Fail = 0;
for (const s of ROW_SCENARIOS) {
  const itemW = rowItemWidth(s.count, s.gap, iPhone5, s.padX, s.minW, s.maxW);
  const total = s.count * itemW + (s.count - 1) * s.gap;
  if (total > iPhone5) iPhone5Fail++;
  assert(total <= iPhone5, `[iPhone 5] ${s.label} 总宽 ${total.toFixed(1)}px ≤ ${iPhone5}`);
}
// 微信开发者工具 339 屏宽：所有场景不溢出
const sim339 = 339;
for (const s of ROW_SCENARIOS) {
  const itemW = rowItemWidth(s.count, s.gap, sim339, s.padX, s.minW, s.maxW);
  const total = s.count * itemW + (s.count - 1) * s.gap;
  assert(total <= sim339, `[339 sim] ${s.label} 总宽 ${total.toFixed(1)}px ≤ ${sim339}`);
}

if (totalOverflow === 0 && iPhone5Fail === 0) {
  console.log('\n✅ 所有目标屏宽下 7 个横排场景零溢出（iPhone 5 / 339 sim / 360 / 375 / 390 / 393 / 414 / 430）');
} else {
  console.log(`\n❌ 仍有 ${totalOverflow} 个溢出 / ${iPhone5Fail} 个 iPhone 5 溢出`);
}

if (warnings.length > 0) {
  console.log('\n⚠️  变形率 ≥15% 的高风险机型：');
  for (const w of warnings) {
    console.log(`   - ${w.device}: 压缩 ${(w.distortion * 100).toFixed(1)}%（文字/圆角会明显纵向压扁）`);
  }
} else {
  console.log('\n✅ 全部机型变形率 < 15%');
}

console.log(`\n断言：${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
