/**
 * AI玩家类
 * 4档难度: easy / normal / hard / nightmare
 * 每档有不同的决策间隔、评估策略和羁绊追求
 */

import { Player } from './Player.js';
import { AI_DECISION_INTERVAL, getFlipCost } from '../config.js';
import { getRace, getRaceSynergyBonus } from '../data/races.js';
import { hexDistance } from '../world/HexMath.js';
import { battleRandom } from '../utils/rng.js';

// AI难度配置
// warriorRateMult: 产兵速度乘数 —— 一致化后恒为 1.0（出兵速度由兵种 productionSpeed 决定，
// 与玩家同规则，不再按难度叠加产速特权；Game.js 会用 PowerSystem 的 enemyConfig.warriorRateMult 覆盖此值）
const AI_DIFFICULTY = {
  easy:      { interval: 6.0,  synergyPursuit: 0,  evaluatePreset: false, blockEnemy: false, randomFactor: 0.6,  warriorRateMult: 1.0 },
  normal:    { interval: 3.0,  synergyPursuit: 1,  evaluatePreset: true,  blockEnemy: false, randomFactor: 0.3,  warriorRateMult: 1.0 },
  hard:      { interval: 2.0,  synergyPursuit: 2,  evaluatePreset: true,  blockEnemy: true,  randomFactor: 0.15, warriorRateMult: 1.0 },
  nightmare: { interval: 1.0,  synergyPursuit: 3,  evaluatePreset: true,  blockEnemy: true,  randomFactor: 0.05, warriorRateMult: 1.0 },
};

export class AIPlayer extends Player {
  constructor(id, name, color, aiLevel = 'easy') {
    super(id, name, color, true, aiLevel);
    this.aiLevel = aiLevel;
    const config = AI_DIFFICULTY[aiLevel] || AI_DIFFICULTY.easy;
    this.decisionInterval = config.interval;
    this.warriorRateMult = config.warriorRateMult ?? 1;
    this.decisionTimer = 0;
  }

  /**
   * AI决策主入口
   * @param {HexMap} hexMap - 地图
   * @param {GameState} gameState - 游戏状态
   * @param {function} flipCallback - 翻转格子回调
   * @returns {boolean} 是否执行了行动
   */
  makeDecision(hexMap, gameState, flipCallback) {
    this.decisionTimer = 0;
    const config = AI_DIFFICULTY[this.aiLevel] || AI_DIFFICULTY.easy;

    // 获取可翻转的格子(相邻己方领地的中立格子)
    const candidates = hexMap.getAdjacentUnflippedTiles(this.id);
    if (candidates.length === 0) return false;

    // 金币不足时只能翻随机格(5金币)
    if (this.gold < 5) return false;

    // 过滤出能负担的格子
    const affordable = candidates.filter(t => {
      const cost = getFlipCost(t.presetBuilding);
      return cost <= this.gold;
    });
    if (affordable.length === 0) return false;

    // 存储gameState供评估函数使用
    this._currentGameState = gameState;

    // === Easy: 随机选择 ===
    if (this.aiLevel === 'easy') {
      // 简单AI: 60%随机, 40%按基础评分
      if (battleRandom() < config.randomFactor) {
        const target = affordable[Math.floor(battleRandom() * affordable.length)];
        flipCallback(target, this);
        return true;
      }
      // 基础评分(不分析预设建筑价值)
      affordable.sort((a, b) => this.scoreTileBasic(b) - this.scoreTileBasic(a));
      flipCallback(affordable[0], this);
      return true;
    }

    // === Normal / Hard / Nightmare: 评估函数决策 ===
    const enemies = gameState.players.filter(p => p.id !== this.id && p.isAlive());

    // 计算每个候选格子的综合评分
    const scored = affordable.map(tile => ({
      tile,
      score: this.evaluateAction(tile, hexMap, enemies, config),
    }));

    // 按分数降序排列
    scored.sort((a, b) => b.score - a.score);

    // nightmare难度有概率选择第二好的选项(模拟人类不完美决策)
    if (this.aiLevel === 'nightmare' && scored.length > 1 && battleRandom() < 0.1) {
      flipCallback(scored[1].tile, this);
    } else {
      flipCallback(scored[0].tile, this);
    }
    return true;
  }

  /**
   * 综合评估格子价值
   * 参考设计文档7.3 AI评估函数
   */
  evaluateAction(tile, hexMap, enemies, config) {
    let score = 0;
    const preset = tile.presetBuilding;
    if (!preset) return 0;

    // 1. 建筑基础分
    if (preset.type === 'barracks') {
      score += 50;
      if (config.evaluatePreset) {
        score += (preset.level || 1) * 20;
        if ((preset.level || 1) >= 3) score += 30; // Lv3+质变加成
        if ((preset.level || 1) >= 4) score += 40; // Lv4额外加成
      }
    } else if (preset.type === 'arrow_tower') {
      // 检查是否有敌方队伍逼近
      const threatLevel = this.assessThreat(tile, hexMap, enemies);
      score += 20 + threatLevel * 100;
    } else if (preset.type === 'gold_mine') {
      score += 20;
      if (this.gold < 30) score += 30; // 金币不足时优先经济
      if (config.evaluatePreset && (preset.level || 1) === 2) score += 15;
    } else if (preset.type === 'random') {
      score += 15;
      if (this.gold < 20) score += 25; // 金币紧张时碰运气
      score += 10; // 期望值
    }

    // 2. 羁绊补齐加分(根据难度递增)
    if (config.synergyPursuit > 0 && preset.type !== 'random') {
      const synergyBonus = this.calculateSynergyImpact(tile, hexMap, config.synergyPursuit);
      score += synergyBonus;
    }

    // 3. 距离评估(高级AI才考虑)
    if (config.evaluatePreset) {
      // 兵营离敌方越近越好(进攻型)
      if (preset.type === 'barracks' && enemies.length > 0) {
        const minDist = Math.min(...enemies.map(e =>
          e.base ? hexDistance({q: tile.q, r: tile.r}, {q: e.base.q, r: e.base.r}) : 99
        ));
        score += Math.max(0, (15 - minDist)) * 2; // 距离越近加分越高
      }
      // 箭塔/金矿离己方大本营越近越好(防守/经济)
      if (preset.type === 'arrow_tower' || preset.type === 'gold_mine') {
        if (this.base) {
          const distToBase = hexDistance({q: tile.q, r: tile.r}, {q: this.base.q, r: this.base.r});
          score += Math.max(0, (10 - distToBase)) * 1.5;
        }
      }
    }

    // 4. 阻断敌方路径(hard/nightmare)
    if (config.blockEnemy && preset.type === 'arrow_tower') {
      const blockScore = this.assessBlockPotential(tile, hexMap, enemies);
      score += blockScore;
    }

    // 5. 随机扰动(模拟不完美决策)
    score += battleRandom() * 10 * config.randomFactor;

    return score;
  }

  /**
   * 基础评分(easy难度使用)
   */
  scoreTileBasic(tile) {
    const preset = tile.presetBuilding;
    if (!preset) return 0;
    if (preset.type === 'barracks') return 50;
    if (preset.type === 'gold_mine') return 30;
    if (preset.type === 'arrow_tower') return 20;
    if (preset.type === 'random') return 15;
    return 10;
  }

  /**
   * 评估翻转此格子对羁绊的影响
   * @param {number} pursuitLevel - 追求等级(1=尝试2件, 2=追求4件, 3=追求6件)
   */
  calculateSynergyImpact(tile, hexMap, pursuitLevel) {
    const preset = tile.presetBuilding;
    if (!preset || preset.type === 'random') return 0;

    // 获取该格子的种族(从预设建筑推断)
    // 预设建筑本身没有种族，翻转时使用AI的种族
    // 但如果AI有多族阵容，则需要判断
    const race = this.race; // 当前AI的主种族
    const currentCount = this.raceCount[race] || 0;
    const newCount = currentCount + 1;

    let bonus = 10; // 常规加分

    // 根据追求等级判断羁绊触发价值
    if (pursuitLevel >= 1 && newCount === 2) bonus = 40;   // 触发1阶
    if (pursuitLevel >= 2 && newCount === 4) bonus = 80;   // 触发2阶
    if (pursuitLevel >= 3 && newCount === 6) bonus = 150;  // 触发3阶

    // 接近触发时也有加分
    if (pursuitLevel >= 2) {
      if (newCount === 3) bonus = 30; // 差1件触发2阶
      if (newCount === 5) bonus = 60; // 差1件触发3阶
    }

    return bonus;
  }

  /**
   * 评估威胁等级(敌方队伍是否逼近此格子)
   */
  assessThreat(tile, hexMap, enemies) {
    let threat = 0;

    // 检查所有敌方行军队伍
    for (const enemy of enemies) {
      // 检查大本营距离
      if (this.base) {
        const distToBase = hexDistance({q: tile.q, r: tile.r}, {q: this.base.q, r: this.base.r});
        if (distToBase <= 2) threat += 0.5; // 大本营附近需要防御
      }
    }

    // 检查是否有敌方行军队伍在附近
    if (this._currentGameState && this._currentGameState.marchGroups) {
      for (const group of this._currentGameState.marchGroups) {
        if (group.owner === this.id) continue;
        // 估算队伍到格子的距离
        const tilePixel = hexMap.hexToPixel(tile.q, tile.r);
        const dist = Math.sqrt(
          Math.pow(group.pixelX - tilePixel.x, 2) +
          Math.pow(group.pixelY - tilePixel.y, 2)
        );
        if (dist < 100) threat += 1.0; // 非常近
        else if (dist < 200) threat += 0.3;
      }
    }

    return Math.min(threat, 3); // 上限3
  }

  /**
   * 评估阻断敌方路径的潜力
   */
  assessBlockPotential(tile, hexMap, enemies) {
    let blockScore = 0;

    for (const enemy of enemies) {
      if (!enemy.base || !this.base) continue;

      // 如果格子在敌方到己方大本营的路径上
      const distFromEnemy = hexDistance({q: tile.q, r: tile.r}, {q: enemy.base.q, r: enemy.base.r});
      const distToSelf = hexDistance({q: tile.q, r: tile.r}, {q: this.base.q, r: this.base.r});
      const totalDist = distFromEnemy + distToSelf;

      // 如果格子大致在敌方→己方的路径上
      const directDist = hexDistance({q: enemy.base.q, r: enemy.base.r}, {q: this.base.q, r: this.base.r});
      if (totalDist <= directDist + 2) {
        blockScore += 25; // 阻断加分
      }
    }

    return blockScore;
  }

  /**
   * 更新AI计时器
   */
  tick(dt) {
    this.decisionTimer += dt;
    return this.decisionTimer >= this.decisionInterval;
  }
}
