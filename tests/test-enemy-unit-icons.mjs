// 测试: 敌方兵种图标表现（种族模式兵种由具体图标渲染，不再只有数值）
// 覆盖: races.json 24兵种 icon 配置 / 敌方兵营 unitData.icon / MarchGroup._unitIcon /
//       兵营地块渲染用兵种图标 / getUnitFullInfo 回退分支 / 渲染冒烟
const noop = () => {};
const canvasStub = { width: 400, height: 700, addEventListener: noop, removeEventListener: noop };
global.document = { getElementById: () => canvasStub, addEventListener: noop, removeEventListener: noop, body: { appendChild: noop }, hidden: false };
global.window = { innerWidth: 400, innerHeight: 700, requestAnimationFrame: () => 0, addEventListener: noop, removeEventListener: noop, AudioContext: class {} };
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

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; console.log(`  ✅ ${msg}`); }
  else { failed++; console.log(`  ❌ ${msg}`); }
}

const { default: ConfigLoader, syncConfigToStatics } = await import('../src/config.js');
await ConfigLoader.init();
syncConfigToStatics();
const { getRaces, getUnitFullInfo } = await import('../src/data/races.js');
const { Building } = await import('../src/entity/Building.js');
const { MarchGroup } = await import('../src/entity/MarchGroup.js');
const { HexMap } = await import('../src/world/HexMap.js');

const RACE_IDS = ['human', 'beast', 'undead', 'elf', 'dwarf', 'dragon'];
// 各族4级兵种图标互不相同（视觉可区分）
const EXPECTED = {
  human: ['🪖', '⚔', '🐎', '🛡'],
  beast: ['👹', '🪓', '🐗', '🦍'],
  undead: ['💀', '🧟', '🔮', '☠'],
  elf: ['🏹', '🎯', '🦌', '🌙'],
  dwarf: ['⛏', '🛡', '🔫', '👑'],
  dragon: ['🔥', '🦎', '🐉', '🌋'],
};

console.log('=== 测试1: races.json 24兵种全部配置 icon ===');
{
  let ok = true;
  for (const rid of RACE_IDS) {
    const units = getRaces()[rid].units;
    for (let lv = 1; lv <= 4; lv++) {
      const u = units[String(lv)];
      if (!u.icon) { ok = false; console.log(`    ${rid} Lv${lv} 无icon`); }
      if (u.icon !== EXPECTED[rid][lv - 1]) { ok = false; console.log(`    ${rid} Lv${lv} icon=${u.icon}`); }
    }
  }
  assert(ok, '6种族×4等级=24兵种 icon 全部存在且符合预期');
}

console.log('=== 测试2: 同族各级兵种图标互不相同 ===');
{
  let ok = true;
  for (const rid of RACE_IDS) {
    const icons = EXPECTED[rid];
    if (new Set(icons).size !== 4) { ok = false; console.log(`    ${rid} 图标重复`); }
  }
  assert(ok, '每族 4 个图标无重复');
}

console.log('=== 测试3: 敌方兵营（种族模式）unitData 携带 icon/name ===');
{
  const map = new HexMap();
  map.generate(7, 5, []);
  const tile = map.getTile(0, 0);
  let ok = true;
  for (const rid of RACE_IDS) {
    for (let lv = 1; lv <= 4; lv++) {
      const b = new Building('barracks', lv, rid, 2); // owner=2 敌方
      if (!b.unitData) { ok = false; console.log(`    ${rid} Lv${lv} unitData null`); continue; }
      if (!b.unitData.icon) { ok = false; console.log(`    ${rid} Lv${lv} unitData.icon 空`); }
      if (b.unitData.name !== getRaces()[rid].units[String(lv)].name) { ok = false; console.log(`    ${rid} Lv${lv} name 不符`); }
    }
  }
  assert(ok, '敌方兵营 unitData.icon/name 全部就位');
}

console.log('=== 测试4: 敌方 MarchGroup._unitIcon 非空（行军队伍显示兵种图标） ===');
{
  const map = new HexMap();
  map.generate(7, 5, []);
  const tile = map.getTile(0, 0);
  let ok = true;
  for (const rid of RACE_IDS) {
    const b = new Building('barracks', 3, rid, 2);
    const g = new MarchGroup(2, 50, b, tile);
    if (!g._unitIcon) { ok = false; console.log(`    ${rid} MarchGroup._unitIcon 空`); }
    if (g._unitIcon && g._unitIcon !== EXPECTED[rid][2]) { ok = false; console.log(`    ${rid} icon=${g._unitIcon}`); }
    if (g._unitName !== getRaces()[rid].units['3'].name) { ok = false; console.log(`    ${rid} _unitName=${g._unitName}`); }
  }
  assert(ok, '敌方行军队伍全部携带具体兵种图标（Lv3 兽王=🐗 等）');
}

console.log('=== 测试5: getUnitFullInfo 回退分支同样有 icon ===');
{
  const map = new HexMap();
  map.generate(7, 5, []);
  let ok = true;
  for (const rid of RACE_IDS) {
    const info = getUnitFullInfo(rid, 4);
    if (!info || !info.icon) { ok = false; console.log(`    ${rid} Lv4 回退信息无icon`); }
  }
  // 构造无 unitData 的建筑模拟回退路径（理论上现版本兵营都有 unitData，此处验证数据层完备）
  assert(ok, 'getUnitFullInfo(race, level).icon 全部可用');
}

console.log('=== 测试6: 渲染冒烟（敌我行军队伍 + 兵营地块） ===');
{
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
  const { RenderSystem } = await import('../src/system/RenderSystem.js');
  const rs = new RenderSystem(ctxProxy, 400, 700);
  const map = new HexMap();
  map.generate(7, 5, []);
  // 敌方兵营直接放地图上（矩形棋盘第2行，q∈[-1,5]，对应列1~4）
  for (let lv = 1; lv <= 4; lv++) {
    const t = map.getTile(lv - 2, 2);
    t.building = new Building('barracks', lv, 'beast', 2);
    t.owner = 2; t.isFlipped = true;
  }
  const players = [
    { id: 1, color: '#3b82f6', isAlive: () => true },
    { id: 2, color: '#ef4444', isAlive: () => true },
  ];
  // 渲染层视角状态（非镜像：沿用 player.color 的既有行为）
  const gs = { players, mirrorWorld: false, localPlayerId: 1 };
  let ok = true;
  try {
    for (const t of map.getAllTiles()) {
      if (t.isFlipped && t.building) {
        const { x, y } = map.hexToPixel(t.q, t.r);
        rs.drawFlippedTile(t, x, y, map, gs);
      }
    }
    // 敌方行军队伍渲染
    const groups = [];
    for (const rid of RACE_IDS) {
      const b = new Building('barracks', 2, rid, 2);
      const g = new MarchGroup(2, 60, b, map.getTile(0, 0));
      const { x, y } = map.hexToPixel(0, 0);
      g.pixelX = x; g.pixelY = y;
      groups.push(g);
    }
    rs.drawMarchGroups(groups, map, gs);
  } catch (e) { ok = false; console.log('    渲染异常:', e.message); }
  assert(ok, '6族敌方兵营地块 + 行军队伍渲染无异常');
}

console.log(`\n========== 结果: ${passed} 通过, ${failed} 失败 ==========`);
process.exit(failed > 0 ? 1 : 0);
