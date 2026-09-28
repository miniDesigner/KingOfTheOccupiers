// 测试: 对战布局系统（行列制矩形棋盘 + 随机棋盘 + 障碍格战线）
// 覆盖: 布局表完整性 / 行列生成与交错排列 / 上下方位(玩家在下) / 随机抽取 /
//       障碍生成与行列→轴向转换 / 障碍不可翻转不可通行 / 各布局路线连通与分线 /
//       AI不选障碍格 / 相机适配 / 渲染冒烟 / 出生保底
const noop = () => {};
const ctxProxy = new Proxy({}, {
  get: (t, p) => {
    if (p === 'canvas') return canvasStub;
    return (...args) => {
      if (p === 'measureText') return { width: 50 };
      if (p === 'createLinearGradient' || p === 'createRadialGradient') return { addColorStop: noop };
      return undefined;
    };
  },
  set: () => true,
});
const canvasStub = {
  width: 400, height: 700, style: {},
  getContext: () => ctxProxy,
  addEventListener: noop, removeEventListener: noop,
  getBoundingClientRect: () => ({ left: 0, top: 0, width: 400, height: 700 }),
};
global.document = {
  getElementById: () => canvasStub,
  addEventListener: noop, removeEventListener: noop,
  createElement: () => canvasStub,
  body: { appendChild: noop, removeChild: noop },
  hidden: false,
};
global.window = {
  innerWidth: 400, innerHeight: 700, devicePixelRatio: 1,
  addEventListener: noop, removeEventListener: noop,
  requestAnimationFrame: (cb) => 0,
  cancelAnimationFrame: noop,
  AudioContext: class {},
  location: { href: 'http://127.0.0.1:8890/preview/index.html', reload: noop },
};
global.requestAnimationFrame = () => 0;
global.localStorage = { _d: {}, getItem(k) { return this._d[k] ?? null; }, setItem(k, v) { this._d[k] = String(v); }, removeItem(k) { delete this._d[k]; } };
global.wx = {
  shareAppMessage(cfg) { global.__lastShare = cfg; },
  createInnerAudioContext() {
    return { src: '', loop: false, volume: 1, play: noop, pause: noop, stop: noop, seek: noop, destroy: noop, onEnded: noop, onError: noop, onCanplay: noop };
  },
};
Object.defineProperty(global, 'navigator', { value: { userAgent: 'node-test' }, configurable: true });
global.performance = { now: () => Date.now() };
global.alert = noop;
global.Audio = class { constructor() { this.volume = 1; } play() { return Promise.resolve(); } pause() {} addEventListener() {} };
const { readFileSync: rf, existsSync } = await import('node:fs');
const { fileURLToPath: fURL } = await import('node:url');
const ROOT = fURL(new URL('..', import.meta.url));
global.fetch = async (path) => {
  const file = ROOT + path.replace('../', '');
  if (!existsSync(file)) return { ok: false, status: 404, json: async () => { throw new Error('404 ' + path); } };
  return { ok: true, status: 200, json: async () => JSON.parse(rf(file, 'utf-8')) };
};

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; console.log(`  ✅ ${msg}`); }
  else { failed++; console.log(`  ❌ ${msg}`); }
}

const { BOARD_LAYOUTS, buildBattleConfig, getRandomBattleConfig, baseCoords } = await import('../src/data/levels.js');
const { HexMap } = await import('../src/world/HexMap.js');
const { PathfindingSystem } = await import('../src/system/PathfindingSystem.js');
const { BuildSystem } = await import('../src/system/BuildSystem.js');
const { colRowToAxial, axialToColRow, generateRectArea, tileKey } = await import('../src/world/HexMath.js');

// 初始化配置（PRESET_DISTRIBUTION 等静态量依赖 ConfigLoader.init + sync）
const ConfigLoader = (await import('../src/data/ConfigLoader.js')).default;
const { syncConfigToStatics } = await import('../src/config.js');
await ConfigLoader.init();
syncConfigToStatics();

// ============ 1. 布局表完整性 ============
console.log('=== 测试1: 棋盘布局表（行列制） ===');
{
  assert(BOARD_LAYOUTS.length >= 5, `至少5种布局（实际${BOARD_LAYOUTS.length}）`);
  const ids = new Set(BOARD_LAYOUTS.map(l => l.id));
  assert(ids.size === BOARD_LAYOUTS.length, '布局id无重复');
  let allOk = true;
  for (const l of BOARD_LAYOUTS) {
    if (!(l.rows >= 7)) { allOk = false; console.log(`    ${l.id} rows=${l.rows} 需≥7`); }
    if (!(l.cols >= 7 && l.cols % 2 === 1)) { allOk = false; console.log(`    ${l.id} cols=${l.cols} 需为奇数且≥7`); }
    if (!(l.lanes >= 1 && l.lanes <= 3)) allOk = false;
    // 障碍行列索引必须在范围内且不占用大本营位置
    const pbRow = l.rows - 3, ebRow = 2, centerCol = Math.floor((l.cols - 1) / 2);
    for (const o of l.obstacles || []) {
      if (!(o.row >= 0 && o.row < l.rows)) { allOk = false; console.log(`    ${l.id} row越界: ${o.row}`); }
      if (!(o.col >= 0 && o.col < l.cols)) { allOk = false; console.log(`    ${l.id} col越界: ${o.col}`); }
      if ((o.row === pbRow || o.row === ebRow) && o.col === centerCol) {
        allOk = false; console.log(`    ${l.id} 障碍占大本营: (${o.row},${o.col})`);
      }
    }
  }
  assert(allOk, '全部布局 rows≥7、cols 奇数≥7，障碍在范围内且不占大本营');
  assert(ids.has('plains') && ids.has('twin_canyon') && ids.has('tri_lanes'), '含平原/双线/三线布局');
}

// ============ 2. 行列生成与交错排列 ============
console.log('=== 测试2: 行列矩形生成 + 六边形交错 ===');
{
  const cols = 7, rows = 5;
  const area = generateRectArea(cols, rows);
  assert(area.length === cols * rows, `生成总数 = 行×列（${area.length} = ${rows}×${cols}）`);
  // 每行恰好 cols 格
  const byRow = new Map();
  for (const c of area) byRow.set(c.r, (byRow.get(c.r) || 0) + 1);
  let allRowsFull = true;
  for (let r = 0; r < rows; r++) if (byRow.get(r) !== cols) allRowsFull = false;
  assert(allRowsFull, '每行恰好 cols 格');
  // colRowToAxial / axialToColRow 互逆
  let roundTripOk = true;
  for (const c of area) {
    const { col, row } = axialToColRow(c.q, c.r);
    if (!(row >= 0 && row < rows && col >= 0 && col < cols)) roundTripOk = false;
    const back = colRowToAxial(col, row);
    if (back.q !== c.q || back.r !== c.r) roundTripOk = false;
  }
  assert(roundTripOk, 'colRowToAxial ↔ axialToColRow 互逆且行列均在范围内');
  // 交错排列：偶数行 x = √3·size·col；奇数行 x = √3·size·(col + 0.5)（右错半格）
  const map = new HexMap();
  map.generate(cols, rows);
  const s = map.size;
  const x0 = map.hexToPixel(...Object.values(colRowToAxial(0, 0))).x;
  const x1 = map.hexToPixel(...Object.values(colRowToAxial(0, 1))).x;
  const x2 = map.hexToPixel(...Object.values(colRowToAxial(0, 2))).x;
  const y0 = map.hexToPixel(...Object.values(colRowToAxial(0, 0))).y;
  const y3 = map.hexToPixel(...Object.values(colRowToAxial(0, 3))).y;
  assert(Math.abs(x0 - 0) < 1e-9 && Math.abs(x2 - 0) < 1e-9, '偶数行首列 x=0（无错位）');
  assert(Math.abs(x1 - Math.sqrt(3) / 2 * s) < 1e-9, '奇数行首列 x=√3/2·size（右错半格，交错排列）');
  assert(Math.abs(y3 - 4.5 * s) < 1e-9 && y0 === 0, '行间距 1.5·size，row0 在最上');
  assert(map.getAllTiles().length === cols * rows, `HexMap.generate(cols, rows) 总格数一致`);
}

// ============ 3. 上下布局方位 ============
console.log('=== 测试3: 上下布局（玩家正下中间，敌方正上中间） ===');
{
  let ok = true;
  for (const l of BOARD_LAYOUTS) {
    const cfg = buildBattleConfig(l, 100);
    if (cfg.playerBase.r !== l.rows - 3) ok = false;               // 玩家距下边2行
    if (cfg.enemyBase.r !== 2) ok = false;                         // 敌方距上边2行
    if (cfg.playerBase.r <= cfg.enemyBase.r) ok = false;           // 玩家在下方
    // 水平居中：双方大本营各贴近棋盘水平中心（rows为偶数时上下行奇偶不同、错半格，属预期）
    const map = new HexMap();
    map.generate(l.cols, l.rows);
    const b = map.getBounds();
    const px = map.hexToPixel(cfg.playerBase.q, cfg.playerBase.r).x;
    const ex = map.hexToPixel(cfg.enemyBase.q, cfg.enemyBase.r).x;
    const centerX = (b.minX + b.maxX) / 2;
    if (Math.abs(px - ex) > Math.sqrt(3) / 2 * map.size + 1e-9) ok = false; // 双方错位不超过半格
    if (Math.abs(px - centerX) > Math.sqrt(3) / 2 * map.size) ok = false;   // 各自居中(容差半格)
  }
  assert(ok, '所有布局：玩家距下边2行、敌方距上边2行、双方水平居中(偶数行错位≤半格)');
  // 随机100次
  let okRandom = true;
  for (let i = 0; i < 100; i++) {
    const cfg = getRandomBattleConfig(0);
    if (!(cfg.playerBase.r > cfg.enemyBase.r)) okRandom = false;
  }
  assert(okRandom, '随机对战100次：玩家永远在下方');
}

// ============ 4. 随机抽取覆盖 ============
console.log('=== 测试4: 布局随机抽取 ===');
{
  const seen = new Set();
  for (let i = 0; i < 300; i++) {
    const cfg = getRandomBattleConfig();
    seen.add(cfg.layoutId);
    if (!BOARD_LAYOUTS.find(l => l.id === cfg.layoutId)) {
      assert(false, `未知布局id: ${cfg.layoutId}`);
    }
  }
  assert(seen.size === BOARD_LAYOUTS.length, `300次抽取覆盖全部${BOARD_LAYOUTS.length}种布局（实际${seen.size}）`);
}

// ============ 5. 障碍格生成（行列→轴向转换） ============
console.log('=== 测试5: 障碍格生成 ===');
{
  const l = BOARD_LAYOUTS.find(x => x.id === 'twin_canyon');
  const cfg = buildBattleConfig(l, 100);
  assert(cfg.obstacles.length === l.obstacles.length, `障碍格行列→轴向转换数量一致(${cfg.obstacles.length})`);
  const map = new HexMap();
  map.generate(cfg.cols, cfg.rows, cfg.obstacles);
  let allFlagged = true, allCleared = true;
  for (const o of cfg.obstacles) {
    const t = map.getTile(o.q, o.r);
    if (!t || !t.isObstacle) allFlagged = false;
    if (t && t.presetBuilding !== null) allCleared = false;
  }
  assert(allFlagged, '障碍格全部标记 isObstacle');
  assert(allCleared, '障碍格预设建筑已清空');
  const obstacleCount = map.getAllTiles().filter(t => t.isObstacle).length;
  assert(obstacleCount === l.obstacles.length, `障碍格数量一致(${obstacleCount}/${l.obstacles.length})`);
  // 无障碍参数时向后兼容
  const map2 = new HexMap();
  map2.generate(7, 5);
  assert(map2.getAllTiles().every(t => !t.isObstacle), '不带障碍生成 → 全图无障碍（向后兼容）');
}

// ============ 6. 障碍格不可翻转 ============
console.log('=== 测试6: 障碍格不可翻转 ===');
{
  const l = BOARD_LAYOUTS.find(x => x.id === 'twin_canyon');
  const cfg = buildBattleConfig(l, 100);
  const map = new HexMap();
  map.generate(cfg.cols, cfg.rows, cfg.obstacles);
  // 障碍(墙末端 row12,col5)的下方邻格(row13,col5)标记为已翻转，满足邻接条件
  const below = colRowToAxial(5, 13);
  const base = map.getTile(below.q, below.r);
  base.owner = 1; base.isFlipped = true;
  const wallBottom = colRowToAxial(5, 12);
  const obstacle = map.getTile(wallBottom.q, wallBottom.r);
  assert(obstacle && obstacle.isObstacle, '(row12,col5)是紧邻已翻转格的障碍格');
  const player = { id: 1, gold: 999, spendGold() { this.gold -= 10; } };
  assert(BuildSystem.tryFlipTile(obstacle, player, map) === false, 'tryFlipTile 拒绝障碍格（即使金币充足相邻）');
  assert(player.gold === 999, '拒绝时不扣金币');
}

// ============ 7. 各布局路线连通 + 寻路避障 ============
console.log('=== 测试7: 路线连通与寻路 ===');
{
  let allOk = true;
  for (const l of BOARD_LAYOUTS) {
    const cfg = buildBattleConfig(l, 0);
    const map = new HexMap();
    map.generate(cfg.cols, cfg.rows, cfg.obstacles);
    const start = map.getTile(cfg.playerBase.q, cfg.playerBase.r);
    const goal = map.getTile(cfg.enemyBase.q, cfg.enemyBase.r);
    for (const owner of [1, 2]) {
      const path = PathfindingSystem.findPath(start, goal, map, owner);
      if (!path || path.length < 2) { allOk = false; console.log(`    ${l.id} owner${owner} 无路径`); continue; }
      if (path.some(t => t.isObstacle)) { allOk = false; console.log(`    ${l.id} owner${owner} 路径穿过障碍`); }
      if (path[0] !== start || path[path.length - 1] !== goal) { allOk = false; console.log(`    ${l.id} owner${owner} 端点错误`); }
    }
  }
  assert(allOk, '全部布局：正中双方大本营间可寻路且路径不穿障碍');
  // isPassable 直接验证
  const cfgT = buildBattleConfig(BOARD_LAYOUTS[1], 0);
  const map = new HexMap();
  map.generate(cfgT.cols, cfgT.rows, cfgT.obstacles);
  const wall = colRowToAxial(5, 7);
  const plain = colRowToAxial(6, 7);
  assert(PathfindingSystem.isPassable(map.getTile(wall.q, wall.r), 1, null) === false, 'isPassable: 障碍格返回false');
  assert(PathfindingSystem.isPassable(map.getTile(plain.q, plain.r), 1, null) === true, 'isPassable: 障碍旁普通格可通行');
}

// ============ 8. 战线划分验证 ============
console.log('=== 测试8: 障碍分线（2~3条战线） ===');
{
  const reachable = (map, coord) => {
    const start = map.getTile(coord.q, coord.r);
    const seen = new Set([tileKey(start.q, start.r)]);
    const queue = [start];
    while (queue.length) {
      const t = queue.shift();
      for (const n of map.getNeighbors(t.q, t.r)) {
        const k = tileKey(n.q, n.r);
        if (!seen.has(k) && !n.isObstacle) { seen.add(k); queue.push(n); }
      }
    }
    return seen;
  };
  const setup = (id) => {
    const l = BOARD_LAYOUTS.find(x => x.id === id);
    const cfg = buildBattleConfig(l, 0);
    const map = new HexMap();
    map.generate(cfg.cols, cfg.rows, cfg.obstacles);
    return { cfg, map };
  };

  // 双线峡谷：中央墙断开，左右两线连通
  {
    const { cfg, map } = setup('twin_canyon');
    const R = reachable(map, cfg.playerBase);
    const wallMid = colRowToAxial(5, 7);
    const left = colRowToAxial(2, 7), right = colRowToAxial(8, 7);
    assert(!R.has(tileKey(wallMid.q, wallMid.r)), '双线峡谷：墙体中格(row7,col5)不可达');
    assert(R.has(tileKey(left.q, left.r)) && R.has(tileKey(right.q, right.r)), '双线峡谷：左右两线均可达');
    assert(R.has(tileKey(cfg.enemyBase.q, cfg.enemyBase.r)), '双线峡谷：敌方基地可达');
  }
  // 三线走廊：左中右三线连通，墙格不可达
  {
    const { cfg, map } = setup('tri_lanes');
    const R = reachable(map, cfg.playerBase);
    const wallL = colRowToAxial(3, 8), wallR = colRowToAxial(7, 8);
    const mid = colRowToAxial(5, 8), farL = colRowToAxial(1, 8), farR = colRowToAxial(9, 8);
    assert(!R.has(tileKey(wallL.q, wallL.r)) && !R.has(tileKey(wallR.q, wallR.r)), '三线走廊：两道墙格不可达');
    assert(R.has(tileKey(mid.q, mid.r)), '三线走廊：中线(row8,col5)可达');
    assert(R.has(tileKey(farL.q, farL.r)) && R.has(tileKey(farR.q, farR.r)), '三线走廊：左右两线可达');
    assert(R.has(tileKey(cfg.enemyBase.q, cfg.enemyBase.r)), '三线走廊：敌方基地可达');
  }
  // 河谷渡口：渡口(col3/col7)连通，河面不可达
  {
    const { cfg, map } = setup('river_ford');
    const R = reachable(map, cfg.playerBase);
    const fordL = colRowToAxial(3, 9), fordR = colRowToAxial(7, 9);
    const river = colRowToAxial(5, 9);
    assert(R.has(tileKey(fordL.q, fordL.r)) && R.has(tileKey(fordR.q, fordR.r)), '河谷渡口：左右渡口连通');
    assert(!R.has(tileKey(river.q, river.r)), '河谷渡口：河面(row9,col5)不可达');
    assert(R.has(tileKey(cfg.enemyBase.q, cfg.enemyBase.r)), '河谷渡口：敌方基地可达');
  }
  // 中央山垒：中心不可达，侧翼绕行连通
  {
    const { cfg, map } = setup('citadel');
    const R = reachable(map, cfg.playerBase);
    const center = colRowToAxial(5, 9);
    const gap = colRowToAxial(5, 8);
    const left = colRowToAxial(2, 9), right = colRowToAxial(8, 9);
    assert(!R.has(tileKey(center.q, center.r)), '中央山垒：中心(row9,col5)不可达');
    assert(R.has(tileKey(gap.q, gap.r)), '中央山垒：西北缺口(row8,col5)连通');
    assert(R.has(tileKey(left.q, left.r)) && R.has(tileKey(right.q, right.r)), '中央山垒：左右侧翼可达');
    assert(R.has(tileKey(cfg.enemyBase.q, cfg.enemyBase.r)), '中央山垒：敌方基地可达');
  }
}

// ============ 9. AI决策不选障碍格 ============
console.log('=== 测试9: AI决策避障 ===');
{
  const { Game } = await import('../src/game/Game.js');
  const { AIPlayer } = await import('../src/entity/AIPlayer.js');
  const game = new Game(canvasStub, ctxProxy, 400, 700);
  await game.start();
  game.initBattle();
  // 强制双线峡谷布局重生成
  game.currentBattleConfig = buildBattleConfig(BOARD_LAYOUTS.find(x => x.id === 'twin_canyon'), 0);
  game.map = new HexMap();
  game.map.generate(game.currentBattleConfig.cols, game.currentBattleConfig.rows, game.currentBattleConfig.obstacles);
  const ai = new AIPlayer(2, '测试AI', '#ef4444', 'normal');
  ai.base = game.map.getTile(game.currentBattleConfig.enemyBase.q, game.currentBattleConfig.enemyBase.r);
  ai.base.owner = 2; ai.base.isFlipped = true;
  ai.gold = 999;
  let flipped = [];
  let ok = true;
  for (let i = 0; i < 50; i++) {
    if (!ai.tick(10)) ai.decisionTimer = ai.decisionInterval;
    ai.makeDecision(game.map, game, (tile, p) => {
      if (tile.isObstacle) ok = false;
      flipped.push(tile);
      tile.owner = 2; tile.isFlipped = true;
    });
  }
  assert(ok, `AI决策50次从不翻转障碍格`);
  assert(flipped.length > 0, `AI正常扩张（翻转${flipped.length}格）`);
}

// ============ 10. initBattle 集成 + 相机适配 ============
console.log('=== 测试10: initBattle 集成 ===');
{
  const { Game } = await import('../src/game/Game.js');
  const game = new Game(canvasStub, ctxProxy, 400, 700);
  await game.start();
  game.initBattle();
  const cfg = game.currentBattleConfig;
  const l = BOARD_LAYOUTS.find(x => x.id === cfg.layoutId);
  assert(l, `initBattle 携带布局(${cfg.layoutName})`);
  assert(cfg.rows === l.rows && cfg.cols === l.cols, `行列配置正确(${l.rows}行×${l.cols}列)`);
  assert(game.map.getAllTiles().length === l.rows * l.cols, `地图总格数 = 行×列（${game.map.getAllTiles().length}）`);
  assert(cfg.playerBase.r === l.rows - 3 && cfg.enemyBase.r === 2, 'initBattle：玩家距下2行、敌方距上2行');
  const obstacleTiles = game.map.getAllTiles().filter(t => t.isObstacle);
  assert(obstacleTiles.length === (cfg.obstacles || []).length, `地图障碍格已生成(${obstacleTiles.length})`);
  const player = game.players.find(p => p.id === 1);
  const enemy = game.players.find(p => p.id === 2);
  assert(player.base.r === l.rows - 3 && enemy.base.r === 2, `双方大本营落位：玩家r=${player.base.r} 敌方r=${enemy.base.r}`);
  // 相机自动缩放：整图适配屏幕
  const bounds = game.map.getBounds();
  const s = game.inputSystem.scale;
  assert(s >= 0.35 && s <= 1, `相机缩放在[0.35,1]（实际${s.toFixed(2)}）`);
  assert(bounds.width * s <= 400 + 1, `地图宽度适配屏幕（${(bounds.width * s).toFixed(0)}px ≤ 400px）`);
  assert(bounds.height * s <= 700 * 0.86 + 1, `地图高度适配屏幕（${(bounds.height * s).toFixed(0)}px ≤ 604px）`);
}

// ============ 11. 渲染冒烟（含障碍格 + 各布局） ============
console.log('=== 测试11: 渲染冒烟 ===');
{
  const { Game } = await import('../src/game/Game.js');
  const game = new Game(canvasStub, ctxProxy, 400, 700);
  await game.start();
  const origRandom = Math.random;
  let ok = true, okLayout = true;
  for (let i = 0; i < BOARD_LAYOUTS.length; i++) {
    const l = BOARD_LAYOUTS[i];
    Math.random = () => (i + 0.5) / BOARD_LAYOUTS.length;
    try {
      game.initBattle();
      if (game.currentBattleConfig.layoutId !== l.id) okLayout = false;
      game.render(0.016);
    } catch (e) { ok = false; console.log(`    ${l.id} 渲染异常:`, e.message); }
  }
  Math.random = origRandom;
  assert(okLayout, '固定随机可确定性抽取每种布局');
  assert(ok, `全部${BOARD_LAYOUTS.length}种布局 playing 渲染无异常`);
}

// ============ 12. 玩家大本营周围一级地块保底 ============
console.log('=== 测试12: 出生点一级地块保底 ===');
{
  const LV1_TYPES = new Set(['barracks', 'gold_mine', 'arrow_tower']);
  const isLv1 = (t) => t.presetBuilding && t.presetBuilding.level === 1
    && LV1_TYPES.has(t.presetBuilding.type);

  // 12.1 各布局 100 次随机生成：调用后玩家基点周围必有 ≥3 个一级地块
  let okAll = true, okTypes = true, okObstacle = true;
  for (const l of BOARD_LAYOUTS) {
    const cfg = buildBattleConfig(l, 100);
    const pb = cfg.playerBase;
    for (let i = 0; i < 100; i++) {
      const map = new HexMap();
      map.generate(cfg.cols, cfg.rows, cfg.obstacles);
      map.ensureLevelOneAround(pb.q, pb.r, 3);
      const neighbors = map.getNeighbors(pb.q, pb.r).filter(t => !t.isObstacle);
      const lv1Count = neighbors.filter(isLv1).length;
      if (lv1Count < 3) { okAll = false; console.log(`    ${l.id} 第${i}次仅${lv1Count}个一级`); }
      if (neighbors.some(t => t.presetBuilding && t.presetBuilding.level === 1 && !LV1_TYPES.has(t.presetBuilding.type))) okTypes = false;
      for (const t of map.getNeighbors(pb.q, pb.r)) {
        if (t.isObstacle && t.presetBuilding !== null) okObstacle = false;
      }
    }
  }
  assert(okAll, '全部布局×100次：玩家基点周围 ≥3 个一级地块');
  assert(okTypes, '重设后的地块均为合法一级建筑类型');
  assert(okObstacle, '障碍邻格不被改动');

  // 小图辅助：7行7列，玩家基点(row4,col3)6邻格齐全
  const makeSmallMap = () => {
    const map = new HexMap();
    map.generate(7, 7);
    return { map, pb: baseCoords(7, 7, 1) };
  };

  // 12.2 已满足时不改动其余邻格
  {
    const { map, pb } = makeSmallMap();
    const neighbors = map.getNeighbors(pb.q, pb.r);
    neighbors.slice(0, 4).forEach(t => t.setPresetBuilding('barracks', 1));
    const high = neighbors[4];
    high.setPresetBuilding('barracks', 4);
    map.ensureLevelOneAround(pb.q, pb.r, 3);
    assert(high.presetBuilding.type === 'barracks' && high.presetBuilding.level === 4,
      '已满足3个一级时：多余邻格不被重设');
  }

  // 12.3 不足时逐格补足（全部邻格非一级 → 恰好补3个）
  {
    const { map, pb } = makeSmallMap();
    const neighbors = map.getNeighbors(pb.q, pb.r);
    neighbors.forEach(t => t.setPresetBuilding('barracks', 4));
    map.ensureLevelOneAround(pb.q, pb.r, 3);
    const lv1 = neighbors.filter(isLv1).length;
    assert(lv1 === 3, `全高级邻格时恰好补足3个一级（实际${lv1}）`);
  }

  // 12.4 minCount 超过可用邻格数：不崩溃、全部补为一级
  {
    const { map, pb } = makeSmallMap();
    const neighbors = map.getNeighbors(pb.q, pb.r);
    neighbors.forEach(t => t.setPresetBuilding('barracks', 3));
    map.ensureLevelOneAround(pb.q, pb.r, 99);
    assert(neighbors.filter(isLv1).length === neighbors.length, 'minCount 超额：全部邻格补为一级且无异常');
  }

  // 12.5 initBattle 集成：开局玩家大本营周围即满足保底
  {
    const { Game } = await import('../src/game/Game.js');
    const game = new Game(canvasStub, ctxProxy, 400, 700);
    await game.start();
    let okInit = true;
    for (let i = 0; i < 10; i++) {
      game.initBattle();
      const base = game.players.find(p => p.id === 1).base;
      const lv1 = game.map.getNeighbors(base.q, base.r)
        .filter(t => !t.isObstacle && isLv1(t)).length;
      if (lv1 < 3) { okInit = false; console.log(`    第${i}局仅${lv1}个一级`); }
    }
    assert(okInit, 'initBattle×10局：玩家出生点周围 ≥3 个一级地块');
  }
}

console.log(`\n========== 结果: ${passed} 通过, ${failed} 失败 ==========`);
process.exit(failed > 0 ? 1 : 0);
