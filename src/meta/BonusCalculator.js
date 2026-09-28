/**
 * BonusCalculator — 局外加成计算器
 * 聚合 科技树 + 装备 → 统一的 BonusBundle
 * 在 initLevel 时将 BonusBundle 应用到局内 Player 实例
 */

import ConfigLoader from '../data/ConfigLoader.js';
import { get as getProfile } from './ProfileManager.js';
import { getEquippedBonuses } from './EquipmentSystem.js';

/**
 * 计算完整加成包
 * @param {PlayerProfile} profile - 玩家Profile（可选，默认从ProfileManager获取）
 * @returns {object} BonusBundle
 */
function calculate(profile) {
  profile = profile || getProfile();

  const bundle = createEmptyBundle();

  // 1. 科技树加成
  _applyTechBonuses(bundle, profile);

  // 2. 装备加成
  _applyEquipBonuses(bundle, profile);

  return bundle;
}

/**
 * 创建空加成包
 */
function createEmptyBundle() {
  return {
    // 攻击相关
    attackPercent: 0,          // 攻击力百分比
    critRate: 0,               // 暴击率
    penetrate: 0,              // 穿透（无视防御百分比）
    berserk: 0,                // 狂战士（低血量攻击加成）

    // 防御相关
    buildingHpPercent: 0,      // 建筑生命值百分比
    buildingDefensePercent: 0, // 建筑防御百分比
    reflectDamage: 0,          // 反弹伤害百分比
    healBoost: 0,              // 回血加成

    // 经济相关
    goldProduction: 0,         // 金币产出百分比
    flipCostReduction: 0,      // 翻转消耗减少百分比
    goldInterest: 0,           // 利息系数
    warPlunder: 0,             // 战争掠夺百分比
    settlementGold: 0,         // 结算金币百分比

    // 行军相关
    marchSpeedPercent: 0,      // 行军速度百分比
    groupThresholdReduction: 0,// 编组阈值降低
    towerDamage: 0,            // 箭塔攻击力百分比
    towerAttackSpeed: 0,       // 箭塔攻击速度百分比

    // 羁绊相关
    synergyBoost: 0,           // 羁绊效果增强百分比

    // 统帅相关
    heroExp: 0,                // 将领经验获取百分比
    deputyEffect: 0,           // 副将效果增强
    gachaLuck: 0,              // 抽卡幸运值
    heroUpgradeDiscount: 0,    // 将领升级折扣
    raceEnhanceCap: 0,         // 种族强化上限

    // 特殊
    deathRevenge: 0,           // 死亡复仇概率
    allStatBoost: 0,           // 全属性加成
  };
}

/**
 * 应用科技树加成
 */
function _applyTechBonuses(bundle, profile) {
  let techConfig;
  try {
    techConfig = ConfigLoader.get('techTree');
  } catch (e) {
    return;
  }

  for (const branch of Object.values(techConfig.branches)) {
    for (const node of branch.nodes) {
      const level = profile.getTechNodeLevel(node.id);
      if (level <= 0) continue;

      const bonusValue = node.bonus.valuePerLevel * level;
      _applyTechBonusToBundle(bundle, node.bonus.type, bonusValue);
    }
  }
}

/**
 * 将科技加成应用到加成包
 */
function _applyTechBonusToBundle(bundle, bonusType, value) {
  switch (bonusType) {
    case 'attack_percent':
      bundle.attackPercent += value;
      break;
    case 'march_speed_percent':
      bundle.marchSpeedPercent += value;
      break;
    case 'group_threshold_reduction':
      bundle.groupThresholdReduction += value;
      break;
    case 'synergy_boost':
      bundle.synergyBoost += value;
      break;
    case 'crit_rate':
      bundle.critRate += value;
      break;
    case 'penetrate':
      bundle.penetrate += value;
      break;
    case 'berserk':
      bundle.berserk += value;
      break;
    case 'gold_production':
      bundle.goldProduction += value;
      break;
    case 'flip_cost_reduction':
      bundle.flipCostReduction += value;
      break;
    case 'random_luck':
      // 随机格幸运值 — 需要在BuildSystem中处理，暂存
      bundle._randomLuck = (bundle._randomLuck || 0) + value;
      break;
    case 'gold_interest':
      bundle.goldInterest += value;
      break;
    case 'war_plunder':
      bundle.warPlunder += value;
      break;
    case 'settlement_gold':
      bundle.settlementGold += value;
      break;
    case 'building_hp_percent':
      bundle.buildingHpPercent += value;
      break;
    case 'building_defense_percent':
      bundle.buildingDefensePercent += value;
      break;
    case 'tower_damage':
      bundle.towerDamage += value;
      break;
    case 'reflect_damage':
      bundle.reflectDamage += value;
      break;
    case 'hero_exp':
      bundle.heroExp += value;
      break;
    case 'deputy_effect':
      bundle.deputyEffect += value;
      break;
    case 'gacha_luck':
      bundle.gachaLuck += value;
      break;
    case 'hero_upgrade_discount':
      bundle.heroUpgradeDiscount += value;
      break;
    case 'race_enhance_cap':
      bundle.raceEnhanceCap += value;
      break;
    default:
      console.warn(`[BonusCalculator] Unknown tech bonus type: ${bonusType}`);
  }
}

/**
 * 应用装备加成
 */
function _applyEquipBonuses(bundle, profile) {
  const bonuses = getEquippedBonuses(profile);
  for (const [statType, value] of Object.entries(bonuses)) {
    // 装备属性类型与BonusBundle字段名一致
    if (bundle.hasOwnProperty(statType)) {
      bundle[statType] += value;
    } else {
      console.warn(`[BonusCalculator] Unknown equip stat: ${statType}`);
    }
  }
}

/**
 * 将加成包应用到局内 Player 实例
 * @param {Player} player - 局内玩家
 * @param {object} bundle - 加成包
 */
function applyToPlayer(player, bundle) {
  if (!bundle) return;

  // 全属性加成先乘到各属性上
  const allBoost = 1 + (bundle.allStatBoost || 0);

  // 攻击力
  if (bundle.attackPercent) {
    player._metaAttackBonus = bundle.attackPercent * allBoost;
  }
  // 暴击率
  if (bundle.critRate) {
    player.synergyBonuses.criticalRate = (player.synergyBonuses.criticalRate || 0) + bundle.critRate;
  }
  // 穿透
  if (bundle.penetrate) {
    player._metaPenetrate = bundle.penetrate;
  }
  // 建筑生命值
  if (bundle.buildingHpPercent) {
    player._metaBuildingHpBonus = bundle.buildingHpPercent * allBoost;
  }
  // 建筑防御
  if (bundle.buildingDefensePercent) {
    player._metaBuildingDefBonus = bundle.buildingDefensePercent * allBoost;
  }
  // 反弹伤害
  if (bundle.reflectDamage) {
    player.synergyBonuses.reflectRate = (player.synergyBonuses.reflectRate || 0) + bundle.reflectDamage;
  }
  // 回血加成
  if (bundle.healBoost) {
    player._metaHealBoost = bundle.healBoost;
  }
  // 金币产出
  if (bundle.goldProduction) {
    player._metaGoldProductionBonus = bundle.goldProduction;
  }
  // 翻转消耗降低
  if (bundle.flipCostReduction) {
    player._metaFlipCostReduction = bundle.flipCostReduction;
  }
  // 行军速度
  if (bundle.marchSpeedPercent) {
    player._metaMarchSpeedBonus = bundle.marchSpeedPercent;
  }
  // 编组阈值降低
  if (bundle.groupThresholdReduction) {
    player.groupThresholdReduction = (player.groupThresholdReduction || 0) + bundle.groupThresholdReduction;
  }
  // 箭塔攻击力
  if (bundle.towerDamage) {
    player._metaTowerDamageBonus = bundle.towerDamage;
  }
  // 羁绊增强
  if (bundle.synergyBoost) {
    player._metaSynergyBoost = bundle.synergyBoost;
  }
  // 死亡复仇
  if (bundle.deathRevenge) {
    player._metaDeathRevenge = bundle.deathRevenge;
  }
  // 利息
  if (bundle.goldInterest) {
    player._metaGoldInterest = bundle.goldInterest;
  }
  // 战争掠夺
  if (bundle.warPlunder) {
    player._metaWarPlunder = bundle.warPlunder;
  }
}

export { calculate, createEmptyBundle, applyToPlayer };
export default { calculate, createEmptyBundle, applyToPlayer };
