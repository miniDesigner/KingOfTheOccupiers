// Phase 6 数值平衡无头模拟器
// 复用真实游戏系统代码（HexMap/Player/AIPlayer/Building/Economy/Synergy/March/Tower/Combat），
// 脚本化人类玩家策略模拟普通玩家，批量统计 难度×地图 的胜率/时长/经济曲线。
//
// 用法:
//   node tests/sim-balance-phase6.mjs                                    # 默认: 4难度×5地图
//   node tests/sim-balance-phase6.mjs --games 30 --seed 12345
//   node tests/sim-balance-phase6.mjs --diffs easy,nightmare --maps plains
//   node tests/sim-balance-phase6.mjs --tier                              # 40兵种强度排行
//   node tests/sim-balance-phase6.mjs --profile mid                       # 玩家进度 fresh/mid/late

const noop = () => {};
const canvasStub = { width: 400, height: 700, addEventListener: noop, removeEventListener: noop };
global.document = { getElementById: () => canvasStub, addEventListener: noop, removeEventListener: noop, body: { appendChild: noop }, hidden: false };
global.window = { innerWidth: 400, innerHeight: 700, requestAnimationFrame: () => 0, addEventListener: noop, removeEventListener: noop, AudioContext: class {} };
global.requestAnimationFrame = () => 0;
global.localStorage = { _d: {}, getItem(k) { return this._d[k] ?? null; }, setItem(k, v) { this._d[k] = String(v); }, removeItem(k) { delete this._d[k]; } };
global.wx = {};
global.performance = { now: () => Date.now() };
global.alert = noop;
const { readFileSync: rf, existsSync, writeFileSync } = await import('node:fs');
const { fileURLToPath: fURL } = await import('node:url');
const ROOT = fURL(new URL('..', import.meta.url));
global.fetch = async (path) => {
  const file = ROOT + path.replace('../', '');
  if (!existsSync(file)) return { ok: false, status: 404, json: async () => { throw new Error('404 ' + path); } };
  return { ok: true, status: 200, json: async () => JSON.parse(rf(file, 'utf-8')) };
};

// ========== 命令行参数 ==========
const args = process.argv.slice(2);
function argOf(name, def) {
  const i = args.indexOf('--' + name);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
}
const OPT = {
  games: parseInt(argOf('games', '20'), 10),       // 每个组合的局数
  seed: parseInt(argOf('seed', '20260829'), 10),   // 基础随机种子
  diffs: (argOf('diffs', 'easy,normal,hard,nightmare')).split(','),
  maps: (argOf('maps', 'all')).split(','),
  profile: argOf('profile', 'fresh'),              // 玩家进度档位
  tier: args.includes('--tier'),                   // 兵种强度排行模式
  maxTime: parseInt(argOf('maxtime', '600'), 10),  // 单局超时(游戏秒)
  verbose: args.includes('--verbose'),
};
if (OPT.maps[0] === 'all') OPT.maps = null; // null = 全部

// ========== 可复现 PRNG (mulberry32) ==========
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ========== 初始化配置与游戏系统 ==========
const { default: ConfigLoader, syncConfigToStatics, getFlipCost, getFlipAnimationDuration } = await import('../src/config.js');
await ConfigLoader.init();
syncConfigToStatics();
try { await import('../src/data/races.js').then(m => m.syncRaces && m.syncRaces()); } catch (e) { /* races 可能已由 statics 同步 */ }
try { await import('../src/data/levels.js').then(m => m.syncLevels && m.syncLevels()); } catch (e) { /* 同上 */ }

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
const { generateBundle, getUnitStats, UPGRADE_COST_GROWTH } = DeploymentSys;

const DEPLOY_CFG = ConfigLoader.get('deployables');
const DEFAULT_DEP = DEPLOY_CFG.defaultDeployment;

// ========== 玩家进度档位（模拟不同阶段的账号） ==========
// 兵种等级与技能解锁轴耦合: Lv1=仅3蓝 / Lv6+紫1 / Lv12+紫2 / Lv18+橙主动
const PROFILE_PRESETS = {
  // 新号: 默认上阵，兵种全部1级（仅蓝色被动）
  fresh: { unitLevel: 1, deployUnits: DEFAULT_DEP.units, synLevel: 1, bldLevel: 1 },
  // 中期: 兵种8级（3蓝+紫1），羁绊3级，建筑2级
  mid: { unitLevel: 8, deployUnits: DEFAULT_DEP.units, synLevel: 3, bldLevel: 2 },
  // 后期: 兵种20级满级（全技能含橙色主动），羁绊5级，建筑满级
  late: { unitLevel: 20, deployUnits: DEFAULT_DEP.units, synLevel: 5, bldLevel: 3 },
};

function setupProfile(presetName) {
  const preset = PROFILE_PRESETS[presetName] || PROFILE_PRESETS.fresh;
  const profile = ProfileManager.get();
  profile.collectedUnits = {};
  for (const id of preset.deployUnits) {
    if (id) profile.collectedUnits[id] = { level: preset.unitLevel, recruitCount: 0 };
  }
  profile.collectedSynergies = {};
  for (const id of (DEFAULT_DEP.synergies || [])) {
    if (id) profile.collectedSynergies[id] = { level: preset.synLevel };
  }
  profile.buildingUpgrades = {
    barracks: Math.min(preset.bldLevel, 4),
    arrow_tower: Math.min(preset.bldLevel, 3),
    gold_mine: Math.min(preset.bldLevel, 3),
  };
  profile.deployment = {
    units: [...preset.deployUnits],
    synergies: [...(DEFAULT_DEP.synergies || [])],
    buildingUpgrades: { ...profile.buildingUpgrades },
  };
  return generateBundle();
}

// ========== 脚本化人类玩家策略 ==========
// 模拟普通玩家：决策间隔略慢于 normal AI，评估同 normal 档但噪声更大、偶发失误
class ScriptedHuman {
  constructor(player, opts = {}) {
    this.player = player;
    this.interval = opts.interval ?? 2.6;      // 普通玩家操作节奏
    this.mistakeRate = opts.mistakeRate ?? 0.12; // 12%随机点（人类随手翻格）
    this.noise = opts.noise ?? 0.35;           // 评分扰动幅度
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

    // 偶发失误：随机翻格
    if (Math.random() < this.mistakeRate) {
      flipCallback(affordable[Math.floor(Math.random() * affordable.length)], p);
      return;
    }

    // 评分（≈normal AI 的 evaluateAction，加更大噪声）
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

// ========== 单局模拟 ==========
function simulateGame({ layout, difficulty, seed, presetName, dt = 0.2 }) {
  Math.random = mulberry32(seed); // 每局独立可复现随机流

  // 构建战斗配置（复用 levels.js，强制难度）
  const cfg = buildBattleConfig(layout);
  const baseGold = { easy: 50, normal: 70, hard: 90, nightmare: 180 }[difficulty];
  cfg.enemies[0].ai = difficulty;
  cfg.enemies[0].initialGold = baseGold;
  // 技能系统: 敌方技能解锁档位跟随难度（与 Game.initBattle 行为一致）
  SkillSystem.reset();
  SkillSystem.setEnemyDifficulty(difficulty);

  // 地图
  const map = new HexMap();
  map.generate(cfg.cols, cfg.rows, cfg.obstacles);
  map.ensureLevelOneAround(cfg.playerBase.q, cfg.playerBase.r, 3);

  EconomySystem.resetRecruitLog();

  // 玩家（上阵系统 + 局外加成默认关闭，Profile preset 控制进度）
  const bundle = setupProfile(presetName);
  const human = new Player(1, '玩家', '#3b82f6', false, 'normal');
  human.gold = 150;
  human.deploymentBundle = bundle;
  human.deployedSynergies = bundle.synergies;
  human.race = 'custom';
  human.raceLineup = ['custom'];

  // 敌方AI
  const ecfg = cfg.enemies[0];
  const ai = new AIPlayer(ecfg.id, ecfg.name, '#ef4444', difficulty);
  ai.gold = ecfg.initialGold;
  ai.race = ecfg.race;
  ai.raceLineup = [ecfg.race];

  const players = [human, ai];

  // 大本营
  const pbTile = map.getTile(cfg.playerBase.q, cfg.playerBase.r);
  pbTile.owner = 1; pbTile.isFlipped = true;
  pbTile.building = new Building('headquarters', 1, 'custom', 1, bundle);
  human.setBase(pbTile);

  const ebTile = map.getTile(cfg.enemyBase.q, cfg.enemyBase.r);
  ebTile.owner = ai.id; ebTile.isFlipped = true;
  ebTile.building = new Building('headquarters', 1, ai.race, ai.id);
  ai.setBase(ebTile);

  // 模拟环境（PathfindingSystem 的 findPath 为静态方法，直接传类）
  const pathfinding = PathfindingSystem;
  const marchGroups = [];
  const flippingTiles = [];
  const humanPolicy = new ScriptedHuman(human);
  const gameState = { players, marchGroups, map };

  // 统计
  const stats = {
    result: 'timeout', duration: OPT.maxTime,
    humanTiles: 0, aiTiles: 0,
    humanGoldEarned: 0, aiGoldEarned: 0,
    humanBarracks: 0, aiBarracks: 0,
    humanGroupsSpawned: 0, aiGroupsSpawned: 0,
  };
  const humanGold0 = human.gold, aiGold0 = ai.gold;
  let groupsSeen = 0;

  const flipTile = (tile, player) => {
    if (BuildSystem.tryFlipTile(tile, player, map)) flippingTiles.push(tile);
  };

  const steps = Math.ceil(OPT.maxTime / dt);
  for (let step = 0; step < steps; step++) {
    const t = step * dt;

    // 1. 翻转动画
    for (let i = flippingTiles.length - 1; i >= 0; i--) {
      const tile = flippingTiles[i];
      const isRandom = tile.presetBuilding && tile.presetBuilding.type === 'random';
      if (isRandom && !tile.isRandomResult && tile.isFlipping >= 0.5) {
        BuildSystem.rollRandomTile(tile, map);
      }
      if (tile.updateFlip(dt, getFlipAnimationDuration())) {
        const owner = players.find(p => p.id === tile.owner);
        if (owner) BuildSystem.completeFlip(tile, owner, map);
        flippingTiles.splice(i, 1);
      }
    }

    // 2. 经济
    EconomySystem.update(dt, players, map, marchGroups, pathfinding);
    if (marchGroups.length > groupsSeen) {
      const spawned = marchGroups.filter(g => !g._simCounted);
      for (const g of spawned) { g._simCounted = 1; if (g.owner === 1) stats.humanGroupsSpawned++; else stats.aiGroupsSpawned++; }
      groupsSeen = marchGroups.length;
    }

    // 3. 羁绊
    for (const player of players) SynergySystem.updatePlayerSynergies(player, map);
    SynergySystem.updateGroupSynergies(marchGroups, players, map);

    // 3b. 技能（主动冷却/释放，与 Game.update 同序: 羁绊后、行军前；召唤会 push 新队伍）
    SkillSystem.update(dt, marchGroups, map, players);

    // 4. 行军 + 战斗
    MarchSystem.update(dt, marchGroups, map, CombatSystem, players);

    // 5. 箭塔
    TowerSystem.update(dt, players, map, marchGroups, CombatSystem);

    // 6. AI决策
    if (ai.isAlive() && ai.tick(dt)) {
      ai.makeDecision(map, gameState, flipTile);
    }
    // 6b. 脚本化人类决策
    if (human.isAlive()) {
      humanPolicy.update(dt, gameState, flipTile);
    }

    // 7. 清理死亡队伍
    for (let i = marchGroups.length - 1; i >= 0; i--) {
      const g = marchGroups[i];
      if (g.state === 'destroyed' || g.state === 'disbanded' || g.state === 'arrived') marchGroups.splice(i, 1);
    }

    // 8. 胜负
    if (!human.isAlive()) { stats.result = 'lost'; stats.duration = t; break; }
    if (!ai.isAlive()) { stats.result = 'won'; stats.duration = t; break; }
  }

  // 终局统计
  stats.humanTiles = map.getTilesByOwner(1).length;
  stats.aiTiles = map.getTilesByOwner(ai.id).length;
  stats.humanGoldEarned = Math.round(human.gold - humanGold0 + (human.totalSpent || 0));
  stats.aiGoldEarned = Math.round(ai.gold - aiGold0 + (ai.totalSpent || 0));
  const humanTiles = map.getTilesByOwner(1);
  stats.humanBarracks = humanTiles.filter(t => t.building && t.building.type === 'barracks').length;
  stats.aiBarracks = map.getTilesByOwner(ai.id).filter(t => t.building && t.building.type === 'barracks').length;

  // 羁绊触发采样（终局时刻）
  stats.humanSyn = human.activeSynergies
    ? (Object.entries(human.activeSynergies).map(([id, s]) => `${id}:T${s.tier}`).join(',') || '-')
    : '-';
  const aiSynKeys = Object.keys(ai).filter(k => /syn/i.test(k));
  stats.aiSyn = aiSynKeys.map(k => {
    const v = ai[k];
    if (!v || typeof v !== 'object') return '';
    return Object.entries(v).map(([id, s]) => `${id}:T${s.tier ?? '?'}`).join(',');
  }).filter(Boolean).join('|') || '-';

  return stats;
}

// ========== 聚合 ==========
function pct(n, d) { return d ? (100 * n / d).toFixed(1) + '%' : '-'; }
function avg(arr) { return arr.length ? (arr.reduce((a, b) => a + b, 0) / arr.length) : 0; }

function runMatrix() {
  const layouts = OPT.maps ? BOARD_LAYOUTS.filter(l => OPT.maps.includes(l.id)) : BOARD_LAYOUTS;
  if (layouts.length === 0) { console.error('未找到地图: ' + OPT.maps.join(',')); process.exit(1); }
  const combos = [];
  for (const d of OPT.diffs) for (const l of layouts) combos.push({ diff: d, layout: l });

  console.log(`\n=== Phase 6 对战模拟 baseline ===`);
  console.log(`进度档位: ${OPT.profile} | 每组局数: ${OPT.games} | 超时: ${OPT.maxTime}s | dt=0.2 | seed base: ${OPT.seed}\n`);

  const globalResults = [];
  for (const { diff, layout } of combos) {
    const rec = { games: 0, won: 0, lost: 0, timeout: 0, durations: [], hTiles: [], aTiles: [], hBarracks: [], aBarracks: [], hGold: [], aGold: [], hGroups: [], aGroups: [] };
    for (let i = 0; i < OPT.games; i++) {
      const seed = OPT.seed + hashCombo(diff, layout.id, i);
      const st = simulateGame({ layout, difficulty: diff, seed, presetName: OPT.profile });
      rec.games++;
      if (st.result === 'won') rec.won++;
      else if (st.result === 'lost') rec.lost++;
      else rec.timeout++;
      rec.durations.push(st.duration);
      rec.hTiles.push(st.humanTiles); rec.aTiles.push(st.aiTiles);
      rec.hBarracks.push(st.humanBarracks); rec.aBarracks.push(st.aiBarracks);
      rec.hGold.push(st.humanGoldEarned); rec.aGold.push(st.aiGoldEarned);
      rec.hGroups.push(st.humanGroupsSpawned); rec.aGroups.push(st.aiGroupsSpawned);
      globalResults.push({ diff, layout: layout.id, ...st });
      if (OPT.verbose) console.log(`  [${diff}/${layout.id} #${i}] ${st.result} @${st.duration.toFixed(0)}s 玩家${st.humanTiles}格/AI${st.aiTiles}格 兵营${st.humanBarracks}/${st.aiBarracks}`);
    }
    console.log(
      `${(diff + '').padEnd(10)} ${layout.id.padEnd(12)} 胜率${pct(rec.won, rec.games).padStart(6)}  负${pct(rec.lost, rec.games).padStart(6)}  超时${pct(rec.timeout, rec.games).padStart(6)}` +
      `  时长${avg(rec.durations).toFixed(0).padStart(3)}s  领地${avg(rec.hTiles).toFixed(1)}/${avg(rec.aTiles).toFixed(1)}` +
      `  兵营${avg(rec.hBarracks).toFixed(1)}/${avg(rec.aBarracks).toFixed(1)}  编组${avg(rec.hGroups).toFixed(1)}/${avg(rec.aGroups).toFixed(1)}`
    );
  }

  // 难度汇总（聚合已有结果，不重跑）
  console.log('');
  for (const d of OPT.diffs) {
    const rs = globalResults.filter(r => r.diff === d);
    if (!rs.length) continue;
    const won = rs.filter(r => r.result === 'won').length;
    const lost = rs.filter(r => r.result === 'lost').length;
    console.log(
      `${d.padEnd(10)} ${'(汇总)'.padEnd(12)} 胜率${pct(won, rs.length).padStart(6)}  负${pct(lost, rs.length).padStart(6)}  超时${pct(rs.length - won - lost, rs.length).padStart(6)}` +
      `  时长${avg(rs.map(r => r.duration)).toFixed(0).padStart(3)}s`
    );
  }

  // 地图间差异（normal 难度汇总）
  if (!OPT.maps && OPT.diffs.includes('normal')) {
    console.log('\n--- 地图适配性(normal) ---');
    for (const l of BOARD_LAYOUTS) {
      const rs = globalResults.filter(r => r.layout === l.id && r.diff === 'normal');
      if (!rs.length) continue;
      const won = rs.filter(r => r.result === 'won').length;
      console.log(`${l.name.padEnd(6)}(${l.id.padEnd(11)}) 胜率${pct(won, rs.length).padStart(6)}  时长${avg(rs.map(r => r.duration)).toFixed(0)}s  领地${avg(rs.map(r => r.humanTiles)).toFixed(1)}`);
    }
  }

  // 保存明细
  writeFileSync(ROOT + 'tests/sim-results-phase6.json', JSON.stringify({ opt: OPT, results: globalResults }, null, 2));
  console.log('\n明细已写入 tests/sim-results-phase6.json');
}

function hashCombo(diff, mapId, i) {
  let h = 2166136261;
  const s = diff + '|' + mapId + '|' + i;
  for (let c = 0; c < s.length; c++) { h ^= s.charCodeAt(c); h = Math.imul(h, 16777619); }
  return (h >>> 0) % 1000000;
}

// ========== 40兵种强度排行（复用真实战斗判定） ==========
function runTierAnalysis() {
  const unitIds = Object.keys(DEPLOY_CFG.units);
  console.log(`\n=== 40兵种强度排行（真实战斗判定 round-robin）===`);
  console.log(`等级1 与 等级10 两档；每对打1场（含远程无损规则、射程差修正、战力五档结算）\n`);

  for (const level of [1, 10]) {
    const pA = new Player(1, 'A', '#3b82f6', false, 'normal');
    const pB = new Player(2, 'B', '#ef4444', false, 'normal');
    const wins = {}, power = {};
    for (const id of unitIds) { wins[id] = 0; }

    for (let i = 0; i < unitIds.length; i++) {
      for (let j = 0; j < unitIds.length; j++) {
        if (i === j) continue;
        const a = unitIds[i], b = unitIds[j];
        const gA = makeCombatGroup(1, a, level);
        const gB = makeCombatGroup(2, b, level);
        power[a] = gA.getPower();
        CombatSystem.resolveWarriorCombat(gA, gB, [pA, pB]);
        const aAlive = gA.warriors > 0, bAlive = gB.warriors > 0;
        if (aAlive && !bAlive) wins[a]++;
        else if (!aAlive && bAlive) wins[b]++;
        // 两败/两存 → 不计分
      }
    }

    const rows = unitIds.map(id => ({
      id, name: DEPLOY_CFG.units[id].name, q: DEPLOY_CFG.units[id].quality,
      styles: (DEPLOY_CFG.units[id].combatStyles || []).join('+'),
      range: DEPLOY_CFG.units[id].attackRange ?? 1,
      prod: DEPLOY_CFG.units[id].productionSpeed ?? 1,
      win: wins[id], power: Math.round(power[id] * 10) / 10,
      surv: wins[id] / (2 * (unitIds.length - 1)),
    }));
    rows.sort((x, y) => y.win - x.win);
    console.log(`--- Lv${level} ---`);
    for (const r of rows) {
      const flag = (r.surv > 0.9 ? ' ⚠过强' : r.surv < 0.2 ? ' ⚠过弱' : '');
      console.log(`${String(r.win).padStart(2)}/${2 * (unitIds.length - 1)}胜 ${r.id.padEnd(16)} ${r.name.padEnd(8)} Q${r.q} ${r.styles.padEnd(10)} 射程${r.range} 产速${r.prod.toFixed(2)} 战力${r.power}${flag}`);
    }
    console.log('');
  }
}

function makeCombatGroup(owner, unitId, level) {
  const stats = getUnitStats(unitId, level);
  const sb = {
    attackBonus: 0, unitType: stats.combatStyles[0] || '步兵', race: 'human',
    combatStyles: stats.combatStyles, level,
    unitData: {
      speedCoeff: stats.speedCoeff, hpCoeff: stats.hpCoeff, attackCoeff: stats.attackCoeff,
      quality: stats.quality, qualityMultiplier: stats.qualityMultiplier,
      attackRange: stats.attackRange, unitId, icon: stats.icon, name: stats.name,
      combatStyles: stats.combatStyles,
    },
  };
  const g = new MarchGroup(owner, 100, sb, { q: 0, r: 0 });
  g.pixelX = 100; g.pixelY = 100;
  return g;
}

// ========== 抽卡经济模拟（复用真实 gachaDraw/gachaMultiDraw/Profile） ==========
function runGachaAnalysis() {
  Math.random = mulberry32(OPT.seed);
  const totalUnits = Object.keys(DEPLOY_CFG.units).length;
  const ROUNDS = parseInt(argOf('rounds', '300'), 10); // 十连次数

  console.log(`\n=== 抽卡经济模拟（${ROUNDS}次十连 = ${ROUNDS * 10}抽，复用真实抽卡代码）===\n`);

  // 模拟 N 个平行账号（观察全收集节奏的分布）
  const ACCOUNTS = 20;
  const fullCollectDraws = [];
  const q4FirstDraws = [];
  let overallQuality = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };
  let overallDup = 0, overallNew = 0, overallStardust = 0, overallRecruit = 0;

  for (let acc = 0; acc < ACCOUNTS; acc++) {
    Math.random = mulberry32(OPT.seed + acc * 7919);
    // 新号
    const profile = ProfileManager.reset();
    profile.addCurrency('gold', 1000000);
    profile.collectedUnits = {};
    profile.gachaPityCount = 0;

    let draws = 0, q4First = -1, fullCollectAt = -1;
    for (let round = 0; round < ROUNDS; round++) {
      const res = DeploymentSys.gachaMultiDraw();
      if (!res.success) { console.error('抽卡失败:', res.reason); break; }
      for (const r of res.results) {
        draws++;
        overallQuality[r.quality]++;
        if (r.quality >= 4 && q4First < 0) q4First = draws;
        if (r.isNew) overallNew++; else { overallDup++; }
        if (r.duplicateReward) {
          overallStardust += r.duplicateReward.stardust;
          overallRecruit += r.duplicateReward.recruit;
        }
      }
      if (fullCollectAt < 0 && Object.keys(profile.collectedUnits).length >= totalUnits) {
        fullCollectAt = draws;
      }
    }
    fullCollectDraws.push(fullCollectAt < 0 ? '>' + ROUNDS * 10 : fullCollectAt);
    q4FirstDraws.push(q4First);
  }

  const totalDraws = Object.values(overallQuality).reduce((a, b) => a + b, 0);
  console.log(`账号数: ${ACCOUNTS} | 每号 ${ROUNDS}次十连`);
  console.log(`\n品质实际分布（含保底）:`);
  const THEORY = { 1: 40, 2: 25, 3: 18, 4: 10, 5: 5, 6: 2 };
  for (const q of [1, 2, 3, 4, 5, 6]) {
    const actual = (100 * overallQuality[q] / totalDraws).toFixed(2);
    console.log(`  Q${q}: ${actual.padStart(6)}%  (理论 ${THEORY[q]}%)`);
  }
  console.log(`\n新兵/重复: 新${overallNew} 重复${overallDup} 重复率${(100 * overallDup / totalDraws).toFixed(1)}%`);
  console.log(`重复转化累计: 星尘+${overallStardust} 招募+${overallRecruit}`);
  console.log(`每抽期望: 星尘${(overallStardust / totalDraws).toFixed(2)} 招募${(overallRecruit / totalDraws).toFixed(2)}`);
  console.log(`\n首个Q4+出现: 平均第${avg(q4FirstDraws).toFixed(1)}抽（保底10抽内）`);
  const solved = fullCollectDraws.filter(v => typeof v === 'number');
  console.log(`全收集(${totalUnits}兵)所需抽数: ${solved.length}/${ACCOUNTS}号达成, 达成者中位数 ${solved.length ? median(solved).toFixed(0) : '-'} 抽`);
  console.log(`  明细: ${fullCollectDraws.join(', ')}`);

  // 经济循环账（以 normal 难度 55% 胜率计）
  console.log(`\n=== 金币/星尘经济循环账 ===`);
  const winRate = 0.58, winGold = 100, loseGold = 22.5, winDust = 4, loseDust = 1;
  const goldPerGame = winRate * winGold + (1 - winRate) * loseGold;
  const dustPerGame = winRate * winDust + (1 - winRate) * loseDust;
  console.log(`每局期望(normal 58%胜率): 金币+${goldPerGame.toFixed(0)} 星尘+${dustPerGame.toFixed(1)}`);
  console.log(`十连(900金) = ${(900 / goldPerGame).toFixed(1)}局 | 单抽(100金) = ${(100 / goldPerGame).toFixed(1)}局`);
  console.log(`抽卡期望星尘回收: 每抽${(overallStardust / totalDraws).toFixed(2)} → 十连约${(overallStardust / totalDraws * 10).toFixed(1)}星尘`);

  // 升级成本采样（upgradeCost/unlockCost 为 {gold, stardust} 对象）
  console.log(`\n兵种解锁/满级(10级)成本采样（成本 ×1.35^(lv-1)）:`);
  for (const uid of ['swordsman', 'knight', 'paladin', 'archdragon']) {
    const u = DEPLOY_CFG.units[uid];
    const c0 = u.upgradeCost || { gold: 0, stardust: 0 };
    let gold = 0, dust = 0;
    for (let lv = 1; lv < 10; lv++) {
      gold += Math.floor((c0.gold || 0) * Math.pow(UPGRADE_COST_GROWTH, lv - 1));
      dust += Math.floor((c0.stardust || 0) * Math.pow(UPGRADE_COST_GROWTH, lv - 1));
    }
    const ul = u.unlockCost || { gold: 0, stardust: 0 };
    console.log(`  ${u.name.padEnd(6)} Q${u.quality} 解锁${ul.stardust || 0}尘${ul.gold || 0}金 | 升满另需 ${dust}尘 ${gold}金`);
  }
  // 全阵容升满总账（默认6兵 + 羁绊）
  let allGold = 0, allDust = 0;
  for (const uid of DEFAULT_DEP.units) {
    if (!uid) continue;
    const u = DEPLOY_CFG.units[uid];
    const c0 = u.upgradeCost || { gold: 0, stardust: 0 };
    for (let lv = 1; lv < 10; lv++) {
      allGold += Math.floor((c0.gold || 0) * Math.pow(UPGRADE_COST_GROWTH, lv - 1));
      allDust += Math.floor((c0.stardust || 0) * Math.pow(UPGRADE_COST_GROWTH, lv - 1));
    }
  }
  console.log(`  → 默认阵容6兵全升满: ${allDust}星尘 + ${allGold}金币`);
  console.log(`  → 以每局2.7尘计需 ${Math.round(allDust / 2.7)} 局; 以每抽回收27.6尘计需 ${Math.round(allDust / 27.6)} 抽(=${Math.round(allDust / 27.6 / 10)}次十连=${Math.round(allDust / 27.6 * 900)}金)`);
}

function median(arr) {
  const s = [...arr].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
}

// ========== 入口 ==========
if (OPT.tier) {
  runTierAnalysis();
} else if (args.includes('--gacha')) {
  runGachaAnalysis();
} else {
  await runMatrix();
}
