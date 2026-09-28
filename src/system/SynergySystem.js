/**
 * 羁绊系统（2026-09-09 改造：上阵兵种自动派生）
 *
 * 新版设计：
 *   - 不再有「解锁/升级/上阵」羁绊卡的手动环节
 *   - 完全由玩家 / AI 上阵的兵种决定 4 类风格羁绊（melee/ranged/defense/magic）
 *   - 等级 = 该风格兵种数（线性，1-6）
 *   - 建筑只接收 buildingHpBonus + damageReduction 两类加成
 *
 * 保留兼容：
 *   - 种族模式（race 模式）继续存在，给敌方走 races.json 路径
 *
 * 支持的加成类型:
 * - attackBonus: 攻击力加成（勇士意志/melee）
 * - speedBonus: 速度加成（远程齐射/ranged）
 * - firstStrike: 遭遇战先手（远程齐射 Lv.3+）
 * - buildingHpBonus: 建筑生命值加成（堡垒之盾/defense，建筑只接收此类）
 * - damageReduction: 减伤比例（堡垒之盾/defense，建筑只接收此类）
 * - critBonus: 暴击率加成（奥术涌动/magic）
 * - damageBonus: 遭遇战额外伤害（奥术涌动/magic）
 * - critDamageMultiplier: 暴击伤害倍率（兼容）
 * - postBattleHeal: 战后回血比例（兼容）
 * - reviveChance/reviveCount: 复活概率/数量（race 模式兼容）
 * - damageReflect: 反伤比例（race 模式兼容）
 * - groupThresholdReduction: 编组阈值降低（race 模式兼容）
 * - splash: 溅射伤害比例（race 模式兼容）
 */

import { getRaceSynergy, getStyleSynergy } from '../config.js';
import { getRace, getRaceSynergyBonus } from '../data/races.js';
import ConfigLoader from '../data/ConfigLoader.js';

export class SynergySystem {
  // 静态引用(由Game设置)
  static animManager = null;
  static audioManager = null;

  /**
   * 计算玩家羁绊
   * 支持两种模式：
   *   - 上阵模式（新）：读 deploymentBundle.units，按 style 自动派生（线性等级）
   *   - 种族模式（兼容）：使用 races.json 配置（敌方 AI 路径）
   *
   * @param {Player} player - 玩家
   * @param {HexMap} hexMap - 地图（race 模式使用）
   * @returns {object} 羁绊状态(含所有加成类型)
   */
  static calculateSynergies(player, hexMap) {
    const config = ConfigLoader.getSafe('deployables');
    const synergiesCfg = config?.synergies || {};

    // === 上阵模式（新）：读 deploymentBundle.units，按 style 自动派生 ===
    const bundle = player.deploymentBundle;
    if (bundle && bundle.units) {
      return this._calculateFromBundle(bundle, synergiesCfg);
    }

    // === 种族模式（兼容）===
    const buildings = player.getBuildings();

    // 统计战斗方式数量
    const styleCount = {};
    for (const building of buildings) {
      if (building.combatStyles && building.combatStyles.length > 0) {
        for (const style of building.combatStyles) {
          styleCount[style] = (styleCount[style] || 0) + 1;
        }
      }
    }

    const bonuses = this._createEmptyBonuses();

    // === 种族模式（敌方，向后兼容）===
    const raceCount = {};
    for (const building of buildings) {
      if (building.race) {
        raceCount[building.race] = (raceCount[building.race] || 0) + 1;
      }
    }

    const raceSynergies = {};
    for (const [race, count] of Object.entries(raceCount)) {
      const tier = this.getRaceSynergyTier(count);
      if (tier > 0) {
        const raceBonus = getRaceSynergyBonus(race, tier);
        raceSynergies[race] = { tier, count, bonus: raceBonus };
        if (raceBonus) {
          this._aggregateBonuses(bonuses, raceBonus);
        }
      } else {
        raceSynergies[race] = { tier: 0, count, bonus: null };
      }
    }

    // 战斗方式羁绊
    const styleSynergies = {};
    const styleConfig = getStyleSynergy();
    for (const [style, count] of Object.entries(styleCount)) {
      const config = styleConfig[style];
      if (!config) continue;
      const tier = this.getStyleSynergyTier(count, config.thresholds);
      if (tier > 0) {
        const bonus = config.bonuses[tier - 1];
        styleSynergies[style] = { tier, count, bonus };
        this._aggregateBonuses(bonuses, bonus);
      } else {
        styleSynergies[style] = { tier: 0, count, bonus: null };
      }
    }

    return {
      mode: 'race',
      raceCount,
      styleCount,
      raceSynergies,
      styleSynergies,
      ...bonuses,
      totalRaceAttackBonus: bonuses.attackBonus,
      totalStyleAttackBonus: 0,
      totalAttackBonus: bonuses.attackBonus,
      totalDefenseBonus: bonuses.defenseBonus,
    };
  }

  /**
   * 触发羁绊激活特效(内部方法)
   * 上阵模式：使用羁绊卡名称作为特效标识
   * 种族模式：使用种族名称查找颜色
   */
  static _triggerSynergyActivation(player, name, tier, icon) {
    // 获取大本营位置作为特效中心
    let x = 0, y = 0;
    if (player.base) {
      const hexSize = 32;
      x = hexSize * 1.5 * player.base.q;
      y = hexSize * Math.sqrt(3) * (player.base.r + player.base.q / 2);
    }

    // 获取颜色：先尝试从种族查找，否则用默认色
    let color = '#8b5cf6';
    const raceData = getRace(name);
    if (raceData) {
      color = raceData.color || color;
    }

    if (this.animManager) {
      this.animManager.synergyActivate(x, y, tier, color);
    }
    if (this.audioManager) {
      this.audioManager.playSynergy();
    }
  }

  /**
   * 创建空的加成对象
   */
  static _createEmptyBonuses() {
    return {
      attackBonus: 0,           // 攻击力加成
      defenseBonus: 0,          // 防御加成
      speedBonus: 0,            // 速度加成
      critBonus: 0,             // 暴击率加成
      critDamageMultiplier: 1.0,// 暴击伤害倍率(基础1.0)
      postBattleHeal: 0,        // 战后回血比例
      reviveChance: 0,          // 复活概率
      reviveCount: 0,           // 复活数量
      damageReflect: 0,         // 反伤比例
      damageReduction: 0,       // 减伤比例
      buildingHpBonus: 0,       // 建筑生命值加成
      groupThresholdReduction: 0, // 编组阈值降低
      splash: 0,                // 溅射伤害比例
      firstStrike: false,       // 遭遇战先手
      damageBonus: 0,           // 遭遇战额外伤害
    };
  }

  /**
   * 将一个加成配置聚合到总加成对象中
   */
  static _aggregateBonuses(total, bonus) {
    if (!bonus) return;
    if (bonus.attackBonus) total.attackBonus += bonus.attackBonus;
    if (bonus.defenseBonus) total.defenseBonus += bonus.defenseBonus;
    if (bonus.speedBonus) total.speedBonus += bonus.speedBonus;
    if (bonus.critBonus) total.critBonus += bonus.critBonus;
    if (bonus.critDamageMultiplier) total.critDamageMultiplier = Math.max(total.critDamageMultiplier, bonus.critDamageMultiplier);
    if (bonus.postBattleHeal) total.postBattleHeal = Math.max(total.postBattleHeal, bonus.postBattleHeal);
    if (bonus.reviveChance) total.reviveChance = Math.max(total.reviveChance, bonus.reviveChance);
    if (bonus.reviveCount) total.reviveCount = Math.max(total.reviveCount, bonus.reviveCount);
    if (bonus.damageReflect) total.damageReflect += bonus.damageReflect;
    if (bonus.damageReduction) total.damageReduction = Math.min(0.75, total.damageReduction + bonus.damageReduction); // 上限75%
    if (bonus.buildingHpBonus) total.buildingHpBonus += bonus.buildingHpBonus;
    if (bonus.groupThresholdReduction) total.groupThresholdReduction = Math.max(total.groupThresholdReduction, bonus.groupThresholdReduction);
    if (bonus.splash) total.splash = Math.max(total.splash, bonus.splash);
    if (bonus.firstStrike) total.firstStrike = true;
    if (bonus.damageBonus) total.damageBonus += bonus.damageBonus;
  }

  /**
   * 上阵模式核心派生：从 deploymentBundle.units 累加 styleCount，查 levels 表得到 Lv.1~6 加成
   * 4 个 style (melee/ranged/defense/magic) 各对应一个羁绊，等级 = 该 style 兵种数（clamp 1-6）
   * @private
   */
  static _calculateFromBundle(bundle, synergiesCfg) {
    // 1. 累加 styleCount（来自上阵兵种，非建筑；多 tag 兵种贡献给每个 style）
    const styleCount = {};
    for (const unit of Object.values(bundle.units || {})) {
      if (unit && Array.isArray(unit.combatStyles)) {
        for (const style of unit.combatStyles) {
          styleCount[style] = (styleCount[style] || 0) + 1;
        }
      }
    }

    const activeSynergies = {};
    const bonuses = this._createEmptyBonuses();

    // 2. 遍历所有羁绊配置，按 style 查 styleCount 得到等级，再查 levels[等级] 拿加成
    for (const [synId, synCfg] of Object.entries(synergiesCfg)) {
      const style = synCfg.style;
      const count = styleCount[style] || 0;
      const level = count > 0 ? Math.min(6, count) : 0; // 0=未激活，1-6=线性等级
      const levelBonus = level > 0 ? (synCfg.levels?.[String(level)] || null) : null;

      activeSynergies[synId] = {
        id: synId,
        name: synCfg.name,
        icon: synCfg.icon,
        style,
        level,
        count,
        bonus: levelBonus,
      };

      if (levelBonus) {
        this._aggregateBonuses(bonuses, levelBonus);
      }
    }

    return {
      mode: 'deployment',
      styleCount,
      activeSynergies,
      ...bonuses,
      totalAttackBonus: bonuses.attackBonus,
      totalDefenseBonus: bonuses.defenseBonus,
    };
  }

  /**
   * 公开派生接口：给定兵种列表（任意形态），返回 { styleCount, activeSynergies }
   * 供 UI 实时预览与 BattleGroup 链路复用，避免重复实现等级映射
   * @param {Array|Object} unitsOrBundle - 兵种数组，或 deploymentBundle
   * @returns {{ styleCount: object, activeSynergies: object }}
   */
  static calculateSynergiesFromUnits(unitsOrBundle) {
    let units = [];
    if (Array.isArray(unitsOrBundle)) {
      units = unitsOrBundle;
    } else if (unitsOrBundle && typeof unitsOrBundle === 'object') {
      units = Object.values(unitsOrBundle.units || {});
    }
    const config = ConfigLoader.getSafe('deployables');
    return this._calculateFromBundle({ units }, config?.synergies || {});
  }

  /**
   * 获取自动羁绊面板数据（供 RenderSystem 实时预览 4 类羁绊）
   * @param {Player} player
   * @returns {Array<{id, name, icon, style, styleName, level, count, bonus}>}
   */
  // 风格中文名（UI 唯一真源，避免界面回落到英文 style key）
  static get STYLE_NAMES() {
    return { melee: '近战', ranged: '远程', defense: '防御', magic: '法术' };
  }

  // 羁绊栏卡片固定顺序（与卡片配色、点击索引一一对应，不随等级跳动）
  static get STYLE_ORDER() {
    return ['melee', 'ranged', 'defense', 'magic'];
  }

  // 加成 key → 中文标签（UI 直接消费，避免各界面重复映射英文 key）
  static get EFFECT_LABELS() {
    return {
      attackBonus: { name: '攻击力', kind: 'percent' },
      speedBonus: { name: '移动速度', kind: 'percent' },
      buildingHpBonus: { name: '建筑生命', kind: 'percent' },
      damageReduction: { name: '建筑减伤', kind: 'percent' },
      critBonus: { name: '暴击率', kind: 'percent' },
      damageBonus: { name: '遭遇战伤害', kind: 'percent' },
      firstStrike: { name: '遭遇战先手', kind: 'flag' },
    };
  }

  /**
   * 单条加成格式化为中文文案
   * @returns {string | null} flag 类且值为 false 时返回 null（调用方需过滤）
   */
  static formatEffect(key, value) {
    const label = this.EFFECT_LABELS[key];
    if (!label) return null;
    if (label.kind === 'flag') return value ? label.name : null;
    const pct = Math.round((value || 0) * 1000) / 10;
    return `${label.name} +${pct}%`;
  }

  /** 接受 player（取 .deploymentBundle）或直接传 bundle，兼容两种调用方 */
  static _resolveBundle(playerOrBundle) {
    if (!playerOrBundle) return null;
    if (playerOrBundle.deploymentBundle) return playerOrBundle.deploymentBundle;
    if (playerOrBundle.units) return playerOrBundle;
    return null;
  }

  /**
   * 布阵界面羁绊栏数据（4 类风格羁绊，按上阵兵种自动派生）
   * 传 player 或 deploymentBundle 均可；未激活的羁绊也会返回（level=0），
   * 保证 UI 永远能拿到真实图标与中文名（不会回落到英文 style key）
   */
  static getAutoSynergyPanelData(playerOrBundle) {
    const bundle = this._resolveBundle(playerOrBundle);
    if (!bundle) return [];
    const config = ConfigLoader.getSafe('deployables');
    const synergiesCfg = config?.synergies || {};
    const data = this._calculateFromBundle(bundle, synergiesCfg);
    const styleNames = this.STYLE_NAMES;

    const list = Object.values(data.activeSynergies).map((s) => ({
      id: s.id,
      name: s.name,
      icon: s.icon,
      style: s.style,
      styleName: styleNames[s.style] || s.style,
      level: s.level,
      count: s.count,
      bonus: s.bonus,
    }));

    // 固定 melee→ranged→defense→magic 顺序，与卡片配色/点击索引一一对应
    return this.STYLE_ORDER
      .map((st) => list.find((s) => s.style === st))
      .filter(Boolean);
  }

  /**
   * 单个羁绊详情（供布阵界面点击羁绊槽弹出的详情窗口使用）
   * @param {string} synergyId - warriors_will / ranged_volley / fortress / arcane_surge
   * @param {object} playerOrBundle - player 或 deploymentBundle
   * @returns {object | null}
   */
  static getSynergyDetail(synergyId, playerOrBundle) {
    const config = ConfigLoader.getSafe('deployables');
    const synCfg = config?.synergies?.[synergyId];
    if (!synCfg) return null;

    const style = synCfg.style;
    const styleName = this.STYLE_NAMES[style] || style;
    const levelKeys = Object.keys(synCfg.levels || {});
    const maxLevel = levelKeys.length || 6;

    const bundle = this._resolveBundle(playerOrBundle);
    let count = 0;
    let level = 0;
    const sourceUnits = [];

    if (bundle) {
      const data = this._calculateFromBundle(bundle, config?.synergies || {});
      const active = data.activeSynergies[synergyId];
      count = active?.count || 0;
      level = active?.level || 0;
      for (const u of Object.values(bundle.units || {})) {
        if (u && Array.isArray(u.combatStyles) && u.combatStyles.includes(style)) {
          sourceUnits.push({ id: u.id, name: u.name || '?', icon: u.icon || '?' });
        }
      }
    }

    const levels = [];
    for (let lv = 1; lv <= maxLevel; lv++) {
      const bonus = synCfg.levels?.[String(lv)] || {};
      levels.push({
        level: lv,
        effects: Object.entries(bonus)
          .map(([k, v]) => this.formatEffect(k, v))
          .filter(Boolean),
        active: lv <= level,
        isCurrent: lv === level,
      });
    }

    return {
      id: synergyId,
      name: synCfg.name,
      icon: synCfg.icon,
      style,
      styleName,
      level,
      count,
      maxLevel,
      active: level > 0,
      // 激活方式说明
      activateDesc: `上阵「${styleName}」风格兵种，每 1 个提升 1 级（最高 Lv.${maxLevel}）`,
      currentDesc: `当前上阵 ${count} 个 → ${level > 0 ? `Lv.${level}` : '未激活'}`,
      // 各级效果（1-6）
      levels,
      currentEffects: level > 0 ? (levels[level - 1]?.effects || []) : [],
      // 贡献该羁绊的上阵兵种
      sourceUnits,
      tip: '羁绊由上阵兵种自动派生，无需手动选择；等级 = 上阵的该风格兵种数量',
    };
  }

  /**
   * 获取种族羁绊阶位
   */
  static getRaceSynergyTier(count) {
    const raceSynergyConfig = getRaceSynergy();
    const thresholds = raceSynergyConfig.thresholds;
    for (let i = thresholds.length - 1; i >= 0; i--) {
      if (count >= thresholds[i]) return i + 1;
    }
    return 0;
  }

  /**
   * 获取战斗方式羁绊阶位
   */
  static getStyleSynergyTier(count, thresholds) {
    for (let i = thresholds.length - 1; i >= 0; i--) {
      if (count >= thresholds[i]) return i + 1;
    }
    return 0;
  }

  /**
   * 更新玩家羁绊加成
   * 将所有羁绊加成写入 player 对象
   */
  static updatePlayerSynergies(player, hexMap) {
    const synergies = this.calculateSynergies(player, hexMap);

    // 计数
    player.styleCount = synergies.styleCount || {};

    if (synergies.mode === 'deployment') {
      // 上阵模式：使用 activeSynergies
      player.raceCount = {}; // 上阵模式无种族计数
      player.activeSynergies = synergies.activeSynergies;

      // 检测羁绊等级变化（新设计：线性 1-6，prevLevel 用 0 兜底）
      const prev = player._prevActiveSynergies || {};
      for (const [synId, info] of Object.entries(synergies.activeSynergies)) {
        const prevLevel = prev[synId] ? (prev[synId].level || 0) : 0;
        if (info.level > prevLevel && info.level > 0) {
          this._triggerSynergyActivation(player, info.name || synId, info.level, info.icon);
        }
      }
      player._prevActiveSynergies = { ...synergies.activeSynergies };
    } else {
      // 种族模式（敌方）
      player.raceCount = synergies.raceCount || {};
      player.activeSynergies = null;

      const prevRaceSynergies = player._prevRaceSynergies || {};
      const newRaceSynergies = synergies.raceSynergies || {};
      for (const [race, info] of Object.entries(newRaceSynergies)) {
        const prevTier = prevRaceSynergies[race] ? prevRaceSynergies[race].tier : 0;
        if (info.tier > prevTier && info.tier > 0) {
          this._triggerSynergyActivation(player, race, info.tier);
        }
      }
      player._prevRaceSynergies = { ...newRaceSynergies };
    }

    // 综合加成
    player.synergyBonuses = {
      attackBonus: synergies.attackBonus,
      defenseBonus: synergies.defenseBonus,
      speedBonus: synergies.speedBonus,
      critBonus: synergies.critBonus,
      critDamageMultiplier: synergies.critDamageMultiplier,
      postBattleHeal: synergies.postBattleHeal,
      reviveChance: synergies.reviveChance,
      reviveCount: synergies.reviveCount,
      damageReflect: synergies.damageReflect,
      damageReduction: synergies.damageReduction,
      buildingHpBonus: synergies.buildingHpBonus,
      groupThresholdReduction: synergies.groupThresholdReduction,
      splash: synergies.splash,
      firstStrike: synergies.firstStrike,
      damageBonus: synergies.damageBonus,
    };

    // 向后兼容
    player.raceSynergyBonus = synergies.attackBonus;
    player.styleSynergyBonus = 0;
    player.synergyDefenseBonus = synergies.defenseBonus;

    // 编组阈值调整(兽族3阶)
    player.groupThresholdReduction = synergies.groupThresholdReduction;

    return synergies;
  }

  /**
   * 更新行军队伍羁绊加成
   */
  static updateGroupSynergies(marchGroups, players, hexMap) {
    for (const group of marchGroups) {
      if (!group.isAlive()) continue;
      const player = players.find(p => p.id === group.owner);
      if (player && player.synergyBonuses) {
        group.updateSynergyBonuses(player.synergyBonuses);
      }
    }
  }

  /**
   * 获取羁绊描述(用于UI)
   */
  static getSynergyDescription(race, tier) {
    const raceData = getRace(race);
    if (!raceData) return '';
    return raceData.synergyEffects[tier - 1] || '';
  }

  /**
   * 获取所有种族的羁绊状态(用于UI面板)
   * @param {Player} player
   * @returns {Array} [{ race, raceName, count, tier, tierName, effect, color }]
   */
  static getSynergyPanelData(player) {
    const result = [];
    const raceCount = player.raceCount || {};

    for (const [raceId, count] of Object.entries(raceCount)) {
      const raceData = getRace(raceId);
      if (!raceData) continue;

      const tier = this.getRaceSynergyTier(count);
      const tierName = tier === 0 ? '未激活' : `${tier}阶`;
      const effect = tier > 0 ? raceData.synergyEffects[tier - 1] : `${count}/2 件`;

      result.push({
        race: raceId,
        raceName: raceData.name,
        color: raceData.color,
        count,
        tier,
        tierName,
        effect,
        synergyName: raceData.synergyName,
      });
    }

    return result.sort((a, b) => b.count - a.count);
  }

  /**
   * 获取战斗方式羁绊状态(用于UI面板)
   * @param {Player} player
   * @returns {Array} [{ style, styleName, count, tier, effect }]
   */
  static getStyleSynergyPanelData(player) {
    const styleNames = {
      melee: '近战',
      ranged: '远程',
      defense: '防御',
      magic: '法术',
    };

    const result = [];
    const styleCount = player.styleCount || {};
    const styleConfig = getStyleSynergy();

    for (const [style, count] of Object.entries(styleCount)) {
      const config = styleConfig[style];
      if (!config) continue;

      const tier = this.getStyleSynergyTier(count, config.thresholds);
      const nextThreshold = tier < config.thresholds.length
        ? config.thresholds[tier]
        : null;

      let effect = '';
      if (tier > 0) {
        const bonus = config.bonuses[tier - 1];
        effect = bonus._doc || '';
      }

      result.push({
        style,
        styleName: styleNames[style] || style,
        count,
        tier,
        nextThreshold,
        effect,
      });
    }

    return result;
  }

}
