/**
 * 玩家类
 */

import { INITIAL_GOLD, BASE_GOLD_RATE } from '../config.js';

export class Player {
  constructor(id, name, color, isAI = false, aiLevel = 'easy') {
    this.id = id;
    this.name = name;
    this.color = color;
    this.isAI = isAI;
    this.isRemote = false;      // 本地真人玩家；远端对手由 RemotePlayer 覆盖为 true
    this.aiLevel = aiLevel;

    this.gold = INITIAL_GOLD;
    this.base = null;          // 大本营HexTile
    this.tiles = [];           // 已占领格子列表
    this.race = 'human';       // 种族(敌方建筑用，玩家建筑传'custom')
    this.raceLineup = ['human']; // 种族阵容(敌方兼容)

    // 上阵系统数据(玩家专用，由 Game.initLevel 设置)
    this.deploymentBundle = null;     // DeploymentBundle { units, synergies, buildingUpgrades }
    this.deployedSynergies = null;    // 已上阵的羁绊卡数组(= deploymentBundle.synergies)

    // 羁绊计数(实时更新)
    this.raceCount = {};
    this.styleCount = {};

    // 羁绊加成(实时更新)
    this.raceSynergyBonus = 0;
    this.styleSynergyBonus = 0;
    this.synergyDefenseBonus = 0;

    // 完整羁绊加成对象(由 SynergySystem.updatePlayerSynergies 写入)
    this.synergyBonuses = null;
    // 兽族3阶: 编组阈值降低
    this.groupThresholdReduction = 0;

    // 统计
    this.totalWarriorsProduced = 0;
    this.totalBuildingsDestroyed = 0;

    // 局外养成加成（由BonusCalculator.applyToPlayer设置）
    this._metaAttackBonus = 0;
    this._metaPenetrate = 0;
    this._metaBuildingHpBonus = 0;
    this._metaBuildingDefBonus = 0;
    this._metaHealBoost = 0;
    this._metaGoldProductionBonus = 0;
    this._metaFlipCostReduction = 0;
    this._metaMarchSpeedBonus = 0;
    this._metaTowerDamageBonus = 0;
    this._metaSynergyBoost = 0;
    this._metaDeathRevenge = 0;
    this._metaGoldInterest = 0;
    this._metaWarPlunder = 0;
  }

  /**
   * 设置大本营
   */
  setBase(tile) {
    this.base = tile;
    this.addTile(tile);
  }

  /**
   * 添加已占领格子
   */
  addTile(tile) {
    if (!this.tiles.find(t => t.q === tile.q && t.r === tile.r)) {
      this.tiles.push(tile);
    }
  }

  /**
   * 移除格子(建筑被摧毁)
   */
  removeTile(tile) {
    this.tiles = this.tiles.filter(t => !(t.q === tile.q && t.r === tile.r));
  }

  /**
   * 消耗金币
   * @returns {boolean} 是否成功
   */
  spendGold(amount) {
    if (this.gold < amount) return false;
    this.gold -= amount;
    return true;
  }

  /**
   * 获取所有建筑
   */
  getBuildings() {
    const buildings = [];
    for (const tile of this.tiles) {
      if (tile.building) {
        buildings.push(tile.building);
      }
    }
    return buildings;
  }

  /**
   * 获取所有兵营
   */
  getBarracks() {
    return this.getBuildings().filter(b => b.isBarracks());
  }

  /**
   * 是否还有大本营
   */
  isAlive() {
    return this.base && this.base.building && this.base.building.currentHp > 0;
  }

  /**
   * 获取每秒金币产出
   */
  getGoldRate() {
    // 基础被动产出 + 建筑产出(大本营/金矿)
    let rate = BASE_GOLD_RATE;
    for (const tile of this.tiles) {
      if (tile.building && tile.building.producesGold()) {
        rate += tile.building.goldRate;
      }
    }
    // 局外养成加成
    if (this._metaGoldProductionBonus) {
      rate *= (1 + this._metaGoldProductionBonus);
    }
    // 利息系统
    if (this._metaGoldInterest) {
      rate += Math.floor(this.gold / 10) * this._metaGoldInterest;
    }
    return rate;
  }

  /**
   * 获取总战士产出速率
   */
  getWarriorRate() {
    let rate = 0;
    for (const tile of this.tiles) {
      if (tile.building && tile.building.producesWarriors()) {
        rate += tile.building.warriorRate;
      }
    }
    return rate;
  }

  /**
   * 获取已出发的战士总数
   */
  getTotalMarchingWarriors(marchGroups) {
    return marchGroups
      .filter(g => g.owner === this.id && g.state !== 'destroyed' && g.state !== 'disbanded')
      .reduce((sum, g) => sum + g.warriors, 0);
  }

  /**
   * 获取待编组战士总数
   */
  getBufferedWarriors() {
    return this.getBuildings()
      .filter(b => b.producesWarriors())
      .reduce((sum, b) => sum + b.warriorBuffer, 0);
  }
}
