/**
 * ArtSystem._drawFit 回归测试
 *
 * 背景：素材替换时若实际图片尺寸与 PLACEHOLDER-MANIFEST 声明尺寸不一致，
 * 早期实现用声明值算 cover 源矩形，会越界到图片之外 → drawImage 取不到像素
 * → 背景左右/底部露出底层渐变（真机上表现为两条浅色竖边）。
 *
 * 本测试锁定三条：
 *  1. cover 的源矩形永远落在图片实际像素范围内
 *  2. cover 源矩形宽高比与目标矩形一致（不拉伸）
 *  3. 声明尺寸与实际一致时（正常情况）计算结果不变，避免修复引入回归
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { ArtSystem } from '../src/system/ArtSystem.js';

/** 记录 drawImage 调用参数的假 ctx */
function fakeCtx() {
  const calls = [];
  return { calls, drawImage: (...args) => calls.push(args) };
}

const img = (w, h) => ({ width: w, height: h });

test('cover：声明 1500x2115 但实际 1024x1460 时，源矩形不越界', () => {
  const ctx = fakeCtx();
  const e = { w: 1500, h: 2115 };
  const im = img(1024, 1460);
  const W = 430, H = 932;

  ArtSystem._drawFit(ctx, im, e, 0, 0, W, H, 'cover');

  assert.equal(ctx.calls.length, 1);
  const [, sx, sy, sw, sh, dx, dy, dw, dh] = ctx.calls[0];
  assert.ok(sx >= 0 && sy >= 0, `源起点越界: sx=${sx} sy=${sy}`);
  assert.ok(sx + sw <= im.width + 1e-6, `源右边界越界: ${sx + sw} > ${im.width}`);
  assert.ok(sy + sh <= im.height + 1e-6, `源下边界越界: ${sy + sh} > ${im.height}`);
  assert.equal(dx, 0);
  assert.equal(dy, 0);
  assert.equal(dw, W);
  assert.equal(dh, H);
  assert.ok(Math.abs(sw / sh - W / H) < 1e-6, 'cover 不得拉伸源图');
});

test('cover：声明尺寸与实际一致时结果不变（回归保护）', () => {
  const ctx = fakeCtx();
  const e = { w: 1500, h: 2115 };
  const im = img(1500, 2115);
  const W = 430, H = 932;

  ArtSystem._drawFit(ctx, im, e, 0, 0, W, H, 'cover');

  const [, sx, sy, sw, sh] = ctx.calls[0];
  const ir = 1500 / 2115, tr = W / H;
  const expSw = ir > tr ? 2115 * tr : 1500;
  const expSh = ir > tr ? 2115 : 1500 / tr;
  const expSx = ir > tr ? (1500 - expSw) / 2 : 0;
  const expSy = ir > tr ? 0 : (2115 - expSh) / 2;
  assert.ok(Math.abs(sw - expSw) < 1e-6, `sw 回归: ${sw} vs ${expSw}`);
  assert.ok(Math.abs(sh - expSh) < 1e-6, `sh 回归: ${sh} vs ${expSh}`);
  assert.ok(Math.abs(sx - expSx) < 1e-6, `sx 回归: ${sx} vs ${expSx}`);
  assert.ok(Math.abs(sy - expSy) < 1e-6, `sy 回归: ${sy} vs ${expSy}`);
});

test('cover：宽图 / 窄图 / 等比三种源尺寸都不得越界', () => {
  const cases = [[3000, 1000], [800, 2400], [1024, 1460], [1500, 2115]];
  for (const [iw, ih] of cases) {
    const ctx = fakeCtx();
    ArtSystem._drawFit(ctx, img(iw, ih), { w: 1500, h: 2115 }, 0, 0, 360, 780, 'cover');
    const [, sx, sy, sw, sh] = ctx.calls[0];
    assert.ok(
      sx >= -1e-6 && sy >= -1e-6 &&
      sx + sw <= iw + 1e-6 && sy + sh <= ih + 1e-6,
      `${iw}x${ih} 越界: sx=${sx} sw=${sw} sy=${sy} sh=${sh}`
    );
  }
});

test('contain：完整显示、居中、不超出目标矩形', () => {
  const ctx = fakeCtx();
  const im = img(1024, 1460);
  const W = 430, H = 932;

  ArtSystem._drawFit(ctx, im, { w: 1500, h: 2115 }, 0, 0, W, H, 'contain');

  const [, dx, dy, dw, dh] = ctx.calls[0];
  assert.ok(dw <= W + 1e-6 && dh <= H + 1e-6, `contain 超出目标: ${dw}x${dh}`);
  assert.ok(dx >= -1e-6 && dy >= -1e-6, `contain 左上越界: ${dx},${dy}`);
  assert.ok(Math.abs(dw / dh - im.width / im.height) < 1e-6, 'contain 不得变形');
});

test('九宫格：实际尺寸与声明不一致时切源坐标仍在图内', () => {
  const ctx = fakeCtx();
  const im = img(300, 400);
  const e = { w: 1500, h: 2115, slice: 60, is9: true };

  ArtSystem._draw9(ctx, im, e, 0, 0, 300, 100);

  assert.equal(ctx.calls.length, 9, '应为 3x3 共 9 次切片');
  for (const [, sx, sy, sw, sh] of ctx.calls) {
    assert.ok(sw > 0 && sh > 0, '切片尺寸必须为正');
    assert.ok(sx >= -1e-6 && sy >= -1e-6, `切片起点越界: ${sx},${sy}`);
    assert.ok(sx + sw <= im.width + 1e-6, `切片右边越界: ${sx + sw} > ${im.width}`);
    assert.ok(sy + sh <= im.height + 1e-6, `切片下边越界: ${sy + sh} > ${im.height}`);
  }
});
