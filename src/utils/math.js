/**
 * 数学工具函数
 */

import { battleRandom } from './rng.js';

export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
}

export function distance(x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  return Math.sqrt(dx * dx + dy * dy);
}

export function randomChoice(array, rand = battleRandom) {
  return array[Math.floor(rand() * array.length)];
}

export function weightedRandom(weights, rand = battleRandom) {
  // 过滤掉非数字值(如 JSON 配置中的 _doc 文档字段)
  const entries = Object.entries(weights).filter(([, v]) => typeof v === 'number' && v > 0);
  const total = entries.reduce((s, [, v]) => s + v, 0);
  if (total <= 0) return entries[0]?.[0];
  let r = rand() * total;
  for (const [key, weight] of entries) {
    r -= weight;
    if (r <= 0) return key;
  }
  return entries[0]?.[0];
}

export function manhattan(a, b) {
  return Math.abs(a.q - b.q) + Math.abs(a.r - b.r);
}
