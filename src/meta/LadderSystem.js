/**
 * LadderSystem — 天梯段位系统（外部对战成长线）
 *
 * 核心机制：
 *  1. 奖杯积分：胜利按对手难度获得（强敌多得），失败按对手难度扣除（输给强敌扣得少）
 *  2. 8 段位：青铜→王者，晋段一次性奖励（每档只发一次，存档内持久）
 *  3. 保段保护：到达段位后失败不会跌破该段位下限（奖杯停在段底）
 *  4. 对手匹配：按当前奖杯决定 AI 难度分布（低段打简单AI，高段强制强敌）
 *  5. 赛季：7 天一季，赛季末按本赛季最高奖杯发奖励，奖杯软重置回落 60%
 *
 * 纯函数模块：不持有状态，所有数据存在 PlayerProfile 上
 */

import { battleRandom } from '../utils/rng.js';

// ==================== 段位表 ====================
// reward: 晋段一次性奖励（每档终身一次，claimedTierRewards 记录）
export const TIERS = [
  { key: 'bronze',      label: '青铜', icon: '🛡', min: 0,    color: '#b45309', reward: null },
  { key: 'silver',      label: '白银', icon: '⚪', min: 200,  color: '#94a3b8', reward: { gold: 300 } },
  { key: 'gold',        label: '黄金', icon: '🟡', min: 400,  color: '#fbbf24', reward: { gold: 500, stardust: 20 } },
  { key: 'platinum',    label: '铂金', icon: '💠', min: 700,  color: '#22d3ee', reward: { diamond: 50 } },
  { key: 'diamond',     label: '钻石', icon: '💎', min: 1000, color: '#60a5fa', reward: { diamond: 80, stardust: 40 } },
  { key: 'master',      label: '大师', icon: '🔮', min: 1300, color: '#a78bfa', reward: { diamond: 120 } },
  { key: 'grandmaster', label: '宗师', icon: '👁', min: 1600, color: '#fb923c', reward: { diamond: 180, stardust: 80 } },
  { key: 'king',        label: '王者', icon: '👑', min: 1900, color: '#ef4444', reward: { diamond: 300 } },
];

// ==================== 奖杯增减表 ====================
// 胜利获得区间 / 失败固定扣除（输给强敌惩罚轻，鼓励向上挑战）
const WIN_GAIN = {
  easy:      [18, 24],
  normal:    [26, 32],
  hard:      [34, 40],
  nightmare: [45, 55],
};
const LOSS_PENALTY = {
  easy: 22,
  normal: 20,
  hard: 18,
  nightmare: 15,
};
// 连胜加成：每 1 连胜 +3，上限 +15
const STREAK_BONUS_PER = 3;
const STREAK_BONUS_MAX = 15;

// ==================== 赛季配置 ====================
export const SEASON_DAYS = 7;
// 赛季末奖励（按本赛季最高奖杯达到的段位发放，每季一次）
const SEASON_REWARDS = [
  { gold: 200 },                    // 青铜
  { gold: 400, diamond: 20 },       // 白银
  { gold: 600, diamond: 40 },       // 黄金
  { diamond: 60 },                  // 铂金
  { diamond: 100 },                 // 钻石
  { diamond: 150 },                 // 大师
  { diamond: 200 },                 // 宗师
  { diamond: 300 },                 // 王者
];
// 软重置：奖杯回落到 60%
const SOFT_RESET_RATIO = 0.6;

// ==================== 段位判定 ====================

/**
 * 获取奖杯对应段位（含 index）
 */
export function getTier(trophies) {
  let idx = 0;
  for (let i = TIERS.length - 1; i >= 0; i--) {
    if (trophies >= TIERS[i].min) { idx = i; break; }
  }
  return { ...TIERS[idx], index: idx };
}

/**
 * 距下一段位进度
 * @returns {{ratio:number, cur:number, need:number, next:object|null, tier:object}}
 */
export function getProgress(trophies) {
  const tier = getTier(trophies);
  const next = TIERS[tier.index + 1] || null;
  if (!next) return { ratio: 1, cur: trophies, need: trophies, next: null, tier };
  const span = next.min - tier.min;
  const ratio = Math.max(0, Math.min(1, (trophies - tier.min) / span));
  return { ratio, cur: trophies, need: next.min, next, tier };
}

// ==================== 奖杯结算 ====================

/**
 * 计算单场奖杯变化（不落库）
 * @param {boolean} isWin
 * @param {string} difficulty - 对手 AI 难度 easy/normal/hard/nightmare
 * @param {number} winStreak - 赛前连胜数（用于连胜加成）
 */
export function calcTrophyChange(isWin, difficulty, winStreak = 0) {
  if (isWin) {
    const [lo, hi] = WIN_GAIN[difficulty] || WIN_GAIN.normal;
    let delta = lo + Math.floor(Math.random() * (hi - lo + 1));
    const streakBonus = Math.min(STREAK_BONUS_MAX, Math.max(0, winStreak) * STREAK_BONUS_PER);
    return { delta: delta + streakBonus, streakBonus };
  }
  return { delta: -(LOSS_PENALTY[difficulty] || LOSS_PENALTY.normal), streakBonus: 0 };
}

/**
 * 天梯结算（胜利/失败统一入口，AI 对战用）
 * 规则：
 *  - 失败扣奖杯但不扣任何货币；奖杯下限 0
 *  - 保段保护：扣后不跌破结算前所在段位的下限
 *  - 晋段：跨段时逐段发放一次性奖励（claimedTierRewards 去重）
 *  - highestTrophies 同步刷新（赛季最高）
 * @param {PlayerProfile} profile
 * @returns {{delta:number, streakBonus:number, trophies:number, oldTrophies:number,
 *            tierFrom:object, tierTo:object, tierUp:boolean, tierDown:boolean,
 *            protected:boolean, tierRewards:Array}}
 */
export function settle(profile, isWin, difficulty = 'normal') {
  const oldTrophies = profile.trophies || 0;
  const tierFrom = getTier(oldTrophies);
  const { delta, streakBonus } = calcTrophyChange(isWin, difficulty, profile.pvpWinStreak || 0);
  return _commitTrophies(profile, oldTrophies, tierFrom, delta, streakBonus);
}

// ==================== 真人 PvP Elo 结算 ====================
// 与 AI 对战（按难度档位增减）不同，真人 PvP 用经典 Elo 公式：按双方奖杯分差算预期胜率，
// 弱胜强得更多、强输弱扣更多，鼓励公平竞技。K=32 标准档，配合最小流动 ±10 保证体感。

const ELO_K = 32;
const ELO_MIN_FLOW = 10;

/**
 * 计算单场 Elo 奖杯变化（不落库）
 * @param {boolean} isWin
 * @param {number} myTrophies 我方奖杯
 * @param {number} oppTrophies 对手奖杯
 */
export function calcEloDelta(isWin, myTrophies, oppTrophies) {
  const expected = 1 / (1 + Math.pow(10, (oppTrophies - myTrophies) / 400));
  const score = isWin ? 1 : 0;
  const raw = Math.round(ELO_K * (score - expected));
  const magnitude = Math.max(ELO_MIN_FLOW, Math.abs(raw));
  return (isWin ? 1 : -1) * magnitude;
}

/**
 * 真人 PvP 天梯结算（Elo 公式 + 连胜加成 + 保段/晋段，复用 AI 结算的落库逻辑）
 * @param {PlayerProfile} profile
 * @param {boolean} isWin
 * @param {number|null} oppTrophies 对手奖杯（未知时按同段位 expected=0.5）
 */
export function settlePvp(profile, isWin, oppTrophies = null) {
  const oldTrophies = profile.trophies || 0;
  const tierFrom = getTier(oldTrophies);
  const opp = (typeof oppTrophies === 'number') ? oppTrophies : oldTrophies;
  const elo = calcEloDelta(isWin, oldTrophies, opp);
  const streakBonus = isWin
    ? Math.min(STREAK_BONUS_MAX, Math.max(0, profile.pvpWinStreak || 0) * STREAK_BONUS_PER)
    : 0;
  return _commitTrophies(profile, oldTrophies, tierFrom, elo + streakBonus, streakBonus);
}

/**
 * 奖杯落库公共逻辑：把「最终奖杯变化（已含连胜加成）」写入 profile，处理保段保护 +
 * 晋段一次性奖励，返回统一结算结果结构（settle / settlePvp 共用）。
 */
function _commitTrophies(profile, oldTrophies, tierFrom, rawDelta, streakBonus) {
  let newTrophies = oldTrophies + rawDelta;
  let protectedFloor = false;
  if (newTrophies < 0) { newTrophies = 0; protectedFloor = true; }
  // 保段保护：失败不跌破结算前段位下限
  if (rawDelta < 0 && newTrophies < tierFrom.min) {
    newTrophies = tierFrom.min;
    protectedFloor = true;
  }

  profile.trophies = newTrophies;
  profile.highestTrophies = Math.max(profile.highestTrophies || 0, newTrophies);

  const tierTo = getTier(newTrophies);

  // 晋段一次性奖励（可能跨多段，逐段发放）
  const tierRewards = [];
  if (tierTo.index > tierFrom.index) {
    const claimed = profile.claimedTierRewards || (profile.claimedTierRewards = []);
    for (let i = tierFrom.index + 1; i <= tierTo.index; i++) {
      const t = TIERS[i];
      if (t.reward && !claimed.includes(t.key)) {
        claimed.push(t.key);
        if (t.reward.gold) profile.addCurrency('gold', t.reward.gold);
        if (t.reward.stardust) profile.addCurrency('stardust', t.reward.stardust);
        if (t.reward.diamond) profile.addCurrency('diamond', t.reward.diamond);
        tierRewards.push({ tier: t.label, icon: t.icon, ...t.reward });
      }
    }
  }

  return {
    delta: newTrophies - oldTrophies,
    rawDelta,
    streakBonus,
    trophies: newTrophies,
    oldTrophies,
    tierFrom, tierTo,
    tierUp: tierTo.index > tierFrom.index,
    tierDown: tierTo.index < tierFrom.index,
    protected: protectedFloor,
    tierRewards,
  };
}

// ==================== 对手匹配 ====================

/**
 * 按当前奖杯决定 AI 难度（替代纯随机）
 */
export function matchDifficulty(trophies, rand = battleRandom()) {
  let dist;
  if (trophies < 200)       dist = { easy: 0.70, normal: 0.30, hard: 0, nightmare: 0 };
  else if (trophies < 600)  dist = { easy: 0.35, normal: 0.45, hard: 0.20, nightmare: 0 };
  else if (trophies < 1000) dist = { easy: 0, normal: 0.45, hard: 0.45, nightmare: 0.10 };
  else if (trophies < 1400) dist = { easy: 0, normal: 0, hard: 0.60, nightmare: 0.40 };
  else                      dist = { easy: 0, normal: 0, hard: 0.35, nightmare: 0.65 };
  let acc = 0;
  for (const [diff, p] of Object.entries(dist)) {
    acc += p;
    if (rand < acc) return diff;
  }
  return 'normal';
}

// ==================== 赛季 ====================

/** 一天毫秒数 */
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * 初始化/确保赛季字段存在
 */
export function ensureSeason(profile) {
  if (!profile.seasonStart) {
    profile.seasonStart = new Date().toISOString().slice(0, 10);
  }
  if (!profile.seasonNumber) profile.seasonNumber = 1;
  if (!Array.isArray(profile.seasonHistory)) profile.seasonHistory = [];
}

/**
 * 赛季剩余天数（向上取整，最小 1）
 */
export function seasonDaysLeft(profile) {
  ensureSeason(profile);
  const start = new Date(profile.seasonStart + 'T00:00:00').getTime();
  const elapsed = Date.now() - start;
  return Math.max(1, Math.ceil((SEASON_DAYS * DAY_MS - elapsed) / DAY_MS));
}

/**
 * 检查并结算到期赛季
 * - 按本赛季最高奖杯段位发放赛季奖励
 * - 奖杯软重置回落 60%（保段下限不适用，重置可跨段回落）
 * - highestTrophies 重置为重置后的奖杯数，开始新赛季
 * @returns {null|{season:number, highestTrophies:number, tier:object, rewards:object, resetTo:number}}
 */
export function checkSeasonEnd(profile) {
  ensureSeason(profile);
  const start = new Date(profile.seasonStart + 'T00:00:00').getTime();
  if (Date.now() - start < SEASON_DAYS * DAY_MS) return null;

  const highest = profile.highestTrophies || 0;
  const tier = getTier(highest);
  const rewards = { ...(SEASON_REWARDS[tier.index] || SEASON_REWARDS[0]) };
  if (rewards.gold) profile.addCurrency('gold', rewards.gold);
  if (rewards.stardust) profile.addCurrency('stardust', rewards.stardust);
  if (rewards.diamond) profile.addCurrency('diamond', rewards.diamond);

  // 软重置
  const resetTo = Math.max(0, Math.floor((profile.trophies || 0) * SOFT_RESET_RATIO));
  profile.trophies = resetTo;
  profile.highestTrophies = resetTo;

  const record = {
    season: profile.seasonNumber,
    highestTrophies: highest,
    tierLabel: tier.label,
    tierIcon: tier.icon,
    rewards,
    resetTo,
  };
  profile.seasonHistory.push(record);
  profile.seasonNumber++;
  profile.seasonStart = new Date().toISOString().slice(0, 10);
  return record;
}

/**
 * 奖励对象转可读文本
 */
export function rewardText(reward) {
  if (!reward) return '';
  const parts = [];
  if (reward.gold) parts.push('💰' + reward.gold);
  if (reward.stardust) parts.push('✨' + reward.stardust);
  if (reward.diamond) parts.push('💎' + reward.diamond);
  return parts.join(' ');
}
