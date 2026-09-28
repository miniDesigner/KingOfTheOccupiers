/**
 * 确定性随机数工具（PvP 帧同步 / Lockstep 基础）
 *
 * 目标：同一对局内所有随机决策必须来自同一随机源，保证双端按相同命令序列
 * 推演时产生完全一致的战斗结果（地图生成、AI 决策、兵种随机、暴击、复活等）。
 *
 * 核心设计：
 * - `battleRandom()` 是对局全局随机源，返回 [0,1) 的浮点数。
 * - 未注入种子随机源时 fallback 到 `Math.random`，保证现有单机/AI 对战、
 *   无头模拟器（依赖全局 `Math.random` 覆盖）以及既有测试零回归。
 * - `setBattleRng(rng)` 在对局开始时注入种子随机源；`setBattleRng(null)` 复位。
 */

/**
 * mulberry32：小巧、快速、统计性质良好的 32 位种子 PRNG。
 * 与 tests/sim-balance-phase6.mjs 中的实现保持一致，便于跨端复现。
 * @param {number} seed - 32 位无符号整数种子
 * @returns {function(): number} 返回 [0,1) 浮点数的随机函数
 */
export function createRng(seed) {
  let a = seed >>> 0;
  return function next() {
    a |= 0;
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

let _battleRng = null;

/**
 * 注入对局随机源（传 null 复位到 Math.random）
 * @param {function|null} rng - 返回 [0,1) 的随机函数，或 null
 */
export function setBattleRng(rng) {
  _battleRng = rng || null;
}

/**
 * 对局随机数 [0,1)：未注入时 fallback 到 Math.random
 * @returns {number}
 */
export function battleRandom() {
  return _battleRng ? _battleRng() : Math.random();
}

/**
 * 当前是否处于确定性对局（已注入种子随机源）
 * @returns {boolean}
 */
export function isDeterministic() {
  return _battleRng !== null;
}

/**
 * 随机整数 [min, max)（max 缺省时视为 [0, min)）
 * @param {number} min - 下限（含）
 * @param {number} [max] - 上限（不含）
 * @param {function} [rng] - 随机函数，缺省用 battleRandom
 * @returns {number}
 */
export function randInt(min, max, rng) {
  const r = rng || battleRandom;
  if (max === undefined) { max = min; min = 0; }
  return Math.floor(r() * (max - min)) + min;
}

/**
 * 从数组中随机取一项
 * @param {Array} array
 * @param {function} [rng] - 随机函数，缺省用 battleRandom
 * @returns {*}
 */
export function pick(array, rng) {
  const r = rng || battleRandom;
  return array[Math.floor(r() * array.length)];
}
