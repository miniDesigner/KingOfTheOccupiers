/**
 * 大厅段位进度条视觉守护测试（2026-11-25）
 * 需求：边框与进度颜色区分 + 补充轨道底图。
 * 防止后续改动把两者改回同色、或删掉轨道刻度底图。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const ROOT = new URL('../', import.meta.url).pathname.replace(/^\/(\w:)/, '$1');
const src = readFileSync(ROOT + 'src/system/RenderSystem.js', 'utf-8');

const start = src.indexOf('ladderBarWidth(w)');
assert(start >= 0, '找不到段位进度条绘制段落');
const block = src.slice(start, start + 3600);

test('段位条边框与进度填充使用不同色彩语义', () => {
  assert(block.includes("border: 'rgba(168,208,242,0.72)', flat: true"),
    '外框必须是提亮后的中性冷蓝，不再是段位色或低对比 NIGHT.border');
  // 只约束外框那一行：后面的赛季文字胶囊合法使用 border: ladderTier.color，不能一刀切禁掉。
  const outerFrameLine = block.split('\n').find(l => l.includes('flat: true') && l.includes('tintGradient'));
  assert(outerFrameLine && !/border:\s*ladderTier\.color/.test(outerFrameLine),
    '外框不得再使用 ladderTier.color（会与填充糊成一片）');
  assert(!/ladderTier\.color\s*\+\s*'88'/.test(block),
    '填充不得再使用 53% 透明段位色，必须不透明');
  assert(block.includes('ctx.fillStyle = ladderTier.color;'),
    '填充主体为不透明段位色');
});

test('段位条轨道有程序化底图（槽底 + 刻度 + 高光 + 内阴影）', () => {
  assert(block.includes("ctx.fillStyle = 'rgba(6,14,30,0.86)'"), '深靛槽底存在');
  assert(block.includes('const tickW = trackW / 10;'), '10 格刻度存在');
  assert(block.includes("ctx.fillStyle = 'rgba(234,248,255,0.10)'"), '槽顶内高光存在');
  assert(block.includes("ctx.fillStyle = 'rgba(0,0,0,0.30)'"), '槽底内阴影存在');
  assert(block.includes('ctx.clip();'), '底图与填充均被圆角裁切，不溢出边框');
});

test('填充复用轨道起点与半径，左端弧线与轨道完全重合（三层弧线平行）', () => {
  assert(block.includes('const trackX = barX + 3, trackY = barY + 3;'),
    '底图相对外框内缩 3px（避开 2.5px 描边）');
  assert(block.includes('this._roundRectPath(trackX, trackY, trackW, trackH, 3)'),
    '轨道 r3 与描边内沿等效 r3.25 同心');
  assert(block.includes('const fillW = Math.max(trackH, trackW * (ladderProgress.next ? ladderProgress.ratio : 1));'),
    '填充宽度按进度算，最小一个条高');
  assert(block.includes('this._roundRectPath(trackX, trackY, fillW, trackH, 3)'),
    '填充必须用轨道同起点(trackX,trackY)、同高 trackH、同半径 r3——左端弧线与轨道完全重合');
  assert(!/this\._roundRectPath\(fillX, fillY/.test(block),
    '禁止填充单独内缩起点/半径（那样顶边平直、弧线看着不平行）');
  assert(!/this\._roundRectPath\(barX, barY, barFillW/.test(block),
    '填充不得从外框原点起画（旧版会盖掉冷蓝轮廓左端）');
});

test('填充与轨道共用同一 clip，高光与文字对比保留', () => {
  // 填充必须落在轨道 ctx.clip() 作用域内：轨道 fill → clip → 刻度 → 填充 顺序不变
  const clipAt = block.indexOf('ctx.clip();');
  const fillPathAt = block.indexOf('this._roundRectPath(trackX, trackY, fillW, trackH, 3)');
  assert(clipAt >= 0 && fillPathAt > clipAt,
    '填充圆角路径必须在轨道 clip 之后绘制，左端被轨道圆角裁切');
  assert(block.includes("ctx.shadowColor = 'rgba(6,14,30,0.95)'"), '进度文字有深色阴影');
});
