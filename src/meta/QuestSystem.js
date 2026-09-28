/**
 * QuestSystem — 任务系统
 * 每日/每周/赛季任务刷新 / 进度追踪 / 领奖
 * 成就系统(永久) / 通关条件检测
 *
 * 存储结构（存档）：
 *   profile.dailyTasks  = { _lastRefresh: 'YYYY-M-D', quests: [{id, progress, claimed}] }
 *   profile.weeklyTasks = { _lastRefresh: 'YYYY-Www',  quests: [{id, progress, claimed}] }
 *   profile.seasonTasks = { _season: n,               quests: [{id, progress, claimed}] }
 *   profile.achievements= { achievementId: { claimed: true } }
 *
 * 列表排序规则：可领取(complete && !claimed) 置顶 → 进行中 → 已领（所有 getter 统一返回排序后列表）
 */

import ConfigLoader from '../data/ConfigLoader.js';
import { get as getProfile, save as saveProfile } from './ProfileManager.js';

/**
 * 获取配置
 */
function _getConfig() {
  return ConfigLoader.get('quests');
}

/**
 * 获取今日日期字符串
 */
function _getTodayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

/**
 * 获取本周 ISO 周字符串（周一为每周起始，如 '2026-W36'）
 */
function _getWeekKey() {
  const d = new Date();
  const day = (d.getDay() + 6) % 7; // 周一=0 ... 周日=6
  const thursday = new Date(d);
  thursday.setDate(d.getDate() - day + 3);
  const year = thursday.getFullYear();
  const jan1 = new Date(year, 0, 1);
  const week = Math.ceil((((thursday - jan1) / 86400000) + 1) / 7);
  return `${year}-W${String(week).padStart(2, '0')}`;
}

/**
 * 获取当前赛季键（跟随天梯赛季号，赛季结算 seasonNumber+1 即刷新）
 */
function _getSeasonKey(profile) {
  return profile.seasonNumber || 1;
}

/**
 * 排序：可领取(0) → 进行中(1) → 已领(2)，同档保持原顺序（稳定排序）
 */
function _sortClaimableFirst(list) {
  const rank = (q) => (q.complete && !q.claimed ? 0 : q.claimed ? 2 : 1);
  return [...list].sort((a, b) => rank(a) - rank(b));
}

/**
 * 通用刷新：从配置池随机抽取 count 个任务写入存档
 * @param {object} profile
 * @param {string} poolKey   配置池键（dailyQuests/weeklyQuests/seasonQuests）
 * @param {string} countKey  配置数量键
 * @param {string} storageKey 存档键（dailyTasks/weeklyTasks/seasonTasks）
 * @param {string} metaKey   刷新标记键（_lastRefresh/_season）
 * @param {any}    metaVal   刷新标记值
 */
function _refreshQuests(profile, poolKey, countKey, storageKey, metaKey, metaVal) {
  const config = _getConfig();
  const pool = [...(config[poolKey] || [])];
  const selected = [];
  const count = Math.min(config[countKey] || 0, pool.length);

  for (let i = 0; i < count; i++) {
    const idx = Math.floor(Math.random() * pool.length);
    const quest = pool.splice(idx, 1)[0];
    selected.push({
      id: quest.id,
      progress: 0,
      claimed: false,
    });
  }

  profile[storageKey] = {
    [metaKey]: metaVal,
    quests: selected,
  };
  saveProfile();
}

/**
 * 检查并刷新每日任务
 */
function checkDailyRefresh() {
  const profile = getProfile();
  const today = _getTodayKey();
  const lastRefresh = profile.dailyTasks._lastRefresh || '';

  if (lastRefresh !== today) {
    _refreshQuests(profile, 'dailyQuests', 'dailyQuestCount', 'dailyTasks', '_lastRefresh', today);
  }
}

/**
 * 刷新每日任务（随机选取）
 */
function refreshDailyQuests() {
  _refreshQuests(getProfile(), 'dailyQuests', 'dailyQuestCount', 'dailyTasks', '_lastRefresh', _getTodayKey());
}

/**
 * 检查并刷新每周任务
 */
function checkWeeklyRefresh() {
  const profile = getProfile();
  const week = _getWeekKey();
  const lastRefresh = (profile.weeklyTasks && profile.weeklyTasks._lastRefresh) || '';

  if (lastRefresh !== week) {
    _refreshQuests(profile, 'weeklyQuests', 'weeklyQuestCount', 'weeklyTasks', '_lastRefresh', week);
  }
}

/**
 * 刷新每周任务（随机选取）
 */
function refreshWeeklyQuests() {
  _refreshQuests(getProfile(), 'weeklyQuests', 'weeklyQuestCount', 'weeklyTasks', '_lastRefresh', _getWeekKey());
}

/**
 * 检查并刷新赛季任务（赛季号变化即刷新）
 */
function checkSeasonRefresh() {
  const profile = getProfile();
  const season = _getSeasonKey(profile);
  const savedSeason = (profile.seasonTasks && profile.seasonTasks._season) || null;

  if (savedSeason !== season) {
    _refreshQuests(profile, 'seasonQuests', 'seasonQuestCount', 'seasonTasks', '_season', season);
  }
}

/**
 * 刷新赛季任务（随机选取）
 */
function refreshSeasonQuests() {
  _refreshQuests(getProfile(), 'seasonQuests', 'seasonQuestCount', 'seasonTasks', '_season', _getSeasonKey(getProfile()));
}

/**
 * 通用获取：拼装任务列表（含配置信息），已按可领取置顶排序
 */
function _getQuests(poolKey, storageKey) {
  const profile = getProfile();
  const config = _getConfig();
  const saved = (profile[storageKey] && profile[storageKey].quests) || [];
  return _sortClaimableFirst(saved.map(sq => {
    const qConfig = (config[poolKey] || []).find(q => q.id === sq.id);
    return {
      id: sq.id,
      desc: qConfig ? qConfig.desc : sq.id,
      type: qConfig ? qConfig.type : 'unknown',
      target: qConfig ? qConfig.target : 1,
      progress: sq.progress,
      claimed: sq.claimed,
      reward: qConfig ? qConfig.reward : {},
      complete: sq.progress >= (qConfig ? qConfig.target : 1),
    };
  }));
}

/**
 * 获取每日任务列表(含配置信息)
 */
function getDailyQuests() {
  checkDailyRefresh();
  return _getQuests('dailyQuests', 'dailyTasks');
}

/**
 * 获取每周任务列表(含配置信息)
 */
function getWeeklyQuests() {
  checkWeeklyRefresh();
  return _getQuests('weeklyQuests', 'weeklyTasks');
}

/**
 * 获取赛季任务列表(含配置信息)
 */
function getSeasonQuests() {
  checkSeasonRefresh();
  return _getQuests('seasonQuests', 'seasonTasks');
}

/**
 * 获取成就列表(含进度)，已按可领取置顶排序
 */
function getAchievements() {
  const profile = getProfile();
  const config = _getConfig();

  return _sortClaimableFirst(config.achievements.map(qConfig => {
    const saved = profile.achievements[qConfig.id];
    const progress = _getAchievementProgress(qConfig, profile);
    return {
      id: qConfig.id,
      desc: qConfig.desc,
      type: qConfig.type,
      target: qConfig.target,
      progress: Math.min(progress, qConfig.target),
      claimed: saved ? saved.claimed : false,
      reward: qConfig.reward,
      complete: progress >= qConfig.target,
    };
  }));
}

/**
 * 获取成就当前进度
 */
function _getAchievementProgress(qConfig, profile) {
  switch (qConfig.type) {
    case 'games_won':
      return profile.totalWins;
    case 'games_played':
      return profile.totalGames;
    case 'total_stars':
      return profile.pvpWins;  // 向后兼容：映射到PvP胜场
    case 'max_level_reached':
      return profile.pvpWins;  // 向后兼容：映射到PvP胜场
    case 'pvp_wins':
      return profile.pvpWins;
    case 'hero_count':
      return Object.keys(profile.collectedUnits).length;
    case 'total_pulls':
      return profile.totalPulls || 0;
    case 'share_count':
      return profile.shareCount || 0;
    case 'max_streak':
      return profile.pvpMaxStreak || 0;
    case 'total_power':
      return profile.getTotalPower ? profile.getTotalPower() : 0;
    case 'tech_branch_maxed':
      return _countMaxedBranches(profile);
    case 'equipment_quality':
      return _countEquipmentByQuality(profile, qConfig.targetMeta?.quality);
    default:
      return 0;
  }
}

/**
 * 统计已满级的科技分支数
 */
function _countMaxedBranches(profile) {
  let techConfig;
  try { techConfig = ConfigLoader.get('techTree'); } catch (e) { return 0; }

  let count = 0;
  for (const branch of Object.values(techConfig.branches)) {
    const allMaxed = branch.nodes.every(node => {
      const level = profile.getTechNodeLevel(node.id);
      return level >= node.maxLevel;
    });
    if (allMaxed && branch.nodes.length > 0) count++;
  }
  return count;
}

/**
 * 统计某品质的装备数量
 */
function _countEquipmentByQuality(profile, quality) {
  if (!quality) return profile.equipments.length;
  return profile.equipments.filter(e => e.quality === quality).length;
}

/**
 * 任务事件触发 — 更新每日/每周/赛季任务进度
 * @param {string} eventType - 事件类型
 * @param {number} amount - 增量
 */
function trackEvent(eventType, amount = 1) {
  const profile = getProfile();
  const config = _getConfig();
  checkDailyRefresh();
  checkWeeklyRefresh();
  checkSeasonRefresh();

  let changed = false;
  const groups = [
    ['dailyQuests', 'dailyTasks'],
    ['weeklyQuests', 'weeklyTasks'],
    ['seasonQuests', 'seasonTasks'],
  ];
  for (const [poolKey, storageKey] of groups) {
    const store = profile[storageKey] || {};
    if (!store.quests) continue;
    for (const sq of store.quests) {
      if (sq.claimed) continue;
      const qConfig = (config[poolKey] || []).find(q => q.id === sq.id);
      if (qConfig && qConfig.type === eventType) {
        sq.progress = (sq.progress || 0) + amount;
        changed = true;
      }
    }
  }
  if (changed) saveProfile();
}

/**
 * 通用领取：按 id 领取任务奖励
 */
function _claimReward(questId, poolKey, storageKey) {
  const profile = getProfile();
  const config = _getConfig();

  const store = profile[storageKey] || {};
  const sq = (store.quests || []).find(q => q.id === questId);
  if (!sq || sq.claimed) return false;

  const qConfig = (config[poolKey] || []).find(q => q.id === questId);
  if (!qConfig) return false;
  if ((sq.progress || 0) < qConfig.target) return false;

  sq.claimed = true;
  // 发放奖励
  for (const [currency, amount] of Object.entries(qConfig.reward)) {
    profile.addCurrency(currency, amount);
  }
  saveProfile();
  return true;
}

/**
 * 领取每日任务奖励
 * @param {string} questId
 * @returns {boolean}
 */
function claimDailyReward(questId) {
  return _claimReward(questId, 'dailyQuests', 'dailyTasks');
}

/**
 * 领取每周任务奖励
 * @param {string} questId
 * @returns {boolean}
 */
function claimWeeklyReward(questId) {
  return _claimReward(questId, 'weeklyQuests', 'weeklyTasks');
}

/**
 * 领取赛季任务奖励
 * @param {string} questId
 * @returns {boolean}
 */
function claimSeasonReward(questId) {
  return _claimReward(questId, 'seasonQuests', 'seasonTasks');
}

/**
 * 领取成就奖励
 * @param {string} achievementId
 * @returns {boolean}
 */
function claimAchievementReward(achievementId) {
  const profile = getProfile();
  const config = _getConfig();

  const qConfig = config.achievements.find(q => q.id === achievementId);
  if (!qConfig) return false;

  const progress = _getAchievementProgress(qConfig, profile);
  if (progress < qConfig.target) return false;

  if (!profile.achievements[achievementId]) {
    profile.achievements[achievementId] = { claimed: false };
  }
  if (profile.achievements[achievementId].claimed) return false;

  profile.achievements[achievementId].claimed = true;
  for (const [currency, amount] of Object.entries(qConfig.reward)) {
    profile.addCurrency(currency, amount);
  }
  saveProfile();
  return true;
}

/**
 * 一键领取所有已完成未领取的每日任务奖励
 * @returns {object} 领取的奖励汇总
 */
function claimAllDaily() {
  const quests = getDailyQuests();
  const claimed = [];
  for (const q of quests) {
    if (q.complete && !q.claimed) {
      if (claimDailyReward(q.id)) {
        claimed.push(q);
      }
    }
  }
  return { count: claimed.length, quests: claimed };
}

/**
 * 一键领取所有已完成未领取的任务奖励（每日+每周+赛季）
 * @returns {object} 领取的奖励汇总
 */
function claimAllQuests() {
  const groups = [
    ['dailyQuests', 'dailyTasks', claimDailyReward],
    ['weeklyQuests', 'weeklyTasks', claimWeeklyReward],
    ['seasonQuests', 'seasonTasks', claimSeasonReward],
  ];
  const claimed = [];
  for (const [poolKey, storageKey, claimFn] of groups) {
    const list = _getQuests(poolKey, storageKey);
    for (const q of list) {
      if (q.complete && !q.claimed) {
        if (claimFn(q.id)) {
          claimed.push(q);
        }
      }
    }
  }
  return { count: claimed.length, quests: claimed };
}

/**
 * 一键领取所有已完成未领取的成就奖励
 * @returns {object} 领取的奖励汇总
 */
function claimAllAchievements() {
  const list = getAchievements();
  const claimed = [];
  for (const a of list) {
    if (a.complete && !a.claimed) {
      if (claimAchievementReward(a.id)) {
        claimed.push(a);
      }
    }
  }
  return { count: claimed.length, achievements: claimed };
}

export {
  checkDailyRefresh,
  refreshDailyQuests,
  getDailyQuests,
  checkWeeklyRefresh,
  refreshWeeklyQuests,
  getWeeklyQuests,
  checkSeasonRefresh,
  refreshSeasonQuests,
  getSeasonQuests,
  getAchievements,
  trackEvent,
  claimDailyReward,
  claimWeeklyReward,
  claimSeasonReward,
  claimAchievementReward,
  claimAllDaily,
  claimAllQuests,
  claimAllAchievements,
};
export default {
  checkDailyRefresh,
  refreshDailyQuests,
  getDailyQuests,
  checkWeeklyRefresh,
  refreshWeeklyQuests,
  getWeeklyQuests,
  checkSeasonRefresh,
  refreshSeasonQuests,
  getSeasonQuests,
  getAchievements,
  trackEvent,
  claimDailyReward,
  claimWeeklyReward,
  claimSeasonReward,
  claimAchievementReward,
  claimAllDaily,
  claimAllQuests,
  claimAllAchievements,
};
