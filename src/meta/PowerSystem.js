/**
 * PowerSystem — 战力系统
 * 1. 战力计算：基于上阵兵种的**实际战斗属性**（攻/血/速系数、品质乘数、技能、射程）
 *    + 建筑强化等级 + 科技等级（只统计上阵的，未上阵/未收集不计入；羁绊 2026-09-09 已废弃自动派生）
 * 2. 段位战力参考带：8 段位（青铜→王者）各配一个参考战力，作为成长坐标
 * 3. 段位电脑（AI）设定：依据战力参考带推导各段位的 AI 难度分布 / 初始金币 /
 *    产兵乘数 / 技能解锁档位，并按「玩家战力 ÷ 段位参考」做动态强弱修正
 * 4. AI 兵种一致化：敌方使用与玩家相同的 40 兵种池（deployables.json），
 *    按难度分层品质上限 + 等级基准，叠加技能档位 / 战力比修正，产出与
 *    DeploymentSystem.generateBundle() 同构的 deploymentBundle（随机选兵，
 *    预留 fixedUnits 固定配置）
 */

import ConfigLoader from '../data/ConfigLoader.js';
import { getUnitStats, MAX_UNIT_LEVEL } from './DeploymentSystem.js';
import { getTier } from './LadderSystem.js';
import { battleRandom } from '../utils/rng.js';

// ==================== 战力公式 ====================

/** 单位战力权重（与战斗结算倾向一致：攻击 > 生命 > 速度） */
const W_ATTACK = 2.0;
const W_HP = 1.5;
const W_SPEED = 0.5;
/** 属性战力基数（系数和 × 60 → 品质/等级成长自然放大） */
const STAT_BASE = 60;
/** 每个已解锁技能的战力加成 */
const POWER_PER_SKILL = 25;
/** 每超出 1 点射程的战力加成 */
const POWER_PER_RANGE = 20;

/** 建筑强化每级战力 */
const POWER_PER_BUILDING_LEVEL = 60;
/** 科技每级战力 */
const POWER_PER_TECH_LEVEL = 40;

/** 配置不可用时的单兵粗算（无配置上下文兜底，仅保证 getTotalPower 不崩）：白板兵基准 + 每级成长 */
const FALLBACK_UNIT_BASE = 250;
const FALLBACK_UNIT_PER_LEVEL = 25;

/**
 * 计算单个兵种战力（基于实际属性：等级成长 + 品质乘数 + 技能 + 射程）
 * 配置未加载（如早期启动、排行榜/分享等无配置上下文）时退化为按等级粗算，
 * 确保 getTotalPower 在任何调用点可用（旧口径无配置依赖，此处保持同等健壮性）
 * @param {string} unitId - 兵种ID
 * @param {number} level - 兵种等级
 * @returns {number} 战力值（0 表示兵种不存在）
 */
export function calculateUnitPower(unitId, level = 1) {
  let stats;
  try {
    stats = getUnitStats(unitId, level);
  } catch (_err) {
    // ConfigLoader 未初始化 / game.json 未加载 → 无配置粗算
    const lvl = Math.max(1, level || 1);
    return FALLBACK_UNIT_BASE + (lvl - 1) * FALLBACK_UNIT_PER_LEVEL;
  }
  if (!stats) return 0;
  const core = stats.attackCoeff * W_ATTACK + stats.hpCoeff * W_HP + stats.speedCoeff * W_SPEED;
  const skillPower = (stats.skills?.length || 0) * POWER_PER_SKILL;
  const rangePower = stats.attackRange > 1 ? (stats.attackRange - 1) * POWER_PER_RANGE : 0;
  return Math.round(core * STAT_BASE + skillPower + rangePower);
}

/**
 * 计算玩家总战力（只统计上阵内容）
 * @param {object} profile - 玩家档案
 * @returns {{total:number, units:number, synergies:number, buildings:number, tech:number}}
 */
export function calculatePlayerPower(profile) {
  if (!profile) return { total: 0, units: 0, synergies: 0, buildings: 0, tech: 0 };

  // 1) 上阵兵种（deployment.units 中非空槽位）
  let unitsPower = 0;
  for (const unitId of (profile.deployment?.units || [])) {
    if (!unitId) continue;
    const collected = profile.collectedUnits?.[unitId];
    if (!collected) continue;
    unitsPower += calculateUnitPower(unitId, collected.level || 1);
  }

  // 2) 羁绊段：已废弃（2026-09-09 改造，自动派生），战力归零
  const synPower = 0;

  // 3) 建筑强化等级
  let buildingPower = 0;
  for (const lvl of Object.values(profile.buildingUpgrades || {})) {
    buildingPower += (lvl || 0) * POWER_PER_BUILDING_LEVEL;
  }

  // 4) 科技等级
  let techPower = 0;
  for (const lvl of Object.values(profile.techTree || {})) {
    techPower += (lvl || 0) * POWER_PER_TECH_LEVEL;
  }

  const total = Math.round(unitsPower + synPower + buildingPower + techPower);
  return { total, units: unitsPower, synergies: synPower, buildings: buildingPower, tech: techPower };
}

/**
 * 大厅战力展示信息（含当前段位参考）
 * @param {object} profile
 * @returns {{total, breakdown, tierIndex, reference, ratio}}
 */
export function getLobbyPowerInfo(profile) {
  const breakdown = calculatePlayerPower(profile);
  const trophies = profile ? (profile.trophies || 0) : 0;
  const tier = getTier(trophies);
  const reference = TIER_POWER_REFERENCE[tier.index] ?? TIER_POWER_REFERENCE[0];
  return {
    total: breakdown.total,
    breakdown,
    tierIndex: tier.index,
    tierLabel: tier.label,
    reference,
    ratio: reference > 0 ? breakdown.total / reference : 0,
  };
}

// ==================== 段位战力参考带 ====================
// 与 TIERS 一一对应（青铜→王者）：该段位玩家的期望战力
// 依据：新玩家默认阵容 ≈ 2300；6兵 Lv20 高品质 + 羁绊/建筑/科技满 ≈ 11000+
export const TIER_POWER_REFERENCE = [
  2000,  // 青铜
  3000,  // 白银
  4200,  // 黄金
  5500,  // 铂金
  7000,  // 钻石
  8500,  // 大师
  10000, // 宗师
  11500, // 王者
];

// ==================== 段位电脑（AI）设定 ====================
// 依据战力参考带推导：段位越高 → 难度分布后移（更容易抽到 hard/nightmare）。
// 2026-09-09 AI 一致化：去除初始金币作弊 / 技能档位杠杆 / 战力比动态修正，
// AI 强度完全由「难度 → 品质上限 + 等级基准」映射（养成模拟），
// 属性走 getUnitStats 玩家同款公式，技能由兵种等级自然驱动。
const TIER_AI_SETTINGS = [
  { key: 'bronze',      difficulties: { easy: 0.75, normal: 0.25, hard: 0,    nightmare: 0 } },
  { key: 'silver',      difficulties: { easy: 0.45, normal: 0.45, hard: 0.10, nightmare: 0 } },
  { key: 'gold',        difficulties: { easy: 0.20, normal: 0.50, hard: 0.30, nightmare: 0 } },
  { key: 'platinum',    difficulties: { easy: 0.05, normal: 0.40, hard: 0.45, nightmare: 0.10 } },
  { key: 'diamond',     difficulties: { easy: 0,    normal: 0.25, hard: 0.50, nightmare: 0.25 } },
  { key: 'master',      difficulties: { easy: 0,    normal: 0.10, hard: 0.55, nightmare: 0.35 } },
  { key: 'grandmaster', difficulties: { easy: 0,    normal: 0.05, hard: 0.45, nightmare: 0.50 } },
  { key: 'king',        difficulties: { easy: 0,    normal: 0,    hard: 0.30, nightmare: 0.70 } },
];

// 2026-09-09 已移除：
//   - DIFFICULTY_BASE_GOLD（AI 初始金币按难度作弊，现统一与玩家一致 150）
//   - DIFFICULTY_BASE_WARRIOR_MULT（产兵乘数，已废弃恒 1.0）
//   - POWER_RATIO_MIN / POWER_RATIO_MAX（战力比动态修正，AI 强度不再跟随玩家战力）

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/**
 * 依据段位生成本局电脑（AI）难度
 * 2026-09-09 改造：AI 强度不再叠加初始金币/技能档位/战力比修正，
 * 只返回「按段位难度分布抽取的难度档」，强度由 generateAiDeployment 的养成映射决定。
 * @param {number} trophies - 玩家当前奖杯（决定段位）
 * @param {number} [rand=Math.random()] - 随机源（可注入，测试确定性）
 * @returns {{tierIndex, tierKey, difficulty}}
 */
export function getTierAiSettings(trophies, rand = battleRandom) {
  const tier = getTier(typeof trophies === 'number' ? trophies : 0);
  const settings = TIER_AI_SETTINGS[tier.index] || TIER_AI_SETTINGS[0];

  // 按段位难度分布抽取本局难度
  let acc = 0;
  let difficulty = 'normal';
  for (const [diff, p] of Object.entries(settings.difficulties)) {
    acc += p;
    if (rand() < acc) { difficulty = diff; break; }
  }

  return {
    tierIndex: tier.index,
    tierKey: settings.key,
    difficulty,
  };
}

// ==================== AI 兵种一致化 ====================
// 敌方 AI 从「种族固定兵（races.json，无品质/无等级成长/产速固定1.0）」
// 切换为与玩家完全相同的 40 兵种池（deployables.json）：
//   - 品质乘数 / 等级成长 / 产速 / 射程 1~3 / 技能解锁轴 全部走 getUnitStats
//   - 产出 deploymentBundle 后，Building / MarchGroup / EconomySystem / SynergySystem
//     自动走与玩家一致的消费链路（双模式架构的 deployment 分支）
// 强度杠杆（养成模拟）：难度只决定「品质上限 + 等级基准」，属性走玩家同款公式；
//   技能由兵种等级自然驱动，无独立技能档位/战力比/初始金币作弊（2026-09-09）

/** 难度 → 兵种品质上限（AI 可用兵种池：easy 只有白/绿，normal 到蓝，hard 到橙，nightmare 全 6 档） */
const DIFFICULTY_MAX_QUALITY = { easy: 2, normal: 3, hard: 5, nightmare: 6 };
/** 难度 → 兵种等级基准（AI 兵种强度主轴，养成模拟：相当于 AI 把兵种养到了多少级） */
const DIFFICULTY_BASE_LEVEL = { easy: 3, normal: 6, hard: 10, nightmare: 14 };
/** 槽位等级离散度：4 个槽位围绕基准上下浮动（兵营随机选兵时等级有差异） */
const SLOT_LEVEL_OFFSETS = [0, 1, -1, 2];
/** AI 上阵槽位数（对应兵营等级 1~4；大本营固定用 units[1]） */
const AI_DEPLOY_SLOTS = 4;

/**
 * 依据难度随机生成 AI 兵种配置包（养成模拟：AI 强度完全来自品质上限 + 等级基准）
 * 与玩家 deploymentBundle 同构：{ units: {1..4: stats}, synergies: [], buildingUpgrades: {} }
 *  - 兵种：从 40 兵种池按「难度品质上限」过滤后随机抽取 4 个（不重复；池不足回绕复用）
 *  - 等级：难度基准，再按槽位微浮动（clamp 1~20），属性走 getUnitStats 玩家同款公式，
 *    技能由兵种等级自然驱动（与玩家一致，无独立技能档位杠杆）
 *  - 支持 fixedUnits 固定配置（传 4 个 unitId 时跳过随机，便于固定Boss/调试）
 * @param {string} [difficulty='normal'] - easy/normal/hard/nightmare
 * @param {string[]} [fixedUnits=null] - 固定兵种列表（4 个 unitId），用于固定配置
 * @param {function} [rand=Math.random] - 随机源（可注入，测试确定性）
 * @returns {{units: Object<string, object>, synergies: [], buildingUpgrades: {}}}
 */
export function generateAiDeployment(difficulty = 'normal', fixedUnits = null, rand = battleRandom) {
  const config = ConfigLoader.getSafe('deployables');
  const units = {};
  if (!config || !config.units) return { units, synergies: [], buildingUpgrades: {} };

  const maxQ = DIFFICULTY_MAX_QUALITY[difficulty] ?? DIFFICULTY_MAX_QUALITY.normal;
  const baseLevel = DIFFICULTY_BASE_LEVEL[difficulty] ?? DIFFICULTY_BASE_LEVEL.normal;
  // 等级主轴 = 难度基准（养成模拟：AI 兵种等级即其等效养成进度，不再叠加技能档位/战力比）
  const lvlAxis = clamp(baseLevel, 1, MAX_UNIT_LEVEL);

  // 选兵：固定配置优先，否则按难度品质上限过滤 + 洗牌随机
  let pool;
  if (fixedUnits && fixedUnits.length >= AI_DEPLOY_SLOTS) {
    pool = fixedUnits.filter((id) => config.units[id]);
  } else {
    pool = [];
    for (const [unitId, cfg] of Object.entries(config.units)) {
      if (unitId.startsWith('_') || typeof cfg !== 'object') continue; // 跳过文档字段
      if ((cfg.quality || 1) <= maxQ) pool.push(unitId);
    }
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
  }
  if (pool.length === 0) return { units, synergies: [], buildingUpgrades: {} };

  // 抽取 4 个槽位（key = 兵营等级 1~4），等级按槽位微浮动
  for (let i = 0; i < AI_DEPLOY_SLOTS; i++) {
    const unitId = pool[i % pool.length];
    const lvl = clamp(lvlAxis + SLOT_LEVEL_OFFSETS[i], 1, MAX_UNIT_LEVEL);
    const stats = getUnitStats(unitId, lvl);
    if (stats) units[i + 1] = stats;
  }

  // AI 建筑与玩家同款基础数值（不配强化，与未强化玩家一致）；
  // 羁绊走种族模式的 style 分支（按 combatStyles 自动触发战斗方式羁绊），不配 deployedSynergies
  return { units, synergies: [], buildingUpgrades: {} };
}

export default {
  calculateUnitPower,
  calculatePlayerPower,
  getLobbyPowerInfo,
  getTierAiSettings,
  generateAiDeployment,
  TIER_POWER_REFERENCE,
};
