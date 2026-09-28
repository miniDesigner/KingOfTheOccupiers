// P0 确定性改造自证测试（帧同步 / Lockstep 基础）
//
// 验证核心命题：同一对局种子 + 相同命令序列 → 完全一致的战斗结果。
// 覆盖三个层面：
//   1. 单元层：createRng / battleRandom / weightedRandom / randomChoice 的种子确定性
//   2. 配置层：getRandomBattleConfig / getTierAiSettings / generateAiDeployment 同种子确定性
//   3. 集成层：无头跑一局完整战斗（地图生成 + AI 决策 + 行军 + 遭遇战 + 箭塔），
//      记录人类命令序列后用同种子回放，断言终局状态逐字段一致
//
// 用法: node tests/test-determinism.mjs

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

// ========== 断言工具 ==========
let pass = 0, fail = 0;
function ok(cond, msg) { if (cond) { pass++; } else { fail++; console.error('  ✗ FAIL:', msg); } }
function eq(a, b, msg) { ok(a === b, `${msg} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`); }

// ========== 初始化配置与游戏系统 ==========
const { default: ConfigLoader, syncConfigToStatics, getFlipCost, getFlipAnimationDuration } = await import('../src/config.js');
await ConfigLoader.init();
syncConfigToStatics();
try { await import('../src/data/races.js').then(m => m.syncRaces && m.syncRaces()); } catch (e) {}
try { await import('../src/data/levels.js').then(m => m.syncLevels && m.syncLevels()); } catch (e) {}

const { createRng, setBattleRng, battleRandom, isDeterministic } = await import('../src/utils/rng.js');
const { weightedRandom, randomChoice } = await import('../src/utils/math.js');
const { HexMap } = await import('../src/world/HexMap.js');
const { Player } = await import('../src/entity/Player.js');
const { AIPlayer } = await import('../src/entity/AIPlayer.js');
const { Building } = await import('../src/entity/Building.js');
const { EconomySystem } = await import('../src/system/EconomySystem.js');
const { BuildSystem } = await import('../src/system/BuildSystem.js');
const { PathfindingSystem } = await import('../src/system/PathfindingSystem.js');
const { MarchSystem } = await import('../src/system/MarchSystem.js');
const { CombatSystem } = await import('../src/system/CombatSystem.js');
const { TowerSystem } = await import('../src/system/TowerSystem.js');
const { SynergySystem } = await import('../src/system/SynergySystem.js');
const { SkillSystem } = await import('../src/system/SkillSystem.js');
const { getRandomBattleConfig } = await import('../src/data/levels.js');
const { getTierAiSettings, generateAiDeployment } = await import('../src/meta/PowerSystem.js');
const ProfileManager = await import('../src/meta/ProfileManager.js');
const DeploymentSys = await import('../src/meta/DeploymentSystem.js');
const { generateBundle } = DeploymentSys;

const DEPLOY_CFG = ConfigLoader.get('deployables');
const DEFAULT_DEP = DEPLOY_CFG.defaultDeployment;

// ========== 单元层 ==========
console.log('\n=== 单元层：种子随机源 ===');

{
  const a = createRng(42), b = createRng(42), c = createRng(43);
  let same = true;
  for (let i = 0; i < 1000; i++) if (a() !== b()) { same = false; break; }
  ok(same, 'createRng(42) 两次生成的 1000 个随机数完全一致');
  ok(a() !== c(), '不同种子(42 vs 43)产生不同随机流');
  const vals = [createRng(7)(), createRng(7)()];
  eq(vals[0], vals[1], '同种子首个随机值一致');
  let inRange = true;
  const r = createRng(1);
  for (let i = 0; i < 1000; i++) { const v = r(); if (v < 0 || v >= 1) { inRange = false; break; } }
  ok(inRange, 'createRng 输出均在 [0,1)');
}

{
  setBattleRng(null);
  ok(!isDeterministic(), '未注入时 isDeterministic() 为 false');
  const v = battleRandom();
  ok(v >= 0 && v < 1, '未注入时 battleRandom() fallback 返回 [0,1)');
  setBattleRng(createRng(99));
  ok(isDeterministic(), '注入后 isDeterministic() 为 true');
  setBattleRng(null);
  ok(!isDeterministic(), 'setBattleRng(null) 复位');
}

// ========== 配置层 ==========
console.log('\n=== 配置层：weightedRandom / randomChoice ===');

{
  const weights = { a: 1, b: 2, c: 3 };
  const seq1 = [], seq2 = [];
  setBattleRng(createRng(5));
  for (let i = 0; i < 50; i++) seq1.push(weightedRandom(weights));
  setBattleRng(createRng(5));
  for (let i = 0; i < 50; i++) seq2.push(weightedRandom(weights));
  setBattleRng(null);
  eq(JSON.stringify(seq1), JSON.stringify(seq2), 'weightedRandom 同种子 50 次抽样序列一致');
  ok(seq1.every(k => ['a', 'b', 'c'].includes(k)), 'weightedRandom 返回合法 key');

  const arr = [10, 20, 30, 40, 50];
  setBattleRng(createRng(8));
  const c1 = Array.from({ length: 30 }, () => randomChoice(arr));
  setBattleRng(createRng(8));
  const c2 = Array.from({ length: 30 }, () => randomChoice(arr));
  setBattleRng(null);
  eq(JSON.stringify(c1), JSON.stringify(c2), 'randomChoice 同种子序列一致');
}

console.log('\n=== 配置层：getRandomBattleConfig ===');

{
  setBattleRng(createRng(1234));
  const cfg1 = getRandomBattleConfig(0, null);
  setBattleRng(createRng(1234));
  const cfg2 = getRandomBattleConfig(0, null);
  setBattleRng(createRng(9999));
  const cfg3 = getRandomBattleConfig(0, null);
  setBattleRng(null);

  eq(JSON.stringify(cfg1), JSON.stringify(cfg2), 'getRandomBattleConfig 同种子结果完全一致');
  ok(JSON.stringify(cfg1) !== JSON.stringify(cfg3), 'getRandomBattleConfig 不同种子结果不同');
  ok(cfg1.layoutId && cfg1.enemies && cfg1.enemies[0], 'config 结构完整');
}

console.log('\n=== 配置层：getTierAiSettings / generateAiDeployment ===');

{
  setBattleRng(createRng(777));
  const s1 = getTierAiSettings(500);
  setBattleRng(createRng(777));
  const s2 = getTierAiSettings(500);
  setBattleRng(null);
  eq(JSON.stringify(s1), JSON.stringify(s2), 'getTierAiSettings 同种子结果一致');

  setBattleRng(createRng(321));
  const d1 = generateAiDeployment('hard');
  setBattleRng(createRng(321));
  const d2 = generateAiDeployment('hard');
  setBattleRng(null);
  eq(JSON.stringify(d1), JSON.stringify(d2), 'generateAiDeployment 同种子选兵一致');
  eq(Object.keys(d1.units || {}).length, 4, 'generateAiDeployment 生成 4 个 AI 兵种槽位');
}

// ========== 集成层：无头完整战斗 + 命令回放 ==========

// 确定性人类策略：固定节奏，每次翻「字典序最小」的可负担邻格（无任何随机）
class DeterministicHuman {
  constructor() { this.interval = 2.0; this.timer = 0; }
  update(dt, ctx, flipCallback, record) {
    this.timer += dt;
    if (this.timer < this.interval) return;
    this.timer = 0;
    const p = ctx.players.find(pl => pl.id === 1);
    if (!p || p.gold < 5) return;
    const candidates = ctx.map.getAdjacentUnflippedTiles(p.id)
      .filter(t => getFlipCost(t.presetBuilding) <= p.gold)
      .sort((a, b) => (a.q - b.q) || (a.r - b.r));
    if (candidates.length === 0) return;
    const tile = candidates[0];
    flipCallback(tile, p);
    if (record) record(tile.q, tile.r);
  }
}

function setupProfile() {
  const profile = ProfileManager.get();
  profile.collectedUnits = {};
  for (const id of DEFAULT_DEP.units) {
    if (id) profile.collectedUnits[id] = { level: 1, recruitCount: 0 };
  }
  profile.collectedSynergies = {};
  for (const id of (DEFAULT_DEP.synergies || [])) {
    if (id) profile.collectedSynergies[id] = { level: 1 };
  }
  profile.buildingUpgrades = { barracks: 1, arrow_tower: 1, gold_mine: 1 };
  profile.deployment = {
    units: [...DEFAULT_DEP.units],
    synergies: [...(DEFAULT_DEP.synergies || [])],
    buildingUpgrades: { ...profile.buildingUpgrades },
  };
  return generateBundle();
}

function snapshotState({ map, marchGroups, result, steps }) {
  const tiles = map.getAllTiles().map(t => ({
    k: `${t.q},${t.r}`,
    o: t.owner,
    f: t.isFlipped ? 1 : 0,
    b: t.building ? `${t.building.type}:${t.building.level}` : '',
    w: t.building && typeof t.building.warriors === 'number' ? Math.round(t.building.warriors) : 0,
  })).sort((a, b) => (a.k < b.k ? -1 : a.k > b.k ? 1 : 0));
  const groups = marchGroups.map(g => ({
    o: g.owner, w: Math.round(g.warriors), x: Math.round(g.pixelX || 0), y: Math.round(g.pixelY || 0), s: g.state,
  }));
  return JSON.stringify({ result, steps, tiles, groups });
}

function runBattle({ seed, replay }) {
  setBattleRng(createRng(seed));

  // 1. 生成对战配置（抽取布局/难度/种族/名称 —— 均走 battleRandom）
  const config = getRandomBattleConfig(0, null);
  SkillSystem.reset();
  SkillSystem.setEnemyDifficulty(config.enemies?.[0]?.ai || 'normal');
  EconomySystem.resetRecruitLog();

  // 2. 地图生成（预设建筑分布走 weightedRandom → battleRandom）
  const map = new HexMap();
  map.generate(config.cols, config.rows, config.obstacles);
  map.ensureLevelOneAround(config.playerBase.q, config.playerBase.r, 3);

  // 3. 玩家（上阵系统）
  const bundle = setupProfile();
  const human = new Player(1, '玩家', '#3b82f6', false);
  human.gold = config.player.initialGold;
  human.deploymentBundle = bundle;
  human.deployedSynergies = bundle.synergies;
  human.race = 'custom';
  human.raceLineup = ['custom'];

  // 4. 敌方 AI（兵种一致化走 generateAiDeployment → battleRandom，无 skillTier/powerRatio）
  const ecfg = config.enemies[0];
  const ai = new AIPlayer(ecfg.id, ecfg.name, ecfg.color, ecfg.ai);
  ai.gold = ecfg.initialGold;
  ai.race = ecfg.race;
  ai.raceLineup = [ecfg.race];
  if (typeof ecfg.warriorRateMult === 'number') ai.warriorRateMult = ecfg.warriorRateMult;
  ai.deploymentBundle = generateAiDeployment(ecfg.ai);

  const players = [human, ai];

  // 5. 双方大本营
  const pbTile = map.getTile(config.playerBase.q, config.playerBase.r);
  pbTile.owner = 1; pbTile.isFlipped = true;
  pbTile.building = new Building('headquarters', 1, 'custom', 1, bundle);
  human.setBase(pbTile);

  const ebTile = map.getTile(config.enemyBase.q, config.enemyBase.r);
  ebTile.owner = ai.id; ebTile.isFlipped = true;
  ebTile.building = new Building('headquarters', 1, ai.race, ai.id, ai.deploymentBundle);
  ai.setBase(ebTile);

  // 6. 战斗循环
  const marchGroups = [];
  const flippingTiles = [];
  const gameState = { players, marchGroups, map };
  const humanPolicy = replay ? null : new DeterministicHuman();
  const commands = [];
  let replayIdx = 0;

  const flipTile = (tile, player) => {
    if (BuildSystem.tryFlipTile(tile, player, map)) flippingTiles.push(tile);
  };

  const dt = 0.2;
  const maxTime = 120; // 足够行军 + 遭遇战 + 箭塔交火，又保持测试快速
  const steps = Math.ceil(maxTime / dt);
  let result = 'timeout';
  let endedStep = steps;

  for (let step = 0; step < steps; step++) {
    // 翻转动画
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

    // 经济
    EconomySystem.update(dt, players, map, marchGroups, PathfindingSystem);
    // 羁绊
    for (const player of players) SynergySystem.updatePlayerSynergies(player, map);
    SynergySystem.updateGroupSynergies(marchGroups, players, map);
    // 技能
    SkillSystem.update(dt, marchGroups, map, players);
    // 行军 + 遭遇战
    MarchSystem.update(dt, marchGroups, map, CombatSystem, players);
    // 箭塔
    TowerSystem.update(dt, players, map, marchGroups, CombatSystem);

    // AI 决策
    if (ai.isAlive() && ai.tick(dt)) {
      ai.makeDecision(map, gameState, flipTile);
    }
    // 人类决策（record 模式记录命令序列；replay 模式按记录的命令回放）
    if (human.isAlive()) {
      if (replay) {
        while (replayIdx < replay.length && replay[replayIdx].step === step) {
          const { q, r } = replay[replayIdx++];
          const tile = map.getTile(q, r);
          if (tile) flipTile(tile, human);
        }
      } else {
        humanPolicy.update(dt, gameState, flipTile, (q, r) => commands.push({ step, q, r }));
      }
    }

    // 清理死亡队伍
    for (let i = marchGroups.length - 1; i >= 0; i--) {
      const g = marchGroups[i];
      if (g.state === 'destroyed' || g.state === 'disbanded' || g.state === 'arrived') marchGroups.splice(i, 1);
    }

    if (!human.isAlive()) { result = 'lost'; endedStep = step; break; }
    if (!ai.isAlive()) { result = 'won'; endedStep = step; break; }
  }

  setBattleRng(null);

  return {
    result,
    steps: endedStep,
    commands,
    snapshot: snapshotState({ map, marchGroups, result, steps: endedStep }),
  };
}

console.log('\n=== 集成层：完整战斗确定性 ===');

{
  // 第一遍：确定性策略推演，记录命令序列与终局状态
  const runA = runBattle({ seed: 20260804 });
  ok(runA.commands.length > 0, `首遍人类实际下达了命令（${runA.commands.length} 次翻格）`);
  ok(runA.snapshot.length > 0, '首遍生成了非空终局状态快照');

  // 第二遍：同种子 + 回放相同命令序列
  const runB = runBattle({ seed: 20260804, replay: runA.commands });

  eq(runA.snapshot, runB.snapshot, '同种子 + 同命令序列 → 终局状态逐字段一致');
  eq(runA.result, runB.result, '同种子 + 同命令序列 → 胜负结果一致');

  // 第三遍：不同种子 → 结果应不同（证明种子确实驱动了随机决策）
  const runC = runBattle({ seed: 20260805 });
  ok(runC.snapshot !== runA.snapshot, '不同种子产生不同终局状态');
}

// ========== 汇总 ==========
console.log(`\n=== 结果：${pass} 通过 / ${fail} 失败 ===`);
if (fail > 0) process.exit(1);
