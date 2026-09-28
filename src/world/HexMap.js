/**
 * 六边形地图类
 */

import { HexTile } from './HexTile.js';
import {
  hexToPixel,
  pixelToHex,
  hexDistance,
  getNeighborCoords,
  generateRectArea,
  tileKey,
} from './HexMath.js';
import { HEX_SIZE, PRESET_DISTRIBUTION, RANDOM_TILE_RESULTS } from '../config.js';
import { weightedRandom } from '../utils/math.js';

export class HexMap {
  constructor() {
    this.tiles = new Map();
    this.size = HEX_SIZE;
  }

  /**
   * 生成地图(行列制矩形棋盘，六边形交错排列)
   * @param {number} cols - 每行格数(列数)
   * @param {number} rows - 总行数(纵向条数，row 0 最上=敌方侧)
   * @param {Array<{q:number,r:number}>} [obstacles] - 障碍格轴向坐标列表(山脉/河流，不可翻转不可通行)
   */
  generate(cols, rows, obstacles) {
    const coords = generateRectArea(cols, rows);
    for (const { q, r } of coords) {
      const tile = new HexTile(q, r);
      this.tiles.set(tileKey(q, r), tile);
    }
    this.assignPresetBuildings();

    // 应用障碍格：标记障碍并清除预设建筑（障碍格不参与翻转/通行）
    if (obstacles && obstacles.length > 0) {
      for (const { q, r } of obstacles) {
        const tile = this.getTile(q, r);
        if (tile) {
          tile.isObstacle = true;
          tile.presetBuilding = null;
        }
      }
    }
  }

  /**
   * 随机分配预设建筑
   */
  assignPresetBuildings() {
    for (const tile of this.tiles.values()) {
      const type = weightedRandom(PRESET_DISTRIBUTION);
      if (type.startsWith('barracks_')) {
        const match = type.match(/(\d+)$/);
        const level = match ? parseInt(match[1]) : 1;
        tile.setPresetBuilding('barracks', level);
      } else if (type.startsWith('gold_mine_')) {
        const match = type.match(/(\d+)$/);
        const level = match ? parseInt(match[1]) : 1;
        tile.setPresetBuilding('gold_mine', level);
      } else if (type === 'random') {
        tile.setPresetBuilding('random', 0);
      } else {
        tile.setPresetBuilding(type, 1);
      }
    }
  }

  /**
   * 保底规则：保证指定格子周围一圈至少 minCount 个一级地块(level=1 预设建筑)
   *
   * 随机分布下一级地块概率约 0.51，6 邻格不保证 ≥3；开局若周围全是高级地块，
   * 前期翻转费用过高会导致扩张卡死。不足时从非一级邻格中依次重设为随机一级建筑
   * (按分布表权重)，跳过障碍格与已翻转格。
   * @param {number} q - 中心格 q
   * @param {number} r - 中心格 r
   * @param {number} [minCount=3] - 至少的一级地块数量
   */
  ensureLevelOneAround(q, r, minCount = 3) {
    // 从分布表提取一级类型池（*_lv1 后缀 + 无等级后缀的一级建筑）
    const pool = {};
    for (const [key, weight] of Object.entries(PRESET_DISTRIBUTION)) {
      if (typeof weight !== 'number' || weight <= 0) continue;
      if (/_(lv)?1$/.test(key) || key === 'arrow_tower') {
        pool[key] = weight;
      }
    }
    if (Object.keys(pool).length === 0) return;

    const neighbors = this.getNeighbors(q, r)
      .filter(t => !t.isObstacle && !t.isFlipped && t.isFlipping <= 0);
    const isLevelOne = (t) => t.presetBuilding && t.presetBuilding.level === 1;

    let need = minCount - neighbors.filter(isLevelOne).length;
    if (need <= 0) return;

    const candidates = neighbors.filter(t => !isLevelOne(t));
    for (const tile of candidates) {
      if (need <= 0) break;
      const key = weightedRandom(pool);
      const match = key.match(/(\d+)$/);
      const level = match ? parseInt(match[1]) : 1;
      const type = key.replace(/_(lv)?\d+$/, '');
      tile.setPresetBuilding(type, level);
      need--;
    }
  }

  /**
   * 获取格子
   */
  getTile(q, r) {
    return this.tiles.get(tileKey(q, r));
  }

  /**
   * 设置格子
   */
  setTile(q, r, tile) {
    this.tiles.set(tileKey(q, r), tile);
  }

  /**
   * 获取邻居列表
   */
  getNeighbors(q, r) {
    const neighbors = [];
    for (const dir of getNeighborCoords(q, r)) {
      const tile = this.getTile(dir.q, dir.r);
      if (tile) neighbors.push(tile);
    }
    return neighbors;
  }

  /**
   * 坐标转像素
   */
  hexToPixel(q, r) {
    return hexToPixel(q, r, this.size);
  }

  /**
   * 像素转坐标
   */
  pixelToHex(x, y) {
    return pixelToHex(x, y, this.size);
  }

  /**
   * 两格距离
   */
  distance(a, b) {
    return hexDistance(a, b);
  }

  /**
   * 获取所有格子
   */
  getAllTiles() {
    return Array.from(this.tiles.values());
  }

  /**
   * 获取指定owner的所有格子
   */
  getTilesByOwner(owner) {
    return this.getAllTiles().filter(t => t.owner === owner);
  }

  /**
   * 获取指定owner的已翻转格子
   */
  getFlippedTilesByOwner(owner) {
    return this.getAllTiles().filter(t => t.owner === owner && t.isFlipped);
  }

  /**
   * 获取与指定owner领地相邻的未翻转格子
   */
  getAdjacentUnflippedTiles(owner) {
    const result = [];
    const seen = new Set();
    const flipped = this.getFlippedTilesByOwner(owner);
    for (const tile of flipped) {
      const neighbors = this.getNeighbors(tile.q, tile.r);
      for (const n of neighbors) {
        // 障碍格不可翻转，不进入候选列表
        if (!n.isFlipped && n.owner === 0 && !n.isObstacle) {
          const key = tileKey(n.q, n.r);
          if (!seen.has(key)) {
            seen.add(key);
            result.push(n);
          }
        }
      }
    }
    return result;
  }

  /**
   * 随机格翻转结果
   */
  rollRandomTile() {
    const result = weightedRandom(RANDOM_TILE_RESULTS);
    if (result === 'empty') {
      return { type: 'empty', level: 1 };
    }
    if (result.startsWith('barracks_')) {
      const match = result.match(/(\d+)$/);
      const level = match ? parseInt(match[1]) : 1;
      return { type: 'barracks', level };
    }
    if (result.startsWith('gold_mine_')) {
      const match = result.match(/(\d+)$/);
      const level = match ? parseInt(match[1]) : 1;
      return { type: 'gold_mine', level };
    }
    return { type: result, level: 1 };
  }

  /**
   * 获取地图边界(像素)
   */
  getBounds() {
    let minX = Infinity, maxX = -Infinity;
    let minY = Infinity, maxY = -Infinity;
    for (const tile of this.tiles.values()) {
      const { x, y } = this.hexToPixel(tile.q, tile.r);
      minX = Math.min(minX, x - this.size);
      maxX = Math.max(maxX, x + this.size);
      minY = Math.min(minY, y - this.size);
      maxY = Math.max(maxY, y + this.size);
    }
    return { minX, maxX, minY, maxY, width: maxX - minX, height: maxY - minY };
  }
}
