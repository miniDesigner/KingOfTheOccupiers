/**
 * A*寻路系统
 * 六边形路径搜索
 */

import { hexDistance, tileKey } from '../world/HexMath.js';

export class PathfindingSystem {
  /**
   * A*寻路
   * @param {HexTile} startTile - 起始格子
   * @param {HexTile} goalTile - 目标格子
   * @param {HexMap} hexMap - 地图
   * @param {number} owner - 寻路方的owner ID
   * @returns {HexTile[]|null} 路径数组(含起点和终点)，或null
   */
  static findPath(startTile, goalTile, hexMap, owner) {
    if (!startTile || !goalTile) return null;
    if (startTile === goalTile) return [startTile];

    const openSet = [startTile];
    const closedSet = new Set();
    const cameFrom = new Map();
    const gScore = new Map();
    const fScore = new Map();

    gScore.set(tileKey(startTile.q, startTile.r), 0);
    fScore.set(tileKey(startTile.q, startTile.r), hexDistance(startTile, goalTile));

    let iterations = 0;
    const maxIterations = 500; // 防止死循环

    while (openSet.length > 0 && iterations < maxIterations) {
      iterations++;

      // 取fScore最小的节点
      let currentIdx = 0;
      let currentFScore = Infinity;
      for (let i = 0; i < openSet.length; i++) {
        const f = fScore.get(tileKey(openSet[i].q, openSet[i].r)) || Infinity;
        if (f < currentFScore) {
          currentFScore = f;
          currentIdx = i;
        }
      }
      const current = openSet[currentIdx];

      // 到达目标
      if (current === goalTile) {
        return this.reconstructPath(cameFrom, current);
      }

      // 从openSet移除，加入closedSet
      openSet.splice(currentIdx, 1);
      closedSet.add(tileKey(current.q, current.r));

      // 遍历邻居
      const neighbors = hexMap.getNeighbors(current.q, current.r);
      for (const neighbor of neighbors) {
        const nKey = tileKey(neighbor.q, neighbor.r);
        if (closedSet.has(nKey)) continue;

        // 通行规则
        const passable = this.isPassable(neighbor, owner, goalTile);
        if (!passable) continue;

        // 计算移动代价：所有可通行格子代价相同（最短路线前进）
        // 敌方建筑不绕路，遭遇时由 MarchSystem 触发战斗，打完继续行军
        const moveCost = 1;

        const tentativeG = (gScore.get(tileKey(current.q, current.r)) || 0) + moveCost;

        const existingG = gScore.get(nKey);
        if (existingG === undefined || tentativeG < existingG) {
          cameFrom.set(nKey, current);
          gScore.set(nKey, tentativeG);
          fScore.set(nKey, tentativeG + hexDistance(neighbor, goalTile));

          if (!openSet.includes(neighbor)) {
            openSet.push(neighbor);
          }
        }
      }
    }

    return null; // 无路径
  }

  /**
   * 检查格子是否可通行
   */
  static isPassable(tile, owner, goalTile) {
    // 目标格子总是可通行
    if (tile === goalTile) return true;

    // 障碍格(山脉/河流)不可通行，队伍必须绕行
    if (tile.isObstacle) return false;

    // 中立格子可通行
    if (tile.owner === 0) return true;

    // 己方格子可通行
    if (tile.owner === owner) return true;

    // 敌方格子
    if (tile.owner !== owner) {
      // 敌方空地(无建筑)可通行
      if (!tile.building) return true;
      // 敌方建筑格可通行(需要战斗才能通过，但寻路时算作可通行只是代价高)
      return true;
    }

    return false;
  }

  /**
   * 重建路径
   */
  static reconstructPath(cameFrom, current) {
    const path = [current];
    let key = tileKey(current.q, current.r);
    while (cameFrom.has(key)) {
      current = cameFrom.get(key);
      path.unshift(current);
      key = tileKey(current.q, current.r);
    }
    return path;
  }

  /**
   * 重新寻路(路径被阻断时)
   */
  static repath(group, hexMap, players) {
    // 找到敌方大本营
    const enemyBase = players.find(p => p.id !== group.owner && p.isAlive())?.base;
    if (!enemyBase) return false;

    // 起点=当前像素位置所在格(像素移动模式下比 currentTile 更精确)
    const startTile = group.getTileAt ? group.getTileAt(hexMap) : group.currentTile;
    const newPath = this.findPath(startTile, enemyBase, hexMap, group.owner);
    if (newPath && newPath.length > 0) {
      group.setPath(newPath, hexMap);
      group.state = 'marching';
      return true;
    }
    return false;
  }
}
