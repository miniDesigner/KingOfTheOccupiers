/**
 * 建造系统(翻转格子)
 */

import { Building } from '../entity/Building.js';
import { BUILDING_CONFIG, getFlipCost, FLIP_ANIMATION_DURATION } from '../config.js';

export class BuildSystem {
  /**
   * 尝试翻转格子
   * @param {HexTile} tile - 目标格子
   * @param {Player} player - 翻转的玩家
   * @param {HexMap} hexMap - 地图
   * @returns {boolean} 是否成功开始翻转
   */
  static tryFlipTile(tile, player, hexMap) {
    // 检查：障碍格(山脉/河流)不可翻转
    if (tile.isObstacle) return false;

    // 检查：格子必须未翻转
    if (tile.isFlipped || tile.isFlipping > 0) return false;

    // 检查：必须与己方领地相邻
    if (!tile.isAdjacentTo(hexMap, player.id)) return false;

    // 检查：金币是否足够
    let cost = getFlipCost(tile.presetBuilding);
    // 局外养成: 翻转消耗降低
    if (player._metaFlipCostReduction) {
      cost = Math.max(1, Math.round(cost * (1 - player._metaFlipCostReduction)));
    }
    if (player.gold < cost) return false;

    // 扣除金币
    player.spendGold(cost);

    // 开始翻转动画
    tile.startFlip();
    tile.owner = player.id;

    return true;
  }

  /**
   * 完成翻转(动画结束后调用)
   * @param {HexTile} tile - 目标格子
   * @param {Player} player - 翻转的玩家
   * @param {HexMap} hexMap - 地图
   */
  static completeFlip(tile, player, hexMap) {
    tile.finishFlip();
    player.addTile(tile);

    // 根据预设建筑创建Building对象
    const preset = tile.presetBuilding;
    if (!preset || preset.type === 'empty') {
      // 空地：无建筑，仅扩大版图
      tile.building = null;
      return;
    }

    // 确定建筑类型和等级
    let buildingType = preset.type;
    let buildingLevel = preset.level || 1;

    // 随机格：使用翻转时随机决定的结果
    if (preset.type === 'random' && tile.isRandomResult) {
      buildingType = tile.isRandomResult.type;
      buildingLevel = tile.isRandomResult.level || 1;
    }

    // 空地结果
    if (buildingType === 'empty') {
      tile.building = null;
      return;
    }

    // 创建建筑（玩家建筑使用上阵数据包，敌方使用种族配置）
    const building = new Building(buildingType, buildingLevel, player.race, player.id, player.deploymentBundle || null);
    tile.building = building;
  }

  /**
   * 处理随机格翻转(在翻转动画中途决定结果)
   * @param {HexTile} tile - 随机格
   * @param {HexMap} hexMap - 地图
   */
  static rollRandomTile(tile, hexMap) {
    if (tile.presetBuilding && tile.presetBuilding.type === 'random') {
      tile.isRandomResult = hexMap.rollRandomTile();
    }
  }

  /**
   * 摧毁建筑(格子恢复中立)
   * @param {HexTile} tile - 目标格子
   * @param {Player[]} players - 所有玩家(用于移除领地)
   * @param {HexMap} hexMap - 地图
   */
  static destroyBuilding(tile, players, hexMap) {
    // 从原owner的领地列表中移除
    const oldOwner = tile.owner;
    if (oldOwner > 0) {
      const player = players.find(p => p.id === oldOwner);
      if (player) {
        player.removeTile(tile);
      }
    }

    // 重置格子
    tile.resetToNeutral();

    // 为被摧毁的格子重新随机预设建筑
    const newPreset = hexMap.rollRandomTile();
    if (newPreset.type === 'empty') {
      tile.presetBuilding = { type: 'barracks', level: 1 };
    } else {
      tile.presetBuilding = newPreset;
    }
  }
}
