/**
 * 技能配置生成脚本（确定性）
 *
 * 生成 config/skills.json：
 *   - 40 玩家兵种（deployables.json units）× 6 技能 = 240
 *   - 24 敌方种族单位（races.json 6种族 × 4级）× 6 技能 = 144
 *   每兵种 6 技能 = 蓝色被动×3（默认解锁）+ 紫色被动×2（Lv6/Lv12 解锁）+ 橙色主动×1（Lv18 解锁）
 *
 * 命名与类型选择均由 unitId 的 FNV-1a 哈希驱动，同输入必产出同输出。
 *
 * 用法：node tools/gen-skills.mjs
 */

import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

const deployables = JSON.parse(readFileSync(join(ROOT, 'config/deployables.json'), 'utf8'));
const races = JSON.parse(readFileSync(join(ROOT, 'config/races.json'), 'utf8'));

// ==================== 确定性哈希 ====================

/** FNV-1a → [0,1) 确定性伪随机 */
function hash01(str, salt = '') {
  let h = 2166136261;
  const s = str + '#' + salt;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 1000000) / 1000000;
}

/** 从数组确定性选取 */
function pick(arr, key, salt) {
  return arr[Math.floor(hash01(key, salt) * arr.length) % arr.length];
}

// ==================== 被动技能池 ====================
// type 对应 MarchGroup.skillBonuses 聚合键 / unitSpecial 兼容类型
// 品质：3=稀有(蓝)被动  4=史诗(紫)被动  5=传说(橙)主动

const PASSIVE_BLUE = [
  { type: 'attack_bonus', value: 0.06 },
  { type: 'damage_bonus', value: 0.06 },
  { type: 'crit_bonus', value: 0.05 },
  { type: 'crit_damage', value: 0.15 },
  { type: 'damage_reduction', value: 0.05 },
  { type: 'damage_reflect', value: 0.10 },
  { type: 'armor_pierce', value: 0.30 },
  { type: 'spell_damage', value: 0.10 },
  { type: 'execute_bonus', value: 0.20 },
  { type: 'kill_bonus', value: 0.03 },
  { type: 'post_battle_heal', value: 0.05 },
  { type: 'splash', value: 0.15 },
  { type: 'speed_bonus', value: 0.05 },
];

const PASSIVE_PURPLE = [
  { type: 'attack_bonus', value: 0.12 },
  { type: 'damage_bonus', value: 0.12 },
  { type: 'crit_bonus', value: 0.10 },
  { type: 'crit_damage', value: 0.30 },
  { type: 'damage_reduction', value: 0.10 },
  { type: 'damage_reflect', value: 0.20 },
  { type: 'armor_pierce', value: 0.50 },
  { type: 'spell_damage', value: 0.20 },
  { type: 'execute_bonus', value: 0.40 },
  { type: 'kill_bonus', value: 0.06 },
  { type: 'post_battle_heal', value: 0.10 },
  { type: 'splash', value: 0.30 },
  { type: 'speed_bonus', value: 0.10 },
  { type: 'first_strike', value: 1 },
  { type: 'revive', value: 0.15, count: 2 },
];

// 战斗风格偏好：按兵种主风格加权选择被动类型池（排序优先）
const STYLE_PREF = {
  melee: ['attack_bonus', 'damage_bonus', 'damage_reflect', 'damage_reduction', 'crit_damage', 'execute_bonus', 'kill_bonus', 'crit_bonus', 'speed_bonus', 'post_battle_heal', 'armor_pierce', 'splash', 'spell_damage'],
  defense: ['damage_reduction', 'damage_reflect', 'post_battle_heal', 'attack_bonus', 'damage_bonus', 'kill_bonus', 'speed_bonus', 'crit_bonus', 'crit_damage', 'execute_bonus', 'armor_pierce', 'splash', 'spell_damage'],
  ranged: ['crit_bonus', 'armor_pierce', 'crit_damage', 'attack_bonus', 'execute_bonus', 'damage_bonus', 'speed_bonus', 'splash', 'kill_bonus', 'damage_reduction', 'damage_reflect', 'post_battle_heal', 'spell_damage'],
  magic: ['spell_damage', 'crit_bonus', 'crit_damage', 'splash', 'damage_bonus', 'attack_bonus', 'post_battle_heal', 'execute_bonus', 'armor_pierce', 'damage_reduction', 'kill_bonus', 'speed_bonus', 'damage_reflect'],
};

// ==================== 主动技能池（橙色，7 类）====================

const ACTIVES = {
  single: { cooldown: 20, power: 0.55, cap: 0.35 },
  aoe: { cooldown: 26, power: 0.35, radius: 2.5, cap: 0.18 },
  pierce: { cooldown: 24, power: 0.30, cap: 0.20, length: 4.0, width: 1.2 },
  ray: { cooldown: 22, power: 0.28, cap: 0.20, range: 6.0, width: 0.8 },
  taunt: { cooldown: 25, duration: 4.0, radius: 3.0 },
  dash: { cooldown: 18, speedMult: 3.0, duration: 3.0 },
  summon: { cooldown: 30, ratio: 0.25, maxWarriors: 30 },
};

// 主动类型按主风格分配
const ACTIVE_BY_STYLE = {
  melee: ['dash', 'taunt', 'summon', 'pierce', 'single'],
  defense: ['taunt', 'summon', 'dash', 'pierce', 'single'],
  ranged: ['ray', 'single', 'aoe', 'pierce', 'dash'],
  magic: ['aoe', 'ray', 'single', 'summon', 'pierce'],
};

// ==================== 技能命名池 ====================

const NAMES_BLUE = {
  attack_bonus: ['战意激发', '锋刃磨砺', '强袭姿态', '威吓怒吼'],
  damage_bonus: ['破甲强击', '重击训练', '猛攻战术', '撕裂打击'],
  crit_bonus: ['弱点洞察', '精准打击', '致命瞄准', '破绽捕捉'],
  crit_damage: ['会心强化', '致命一击', '狂暴连击', '怒意爆发'],
  damage_reduction: ['坚守姿态', '铁壁格挡', '厚重护甲', '稳固阵型'],
  damage_reflect: ['荆棘反甲', '尖刺护体', '以牙还牙', '反震力场'],
  armor_pierce: ['破甲专精', '穿透打击', '锋锐穿刺', '装甲克星'],
  spell_damage: ['奥术共鸣', '秘法增幅', '元素亲和', '辉光加持'],
  execute_bonus: ['背水一战', '绝境反击', '浴血奋战', '不屈战魂'],
  kill_bonus: ['战斗狂热', '越战越勇', '杀戮渴望', '血战经验'],
  post_battle_heal: ['战地急救', '休整恢复', '顽强体魄', '重整旗鼓'],
  splash: ['横扫攻击', '范围压制', '飞溅碎片', '溅射武器'],
  speed_bonus: ['轻装疾行', '疾风步伐', '快速机动', '迅捷冲锋'],
};

const NAMES_PURPLE = {
  attack_bonus: ['狂战血脉', '王者之师', '战魂觉醒', '究极武装'],
  damage_bonus: ['毁灭打击', '无双乱舞', '战术大师', '绝对力量'],
  crit_bonus: ['死亡标记', '猎杀本能', '精准专精', '影袭直觉'],
  crit_damage: ['斩首打击', '处决艺术', '暴虐本能', '灭杀一击'],
  damage_reduction: ['不坏金身', '圣盾庇护', '巍然不动', '绝对防御'],
  damage_reflect: ['荆棘壁垒', '苦痛返还', '镜面反噬', '报复风暴'],
  armor_pierce: ['无视防御', '洞穿一切', '龙牙穿击', '破城重锤'],
  spell_damage: ['禁咒精通', '魔力洪流', '元素主宰', '大魔导'],
  execute_bonus: ['修罗战场', '孤注一掷', '血性狂潮', '不灭斗志'],
  kill_bonus: ['百战老兵', '杀戮艺术', '战神加护', '嗜血本能'],
  post_battle_heal: ['不死军团', '再生之力', '生命涌动', '神圣祝福'],
  splash: ['天崩地裂', '全面压制', '弹幕风暴', '大范围杀伤'],
  speed_bonus: ['神行太保', '迅影疾风', '极速行军', '闪电突袭'],
  first_strike: ['先发制人'],
  revive: ['不朽意志', '涅槃重生', '死亡抗拒', '英灵归返'],
};

const NAMES_ACTIVE = {
  single: ['致命突刺', '弑神一击', '猎杀时刻', '绝命斩', '精准狙杀'],
  aoe: ['天降流星', '毁灭风暴', '裂地重击', '弹幕洗礼', '范围轰炸'],
  pierce: ['贯穿长枪', '破军穿刺', '无双贯刺', '锐不可当', '长驱直入'],
  ray: ['湮灭射线', '毁灭光束', '聚能炮击', '裂空之光', '灼热射线'],
  taunt: ['挑衅怒吼', '嘲讽战吼', '仇恨吸引', '无畏宣言', '狂妄挑衅'],
  dash: ['极速冲锋', '疾风突进', '瞬影突袭', '狂飙冲锋', '闪电冲刺'],
  summon: ['召唤援军', '呼唤同伴', '援军入场', '战场增援', '集结号令'],
};

// ==================== 描述模板 ====================

function passiveDesc(entry) {
  const v = entry.value;
  switch (entry.type) {
    case 'attack_bonus': return `全体被动：攻击力加成 +${Math.round(v * 100)}%`;
    case 'damage_bonus': return `全体被动：伤害加成 +${Math.round(v * 100)}%`;
    case 'crit_bonus': return `全体被动：暴击率 +${Math.round(v * 100)}%`;
    case 'crit_damage': return `全体被动：暴击伤害 +${Math.round(v * 100)}%`;
    case 'damage_reduction': return `全体被动：受到伤害减少 ${Math.round(v * 100)}%`;
    case 'damage_reflect': return `全体被动：反弹 ${Math.round(v * 100)}% 受到的伤害`;
    case 'armor_pierce': return `全体被动：无视目标 ${Math.round(v * 100)}% 护甲`;
    case 'spell_damage': return `全体被动：法术伤害加成 +${Math.round(v * 100)}%`;
    case 'execute_bonus': return `全体被动：残血(≤50%)时攻击 +${Math.round(v * 100)}%`;
    case 'kill_bonus': return `全体被动：每次击杀后攻击永久 +${Math.round(v * 100)}%`;
    case 'post_battle_heal': return `全体被动：战斗后回复 ${Math.round(v * 100)}% 初始兵力`;
    case 'splash': return `全体被动：溅射伤害 +${Math.round(v * 100)}%`;
    case 'speed_bonus': return `全体被动：行军速度 +${Math.round(v * 100)}%`;
    case 'first_strike': return `全体被动：遭遇战必定先手攻击`;
    case 'revive': return `全体被动：战后 ${Math.round(v * 100)}% 概率复活 ${entry.count || 1} 名战士`;
    default: return '被动技能';
  }
}

function activeDesc(type, p) {
  switch (type) {
    case 'single': return `主动技能：对最近的敌方队伍造成 ${Math.round(p.power * 100)}% 自身战力的爆发伤害（每${p.cooldown}秒自动释放，最多消灭${Math.round(p.cap * 100)}%兵力）`;
    case 'aoe': return `主动技能：对 ${p.radius} 格内所有敌方队伍各造成 ${Math.round(p.power * 100)}% 自身战力的范围伤害（每${p.cooldown}秒自动释放）`;
    case 'pierce': return `主动技能：向敌方阵地方向贯穿 ${p.length} 格直线上所有敌方队伍，各造成 ${Math.round(p.power * 100)}% 战力伤害（每${p.cooldown}秒自动释放）`;
    case 'ray': return `主动技能：向敌方阵地发射 ${p.range} 格射线的毁灭光束，命中直线上所有敌方队伍（每${p.cooldown}秒自动释放）`;
    case 'taunt': return `主动技能：嘲讽 ${p.radius} 格内敌方队伍 ${p.duration} 秒，强制其攻击本队（每${p.cooldown}秒自动释放）`;
    case 'dash': return `主动技能：行军速度提升至 ${p.speedMult} 倍持续 ${p.duration} 秒，快速突进战场（每${p.cooldown}秒自动释放）`;
    case 'summon': return `主动技能：召唤一支相当于本队 ${Math.round(p.ratio * 100)}% 兵力的援军（上限${p.maxWarriors}人，每${p.cooldown}秒自动释放）`;
    default: return '主动技能';
  }
}

// ==================== 单兵种技能生成 ====================

/**
 * 为一个兵种生成 6 个技能
 * @param {string} key - 兵种标识（unitId 或 race_level）
 * @param {object} unitCfg - 兵种配置（含 combatStyles）
 * @param {number} unitQuality - 兵种品质（玩家兵种用，敌方传 0）
 */
function genUnitSkills(key, unitCfg) {
  const styles = (unitCfg.combatStyles && unitCfg.combatStyles.length) ? unitCfg.combatStyles : ['melee'];
  const mainStyle = STYLE_PREF[styles[0]] ? styles[0] : 'melee';

  // --- 被动类型选择：按风格偏好排序 + 哈希扰动，取互不重复的类型 ---
  function selectPassives(pool, count, salt) {
    const pref = STYLE_PREF[mainStyle];
    const scored = pool.map((p) => {
      const prefRank = pref.indexOf(p.type);
      const jitter = hash01(key, salt + p.type) * 6; // 哈希扰动保证多样性
      return { p, score: (prefRank >= 0 ? prefRank : 13) + jitter };
    });
    scored.sort((a, b) => a.score - b.score);
    return scored.slice(0, count).map((s) => s.p);
  }

  const blueDefs = selectPassives(PASSIVE_BLUE, 3, 'blue');
  const purpleDefs = selectPassives(PASSIVE_PURPLE, 2, 'purple');

  // --- 主动类型选择 ---
  const activeTypes = ACTIVE_BY_STYLE[mainStyle] || ACTIVE_BY_STYLE.melee;
  const activeType = pick(activeTypes, key, 'active');

  // --- 组装技能条目 ---
  const skills = [];

  blueDefs.forEach((def, i) => {
    skills.push({
      id: `${key}_b${i + 1}`,
      name: pick(NAMES_BLUE[def.type], key, 'bn' + def.type + i),
      quality: 3,
      kind: 'passive',
      type: def.type,
      value: def.value,
      ...(def.count !== undefined ? { count: def.count } : {}),
      unlockLevel: 1,
      desc: passiveDesc(def),
    });
  });

  purpleDefs.forEach((def, i) => {
    skills.push({
      id: `${key}_p${i + 1}`,
      name: pick(NAMES_PURPLE[def.type], key, 'pn' + def.type + i),
      quality: 4,
      kind: 'passive',
      type: def.type,
      value: def.value,
      ...(def.count !== undefined ? { count: def.count } : {}),
      unlockLevel: i === 0 ? 6 : 12,
      desc: passiveDesc(def),
    });
  });

  const activeParams = ACTIVES[activeType];
  skills.push({
    id: `${key}_o1`,
    name: pick(NAMES_ACTIVE[activeType], key, 'an' + activeType),
    quality: 5,
    kind: 'active',
    type: activeType,
    ...activeParams,
    unlockLevel: 18,
    desc: activeDesc(activeType, activeParams),
  });

  return skills;
}

// ==================== 主流程 ====================

const units = {};
let playerCount = 0;
for (const [unitId, cfg] of Object.entries(deployables.units || {})) {
  if (unitId.startsWith('_') || typeof cfg !== 'object') continue;
  units[unitId] = genUnitSkills(unitId, cfg);
  playerCount++;
}

const raceUnits = {};
let enemyCount = 0;
// races.json 顶层即种族对象（human/beast/...，以 _ 开头的为文档字段）
for (const [race, rd] of Object.entries(races)) {
  if (race.startsWith('_') || typeof rd !== 'object' || !rd.units) continue;
  for (const [lvlKey, ucfg] of Object.entries(rd.units || {})) {
    if (lvlKey.startsWith('_') || typeof ucfg !== 'object') continue;
    const key = `${race}_${lvlKey}`;
    raceUnits[key] = genUnitSkills(key, ucfg);
    enemyCount++;
  }
}

const output = {
  _doc: [
    '兵种技能配置表（由 tools/gen-skills.mjs 确定性生成，勿手改——改生成脚本后重跑）',
    '结构：每个兵种 6 技能 = 蓝色被动×3(默认解锁) + 紫色被动×2(Lv6/Lv12解锁) + 橙色主动×1(Lv18解锁)',
    '品质对应：3=稀有(蓝) 4=史诗(紫) 5=传说(橙)；主动技能战斗中冷却到了自动定时释放',
    '玩家兵种解锁：蓝默认 / 紫 Lv.6、Lv.12 / 橙 Lv.18（兵种品质≥5 默认解锁橙色主动）',
    '敌方种族单位解锁（按AI难度档位）：easy=仅蓝色 / normal=+紫1 / hard=+紫2 / nightmare=全解锁',
    'units: 玩家兵种（key=deployables.json unitId）；raceUnits: 敌方种族单位（key=种族_兵营等级）',
  ].join('\n'),
  unlockRules: {
    maxUnitLevel: 20,
    orangeQualityAutoUnlock: 5,
    unlockLevels: { purple1: 6, purple2: 12, orange: 18 },
  },
  enemyDifficultyTiers: { easy: 0, normal: 1, hard: 2, nightmare: 3 },
  units,
  raceUnits,
};

const outPath = join(ROOT, 'config/skills.json');
writeFileSync(outPath, JSON.stringify(output, null, 2) + '\n', 'utf8');

// ==================== 校验统计 ====================

let total = 0, actives = 0, purpleCount = 0, blueCount = 0;
const activeTypeDist = {};
for (const skills of [...Object.values(units), ...Object.values(raceUnits)]) {
  for (const s of skills) {
    total++;
    if (s.kind === 'active') {
      actives++;
      activeTypeDist[s.type] = (activeTypeDist[s.type] || 0) + 1;
    } else if (s.quality === 4) purpleCount++;
    else if (s.quality === 3) blueCount++;
  }
}

console.log(`✅ 生成 ${outPath}`);
console.log(`   玩家兵种: ${playerCount} | 敌方单位: ${enemyCount} | 总技能数: ${total}`);
console.log(`   蓝色被动: ${blueCount} | 紫色被动: ${purpleCount} | 橙色主动: ${actives}`);
console.log(`   主动类型分布:`, JSON.stringify(activeTypeDist));

// 断言：每兵种恰好 6 技能、2紫1橙、紫解锁档位 6/12、橙为 18
let issues = 0;
for (const [key, skills] of [...Object.entries(units), ...Object.entries(raceUnits)]) {
  if (skills.length !== 6) { console.error(`❌ ${key}: 技能数 ${skills.length} ≠ 6`); issues++; }
  const purples = skills.filter((s) => s.quality === 4 && s.kind === 'passive');
  const oranges = skills.filter((s) => s.kind === 'active');
  if (purples.length !== 2) { console.error(`❌ ${key}: 紫色被动 ${purples.length} ≠ 2`); issues++; }
  if (oranges.length !== 1 || oranges[0].quality !== 5) { console.error(`❌ ${key}: 橙色主动异常`); issues++; }
  const ul = skills.map((s) => s.unlockLevel);
  if (ul.filter((x) => x === 6).length !== 1 || ul.filter((x) => x === 12).length !== 1 || ul.filter((x) => x === 18).length !== 1) {
    console.error(`❌ ${key}: 解锁档位异常 [${ul}]`); issues++;
  }
  // 技能名同兵种内不重复
  const names = skills.map((s) => s.name);
  if (new Set(names).size !== names.length) { console.error(`❌ ${key}: 技能名重复`); issues++; }
}
if (issues > 0) { console.error(`❌ 校验失败：${issues} 处问题`); process.exit(1); }
console.log(`✅ 结构校验通过（每兵种 3蓝+2紫+1橙，解锁档位 1/1/1/6/12/18，命名无重复）`);
