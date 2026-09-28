/**
 * 异步快照对手
 *
 * 实时联机移除后的 PvP 对手实体：来自 AsyncMatchSystem 生成的「快照镜像」——
 * 有名字 / 奖杯分 / 按奖杯生成的阵容强度，决策走 AIPlayer（翻格策略），
 * 战斗为本地单人演算，胜负按真人 Elo 结算（对手奖杯分参与计算）。
 */

import { AIPlayer } from './AIPlayer.js';

export class SnapshotPlayer extends AIPlayer {
  /**
   * @param {number} id 玩家 id（快照局固定敌方 id，沿用 config.enemies[0].id）
   * @param {object} [snapshot] AsyncMatchSystem.generateOpponent() 产物：
   *   { name, trophies, difficulty }（2026-09-09 AI 一致化后，skillTier/powerRatio/warriorRateMult 已移除）
   */
  constructor(id, snapshot) {
    super(
      id,
      (snapshot && snapshot.name) || '对手',
      (snapshot && snapshot.color) || '#ef4444',
      (snapshot && snapshot.difficulty) || 'normal',
    );
    this.isSnapshot = true;                    // 快照对手标记（结算/UI 判定用）
    this.trophies = (snapshot && typeof snapshot.trophies === 'number')
      ? snapshot.trophies : 0;                 // 对手奖杯分（Elo 结算输入）
    this.snapshot = snapshot || null;
  }
}
