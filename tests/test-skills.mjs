// 测试: 兵种技能系统 (SkillSystem + skills.json + MarchGroup 消费)
// 覆盖: 配置完整性(40玩家兵种+24敌方单位) / 玩家解锁规则(蓝默认·紫6/12·橙18或品质≥5) /
//       敌方难度档位门控(easy/normal/hard/nightmare) / 被动聚合(叠加·max·先手·阈值) /
//       initGroupSkills 注入 / MarchGroup 双链路构造 / getter 消费 /
//       主动引擎 7 类释放(单体/范围/穿透射线/嘲讽/冲刺/召唤) / 冷却与重试 /
//       伤害封顶 cap 与 minKill / 召唤物防递归 / MAX_UNIT_LEVEL 导出
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

// 初始化配置
const { default: ConfigLoader, syncConfigToStatics } = await import('../src/config.js');
await ConfigLoader.init();
syncConfigToStatics();

const { SkillSystem } = await import('../src/system/SkillSystem.js');
const { MarchGroup } = await import('../src/entity/MarchGroup.js');
const { MAX_UNIT_LEVEL } = await import('../src/meta/DeploymentSystem.js');

// ========== 工具 ==========
// 构造可控队伍：默认 unitData.skills=[]（跳过技能注入，保证战斗数值确定性）
// opts.enemyChain=true 时不设 skills 字段 → 走种族模式（按当前难度档位注入）
function makeGroup(owner, warriors, level = 1, opts = {}) {
  const unitData = {
    speedCoeff: 1, hpCoeff: 1,
    attackCoeff: opts.attackCoeff ?? 1,
    quality: 1, qualityMultiplier: 1,
    attackRange: opts.attackRange ?? 1,
    unitId: 'test_unit', icon: '', name: '测试兵',
    combatStyles: ['melee'],
  };
  if (!opts.enemyChain) unitData.skills = opts.skills ?? [];
  const sb = {
    attackBonus: 0,
    unitType: '步兵',
    race: opts.race ?? 'human',
    combatStyles: ['melee'],
    level,
    unitData,
  };
  const g = new MarchGroup(owner, warriors, sb, { q: 0, r: 0 });
  g.pixelX = opts.x ?? 100; g.pixelY = opts.y ?? 100;
  return g;
}

const ACTIVE_TYPES = ['single', 'aoe', 'pierce', 'ray', 'taunt', 'dash', 'summon'];

// ============ 0. 配置完整性 ============
console.log('=== 测试0: skills.json 配置完整性 ===');
{
  const cfg = JSON.parse(rf(ROOT + 'config/skills.json', 'utf-8'));
  const rules = cfg.unlockRules || {};
  assert(rules.maxUnitLevel === 20, 'unlockRules.maxUnitLevel = 20');
  assert(rules.unlockLevels?.purple1 === 6 && rules.unlockLevels?.purple2 === 12 && rules.unlockLevels?.orange === 18,
    '解锁轴 6/12/18');
  assert(rules.orangeQualityAutoUnlock === 5, '橙色品质自动解锁阈值 = 5');

  const unitIds = Object.keys(cfg.units || {});
  assert(unitIds.length === 40, `玩家兵种数量 40 (实际 ${unitIds.length})`);
  const raceIds = Object.keys(cfg.raceUnits || {});
  assert(raceIds.length === 24, `敌方种族单位数量 24 (实际 ${raceIds.length})`);

  let structureOk = true, actives = {}, paramOk = true;
  const checkList = (list, prefix) => {
    if (!Array.isArray(list) || list.length !== 6) { structureOk = false; return; }
    const blues = list.filter((s) => s.quality === 3);
    const purples = list.filter((s) => s.quality === 4);
    const oranges = list.filter((s) => s.quality === 5);
    if (blues.length !== 3 || purples.length !== 2 || oranges.length !== 1) { structureOk = false; return; }
    if (blues.some((s) => s.kind !== 'passive' || s.unlockLevel !== 1)) { structureOk = false; return; }
    const pLevels = purples.map((s) => s.unlockLevel).sort((a, b) => a - b);
    if (pLevels[0] !== 6 || pLevels[1] !== 12 || purples.some((s) => s.kind !== 'passive')) { structureOk = false; return; }
    const o = oranges[0];
    if (o.kind !== 'active' || o.unlockLevel !== 18 || !ACTIVE_TYPES.includes(o.type)) { structureOk = false; return; }
    actives[o.type] = (actives[o.type] || 0) + 1;
    if (!(o.cooldown > 0)) paramOk = false;
    if (['single', 'aoe', 'pierce', 'ray'].includes(o.type) && !(o.power > 0 && o.cap > 0)) paramOk = false;
    if (['aoe', 'taunt'].includes(o.type) && !(o.radius > 0)) paramOk = false;
    // 命名同兵种内不重复
    const names = list.map((s) => s.name);
    if (new Set(names).size !== 6) structureOk = false;
    // id 前缀
    if (list.some((s) => !s.id?.startsWith(prefix))) structureOk = false;
  };
  for (const id of unitIds) checkList(cfg.units[id], id);
  for (const id of raceIds) checkList(cfg.raceUnits[id], id);
  assert(structureOk, '全部 64 单位结构: 3蓝(被动·默认) + 2紫(被动·Lv6/12) + 1橙(主动·Lv18)');
  assert(paramOk, '主动技能参数完整: cooldown/power/cap/radius 均为正');
  assert(Object.keys(actives).length === 7, `7 类主动类型全覆盖 (实际 ${Object.keys(actives).length} 种)`);

  // 玩家主动分布抽样
  const anySummon = unitIds.some((id) => cfg.units[id].some((s) => s.type === 'summon'));
  const anyTaunt = unitIds.some((id) => cfg.units[id].some((s) => s.type === 'taunt'));
  assert(anySummon && anyTaunt, '玩家兵种中存在召唤/嘲讽类主动');
}

// ============ 1. 玩家解锁规则 ============
console.log('=== 测试1: 玩家兵种解锁规则（等级 6/12/18 + 品质≥5） ===');
{
  const cnt = (lv, q) => SkillSystem.getUnitSkillList('swordsman', lv, q).length;
  assert(cnt(1, 1) === 3, 'Lv1 品质1: 仅3蓝');
  assert(cnt(5, 1) === 3, 'Lv5 品质1: 仍3蓝(紫1未解锁)');
  assert(cnt(6, 1) === 4, 'Lv6 品质1: +紫1 = 4');
  assert(cnt(11, 1) === 4, 'Lv11 品质1: 仍4(紫2未解锁)');
  assert(cnt(12, 1) === 5, 'Lv12 品质1: +紫2 = 5');
  assert(cnt(17, 1) === 5, 'Lv17 品质1: 仍5(橙未解锁)');
  assert(cnt(18, 1) === 6, 'Lv18 品质1: 全解锁 6');
  assert(cnt(20, 1) === 6, 'Lv20: 全解锁 6');

  // 橙色主动品质自动解锁（紫仍按等级解锁 → Lv1 为 3蓝+1橙=4）
  const q5 = SkillSystem.getUnitSkillList('swordsman', 1, 5);
  assert(q5.length === 4, '品质5 Lv1: 3蓝+橙色主动默认解锁 = 4');
  assert(q5.filter((s) => s.kind === 'active').length === 1, '品质5 Lv1: 恰好1个主动');
  assert(SkillSystem.getUnitSkillList('swordsman', 1, 4).length === 3, '品质4 Lv1: 橙色不自动解锁 → 3');
  assert(SkillSystem.getUnitSkillList('swordsman', 6, 5).length === 5, '品质5 Lv6: 3蓝+紫1+橙 = 5');

  // 等级下限保护
  assert(SkillSystem.getUnitSkillList('swordsman', 0, 1).length === 3, 'Lv0 兜底为 Lv1 → 3');
  assert(SkillSystem.getUnitSkillList('swordsman', -5, 1).length === 3, '负等级兜底 → 3');

  // 未知兵种
  assert(SkillSystem.getUnitSkillList('nonexistent', 20, 5).length === 0, '未知兵种 → 空表');

  // 全量表（UI用）
  assert(SkillSystem.getAllUnitSkills('swordsman')?.length === 6, 'getAllUnitSkills 返回全量6条');
  assert(SkillSystem.getAllUnitSkills('nonexistent') === null, 'getAllUnitSkills 未知兵种 → null');
}

// ============ 2. 敌方难度档位门控 ============
console.log('=== 测试2: 敌方难度档位门控 ===');
{
  SkillSystem.reset();
  assert(SkillSystem.getEnemyTier() === 1, 'reset → 默认档位 normal(1)');

  const cnt = () => SkillSystem.getEnemySkillList('human', 1).length;
  SkillSystem.setEnemyDifficulty('easy');
  const easyList = SkillSystem.getEnemySkillList('human', 1);
  assert(easyList.length === 3, 'easy: 仅3蓝');
  assert(easyList.every((s) => s.kind === 'passive'), 'easy: 全被动无主动');

  SkillSystem.setEnemyDifficulty('normal');
  assert(cnt() === 4, 'normal: +紫1 = 4');
  SkillSystem.setEnemyDifficulty('hard');
  assert(cnt() === 5, 'hard: +紫2 = 5');
  SkillSystem.setEnemyDifficulty('nightmare');
  const nmList = SkillSystem.getEnemySkillList('human', 1);
  assert(nmList.length === 6, 'nightmare: 全解锁 6');
  assert(nmList.some((s) => s.kind === 'active'), 'nightmare: 含主动技能');

  SkillSystem.setEnemyDifficulty('invalid_difficulty');
  assert(SkillSystem.getEnemyTier() === 1, '未知难度兜底 normal(1)');
  assert(SkillSystem.getEnemySkillList('unknown_race', 1).length === 0, '未知种族 → 空表');

  // 所有种族单位在不同档位下的数量一致性（24 单位同构）
  SkillSystem.setEnemyDifficulty('easy');
  const cfg = JSON.parse(rf(ROOT + 'config/skills.json', 'utf-8'));
  let consistent = true;
  for (const [id, list] of Object.entries(cfg.raceUnits)) {
    const [race, lvStr] = id.split('_');
    if (SkillSystem.getEnemySkillList(race, Number(lvStr)).length !== 3) consistent = false;
  }
  assert(consistent, 'easy 档位下 24 敌方单位全部仅3蓝');

  SkillSystem.reset();
}

// ============ 3. 被动聚合 aggregatePassives ============
console.log('=== 测试3: 被动聚合 ===');
{
  assert(SkillSystem.aggregatePassives([]) === null, '空表 → null');
  assert(SkillSystem.aggregatePassives(null) === null, 'null → null');
  assert(SkillSystem.aggregatePassives([{ kind: 'active', type: 'single' }]) === null, '仅主动 → null');

  const agg = SkillSystem.aggregatePassives([
    { kind: 'passive', type: 'attack_bonus', value: 0.06 },
    { kind: 'passive', type: 'attack_bonus', value: 0.12 },
    { kind: 'passive', type: 'damage_bonus', value: 0.12 },
    { kind: 'passive', type: 'crit_bonus', value: 0.1 },
    { kind: 'passive', type: 'crit_damage', value: 0.15 },
    { kind: 'passive', type: 'damage_reduction', value: 0.08 },
    { kind: 'passive', type: 'damage_reflect', value: 0.1 },
    { kind: 'passive', type: 'armor_pierce', value: 0.2 },
    { kind: 'passive', type: 'spell_damage', value: 0.15 },
    { kind: 'passive', type: 'kill_bonus', value: 0.02 },
    { kind: 'passive', type: 'post_battle_heal', value: 0.1 },
    { kind: 'passive', type: 'splash', value: 0.15 },
    { kind: 'passive', type: 'speed_bonus', value: 0.2 },
  ]);
  assert(agg.attackBonus === 0.18, 'attack_bonus 叠加 0.06+0.12=0.18');
  assert(agg.damageBonus === 0.12, 'damage_bonus 累加');
  assert(agg.critBonus === 0.1 && agg.critDamageBonus === 0.15, '暴击率/暴伤聚合');
  assert(agg.damageReduction === 0.08 && agg.damageReflect === 0.1, '减伤/反伤聚合');
  assert(agg.armorPierce === 0.2 && agg.spellDamageBonus === 0.15, '穿甲/法伤聚合');
  assert(agg.killBonus === 0.02 && agg.postBattleHeal === 0.1, '击杀/回血聚合');
  assert(agg.splash === 0.15 && agg.speedBonus === 0.2, '溅射/速度聚合');
  assert(agg.firstStrike === false && agg.reviveChance === 0, '未选类型为默认值');

  // 复活取 max
  const rv = SkillSystem.aggregatePassives([
    { kind: 'passive', type: 'revive', value: 0.3, count: 2 },
    { kind: 'passive', type: 'revive', value: 0.5, count: 1 },
  ]);
  assert(rv.reviveChance === 0.5 && rv.reviveCount === 2, '复活取 max(chance=0.5, count=2)');

  // 先手 + 残血阈值
  const fs = SkillSystem.aggregatePassives([
    { kind: 'passive', type: 'first_strike' },
    { kind: 'passive', type: 'execute_bonus', value: 0.2, threshold: 0.6 },
  ]);
  assert(fs.firstStrike === true, 'first_strike → true');
  assert(fs.executeBonus === 0.2 && fs.executeThreshold === 0.6, '残血加成 0.2 阈值 0.6');
}

// ============ 4. initGroupSkills 注入 ============
console.log('=== 测试4: initGroupSkills 注入 ===');
{
  const mk = () => ({ skillPassives: null, activeSkill: null, skillCooldownTimer: 0, isSummon: false });

  const g1 = mk();
  SkillSystem.initGroupSkills(g1, [
    { kind: 'passive', type: 'attack_bonus', value: 0.06 },
    { kind: 'active', type: 'single', cooldown: 20, power: 0.55, cap: 0.35 },
  ]);
  assert(g1.skillPassives?.attackBonus === 0.06, '被动聚合注入');
  assert(g1.activeSkill?.type === 'single', '主动技能挂载');
  assert(g1.skillCooldownTimer === 10, '首次冷却 = cooldown×0.5 = 10');

  const g2 = mk();
  SkillSystem.initGroupSkills(g2, []);
  assert(g2.skillPassives === null && g2.activeSkill === null, '空表不注入');

  const g3 = mk();
  g3.isSummon = true;
  SkillSystem.initGroupSkills(g3, [
    { kind: 'passive', type: 'attack_bonus', value: 0.06 },
    { kind: 'active', type: 'summon', cooldown: 30 },
  ]);
  assert(g3.skillPassives !== null, '召唤物可带被动');
  assert(g3.activeSkill === null, '召唤物不携带主动(防无限召唤)');
}

// ============ 5. MarchGroup 双链路构造 ============
console.log('=== 测试5: MarchGroup 双链路技能注入 ===');
{
  // 玩家链路：unitData.skills（已过滤表）直接注入
  const gp = makeGroup(1, 100, 18, {
    skills: [
      { kind: 'passive', type: 'attack_bonus', value: 0.06 },
      { kind: 'active', type: 'dash', cooldown: 15, speedMult: 3, duration: 3 },
    ],
  });
  assert(gp.skillPassives?.attackBonus === 0.06, '玩家链路: 被动注入');
  assert(gp.activeSkill?.type === 'dash' && gp.skillCooldownTimer === 7.5, '玩家链路: 主动+首冷却7.5');

  // 敌方链路：无 skills 字段 → 按难度档位
  SkillSystem.setEnemyDifficulty('easy');
  const geEasy = makeGroup(2, 100, 1, { enemyChain: true });
  assert(geEasy.skillPassives !== null, '敌方链路: easy 也注入蓝色被动');
  assert(geEasy.activeSkill === null, '敌方链路: easy 无主动');

  SkillSystem.setEnemyDifficulty('nightmare');
  const geNm = makeGroup(2, 100, 1, { enemyChain: true });
  assert(geNm.activeSkill !== null && geNm.activeSkill.kind === 'active', '敌方链路: nightmare 带主动');
  SkillSystem.reset();
}

// ============ 6. MarchGroup getter 消费被动 ============
console.log('=== 测试6: getter 消费 skillPassives ===');
{
  const base = makeGroup(1, 100, 1, { skills: [] });
  const basePower = base.getPower();
  assert(basePower === 100, `基准战力 100 (实际 ${basePower})`);

  const withAtk = makeGroup(1, 100, 1, {
    skills: [{ kind: 'passive', type: 'attack_bonus', value: 0.5 }],
  });
  assert(withAtk.getPower() === 150, 'attack_bonus 0.5 → 战力×1.5');

  const withDmg = makeGroup(1, 100, 1, {
    skills: [{ kind: 'passive', type: 'damage_bonus', value: 0.5 }],
  });
  assert(withDmg.getPower() === 150, 'damage_bonus 0.5 → 战力×1.5(同乘区)');

  const withCrit = makeGroup(1, 100, 1, {
    skills: [
      { kind: 'passive', type: 'crit_bonus', value: 0.2 },
      { kind: 'passive', type: 'crit_damage', value: 0.3 },
    ],
  });
  assert(withCrit.getCritRate() === 0.2, 'crit_bonus 0.2 → 暴击率0.2');
  assert(withCrit.getCritDamageMultiplier() === 1.8, 'crit_damage 0.3 → 暴伤1.5+0.3=1.8');

  const withDef = makeGroup(1, 100, 1, {
    skills: [
      { kind: 'passive', type: 'damage_reduction', value: 0.3 },
      { kind: 'passive', type: 'damage_reflect', value: 0.15 },
      { kind: 'passive', type: 'post_battle_heal', value: 0.2 },
    ],
  });
  assert(withDef.getDamageReduction() === 0.3, 'damage_reduction 0.3');
  assert(withDef.getDamageReflect() === 0.15, 'damage_reflect 0.15');
  assert(withDef.getPostBattleHeal() === 0.2, 'post_battle_heal 0.2');

  const withRev = makeGroup(1, 100, 1, {
    skills: [{ kind: 'passive', type: 'revive', value: 0.4, count: 3 }],
  });
  const ri = withRev.getReviveInfo();
  assert(ri && ri.chance === 0.4 && ri.count === 3, 'revive → getReviveInfo {0.4, 3}');

  const withMisc = makeGroup(1, 100, 1, {
    skills: [
      { kind: 'passive', type: 'splash', value: 0.2 },
      { kind: 'passive', type: 'armor_pierce', value: 0.25 },
      { kind: 'passive', type: 'spell_damage', value: 0.3 },
      { kind: 'passive', type: 'speed_bonus', value: 0.5 },
      { kind: 'passive', type: 'first_strike' },
    ],
  });
  assert(withMisc.getSplash() === 0.2, 'splash 0.2');
  assert(withMisc.getArmorPierce() === 0.25, 'armor_pierce 0.25');
  assert(withMisc.getSpellDamageBonus() === 0.3, 'spell_damage 0.3');
  assert(withMisc.getEffectiveSpeed() === base.getEffectiveSpeed() * 1.5, 'speed_bonus 0.5 → 速度×1.5');
  assert(withMisc.hasFirstStrike() === true, 'first_strike → true');
  assert(base.hasFirstStrike() === false, '无技能 → 无先手');

  // 击杀加成: recordKill 累积
  const withKb = makeGroup(1, 100, 1, {
    skills: [{ kind: 'passive', type: 'kill_bonus', value: 0.05 }],
  });
  withKb.recordKill(); withKb.recordKill();
  assert(withKb.killBonus === 0.1, 'kill_bonus 0.05 × 2击杀 = 0.1');
  assert(withKb.getPower() === 100 * 1.1, '击杀加成反映到战力×1.1');

  // 残血执行加成
  const withEx = makeGroup(1, 100, 1, {
    skills: [{ kind: 'passive', type: 'execute_bonus', value: 0.3, threshold: 0.5 }],
  });
  assert(withEx.getPower() === 100, '满血无残血加成');
  withEx.warriors = 50;
  assert(withEx.getPower() === 65, `半血触发: 50×1.3=65 (实际 ${withEx.getPower()})`);

  // 冲刺状态: getEffectiveSpeed + updateSlow 计时
  const withDash = makeGroup(1, 100, 1, { skills: [] });
  withDash.dashFactor = 3; withDash.dashTimer = 2;
  assert(withDash.getEffectiveSpeed() === base.getEffectiveSpeed() * 3, 'dash → 速度×3');
  withDash.updateSlow(2.5);
  assert(withDash.dashFactor === 1.0 && withDash.dashTimer === 0, 'dash 计时结束归位');
  assert(withDash.getEffectiveSpeed() === base.getEffectiveSpeed(), 'dash 结束后速度恢复');
}

// ============ 7. 主动引擎: 冷却与单体 ============
console.log('=== 测试7: 主动引擎 - 冷却计时与单体爆发 ===');
{
  // 冷却未到不释放
  const caster1 = makeGroup(1, 100, 1, { skills: [], x: 0, y: 0 });
  caster1.activeSkill = { type: 'single', cooldown: 20, power: 0.55, cap: 0.35 };
  caster1.skillCooldownTimer = 10;
  const enemy1 = makeGroup(2, 100, 1, { skills: [], x: 100, y: 0 });
  SkillSystem.update(1, [caster1, enemy1], null, []);
  assert(enemy1.warriors === 100, '冷却未到: 不释放');
  assert(Math.abs(caster1.skillCooldownTimer - 9) < 1e-9, '冷却正常倒数 10→9');

  // 到点释放: 等战力 → kills = floor(power×0.55/PPW) = 55, 封顶 35%
  const caster2 = makeGroup(1, 100, 1, { skills: [], x: 0, y: 0 });
  caster2.activeSkill = { type: 'single', cooldown: 20, power: 0.55, cap: 0.35 };
  caster2.skillCooldownTimer = 0.1;
  const enemy2 = makeGroup(2, 100, 1, { skills: [], x: 50, y: 0 });
  SkillSystem.update(0.2, [caster2, enemy2], null, []);
  assert(enemy2.warriors === 65, `单体伤害封顶 35%: 100→${enemy2.warriors}`);
  assert(caster2.skillCooldownTimer === 20, '释放后冷却重置为完整 20');

  // 只打最近敌人
  const caster3 = makeGroup(1, 100, 1, { skills: [], x: 0, y: 0 });
  caster3.activeSkill = { type: 'single', cooldown: 20, power: 0.55, cap: 0.35 };
  caster3.skillCooldownTimer = 0;
  const near = makeGroup(2, 100, 1, { skills: [], x: 30, y: 0 });
  const far = makeGroup(2, 100, 1, { skills: [], x: 300, y: 0 });
  SkillSystem.update(0.01, [caster3, near, far], null, []);
  assert(near.warriors === 65 && far.warriors === 100, '单体只命中最近敌队');

  // 无目标 → 1秒后重试
  const caster4 = makeGroup(1, 100, 1, { skills: [], x: 0, y: 0 });
  caster4.activeSkill = { type: 'single', cooldown: 20, power: 0.55, cap: 0.35 };
  caster4.skillCooldownTimer = 0;
  SkillSystem.update(0.01, [caster4], null, []);
  assert(caster4.skillCooldownTimer === 1.0, '无目标 → 1秒后重试');

  // 已阵亡队伍不释放
  const caster5 = makeGroup(1, 100, 1, { skills: [] });
  caster5.activeSkill = { type: 'single', cooldown: 20, power: 0.55, cap: 0.35 };
  caster5.skillCooldownTimer = 0;
  caster5.state = 'destroyed';
  const enemy5 = makeGroup(2, 100, 1, { skills: [] });
  SkillSystem.update(1, [caster5, enemy5], null, []);
  assert(enemy5.warriors === 100, '阵亡队伍不释放技能');
}

// ============ 8. 主动引擎: 范围伤害 aoe ============
console.log('=== 测试8: 范围伤害 aoe ===');
{
  const hexMap = { size: 30 };  // radiusPx = 2.5×30×√3 ≈ 129.9
  const caster = makeGroup(1, 100, 1, { skills: [], x: 0, y: 0 });
  caster.activeSkill = { type: 'aoe', cooldown: 25, power: 0.35, cap: 0.18, radius: 2.5 };
  caster.skillCooldownTimer = 0;
  const inA = makeGroup(2, 100, 1, { skills: [], x: 100, y: 0 });
  const inB = makeGroup(2, 100, 1, { skills: [], x: -100, y: 0 });
  const outC = makeGroup(2, 100, 1, { skills: [], x: 500, y: 0 });
  SkillSystem.update(0.01, [caster, inA, inB, outC], hexMap, []);
  // kills = floor(100×0.35/1)=35, 封顶 floor(100×0.18)=18
  assert(inA.warriors === 82 && inB.warriors === 82, `半径内双敌各-18 (实际 ${inA.warriors}/${inB.warriors})`);
  assert(outC.warriors === 100, '半径外不受影响');
  assert(caster.skillCooldownTimer === 25, '释放后冷却重置 25');
}

// ============ 9. 主动引擎: 穿透/射线 ============
console.log('=== 测试9: 穿透 pierce / 射线 ray ===');
{
  // players=[] → 兜底方向指向最近敌队；reach=4格≈207.8px, halfWidth≈25.98px
  const hexMap = { size: 30 };
  const run = (type, extra = {}) => {
    const caster = makeGroup(1, 100, 1, { skills: [], x: 0, y: 0 });
    caster.activeSkill = { type, cooldown: 22, power: 0.3, cap: 0.2, length: 4, width: 1.0, ...extra };
    caster.skillCooldownTimer = 0;
    const onLine = makeGroup(2, 100, 1, { skills: [], x: 100, y: 0 });   // 线上 100px
    const offLine = makeGroup(2, 100, 1, { skills: [], x: 100, y: 200 }); // 垂距 200px
    const tooFar = makeGroup(2, 100, 1, { skills: [], x: 400, y: 0 });    // 超出射程
    SkillSystem.update(0.01, [caster, onLine, offLine, tooFar], hexMap, []);
    return { onLine, offLine, tooFar };
  };
  const p = run('pierce');
  // kills = floor(100×0.3)=30, 封顶 floor(100×0.2)=20
  assert(p.onLine.warriors === 80, `pierce 命中线上敌人 100→${p.onLine.warriors}`);
  assert(p.offLine.warriors === 100 && p.tooFar.warriors === 100, 'pierce 偏离/超程不命中');

  const r = run('ray', { length: 6 });  // 射线更长: reach≈311.8, 但 tooFar@400 仍超程
  assert(r.onLine.warriors === 80, 'ray 命中线上敌人');
  assert(r.offLine.warriors === 100 && r.tooFar.warriors === 100, 'ray 偏离/超程不命中');

  // 朝敌方大本营方向（players 提供 base）
  const caster = makeGroup(1, 100, 1, { skills: [], x: 0, y: 0 });
  caster.activeSkill = { type: 'pierce', cooldown: 22, power: 0.3, cap: 0.2, length: 10, width: 1.0 };
  caster.skillCooldownTimer = 0;
  const baseDir = makeGroup(2, 100, 1, { skills: [], x: 100, y: 0 });
  const playersStub = [{ id: 1 }, { id: 2, base: { q: 3, r: 0 } }];  // 大本营在 +x 方向远处
  SkillSystem.update(0.01, [caster, baseDir], { size: 30 }, playersStub);
  assert(baseDir.warriors === 80, '指定大本营方向时沿方向命中');
}

// ============ 10. 主动引擎: 嘲讽 taunt ============
console.log('=== 测试10: 嘲讽 taunt ===');
{
  const hexMap = { size: 30 };  // radiusPx = 3×30×√3 ≈ 155.9
  const caster = makeGroup(1, 100, 1, { skills: [], x: 0, y: 0 });
  caster.activeSkill = { type: 'taunt', cooldown: 25, radius: 3, duration: 4 };
  caster.skillCooldownTimer = 0;

  const near = makeGroup(2, 100, 1, { skills: [], x: 100, y: 0 });
  near.state = 'fighting_building';  // 正在攻城
  near.combatTimer = 2.5;
  const oldTarget = { dummy: true };
  near.fightTarget = oldTarget;

  const far = makeGroup(2, 100, 1, { skills: [], x: 400, y: 0 });
  far.state = 'fighting_building';
  far.combatTimer = 2.5;

  SkillSystem.update(0.01, [caster, near, far], hexMap, []);

  assert(near.state === 'fighting_warrior', '半径内敌人被强制转打我方队伍');
  assert(near.fightTarget === caster, '嘲讽目标指向施法者');
  assert(near.combatTimer === 0, '战斗计时器清零(打断攻城节奏)');
  assert(far.state === 'fighting_building' && far.combatTimer === 2.5, '半径外敌人不受影响');
  assert(near.warriors === 100 && far.warriors === 100, '嘲讽不造成直接伤害');
  assert(caster.skillCooldownTimer === 25, '释放后冷却重置 25');
}

// ============ 11. 主动引擎: 冲刺 dash ============
console.log('=== 测试11: 冲刺 dash ===');
{
  const caster = makeGroup(1, 100, 1, { skills: [] });
  const baseSpeed = caster.getEffectiveSpeed();
  caster.activeSkill = { type: 'dash', cooldown: 18, speedMult: 3, duration: 3 };
  caster.skillCooldownTimer = 0;

  SkillSystem.update(0.01, [caster], null, []);
  assert(caster.dashFactor === 3 && caster.dashTimer === 3, '冲刺生效: factor=3 timer=3');
  assert(caster.getEffectiveSpeed() === baseSpeed * 3, '冲刺期速度×3');
  assert(caster.skillCooldownTimer === 18, '释放后冷却重置 18');

  // 计时归零
  caster.updateSlow(3.1);
  assert(caster.dashFactor === 1.0, '冲刺结束恢复');
  assert(caster.getEffectiveSpeed() === baseSpeed, '速度恢复基准');
}

// ============ 12. 主动引擎: 召唤 summon ============
console.log('=== 测试12: 召唤 summon ===');
{
  const startTile = { q: 0, r: 0, owner: 1 };
  const hexMap = { size: 30, getTile: () => startTile };

  // 常规: 兵力 = ceil(本队×ratio), 封顶 maxWarriors
  const caster = makeGroup(1, 100, 1, { skills: [], x: 0, y: 0 });
  caster.activeSkill = { type: 'summon', cooldown: 30, ratio: 0.25, maxWarriors: 30 };
  caster.skillCooldownTimer = 0;
  const groups = [caster];
  SkillSystem.update(0.01, groups, hexMap, []);
  assert(groups.length === 2, '召唤队伍推入 marchGroups');
  const s1 = groups[1];
  assert(s1.isSummon === true, '召唤物标记 isSummon');
  assert(s1.warriors === 25, `召唤兵力 = ceil(100×0.25)=25 (实际 ${s1.warriors})`);
  assert(s1.owner === 1, '召唤物归属施法者阵营');
  assert(s1.activeSkill === null && s1.skillPassives === null, '召唤物无技能(防无限递归)');
  assert(s1.pixelX === caster.pixelX && s1.pixelY === caster.pixelY, '召唤物出生于施法者位置');
  assert(caster.skillCooldownTimer === 30, '释放后冷却重置 30');

  // 召唤物自身在后续 update 中不会释放技能（createSummon 工厂保证 activeSkill=null）
  const before = groups.length;
  s1.skillCooldownTimer = 0;
  SkillSystem.update(0.01, groups, hexMap, []);
  assert(groups.length === before && s1.activeSkill === null, '召唤物无主动 → 不会二次召唤');

  // 下限 3: 小队召唤
  const caster2 = makeGroup(1, 4, 1, { skills: [], x: 0, y: 0 });
  caster2.activeSkill = { type: 'summon', cooldown: 30, ratio: 0.25, maxWarriors: 30 };
  caster2.skillCooldownTimer = 0;
  const groups2 = [caster2];
  SkillSystem.update(0.01, groups2, hexMap, []);
  assert(groups2[1].warriors === 3, `小队召唤下限 3 (实际 ${groups2[1].warriors})`);

  // 封顶: 大队召唤
  const caster3 = makeGroup(1, 200, 1, { skills: [], x: 0, y: 0 });
  caster3.activeSkill = { type: 'summon', cooldown: 30, ratio: 0.25, maxWarriors: 30 };
  caster3.skillCooldownTimer = 0;
  const groups3 = [caster3];
  SkillSystem.update(0.01, groups3, hexMap, []);
  assert(groups3[1].warriors === 30, `大队召唤封顶 30 (实际 ${groups3[1].warriors})`);

  // createSummon 工厂直接验证: 复制兵种系数
  const rich = makeGroup(1, 50, 5, { skills: [], attackCoeff: 2.5, attackRange: 2 });
  rich.pixelX = 77; rich.pixelY = 88;
  const summon = MarchGroup.createSummon(rich, 10, startTile);
  assert(summon._attackCoeff === 2.5 && summon.getAttackRange() === 2, '召唤物复制兵种系数与射程');
  assert(summon.pixelX === 77 && summon.pixelY === 88, '工厂召唤物出生于施法者位置');
  assert(summon.isAlive() && summon.state === 'marching', '召唤物状态正常');
}

// ============ 13. 伤害模型: cap 封顶与 minKill ============
console.log('=== 测试13: 伤害模型边界 ===');
{
  // 大战力打小队 → 封顶生效
  const boss = makeGroup(1, 1000, 1, { skills: [], attackCoeff: 1 });  // power 1000
  const tiny = makeGroup(2, 10, 1, { skills: [] });                     // PPW 1
  const kills = SkillSystem._dealDamage(boss, tiny, 0.55, 0.35);
  assert(kills === 3 && tiny.warriors === 7, `封顶 35%×10=3 (实际 kills=${kills}, 剩${tiny.warriors})`);

  // 极弱打大队 → minKill 保底 1（single 语义）
  const weak = makeGroup(1, 1, 1, { skills: [] });   // power 1
  const big = makeGroup(2, 100, 1, { skills: [] });
  const k2 = SkillSystem._dealDamage(weak, big, 0.55, 0.35, { minKill: 1 });
  assert(k2 === 1 && big.warriors === 99, `弱者 minKill=1 (实际 kills=${k2})`);

  // 无 minKill 时弱者 0 击杀（不显示伤害）
  const big2 = makeGroup(2, 100, 1, { skills: [] });
  const k3 = SkillSystem._dealDamage(weak, big2, 0.55, 0.35);
  assert(k3 === 0 && big2.warriors === 100, '无 minKill 弱者 → 0 击杀');

  // 目标已阵亡 → 0 且不崩溃
  const dead = makeGroup(2, 100, 1, { skills: [] });
  dead.state = 'destroyed';
  assert(SkillSystem._dealDamage(boss, dead, 0.55, 0.35) === 0, '已阵亡目标 → 0');

  // 击杀至 0 → destroyed; 击杀到 <3 → disbanded
  const t1 = makeGroup(2, 3, 1, { skills: [] });
  SkillSystem._dealDamage(boss, t1, 0.55, 0.35, { minKill: 5 });
  assert(t1.state === 'destroyed', '全灭 → destroyed');
  const t2 = makeGroup(2, 10, 1, { skills: [] });
  SkillSystem._dealDamage(boss, t2, 0.55, 0.35, { minKill: 8 });
  assert(t2.state === 'disbanded' && t2.warriors === 2, '剩2人 → disbanded');

  // 战力被动影响伤害: 攻击加成 50% → 击杀提升
  const buffed = makeGroup(1, 100, 1, {
    skills: [{ kind: 'passive', type: 'attack_bonus', value: 0.5 }],
  });
  const tgt = makeGroup(2, 100, 1, { skills: [] });
  // power=150 → floor(150×0.55/1)=82, 封顶 35 → 35（仍封顶）
  const k4 = SkillSystem._dealDamage(buffed, tgt, 0.55, 0.35);
  assert(k4 === 35, `被动加成战力仍受封顶约束 (实际 ${k4})`);
  const tgt2 = makeGroup(2, 1000, 1, { skills: [] });
  // power=150, PPW=1 → floor(82.5)=82, 封顶 350
  const k5 = SkillSystem._dealDamage(buffed, tgt2, 0.55, 0.35);
  assert(k5 === 82, `攻击被动+50% → 击杀 82 (实际 ${k5})`);
}

// ============ 14. 等级上限导出 ============
console.log('=== 测试14: 等级上限与技能轴耦合 ===');
{
  assert(MAX_UNIT_LEVEL === 20, 'MAX_UNIT_LEVEL = 20');
  assert([6, 12, 18].every((lv) => lv < MAX_UNIT_LEVEL), '技能轴 6/12/18 全部落在 20 级以内');
}

console.log(`\n========== 结果: ${passed} 通过, ${failed} 失败 ==========`);
process.exit(failed > 0 ? 1 : 0);
