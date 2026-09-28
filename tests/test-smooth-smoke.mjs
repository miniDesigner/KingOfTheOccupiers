// 平滑路径端到端 smoke：真实 HexMap + 真实 A* + 几何断言
// 验证：LOS 拉直 / 拐点收紧(贴障碍边缘) / 转角圆弧化 / 净空不压障碍

// ---- 环境stub + 配置初始化(export let 常量需 ConfigLoader.init 后才有值) ----
const noop = () => {};
global.document = { getElementById: () => ({ width: 400, height: 700, addEventListener: noop }), addEventListener: noop, body: { appendChild: noop }, hidden: false };
global.window = { innerWidth: 400, innerHeight: 700, requestAnimationFrame: () => 0, addEventListener: noop, AudioContext: class {} };
global.requestAnimationFrame = () => 0;
global.localStorage = { _d: {}, getItem(k) { return this._d[k] ?? null; }, setItem(k, v) { this._d[k] = String(v); }, removeItem(k) { delete this._d[k]; } };
global.wx = {};
global.performance = { now: () => Date.now() };
global.alert = noop;
const { readFileSync: rf, existsSync } = await import('node:fs');
const { fileURLToPath: fURL } = await import('node:url');
const ROOT = fURL(new URL('..', import.meta.url));
global.fetch = async (path) => {
  const file = ROOT + path.replace('../', '');
  if (!existsSync(file)) return { ok: false, status: 404, json: async () => { throw new Error('404 ' + path); } };
  return { ok: true, status: 200, json: async () => JSON.parse(rf(file, 'utf-8')) };
};
const { default: ConfigLoader, syncConfigToStatics } = await import('../src/config.js');
await ConfigLoader.init();
syncConfigToStatics();

const { HexMap } = await import('../src/world/HexMap.js');
const { MarchGroup } = await import('../src/entity/MarchGroup.js');
const { PathfindingSystem } = await import('../src/system/PathfindingSystem.js');
const { hexToPixel } = await import('../src/world/HexMath.js');

let pass = 0, fail = 0;
function check(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name} ${detail}`); }
}

/** 沿路径逐段采样，返回路径到任一障碍格中心的最小距离 */
function minClearance(wps, obstacleCenters) {
  let min = Infinity;
  for (let i = 0; i < wps.length - 1; i++) {
    for (const c of obstacleCenters) {
      const d = MarchGroup._distPointToSegment(c.x, c.y, wps[i], wps[i + 1]);
      if (d < min) min = d;
    }
  }
  return min;
}

function runScenario(name, map, start, goal, expectCornered) {
  console.log(`\n=== ${name} ===`);
  const path = PathfindingSystem.findPath(start, goal, map, 1);
  check('A* 找到路径', Array.isArray(path) && path.length >= 2);

  const raw = path.map(t => {
    const p = hexToPixel(t.q, t.r, map.size);
    return { x: p.x, y: p.y };
  });
  const smooth = MarchGroup._smoothWaypoints(raw, map);

  const obstacleCenters = MarchGroup._collectObstacleCenters(map);
  console.log(`  原始路标: ${raw.length} → 平滑后: ${smooth.length}`);

  check('端点保留', smooth.length >= 2 &&
    Math.hypot(smooth[0].x - raw[0].x, smooth[0].y - raw[0].y) < 1 &&
    Math.hypot(smooth[smooth.length - 1].x - raw[raw.length - 1].x, smooth[smooth.length - 1].y - raw[raw.length - 1].y) < 1);

  if (obstacleCenters.length > 0) {
    const minClear = minClearance(smooth, obstacleCenters);
    const inradius = map.size * Math.sqrt(3) / 2; // 障碍六边形内切圆半径
    console.log(`  最小净空: ${minClear.toFixed(1)}px (内切圆半径 ${inradius.toFixed(1)}px, size=${map.size})`);
    check('路径不压进障碍图形', minClear >= inradius - 0.5, `minClear=${minClear.toFixed(2)}`);
  }

  if (expectCornered) {
    // 拐点收紧+圆弧化证据：内部路标不应再钉在原始格中心上
    const rawCenters = raw.map(p => `${p.x.toFixed(0)},${p.y.toFixed(0)}`);
    const interior = smooth.slice(1, -1);
    const offGrid = interior.filter(p =>
      !rawCenters.some(c => c === `${p.x.toFixed(0)},${p.y.toFixed(0)}`));
    console.log(`  内部路标 ${interior.length} 个，其中脱离格中心 ${offGrid.length} 个`);
    check('拐点已脱离格中心(收紧/圆弧化生效)', offGrid.length > 0);
    // 圆弧化可能增加路标数(顶点→切点)，正确的度量是路径总长应变短
    const len = (wps) => {
      let L = 0;
      for (let i = 0; i < wps.length - 1; i++) L += Math.hypot(wps[i+1].x - wps[i].x, wps[i+1].y - wps[i].y);
      return L;
    };
    console.log(`  路径总长: ${len(raw).toFixed(0)}px → ${len(smooth).toFixed(0)}px`);
    check('路径更短(拉直生效)', len(smooth) < len(raw));
  } else {
    check('无障碍完全拉直', smooth.length === 2);
  }

  return smooth;
}

// ── 场景1: 竖直山脉墙挡中路，必须绕行 ──
// 9x5 地图，q=4 列 r=1..3 是山，从 (1,2) 到 (7,2)
{
  const map = new HexMap();
  map.generate(9, 5, [{ q: 4, r: 1 }, { q: 4, r: 2 }, { q: 4, r: 3 }]);
  const s = runScenario('场景1: 竖直山墙绕行', map, map.getTile(1, 2), map.getTile(7, 2), true);
  console.log('  平滑路径:');
  s.forEach((p, i) => console.log(`    [${i}] (${p.x.toFixed(1)}, ${p.y.toFixed(1)})`));
}

// ── 场景2: 无障碍直线 ──
{
  const map = new HexMap();
  map.generate(9, 5, []);
  runScenario('场景2: 无障碍直线', map, map.getTile(1, 2), map.getTile(7, 2), false);
}

// ── 场景3: 单座山挡 1/3 处，需两次转向 ──
{
  const map = new HexMap();
  map.generate(9, 5, [{ q: 3, r: 2 }]);
  const s = runScenario('场景3: 单山阻挡', map, map.getTile(0, 2), map.getTile(6, 2), true);
  console.log('  平滑路径:');
  s.forEach((p, i) => console.log(`    [${i}] (${p.x.toFixed(1)}, ${p.y.toFixed(1)})`));
}

// ── 场景4: 交错双山墙(S形走廊，原始 A* 是锯齿穿行) ──
// q=3 列挡 r=0..2(下方缺口)，q=5 列挡 r=2..4(上方缺口) → 路径必须先下后上绕 S 形
{
  const map = new HexMap();
  const obstacles = [
    { q: 3, r: 0 }, { q: 3, r: 1 }, { q: 3, r: 2 },
    { q: 5, r: 2 }, { q: 5, r: 3 }, { q: 5, r: 4 },
  ];
  map.generate(9, 5, obstacles);
  const s = runScenario('场景4: 交错双山墙 S 形绕行', map, map.getTile(1, 2), map.getTile(7, 2), true);
  console.log('  平滑路径:');
  s.forEach((p, i) => console.log(`    [${i}] (${p.x.toFixed(1)}, ${p.y.toFixed(1)})`));
}

console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
process.exit(fail > 0 ? 1 : 0);
