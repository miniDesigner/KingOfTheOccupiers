/**
 * 大厅段位进度条视觉守护测试（2026-11-25）
 * 终版几何：内部槽底与橙进度全部画在外框圆角路径的 clip 内，
 * 圆角形状由最外层轮廓唯一决定，三层弧线完全重合。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const ROOT = new URL('../', import.meta.url).pathname.replace(/^\/(\w:)/, '$1');
const src = readFileSync(ROOT + 'src/system/RenderSystem.js', 'utf-8');

const start = src.indexOf('ladderBarWidth(w)');
assert(start >= 0, '找不到段位进度条绘制段落');
const end = src.indexOf('const seasonText', start);
assert(end > start, '找不到段位条绘制段结束锚点');
const block = src.slice(start, end);

test('段位条边框与进度填充使用不同色彩语义', () => {
  assert(block.includes("ctx.strokeStyle = 'rgba(168,208,242,0.72)'"),
    '外框必须是提亮后的中性冷蓝描边，不再是段位色或低对比 NIGHT.border');
  assert(!/border:\s*ladderTier\.color/.test(block),
    '外框不得再使用 ladderTier.color（会与填充糊成一片）');
  assert(!/ladderTier\.color\s*\+\s*'88'/.test(block),
    '填充不得再使用 53% 透明段位色，必须不透明');
  assert(block.includes('ctx.fillStyle = ladderTier.color;'),
    '填充主体为不透明段位色');
});

test('段位条轨道有程序化底图（槽底 + 刻度 + 高光 + 内阴影）', () => {
  assert(block.includes("ctx.fillStyle = 'rgba(6,14,30,0.86)'"), '深靛槽底存在');
  assert(block.includes('const tickW = barW / 10;'), '10 格刻度存在');
  assert(block.includes("ctx.fillStyle = 'rgba(234,248,255,0.10)'"), '槽顶内高光存在');
  assert(block.includes("ctx.fillStyle = 'rgba(0,0,0,0.30)'"), '槽底内阴影存在');
});

test('内部背景与橙进度被外框圆角 clip，圆角由最外层轮廓唯一决定', () => {
  assert(block.includes('const barR = 8;'),
    '外框圆角半径唯一真相源');
  assert(block.includes('this._roundRectPath(barX, barY, barW, barH, barR)'),
    '先画外框圆角路径');
  const clipAt = block.indexOf('ctx.clip();');
  const slotAt = block.indexOf("ctx.fillRect(barX, barY, barW, barH)");
  const fillAt = block.indexOf('ctx.fillRect(barX, barY, fillW, barH)');
  assert(clipAt >= 0 && slotAt > clipAt && fillAt > clipAt,
    '槽底与橙进度都必须在外框 clip 之后绘制，圆角自动继承外框');
  assert(!/this\._roundRectPath\(trackX|const trackR =/.test(block),
    '禁止内部各自算圆角半径——那样弧线永远与外框对不齐');
  assert(block.includes('const fillW = Math.max(barH, barW * (ladderProgress.next ? ladderProgress.ratio : 1));'),
    '填充宽度按进度算，最小一个条高');
});

test('外框描边最后画且与内部弧线同心，文字对比保留', () => {
  const clipAt = block.indexOf('ctx.clip();');
  const strokeAt = block.indexOf("ctx.strokeStyle = 'rgba(168,208,242,0.72)'");
  assert(clipAt >= 0 && strokeAt > clipAt,
    '描边必须在内部填充之后绘制，完整覆盖外沿');
  assert(block.includes('this._roundRectPath(barX + 1.5, barY + 1.5, barW - 3, barH - 3, barR - 1.5)'),
    '描边路径圆心 = (barX+barR, barY+barR)，与内部弧线同心');
  assert(block.includes("ctx.shadowColor = 'rgba(6,14,30,0.95)'"), '进度文字有深色阴影');
});
