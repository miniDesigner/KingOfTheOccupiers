/**
 * DeploymentSystem - 上阵系统核心
 *
 * 管理局外兵种/羁绊/建筑强化的收集、升级、上阵安排
 * 战斗前生成 DeploymentBundle 供局内 Building/MarchGroup/SynergySystem 使用
 *
 * 数据流：
 *   PlayerProfile.collectedUnits / buildingUpgrades
 *     ↓ DeploymentSystem.generateBundle(profile)
 *   DeploymentBundle { units[], synergies[], buildingUpgrades{} }
 *     ↓ Game.initLevel() → Building 构造 / SynergySystem / MarchGroup
 */

import ConfigLoader from '../data/ConfigLoader.js';
import { get as getProfile, save as saveProfile } from './ProfileManager.js';
import { getQualityMultiplier, getQualityColor, getQualityName } from '../config.js';
import { SkillSystem } from '../system/SkillSystem.js';

// 升级成本成长系数：每级成本 = 基础成本 × 该系数^(level-1)
// Phase6 平衡调整：1.5 → 1.35（原曲线6兵升满需18万金≈2700局，调后约6万金≈900局，2周休闲节奏）
export const UPGRADE_COST_GROWTH = 1.35;

// 兵种等级上限：技能解锁轴（Lv.6/12 解锁紫色被动，Lv.18 解锁橙色主动）
export const MAX_UNIT_LEVEL = 20;

// ==================== 兵种管理 ====================

/**
 * 获取兵种计算属性（含升级加成）
 * @param {string} unitId - 兵种ID
 * @param {number} level - 兵种升级等级
 * @returns {{ name, icon, combatStyles, attackCoeff, hpCoeff, speedCoeff, special, level, skills }}
 */
export function getUnitStats(unitId, level = 1) {
  const config = ConfigLoader.get('deployables');
  const unitCfg = config?.units?.[unitId];
  if (!unitCfg) return null;

  const lvl = Math.max(1, level);
  const statsPerLevel = unitCfg.statsPerLevel || {};
  const base = unitCfg.baseStats || {};
  const quality = unitCfg.quality || 1;
  const qualityMult = getQualityMultiplier(quality);

  return {
    id: unitId,
    name: unitCfg.name,
    icon: unitCfg.icon,
    quality,
    qualityName: getQualityName(quality),
    qualityColor: getQualityColor(quality),
    qualityMultiplier: qualityMult,
    combatStyles: [...(unitCfg.combatStyles || [])],
    attackCoeff: ((base.attackCoeff || 1.0) + (statsPerLevel.attackCoeff || 0) * (lvl - 1)) * qualityMult,
    hpCoeff: ((base.hpCoeff || 1.0) + (statsPerLevel.hpCoeff || 0) * (lvl - 1)) * qualityMult,
    speedCoeff: (base.speedCoeff || 1.0) + (statsPerLevel.speedCoeff || 0) * (lvl - 1),
    attackRange: unitCfg.attackRange ?? 1,
    productionSpeed: unitCfg.productionSpeed ?? 1.0,
    special: unitCfg.special ? { ...unitCfg.special } : null,
    level: lvl,
    // 已解锁技能列表（蓝默认/紫Lv6,12/橙Lv18或品质≥5默认，由 SkillSystem 统一判定）
    skills: SkillSystem.getUnitSkillList(unitId, lvl, quality),
  };
}

/**
 * 解锁兵种
 */
export function unlockUnit(unitId) {
  const config = ConfigLoader.get('deployables');
  const unitCfg = config?.units?.[unitId];
  if (!unitCfg) return { success: false, reason: '兵种不存在' };

  const profile = getProfile();
  if (!profile) return { success: false, reason: '存档未加载' };

  if (profile.collectedUnits[unitId]) {
    return { success: false, reason: '已解锁该兵种' };
  }

  const cost = unitCfg.unlockCost || {};
  if (!profile.spendCurrency('stardust', cost.starDust || 0)) {
    return { success: false, reason: `星尘不足，需要${cost.starDust || 0}` };
  }
  if (!profile.spendCurrency('gold', cost.gold || 0)) {
    // 回滚星尘
    profile.addCurrency('stardust', cost.starDust || 0);
    return { success: false, reason: `金币不足，需要${cost.gold || 0}` };
  }

  profile.collectedUnits[unitId] = { level: 1 };
  saveProfile();
  return { success: true };
}

/**
 * 升级兵种
 */
export function upgradeUnit(unitId) {
  const config = ConfigLoader.get('deployables');
  const unitCfg = config?.units?.[unitId];
  if (!unitCfg) return { success: false, reason: '兵种不存在' };

  const profile = getProfile();
  if (!profile) return { success: false, reason: '存档未加载' };

  const collected = profile.collectedUnits[unitId];
  if (!collected) return { success: false, reason: '未解锁该兵种' };

  const maxLevel = MAX_UNIT_LEVEL;
  if (collected.level >= maxLevel) {
    return { success: false, reason: '已达最高等级' };
  }

  // 招募次数校验：实际需求 = base × 当前等级
  const recruitBase = unitCfg.recruitRequired || 0;
  const recruitNeeded = recruitBase * collected.level;
  const recruitCount = collected.recruitCount || 0;
  if (recruitBase > 0 && recruitCount < recruitNeeded) {
    return { success: false, reason: `招募次数不足 (${recruitCount}/${recruitNeeded})` };
  }

  const cost = unitCfg.upgradeCost || {};
  const scaledCost = {
    starDust: Math.floor((cost.starDust || 0) * Math.pow(UPGRADE_COST_GROWTH, collected.level - 1)),
    gold: Math.floor((cost.gold || 0) * Math.pow(UPGRADE_COST_GROWTH, collected.level - 1)),
  };

  if (!profile.spendCurrency('stardust', scaledCost.starDust)) {
    return { success: false, reason: `星尘不足，需要${scaledCost.starDust}` };
  }
  if (!profile.spendCurrency('gold', scaledCost.gold)) {
    profile.addCurrency('stardust', scaledCost.starDust);
    return { success: false, reason: `金币不足，需要${scaledCost.gold}` };
  }

  collected.level += 1;
  saveProfile();
  return { success: true, newLevel: collected.level };
}

/**
 * 检查兵种是否满足全部升级条件（不消耗资源）
 * 与 upgradeUnit 的校验口径一致：等级上限 / 招募次数 / 星尘 / 金币
 * 供卡片角标与大厅徽标使用，避免「招募够了但买不起」时误亮角标
 */
export function isUnitUpgradeable(unitId) {
  const config = ConfigLoader.get('deployables');
  const unitCfg = config?.units?.[unitId];
  if (!unitCfg) return false;

  const profile = getProfile();
  if (!profile) return false;

  const collected = profile.collectedUnits[unitId];
  if (!collected) return false;
  if (collected.level >= MAX_UNIT_LEVEL) return false;

  const recruitBase = unitCfg.recruitRequired || 0;
  if (recruitBase > 0 && (collected.recruitCount || 0) < recruitBase * collected.level) return false;

  const cost = unitCfg.upgradeCost || {};
  const growth = Math.pow(UPGRADE_COST_GROWTH, collected.level - 1);
  if (profile.stardust < Math.floor((cost.starDust || 0) * growth)) return false;
  if (profile.gold < Math.floor((cost.gold || 0) * growth)) return false;

  return true;
}

/**
 * 统计当前可升级兵种数量（大厅「布阵」按钮角标）
 */
export function getUpgradeableUnitCount() {
  const profile = getProfile();
  if (!profile) return 0;
  return Object.keys(profile.collectedUnits).filter((id) => isUnitUpgradeable(id)).length;
}

// ==================== 建筑强化管理 ====================

/**
 * 获取建筑强化数据
 * @param {string} buildingType - barracks / arrow_tower / gold_mine
 * @param {number} level - 强化等级
 */
export function getBuildingStats(buildingType, level = 1) {
  const config = ConfigLoader.get('deployables');
  const bldCfg = config?.buildingUpgrades?.[buildingType];
  if (!bldCfg) return null;

  const lvl = Math.max(1, Math.min(level, bldCfg.maxLevel || 1));
  const levelData = bldCfg.levels[lvl.toString()];
  if (!levelData) return null;

  return {
    type: buildingType,
    name: bldCfg.name,
    icon: bldCfg.icon,
    level: lvl,
    ...levelData,
  };
}

/**
 * 计算建筑升级花费（唯一真源）
 *
 * UI 展示与 upgradeBuilding 扣费共用此函数，避免「面板显示 100、实际扣 500」
 * 这类双源漂移。花费 = buildingUpgrades[type].upgradeCost × UPGRADE_COST_GROWTH^(level-1)
 *
 * @param {string} buildingType - barracks / arrow_tower / gold_mine
 * @param {number} level - 当前等级（计算「从该级升到下一级」的花费）
 * @returns {{ maxed: boolean, maxLevel: number, starDust: number, gold: number } | null}
 */
export function getBuildingUpgradeCost(buildingType, level = 1) {
  const config = ConfigLoader.get('deployables');
  const bldCfg = config?.buildingUpgrades?.[buildingType];
  if (!bldCfg) return null;

  const maxLevel = bldCfg.maxLevel || 1;
  const lvl = Math.max(1, Math.min(level || 1, maxLevel));
  if (lvl >= maxLevel) {
    return { maxed: true, maxLevel, starDust: 0, gold: 0 };
  }

  const cost = bldCfg.upgradeCost || {};
  const growth = Math.pow(UPGRADE_COST_GROWTH, lvl - 1);
  return {
    maxed: false,
    maxLevel,
    starDust: Math.floor((cost.starDust || 0) * growth),
    gold: Math.floor((cost.gold || 0) * growth),
  };
}

/**
 * 建筑详情（当前等级效果 + 下一级预览 + 升级花费 + 是否负担得起）
 *
 * @param {string} buildingType - barracks / arrow_tower / gold_mine
 * @returns {object | null} null = 建筑类型不存在
 */
export function getBuildingDetail(buildingType) {
  const profile = getProfile();
  if (!profile) return null;

  const level = (profile.buildingUpgrades && profile.buildingUpgrades[buildingType]) || 1;
  const cur = getBuildingStats(buildingType, level);
  if (!cur) return null;

  const cost = getBuildingUpgradeCost(buildingType, level);
  const maxLevel = (cost && cost.maxLevel) || level;
  const next = cost && !cost.maxed ? getBuildingStats(buildingType, level + 1) : null;

  const stardust = profile.stardust || 0;
  const gold = profile.gold || 0;
  const canAfford = !!(cost && !cost.maxed && stardust >= cost.starDust && gold >= cost.gold);

  return {
    type: buildingType,
    name: cur.name,
    icon: cur.icon,
    level: cur.level,
    maxLevel,
    stats: cur,
    nextStats: next,
    upgradeCost: cost,
    canAfford,
    currency: { stardust, gold },
  };
}

/**
 * 升级建筑强化
 */
export function upgradeBuilding(buildingType) {
  const config = ConfigLoader.get('deployables');
  const bldCfg = config?.buildingUpgrades?.[buildingType];
  if (!bldCfg) return { success: false, reason: '建筑类型不存在' };

  const profile = getProfile();
  if (!profile) return { success: false, reason: '存档未加载' };

  const currentLevel = profile.buildingUpgrades[buildingType] || 1;
  if (currentLevel >= (bldCfg.maxLevel || 1)) {
    return { success: false, reason: '已达最高等级' };
  }

  // 花费与 UI 面板同源（getBuildingUpgradeCost）
  const scaledCost = getBuildingUpgradeCost(buildingType, currentLevel) || { starDust: 0, gold: 0 };

  if (!profile.spendCurrency('stardust', scaledCost.starDust)) {
    return { success: false, reason: `星尘不足，需要${scaledCost.starDust}` };
  }
  if (!profile.spendCurrency('gold', scaledCost.gold)) {
    profile.addCurrency('stardust', scaledCost.starDust);
    return { success: false, reason: `金币不足，需要${scaledCost.gold}` };
  }

  profile.buildingUpgrades[buildingType] = currentLevel + 1;
  saveProfile();
  return { success: true, newLevel: currentLevel + 1 };
}

// ==================== 上阵管理 ====================

/**
 * 设置上阵兵种（槽位不可为空，支持交换）
 * @param {number} slot - 0-5
 * @param {string} unitId - 兵种ID（不可为null，槽位必须始终有兵种）
 */
export function setDeployedUnit(slot, unitId) {
  // 槽位不可为空 — 不允许移除兵种
  if (unitId === null || unitId === undefined) {
    return { success: false, reason: '槽位不可为空，请拖拽其他兵种进行替换' };
  }

  const config = ConfigLoader.get('deployables');
  const maxSlots = config?.deploymentSlots?.unitSlots || 6;

  if (slot < 0 || slot >= maxSlots) {
    return { success: false, reason: '槽位无效' };
  }

  const profile = getProfile();
  if (!profile) return { success: false, reason: '存档未加载' };

  if (!profile.collectedUnits[unitId]) {
    return { success: false, reason: '未解锁该兵种' };
  }

  // 如果该兵种已在其他槽位 → 交换两个槽位的兵种
  for (let i = 0; i < profile.deployment.units.length; i++) {
    if (i !== slot && profile.deployment.units[i] === unitId) {
      const oldUnit = profile.deployment.units[slot];
      profile.deployment.units[i] = oldUnit;
      profile.deployment.units[slot] = unitId;
      saveProfile();
      return { success: true, swapped: true };
    }
  }

  profile.deployment.units[slot] = unitId;
  saveProfile();
  return { success: true };
}

// ==================== 生成 DeploymentBundle ====================

/**
 * 根据玩家存档生成上阵数据包，供局内使用
 * 这是连接局外养成和局内战斗的核心方法
 *
 * @returns {{
 *   units: Object<string, {name, icon, combatStyles, attackCoeff, hpCoeff, speedCoeff, special, level}>,
 *   synergies: Array<{id, name, icon, type, trigger, tiers, level}>,
 *   buildingUpgrades: Object<string, {type, name, level, hp, defense, goldRate, warriorRate, range, attackDamage, attackCooldown, cost}>
 * }}
 */
export function generateBundle() {
  const profile = getProfile();
  if (!profile) {
    console.warn('[DeploymentSystem] No profile loaded, using defaults');
    return _generateDefaultBundle();
  }

  const config = ConfigLoader.get('deployables');
  const dep = profile.deployment;

  // 1. 兵种 - 每个上阵槽位对应一个兵营等级
  const units = {};
  for (let i = 0; i < (dep.units || []).length; i++) {
    const unitId = dep.units[i];
    if (!unitId) continue;
    const collected = profile.collectedUnits[unitId];
    if (!collected) continue;
    const stats = getUnitStats(unitId, collected.level);
    if (stats) {
      units[i + 1] = stats; // key = barracks level (1-4)
    }
  }

  // 2. 羁绊段：当前已废弃（自动派生在 SynergySystem.calculateSynergiesFromUnits 内联完成）
  const synergies = [];

  // 3. 建筑强化 - 玩家已升级的建筑等级
  const buildingUpgrades = {};
  for (const [bldType, bldLevel] of Object.entries(profile.buildingUpgrades || {})) {
    const stats = getBuildingStats(bldType, bldLevel);
    if (stats) {
      buildingUpgrades[bldType] = stats;
    }
  }

  return { units, synergies, buildingUpgrades };
}

/**
 * 默认上阵数据包（存档未加载时的兜底）
 */
function _generateDefaultBundle() {
  const config = ConfigLoader.get('deployables');
  if (!config) {
    return { units: {}, synergies: [], buildingUpgrades: {} };
  }

  const defaultDep = config.defaultDeployment || {};

  const units = {};
  for (let i = 0; i < (defaultDep.units || []).length; i++) {
    const unitId = defaultDep.units[i];
    const stats = getUnitStats(unitId, 1);
    if (stats) {
      units[i + 1] = stats;
    }
  }

  // 羁绊段：当前已废弃（自动派生在 SynergySystem.calculateSynergiesFromUnits 内联完成）
  const synergies = [];

  const buildingUpgrades = {};
  for (const [bldType, bldLevel] of Object.entries(defaultDep.buildingUpgrades || {})) {
    const stats = getBuildingStats(bldType, bldLevel);
    if (stats) {
      buildingUpgrades[bldType] = stats;
    }
  }

  return { units, synergies, buildingUpgrades };
}

/**
 * 获取上阵摘要（用于UI显示）
 */
export function getDeploymentSummary() {
  const profile = getProfile();
  if (!profile) return null;

  const config = ConfigLoader.get('deployables');
  const dep = profile.deployment;

  const unitSummary = (dep.units || []).map((unitId, i) => {
    if (!unitId) return { slot: i, empty: true };
    const collected = profile.collectedUnits[unitId];
    const cfg = config?.units?.[unitId];
    return {
      slot: i,
      unitId,
      name: cfg?.name || unitId,
      icon: cfg?.icon || '?',
      level: collected?.level || 1,
      quality: cfg?.quality || 1,
      empty: false,
    };
  });

  const buildingSummary = {};
  for (const [bldType, bldLevel] of Object.entries(profile.buildingUpgrades || {})) {
    const cfg = config?.buildingUpgrades?.[bldType];
    const detail = getBuildingDetail(bldType);
    buildingSummary[bldType] = {
      type: bldType,
      name: cfg?.name || bldType,
      icon: cfg?.icon || '?',
      level: bldLevel,
      maxLevel: cfg?.maxLevel || 1,
      // P34：详情面板需要的效果/花费/可负担性（与 upgradeBuilding 同源）
      stats: detail?.stats || null,
      nextStats: detail?.nextStats || null,
      upgradeCost: detail?.upgradeCost || null,
      canAfford: !!detail?.canAfford,
      currency: detail?.currency || { stardust: 0, gold: 0 },
    };
  }

  return { units: unitSummary, synergies: [], buildings: buildingSummary };
}

/**
 * 获取已收集兵种列表（含配置信息，供UI展示）
 * @returns {Array<{id, name, icon, level, combatStyles, special}>}
 */
export function getCollectedUnitList() {
  const config = ConfigLoader.getSafe('deployables');
  const profile = getProfile();
  if (!config || !profile) return [];

  const result = [];
  for (const [unitId, data] of Object.entries(profile.collectedUnits)) {
    const cfg = config.units?.[unitId];
    if (!cfg) continue;
    const stats = getUnitStats(unitId, data.level || 1);
    result.push({
      id: unitId,
      name: cfg.name,
      icon: cfg.icon,
      level: data.level || 1,
      maxLevel: MAX_UNIT_LEVEL,
      recruitCount: data.recruitCount || 0,
      recruitRequired: cfg.recruitRequired || 0,
      combatStyles: cfg.combatStyles || [],
      special: cfg.special || null,
      quality: cfg.quality || 1,
      attackRange: cfg.attackRange ?? 1,
      productionSpeed: cfg.productionSpeed ?? 1.0,
      attackCoeff: stats?.attackCoeff ?? 1.0,
      hpCoeff: stats?.hpCoeff ?? 1.0,
      speedCoeff: stats?.speedCoeff ?? 1.0,
      upgradeCost: cfg.upgradeCost || { starDust: 0, gold: 0 },
      statsPerLevel: cfg.statsPerLevel || { attackCoeff: 0.08, hpCoeff: 0.08 },
      // 全量技能表（含未解锁，供详情面板展示锁定条件；解锁判定由 UI 按 level/quality 计算）
      skills: SkillSystem.getAllUnitSkills(unitId) || [],
    });
  }
  return result;
}

/**
 * 获取可招募兵种列表（未拥有的兵种，含费用信息）
 * @returns {Array<{id, name, icon, combatStyles, special, cost: {starDust, gold}, affordable: boolean}>}
 */
export function getRecruitableUnits() {
  const config = ConfigLoader.getSafe('deployables');
  const profile = getProfile();
  if (!config || !profile) return [];

  const result = [];
  for (const [unitId, cfg] of Object.entries(config.units || {})) {
    if (unitId.startsWith('_') || typeof cfg !== 'object') continue; // 跳过文档字段
    if (profile.collectedUnits[unitId]) continue; // 已拥有
    const cost = cfg.unlockCost || { starDust: 0, gold: 0 };
    result.push({
      id: unitId,
      name: cfg.name,
      icon: cfg.icon,
      combatStyles: cfg.combatStyles || [],
      special: cfg.special || null,
      cost: { starDust: cost.starDust || 0, gold: cost.gold || 0 },
      affordable: profile.stardust >= (cost.starDust || 0) && profile.gold >= (cost.gold || 0),
    });
  }
  return result;
}

// ==================== 抽卡系统 ====================

/**
 * 抽卡配置
 * 单抽：100金币  十连：900金币（9折）
 */
const GACHA_SINGLE_COST = 100;
const GACHA_MULTI_COST = 900;

/**
 * 品质概率（按 quality 1-6）
 */
const GACHA_RATES = [
  { quality: 1, rate: 0.40 }, // 普通 40%
  { quality: 2, rate: 0.25 }, // 精良 25%
  { quality: 3, rate: 0.18 }, // 稀有 18%
  { quality: 4, rate: 0.10 }, // 史诗 10%
  { quality: 5, rate: 0.05 }, // 传说 5%
  { quality: 6, rate: 0.02 }, // 神话 2%
];

/**
 * 重复兵种转化：招募进度 + 星尘
 */
const DUPLICATE_REWARDS = {
  1: { recruit: 2, stardust: 5 },
  2: { recruit: 3, stardust: 10 },
  3: { recruit: 5, stardust: 20 },
  4: { recruit: 8, stardust: 40 },
  5: { recruit: 12, stardust: 80 },
  6: { recruit: 20, stardust: 200 },
};

/**
 * 保底机制：每10抽保底品质4+
 */
const PITY_THRESHOLD = 10;
const PITY_MIN_QUALITY = 4;

/**
 * 获取抽卡信息（供UI显示）
 */
export function getGachaInfo() {
  const profile = getProfile();
  const config = ConfigLoader.getSafe('deployables');
  if (!config || !profile) return null;

  // 统计未拥有和已拥有的兵种数量
  let owned = 0, unowned = 0;
  const poolByQuality = {};
  for (const [unitId, cfg] of Object.entries(config.units || {})) {
    if (unitId.startsWith('_') || typeof cfg !== 'object') continue;
    const q = cfg.quality || 1;
    if (!poolByQuality[q]) poolByQuality[q] = [];
    poolByQuality[q].push({ id: unitId, name: cfg.name, icon: cfg.icon });
    if (profile.collectedUnits[unitId]) owned++;
    else unowned++;
  }

  // 激励视频免费抽：每日配额从 ads.json._limits.gachaFreeDraw 取，默认 1
  const adsConfig = ConfigLoader.getSafe('ads');
  const freeLimit = adsConfig && adsConfig._limits && adsConfig._limits.gachaFreeDraw
    ? adsConfig._limits.gachaFreeDraw
    : 1;
  const watched = (profile.dailyAdWatched && profile.dailyAdWatched.gachaFreeDraw) || 0;
  const adsFreeDrawAvailable = profile.canWatchAd('gachaFreeDraw', freeLimit);

  return {
    singleCost: GACHA_SINGLE_COST,
    multiCost: GACHA_MULTI_COST,
    gold: profile.gold,
    stardust: profile.stardust,
    pityCount: profile.gachaPityCount || 0,
    pityThreshold: PITY_THRESHOLD,
    totalUnits: owned + unowned,
    ownedUnits: owned,
    unownedUnits: unowned,
    rates: GACHA_RATES,
    poolByQuality,
    adsFreeDrawAvailable,
    adsFreeDrawLimit: freeLimit,
    adsFreeDrawWatched: watched,
  };
}

/**
 * 按品质随机抽取一个兵种ID
 */
function _rollUnitByQuality(quality, profile) {
  const config = ConfigLoader.getSafe('deployables');
  if (!config) return null;

  // 收集该品质的所有兵种
  const pool = [];
  for (const [unitId, cfg] of Object.entries(config.units || {})) {
    if (unitId.startsWith('_') || typeof cfg !== 'object') continue;
    if ((cfg.quality || 1) === quality) {
      pool.push(unitId);
    }
  }
  if (pool.length === 0) return null;

  // 随机选一个
  return pool[Math.floor(Math.random() * pool.length)];
}

/**
 * 按概率选择品质
 */
function _rollQuality() {
  const r = Math.random();
  let acc = 0;
  for (const entry of GACHA_RATES) {
    acc += entry.rate;
    if (r < acc) return entry.quality;
  }
  return 1; // fallback
}

/**
 * 执行单次抽卡
 * @returns {{ success, result, reason }}
 *   result: { unitId, name, icon, quality, isNew, duplicateReward }
 */
function _doSingleDraw(profile) {
  let quality = _rollQuality();

  // 累计抽卡次数（成就统计）
  profile.totalPulls = (profile.totalPulls || 0) + 1;

  // 保底检查
  const pityCount = (profile.gachaPityCount || 0) + 1;
  if (pityCount >= PITY_THRESHOLD && quality < PITY_MIN_QUALITY) {
    // 保底触发：强制品质4+
    quality = PITY_MIN_QUALITY + Math.floor(Math.random() * 3); // 4, 5, or 6
    profile.gachaPityCount = 0;
  } else {
    profile.gachaPityCount = pityCount >= PITY_THRESHOLD ? 0 : pityCount;
  }

  const unitId = _rollUnitByQuality(quality, profile);
  if (!unitId) return { success: false, reason: '抽卡池为空' };

  const config = ConfigLoader.getSafe('deployables');
  const cfg = config.units[unitId];
  const isNew = !profile.collectedUnits[unitId];

  let duplicateReward = null;
  if (isNew) {
    // 解锁新兵种
    profile.collectedUnits[unitId] = { level: 1, recruitCount: 0 };
  } else {
    // 重复：转化为招募进度 + 星尘
    const reward = DUPLICATE_REWARDS[quality] || DUPLICATE_REWARDS[1];
    const cur = profile.collectedUnits[unitId].recruitCount || 0;
    profile.collectedUnits[unitId].recruitCount = cur + reward.recruit;
    profile.addCurrency('stardust', reward.stardust);
    duplicateReward = reward;
  }

  return {
    success: true,
    result: {
      unitId,
      name: cfg.name,
      icon: cfg.icon,
      quality,
      isNew,
      duplicateReward,
    },
  };
}

/**
 * 执行单抽
 */
export function gachaDraw() {
  const profile = getProfile();
  if (!profile) return { success: false, reason: '存档未加载' };

  if (profile.gold < GACHA_SINGLE_COST) {
    return { success: false, reason: `金币不足，需要${GACHA_SINGLE_COST}` };
  }

  profile.spendCurrency('gold', GACHA_SINGLE_COST);
  const draw = _doSingleDraw(profile);
  if (!draw.success) {
    profile.addCurrency('gold', GACHA_SINGLE_COST); // 回滚
    return draw;
  }

  saveProfile();
  return { success: true, results: [draw.result] };
}

/**
 * 免费单抽（激励视频奖励，不扣金币）
 * 业务层负责保证调用前已完成配额校验与视频观看奖励发放条件
 */
export function gachaFreeDraw() {
  const profile = getProfile();
  if (!profile) return { success: false, reason: '存档未加载' };

  const draw = _doSingleDraw(profile);
  if (!draw.success) return draw;

  saveProfile();
  return { success: true, results: [draw.result] };
}

/**
 * 执行十连抽
 * 保底：十连至少一个品质4+
 */
export function gachaMultiDraw() {
  const profile = getProfile();
  if (!profile) return { success: false, reason: '存档未加载' };

  if (profile.gold < GACHA_MULTI_COST) {
    return { success: false, reason: `金币不足，需要${GACHA_MULTI_COST}` };
  }

  profile.spendCurrency('gold', GACHA_MULTI_COST);

  const results = [];

  for (let i = 0; i < 10; i++) {
    // 十连保底（前置）：前9抽无Q4+时，第10抽通过保底计数器自然触发强制Q4+
    // （保底逻辑在 _doSingleDraw 内部统一处理，效果只发放一次，避免双重发放）
    if (i === 9 && !results.some((r) => r.quality >= PITY_MIN_QUALITY)) {
      profile.gachaPityCount = PITY_THRESHOLD - 1;
    }
    const draw = _doSingleDraw(profile);
    if (!draw.success) {
      // 异常情况，回滚
      profile.addCurrency('gold', GACHA_MULTI_COST);
      return { success: false, reason: '抽卡异常' };
    }
    results.push(draw.result);
  }

  saveProfile();
  return { success: true, results };
}

export default {
  getUnitStats,
  unlockUnit,
  upgradeUnit,
  isUnitUpgradeable,
  getUpgradeableUnitCount,
  getBuildingStats,
  upgradeBuilding,
  getBuildingUpgradeCost,
  getBuildingDetail,
  setDeployedUnit,
  generateBundle,
  getDeploymentSummary,
  getCollectedUnitList,
  getRecruitableUnits,
  getGachaInfo,
  gachaDraw,
  gachaFreeDraw,
  gachaMultiDraw,
};
