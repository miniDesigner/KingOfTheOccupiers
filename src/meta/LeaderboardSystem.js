/**
 * LeaderboardSystem — 排行榜系统（Phase 5）
 *
 * 当前版本：本地排行榜
 *  - 玩家自身数据来自 PlayerProfile
 *  - 生成19个确定性伪竞争对手（基于玩家进度缩放），提供追赶目标
 *  - 三个榜单：战力榜 / 胜场榜 / 收集榜
 *
 * 微信小游戏接入扩展点（Phase 7）：
 *  - 真实好友榜：wx.setUserCloudStorage({ KVDataList: [{key:'power', value}] })
 *    + 开放数据域子包中调用 wx.getFriendCloudStorage 渲染
 *  - 本地伪对手可直接替换为好友数据，接口保持 getLeaderboard(sortBy) 不变
 */

import { get as getProfile } from './ProfileManager.js';

/** 伪对手名池（确定性截取） */
const RIVAL_NAMES = [
  '六边形霸主', '翻格狂魔', '兵法大师', '占领者X', '星尘收藏家',
  '连胜终结者', '策略之王', '建筑大亨', '骑兵统领', '抽卡欧皇',
  '大本营守护者', '快攻手', '塔防专家', '羁绊大师', '资源大亨',
  '史诗猎人', '神话追求者', '领主大人', '格子清道夫',
];

/** 榜单定义（tab顺序，天梯榜在前） */
export const BOARDS = [
  { key: 'ladder', label: '🏆 天梯榜', metric: 'trophies', unit: '杯' },
  { key: 'power', label: '⚔ 战力榜', metric: 'power', unit: '' },
  { key: 'wins', label: '🎖 胜场榜', metric: 'wins', unit: '胜' },
  { key: 'collect', label: '🃏 收集榜', metric: 'collect', unit: '/40' },
];

/**
 * 基于玩家数据确定性生成伪竞争对手
 * 用玩家核心指标做种子 → 相同进度下名单稳定
 */
function _buildRivals(playerStats) {
  // 简单可复现种子（LCG）
  let seed = (playerStats.power * 7 + playerStats.wins * 13 + playerStats.collect * 29 + 1) % 2147483647;
  const rand = () => {
    seed = (seed * 48271) % 2147483647;
    return seed / 2147483647;
  };

  const rivals = [];
  for (let i = 0; i < RIVAL_NAMES.length; i++) {
    // 分布：一半比玩家强（追赶目标），一半比玩家弱（超越感）
    const strength = rand(); // 0~1
    const factor = 0.35 + strength * 1.5; // 0.35x ~ 1.85x
    rivals.push({
      name: RIVAL_NAMES[i],
      power: Math.max(120, Math.round(playerStats.power * factor / 10) * 10),
      wins: Math.max(0, Math.round(playerStats.wins * factor)),
      collect: Math.max(6, Math.min(40, Math.round(playerStats.collect * factor))),
      trophies: Math.max(0, Math.round((playerStats.trophies || 0) * factor / 10) * 10),
      isPlayer: false,
    });
  }
  return rivals;
}

/**
 * 获取玩家自身统计
 */
function _getPlayerStats() {
  const profile = getProfile();
  if (!profile) return null;
  return {
    name: '我',
    power: profile.getTotalPower ? profile.getTotalPower() : 0,
    wins: profile.pvpWins || 0,
    collect: Object.keys(profile.collectedUnits || {}).length,
    trophies: profile.trophies || 0,
    isPlayer: true,
  };
}

/**
 * 获取排行榜数据
 * @param {string} boardKey - 'power' | 'wins' | 'collect'
 * @returns {{ board: object, entries: Array, playerRank: number, playerEntry: object }}
 */
function getLeaderboard(boardKey = 'power') {
  const board = BOARDS.find(b => b.key === boardKey) || BOARDS[0];
  const playerStats = _getPlayerStats();
  if (!playerStats) {
    return { board, entries: [], playerRank: 0, playerEntry: null };
  }

  const entries = [playerStats, ..._buildRivals(playerStats)];
  entries.sort((a, b) => b[board.metric] - a[board.metric]);

  // 玩家排名（同分并列取最好名次）
  const playerEntry = entries.find(e => e.isPlayer);
  const playerRank = entries.findIndex(e => e.isPlayer) + 1;

  // 只取前20展示（玩家不在前20时尾部附加玩家条目）
  const top = entries.slice(0, 20);
  if (playerRank > 20) top.push(playerEntry);

  return { board, entries: top, playerRank, playerEntry };
}

export { getLeaderboard };
export default { getLeaderboard, BOARDS };
