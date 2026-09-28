/**
 * 地块类
 */

export class HexTile {
  constructor(q, r) {
    this.q = q;
    this.r = r;
    this.owner = 0;           // 0=中立, 1=玩家, 2+=敌方
    this.isObstacle = false;   // 障碍格(山脉/河流)：不可翻转、不可通行、始终可见
    this.building = null;      // Building对象 (null=未翻转/无建筑)
    this.isFlipped = false;    // 是否已翻转
    this.isFlipping = 0;       // 翻转动画进度 (0~1, 0=未翻转, 1=完成)
    this.flipTimer = 0;        // 翻转动画计时器
    this.presetBuilding = null; // 预设建筑 { type, level }
    this.isRandomResult = null; // 随机格翻转结果(临时存储)
    this.revealTimer = 0;       // 随机格揭晓动画计时器
  }

  /**
   * 设置预设建筑
   */
  setPresetBuilding(type, level = 1) {
    this.presetBuilding = { type, level };
  }

  /**
   * 开始翻转动画
   */
  startFlip() {
    this.isFlipping = 0.01;
    this.flipTimer = 0;
  }

  /**
   * 更新翻转动画
   * @param {number} dt - 帧时间(秒)
   * @param {number} duration - 翻转总时长
   * @returns {boolean} 是否翻转完成
   */
  updateFlip(dt, duration) {
    if (this.isFlipping <= 0) return false;
    if (this.isFlipping >= 1) return true;

    this.flipTimer += dt;
    this.isFlipping = Math.min(1, this.flipTimer / duration);

    if (this.isFlipping >= 1) {
      return true;
    }
    return false;
  }

  /**
   * 完成翻转
   */
  finishFlip() {
    this.isFlipped = true;
    this.isFlipping = 0;
    this.flipTimer = 0;
  }

  /**
   * 重置为中立未翻转状态(建筑被摧毁时)
   */
  resetToNeutral() {
    this.owner = 0;
    this.building = null;
    this.isFlipped = false;
    this.isFlipping = 0;
    this.flipTimer = 0;
    // 重新随机预设建筑
    this.isRandomResult = null;
    this.revealTimer = 0;
  }

  /**
   * 是否相邻于指定owner的领地
   */
  isAdjacentTo(hexMap, owner) {
    const neighbors = hexMap.getNeighbors(this.q, this.r);
    return neighbors.some(t => t.owner === owner && t.isFlipped);
  }

  /**
   * 获取格子简述
   */
  toString() {
    return `(${this.q},${this.r}) owner=${this.owner} flipped=${this.isFlipped}`;
  }
}
