/**
 * 段位进度条圆角守护测试（2026-11-25）
 * 底色/边框由 _cardBg 画 r:6 圆角，填充段也必须同款圆角，
 * 否则直角 fillRect 会盖住边框左端，出现「左直角右圆角」的不一致表现。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const ROOT = new URL('../', import.meta.url).pathname.replace(/^\/(\w:)/, '$1');
const src = readFileSync(ROOT + 'src/system/RenderSystem.js', 'utf-8');

function bodyOf(source, signature) {
  const start = source.indexOf(signature);
  assert(start >= 0, `找不到 ${signature}`);
  const brace = source.indexOf('{', start);
  let depth = 0;
  for (let i = brace; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') {
      depth--;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  return '';
}

test('段位进度条填充段与外框同为圆角，无直角残留', () => {
  // 段位进度条绘制位于 _drawLobbyLadderZone 内，取含 ladderBarWidth 的函数体
  const fnStart = src.indexOf('ladderBarWidth(w)');
  assert(fnStart >= 0, '找不到段位进度条绘制段落');
  // 2026-11-25：新增轨道底图绘制后该段变长，窗口扩到 3600 才能覆盖填充段
  const block = src.slice(fnStart, fnStart + 3600);

  assert(block.includes("_cardBg({ x: barX, y: barY, w: barW, h: barH, r: 6 }"),
    '底色/边框仍是 r:6 圆角');
  assert(block.includes('this._roundRectPath(trackX, trackY, fillW, trackH, 3)'),
    '填充复用轨道同起点/同高/同 r3，左端弧线与轨道完全重合（弧线平行）');
  assert(!/this\._roundRectPath\(fillX|const barFillR = Math\.min\(2/.test(block),
    '禁止填充单独内缩起点/半径的旧做法（弧线不平行）');
  assert(!/ctx\.fillRect\(barX, barY/.test(block), '旧的直角 fillRect 已移除');
});
