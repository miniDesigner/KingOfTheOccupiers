/**
 * 建筑类
 * 支持两种数据来源：
 *   1. 上阵系统(deploymentBundle) — 玩家建筑，数据来自局外养成
 *   2. 种族配置(race) — 敌方建筑，数据来自 races.json (向后兼容)
 */

import { BUILDING_CONFIG, getFlipCost, GROUP_THRESHOLD, getQualityColor, getQualityMultiplier } from '../config.js';
import { getUnitInfo, getBuildingVariant } from '../data/races.js';
import { battleRandom } from '../utils/rng.js';

export class Building {
  /**
   * @param {string} type - 建筑类型
   * @param {number} level - 等级(兵营1~4, 其他固定1)
   * @param {string} race - 种族(敌方建筑用，玩家建筑传 'custom')
   * @param {number} owner - 所属玩家
   * @param {object|null} deploymentBundle - 上阵数据包(玩家建筑专用)
   */
  constructor(type, level, race, owner, deploymentBundle = null) {
    this.type = type;
    this.level = level || 1;
    this.race = race || 'human';
    this.owner = owner;

    // 上阵模式标记
    this._useDeployment = !!deploymentBundle;

    if (this._useDeployment) {
      // === 上阵模式：数据来自局外养成 ===
      this._initFromDeployment(type, level, deploymentBundle);
    } else {
      // === 种族模式：数据来自 races.json (敌方建筑) ===
      this._initFromRace(type, level, race);
    }

    // 战士缓冲池(兵营/大本营专用)
    this.warriorBuffer = 0;
    this.groupThreshold = GROUP_THRESHOLD;

    // 金矿缓冲池(金币产出进度)
    this.goldBuffer = 0;

    // 箭塔远程攻击属性
    this.attackTimer = 0;
  }

  /**
   * 从上阵数据初始化（玩家建筑）
   */
  _initFromDeployment(type, level, bundle) {
    const bldUpgrades = bundle.buildingUpgrades || {};
    const units = bundle.units || {};

    // 确定建筑强化等级数据
    // 兵营按 level 查找，其他建筑按类型查找
    let bldStats = null;
    if (type === 'barracks') {
      // 兵营：根据地图预设等级，但使用玩家强化的属性
      bldStats = bldUpgrades['barracks'];
    } else if (type === 'arrow_tower') {
      bldStats = bldUpgrades['arrow_tower'];
    } else if (type === 'gold_mine' || type === 'gold_mine_lv1' || type === 'gold_mine_lv2') {
      bldStats = bldUpgrades['gold_mine'];
    } else if (type === 'headquarters') {
      // 大本营：使用固定属性
      bldStats = null; // 用默认配置
    }

    // 从 BUILDING_CONFIG 读取基础属性作为兜底
    const config = BUILDING_CONFIG[type];
    const levelConfig = config ? (config[this.level] || config[1]) : null;

    // 应用建筑强化数据
    this.maxHp = bldStats?.hp || (levelConfig ? levelConfig.hp : 10);
    this.currentHp = this.maxHp;
    this.defenseBonus = bldStats?.defense ?? (levelConfig ? (levelConfig.defense || 0) : 0);
    this.goldRate = bldStats?.goldRate ?? (levelConfig ? (levelConfig.goldRate || 0) : 0);
    this.warriorRate = bldStats?.warriorRate ?? (levelConfig ? (levelConfig.warriorRate || 0) : 0);
    this.attackBonus = levelConfig ? (levelConfig.attackBonus || 0) : 0;
    this.color = levelConfig ? levelConfig.color : '#888888';
    this.name = levelConfig ? levelConfig.name : type;
    this.cost = bldStats?.cost ?? (levelConfig ? levelConfig.cost : 0);
    this.range = bldStats?.range ?? (levelConfig ? (levelConfig.range || 0) : 0);
    this.attackDamage = bldStats?.attackDamage ?? (levelConfig ? (levelConfig.attackDamage || 0) : 0);
    this.attackCooldown = bldStats?.attackCooldown ?? (levelConfig ? (levelConfig.attackCooldown || 0) : 0);
    this.maxQuality = levelConfig ? (levelConfig.maxQuality || 6) : 6;

    // 保存强化数据引用，供 reset() 使用
    this._deploymentBldStats = bldStats;

    // 种族外观变体（上阵模式不使用种族变体，用默认色）
    this.variantColor = this.color;

    // 兵营：从上阵兵种中随机选择（品质越高概率越低）
    this.unitType = '';
    this.combatStyles = [];
    this.unitData = null; // 完整兵种数据，供 MarchGroup 使用

    if (type === 'barracks') {
      // 随机选择一个上阵兵种
      const unitStats = this._rollRandomUnit(units);
      if (unitStats) {
        this.unitType = unitStats.name;
        this.combatStyles = [...(unitStats.combatStyles || [])];
        this.unitData = {
          attackCoeff: unitStats.attackCoeff,
          hpCoeff: unitStats.hpCoeff,
          speedCoeff: unitStats.speedCoeff,
          attackRange: unitStats.attackRange ?? 1,
          productionSpeed: unitStats.productionSpeed ?? 1.0,
          special: unitStats.special,
          quality: unitStats.quality || 1,
          qualityMultiplier: unitStats.qualityMultiplier || 1.0,
          unitId: unitStats.id || unitStats.name,
          icon: unitStats.icon || '',
          name: unitStats.name || '',
          combatStyles: unitStats.combatStyles || ['melee'],
          // 已解锁技能表(DeploymentSystem 按兵种等级过滤) → MarchGroup 消费
          skills: unitStats.skills || [],
        };
        // 建筑外观和生命由兵种品质决定
        const qColor = getQualityColor(unitStats.quality);
        this.color = qColor;
        this.variantColor = qColor;
        // HP = 基础兵营HP × 兵种hpCoeff（高品质兵种hpCoeff更高）
        this.maxHp = Math.max(10, Math.round(this.maxHp * (unitStats.hpCoeff || 1.0)));
        this.currentHp = this.maxHp;
        this.race = unitStats.combatStyles?.[0] || 'custom';
        // 生产速度：兵营基础warriorRate × 兵种productionSpeed
        this.warriorRate = Math.round(this.warriorRate * (unitStats.productionSpeed || 1.0) * 100) / 100;
      }
    } else if (type === 'headquarters') {
      // 大本营使用默认兵种
      const unitStats = units[1];
      if (unitStats) {
        this.unitType = unitStats.name;
        this.combatStyles = [...(unitStats.combatStyles || ['melee'])];
        this.unitData = {
          attackCoeff: unitStats.attackCoeff,
          hpCoeff: unitStats.hpCoeff,
          speedCoeff: unitStats.speedCoeff,
          attackRange: unitStats.attackRange ?? 1,
          productionSpeed: unitStats.productionSpeed ?? 1.0,
          special: unitStats.special,
          unitId: unitStats.id || unitStats.name,
          icon: unitStats.icon || '',
          name: unitStats.name || '',
          combatStyles: unitStats.combatStyles || ['melee'],
          quality: unitStats.quality || 1,
          // 已解锁技能表 → MarchGroup 消费
          skills: unitStats.skills || [],
        };
      }
    }

    // 上阵模式不使用种族变体特殊属性
    this.slowOnHit = 0;
    this.allStatBonus = 0;
  }

  /**
   * 从种族配置初始化（敌方建筑，向后兼容）
   */
  _initFromRace(type, level, race) {
    // 从配置读取基础属性
    const config = BUILDING_CONFIG[type];
    const levelConfig = config ? (config[this.level] || config[1]) : null;

    this.maxHp = levelConfig ? levelConfig.hp : 10;
    this.currentHp = this.maxHp;
    this.defenseBonus = levelConfig ? (levelConfig.defense || 0) : 0;
    this.goldRate = levelConfig ? (levelConfig.goldRate || 0) : 0;
    this.warriorRate = levelConfig ? (levelConfig.warriorRate || 0) : 0;
    this.attackBonus = levelConfig ? (levelConfig.attackBonus || 0) : 0;
    this.color = levelConfig ? levelConfig.color : '#888888';
    this.name = levelConfig ? levelConfig.name : type;
    this.cost = levelConfig ? levelConfig.cost : 0;
    this.range = levelConfig ? (levelConfig.range || 0) : 0;
    this.attackDamage = levelConfig ? (levelConfig.attackDamage || 0) : 0;
    this.attackCooldown = levelConfig ? (levelConfig.attackCooldown || 0) : 0;
    this.maxQuality = levelConfig ? (levelConfig.maxQuality || 6) : 6;

    // 兵营专用属性
    this.unitType = '';
    this.combatStyles = [];
    this.unitData = null;

    if (type === 'barracks') {
      const unitInfo = getUnitInfo(race, this.level);
      if (unitInfo) {
        this.unitType = unitInfo.name;
        this.combatStyles = unitInfo.combatStyles || [];
        // 填充 unitData 供 MarchGroup 统一使用
        this.unitData = {
          attackCoeff: unitInfo.attackCoeff,
          hpCoeff: unitInfo.hpCoeff,
          speedCoeff: unitInfo.speedCoeff,
          attackRange: unitInfo.attackRange ?? 1, // 种族单位默认近战，races.json 可配置远程(2+)
          productionSpeed: 1.0,
          special: unitInfo.special,
          icon: unitInfo.icon || '',   // 兵种图标（races.json units.icon）
          name: unitInfo.name || '',
        };
      }
    }

    // 种族外观变体 + 属性调整
    const variant = getBuildingVariant(race, type);
    this.variantColor = variant.color;
    this._applyBuildingVariant(variant);

    // 变体特殊属性
    this.slowOnHit = variant.slowOnHit || 0;
    this.allStatBonus = variant.allStatBonus || 0;
  }

  /**
   * 应用种族建筑变体属性调整
   * @param {object} variant - 种族变体配置
   */
  _applyBuildingVariant(variant) {
    // 金矿种族变体: 金币产出调整 + HP调整
    if (this.type === 'gold_mine' || this.type === 'gold_mine_lv1' || this.type === 'gold_mine_lv2') {
      if (variant.goldRateModifier) {
        this.goldRate = Math.round(this.goldRate * (1 + variant.goldRateModifier) * 10) / 10;
      }
      if (variant.hpModifier) {
        this.maxHp = Math.max(1, this.maxHp + variant.hpModifier);
        this.currentHp = this.maxHp;
      }
    }

    // 箭塔种族变体: 防御调整 + HP调整 + 攻击加成
    if (this.type === 'arrow_tower') {
      if (variant.defenseModifier) {
        this.defenseBonus = Math.max(0, this.defenseBonus + variant.defenseModifier);
      }
      if (variant.hpModifier) {
        this.maxHp = Math.max(1, this.maxHp + variant.hpModifier);
        this.currentHp = this.maxHp;
      }
      if (variant.attackBonusModifier) {
        this.attackBonus = (this.attackBonus || 0) + variant.attackBonusModifier;
      }
    }
  }

  /**
   * 受到伤害
   * @param {number} damage - 原始伤害值
   * @param {number} damageReduction - 减伤比例(0~1)
   * @returns {boolean} 是否被摧毁
   */
  takeDamage(damage, damageReduction = 0) {
    const actualDamage = damage * (1 - damageReduction);
    this.currentHp -= actualDamage;
    if (this.currentHp <= 0) {
      this.currentHp = 0;
      return true;
    }
    return false;
  }

  /**
   * 获取防御力
   * @param {number} synergyDefenseBonus - 羁绊防御加成
   * @returns {number}
   */
  getDefense(synergyDefenseBonus = 0) {
    return this.currentHp + this.defenseBonus * (1 + synergyDefenseBonus);
  }

  /**
   * 获取攻击力(兵营产出战士的攻击力加成)
   * @param {number} warriorCount - 战士数量
   * @param {number} raceSynergyBonus - 种族羁绊攻击加成
   * @param {number} styleSynergyBonus - 战斗方式羁绊攻击加成
   * @returns {number}
   */
  getAttackPower(warriorCount, raceSynergyBonus = 0, styleSynergyBonus = 0) {
    if (this.type !== 'barracks' && this.type !== 'headquarters') return 0;
    // 优先使用 unitData（上阵模式），否则从种族配置查找
    let attackCoeff = 1.0;
    if (this.unitData) {
      attackCoeff = this.unitData.attackCoeff || 1.0;
    } else {
      const unitInfo = getUnitInfo(this.race, this.level);
      attackCoeff = unitInfo ? unitInfo.attackCoeff : 1.0;
    }
    const synergyMultiplier = 1 + raceSynergyBonus + styleSynergyBonus;
    return warriorCount * attackCoeff * (1 + this.attackBonus) * synergyMultiplier;
  }

  /**
   * 是否是兵营
   */
  isBarracks() {
    return this.type === 'barracks';
  }

  /**
   * 是否是大本营
   */
  isHeadquarters() {
    return this.type === 'headquarters';
  }

  /**
   * 是否有箭塔攻击能力（箭塔或大本营）
   */
  isTower() {
    return (this.type === 'arrow_tower' || this.type === 'headquarters')
      && this.range > 0 && this.attackDamage > 0;
  }

  /**
   * 从上阵兵种中随机选择一个
   * 品质越高概率越低，低等级兵营只能随机到低品质兵种
   * @param {object} units - 上阵兵种字典 { level: stats }
   * @returns {object|null} 选中的兵种stats
   */
  _rollRandomUnit(units) {
    const unitList = Object.values(units).filter(u => u && u.attackCoeff !== undefined);
    if (unitList.length === 0) return null;

    // 按兵营等级筛选：maxQuality 限制可选品质
    const maxQ = this.maxQuality || 6;
    const eligible = unitList.filter(u => (u.quality || 1) <= maxQ);
    if (eligible.length === 0) {
      // 所有上阵兵种品质都超过兵营maxQuality
      // 兜底：选择品质最低的兵种（最弱的一个），确保低级兵营不会出高级兵
      return unitList.reduce((min, u) =>
        (u.quality || 1) < (min.quality || 1) ? u : min, unitList[0]);
    }

    // 权重随机：品质越高概率越低
    // weight = 1 / quality（品质1权重1.0，品质6权重0.167）
    const weights = eligible.map(u => 1 / (u.quality || 1));
    const totalWeight = weights.reduce((a, b) => a + b, 0);
    let roll = battleRandom() * totalWeight;
    for (let i = 0; i < eligible.length; i++) {
      roll -= weights[i];
      if (roll <= 0) return eligible[i];
    }
    return eligible[eligible.length - 1];
  }

  /**
   * 是否产出战士
   */
  producesWarriors() {
    return this.warriorRate > 0;
  }

  /**
   * 是否产出金币
   */
  producesGold() {
    return this.goldRate > 0;
  }

  /**
   * 重置(建筑被摧毁后)
   * 玩家建筑(deployment模式)使用强化等级数据恢复HP
   * 敌方建筑(race模式)使用种族配置恢复HP
   */
  reset() {
    if (this._useDeployment && this._deploymentBldStats) {
      // 上阵模式：从建筑强化数据恢复
      this.maxHp = this._deploymentBldStats.hp || 20;
    } else {
      // 种族模式/兜底：从基础配置恢复
      const config = BUILDING_CONFIG[this.type];
      const levelConfig = config ? (config[this.level] || config[1]) : null;
      this.maxHp = levelConfig ? levelConfig.hp : 10;

      if (!this._useDeployment) {
        // 种族模式：重新应用变体
        const variant = getBuildingVariant(this.race, this.type);
        if (variant.hpModifier) {
          this.maxHp = Math.max(1, this.maxHp + variant.hpModifier);
        }
      }
    }

    this.currentHp = this.maxHp;
    this.warriorBuffer = 0;
    this.goldBuffer = 0;
    this.attackTimer = 0;
  }
}
