/**
 * SkillSystem - 兵种技能系统
 *
 * 职责：
 *   1. 技能解锁判定
 *      - 玩家兵种：蓝(默认解锁) / 紫(Lv.6、Lv.12) / 橙(Lv.18；兵种品质≥5默认解锁)
 *      - 敌方种族单位：按AI难度档位 easy=仅蓝 / normal=+紫1 / hard=+紫2 / nightmare=全解锁
 *   2. 被动技能聚合：将已解锁被动技能聚合为 skillBonuses 对象（由 MarchGroup 各 getter 消费）
 *   3. 主动技能引擎：冷却到了自动定时释放（单体/范围/穿透/射线/嘲讽/冲刺/召唤 7 类）
 *
 * 数据流：
 *   玩家链路：DeploymentSystem.getUnitStats → unitData.skills（已解锁技能表）
 *             → Building.unitData → MarchGroup 构造 → initGroupSkills
 *   敌方链路：MarchGroup 构造（种族模式）→ getEnemySkillList(race, level)
 *
 * 主循环挂载：Game.update 中 SynergySystem 之后、MarchSystem 之前
 */

import ConfigLoader from '../data/ConfigLoader.js';
import { CombatSystem } from './CombatSystem.js';
import { PathfindingSystem } from './PathfindingSystem.js';
import { MarchGroup } from '../entity/MarchGroup.js';
import { hexToPixel, pixelToHex } from '../world/HexMath.js';

// 相邻格中心像素间距（与 MarchSystem.TILE_GAP 一致：hex 布局常量 √3）
const TILE_GAP = Math.sqrt(3);

// 敌方难度 → 技能解锁档位（0=仅蓝 1=+紫1 2=+紫2 3=全解锁）
const DIFFICULTY_TIERS = { easy: 0, normal: 1, hard: 2, nightmare: 3 };

// 技能 unlockLevel → 档位序号
const UNLOCK_TIER = { 1: 0, 6: 1, 12: 2, 18: 3 };

export class SkillSystem {
  // ========== 战斗上下文（每局重置） ==========

  static _enemyTier = 1; // 默认 normal

  /**
   * 设置敌方AI难度（Game.initBattle 时调用，决定敌方技能解锁档位）
   * @param {string} difficulty - easy/normal/hard/nightmare
   */
  static setEnemyDifficulty(difficulty, skillTierOverride) {
    // skillTierOverride: 段位技能档位（PowerSystem 段位电脑设定，0~3），优先于难度默认档
    this._enemyTier = (typeof skillTierOverride === 'number')
      ? Math.max(0, Math.min(3, Math.round(skillTierOverride)))
      : (DIFFICULTY_TIERS[difficulty] ?? 1);
  }

  /**
   * 获取当前敌方技能解锁档位
   */
  static getEnemyTier() {
    return this._enemyTier;
  }

  /**
   * 重置战斗上下文
   */
  static reset() {
    this._enemyTier = 1;
  }

  // ========== 配置访问 ==========

  static _cfg() {
    return ConfigLoader.getSafe('skills') || {};
  }

  /**
   * 获取玩家兵种全部技能表（UI 展示用，含未解锁）
   * @param {string} unitId - 兵种ID
   * @returns {Array|null}
   */
  static getAllUnitSkills(unitId) {
    const cfg = this._cfg();
    return cfg.units?.[unitId] || null;
  }

  /**
   * 获取玩家兵种已解锁技能列表
   * 解锁规则：蓝(默认) / 紫(Lv.6、Lv.12) / 橙(Lv.18 或 兵种品质≥5默认解锁)
   * @param {string} unitId - 兵种ID
   * @param {number} level - 兵种等级
   * @param {number} unitQuality - 兵种品质(1-6)
   * @returns {Array} 已解锁技能数组（可能为空）
   */
  static getUnitSkillList(unitId, level = 1, unitQuality = 1) {
    const all = this.getAllUnitSkills(unitId);
    if (!all) return [];

    const rules = this._cfg().unlockRules || {};
    const lv = Math.max(1, level);
    const orangeAutoQ = rules.orangeQualityAutoUnlock || 5;

    return all.filter((s) => {
      if ((s.unlockLevel || 1) <= 1) return true; // 蓝色默认解锁
      if (s.kind === 'active' && (unitQuality || 1) >= orangeAutoQ) return true; // 高品质兵种默认解锁橙色主动
      return lv >= (s.unlockLevel || 1);
    });
  }

  /**
   * 获取敌方种族单位已解锁技能列表（按当前AI难度档位）
   * @param {string} race - 种族
   * @param {number} barracksLevel - 兵营等级(即单位档位 1-4)
   * @returns {Array} 已解锁技能数组（可能为空）
   */
  static getEnemySkillList(race, barracksLevel) {
    const cfg = this._cfg();
    const list = cfg.raceUnits?.[`${race}_${barracksLevel}`];
    if (!list) return [];

    const tier = this._enemyTier;
    return list.filter((s) => (UNLOCK_TIER[s.unlockLevel] ?? 0) <= tier);
  }

  // ========== 被动聚合 ==========

  /**
   * 将已解锁被动技能聚合为 skillBonuses 对象
   * 键与 MarchGroup 现有 getter 消费口对齐（synergyBonuses 同构）
   *
   * @param {Array} skills - 已解锁技能列表
   * @returns {object} skillBonuses 聚合对象（无被动时返回 null）
   */
  static aggregatePassives(skills) {
    if (!skills || skills.length === 0) return null;

    const agg = {
      attackBonus: 0,          // 攻击加成（乘区，与羁绊同层叠加）
      damageBonus: 0,          // 伤害加成（乘区，与羁绊同层叠加）
      critBonus: 0,            // 暴击率加成
      critDamageBonus: 0,      // 暴击伤害加成（叠加到 1.5 基础上）
      damageReduction: 0,      // 减伤比例
      damageReflect: 0,        // 反伤比例
      armorPierce: 0,          // 护甲穿透比例
      spellDamageBonus: 0,     // 法术伤害加成
      executeBonus: 0,         // 残血攻击加成
      executeThreshold: 0.5,   // 残血阈值
      killBonus: 0,            // 每次击杀永久攻击加成
      postBattleHeal: 0,       // 战后回血比例
      splash: 0,               // 溅射伤害比例
      firstStrike: false,      // 先手攻击
      reviveChance: 0,         // 复活概率
      reviveCount: 0,          // 复活数量
      speedBonus: 0,           // 行军速度加成
    };

    let hasPassive = false;
    for (const s of skills) {
      if (s.kind !== 'passive') continue;
      hasPassive = true;
      switch (s.type) {
        case 'attack_bonus': agg.attackBonus += s.value; break;
        case 'damage_bonus': agg.damageBonus += s.value; break;
        case 'crit_bonus': agg.critBonus += s.value; break;
        case 'crit_damage': agg.critDamageBonus += s.value; break;
        case 'damage_reduction': agg.damageReduction += s.value; break;
        case 'damage_reflect': agg.damageReflect += s.value; break;
        case 'armor_pierce': agg.armorPierce += s.value; break;
        case 'spell_damage': agg.spellDamageBonus += s.value; break;
        case 'execute_bonus':
          agg.executeBonus += s.value;
          agg.executeThreshold = s.threshold || 0.5;
          break;
        case 'kill_bonus': agg.killBonus += s.value; break;
        case 'post_battle_heal': agg.postBattleHeal += s.value; break;
        case 'splash': agg.splash += s.value; break;
        case 'first_strike': agg.firstStrike = true; break;
        case 'revive':
          agg.reviveChance = Math.max(agg.reviveChance, s.value);
          agg.reviveCount = Math.max(agg.reviveCount, s.count || 1);
          break;
        case 'speed_bonus': agg.speedBonus += s.value; break;
      }
    }
    return hasPassive ? agg : null;
  }

  // ========== 主动技能挂载 ==========

  /**
   * 为 MarchGroup 注入技能数据（构造时调用）
   * @param {MarchGroup} group
   * @param {Array} skills - 已解锁技能列表（含被动与主动）
   */
  static initGroupSkills(group, skills) {
    if (!skills || skills.length === 0) return;

    const passives = skills.filter((s) => s.kind === 'passive');
    group.skillPassives = this.aggregatePassives(passives);

    // 召唤物不携带主动技能（防无限召唤）
    if (group.isSummon) return;

    const active = skills.find((s) => s.kind === 'active');
    if (active) {
      group.activeSkill = active;
      // 首次释放延迟 = 冷却的50%（开局即有一波节奏感，又不至于秒放）
      group.skillCooldownTimer = (active.cooldown || 20) * 0.5;
    }
  }

  // ========== 主动技能引擎 ==========

  /**
   * 主循环更新：冷却计时 + 自动释放
   * 在 Game.update 中 SynergySystem 之后、MarchSystem 之前调用
   * @param {number} dt - 帧时间
   * @param {MarchGroup[]} marchGroups - 所有队伍（召唤技能会 push 新队伍）
   * @param {HexMap} hexMap - 地图
   * @param {Player[]} players - 所有玩家
   */
  static update(dt, marchGroups, hexMap, players) {
    for (const group of marchGroups) {
      if (!group.activeSkill || !group.isAlive()) continue;

      group.skillCooldownTimer -= dt;
      if (group.skillCooldownTimer > 0) continue;

      const casted = this._castActive(group, group.activeSkill, marchGroups, hexMap, players);
      // 释放成功 → 重置完整冷却；无目标 → 1秒后重试
      group.skillCooldownTimer = casted ? (group.activeSkill.cooldown || 20) : 1.0;
    }
  }

  /**
   * 释放主动技能（按类型分发）
   */
  static _castActive(group, skill, marchGroups, hexMap, players) {
    switch (skill.type) {
      case 'single': return this._castSingle(group, skill, marchGroups);
      case 'aoe': return this._castAoe(group, skill, marchGroups, hexMap);
      case 'pierce':
      case 'ray': return this._castLine(group, skill, marchGroups, hexMap, players);
      case 'taunt': return this._castTaunt(group, skill, marchGroups, hexMap);
      case 'dash': return this._castDash(group, skill);
      case 'summon': return this._castSummon(group, skill, marchGroups, hexMap, players);
      default: return false;
    }
  }

  /**
   * 通用伤害结算：按「自身战力 × power」折算为对目标兵力的杀伤
   * 杀伤数 = 伤害总量 / 目标单兵战力，上限 cap × 目标兵力（防秒杀）
   * @returns {number} 实际击杀的战士数
   */
  static _dealDamage(caster, target, powerRatio, cap, opts = {}) {
    if (!target || !target.isAlive()) return 0;

    const { power } = CombatSystem.calculateEffectivePower(caster);
    const targetPower = Math.max(0.01, target.getPower());
    const targetPPW = targetPower / Math.max(1, target.warriors);

    let kills = Math.floor((power * powerRatio) / targetPPW);
    const maxKills = Math.max(1, Math.floor(target.warriors * cap));
    kills = Math.min(kills, maxKills);
    if (opts.minKill) kills = Math.max(kills, Math.min(opts.minKill, target.warriors));
    if (kills <= 0) return 0;

    const before = target.warriors;
    target.takeLosses(kills);
    CombatSystem.addDamageText(target.pixelX, target.pixelY - 12, kills, '#f97316');
    return before - target.warriors;
  }

  /**
   * 单体爆发：对最近的敌方队伍造成高额伤害
   */
  static _castSingle(group, skill, marchGroups) {
    let target = null, bestD2 = Infinity;
    for (const other of marchGroups) {
      if (other.owner === group.owner || !other.isAlive()) continue;
      const dx = other.pixelX - group.pixelX;
      const dy = other.pixelY - group.pixelY;
      const d2 = dx * dx + dy * dy;
      if (d2 < bestD2) { bestD2 = d2; target = other; }
    }
    if (!target) return false;

    const kills = this._dealDamage(group, target, skill.power || 0.55, skill.cap || 0.35, { minKill: 1 });
    CombatSystem.addExplosion(target.pixelX, target.pixelY, '#f97316');
    CombatSystem.addArrowEffect(group.pixelX, group.pixelY, target.pixelX, target.pixelY);
    return true; // 有目标即视为释放（即便杀伤为0也打出特效）
  }

  /**
   * 范围伤害：对半径内所有敌方队伍造成伤害
   */
  static _castAoe(group, skill, marchGroups, hexMap) {
    if (!hexMap) return false;
    const radiusPx = (skill.radius || 2.5) * hexMap.size * TILE_GAP;
    const r2 = radiusPx * radiusPx;

    let any = false;
    for (const other of marchGroups) {
      if (other.owner === group.owner || !other.isAlive()) continue;
      const dx = other.pixelX - group.pixelX;
      const dy = other.pixelY - group.pixelY;
      if (dx * dx + dy * dy > r2) continue;
      this._dealDamage(group, other, skill.power || 0.35, skill.cap || 0.18);
      CombatSystem.addExplosion(other.pixelX, other.pixelY, '#fb923c');
      any = true;
    }
    return any;
  }

  /**
   * 穿透/射线：朝敌方大本营方向发射直线攻击，命中直线上所有敌方队伍
   * pierce = 短而宽（贯穿冲锋）；ray = 长而窄（远程光束）
   */
  static _castLine(group, skill, marchGroups, hexMap, players) {
    if (!hexMap) return false;

    // 方向：指向敌方大本营（像素）
    const enemy = (players || []).find((p) => p.id !== group.owner);
    let dirX = 0, dirY = 0;
    if (enemy && enemy.base) {
      const basePx = hexToPixel(enemy.base.q, enemy.base.r, hexMap.size);
      dirX = basePx.x - group.pixelX;
      dirY = basePx.y - group.pixelY;
    } else {
      // 兜底：指向最近的敌方队伍
      let best = Infinity, tx = 0, ty = 0;
      for (const other of marchGroups) {
        if (other.owner === group.owner || !other.isAlive()) continue;
        const d2 = (other.pixelX - group.pixelX) ** 2 + (other.pixelY - group.pixelY) ** 2;
        if (d2 < best) { best = d2; tx = other.pixelX; ty = other.pixelY; }
      }
      dirX = tx - group.pixelX;
      dirY = ty - group.pixelY;
    }
    const len = Math.hypot(dirX, dirY);
    if (len < 1) return false;
    dirX /= len; dirY /= len;

    const tilePx = hexMap.size * TILE_GAP;
    const reach = (skill.length || skill.range || 4) * tilePx;
    const halfWidth = (skill.width || 1.0) * tilePx * 0.5;
    const endX = group.pixelX + dirX * reach;
    const endY = group.pixelY + dirY * reach;

    let any = false;
    for (const other of marchGroups) {
      if (other.owner === group.owner || !other.isAlive()) continue;
      if (this._pointSegmentDist(other.pixelX, other.pixelY, group.pixelX, group.pixelY, endX, endY) <= halfWidth) {
        this._dealDamage(group, other, skill.power || 0.3, skill.cap || 0.2);
        CombatSystem.addExplosion(other.pixelX, other.pixelY, '#fbbf24');
        any = true;
      }
    }

    CombatSystem.addArrowEffect(group.pixelX, group.pixelY, endX, endY);
    return any;
  }

  /**
   * 嘲讽：强制半径内敌方队伍攻击本队（打断攻城，形成防御仇恨）
   */
  static _castTaunt(group, skill, marchGroups, hexMap) {
    if (!hexMap) return false;
    const radiusPx = (skill.radius || 3) * hexMap.size * TILE_GAP;
    const r2 = radiusPx * radiusPx;

    let any = false;
    for (const other of marchGroups) {
      if (other.owner === group.owner || !other.isAlive()) continue;
      const dx = other.pixelX - group.pixelX;
      const dy = other.pixelY - group.pixelY;
      if (dx * dx + dy * dy > r2) continue;

      // 强制转向攻击本队（打断攻城计时）
      other.state = 'fighting_warrior';
      other.fightTarget = group;
      other.combatTimer = 0;
      CombatSystem.addCritEffect(other.pixelX, other.pixelY);
      any = true;
    }
    return any;
  }

  /**
   * 冲刺：短时间内大幅提升行军速度
   */
  static _castDash(group, skill) {
    group.dashFactor = skill.speedMult || 3.0;
    group.dashTimer = skill.duration || 3.0;
    CombatSystem.addCritEffect(group.pixelX, group.pixelY);
    return true;
  }

  /**
   * 召唤：在本队位置召唤一支援军队伍，向敌方大本营进军
   */
  static _castSummon(group, skill, marchGroups, hexMap, players) {
    if (!hexMap) return false;

    // 召唤兵力 = 本队兵力 × 比例（设上限），至少3人
    const warriors = Math.max(3, Math.min(skill.maxWarriors || 30, Math.ceil(group.warriors * (skill.ratio || 0.25))));

    // 出生位置：本队当前像素位置对应格子
    const hex = pixelToHex(group.pixelX, group.pixelY, hexMap.size);
    const startTile = hexMap.getTile(hex.q, hex.r) || group.currentTile;
    if (!startTile) return false;

    const summon = MarchGroup.createSummon(group, warriors, startTile);

    // 目标：敌方大本营
    const enemy = (players || []).find((p) => p.id !== group.owner);
    if (enemy && enemy.base) {
      const path = PathfindingSystem.findPath(startTile, enemy.base, hexMap, summon.owner);
      if (path && path.length > 0) {
        summon.setPath(path, hexMap);
      }
    }

    marchGroups.push(summon);
    CombatSystem.addReviveEffect(group.pixelX, group.pixelY);
    return true;
  }

  // ========== 几何工具 ==========

  /**
   * 点到线段的最短距离
   */
  static _pointSegmentDist(px, py, ax, ay, bx, by) {
    const dx = bx - ax, dy = by - ay;
    const segLen2 = dx * dx + dy * dy;
    if (segLen2 < 1e-6) return Math.hypot(px - ax, py - ay);
    let t = ((px - ax) * dx + (py - ay) * dy) / segLen2;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
  }
}

export default SkillSystem;
