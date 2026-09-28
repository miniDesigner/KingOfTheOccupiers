/**
 * 游戏配置 (从 JSON 配置表加载)
 * 
 * 本文件是配置数据的访问层，所有配置值来自 config/*.json
 * 策划只需修改 JSON 文件，无需改动此文件
 */

import ConfigLoader from './data/ConfigLoader.js';

// ========== 延迟加载 ==========
// 配置在 Game.init() 中通过 ConfigLoader.init() 加载
// 各模块通过本文件的 getter 函数同步访问

function _game() { return ConfigLoader.get('game'); }
function _buildings() { return ConfigLoader.get('buildings'); }
function _tiles() { return ConfigLoader.get('tiles'); }
function _combat() { return ConfigLoader.get('combat'); }
function _synergy() { return ConfigLoader.get('synergy'); }

// ========== 六边形参数 ==========
export function getHexSize() { return _game().hex.size; }

// ========== 颜色 ==========
export function getPlayerColors() { return _game().colors.players; }
export function getTileBackColor() { return _game().colors.tileBack; }
export function getTileBackBorder() { return _game().colors.tileBackBorder; }

// ========== 地块分布 ==========
export function getPresetDistribution() { return _tiles().presetDistribution; }
export function getRandomTileResults() { return _tiles().randomTileResults; }
export function getRandomTileCost() { return _tiles().randomTileCost; }

// ========== 建筑配置 ==========
export function getBuildingConfig() { return _buildings(); }

/**
 * 获取指定建筑类型和等级的配置
 */
export function getBuildingLevelConfig(type, level) {
  const buildings = _buildings();
  const typeConfig = buildings[type];
  if (!typeConfig) return null;
  return typeConfig[level || 1] || null;
}

/**
 * 获取翻转消耗
 */
export function getFlipCost(presetBuilding) {
  if (!presetBuilding) return 0;
  if (presetBuilding.type === 'random') return getRandomTileCost();
  const levelConfig = getBuildingLevelConfig(presetBuilding.type, presetBuilding.level);
  return levelConfig ? levelConfig.cost : 0;
}

// ========== 编组/行军 ==========
export function getGroupThreshold() { return _game().march.groupThreshold; }
export function getHQBufferMax() { return _game().march.hqBufferMax; }
export function getMarchSpeed() { return _game().march.speed; }

// ========== 战斗参数 ==========
export function getCombatDuration() { return _combat().duration; }

// ========== 动画时长 ==========
export function getFlipAnimationDuration() { return _game().animation.flipDuration; }
export function getRandomRevealDuration() { return _game().animation.randomRevealDuration; }

// ========== 经济 ==========
export function getInitialGold() { return _game().economy.initialGold; }
export function getBaseGoldRate() { return _game().economy.baseGoldRate; }
export function getKillGoldPerWarrior() { return _game().economy.killGoldPerWarrior ?? 2; }
export function getKillGoldLevelStep() { return _game().economy.killGoldLevelStep ?? 0.5; }

// ========== 羁绊配置 ==========
export function getRaceSynergy() { return _synergy().raceSynergy; }
export function getStyleSynergy() { return _synergy().styleSynergy; }

// ========== 全局系数 ==========
export function getUnitAttackCoefficient() { return _game().unitAttackCoefficient; }

// ========== 兵种品质 ==========
export function getQualityTiers() { return _game().quality?.tiers || []; }
export function getQualityConfig(quality) {
  const tiers = _game().quality?.tiers || [];
  return tiers[Math.max(0, Math.min(tiers.length - 1, (quality || 1) - 1))];
}
export function getQualityMultiplier(quality) {
  const cfg = getQualityConfig(quality);
  return cfg ? (cfg.multiplier || 1.0) : 1.0;
}
export function getQualityColor(quality) {
  const cfg = getQualityConfig(quality);
  return cfg ? cfg.color : '#9ca3af';
}
export function getQualityName(quality) {
  const cfg = getQualityConfig(quality);
  return cfg ? cfg.name : '白';
}

// ========== AI ==========
export function getAIDecisionInterval() { return _game().ai.decisionInterval; }

// ========== 地图配置 ==========
export function getMapConfig() { return _game().map; }

// ========== 向后兼容: 导出静态对象 ==========
// 这些对象在 ConfigLoader.init() 完成后才有值
// 使用方式: 在 Game.init() 之后访问，或使用 getter 函数

export let HEX_SIZE;
export let PLAYER_COLORS;
export let TILE_BACK_COLOR;
export let TILE_BACK_BORDER;
export let PRESET_DISTRIBUTION;
export let RANDOM_TILE_RESULTS;
export let BUILDING_CONFIG;
export let GROUP_THRESHOLD;
export let HQ_WARRIOR_BUFFER_MAX;
export let MARCH_SPEED;
export let COMBAT_DURATION;
export let FLIP_ANIMATION_DURATION;
export let RANDOM_REVEAL_DURATION;
export let INITIAL_GOLD;
export let BASE_GOLD_RATE;
export let KILL_GOLD_PER_WARRIOR;
export let KILL_GOLD_LEVEL_STEP;
export let RACE_SYNERGY;
export let STYLE_SYNERGY;
export let UNIT_ATTACK_COEFFICIENT;
export let AI_DECISION_INTERVAL;
export let MAP_CONFIG;

/**
 * 在 ConfigLoader.init() 完成后调用
 * 将 JSON 配置同步到静态导出变量(向后兼容)
 */
export function syncConfigToStatics() {
  const game = _game();
  const tiles = _tiles();
  const buildings = _buildings();
  const combat = _combat();
  const synergy = _synergy();

  HEX_SIZE = game.hex.size;
  PLAYER_COLORS = game.colors.players;
  TILE_BACK_COLOR = game.colors.tileBack;
  TILE_BACK_BORDER = game.colors.tileBackBorder;
  PRESET_DISTRIBUTION = tiles.presetDistribution;
  RANDOM_TILE_RESULTS = tiles.randomTileResults;
  BUILDING_CONFIG = buildings;
  GROUP_THRESHOLD = game.march.groupThreshold;
  HQ_WARRIOR_BUFFER_MAX = game.march.hqBufferMax;
  MARCH_SPEED = game.march.speed;
  COMBAT_DURATION = combat.duration;
  FLIP_ANIMATION_DURATION = game.animation.flipDuration;
  RANDOM_REVEAL_DURATION = game.animation.randomRevealDuration;
  INITIAL_GOLD = game.economy.initialGold;
  BASE_GOLD_RATE = game.economy.baseGoldRate;
  KILL_GOLD_PER_WARRIOR = game.economy.killGoldPerWarrior ?? 2;
  KILL_GOLD_LEVEL_STEP = game.economy.killGoldLevelStep ?? 0.5;
  RACE_SYNERGY = synergy.raceSynergy;
  STYLE_SYNERGY = synergy.styleSynergy;
  UNIT_ATTACK_COEFFICIENT = game.unitAttackCoefficient;
  AI_DECISION_INTERVAL = game.ai.decisionInterval;
  MAP_CONFIG = game.map;
}

// 默认导出 ConfigLoader
export default ConfigLoader;
