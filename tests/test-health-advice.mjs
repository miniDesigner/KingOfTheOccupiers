// 测试: 健康游戏忠告（加载页常驻显示的版号必查项）
// 验证三点：① 标准文案逐字准确；② 布局在进度卡下方且不出屏；③ 加载页真的调用了绘制。
const noop = () => {};

// ===== 全局 stub（Game.js 顶层依赖）=====
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
  width: 430, height: 932, style: {},
  getContext: () => ctxProxy,
  addEventListener: noop, removeEventListener: noop,
  getBoundingClientRect: () => ({ left: 0, top: 0, width: 430, height: 932 }),
};
global.document = {
  getElementById: () => canvasStub,
  addEventListener: noop, removeEventListener: noop,
  createElement: () => canvasStub,
  body: { appendChild: noop, removeChild: noop },
  hidden: false,
};
global.window = {
  innerWidth: 430, innerHeight: 932, devicePixelRatio: 1,
  addEventListener: noop, removeEventListener: noop,
  requestAnimationFrame: () => 0, cancelAnimationFrame: noop,
  AudioContext: class {},
  location: { href: 'http://127.0.0.1:8890/preview/index.html', reload: noop },
};
global.requestAnimationFrame = () => 0;
global.localStorage = { _d: {}, getItem(k) { return this._d[k] ?? null; }, setItem(k, v) { this._d[k] = String(v); }, removeItem(k) { delete this._d[k]; } };
global.wx = {
  createInnerAudioContext() {
    return { src: '', loop: false, volume: 1, play: noop, pause: noop, stop: noop, seek: noop, destroy: noop, onEnded: noop, onError: noop, onCanplay: noop };
  },
};
Object.defineProperty(global, 'navigator', { value: { userAgent: 'node-test' }, configurable: true });
global.performance = { now: () => Date.now() };
global.alert = noop;
global.Audio = class { constructor() { this.volume = 1; } play() { return Promise.resolve(); } pause() {} addEventListener() {} };

let passed = 0, failed = 0;
function check(name, cond, extra = '') {
  if (cond) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; console.error(`  ❌ ${name}${extra ? ': ' + extra : ''}`); }
}

const {
  HEALTH_ADVICE_TITLE, HEALTH_ADVICE_LINES, healthAdviceLayout, drawHealthAdvice,
} = await import('../src/system/HealthAdvice.js');
const { Game } = await import('../src/game/Game.js');

const EXPECTED_LINES = [
  '抵制不良游戏，拒绝盗版游戏。',
  '注意自我保护，谨防受骗上当。',
  '适度游戏益脑，沉迷游戏伤身。',
  '合理安排时间，享受健康生活。',
];

console.log('=== 测试1: 标准文案 ===');
check('标题为「健康游戏忠告」', HEALTH_ADVICE_TITLE === '健康游戏忠告');
check('正文共 4 句', HEALTH_ADVICE_LINES.length === 4);
check('四句逐字与标准文本一致', EXPECTED_LINES.every((s, i) => HEALTH_ADVICE_LINES[i] === s));

console.log('=== 测试2: 布局（渲染单一真相源）===');
for (const [w, h] of [[430, 932], [375, 667], [414, 896]]) {
  const L = healthAdviceLayout(w, h);
  const ys = [L.title.y, ...L.lines.map(r => r.y)];
  const cardBottom = h * 0.66 + 84; // 加载进度卡底边（Game.renderLoadingScreen）
  const pctY = h * 0.66 + 60;       // 「加载中…」百分比文字
  check(`${w}×${h} 底板在进度卡下方且不越界`,
    L.panel.y > cardBottom && L.panel.y + L.panel.h <= h - 24 && L.panel.w <= w - 32);
  check(`${w}×${h} 底板水平居中`, L.panel.x === (w - L.panel.w) / 2);
  check(`${w}×${h} 五行严格自上而下`, ys.every((y, i) => i === 0 || y > ys[i - 1]));
  check(`${w}×${h} 全部水平居中`, L.title.x === w / 2 && L.lines.every(r => r.x === w / 2));
  check(`${w}×${h} 文字全部落在底板内`,
    Math.min(...ys) > L.panel.y && Math.max(...ys) < L.panel.y + L.panel.h);
  check(`${w}×${h} 位于进度卡与百分比下方`, Math.min(...ys) > cardBottom && Math.min(...ys) > pctY);
  check(`${w}×${h} 未越出屏幕底部`, Math.max(...ys) < h);
}

console.log('=== 测试3: 绘制函数真的写出文案 ===');
{
  const calls = [];
  const fills = [];
  const ctx = {
    font: '', fillStyle: '', textAlign: '', textBaseline: '',
    save: noop, restore: noop,
    beginPath: noop, moveTo: noop, lineTo: noop, quadraticCurveTo: noop, closePath: noop,
    fill() { fills.push(this.fillStyle); },
    fillText(t, x, y) { calls.push({ t: String(t), x, y, font: this.font, fill: this.fillStyle }); },
  };
  drawHealthAdvice(ctx, 430, 932);
  const texts = calls.map(c => c.t);
  check('绘制 5 行（标题 + 4 句）', calls.length === 5);
  check('先铺深色底板保证亮背景上的对比度',
    fills.length === 1 && String(fills[0]).startsWith('rgba(14,26,46'));
  check('标题在最上、正文顺序正确',
    texts[0] === HEALTH_ADVICE_TITLE && EXPECTED_LINES.every((s, i) => texts[i + 1] === s));
  check('坐标与布局函数一致', (() => {
    const L = healthAdviceLayout(430, 932);
    return calls[0].y === L.title.y && calls.slice(1).every((c, i) => c.y === L.lines[i].y);
  })());
  check('中文回退系统字体（不误用数字字体）', calls.every(c => c.font.includes('sans-serif') && !c.font.includes('KingNumber')));
  check('使用浅色字承托于底部蒙层', calls.every(c => String(c.fill).startsWith('rgba(234,248,255')));
}

console.log('=== 测试4: 加载页接线（renderLoadingScreen 实测）===');
{
  const calls = [];
  const ctx = {
    font: '', fillStyle: '', textAlign: '', textBaseline: '',
    shadowColor: '', shadowBlur: 0, shadowOffsetY: 0,
    save: noop, restore: noop, beginPath: noop, closePath: noop, clip: noop,
    moveTo: noop, lineTo: noop, quadraticCurveTo: noop, arc: noop,
    fill: noop, stroke: noop, fillRect: noop, strokeRect: noop, drawImage: noop,
    createLinearGradient: () => ({ addColorStop: noop }),
    measureText: t => ({ width: String(t).length * 8 }),
    fillText(t, x, y) { calls.push({ t: String(t), x, y }); },
  };
  const fake = { ctx, screenWidth: 430, screenHeight: 932 };
  Game.prototype.renderLoadingScreen.call(fake, 0.6);
  const texts = calls.map(c => c.t);
  check('加载进度仍显示', texts.some(t => t === '加载中... 60%'));
  check('健康忠告标题出现在加载页', texts.includes(HEALTH_ADVICE_TITLE));
  check('健康忠告四句全部出现在加载页', EXPECTED_LINES.every(s => texts.includes(s)));
  check('忠告位于进度文字下方', (() => {
    const pct = calls.find(c => c.t === '加载中... 60%');
    const adv = calls.filter(c => c.t === HEALTH_ADVICE_TITLE || EXPECTED_LINES.includes(c.t));
    return !!pct && adv.length === 5 && adv.every(c => c.y > pct.y);
  })());
}

console.log('=== 测试5: 加载页安全区铺满（方案B回归）===');
{
  // 真机场景：物理高 812，安全区 top=44/bottom=34 → 逻辑内容高 734。
  // 修复前 renderLoadingScreen 用 screenHeight(734) 画背景，底部 78px 露兜底天蓝；
  // 修复后用 physScreenHeight(812) 铺满，忠告按 safeAreaBottom 额外避让 home indicator。
  const rects = [], texts = [];
  const ctx2 = {
    font: '', fillStyle: '', textAlign: '', textBaseline: '',
    shadowColor: '', shadowBlur: 0, shadowOffsetY: 0,
    save: noop, restore: noop, beginPath: noop, closePath: noop, clip: noop,
    moveTo: noop, lineTo: noop, quadraticCurveTo: noop, arc: noop,
    fill: noop, stroke: noop, strokeRect: noop, drawImage: noop,
    fillRect(x, y, rw, rh) { rects.push({ x, y, w: rw, h: rh, color: this.fillStyle }); },
    createLinearGradient: () => ({ addColorStop: noop }),
    measureText: t => ({ width: String(t).length * 8 }),
    fillText(t, x, y) { texts.push({ t: String(t), x, y }); },
  };
  const PHYS_H = 812, SAFE_TOP = 44, SAFE_BOTTOM = 34, INNER_H = 734;
  const fake2 = {
    ctx: ctx2, screenWidth: 375,
    screenHeight: INNER_H,          // 方案B：内容区高
    physScreenHeight: PHYS_H,       // 物理高
    safeAreaBottom: SAFE_BOTTOM,
  };
  Game.prototype.renderLoadingScreen.call(fake2, 1);

  // 1) 兜底天蓝背景必须铺满【物理高】，而非内容区高（核心回归断言）
  const bgFill = rects.find(r => r.y === 0 && r.h === PHYS_H && r.w === 375);
  check('加载页背景铺满物理屏高 812（非内容区 734）', !!bgFill,
    `实际 rects=${JSON.stringify(rects.slice(0, 3))}`);
  check('不再存在只到内容区高的背景块',
    !rects.some(r => r.y === 0 && r.h === INNER_H));

  // 2) 底部蒙层也从物理高的 52% 起、铺到物理底
  const veil = rects.find(r => Math.abs(r.y - PHYS_H * 0.52) < 0.01 && Math.abs(r.h - PHYS_H * 0.48) < 0.01);
  check('底部蒙层按物理高铺到底部', !!veil);

  // 3) 健康忠告按物理高 + safeBottom 定位（底边 = 812 - (34+24) = 754）
  const L5 = healthAdviceLayout(375, PHYS_H, SAFE_BOTTOM + 24);
  check('忠告面板底边 = 物理高 - (safeBottom+24)', Math.abs((L5.panel.y + L5.panel.h) - (PHYS_H - SAFE_BOTTOM - 24)) < 0.01);
  check('忠告底边在 home indicator 上方（避开手势区）', (L5.panel.y + L5.panel.h) <= PHYS_H - SAFE_BOTTOM);
  check('忠告四句在测试中已绘制', EXPECTED_LINES.every(s => texts.some(t => t.t === s)));
}

console.log(`\n结果: ${passed} 通过, ${failed} 失败`);
process.exit(failed ? 1 : 0);
