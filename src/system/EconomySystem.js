/**
 * 经济系统
 * 资源产出 + 战士编组
 */

import { MarchGroup } from '../entity/MarchGroup.js';

export class EconomySystem {
  // 战斗中兵种招募计数（仅追踪玩家1的产出，用于局外升级条件）
  static battleRecruits = {};

  /** 重置战斗招募日志（每局开始时调用） */
  static resetRecruitLog() { this.battleRecruits = {}; }

  /** 获取战斗招募日志 */
  static getRecruitLog() { return { ...this.battleRecruits }; }

  /**
   * 更新经济(每帧调用)
   * @param {number} dt - 帧时间
   * @param {Player[]} players - 所有玩家
   * @param {HexMap} hexMap - 地图
   * @param {MarchGroup[]} marchGroups - 行军队伍列表(用于添加新队伍)
   * @param {HexMap} hexMapForPath - 用于寻路的地图引用
   */
  static update(dt, players, hexMap, marchGroups, pathfindingSystem) {
    for (const player of players) {
      // 金币产出(每秒固定，含局外养成加成)
      const goldRate = player.getGoldRate ? player.getGoldRate() : 0;
      player.gold += goldRate * dt;

      // 金矿/大本营 buffer (仅用于UI进度条显示，实际产出由 getGoldRate 处理)
      for (const tile of player.tiles) {
        if (!tile.building || !tile.building.producesGold()) continue;
        const building = tile.building;
        building.goldBuffer += building.goldRate * dt;
        if (building.goldBuffer >= 1) building.goldBuffer -= 1;
      }

      // 战士产出与编组
      for (const tile of player.tiles) {
        if (!tile.building || !tile.building.producesWarriors()) continue;

        const building = tile.building;

        // 积累战士（AI难度产兵乘数：见 AIPlayer.AI_DIFFICULTY.warriorRateMult）
        building.warriorBuffer += building.warriorRate * (player.warriorRateMult || 1) * dt;

        // 达到编组阈值 → 生成行军队伍
        // 兽族3阶羁绊: 编组阈值降低
        const thresholdReduction = player.groupThresholdReduction || 0;
        const effectiveThreshold = Math.max(3, building.groupThreshold - thresholdReduction);
        if (building.warriorBuffer >= effectiveThreshold) {
          const warriorCount = Math.floor(building.warriorBuffer);
          building.warriorBuffer -= warriorCount;
          player.totalWarriorsProduced += warriorCount;

          // 创建行军队伍
          const group = new MarchGroup(player.id, warriorCount, building, tile);
          // 局外养成: 行军速度加成
          group.metaSpeedBonus = player._metaMarchSpeedBonus || 0;

          // 招募计数：仅追踪玩家1的兵种产出
          if (player.id === 1 && building.unitData?.unitId) {
            const uid = building.unitData.unitId;
            this.battleRecruits[uid] = (this.battleRecruits[uid] || 0) + 1;
          }

          // 寻路到敌方大本营
          const enemyBase = this.findEnemyBase(player, players);
          if (enemyBase && pathfindingSystem) {
            const path = pathfindingSystem.findPath(tile, enemyBase, hexMap, player.id);
            if (path && path.length > 0) {
              // 设置路径(内部换算像素路标点)并初始化像素位置于起点格中心
              group.setPath(path, hexMap);
              marchGroups.push(group);
            }
          }
        }
      }
    }
  }

  /**
   * 找到敌方大本营
   */
  static findEnemyBase(player, players) {
    for (const other of players) {
      if (other.id !== player.id && other.isAlive()) {
        return other.base;
      }
    }
    return null;
  }
}
