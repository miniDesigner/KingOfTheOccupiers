/**
 * 量化复现：士兵路径在「目标已直线可见」后仍不直奔目标的超绕距离
 * 对全部 BOARD_LAYOUTS × 全部出生格测量：
 *   沿平滑路径找到第一个「到敌方大本营直线净空达标」的位置 P，
 *   计算 剩余路径长度 - |P→G|直线距离 = 超绕距离(excess)
 * 理想拉紧路径 excess ≈ 0；excess 大 = 用户抱怨的「继续走一段才转弯」
 */
const noop = () => {};
const canvasStub = {
  width: 400, height: 700, addEventListener: noop, removeEventListener: noop,
  getContext: () => ({ save: noop, restore: noop, beginPath: noop, arc: noop, fill: noop, fillText: noop, measureText: () => ({ width: 10 }), translate: noop, rotate: noop, drawImage: noop, canvas: { width: 400, height: 700 } }),
};
global.document = { getElementById: () => canvasStub, addEventListener: noop, removeEventListener: noop, createElement: () => canvasStub };
global.window = { innerWidth: 400, innerHeight: 700, addEventListener: noop, removeEventListener: noop, devicePixelRatio: 1, requestAnimationFrame: noop };
global.localStorage = { _d: {}, getItem(k) { return this._d[k] ?? null; }, setItem(k, v) { this._d[k] = String(v); }, removeItem(k) { delete this._d[k]; } };
global.performance = { now: () => Date.now() };
global.alert = noop;
global.wx = {};
const fs = await import('node:fs');
const { fileURLToPath: fURL } = await import('node:url');
const ROOT = fURL(new URL('..', import.meta.url));
global.fetch = async (path) => {
  const file = ROOT + String(path).replace('../', '');
  return { ok: true, status: 200, json: async () => JSON.parse(fs.readFileSync(file, 'utf-8')) };
};

const { default: ConfigLoader, syncConfigToStatics } = await import('../src/config.js');
await ConfigLoader.init();
syncConfigToStatics();

const { HexMap } = await import('../src/world/HexMap.js');
const { PathfindingSystem } = await import('../src/system/PathfindingSystem.js');
const { MarchGroup } = await import('../src/entity/MarchGroup.js');
const { hexToPixel, axialToColRow } = await import('../src/world/HexMath.js');
const { BOARD_LAYOUTS } = await import('../src/data/levels.js');

const CLEAR = 0.9;
const TILE = 1.5 * 32; // 行距(粗略格子尺度)

function measureExcess(map, wp, goalPx, obstacles) {
  // 沿折线 wp 采样推进(步长 8px)，找第一个「到 G 直线净空达标」的点 P
  // 返回 excess = 剩余路径长 - |P→G|
  const segClear = (a, b) => MarchGroup._segmentClear(a, b, obstacles, map.size * CLEAR);
  const G = goalPx;
  // 先整体可见(直线无障碍布局): excess = 全长 - |wp0→G|
  const step = 8;
  const total = (() => {
    let L = 0;
    for (let i = 0; i + 1 < wp.length; i++) L += Math.hypot(wp[i + 1].x - wp[i].x, wp[i + 1].y - wp[i].y);
    return L;
  })();
  // 逐段采样
  let acc = 0;
  for (let i = 0; i + 1 < wp.length; i++) {
    const a = wp[i], b = wp[i + 1];
    const segLen = Math.hypot(b.x - a.x, b.y - a.y);
    const n = Math.max(1, Math.ceil(segLen / step));
    for (let s = 0; s <= n; s++) {
      const t = s / n;
      const P = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
      if (segClear(P, G)) {
        const traveled = acc + segLen * t;
        const remainAlongPath = total - traveled;
        const straight = Math.hypot(G.x - P.x, G.y - P.y);
        return { excess: remainAlongPath - straight, atIdx: i };
      }
    }
    acc += segLen;
  }
  return { excess: 0, atIdx: -1 }; // 永远不可见(理论不发生，G是终点)
}

let worst = [];
for (const layout of BOARD_LAYOUTS) {
  const map = new HexMap();
  const obstacles = (layout.obstacles || []).map(({ row, col }) => ({ q: col - Math.floor(row / 2), r: row }));
  map.generate(layout.cols, layout.rows, obstacles);
  const goal = map.getTile(5 - Math.floor(2 / 2), 2); // 敌基地 col5 row2
  const goalPx = hexToPixel(goal.q, goal.r, map.size);
  const obsCenters = MarchGroup._collectObstacleCenters(map);

  let maxEx = 0, maxTile = null, sum = 0, cnt = 0, exCount = 0;
  for (const tile of map.tiles.values()) {
    if (tile.isObstacle) continue;
    if (tile === goal) continue;
    const path = PathfindingSystem.findPath(tile, goal, map, 1);
    if (!path || path.length < 2) continue;
    const raw = path.map(t => { const p = hexToPixel(t.q, t.r, map.size); return { x: p.x, y: p.y }; });
    const wp = MarchGroup._smoothWaypoints(raw, map);
    const { excess } = measureExcess(map, wp, goalPx, obsCenters);
    const exTiles = excess / TILE;
    sum += exTiles; cnt++;
    if (exTiles > 0.5) exCount++;
    if (exTiles > maxEx) {
      maxEx = exTiles;
      const cr = axialToColRow(tile.q, tile.r);
      maxTile = `(col${cr.col},row${cr.row})`;
    }
  }
  console.log(`${layout.id.padEnd(12)} 出生格${cnt} | 平均超绕 ${(sum / cnt).toFixed(2)}格 | >0.5格占比 ${(exCount / cnt * 100).toFixed(0)}% | 最大 ${maxEx.toFixed(2)}格 @ ${maxTile}`);
}

// 展示最差案例的路径形状
console.log('\n===== 最差案例细查 (citadel, 超绕最大的出生点) =====');
{
  const layout = BOARD_LAYOUTS.find(l => l.id === 'citadel');
  const map = new HexMap();
  const obstacles = (layout.obstacles || []).map(({ row, col }) => ({ q: col - Math.floor(row / 2), r: row }));
  map.generate(layout.cols, layout.rows, obstacles);
  const goal = map.getTile(5 - 1, 2);
  const goalPx = hexToPixel(goal.q, goal.r, map.size);
  const obsCenters = MarchGroup._collectObstacleCenters(map);
  let best = null;
  for (const tile of map.tiles.values()) {
    if (tile.isObstacle || tile === goal) continue;
    const path = PathfindingSystem.findPath(tile, goal, map, 1);
    if (!path || path.length < 2) continue;
    const raw = path.map(t => { const p = hexToPixel(t.q, t.r, map.size); return { x: p.x, y: p.y }; });
    const wp = MarchGroup._smoothWaypoints(raw, map);
    const { excess } = measureExcess(map, wp, goalPx, obsCenters);
    if (!best || excess > best.excess) best = { tile, path, wp, excess };
  }
  const cr = axialToColRow(best.tile.q, best.tile.r);
  console.log(`出生点 (col${cr.col},row${cr.row}) 超绕 ${(best.excess / TILE).toFixed(2)}格`);
  console.log('A* 路径(col,row):', best.path.map(t => { const c = axialToColRow(t.q, t.r); return `(${c.col},${c.row})`; }).join(' '));
  console.log('平滑路标(col,row):', best.wp.map(w => {
    const r = w.y / (1.5 * map.size);
    const q = w.x / (Math.sqrt(3) * map.size) - r / 2;
    return `(${(q + r / 2).toFixed(1)},${r.toFixed(1)})`;
  }).join(' '));
}
