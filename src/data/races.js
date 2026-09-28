/**
 * 种族配置 (从 JSON 配置表加载)
 * 数据源: config/races.json
 *
 * 6大种族：人族/兽族/亡灵/精灵/矮人/龙族
 * 每族4兵种(对应兵营Lv1~4) + 种族羁绊 + 建筑变体
 */

import ConfigLoader from './ConfigLoader.js';

/**
 * 获取所有种族数据
 */
export function getRaces() {
  return ConfigLoader.get('races');
}

/**
 * 获取指定种族数据
 */
export function getRace(raceId) {
  const races = getRaces();
  return races[raceId] || null;
}

/**
 * 获取兵种信息(基础版，向后兼容)
 * @param {string} race - 种族ID
 * @param {number} level - 兵营等级(1~4)
 * @returns {object} { name, attackCoeff, combatStyles }
 */
export function getUnitInfo(race, level) {
  const raceData = getRace(race);
  if (!raceData) return null;
  return raceData.units[level] || raceData.units['1'];
}

/**
 * 获取兵种完整信息(含hpCoeff/speedCoeff/special)
 * @param {string} race - 种族ID
 * @param {number} level - 兵营等级(1~4)
 * @returns {object|null} 完整兵种数据
 */
export function getUnitFullInfo(race, level) {
  const raceData = getRace(race);
  if (!raceData) return null;
  return raceData.units[level] || raceData.units['1'];
}

/**
 * 获取种族羁绊加成配置
 * @param {string} race - 种族ID
 * @param {number} tier - 羁绊阶位(1/2/3)
 * @returns {object|null} 该族该阶位的加成配置
 */
export function getRaceSynergyBonus(race, tier) {
  const raceData = getRace(race);
  if (!raceData || !raceData.raceSynergy) return null;
  return raceData.raceSynergy[tier] || null;
}

/**
 * 获取建筑变体(种族颜色 + 属性调整)
 * @param {string} race - 种族ID
 * @param {string} buildingType - 建筑类型(gold_mine/tower 等)
 * @returns {object} { color, goldRateModifier, hpModifier, defenseModifier, ... }
 */
export function getBuildingVariant(race, buildingType) {
  const raceData = getRace(race);
  if (!raceData) return { color: '#888888' };

  const result = { color: raceData.color };

  // 建筑变体属性
  if (raceData.buildingVariants && raceData.buildingVariants[buildingType]) {
    const variant = raceData.buildingVariants[buildingType];
    result.goldRateModifier = variant.goldRateModifier || 0;
    result.hpModifier = variant.hpModifier || 0;
    result.defenseModifier = variant.defenseModifier || 0;
    result.attackBonusModifier = variant.attackBonusModifier || 0;
    result.speedBonusModifier = variant.speedBonusModifier || 0;
    result.allStatBonus = variant.allStatBonus || 0;
    result.slowOnHit = variant.slowOnHit || 0;
  }

  return result;
}

/**
 * 获取所有已解锁的种族ID列表
 * (Demo阶段返回全部，后续由局外养成系统控制解锁)
 */
export function getUnlockedRaces() {
  const races = getRaces();
  return Object.keys(races).filter(k => !k.startsWith('_'));
}

/**
 * 获取种族风格描述
 */
export function getRaceStyle(raceId) {
  const raceData = getRace(raceId);
  return raceData ? raceData.style : '';
}

// ========== 向后兼容: 静态导出 ==========
// RACES 在 syncRaces() 调用后才有值
export let RACES;

/**
 * 在 ConfigLoader.init() 完成后调用
 */
export function syncRaces() {
  RACES = getRaces();
}
