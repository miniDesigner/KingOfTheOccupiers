/**
 * 战斗系统
 * vs建筑 + vs战士战斗结算
 * 支持种族特殊效果: 暴击/减伤/反伤/回血/复活/溅射/先手/护甲穿透
 *
 * 结算时产生视觉特效(通过renderSystem)
 */

import { BuildSystem } from './BuildSystem.js';
import { PathfindingSystem } from './PathfindingSystem.js';
import { hexToPixel } from '../world/HexMath.js';
import { KILL_GOLD_PER_WARRIOR, KILL_GOLD_LEVEL_STEP } from '../config.js';
import { battleRandom } from '../utils/rng.js';

export class CombatSystem {
  // 静态引用：由Game设置
  static renderSystem = null;
  static hexMap = null;
  static animManager = null;
  static audioManager = null;

  /**
   * 添加爆炸特效
   */
  static addExplosion(x, y, color = '#ff6b6b') {
    if (this.renderSystem) {
      this.renderSystem.addEffect({
        type: 'explosion',
        x, y,
        color,
        timer: 0,
        duration: 0.5,
      });
    }
    // AnimationManager 粒子爆炸
    if (this.animManager) {
      this.animManager.explosion(x, y, color, 10, 70);
    }
    // 音效
    if (this.audioManager) {
      this.audioManager.play('destroy');
    }
  }

  /**
   * 添加伤害数字特效
   */
  static addDamageText(x, y, value, color = '#ff4444') {
    if (this.renderSystem) {
      this.renderSystem.addEffect({
        type: 'damage',
        x, y,
        value: Math.round(value),
        color,
        timer: 0,
        duration: 0.8,
      });
    }
  }

  /**
   * 添加箭矢飞行特效
   */
  static addArrowEffect(fromX, fromY, toX, toY) {
    if (this.renderSystem) {
      this.renderSystem.addEffect({
        type: 'arrow',
        fromX, fromY,
        toX, toY,
        timer: 0,
        duration: 0.3,
      });
    }
  }

  /**
   * 添加暴击特效
   */
  static addCritEffect(x, y) {
    if (this.renderSystem) {
      this.renderSystem.addEffect({
        type: 'explosion',
        x, y,
        color: '#ffdd00',
        timer: 0,
        duration: 0.6,
      });
      this.renderSystem.addEffect({
        type: 'damage',
        x, y,
        value: '暴击!',
        color: '#ffdd00',
        timer: 0,
        duration: 1.0,
      });
    }
    // AnimationManager 暴击特写
    if (this.animManager) {
      this.animManager.critEffect(x, y);
    }
    // 音效
    if (this.audioManager) {
      this.audioManager.playCrit();
      this.audioManager.vibrateMedium();
    }
  }

  /**
   * 添加回血特效
   */
  static addHealEffect(x, y, amount) {
    if (this.renderSystem) {
      this.renderSystem.addEffect({
        type: 'damage',
        x, y,
        value: '+' + Math.round(amount),
        color: '#00ff66',
        timer: 0,
        duration: 0.8,
      });
    }
    // AnimationManager 治疗粒子
    if (this.animManager) {
      this.animManager.spark(x, y, '#00ff66', 8);
      this.animManager.floatingText(x, y - 10, '+' + Math.round(amount), '#00ff66', 0.8, 12);
    }
    // 音效
    if (this.audioManager) {
      this.audioManager.playHeal();
    }
  }

  /**
   * 添加复活特效
   */
  static addReviveEffect(x, y) {
    if (this.renderSystem) {
      this.renderSystem.addEffect({
        type: 'explosion',
        x, y,
        color: '#8b5cf6',
        timer: 0,
        duration: 0.8,
      });
      this.renderSystem.addEffect({
        type: 'damage',
        x, y,
        value: '复活!',
        color: '#8b5cf6',
        timer: 0,
        duration: 1.0,
      });
    }
    // AnimationManager 复活粒子
    if (this.animManager) {
      this.animManager.explosion(x, y, '#8b5cf6', 16, 60);
      this.animManager.floatingText(x, y - 15, '复活!', '#8b5cf6', 1.0, 16);
    }
    // 音效
    if (this.audioManager) {
      this.audioManager.playRevive();
    }
  }

  // ========== 战力计算(含种族特殊效果) ==========

  /**
   * 计算队伍有效战力(含暴击判定)
   * @param {MarchGroup} group
   * @returns {{ power: number, isCrit: boolean }}
   */
  static calculateEffectivePower(group) {
    let power = group.getPower();

    // 暴击判定
    let isCrit = false;
    const critRate = group.getCritRate ? group.getCritRate() : 0;
    if (critRate > 0 && battleRandom() < critRate) {
      const critMult = group.getCritDamageMultiplier ? group.getCritDamageMultiplier() : 1.5;
      power *= critMult;
      isCrit = true;
    }

    // 龙族溅射: 增加额外伤害
    const splash = group.getSplash ? group.getSplash() : 0;
    if (splash > 0) {
      power *= (1 + splash);
    }

    // 法术额外伤害
    const spellBonus = group.getSpellDamageBonus ? group.getSpellDamageBonus() : 0;
    if (spellBonus > 0) {
      power *= (1 + spellBonus);
    }

    return { power, isCrit };
  }

  /**
   * 计算对建筑的伤害(含护甲穿透)
   * @param {MarchGroup} group
   * @param {Building} building
   * @returns {{ damage: number, isCrit: boolean }}
   */
  static calculateBuildingDamage(group, building) {
    const { power, isCrit } = this.calculateEffectivePower(group);
    let defense = building.getDefense(0);

    // 护甲穿透(矮人火枪手)
    const armorPierce = group.getArmorPierce ? group.getArmorPierce() : 0;
    if (armorPierce > 0) {
      const pierceDefense = building.defenseBonus * armorPierce;
      defense -= pierceDefense;
    }

    return { damage: power, isCrit };
  }

  // ========== vs建筑战斗 ==========

  /**
   * 结算 vs 建筑 战斗(带防守击杀赏金)
   * 进攻方队伍在攻城战斗中损失的战士，视为守方击杀，给守方玩家发放赏金
   */
  static resolveBuildingCombat(group, targetTile, players, hexMap) {
    const beforeWarriors = group.warriors;

    this._resolveBuildingCombatInner(group, targetTile, players, hexMap);

    // 守方击杀赏金(进攻方损失的战士 = 守方击杀数)
    if (!players || !targetTile) return;
    const defenderOwner = targetTile.owner;
    if (defenderOwner === group.owner) return;  // 建筑已被摧毁翻转等情况下不再发放
    const killed = beforeWarriors - group.warriors;
    if (killed > 0 && defenderOwner > 0) {
      const defender = players.find(p => p.id === defenderOwner);
      if (defender) {
        const victoryGroupProxy = { owner: defenderOwner, pixelX: group.pixelX, pixelY: group.pixelY };
        this._awardKillBounty(victoryGroupProxy, group, killed, players);
      }
    }
  }

  /**
   * 结算 vs 建筑 战斗(原始逻辑)
   */
  static _resolveBuildingCombatInner(group, targetTile, players, hexMap) {
    if (!targetTile || !targetTile.building) {
      group.state = 'marching';
      return;
    }

    const building = targetTile.building;

    // 计算攻击力(含暴击/溅射/法术加成)
    const { damage: attackPower, isCrit } = this.calculateBuildingDamage(group, building);

    // 计算防御力(考虑建筑减伤)
    const defense = building.getDefense(0);

    // 获取目标格子像素坐标(用于特效)
    const pixel = hexToPixel(targetTile.q, targetTile.r, hexMap.size);

    if (isCrit) {
      this.addCritEffect(pixel.x, pixel.y - 15);
    }

    if (attackPower > defense) {
      // 建筑被摧毁
      const isHQ = building.isHeadquarters();

      // 摧毁特效(旧系统)
      this.addExplosion(pixel.x, pixel.y, '#ff6b6b');
      this.addDamageText(pixel.x, pixel.y - 10, attackPower, '#ff4444');

      // AnimationManager 建筑崩塌动画
      if (this.animManager) {
        const buildingColor = building.variantColor || building.color || '#888';
        this.animManager.buildingCollapse(pixel.x, pixel.y, buildingColor, isHQ);
      }

      // 战斗音效
      if (this.audioManager) {
        this.audioManager.playCombatBuilding();
      }

      // 摧毁建筑
      BuildSystem.destroyBuilding(targetTile, players, hexMap);

      // 记录击杀(兽族战争领主)
      if (group.recordKill) {
        group.recordKill();
      }

      // 战后回血(亡灵)
      this._applyPostBattleHeal(group, pixel.x, pixel.y);

      // 队伍继续前进
      if (isHQ) {
        group.state = 'arrived';
        // 大本营被摧毁：大爆炸特效
        this.addExplosion(pixel.x, pixel.y, '#ffaa00');
      } else {
        group.state = 'marching';
        // 重新寻路(起点=当前像素位置所在格，比 currentTile 更精确)
        const enemyBase = players.find(p => p.id !== group.owner && p.isAlive());
        if (enemyBase) {
          const startTile = group.getTileAt ? group.getTileAt(hexMap) : group.currentTile;
          const newPath = PathfindingSystem.findPath(startTile, enemyBase.base, hexMap, group.owner);
          if (newPath) {
            group.setPath(newPath, hexMap);
          }
        }
      }
    } else {
      // 进攻失败
      // 建筑受到伤害(考虑减伤)
      const buildingReduction = 0;
      building.takeDamage(attackPower, buildingReduction);

      // 特效
      this.addDamageText(pixel.x, pixel.y - 10, attackPower, '#ffaa00');

      // 远程兵种攻城：攻击失败不会全灭，损失部分战士后继续攻击
      const isRanged = group.isRanged ? group.isRanged() : false;
      if (isRanged) {
        // 远程攻击：损失30%战士，存活继续攻击
        const losses = Math.floor(group.warriors * 0.3);
        group.warriors = Math.max(1, group.warriors - losses);
        group.state = 'marching'; // 回到行军状态，下一帧重新检测并远程攻击
        this.addArrowEffect(group.pixelX, group.pixelY, pixel.x, pixel.y);
        if (losses > 0) {
          this.addDamageText(group.pixelX, group.pixelY - 10, losses, '#ff8844');
        }
        this.addExplosion(group.pixelX, group.pixelY, '#666');
      } else {
        // 近战兵种：进攻失败，队伍全灭
        this.addExplosion(group.pixelX, group.pixelY, '#666');
        group.warriors = 0;
        group.state = 'destroyed';

        // 尝试复活(亡灵3阶)
        this._tryRevive(group, group.pixelX, group.pixelY);
      }
    }
  }

  // ========== vs战士战斗 ==========

  /**
   * 结算 vs 战士 战斗(带击杀赏金)
   * 对比结算前后双方战士数，实际击杀的敌方战士会给击杀方玩家发放金币赏金
   * @param {MarchGroup} groupA
   * @param {MarchGroup} groupB
   * @param {Player[]} players - 所有玩家(用于发放赏金，可省略)
   */
  static resolveWarriorCombat(groupA, groupB, players) {
    const beforeA = groupA ? groupA.warriors : 0;
    const beforeB = groupB ? groupB.warriors : 0;

    // 原始战斗结算
    this._resolveWarriorCombatInner(groupA, groupB);

    // 发放击杀赏金(双方各自按实际击杀数领取)
    if (!players) return;
    const killedB = beforeB - (groupB ? groupB.warriors : 0);
    const killedA = beforeA - (groupA ? groupA.warriors : 0);
    if (killedB > 0) {
      this._awardKillBounty(groupA, groupB, killedB, players);
    }
    if (killedA > 0) {
      this._awardKillBounty(groupB, groupA, killedA, players);
    }
  }

  /**
   * 发放击杀赏金
   * 赏金 = 击杀数 × (基础单价 + 等级加成 × (敌方兵种等级-1))
   * 击杀方拥有"战争掠夺"局外养成时按比例放大
   * @param {MarchGroup} killerGroup - 击杀方队伍(领取赏金的玩家)
   * @param {MarchGroup} victimGroup - 被击杀方队伍(决定赏金单价)
   * @param {number} killedCount - 实际击杀的战士数
   * @param {Player[]} players
   */
  static _awardKillBounty(killerGroup, victimGroup, killedCount, players) {
    const killer = players.find(p => p.id === killerGroup.owner);
    if (!killer) return;

    const base = KILL_GOLD_PER_WARRIOR ?? 2;
    const step = KILL_GOLD_LEVEL_STEP ?? 0.5;
    const victimLevel = victimGroup.level || 1;
    const perWarrior = base + step * (victimLevel - 1);

    let gold = Math.ceil(killedCount * perWarrior);

    // 局外养成: 战争掠夺加成
    if (killer._metaWarPlunder) {
      gold = Math.round(gold * (1 + killer._metaWarPlunder));
    }

    killer.gold += gold;

    // 金币飘字特效
    this.addDamageText(killerGroup.pixelX, killerGroup.pixelY - 24, '+' + gold, '#ffd700');
  }

  /**
   * 结算 vs 战士 战斗(原始逻辑)
   */
  static _resolveWarriorCombatInner(groupA, groupB) {
    if (!groupA || !groupB || !groupA.isAlive() || !groupB.isAlive()) {
      groupA.state = 'marching';
      if (groupB) groupB.state = 'marching';
      return;
    }

    // 计算双方有效战力(含暴击)
    const resultA = this.calculateEffectivePower(groupA);
    const resultB = this.calculateEffectivePower(groupB);

    let powerA = resultA.power;
    let powerB = resultB.power;

    // 先手攻击判定(远程羁绊): 先手方获得额外20%战力
    const firstStrikeA = groupA.hasFirstStrike ? groupA.hasFirstStrike() : false;
    const firstStrikeB = groupB.hasFirstStrike ? groupB.hasFirstStrike() : false;
    if (firstStrikeA && !firstStrikeB) {
      powerA *= 1.2;
    } else if (firstStrikeB && !firstStrikeA) {
      powerB *= 1.2;
    }

    // 射程优势判定
    const rangeA = groupA.getAttackRange ? groupA.getAttackRange() : 1;
    const rangeB = groupB.getAttackRange ? groupB.getAttackRange() : 1;
    const isRangedA = rangeA > 1;
    const isRangedB = rangeB > 1;

    // === 远程 vs 近战：远程兵种不受近战伤害 ===
    // 远程兵种可以在远距离攻击，近战兵种无法反击
    if (isRangedA && !isRangedB) {
      // A远程 vs B近战：A无损击溃B
      this.addArrowEffect(groupA.pixelX, groupA.pixelY, groupB.pixelX, groupB.pixelY);
      this.addExplosion(groupB.pixelX, groupB.pixelY, '#60a5fa');
      this.addDamageText(groupB.pixelX, groupB.pixelY - 10, groupB.warriors, '#60a5fa');
      if (this.audioManager) {
        this.audioManager.playCombatWarrior();
        this.audioManager.vibrateLight();
      }

      groupB.warriors = 0;
      groupB.state = 'destroyed';
      groupA.state = 'marching';

      if (groupA.recordKill) groupA.recordKill();
      this._applyPostBattleHeal(groupA, groupA.pixelX, groupA.pixelY);
      this._tryRevive(groupB, groupB.pixelX, groupB.pixelY);
      return;
    }
    if (isRangedB && !isRangedA) {
      // B远程 vs A近战：B无损击溃A
      this.addArrowEffect(groupB.pixelX, groupB.pixelY, groupA.pixelX, groupA.pixelY);
      this.addExplosion(groupA.pixelX, groupA.pixelY, '#60a5fa');
      this.addDamageText(groupA.pixelX, groupA.pixelY - 10, groupA.warriors, '#60a5fa');
      if (this.audioManager) {
        this.audioManager.playCombatWarrior();
        this.audioManager.vibrateLight();
      }

      groupA.warriors = 0;
      groupA.state = 'destroyed';
      groupB.state = 'marching';

      if (groupB.recordKill) groupB.recordKill();
      this._applyPostBattleHeal(groupB, groupB.pixelX, groupB.pixelY);
      this._tryRevive(groupA, groupA.pixelX, groupA.pixelY);
      return;
    }

    // === 双方同为远程或同为近战：正常战力对比 ===
    const rangeDiff = rangeA - rangeB;
    if (rangeDiff > 0) {
      // A射程更远：A +25%/级，B -15%/级
      powerA *= (1 + 0.25 * rangeDiff);
      powerB *= (1 - 0.15 * rangeDiff);
    } else if (rangeDiff < 0) {
      // B射程更远
      powerB *= (1 + 0.25 * (-rangeDiff));
      powerA *= (1 - 0.15 * (-rangeDiff));
    }

    // 远程攻击视觉特效（双方同为远程时）
    if (isRangedA) {
      this.addArrowEffect(groupA.pixelX, groupA.pixelY, groupB.pixelX, groupB.pixelY);
    }
    if (isRangedB) {
      this.addArrowEffect(groupB.pixelX, groupB.pixelY, groupA.pixelX, groupA.pixelY);
    }

    // 减伤判定
    const reductionA = groupA.getDamageReduction ? groupA.getDamageReduction() : 0;
    const reductionB = groupB.getDamageReduction ? groupB.getDamageReduction() : 0;

    // 应用减伤到对方战力
    const effectivePowerA = powerA * (1 - reductionB);
    const effectivePowerB = powerB * (1 - reductionA);

    // 战斗位置(两队伍中点)
    const midX = (groupA.pixelX + groupB.pixelX) / 2;
    const midY = (groupA.pixelY + groupB.pixelY) / 2;

    // 暴击特效
    if (resultA.isCrit) {
      this.addCritEffect(groupA.pixelX, groupA.pixelY - 10);
    }
    if (resultB.isCrit) {
      this.addCritEffect(groupB.pixelX, groupB.pixelY - 10);
    }

    // 碰撞特效
    this.addExplosion(midX, midY, '#ffcc44');

    // 战斗音效 + 轻震动
    if (this.audioManager) {
      this.audioManager.playCombatWarrior();
      this.audioManager.vibrateLight();
    }

    // 战力差判定
    const ratio = effectivePowerA / effectivePowerB;

    if (ratio > 1.5) {
      // A完胜
      const remainingPower = effectivePowerA - effectivePowerB;
      groupA.warriors = Math.max(1, Math.ceil(remainingPower / (effectivePowerA / groupA.warriors)));
      groupA.state = 'marching';
      groupB.warriors = 0;
      groupB.state = 'destroyed';
      this.addDamageText(midX, midY - 10, effectivePowerB, '#ff4444');

      // A记录击杀
      if (groupA.recordKill) groupA.recordKill();
      // A战后回血
      this._applyPostBattleHeal(groupA, groupA.pixelX, groupA.pixelY);
      // B尝试复活
      this._tryRevive(groupB, groupB.pixelX, groupB.pixelY);
      // A受到B的反伤
      this._applyDamageReflect(groupB, groupA, effectivePowerA);

    } else if (ratio > 1.1) {
      // A惨胜
      const losses = groupA.warriors - Math.max(1, Math.floor(groupA.warriors * 0.3));
      groupA.warriors = Math.max(1, Math.floor(groupA.warriors * 0.3));
      groupA.state = 'marching';
      groupB.warriors = 0;
      groupB.state = 'destroyed';
      this.addDamageText(groupA.pixelX, groupA.pixelY - 10, losses, '#ff8844');

      if (groupA.recordKill) groupA.recordKill();
      this._applyPostBattleHeal(groupA, groupA.pixelX, groupA.pixelY);
      this._tryRevive(groupB, groupB.pixelX, groupB.pixelY);
      this._applyDamageReflect(groupB, groupA, effectivePowerA);

    } else if (ratio >= 0.9 && ratio <= 1.1) {
      // 两败俱伤
      this.addDamageText(midX, midY - 10, effectivePowerA + effectivePowerB, '#ff4444');
      this.addExplosion(midX, midY, '#ff6644');
      groupA.warriors = 0;
      groupA.state = 'destroyed';
      groupB.warriors = 0;
      groupB.state = 'destroyed';

      this._tryRevive(groupA, groupA.pixelX, groupA.pixelY);
      this._tryRevive(groupB, groupB.pixelX, groupB.pixelY);

    } else if (ratio > 0.67) {
      // B惨胜
      const losses = groupB.warriors - Math.max(1, Math.floor(groupB.warriors * 0.3));
      groupB.warriors = Math.max(1, Math.floor(groupB.warriors * 0.3));
      groupB.state = 'marching';
      groupA.warriors = 0;
      groupA.state = 'destroyed';
      this.addDamageText(groupB.pixelX, groupB.pixelY - 10, losses, '#ff8844');

      if (groupB.recordKill) groupB.recordKill();
      this._applyPostBattleHeal(groupB, groupB.pixelX, groupB.pixelY);
      this._tryRevive(groupA, groupA.pixelX, groupA.pixelY);
      this._applyDamageReflect(groupA, groupB, effectivePowerB);

    } else {
      // B完胜
      const remainingPower = effectivePowerB - effectivePowerA;
      groupB.warriors = Math.max(1, Math.ceil(remainingPower / (effectivePowerB / groupB.warriors)));
      groupB.state = 'marching';
      groupA.warriors = 0;
      groupA.state = 'destroyed';
      this.addDamageText(midX, midY - 10, effectivePowerA, '#ff4444');

      if (groupB.recordKill) groupB.recordKill();
      this._applyPostBattleHeal(groupB, groupB.pixelX, groupB.pixelY);
      this._tryRevive(groupA, groupA.pixelX, groupA.pixelY);
      this._applyDamageReflect(groupA, groupB, effectivePowerB);
    }
  }

  // ========== 种族特殊效果处理 ==========

  /**
   * 战后回血(亡灵羁绊)
   */
  static _applyPostBattleHeal(group, x, y) {
    if (!group.healAfterBattle) return;
    const healed = group.healAfterBattle();
    if (healed > 0) {
      this.addHealEffect(x, y, healed);
    }
  }

  /**
   * 尝试复活(亡灵3阶)
   */
  static _tryRevive(group, x, y) {
    if (!group.tryRevive) return;
    const revived = group.tryRevive();
    if (revived > 0) {
      this.addReviveEffect(x, y);
    }
  }

  /**
   * 反伤效果(矮人羁绊)
   * @param {MarchGroup} fromGroup - 被击溃的队伍(反伤来源)
   * @param {MarchGroup} toGroup - 胜方队伍(承受反伤)
   * @param {number} damageDealt - 胜方造成的伤害
   */
  static _applyDamageReflect(fromGroup, toGroup, damageDealt) {
    if (!fromGroup.getDamageReflect) return;
    const reflectRate = fromGroup.getDamageReflect();
    if (reflectRate <= 0) return;

    // 反伤: 胜方损失一定比例的战士
    const reflectDamage = damageDealt * reflectRate;
    const warriorLoss = Math.ceil(reflectDamage / (damageDealt / toGroup.warriors));
    const actualLoss = Math.min(warriorLoss, toGroup.warriors - 1); // 至少剩1个

    if (actualLoss > 0) {
      toGroup.warriors -= actualLoss;
      this.addDamageText(toGroup.pixelX, toGroup.pixelY - 10, actualLoss, '#ffaa00');
      this.addExplosion(toGroup.pixelX, toGroup.pixelY, '#ff9900');
    }
  }

  /**
   * 清理已死亡/解散的队伍
   */
  static cleanupGroups(marchGroups) {
    const alive = marchGroups.filter(g => g.state !== 'destroyed' && g.state !== 'disbanded' && g.state !== 'arrived');
    const removed = marchGroups.filter(g => g.state === 'destroyed' || g.state === 'disbanded' || g.state === 'arrived');
    return { alive, removed };
  }
}
