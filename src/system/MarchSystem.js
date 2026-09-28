/**
 * 行军系统
 * 像素移动模式：队伍沿像素路标点连续行进，遭遇/射程判定全部基于像素距离
 * - 速度换算：speed(格/秒) × √3 × hexSize = 像素/秒(相邻格中心间距 = √3 × size)
 * - 建筑遭遇：像素距离 ≤ attackRange × 格间距 时进攻最近敌方建筑
 * - 队伍遭遇：以各自射程独立判定，射程覆盖方停下开战；双方射程均覆盖时互锁对打，
 *   射程外的一方(如被远程射击的近战)继续行军不罚站，冲进自己射程后停下反击
 */

import { hexToPixel } from '../world/HexMath.js';
import { MARCH_SPEED } from '../config.js';

/** 相邻格中心像素间距系数(正六边形网格中六个方向均为此值 × hexSize) */
const TILE_GAP = Math.sqrt(3);

export class MarchSystem {
  /**
   * 更新所有行军队伍
   * @param {number} dt - 帧时间
   * @param {MarchGroup[]} marchGroups - 所有队伍
   * @param {HexMap} hexMap - 地图
   * @param {CombatSystem} combatSystem - 战斗系统
   * @param {Player[]} players - 所有玩家
   */
  static update(dt, marchGroups, hexMap, combatSystem, players) {
    for (const group of marchGroups) {
      if (!group.isAlive()) continue;

      // 更新减速计时器
      if (group.updateSlow) {
        group.updateSlow(dt);
      }

      switch (group.state) {
        case 'marching':
          this.updateMarching(group, dt, hexMap, marchGroups, combatSystem, players);
          break;
        case 'fighting_building':
          this.updateFightingBuilding(group, dt, combatSystem, players, hexMap);
          break;
        case 'fighting_warrior':
          this.updateFightingWarrior(group, dt, combatSystem, players);
          break;
      }
    }

    // 清理已死亡/解散的队伍
    // (由Game主类在外部处理)
  }

  /**
   * 更新行军中状态(像素移动)
   */
  static updateMarching(group, dt, hexMap, marchGroups, combatSystem, players) {
    const size = hexMap ? hexMap.size : 0;
    if (!size) return; // 无地图信息无法移动

    const tilePx = size * TILE_GAP; // 相邻格中心像素间距
    const attackRange = group.getAttackRange ? group.getAttackRange() : 1;

    // === 建筑遭遇(像素距离)：射程范围内最近的敌方建筑 ===
    const engageRadius = attackRange * tilePx;
    const engageR2 = engageRadius * engageRadius;
    let targetTile = null;
    let targetD2 = Infinity;
    for (const p of (players || [])) {
      if (p.id === group.owner) continue;
      for (const tile of p.tiles) {
        if (!tile.building) continue;
        const c = hexToPixel(tile.q, tile.r, size);
        const d2 = (group.pixelX - c.x) * (group.pixelX - c.x)
                 + (group.pixelY - c.y) * (group.pixelY - c.y);
        if (d2 <= engageR2 && d2 < targetD2) {
          targetD2 = d2;
          targetTile = tile;
        }
      }
    }
    if (targetTile) {
      group.state = 'fighting_building';
      group.fightTarget = targetTile;
      group.combatTimer = 0;
      return;
    }

    // === 队伍遭遇(像素距离) ===
    // 行军 vs 行军：各自射程独立判定——我方射程覆盖→停下开战；敌方射程也覆盖→互锁对打；
    //   敌方射程够不到(如被远程射击的近战)→敌方继续行军不罚站，冲进自己射程后停下反击
    // 行军 vs 攻城中：按双方较大射程"冲锋打断"互锁(近战防御者可在远程攻城者射程边缘
    //   将其拖入战斗、打断攻城计时——旧版防御节奏，防止远程无伤拆家)
    const myEngagePx = attackRange * tilePx;
    const myEngageR2 = myEngagePx * myEngagePx;
    for (const other of marchGroups) {
      if (other.owner === group.owner) continue;
      if (!other.isAlive()) continue;

      const dx = other.pixelX - group.pixelX;
      const dy = other.pixelY - group.pixelY;
      const d2 = dx * dx + dy * dy;
      const otherRange = other.getAttackRange ? other.getAttackRange() : 1;

      if (d2 > myEngageR2) {
        // 我方射程外：仅当对方正在攻城时可按较大射程冲锋打断
        if (other.state !== 'fighting_building') continue;
        const chargePx = Math.max(attackRange, otherRange) * tilePx;
        if (d2 > chargePx * chargePx) continue;
        // 冲锋打断：互锁(重置对方攻城计时)
        group.state = 'fighting_warrior';
        group.fightTarget = other;
        group.combatTimer = 0;
        other.state = 'fighting_warrior';
        other.fightTarget = group;
        other.combatTimer = 0;
        return;
      }

      // 我方射程内——反击：正与我交战的敌人 → 停下对打(不重置对方攻击计时)
      if (other.state === 'fighting_warrior' && other.fightTarget === group) {
        group.state = 'fighting_warrior';
        group.fightTarget = other;
        group.combatTimer = 0;
        return;
      }

      // 与别人交战中的敌人不打扰(防多打一)
      if (other.state === 'fighting_warrior') continue;

      // 我方射程覆盖 → 发起攻击
      group.state = 'fighting_warrior';
      group.fightTarget = other;
      group.combatTimer = 0;

      if (other.state === 'fighting_building') {
        // 对方正在攻城 → 互锁打断其攻城(射程内遭遇攻城者必打断)
        other.state = 'fighting_warrior';
        other.fightTarget = group;
        other.combatTimer = 0;
        return;
      }

      // 对方行军中：其射程同样覆盖 → 互相对锁；否则仅我方锁定，对方继续行军
      const otherEngagePx = otherRange * tilePx;
      if (d2 <= otherEngagePx * otherEngagePx) {
        other.state = 'fighting_warrior';
        other.fightTarget = group;
        other.combatTimer = 0;
      }
      return;
    }

    // === 像素移动：沿路标点连续推进 ===
    // 速度换算：格/秒 → 像素/秒
    const effectiveSpeed = group.getEffectiveSpeed ? group.getEffectiveSpeed() : group.speed;
    let remaining = effectiveSpeed * tilePx * dt;

    while (remaining > 0 && group.waypointIndex < group.waypoints.length) {
      const wp = group.waypoints[group.waypointIndex];
      const dx = wp.x - group.pixelX;
      const dy = wp.y - group.pixelY;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist <= remaining) {
        // 到达该路标点，继续消耗剩余步长(单帧可跨多个路标)
        group.pixelX = wp.x;
        group.pixelY = wp.y;
        remaining -= dist;
        group.waypointIndex++;
        group.pathIndex = group.waypointIndex;
        if (group.waypointIndex < group.path.length) {
          group.currentTile = group.path[group.waypointIndex];
        }
      } else {
        // 朝路标点方向推进剩余步长
        group.pixelX += (dx / dist) * remaining;
        group.pixelY += (dy / dist) * remaining;
        remaining = 0;
      }
    }

    // 所有路标走完 → 抵达
    if (group.waypoints.length > 0 && group.waypointIndex >= group.waypoints.length) {
      group.state = 'arrived';
    }
  }

  /**
   * 更新vs建筑战斗
   */
  static updateFightingBuilding(group, dt, combatSystem, players, hexMap) {
    group.combatTimer += dt;

    // 战斗演出时长
    const duration = 0.8;

    if (group.combatTimer >= duration) {
      // 战斗结算
      combatSystem.resolveBuildingCombat(group, group.fightTarget, players, hexMap);
      group.combatTimer = 0;
    }
  }

  /**
   * 更新vs战士战斗
   */
  static updateFightingWarrior(group, dt, combatSystem, players) {
    group.combatTimer += dt;

    const duration = 1.0;

    if (group.combatTimer >= duration) {
      // 战斗结算(含击杀赏金发放)
      combatSystem.resolveWarriorCombat(group, group.fightTarget, players);
      group.combatTimer = 0;
    }
  }
}
