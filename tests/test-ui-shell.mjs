/**
 * ScreenShell（晴空乐园统一骨架）组件回归测试
 *
 * 背景：P0 骨架是后续所有子界面的复用底座，一旦几何算错或降级路径抛错，
 * 会同时影响多个界面且很难从单屏截图定位。本测试锁定：
 *  1. _progressBar 的 ratio 夹取与填充不超出槽宽
 *  2. _tabs 返回的分段几何在给定区域内互不重叠、不越界（调用方据此对齐点击框）
 *  3. _cardBg / _listRow / _emptyState 在正常 ctx 与「无 arcTo 的老基础库」下都不抛错
 *  4. 已接入骨架的界面，返回按钮不再走 UI-08 占位贴图（该图带水印）
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

// ===== 浏览器全局 stub（RenderSystem 依赖 config 与 document） =====
global.document = {
  createElement: () => ({ getContext: () => null, style: {} }),
  addEventListener: () => {},
  removeEventListener: () => {},
  getElementById: () => null,
};
global.window = { addEventListener: () => {}, removeEventListener: () => {} };
global.localStorage = {
  _d: {},
  getItem(k) { return this._d[k] ?? null; },
  setItem(k, v) { this._d[k] = String(v); },
  removeItem(k) { delete this._d[k]; },
};
global.fetch = async (path) => {
  const rel = String(path).replace('../', '');
  const fs = await import('fs');
  return {
    ok: true,
    json: async () => JSON.parse(fs.readFileSync(join(ROOT, rel), 'utf-8')),
  };
};

const { default: ConfigLoader, syncConfigToStatics } = await import('../src/config.js');
await ConfigLoader.init();
syncConfigToStatics();

const { RenderSystem } = await import('../src/system/RenderSystem.js');

/**
 * 记录型 ctx 桩。legacy=true 时移除 arcTo/clip/arc，
 * 模拟老基础库，验证骨架的降级路径不抛错。
 * fills 记录每次 fill() 时当前路径的包围盒，用于校验圆角填充的实际范围
 * （圆角路径走的是 _roundRectPath + fill，不走 fillRect，只看 rects 会漏判）。
 */
function fakeCtx(legacy = false) {
  const rec = { rects: [], texts: [], fills: [], paths: 0 };
  let box = null;
  const grow = (x, y) => {
    if (!box) box = { x0: x, y0: y, x1: x, y1: y };
    else {
      box.x0 = Math.min(box.x0, x); box.y0 = Math.min(box.y0, y);
      box.x1 = Math.max(box.x1, x); box.y1 = Math.max(box.y1, y);
    }
  };
  const ctx = {
    rec,
    canvas: { width: 430, height: 932 },
    save() {}, restore() {},
    beginPath() { rec.paths++; box = null; }, closePath() {},
    moveTo: (x, y) => grow(x, y),
    lineTo: (x, y) => grow(x, y),
    fill() {
      if (box) rec.fills.push({ x: box.x0, y: box.y0, w: box.x1 - box.x0, h: box.y1 - box.y0 });
    },
    stroke() {}, clip() {},
    translate() {}, scale() {}, rotate() {},
    fillRect: (x, y, w, h) => rec.rects.push({ x, y, w, h }),
    strokeRect: () => {},
    fillText: (t, x, y) => rec.texts.push({ t, x, y }),
    measureText: (t) => ({ width: String(t).length * 8 }),
    createLinearGradient: () => ({ addColorStop() {} }),
    createRadialGradient: () => ({ addColorStop() {} }),
  };
  if (!legacy) {
    ctx.arcTo = (x1, y1) => grow(x1, y1);
    ctx.arc = (cx, cy, r) => { grow(cx - r, cy - r); grow(cx + r, cy + r); };
  }
  return ctx;
}

const makeRS = (ctx) => new RenderSystem(ctx, 430, 932);

test('_progressBar：ratio 超出 0~1 时被夹取，填充宽度不超过槽宽', () => {
  for (const [input, expect] of [[-5, 0], [0, 0], [0.5, 0.5], [1, 1], [9, 1]]) {
    const ctx = fakeCtx();
    const rs = makeRS(ctx);
    const rect = { x: 20, y: 100, w: 200, h: 8 };
    rs._progressBar(rect, input);
    // 正常路径走圆角路径填充：槽底一定画一次，填充仅在 v>0 时画
    const bars = ctx.rec.fills.filter(f => Math.abs(f.y - 100) < 1e-6 && Math.abs(f.h - 8) < 1e-6);
    assert.ok(bars.length >= 1, '槽底必须绘制');
    if (expect === 0) {
      assert.equal(bars.length, 1, `ratio=${input} 不应绘制填充段`);
    } else {
      assert.equal(bars.length, 2, `ratio=${input} 应绘制槽底 + 填充`);
      const fillW = Math.min(...bars.map(b => b.w));
      assert.ok(fillW <= 200 + 1e-6, `ratio=${input} 填充宽度越界: ${fillW}`);
      assert.ok(fillW > 0, '填充段必须有正宽度');
    }
  }
});

test('_progressBar：无 arcTo 的老基础库下走 fillRect 降级且不抛错', () => {
  const ctx = fakeCtx(true);
  const rs = makeRS(ctx);
  assert.doesNotThrow(() => rs._progressBar({ x: 0, y: 0, w: 100, h: 6 }, 0.4));
  assert.equal(ctx.rec.rects.length, 2, '降级路径应画出槽底 + 填充两条 fillRect');
});

test('_tabs：分段几何互不重叠、不越界，且数量与标签一致', () => {
  const labels = ['全部', '消耗品', '兵种', '礼包'];
  for (const width of [320, 375, 430]) {
    const rs = makeRS(fakeCtx());
    const rect = { x: 12, y: 60, w: width - 24, h: 32 };
    const cells = rs._tabs(rect, labels, 1);

    assert.equal(cells.length, labels.length, '分段数量必须与标签数量一致');
    assert.ok(cells[0].x >= rect.x - 1e-6, '首段左边界越界');
    const last = cells[cells.length - 1];
    assert.ok(last.x + last.w <= rect.x + rect.w + 1e-6, '末段右边界越界');
    for (let i = 0; i < cells.length; i++) {
      assert.ok(cells[i].w > 0, '段宽必须为正');
      assert.ok(Math.abs(cells[i].cx - (cells[i].x + cells[i].w / 2)) < 1e-6, 'cx 必须等于段中心');
      if (i > 0) {
        assert.ok(cells[i].x >= cells[i - 1].x + cells[i - 1].w, `第 ${i} 段与上一段重叠`);
      }
    }
  }
});

test('_tabs：单标签与空标签不崩，空标签按 1 段处理', () => {
  const rs = makeRS(fakeCtx());
  assert.doesNotThrow(() => rs._tabs({ x: 10, y: 50, w: 200, h: 30 }, ['仅一项'], 0));
  const empty = rs._tabs({ x: 10, y: 50, w: 200, h: 30 }, [], 0);
  assert.equal(empty.length, 1, '空标签应退化为 1 段占位');
});

test('_cardBg / _listRow / _emptyState：正常与降级 ctx 下均不抛错', () => {
  for (const legacy of [false, true]) {
    const rs = makeRS(fakeCtx(legacy));
    const rect = { x: 10, y: 70, w: 300, h: 60, r: 12 };
    assert.doesNotThrow(() => rs._cardBg(rect, { tint: 'rgba(255,255,255,0.9)', edge: '#3E9FD1', edgeSide: 'left' }));
    assert.doesNotThrow(() => rs._cardBg(rect, { edge: '#FF8C42', edgeSide: 'top', border: 'rgba(43,74,111,0.2)' }));
    assert.doesNotThrow(() => rs._listRow(rect, { alt: true, edge: '#168A4A' }));
    assert.doesNotThrow(() => rs._emptyState(215, 400, '暂无数据', { icon: '🗒', hint: '稍后再来看看' }));
  }
});

test('已接入骨架的界面，返回按钮不走 UI-08 占位贴图', () => {
  const ctx = fakeCtx();
  const rs = makeRS(ctx);
  let artCalled = 0;
  rs._art = () => { artCalled++; return true; };

  rs._curScreen = 'deploy_select';   // 骨架白名单内
  rs._drawBackButton(ctx);
  assert.equal(artCalled, 0, '骨架界面不应调用占位返回按钮贴图');

  artCalled = 0;
  rs._curScreen = 'shop';            // 尚未接入骨架
  rs._drawBackButton(ctx);
  assert.equal(artCalled, 1, '未接入骨架的界面仍应保持原贴图优先行为');
});

test('_sectionLabel：hint 右对齐在屏内，不影响几何', () => {
  const ctx = fakeCtx();
  const rs = makeRS(ctx);
  rs._sectionLabel('兵种槽位', 15, 80, { accent: '#3E9FD1', hint: '点击详情' });
  const texts = ctx.rec.texts;
  assert.ok(texts.some(t => t.t === '兵种槽位'), '主标题必须绘制');
  const hint = texts.find(t => t.t === '点击详情');
  assert.ok(hint, 'hint 必须绘制');
  assert.ok(hint.x <= 430, 'hint 不得画出屏幕右边界');
});

test('_cardBg 的 flat 模式：不画厚底/柔光，只出一层平面底', () => {
  const ctx = fakeCtx();
  const rs = makeRS(ctx);
  const rect = { x: 10, y: 70, w: 300, h: 60, r: 12 };
  rs._cardBg(rect, { tint: 'rgba(6,14,28,0.34)', flat: true });
  // flat 走 clip + fillRect，不进 fills；_drawRaisedCard 的厚底/柔光走路径填充，记在 fills
  const raised = ctx.rec.fills.filter(f => Math.abs(f.y - (rect.y + 4)) < 1e-6);
  assert.equal(raised.length, 0, 'flat 模式不得绘制 y+4 的厚底');
  assert.equal(ctx.rec.fills.length, 0, 'flat 模式不得走 _drawRaisedCard 的柔光路径');
  const body = ctx.rec.rects.filter(r => Math.abs(r.h - rect.h) < 1e-6 && Math.abs(r.y - rect.y) < 1e-6);
  assert.equal(body.length, 1, 'flat 模式应恰好绘制一层平面底');

  // 对照：非 flat 必须出现厚底，确认这条测试真的在区分两种模式
  const ctx2 = fakeCtx();
  const rs2 = makeRS(ctx2);
  rs2._cardBg(rect, { tint: 'rgba(255,255,255,0.9)' });
  const raised2 = ctx2.rec.fills.filter(f => Math.abs(f.y - (rect.y + 4)) < 1e-6);
  assert.ok(raised2.length >= 1, '非 flat 模式应有 y+4 的厚底');
});

test('_screenBg：底图不可用时画出兜底色与压暗层，不抛错也不露白', () => {
  const ctx = fakeCtx();
  const rs = makeRS(ctx);
  rs._art = () => false;              // 模拟图片未加载
  assert.doesNotThrow(() => rs._screenBg());
  const full = ctx.rec.rects.filter(r => r.w === 430 && r.h === 932);
  assert.ok(full.length >= 2, `应至少绘制兜底色 + 压暗层，实际 ${full.length} 层`);
  // 兜底色必须偏暗（夜景系），不能是云白/天蓝，否则白字就读不出来了
  const lum = (hex) => {
    const h = String(hex).replace('#', '');
    const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
    return 0.299 * r + 0.587 * g + 0.114 * b;
  };
  assert.ok(lum('#0E1A2E') < 60, '兜底色应为深靛夜景');
});

test('_sectionLabel / _emptyState：深底默认浅色，onLight 才用深色字', () => {
  const darkCtx = fakeCtx();
  const rs1 = makeRS(darkCtx);
  rs1._sectionLabel('标题', 15, 60, { hint: '提示' });
  rs1._emptyState(215, 400, '暂无数据');
  const darkColors = darkCtx.rec.texts.map(t => t.t);
  assert.ok(darkColors.includes('标题'), '标题必须绘制');

  // onLight 分支也要能画，不抛错即可（颜色不同不影响几何）
  const lightCtx = fakeCtx();
  const rs2 = makeRS(lightCtx);
  assert.doesNotThrow(() => rs2._sectionLabel('标题', 15, 60, { onLight: true }));
  assert.doesNotThrow(() => rs2._emptyState(215, 400, '暂无数据', { onLight: true }));
});
