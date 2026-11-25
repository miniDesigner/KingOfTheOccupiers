/**
 * 段位进度条圆角守护测试（2026-11-25）
 * 最外层圆角路径 ctx.clip() 后，内部槽底与橙进度直接 fillRect，
 * 圆角形状由外框唯一决定，杜绝各自算半径导致的「外圆内方」。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const ROOT = new URL('../', import.meta.url).pathname.replace(/^\/(\w:)/, '$1');
const src = readFileSync(ROOT + 'src/system/RenderSystem.js', 'utf-8');

test('段位进度条内部圆角完全继承外框轮廓，无直角残留', () => {
  const fnStart = src.indexOf('ladderBarWidth(w)');
  assert(fnStart >= 0, '找不到段位进度条绘制段落');
  const end = src.indexOf('const seasonText', fnStart);
  assert(end > fnStart, '找不到段位条绘制段结束锚点');
  const block = src.slice(fnStart, end);

  assert(block.includes('const barR = 8;'), '外框圆角唯一真相源存在');
  assert(block.includes('this._roundRectPath(barX, barY, barW, barH, barR)'),
    '外框圆角路径存在');
  assert(block.includes('ctx.clip();'), '外框路径被用作 clip');
  assert(block.includes('ctx.fillRect(barX, barY, barW, barH)'),
    '槽底填满外框区域，圆角由 clip 决定');
  assert(block.includes('ctx.fillRect(barX, barY, fillW, barH)'),
    '橙进度填满到进度宽度，左端弧线就是外框弧线');
  assert(!/ctx\.fillRect\(barX, barY, barFillW/.test(block),
    '旧的直角 fillRect 填充已移除');
  assert(!/this\._roundRectPath\(trackX|const trackR =/.test(block),
    '禁止内部各自画圆角块（弧线与外框不重合）');
});
