// 战斗界面水印占位图拦截的源码级守护（2026-11-24）
// 背景：artEffectDecor=true 后，几张从未替换正式美术的 ui/* 水印图漏出，
// 画在战斗 HUD（顶部/底部水印文字）与棋盘中央（tutorial_card 白底十字矩形）。
// 修法：在 RenderSystem._art 与 ArtLayer.drawArtLayer 两处做精确 key 拦截。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const rsSrc = readFileSync(new URL('../src/system/RenderSystem.js', import.meta.url), 'utf-8');
const alSrc = readFileSync(new URL('../src/system/ArtLayer.js', import.meta.url), 'utf-8');
const genSrc = readFileSync(new URL('../tools/gen-art-layer.mjs', import.meta.url), 'utf-8');

const WATERMARK_KEYS = [
  'ui/hud_top', 'ui/hud_bottom', 'ui/hud_hp', 'ui/hud_synergy', 'ui/tutorial_card',
];
// 不该常驻在棋盘中央的斜线 X 特效（瞬时事件特效，非氛围装饰）
const TRANSIENT_FX = ['effects/combat_crit', 'effects/combat_hit'];

test('RenderSystem 无条件拦截未替换的水印 key（不受 artEffectDecor 开关影响）', () => {
  const setStart = rsSrc.indexOf('const UNREPLACED_WATERMARK_KEYS = new Set([');
  assert(setStart > 0, '存在未替换水印 key 精确集合');
  const setSrc = rsSrc.slice(setStart, rsSrc.indexOf(']);', setStart) + 2);
  for (const key of WATERMARK_KEYS) {
    assert(setSrc.includes(`'${key}'`), `集合含 ${key}`);
  }
  assert(rsSrc.includes('if (UNREPLACED_WATERMARK_KEYS.has(key) || (this._artEffectDecor !== true && isWatermarkArtKey(key))) return false;'),
    '_art() 在开关判断之前无条件拦截未替换水印 key');
});

test('ArtLayer 装饰层同步拦截水印 key', () => {
  const dropStart = alSrc.indexOf('const ALWAYS_DROP = new Set([');
  assert(dropStart > 0, 'drawArtLayer 存在 ALWAYS_DROP 集合');
  const dropSrc = alSrc.slice(dropStart, alSrc.indexOf(']);', dropStart) + 2);
  for (const key of WATERMARK_KEYS) {
    assert(dropSrc.includes(`'${key}'`), `ALWAYS_DROP 含 ${key}`);
  }
  for (const key of TRANSIENT_FX) {
    assert(dropSrc.includes(`'${key}'`), `ALWAYS_DROP 含不该常驻的特效 ${key}`);
  }
  assert(alSrc.includes('if ((dropPlaceholderFx || ALWAYS_DROP.has(key)) && isPlaceholder(key)) continue;'),
    'emit 拦截 ALWAYS_DROP key，即使开关打开');
});

test('BIND_PLAYING 不再把水印图与引导装饰画在棋盘中央', () => {
  const start = alSrc.indexOf('const BIND_PLAYING = [');
  const end = alSrc.indexOf('];', start);
  const playingSrc = alSrc.slice(start, end);
  for (const key of ['ui/hud_hp', 'ui/hud_synergy', 'ui/tutorial_card', 'ui/tutorial_dots']) {
    assert(!playingSrc.includes(`['${key}'`), `BIND_PLAYING 已移除 ${key}`);
  }
  assert(playingSrc.includes("['units/unit_walk_attack', 'grid', 0.2]"), '保留正式行走帧装饰');
});

test('生成脚本同步拦截逻辑，防止重跑后水印复活', () => {
  assert(genSrc.includes("const ALWAYS_DROP = new Set(["), '生成脚本含 ALWAYS_DROP');
  assert(genSrc.includes("'ui/hud_top', 'ui/hud_bottom', 'ui/hud_hp', 'ui/hud_synergy', 'ui/tutorial_card',"),
    '生成脚本水印拦截集合与源码一致');
  assert(genSrc.includes("'effects/combat_crit', 'effects/combat_hit',"),
    '生成脚本同步拦截斜线X特效');
  assert(genSrc.includes('if ((dropPlaceholderFx || ALWAYS_DROP.has(key)) && isPlaceholder(key)) continue;'),
    '生成脚本 emit 含拦截判断');
});
