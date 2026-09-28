/**
 * 战力系统测试
 * 验证：
 *  1. 单兵战力：随等级/品质/技能/射程单调增长
 *  2. 玩家总战力：只统计上阵内容，分项之和 = 总战力；getTotalPower 委托一致
 *  3. 段位战力参考带：8 段位严格递增
 *  4. 段位电脑设定：难度分布随段位后移、强度参数递增、战力动态修正有钳制
 *  5. buildBattleConfig：战力匹配时输出产兵乘数/技能档位；兼容模式不输出
 *  6. 大厅渲染：战力 + 段位参考战力显示
 */
const noop = () => {};
global.document = {
  getElementById: () => null,
  addEventListener: noop, removeEventListener: noop,
  createElement: () => ({ getContext: () => null, style: {} }),
  body: { appendChild: noop, removeChild: noop },
  hidden: false,
};
global.window = {
  innerWidth: 400, innerHeight: 700, devicePixelRatio: 1,
  addEventListener: noop, removeEventListener: noop,
  requestAnimationFrame: () => 0, cancelAnimationFrame: noop,
};
global.localStorage = { _d: {}, getItem(k) { return this._d[k] ?? null; }, setItem(k, v) { this._d[k] = String(v); }, removeItem(k) { delete this._d[k]; } };
Object.defineProperty(global, 'navigator', { value: { userAgent: 'node-test' }, configurable: true });
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

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; console.log(`  ✅ ${msg}`); }
  else { failed++; console.log(`  ❌ ${msg}`); }
}

const { default: ConfigLoader, syncConfigToStatics } = await import('../src/config.js');
await ConfigLoader.init();
syncConfigToStatics();

const PowerSystem = (await import('../src/meta/PowerSystem.js')).default;
const { buildBattleConfig, BOARD_LAYOUTS } = await import('../src/data/levels.js');
const PlayerProfile = (await import('../src/meta/PlayerProfile.js')).PlayerProfile;
const { RenderSystem } = await import('../src/system/RenderSystem.js');

console.log('=== 测试1: 单兵战力随等级/品质增长 ===');
{
  const p1 = PowerSystem.calculateUnitPower('swordsman', 1);
  const p10 = PowerSystem.calculateUnitPower('swordsman', 10);
  const p20 = PowerSystem.calculateUnitPower('swordsman', 20);
  assert(p1 > 0, `Lv1 剑士战力 ${p1} > 0`);
  assert(p10 > p1, `Lv10(${p10}) > Lv1(${p1}) 等级成长`);
  assert(p20 > p10, `Lv20(${p20}) > Lv10(${p10})`);

  const q1 = PowerSystem.calculateUnitPower('swordsman', 1);      // 白
  const q4 = PowerSystem.calculateUnitPower('paladin', 1);        // 紫
  assert(q4 > q1, `紫品质圣骑士(${q4}) > 白品质剑士(${q1}) 品质乘数生效`);

  // 技能随等级解锁（Lv6/12 解锁紫被动）→ 战力跳升
  const p5 = PowerSystem.calculateUnitPower('swordsman', 5);
  const p6 = PowerSystem.calculateUnitPower('swordsman', 6);
  assert(p6 - p5 > 25, `Lv5→Lv6 解锁技能带来额外战力(${p5}→${p6})`);

  // 射程加成：弓箭手(射程2) 有射程分
  assert(PowerSystem.calculateUnitPower('archer', 1) > 0, '远程兵种战力正常');
}

console.log('=== 测试2: 玩家总战力只统计上阵内容 ===');
{
  const profile = new PlayerProfile();
  const before = PowerSystem.calculatePlayerPower(profile);
  assert(before.total > 0, `新玩家默认阵容战力 ${before.total} > 0`);
  // 2026-09-09 改造：羁绊已不计入战力（自动派生，战斗中加成）
  assert(before.units > 0 && before.buildings > 0, '兵种/建筑分项计入（羁绊已废弃）');
  assert(before.synergies === 0, '羁绊分项归零（2026-09-09 改造）');
  assert(before.total === Math.round(before.units + before.synergies + before.buildings + before.tech), '分项之和 = 总战力');

  // 收集但未上阵的兵种不计入
  profile.collectedUnits.dragonling = { level: 20 };
  const after = PowerSystem.calculatePlayerPower(profile);
  assert(after.total === before.total, '未上阵的高等级兵种不计入战力');

  // 升级上阵兵种 → 战力增长
  profile.collectedUnits.swordsman = { level: 10 };
  const upgraded = PowerSystem.calculatePlayerPower(profile);
  assert(upgraded.total > after.total, '升级上阵兵种战力增长');

  // getTotalPower 委托一致
  assert(profile.getTotalPower() === PowerSystem.calculatePlayerPower(profile).total, 'getTotalPower 与 PowerSystem 口径一致');

  // 科技等级计入
  const noTech = PowerSystem.calculatePlayerPower(profile).total;
  profile.techTree.nodeA = 3;
  assert(PowerSystem.calculatePlayerPower(profile).total === noTech + 3 * 40, '科技每级+40战力');
}

console.log('=== 测试3: 段位战力参考带 ===');
{
  const ref = PowerSystem.TIER_POWER_REFERENCE;
  assert(ref.length === 8, `8 段位参考带(实际 ${ref.length})`);
  let mono = true;
  for (let i = 1; i < ref.length; i++) if (ref[i] <= ref[i - 1]) mono = false;
  assert(mono, `参考带严格递增: ${ref.join(' < ')}`);

  const info = PowerSystem.getLobbyPowerInfo({ trophies: 0, deployment: { units: ['swordsman'], synergies: [] }, collectedUnits: { swordsman: { level: 1 } }, buildingUpgrades: {}, techTree: {} });
  assert(info.reference === ref[0], '青铜奖杯 → 青铜参考战力');
  assert(info.tierLabel === '青铜', '段位标签正确');
  assert(Math.abs(info.ratio - info.total / ref[0]) < 1e-9, 'ratio = 总战力/参考战力');
}

console.log('=== 测试4: 段位电脑设定（AI 一致化） ===');
{
  // 难度分布随段位后移
  const bronze = PowerSystem.getTierAiSettings(0, () => 0.5);    // 青铜 中位
  const king = PowerSystem.getTierAiSettings(2500, () => 0.5);   // 王者 中位
  const diffRank = { easy: 0, normal: 1, hard: 2, nightmare: 3 };
  assert(diffRank[bronze.difficulty] <= 1, `青铜中位难度偏易(${bronze.difficulty})`);
  assert(diffRank[king.difficulty] >= 2, `王者中位难度偏难(${king.difficulty})`);

  // AI 一致化（2026-09-09）：只返回难度档，无初始金币/技能档位/战力比/产兵乘数作弊
  const s = PowerSystem.getTierAiSettings(500, () => 0.1);
  assert(s.initialGold === undefined, '不再返回初始金币（AI 统一与玩家一致 150）');
  assert(s.skillTier === undefined, '不再返回技能档位');
  assert(s.powerRatio === undefined, '不再返回战力比');
  assert(s.warriorRateMult === undefined, '不再返回产兵乘数');
  assert(['easy', 'normal', 'hard', 'nightmare'].includes(s.difficulty), `难度合法(${s.difficulty})`);

  // 同参数确定性
  const a = PowerSystem.getTierAiSettings(500, () => 0.42);
  const b = PowerSystem.getTierAiSettings(500, () => 0.42);
  assert(JSON.stringify(a) === JSON.stringify(b), '同参数结果确定');
}

console.log('=== 测试5: buildBattleConfig AI 一致化输出 ===');
{
  const layout = BOARD_LAYOUTS[0];
  const cfg = buildBattleConfig(layout, 0);
  const enemy = cfg.enemies[0];
  assert(enemy.warriorRateMult === undefined, '无产兵乘数（已移除作弊）');
  assert(enemy.skillTier === undefined, '无技能档位（已移除作弊）');
  assert(enemy.powerRatio === undefined, '无战力比（已移除作弊）');
  assert(enemy.initialGold === 150, `AI 初始金币与玩家一致(${enemy.initialGold})`);
  assert(cfg.player.initialGold === 150, `玩家初始金币(${cfg.player.initialGold})`);
  assert(['easy', 'normal', 'hard', 'nightmare'].includes(enemy.ai), `难度合法(${enemy.ai})`);

  // 纯随机模式（无奖杯）仍可用
  const cfg3 = buildBattleConfig(layout);
  assert(cfg3.enemies.length === 1 && cfg3.enemies[0].race, '纯随机模式正常');
  assert(cfg3.enemies[0].initialGold === 150, '纯随机 AI 初始金币也统一 150');
}

console.log('=== 测试6: 大厅战力渲染 ===');
{
  // Canvas stub：记录 fillText 调用
  const texts = [];
  const makeCtx = () => {
    const grad = { addColorStop: noop };
    return {
      canvas: { width: 400, height: 700 },
      fillText: (t) => texts.push(String(t)),
      measureText: () => ({ width: 50 }),
      createLinearGradient: () => grad,
      createRadialGradient: () => grad,
    };
  };
  const ctx = new Proxy(makeCtx(), {
    get(t, p) {
      if (p in t) return t[p];
      return noop;
    },
    set() { return true; },
  });

  const gameState = {
    screenState: 'lobby',
    profile: new PlayerProfile(),
    powerInfo: PowerSystem.getLobbyPowerInfo(new PlayerProfile()),
    ladderTier: { icon: '🛡', label: '青铜', color: '#b45309' },
    ladderProgress: { ratio: 0.1, cur: 20, need: 200, next: { icon: '⚪', label: '白银' } },
    seasonDaysLeft: 7,
    shareRewardClaimed: true,
    tutorialStep: 4,
    lobbyBadges: null,
  };
  const renderer = new RenderSystem(ctx, 400, 700);
  renderer.drawLobby(gameState);

  const powerText = texts.find(t => t.includes('战力'));
  assert(!!powerText, `大厅绘制战力文本: "${powerText}"`);
  assert(!!texts.find(t => t.includes('参考战力')), '大厅绘制段位参考战力');

  // 高战力达成状态（ratio ≥ 1 → 已达参考）
  texts.length = 0;
  gameState.powerInfo = { total: 9999, reference: 2000, ratio: 5 };
  renderer.drawLobby(gameState);
  assert(!!texts.find(t => t.includes('已达本段位参考战力')), '超参考带显示"已达"状态');
}

console.log(`\n结果: ${passed} 通过, ${failed} 失败`);
process.exit(failed > 0 ? 1 : 0);
