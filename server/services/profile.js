/**
 * services/profile.js — 存档读写 + 服务端权威结算
 *
 * 核心：结算只信任「胜负 + 模式 + 对手」，货币/奖杯增减由服务端用
 * shared/meta/LadderSystem 同款纯函数重算，客户端不能自改货币（防作弊）。
 */
import * as dao from '../db/dao.js';
import { settle as ladderSettle, settlePvp as ladderSettlePvp, getTier, rewardText } from '../shared/meta/LadderSystem.js';

// 与 server/config.js CURRENCY_CAPS 一致（profile 服务单文件内联，避免循环导入）
const CURRENCY_CAPS = { gold: 99999999, diamond: 99999999, stardust: 99999999 };

/** 给纯对象挂 addCurrency（模拟客户端 PlayerProfile 的封顶加法） */
function attachCurrency(p) {
  p.addCurrency = (type, amount) => {
    p[type] = Math.min((p[type] || 0) + amount, CURRENCY_CAPS[type] || Infinity);
  };
  return p;
}

/** 拉取存档 */
export function getProfile(uid) {
  const row = dao.getProfile(uid);
  if (!row) return { version: 0, data: null };
  return { version: row.version, data: JSON.parse(row.data), updatedAt: row.updated_at };
}

/**
 * 推送存档（乐观锁）
 * @param {string} uid
 * @param {{version:number, data:object, power?:number}} body
 */
export function putProfile(uid, body) {
  const { version, data, power } = body;
  if (!data || typeof data !== 'object') throw httpError(400, 'invalid profile data');

  const existing = dao.getProfile(uid);
  const expectedVersion = (existing ? version : -1); // 首存允许无版本号
  const res = dao.upsertProfile(uid, data, typeof expectedVersion === 'number' ? expectedVersion : -1);

  if (!res.ok) {
    throw httpError(409, 'profile version conflict', { serverVersion: res.version });
  }

  dao.syncRedundantColumns(uid, data, power);
  return { version: res.version };
}

/**
 * 服务端权威结算（防作弊核心）
 * @param {string} uid
 * @param {{result:string, mode:string, difficulty?:string, oppTrophies?:number|null, power?:number}} body
 */
export function settleProfile(uid, body) {
  const result = body.result === 'win' ? 'win' : 'lose';
  const mode = body.mode || 'ai';
  const difficulty = body.difficulty || 'normal';
  const isWin = result === 'win';

  const account = dao.getAccountById(uid);
  if (!account) throw httpError(404, 'account not found');
  if (account.status === 'banned') throw httpError(403, 'account banned');

  // 读取并 hydrate 存档
  const row = dao.getProfile(uid);
  const data = row ? JSON.parse(row.data) : {};
  const p = attachCurrency(data);

  // 1. 战斗奖励（镜像客户端 grantBattleRewards / grantPvpRewards）
  const rewards = _grantBattleRewards(p, isWin);

  // 2. 记录战绩（镜像 recordBattleResult）
  _recordBattleResult(p, isWin);

  // 3. 天梯结算：realtime/snapshot 走 Elo，ai 走难度档
  const isPvp = mode === 'realtime' || mode === 'snapshot';
  const ladder = isPvp
    ? ladderSettlePvp(p, isWin, typeof body.oppTrophies === 'number' ? body.oppTrophies : null)
    : ladderSettle(p, isWin, difficulty);

  // 4. 权威写回（绕过乐观锁，服务端是真相源）
  const version = dao.writeProfileAuthoritative(uid, p);

  // 5. 同步冗余列 + 对局记录
  dao.syncRedundantColumns(uid, p, typeof body.power === 'number' ? body.power : undefined);
  const opp = isPvp ? 'pvp' : difficulty;
  dao.insertMatch({
    accountId: uid,
    mode,
    result,
    opp: isPvp && typeof body.oppTrophies === 'number' ? `pvp@${body.oppTrophies}` : opp,
    trophiesDelta: ladder.delta,
  });

  // 6. 返回权威结果（客户端以此覆盖本地）
  return {
    version,
    result,
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
        ? ladder.tierRewards.map(r => `${r.icon}${r.tier} ${rewardText({ gold: r.gold, stardust: r.stardust, diamond: r.diamond })}`).join('；')
        : '',
    },
    profile: p,
  };
}

/** 战斗奖励（镜像客户端 grantBattleRewards 的货币部分） */
function _grantBattleRewards(p, isWin) {
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
function _recordBattleResult(p, isWin) {
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

export function httpError(status, message, extra = null) {
  const e = new Error(message);
  e.status = status;
  if (extra) e.extra = extra;
  return e;
}

export { getTier };
