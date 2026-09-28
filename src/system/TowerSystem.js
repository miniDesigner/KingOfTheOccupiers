/**
 * 箭塔远程攻击系统
 * 箭塔在范围内自动攻击敌方行军队伍
 */

import { hexToPixel } from '../world/HexMath.js';

export class TowerSystem {
  /**
   * 更新所有箭塔
   * @param {number} dt - 帧时间
   * @param {Player[]} players - 所有玩家
   * @param {HexMap} hexMap - 地图
   * @param {MarchGroup[]} marchGroups - 所有行军队伍
   * @param {CombatSystem} combatSystem - 战斗系统(用于特效)
   */
  static update(dt, players, hexMap, marchGroups, combatSystem) {
    for (const player of players) {
      // 遍历该玩家所有箭塔和大本营
      for (const tile of player.tiles) {
        if (!tile.building || !tile.building.isTower()) continue;

        const tower = tile.building;
        if (tower.range <= 0 || tower.attackDamage <= 0) continue;

        // 累加冷却
        tower.attackTimer += dt;

        // 冷却未到，跳过
        if (tower.attackTimer < tower.attackCooldown) continue;

        // 找到范围内最近的敌方行军队伍(像素距离判定)
        const towerPixel = hexToPixel(tile.q, tile.r, hexMap.size);
        const rangePx = tower.range * hexMap.size * Math.sqrt(3); // 射程N格 = N×相邻格间距
        const rangePx2 = rangePx * rangePx;

        let target = null;
        let minDist2 = Infinity;

        for (const group of marchGroups) {
          if (group.owner === player.id) continue;
          if (!group.isAlive()) continue;
          if (group.state === 'fighting_building') continue; // 正在攻城的队伍不挨箭塔(攻城保护规则)

          const dx = group.pixelX - towerPixel.x;
          const dy = group.pixelY - towerPixel.y;
          const dist2 = dx * dx + dy * dy;

          if (dist2 <= rangePx2 && dist2 < minDist2) {
            minDist2 = dist2;
            target = group;
          }
        }

        if (target) {
          // 发射！
          tower.attackTimer = 0;

          // 造成伤害
          const damage = Math.min(tower.attackDamage, target.warriors);
          target.warriors -= damage;

          if (target.warriors <= 0) {
            target.warriors = 0;
            target.state = 'destroyed';
          }

          // 诅咒尖塔减速效果(亡灵变体)
          if (tower.slowOnHit > 0 && target.applySlow) {
            target.applySlow(1 - tower.slowOnHit, 2.0); // 减速X%，持续2秒
          }

          // 视觉特效
          if (combatSystem) {
            combatSystem.addArrowEffect(
              towerPixel.x, towerPixel.y,
              target.pixelX, target.pixelY
            );
            combatSystem.addDamageText(target.pixelX, target.pixelY - 12, damage, '#10b981');
          }

          // 音效 + 轻震动
          if (combatSystem && combatSystem.audioManager) {
            combatSystem.audioManager.playTowerShoot();
            combatSystem.audioManager.vibrateLight();
          }
        }
      }
    }
  }
}
