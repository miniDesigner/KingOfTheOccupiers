/**
 * 复现：士兵越过障碍后不直奔大本营，继续沿原方向走一段才转弯
 * 构造地图 + 中线障碍，检查 A* 原始路径与 LOS 平滑后路标的形状
 */
const noop = () => {};
const canvasStub = {
  width: 400, height: 700, addEventListener: noop, removeEventListener: noop,
  getContext: () => ({ save: noop, restore: noop, set fillStyle(v) {}, beginPath: noop, arc: noop, fill: noop, fillText: noop, measureText: () => ({ width: 10 }), translate: noop, rotate: noop, drawImage: noop, canvas: { width: 400, height: 700 } }),
};
global.document = { getElementById: () => canvasStub, addEventListener: noop, removeEventListener: noop, createElement: () => canvasStub };
global.window = { innerWidth: 400, innerHeight: 700, addEventListener: noop, removeEventListener: noop, devicePixelRatio: 1, requestAnimationFrame: noop };
global.localStorage = { _d: {}, getItem(k) { return this._d[k] ?? null; }, setItem(k, v) { this._d[k] = String(v); }, removeItem(k) { delete this._d[k]; } };
global.performance = { now: () => Date.now() };
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
const { axialToColRow } = await import('../src/world/HexMath.js');

// ---------- 工具 ----------
function printPath(map, path, label) {
  // 渲染 ASCII 网格: row x col
  const grid = [];
  let maxCol = 0, maxRow = 0;
  for (const t of map.tiles.values()) {
    const { col, row } = axialToColRow(t.q, t.r);
    maxCol = Math.max(maxCol, col); maxRow = Math.max(maxRow, row);
  }
  for (let r = 0; r <= maxRow; r++) grid.push(new Array(maxCol + 1).fill('·'));
  for (const t of map.tiles.values()) {
    const { col, row } = axialToColRow(t.q, t.r);
    if (t.isObstacle) grid[row][col] = '█';
  }
  if (path) {
    path.forEach((t, i) => {
      const { col, row } = axialToColRow(t.q, t.r);
      if (i === 0) grid[row][col] = 'S';
      else if (i === path.length - 1) grid[row][col] = 'G';
      else grid[row][col] = 'o';
    });
  }
  console.log(`\n=== ${label} ===`);
  grid.forEach((line, r) => console.log(String(r).padStart(2) + ' ' + line.join('')));
}

// ---------- 场景1: 中线障碍墙，缺口在左侧，起终点在中轴 ----------
{
  const map = new HexMap();
  const cols = 11, rows = 14;
  const obstacles = [];
  // 障碍墙: row 6,7 的 col 4..10（右侧封闭），缺口在左侧 col 0..3
  for (let row = 6; row <= 7; row++) {
    for (let col = 4; col <= 10; col++) {
      // colRowToAxial
      const q = col - Math.floor(row / 2);
      obstacles.push({ q, r: row });
    }
  }
  map.generate(cols, rows, obstacles);
  // 起点: 下方中轴 (col 7, row 12) → q = 7 - 6 = 1, r = 12
  const start = map.getTile(7 - Math.floor(12 / 2), 12);
  // 目标: 上方中轴 (col 5, row 1) → q = 5 - 0 = 5, r = 1
  const goal = map.getTile(5 - Math.floor(1 / 2), 1);
  const path = PathfindingSystem.findPath(start, goal, map, 1);
  printPath(map, path, `场景1 原始A*路径 (len=${path ? path.length : 'null'})`);

  if (path) {
    // 平滑后路标
    const { hexToPixel } = await import('../src/world/HexMath.js');
    const raw = path.map(t => { const p = hexToPixel(t.q, t.r, map.size); return { x: p.x, y: p.y }; });
    const wp = MarchGroup._smoothWaypoints(raw, map);
    console.log(`平滑后路标数: ${wp.length}`);
    wp.forEach((w, i) => console.log(`  wp[${i}] = (${w.x.toFixed(0)}, ${w.y.toFixed(0)})`));
    // 检查: 过障碍后是否立即指向目标
    // 找到路径上第一个 row < 6 (已越过障碍墙) 的点，看其后的走向
  }
}

// ---------- 场景2: 大块障碍居中，绕行后应立即转向目标 ----------
{
  const map = new HexMap();
  const cols = 11, rows = 14;
  const obstacles = [];
  for (let row = 5; row <= 8; row++) {
    for (let col = 3; col <= 7; col++) {
      obstacles.push({ q: col - Math.floor(row / 2), r: row });
    }
  }
  map.generate(cols, rows, obstacles);
  const start = map.getTile(7 - Math.floor(12 / 2), 12);
  const goal = map.getTile(5 - Math.floor(1 / 2), 1);
  const path = PathfindingSystem.findPath(start, goal, map, 1);
  printPath(map, path, `场景2 原始A*路径 (len=${path ? path.length : 'null'})`);
  if (path) {
    const { hexToPixel } = await import('../src/world/HexMath.js');
    const raw = path.map(t => { const p = hexToPixel(t.q, t.r, map.size); return { x: p.x, y: p.y }; });

    // ---- 分阶段调试: LOS 拉直 ----
    const obstaclesC = MarchGroup._collectObstacleCenters(map);
    const CLEAR_STRAIGHT = 0.9, CLEAR_PULL = 1.4;
    const clearStraight = (a, b) => MarchGroup._segmentClear(a, b, obstaclesC, map.size * CLEAR_STRAIGHT);
    const straight = [raw[0]];
    let i = 0;
    while (i < raw.length - 1) {
      let j = raw.length - 1;
      while (j > i + 1 && !clearStraight(raw[i], raw[j])) j--;
      straight.push(raw[j]);
      i = j;
    }
    console.log(`\nLOS拉直后拐点 (${straight.length} 点):`);
    straight.forEach((w, k) => {
      const t = k === 0 ? 'S' : (k === straight.length - 1 ? 'G' : '拐点');
      // 像素转 col/row
      const r = w.y / (1.5 * map.size);
      const q = w.x / (Math.sqrt(3) * map.size) - r / 2;
      console.log(`  [${k}] ${t} px=(${w.x.toFixed(0)},${w.y.toFixed(0)}) ≈ col=${(q + r / 2).toFixed(1)} row=${r.toFixed(1)}`);
    });

    // ---- 拐点收紧阶段调试(复刻 _roundCorners 的 pull) ----
    const clearPullD = (a, b) => MarchGroup._segmentClear(a, b, obstaclesC, map.size * 1.4);
    const pulled = [straight[0]];
    for (let k = 1; k < straight.length - 1; k++) {
      const A = pulled[pulled.length - 1];
      const P = straight[k];
      const B = straight[k + 1];
      const proj = MarchGroup._projectOnSegment(P, A, B);
      let lo = 0, hi = 1, corner = P;
      for (let it = 0; it < 7; it++) {
        const t = (lo + hi) / 2;
        const cand = { x: P.x + (proj.x - P.x) * t, y: P.y + (proj.y - P.y) * t };
        if (clearPullD(A, cand) && clearPullD(cand, B)) { corner = cand; lo = t; }
        else { hi = t; }
      }
      pulled.push(corner);
    }
    pulled.push(straight[straight.length - 1]);
    console.log(`\n收紧后拐点 (${pulled.length} 点):`);
    pulled.forEach((w, k) => console.log(`  [${k}] px=(${w.x.toFixed(0)},${w.y.toFixed(0)})`));

    const wp = MarchGroup._smoothWaypoints(raw, map);
    console.log(`最终路标数: ${wp.length}`);
    wp.forEach((w, k) => console.log(`  wp[${k}] = (${w.x.toFixed(0)}, ${w.y.toFixed(0)})`));
  }
}

// ---------- 场景5: 真实布局 river_ford（横向河 rows9-10，渡口 col3/7，两端可绕） ----------
{
  const map = new HexMap();
  const cols = 11, rows = 20;
  const obstacles = [];
  for (const row of [9, 10]) {
    for (let col = 1; col <= 9; col++) {
      if (col === 3 || col === 7) continue; // 渡口
      obstacles.push({ q: col - Math.floor(row / 2), r: row });
    }
  }
  map.generate(cols, rows, obstacles);
  const goal = map.getTile(5 - Math.floor(2 / 2), 2);
  for (const [col, row, tag] of [[5, 17, '中轴'], [6, 16, '右中路'], [8, 15, '右侧'], [2, 15, '左侧']]) {
    const start = map.getTile(col - Math.floor(row / 2), row);
    const path = PathfindingSystem.findPath(start, goal, map, 1);
    if (!path) { console.log(`${tag}: 无路径!`); continue; }
    const { hexToPixel } = await import('../src/world/HexMath.js');
    const raw = path.map(t => { const p = hexToPixel(t.q, t.r, map.size); return { x: p.x, y: p.y }; });
    const wp = MarchGroup._smoothWaypoints(raw, map);
    console.log(`\n--- 出生点(col${col},row${row}) ${tag} | A* len=${path.length} | 平滑路标 ${wp.length} 点 ---`);
    wp.forEach((w, k) => {
      const r = w.y / (1.5 * map.size);
      const q = w.x / (Math.sqrt(3) * map.size) - r / 2;
      console.log(`  wp[${k}] = (${w.x.toFixed(0)}, ${w.y.toFixed(0)}) ≈ col=${(q + r / 2).toFixed(1)} row=${r.toFixed(1)}`);
    });
  }
  printPath(map, PathfindingSystem.findPath(map.getTile(5 - 8, 17), goal, map, 1), 'river_ford A*(中轴出生)');
}
