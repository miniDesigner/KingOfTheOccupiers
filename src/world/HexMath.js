/**
 * 六边形数学工具
 * 尖顶六边形 (pointy-top hex)，轴向坐标 (q, r) 系统
 */

// 六个邻居方向
export const HEX_DIRECTIONS = [
  { q: +1, r: 0 },   // E  东
  { q: +1, r: -1 },  // NE 东北
  { q: 0, r: -1 },   // NW 西北
  { q: -1, r: 0 },   // W  西
  { q: -1, r: +1 },  // SW 西南
  { q: 0, r: +1 },   // SE 东南
];

/**
 * 轴向坐标 → 像素坐标
 */
export function hexToPixel(q, r, size) {
  const x = size * Math.sqrt(3) * (q + r / 2);
  const y = size * 1.5 * r;
  return { x, y };
}

/**
 * 像素坐标 → 轴向坐标
 */
export function pixelToHex(x, y, size) {
  const q = (Math.sqrt(3) / 3 * x - 1 / 3 * y) / size;
  const r = (2 / 3 * y) / size;
  return hexRound(q, r);
}

/**
 * 六边形坐标四舍五入(浮点→整数)
 */
export function hexRound(q, r) {
  const s = -q - r;
  let rq = Math.round(q);
  let rr = Math.round(r);
  let rs = Math.round(s);

  const qDiff = Math.abs(rq - q);
  const rDiff = Math.abs(rr - r);
  const sDiff = Math.abs(rs - s);

  if (qDiff > rDiff && qDiff > sDiff) {
    rq = -rr - rs;
  } else if (rDiff > sDiff) {
    rr = -rq - rs;
  }
  return { q: rq, r: rr };
}

/**
 * 六边形距离(格数)
 */
export function hexDistance(a, b) {
  return (Math.abs(a.q - b.q) + Math.abs(a.q + a.r - b.q - b.r) + Math.abs(a.r - b.r)) / 2;
}

/**
 * 获取邻居坐标列表
 */
export function getNeighborCoords(q, r) {
  return HEX_DIRECTIONS.map(d => ({ q: q + d.q, r: r + d.r }));
}

/**
 * 行列坐标 → 轴向坐标（矩形棋盘用）
 * 行 row=0 在最上方(敌方侧)，r 正方向为屏幕下方(玩家侧)
 * 列 col=0 在最左；奇数行整体向右错半格（六边形交错排列）
 * @param {number} col - 列索引(0..cols-1)
 * @param {number} row - 行索引(0..rows-1)
 * @returns {{q:number,r:number}}
 */
export function colRowToAxial(col, row) {
  return { q: col - Math.floor(row / 2), r: row };
}

/**
 * 轴向坐标 → 行列坐标（矩形棋盘用，colRowToAxial 的逆变换）
 */
export function axialToColRow(q, r) {
  return { col: q + Math.floor(r / 2), row: r };
}

/**
 * 生成行列制矩形棋盘区域的所有轴向坐标（六边形交错排列）
 * @param {number} cols - 每行格数（列数）
 * @param {number} rows - 总行数（纵向条数）
 * @returns {Array<{q:number,r:number}>}
 */
export function generateRectArea(cols, rows) {
  const coords = [];
  for (let r = 0; r < rows; r++) {
    const rOffset = Math.floor(r / 2);
    for (let q = -rOffset; q < cols - rOffset; q++) {
      coords.push({ q, r });
    }
  }
  return coords;
}

/**
 * 格子key
 */
export function tileKey(q, r) {
  return q + ',' + r;
}
