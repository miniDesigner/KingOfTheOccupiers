/**
 * 战斗配置数据 (原关卡配置，改造为PvP对战模板)
 * 数据源: config/levels.json
 *
 * 对战布局(v1.9)：上下布局，玩家大本营永远在下方(r正方向)，向上进攻敌方；
 * 每次对战从 BOARD_LAYOUTS 随机抽取棋盘布局，障碍格将进攻路线切分为 2~3 条战线。
 */

import ConfigLoader from './ConfigLoader.js';
import { getTierAiSettings } from '../meta/PowerSystem.js';
import { colRowToAxial } from '../world/HexMath.js';
import { battleRandom } from '../utils/rng.js';

// 对手名称池
const OPPONENT_NAMES = [
  '暗影军团', '铁血战盟', '烈焰先锋', '霜狼部落', '雷霆骑士团',
  '幽冥之影', '风暴前线', '星辰远征', '黑暗裁决', '荣耀守护者',
  '荒野猎人', '深渊领主', '破晓之刃', '黄昏卫士', '荆棘玫瑰',
];

// 种族池
const RACES = ['human', 'beast', 'undead', 'elf', 'dwarf'];

// 新手池：排除全远程精灵族(对新手近战阵容压制过强)
const RACES_EASY = ['human', 'beast', 'undead', 'dwarf'];

// 高难度种族池：排除纯近战种族(human/beast 无远程单位，会被玩家远程编队无损全歼)
const RACES_HARD = ['undead', 'elf', 'dwarf', 'dragon'];

// 噩梦难度种族池：仅远程压制族(龙族+精灵)，拉开与 hard 的强度差
const RACES_NIGHTMARE = ['dragon', 'elf'];

/**
 * 棋盘布局池（每次对战随机抽取一种）—— 行列制矩形棋盘
 *
 * 配置方式(手动调整友好):
 * - rows: 纵向总行数(第0行最上=敌方侧，最后一行最下=玩家侧)。建议奇数(保证大本营严格居中)
 * - cols: 每行格数(列数，第0列最左)。建议奇数(保证大本营严格居中列)
 * - 六边形交错排列：奇数行整体向右错半格
 * - obstacles: 障碍格列表，用直观的行列索引 { row, col } 配置(均为0起算)
 *   障碍不可翻转、不可通行、始终可见，用于把进攻路线切分为 2~3 条战线
 * - 大本营位置自动计算(见 baseCoords)：距上下边各2行、居中列，无需手动配置
 */
export const BOARD_LAYOUTS = [
  {
    id: 'plains',
    name: '开阔平原',
    rows: 20,
    cols: 11,
    lanes: 1,
    desc: '无遮无拦的正面战场',
    obstacles: [],
  },
  {
    id: 'twin_canyon',
    name: '双线峡谷',
    rows: 20,
    cols: 11,
    lanes: 2,
    desc: '中央山脉断龙脉，左右两条战线',
    // 中央纵墙(第5列，第7~12行)，切出左右两条战线（墙端可绕行）
    obstacles: [
      { row: 7, col: 5 }, { row: 8, col: 5 }, { row: 9, col: 5 },
      { row: 10, col: 5 }, { row: 11, col: 5 }, { row: 12, col: 5 },
    ],
  },
  {
    id: 'tri_lanes',
    name: '三线走廊',
    rows: 20,
    cols: 11,
    lanes: 3,
    desc: '两道山脊隔出左中右三条战线',
    // 左右两道纵墙(第3列与第7列，第7~12行)，切出 左/中/右 三条战线（墙端可绕行）
    obstacles: [
      { row: 7, col: 3 }, { row: 8, col: 3 }, { row: 9, col: 3 }, { row: 10, col: 3 }, { row: 11, col: 3 }, { row: 12, col: 3 },
      { row: 7, col: 7 }, { row: 8, col: 7 }, { row: 9, col: 7 }, { row: 10, col: 7 }, { row: 11, col: 7 }, { row: 12, col: 7 },
    ],
  },
  {
    id: 'river_ford',
    name: '河谷渡口',
    rows: 20,
    cols: 11,
    lanes: 2,
    desc: '两条河岸横贯战场，仅余渡口通行',
    // 两条横向河岸(第9、10行)，各在 col=3/7 留渡口，两端 col=0/10 留空可绕行
    obstacles: [
      // 北岸 row 9（铺 col 1..9，渡口在 col 3/7，两端留空可绕行）
      { row: 9, col: 1 }, { row: 9, col: 2 }, { row: 9, col: 4 }, { row: 9, col: 5 },
      { row: 9, col: 6 }, { row: 9, col: 8 }, { row: 9, col: 9 },
      // 南岸 row 10（铺 col 1..9，渡口在 col 3/7，两端留空可绕行）
      { row: 10, col: 1 }, { row: 10, col: 2 }, { row: 10, col: 4 }, { row: 10, col: 5 },
      { row: 10, col: 6 }, { row: 10, col: 8 }, { row: 10, col: 9 },
    ],
  },
  {
    id: 'citadel',
    name: '中央山垒',
    rows: 20,
    cols: 11,
    lanes: 3,
    desc: '环形山峦坐镇中央，只能侧翼包抄',
    // 中央山块(中心 row9/col5 + 五个邻格，西北侧留一线天缺口)
    obstacles: [
      { row: 9, col: 5 },
      { row: 9, col: 4 }, { row: 9, col: 6 },
      { row: 8, col: 6 },
      { row: 10, col: 5 }, { row: 10, col: 6 },
    ],
  },
];

/**
 * 计算大本营坐标（行列制矩形棋盘）：
 * - 敌方(row=2)距上边2行、玩家(row=rows-3)距下边2行，列取居中列 col=floor((cols-1)/2)
 * - rows 为奇数时双方严格同一竖线；rows 为偶数时上下行奇偶不同，
 *   双方像素 x 错半格（关于棋盘水平中心对称，视觉上仍居中）
 * @param {number} rows - 总行数
 * @param {number} cols - 列数
 * @param {number} side - 1=下方(玩家)，-1=上方(敌方)
 * @returns {{q:number, r:number}} 轴向坐标
 */
export function baseCoords(rows, cols, side) {
  const row = side === 1 ? rows - 3 : 2;
  const col = Math.floor((cols - 1) / 2);
  return colRowToAxial(col, row);
}

/**
 * 按指定布局构建对战配置（玩家在下、敌方在上）
 * @param {object} layout - BOARD_LAYOUTS 中的一项
 * @param {number} [trophies] - 玩家当前奖杯（天梯匹配难度；缺省纯随机）
 * @param {number|null} [playerPower] - 玩家当前战力（战力规则匹配：段位AI设定 + 动态强弱修正；
 *   缺省退回奖杯分段匹配，向后兼容）
 * @returns {object} 战斗配置
 */
export function buildBattleConfig(layout, trophies) {
  // AI难度：按段位（奖杯）难度分布推导（PowerSystem 养成模拟，AI 强度由难度决定）
  let aiDifficulty;
  if (typeof trophies === 'number') {
    aiDifficulty = getTierAiSettings(trophies).difficulty;
  } else {
    const diffRoll = battleRandom();
    aiDifficulty = diffRoll < 0.35 ? 'easy'
      : diffRoll < 0.70 ? 'normal'
      : diffRoll < 0.92 ? 'hard'
      : 'nightmare';
  }
  // 初始金币：玩家与 AI 一致（2026-09-09 去除 AI 初始金币作弊）
  const baseGold = 150;

  // 随机对手种族（按难度分池：新手排除全远程族 / 噩梦仅远程压制族 / 高难排除纯近战族）
  const racePool = aiDifficulty === 'easy' ? RACES_EASY
    : aiDifficulty === 'nightmare' ? RACES_NIGHTMARE
    : aiDifficulty === 'hard' ? RACES_HARD
    : RACES;
  const enemyRace = racePool[Math.floor(battleRandom() * racePool.length)];

  // 随机对手名称
  const enemyName = OPPONENT_NAMES[Math.floor(battleRandom() * OPPONENT_NAMES.length)];

  // 大本营：正下中间（玩家）/ 正上中间（敌方），距上下边各2行、居中列
  const playerBase = baseCoords(layout.rows, layout.cols, 1);
  const enemyBase = baseCoords(layout.rows, layout.cols, -1);

  // 障碍格：行列索引 {row, col} → 轴向坐标 {q, r}
  const obstacles = (layout.obstacles || []).map(({ row, col }) => colRowToAxial(col, row));

  return {
    rows: layout.rows,
    cols: layout.cols,
    layoutId: layout.id,
    layoutName: layout.name,
    layoutLanes: layout.lanes,
    obstacles,
    presetBuildings: [],
    playerBase,
    enemyBase,
    player: { race: 'custom', initialGold: 150 },
    enemies: [{
      id: 2,
      name: enemyName,
      ai: aiDifficulty,
      color: '#ef4444',
      race: enemyRace,
      initialGold: baseGold,
    }],
  };
}

/**
 * 生成随机对战配置（替代原getLevel）
 * 每次对战随机抽取一种棋盘布局（含障碍战线划分）
 * @param {number} [trophies=0] - 玩家当前奖杯（天梯匹配：低段打简单AI，高段强制强敌；缺省退回纯随机）
 * @returns {object} 战斗配置
 */
export function getRandomBattleConfig(trophies) {
  const layout = BOARD_LAYOUTS[Math.floor(battleRandom() * BOARD_LAYOUTS.length)];
  return buildBattleConfig(layout, trophies);
}

// ========== 向后兼容函数（部分系统仍引用） ==========

/**
 * 获取所有关卡数据（向后兼容）
 */
export function getLevels() {
  return ConfigLoader.get('levels').levels;
}

/**
 * 获取指定关卡（向后兼容，仅用于读取地图模板）
 */
export function getLevel(id) {
  const levels = getLevels();
  return levels.find(l => l.id === id) || levels[0];
}

// ========== 向后兼容: 静态导出 ==========

export let LEVELS;

/**
 * 在 ConfigLoader.init() 完成后调用
 */
export function syncLevels() {
  LEVELS = getLevels();
}
