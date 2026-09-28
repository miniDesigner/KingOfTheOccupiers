/**
 * 轨迹级复现：跑真实战斗模拟，检测「目标大本营已直线净空可见、队伍却在走别的方向」
 * 的持续时段 —— 对应用户抱怨「越过阻挡后不直线前往大本营，继续走一段才转弯」
 */
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
  const file = ROOT + String(path).replace('../', '');
  if (!existsSync(file)) return { ok: false, status: 404, json: async () => { throw new Error('404 ' + path); } };
  return { ok: true, status: 200, json: async () => JSON.parse(rf(file, 'utf-8')) };
};

const { default: ConfigLoader, syncConfigToStatics, getFlipCost, getFlipAnimationDuration } = await import('../src/config.js');
await ConfigLoader.init();
syncConfigToStatics();
try { await import('../src/data/races.js').then(m => m.syncRaces && m.syncRaces()); } catch (e) {}
try { await import('../src/data/levels.js').then(m => m.syncLevels && m.syncLevels()); } catch (e) {}

const { HexMap } = await import('../src/world/HexMap.js');
const { Player } = await import('../src/entity/Player.js');
const { AIPlayer } = await import('../src/entity/AIPlayer.js');
const { Building } = await import('../src/entity/Building.js');
const { MarchGroup } = await import('../src/entity/MarchGroup.js');
const { EconomySystem } = await import('../src/system/EconomySystem.js');
const { BuildSystem } = await import('../src/system/BuildSystem.js');
const { PathfindingSystem } = await import('../src/system/PathfindingSystem.js');
const { MarchSystem } = await import('../src/system/MarchSystem.js');
const { CombatSystem } = await import('../src/system/CombatSystem.js');
const { TowerSystem } = await import('../src/system/TowerSystem.js');
const { SynergySystem } = await import('../src/system/SynergySystem.js');
const { SkillSystem } = await import('../src/system/SkillSystem.js');
const { BOARD_LAYOUTS, buildBattleConfig } = await import('../src/data/levels.js');
const ProfileManager = await import('../src/meta/ProfileManager.js');
const DeploymentSys = await import('../src/meta/DeploymentSystem.js');
const { generateBundle } = DeploymentSys;
const { hexToPixel, axialToColRow } = await import('../src/world/HexMath.js');

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const args = process.argv.slice(2);
const LAYOUT_ID = args[0] || 'twin_canyon';
const SEED = parseInt(args[1] || '42', 10);
const layout = BOARD_LAYOUTS.find(l => l.id === LAYOUT_ID) || BOARD_LAYOUTS[0];

// ===== 复用 simulateGame 骨架 + 轨迹采样 =====
Math.random = mulberry32(SEED);
const cfg = buildBattleConfig(layout);
cfg.enemies[0].ai = 'normal';
SkillSystem.reset();
SkillSystem.setEnemyDifficulty('normal');

const map = new HexMap();
map.generate(cfg.cols, cfg.rows, cfg.obstacles);
map.ensureLevelOneAround(cfg.playerBase.q, cfg.playerBase.r, 3);

// fresh profile
const DEPLOY_CFG = ConfigLoader.get('deployables');
const DEFAULT_DEP = DEPLOY_CFG.defaultDeployment;
const profile = ProfileManager.get();
profile.collectedUnits = {};
for (const id of DEFAULT_DEP.units) if (id) profile.collectedUnits[id] = { level: 1, recruitCount: 0 };
profile.collectedSynergies = {};
for (const id of (DEFAULT_DEP.synergies || [])) if (id) profile.collectedSynergies[id] = { level: 1 };
profile.buildingUpgrades = { barracks: 1, arrow_tower: 1, gold_mine: 1 };
profile.deployment = {
  units: [...DEFAULT_DEP.units], synergies: [...(DEFAULT_DEP.synergies || [])],
  buildingUpgrades: { ...profile.buildingUpgrades },
};
const bundle = generateBundle();

const human = new Player(1, '玩家', '#3b82f6', false, 'normal');
human.gold = 150;
human.deploymentBundle = bundle;
human.deployedSynergies = bundle.synergies;
human.race = 'custom'; human.raceLineup = ['custom'];
const ai = new AIPlayer(cfg.enemies[0].id, '敌方', '#ef4444', 'normal');
ai.gold = 70; ai.race = cfg.enemies[0].race; ai.raceLineup = [ai.race];
const players = [human, ai];

const pbTile = map.getTile(cfg.playerBase.q, cfg.playerBase.r);
pbTile.owner = 1; pbTile.isFlipped = true;
pbTile.building = new Building('headquarters', 1, 'custom', 1, bundle);
human.setBase(pbTile);
const ebTile = map.getTile(cfg.enemyBase.q, cfg.enemyBase.r);
ebTile.owner = ai.id; ebTile.isFlipped = true;
ebTile.building = new Building('headquarters', 1, ai.race, ai.id);
ai.setBase(ebTile);

const goalPx = hexToPixel(ebTile.q, ebTile.r, map.size);
const obsCenters = MarchGroup._collectObstacleCenters(map);
const CLEAR = map.size * 0.9;
const TILE_PX = 1.5 * map.size;

const marchGroups = [];
const flippingTiles = [];
const gameState = { players, marchGroups, map };
let nextId = 1;

// 脚本化人类玩家(与 sim-balance-phase6 相同策略)
class ScriptedHuman {
  constructor(player, opts = {}) {
    this.player = player;
    this.interval = opts.interval ?? 2.6;
    this.mistakeRate = opts.mistakeRate ?? 0.12;
    this.noise = opts.noise ?? 0.35;
    this.timer = Math.random() * this.interval;
  }
  update(dt, ctx, flipCallback) {
    this.timer += dt;
    if (this.timer < this.interval) return;
    this.timer = 0;
    const { map } = ctx;
    const p = this.player;
    if (p.gold < 5) return;
    const candidates = map.getAdjacentUnflippedTiles(p.id);
    const affordable = candidates.filter(t => getFlipCost(t.presetBuilding) <= p.gold);
    if (affordable.length === 0) return;
    if (Math.random() < this.mistakeRate) {
      flipCallback(affordable[Math.floor(Math.random() * affordable.length)], p);
      return;
    }
    const enemies = ctx.players.filter(pl => pl.id !== p.id && pl.isAlive());
    const scored = affordable.map(tile => ({
      tile,
      score: this._scoreTile(tile, map, enemies) * (1 + (Math.random() * 2 - 1) * this.noise),
    }));
    scored.sort((a, b) => b.score - a.score);
    flipCallback(scored[0].tile, p);
  }
  _scoreTile(tile, hexMap, enemies) {
    const preset = tile.presetBuilding;
    if (!preset) return 0;
    let score = 0;
    if (preset.type === 'barracks') {
      score += 50 + (preset.level || 1) * 20;
      if ((preset.level || 1) >= 3) score += 30;
      if ((preset.level || 1) >= 4) score += 40;
    } else if (preset.type === 'gold_mine') {
      score += 20 + (this.player.gold < 30 ? 30 : 0) + ((preset.level || 1) === 2 ? 15 : 0);
    } else if (preset.type === 'arrow_tower') {
      score += 20;
    } else if (preset.type === 'random') {
      score += 15 + (this.player.gold < 20 ? 25 : 0) + 10;
    }
    return score;
  }
}
const humanPolicy = new ScriptedHuman(human);

const flipTile = (tile, player) => {
  if (BuildSystem.tryFlipTile(tile, player, map)) flippingTiles.push(tile);
};

// 轨迹记录: 每个队伍一个记录器
const records = [];
const dt = 0.2;
const MAX_T = 240;
const steps = Math.ceil(MAX_T / dt);
let anomalyTotal = 0;
const anomalies = [];

for (let step = 0; step < steps; step++) {
  const t = step * dt;
  for (let i = flippingTiles.length - 1; i >= 0; i--) {
    const tile = flippingTiles[i];
    const isRandom = tile.presetBuilding && tile.presetBuilding.type === 'random';
    if (isRandom && !tile.isRandomResult && tile.isFlipping >= 0.5) BuildSystem.rollRandomTile(tile, map);
    if (tile.updateFlip(dt, getFlipAnimationDuration())) {
      const owner = players.find(p => p.id === tile.owner);
      if (owner) BuildSystem.completeFlip(tile, owner, map);
      flippingTiles.splice(i, 1);
    }
  }
  EconomySystem.update(dt, players, map, marchGroups, PathfindingSystem);
  for (const g of marchGroups) if (!g._rec) {
    g._rec = { id: nextId++, owner: g.owner, spawn: { x: g.pixelX, y: g.pixelY }, samples: [], wp0: g.waypoints.map(w => ({ ...w })) };
    records.push(g._rec);
  }
  for (const player of players) SynergySystem.updatePlayerSynergies(player, map);
  SynergySystem.updateGroupSynergies(marchGroups, players, map);
  SkillSystem.update(dt, marchGroups, map, players);
  MarchSystem.update(dt, marchGroups, map, CombatSystem, players);
  TowerSystem.update(dt, players, map, marchGroups, CombatSystem);
  if (ai.isAlive() && ai.tick(dt)) ai.makeDecision(map, gameState, flipTile);
  if (human.isAlive()) humanPolicy.update(dt, gameState, flipTile);

  // ===== 采样: 记录位置 + 判定「目标可见但不朝目标走」 =====
  for (const g of marchGroups) {
    if (!g.isAlive() || !g._rec) continue;
    const targetPx = g.owner === 1 ? goalPx : hexToPixel(pbTile.q, pbTile.r, map.size); // 敌方目标是玩家基地
    const direct = MarchGroup._segmentClear({ x: g.pixelX, y: g.pixelY }, targetPx, obsCenters, CLEAR);
    // 行进方向: 指向下一路标
    let vx = 0, vy = 0;
    if (g.state === 'marching' && g.waypointIndex < g.waypoints.length) {
      const wp = g.waypoints[g.waypointIndex];
      vx = wp.x - g.pixelX; vy = wp.y - g.pixelY;
    }
    const distGoal = Math.hypot(targetPx.x - g.pixelX, targetPx.y - g.pixelY);
    let devAngle = null;
    if (direct && g.state === 'marching' && distGoal > 2 * TILE_PX && (vx || vy)) {
      const a1 = Math.atan2(vy, vx);
      const a2 = Math.atan2(targetPx.y - g.pixelY, targetPx.x - g.pixelX);
      let d = Math.abs(a1 - a2); if (d > Math.PI) d = 2 * Math.PI - d;
      devAngle = d;
      if (d > 0.4) { // >23°
        anomalyTotal++;
        g._rec.anomaly = (g._rec.anomaly || 0) + dt;
        if (!g._rec.anomalyStart) g._rec.anomalyStart = { t, x: g.pixelX, y: g.pixelY };
        g._rec.anomalyLast = { t, x: g.pixelX, y: g.pixelY, angle: d };
      } else if (g._rec.anomalyStart) {
        // 结束一段: 记录
        const dur = t - g._rec.anomalyStart.t;
        if (dur >= 1.0) anomalies.push({ gid: g._rec.id, owner: g.owner, ...g._rec.anomalyStart, endT: t, dur });
        g._rec.anomalyStart = null;
      }
    }
    g._rec.samples.push({ t, x: Math.round(g.pixelX), y: Math.round(g.pixelY), state: g.state, direct, dev: devAngle === null ? null : +(devAngle.toFixed(2)) });
  }

  for (let i = marchGroups.length - 1; i >= 0; i--) {
    const g = marchGroups[i];
    if (g.state === 'destroyed' || g.state === 'disbanded' || g.state === 'arrived') {
      if (g._rec && g._rec.anomalyStart) {
        const dur = t - g._rec.anomalyStart.t;
        if (dur >= 1.0) anomalies.push({ gid: g._rec.id, owner: g.owner, ...g._rec.anomalyStart, endT: t, dur });
      }
      marchGroups.splice(i, 1);
    }
  }
  if (!human.isAlive() || !ai.isAlive()) break;
}

console.log(`\n布局=${layout.id} seed=${SEED} | 队伍总数=${records.length} | 异常采样点=${anomalyTotal}`);
console.log(`「目标已直线可见但偏离>23°」持续≥1s 的事件: ${anomalies.length} 个`);
anomalies.sort((a, b) => b.dur - a.dur);
for (const a of anomalies.slice(0, 8)) {
  const rec = records.find(r => r.id === a.gid);
  const startCol = (px) => { const r = px.y / (1.5 * map.size); const q = px.x / (Math.sqrt(3) * map.size) - r / 2; return `(${(q + r / 2).toFixed(1)},${r.toFixed(1)})`; };
  console.log(`  队伍#${a.gid} owner=${a.owner} ${startCol(a)}→${a.endT ? '' : ''} 持续${a.dur.toFixed(1)}s [${a.t.toFixed(0)}s~${a.endT.toFixed(0)}s] 出发路标数=${rec.wp0.length}`);
  // 打印该队伍这段时间的轨迹与路标
  const seg = rec.samples.filter(s => s.t >= a.t - 1 && s.t <= a.endT + 1 && s.t % 1 < dt);
  const s0 = seg[0], s1 = seg[seg.length - 1];
  if (s0 && s1) {
    const fmt = (s) => { const r = s.y / (1.5 * map.size); const q = s.x / (Math.sqrt(3) * map.size) - r / 2; return `(${(q + r / 2).toFixed(1)},${r.toFixed(1)})`; };
    console.log(`    轨迹 ${fmt(s0)} → ${fmt(s1)} | 路标: ${rec.wp0.map(w => { const r = w.y / (1.5 * map.size); const q = w.x / (Math.sqrt(3) * map.size) - r / 2; return `(${(q + r / 2).toFixed(1)},${r.toFixed(1)})`; }).join(' ')}`);
  }
}

// ===== 玩家队伍路标转储 =====
console.log('\n===== 玩家(owner=1)队伍路标样例 =====');
const fmt2 = (w) => { const r = w.y / (1.5 * map.size); const q = w.x / (Math.sqrt(3) * map.size) - r / 2; return `(${(q + r / 2).toFixed(1)},${r.toFixed(1)})`; };
let shown = 0;
for (const rec of records) {
  if (rec.owner !== 1) continue;
  const last = rec.samples[rec.samples.length - 1];
  if (!last) continue;
  console.log(`队伍#${rec.id} 出发${fmt2(rec.spawn)} 终点${fmt2({ x: last.x, y: last.y })} 路标: ${rec.wp0.map(fmt2).join(' ')}`);
  if (++shown >= 14) break;
}
