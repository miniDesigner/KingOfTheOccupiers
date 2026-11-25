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
  assert(block.includes('this._roundRectPath(fillX, fillY, barFillW, fillH, barFillR)'),
    '进度填充在轨道内缩区走圆角路径，不盖住外框');
  assert(block.includes('const barFillR = Math.min(2, barFillW / 2, fillH / 2)'),
    '填充 r2 与轨道 r3、描边内沿 r3.25 同心，按宽高 clamp 小进度不变形');
  assert(!/ctx\.fillRect\(barX, barY/.test(block), '旧的直角 fillRect 已移除');
});
