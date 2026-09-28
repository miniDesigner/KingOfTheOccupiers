/**
 * shared/meta/LadderSystem.js — 服务端权威结算的段位纯函数副本
 *
 * 来源：territory-king-game/src/meta/LadderSystem.js（与客户端逐字节一致，除两处差异）：
 *   1. 移除 `import { battleRandom } from '../utils/rng.js'`（服务端无 rng.js）
 *   2. `matchDifficulty` 默认随机源由 battleRandom() 改为 Math.random()
 *
 * 其余函数（TIERS / getTier / getProgress / calcTrophyChange / settle / settlePvp /
 * calcEloDelta / checkSeasonEnd / rewardText）与客户端完全一致，保证
 * 「服务端算的段位 = 客户端显示的段位」。
 *
 * 维护铁律：客户端 meta/LadderSystem.js 改动时，必须同步本文件（tests/test-consistency 可断言）。
 */

// ==================== 段位表 ====================
const TIERS = [
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
const STREAK_BONUS_PER = 3;
const STREAK_BONUS_MAX = 15;

// ==================== 赛季配置 ====================
const SEASON_DAYS = 7;
const SEASON_REWARDS = [
  { gold: 200 },
  { gold: 400, diamond: 20 },
  { gold: 600, diamond: 40 },
  { diamond: 60 },
  { diamond: 100 },
  { diamond: 150 },
  { diamond: 200 },
  { diamond: 300 },
];
const SOFT_RESET_RATIO = 0.6;

// ==================== 段位判定 ====================

function getTier(trophies) {
  let idx = 0;
  for (let i = TIERS.length - 1; i >= 0; i--) {
    if (trophies >= TIERS[i].min) { idx = i; break; }
  }
  return { ...TIERS[idx], index: idx };
}

function getProgress(trophies) {
  const tier = getTier(trophies);
  const next = TIERS[tier.index + 1] || null;
  if (!next) return { ratio: 1, cur: trophies, need: trophies, next: null, tier };
  const span = next.min - tier.min;
  const ratio = Math.max(0, Math.min(1, (trophies - tier.min) / span));
  return { ratio, cur: trophies, need: next.min, next, tier };
}

// ==================== 奖杯结算 ====================

function calcTrophyChange(isWin, difficulty, winStreak = 0) {
  if (isWin) {
    const [lo, hi] = WIN_GAIN[difficulty] || WIN_GAIN.normal;
    let delta = lo + Math.floor(Math.random() * (hi - lo + 1));
    const streakBonus = Math.min(STREAK_BONUS_MAX, Math.max(0, winStreak) * STREAK_BONUS_PER);
    return { delta: delta + streakBonus, streakBonus };
  }
  return { delta: -(LOSS_PENALTY[difficulty] || LOSS_PENALTY.normal), streakBonus: 0 };
}

function settle(profile, isWin, difficulty = 'normal') {
  const oldTrophies = profile.trophies || 0;
  const tierFrom = getTier(oldTrophies);
  const { delta, streakBonus } = calcTrophyChange(isWin, difficulty, profile.pvpWinStreak || 0);
  return _commitTrophies(profile, oldTrophies, tierFrom, delta, streakBonus);
}

// ==================== 真人 PvP Elo 结算 ====================
const ELO_K = 32;
const ELO_MIN_FLOW = 10;

function calcEloDelta(isWin, myTrophies, oppTrophies) {
  const expected = 1 / (1 + Math.pow(10, (oppTrophies - myTrophies) / 400));
  const score = isWin ? 1 : 0;
  const raw = Math.round(ELO_K * (score - expected));
  const magnitude = Math.max(ELO_MIN_FLOW, Math.abs(raw));
  return (isWin ? 1 : -1) * magnitude;
}

function settlePvp(profile, isWin, oppTrophies = null) {
  const oldTrophies = profile.trophies || 0;
  const tierFrom = getTier(oldTrophies);
  const opp = (typeof oppTrophies === 'number') ? oppTrophies : oldTrophies;
  const elo = calcEloDelta(isWin, oldTrophies, opp);
  const streakBonus = isWin
    ? Math.min(STREAK_BONUS_MAX, Math.max(0, profile.pvpWinStreak || 0) * STREAK_BONUS_PER)
    : 0;
  return _commitTrophies(profile, oldTrophies, tierFrom, elo + streakBonus, streakBonus);
}

function _commitTrophies(profile, oldTrophies, tierFrom, rawDelta, streakBonus) {
  let newTrophies = oldTrophies + rawDelta;
  let protectedFloor = false;
  if (newTrophies < 0) { newTrophies = 0; protectedFloor = true; }
  if (rawDelta < 0 && newTrophies < tierFrom.min) {
    newTrophies = tierFrom.min;
    protectedFloor = true;
  }

  profile.trophies = newTrophies;
  profile.highestTrophies = Math.max(profile.highestTrophies || 0, newTrophies);

  const tierTo = getTier(newTrophies);

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

function matchDifficulty(trophies, rand = Math.random()) {
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

const DAY_MS = 24 * 60 * 60 * 1000;

function ensureSeason(profile) {
  if (!profile.seasonStart) {
    profile.seasonStart = new Date().toISOString().slice(0, 10);
  }
  if (!profile.seasonNumber) profile.seasonNumber = 1;
  if (!Array.isArray(profile.seasonHistory)) profile.seasonHistory = [];
}

function seasonDaysLeft(profile) {
  ensureSeason(profile);
  const start = new Date(profile.seasonStart + 'T00:00:00').getTime();
  const elapsed = Date.now() - start;
  return Math.max(1, Math.ceil((SEASON_DAYS * DAY_MS - elapsed) / DAY_MS));
}

function checkSeasonEnd(profile) {
  ensureSeason(profile);
  const start = new Date(profile.seasonStart + 'T00:00:00').getTime();
  if (Date.now() - start < SEASON_DAYS * DAY_MS) return null;

  const highest = profile.highestTrophies || 0;
  const tier = getTier(highest);
  const rewards = { ...(SEASON_REWARDS[tier.index] || SEASON_REWARDS[0]) };
  if (rewards.gold) profile.addCurrency('gold', rewards.gold);
  if (rewards.stardust) profile.addCurrency('stardust', rewards.stardust);
  if (rewards.diamond) profile.addCurrency('diamond', rewards.diamond);

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

function rewardText(reward) {
  if (!reward) return '';
  const parts = [];
  if (reward.gold) parts.push('💰' + reward.gold);
  if (reward.stardust) parts.push('✨' + reward.stardust);
  if (reward.diamond) parts.push('💎' + reward.diamond);
  return parts.join(' ');
}

// ==================== CommonJS 导出 ====================
module.exports = {
  TIERS,
  SEASON_DAYS,
  getTier,
  getProgress,
  calcTrophyChange,
  settle,
  calcEloDelta,
  settlePvp,
  matchDifficulty,
  ensureSeason,
  seasonDaysLeft,
  checkSeasonEnd,
  rewardText,
};
