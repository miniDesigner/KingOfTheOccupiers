/**
 * cloudfunctions/shared/settle-core.js — 服务端权威结算核心（镜像 server/services/profile.js）
 *
 * 把 profile.js 里的 _grantBattleRewards / _recordBattleResult / settleProfile 平移到云函数，
 * 纯函数部分（LadderSystem）复用 shared/LadderSystem.js。
 * 结算只信任「胜负 + 模式 + 难度 + 对手奖杯」，货币/奖杯由服务端重算（防作弊）。
 */

const Ladder = require('./LadderSystem.js');

// 与 server/config.js CURRENCY_CAPS 一致（8 位货币上限）
const CURRENCY_CAPS = { gold: 99999999, diamond: 99999999, stardust: 99999999 };

/** 给纯对象挂 addCurrency（模拟客户端 PlayerProfile 封顶加法） */
function attachCurrency(p) {
  p.addCurrency = (type, amount) => {
    p[type] = Math.min((p[type] || 0) + amount, CURRENCY_CAPS[type] || Infinity);
  };
  return p;
}

/** 战斗奖励（镜像客户端 grantBattleRewards 货币部分） */
function grantBattleRewards(p, isWin) {
  let totalGold, totalStardust;
  if (isWin) {
    totalGold = 80 + Math.floor(Math.random() * 40);
    totalStardust = 3 + Math.floor(Math.random() * 3);
    if ((p.pvpWinStreak || 0) >= 3) { totalStardust += 2; totalGold += 20; }
    if ((p.pvpWinStreak || 0) >= 5) { totalStardust += 3; totalGold += 30; }
  } else {
    totalGold = 15 + Math.floor(Math.random() * 15);
    totalStardust = 1;
  }
  p.addCurrency('gold', Math.round(totalGold));
  p.addCurrency('stardust', totalStardust);
  return { gold: Math.round(totalGold), stardust: totalStardust };
}

/** 记录战绩（镜像客户端 recordBattleResult） */
function recordBattleResult(p, isWin) {
  p.totalGames = (p.totalGames || 0) + 1;
  if (isWin) {
    p.totalWins = (p.totalWins || 0) + 1;
    p.pvpWins = (p.pvpWins || 0) + 1;
    p.pvpWinStreak = (p.pvpWinStreak || 0) + 1;
    p.pvpMaxStreak = Math.max(p.pvpMaxStreak || 0, p.pvpWinStreak);
  } else {
    p.pvpLosses = (p.pvpLosses || 0) + 1;
    p.pvpWinStreak = 0;
  }
  p.lastPlayDate = new Date().toISOString().slice(0, 10);
}

/**
 * 权威结算（防作弊核心）
 * @param {object} p        已 hydrate 的存档对象（含 addCurrency）
 * @param {object} body     { result, mode, difficulty, oppTrophies, power }
 * @returns 权威结果（客户端以此覆盖本地）
 */
function settle(p, body) {
  const result = body.result === 'win' ? 'win' : 'lose';
  const mode = body.mode || 'ai';
  const difficulty = body.difficulty || 'normal';
  const isWin = result === 'win';

  const rewards = grantBattleRewards(p, isWin);
  recordBattleResult(p, isWin);

  const isPvp = mode === 'realtime' || mode === 'snapshot';
  const ladder = isPvp
    ? Ladder.settlePvp(p, isWin, typeof body.oppTrophies === 'number' ? body.oppTrophies : null)
    : Ladder.settle(p, isWin, difficulty);

  const opp = isPvp ? 'pvp' : difficulty;
  return {
    result,
    mode,
    opp: isPvp && typeof body.oppTrophies === 'number' ? `pvp@${body.oppTrophies}` : opp,
    trophiesDelta: ladder.delta,
    rewards: {
      gold: rewards.gold,
      stardust: rewards.stardust,
      isWin,
      trophyDelta: ladder.delta,
      trophies: ladder.trophies,
      tier: ladder.tierTo.key,
      tierUp: ladder.tierUp,
      tierDown: ladder.tierDown,
      tierUpRewardText: ladder.tierRewards.length
        ? ladder.tierRewards.map(r => `${r.icon}${r.tier} ${Ladder.rewardText({ gold: r.gold, stardust: r.stardust, diamond: r.diamond })}`).join('；')
        : '',
    },
    profile: p,
  };
}

module.exports = { CURRENCY_CAPS, attachCurrency, grantBattleRewards, recordBattleResult, settle };
