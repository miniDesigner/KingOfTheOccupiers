/**
 * BattlePassSystem — 通行证系统
 * 经验获取 / 升级 / 领奖(免费+高级轨道)
 */

import ConfigLoader from '../data/ConfigLoader.js';
import { get as getProfile, save as saveProfile } from './ProfileManager.js';

/**
 * 获取配置
 */
function _getConfig() {
  return ConfigLoader.get('battlePass');
}

/**
 * 获取通行证状态
 */
function getStatus() {
  const profile = getProfile();
  const config = _getConfig();

  return {
    seasonName: config.seasonName,
    level: profile.battlePass.level || 0,
    exp: profile.battlePass.exp || 0,
    expPerLevel: config.expPerLevel,
    maxLevel: config.maxLevel,
    premium: profile.battlePass.premium || false,
    progress: (profile.battlePass.exp || 0) / config.expPerLevel,
  };
}

/**
 * 添加通行证经验
 * @param {number} amount - 经验量
 */
function addExp(amount) {
  const profile = getProfile();
  const config = _getConfig();

  if ((profile.battlePass.level || 0) >= config.maxLevel) return;

  profile.battlePass.exp = (profile.battlePass.exp || 0) + amount;

  // 自动升级
  while (profile.battlePass.exp >= config.expPerLevel &&
         (profile.battlePass.level || 0) < config.maxLevel) {
    profile.battlePass.exp -= config.expPerLevel;
    profile.battlePass.level = (profile.battlePass.level || 0) + 1;
    console.log(`[BattlePass] Level up! → ${profile.battlePass.level}`);
  }

  // 满级后清零经验
  if ((profile.battlePass.level || 0) >= config.maxLevel) {
    profile.battlePass.exp = 0;
  }

  saveProfile();
}

/**
 * 根据事件类型获取经验并添加
 * @param {string} eventType - levelComplete/levelWin/star3Bonus/dailyQuestComplete/gachaPull
 */
function trackEvent(eventType) {
  const config = _getConfig();
  const exp = config.expSources[eventType] || 0;
  if (exp > 0) {
    addExp(exp);
  }
}

/**
 * 获取指定等级的奖励信息
 * @param {number} level
 * @returns {object} { free, premium }
 */
function getLevelReward(level) {
  const config = _getConfig();
  const free = config.freeRewards.find(r => r.level === level);
  const premium = config.premiumRewards.find(r => r.level === level);
  return { free, premium };
}

/**
 * 获取所有等级奖励列表(含领取状态)
 */
function getAllRewards() {
  const profile = getProfile();
  const config = _getConfig();

  if (!profile.battlePass.claimed) {
    profile.battlePass.claimed = { free: [], premium: [] };
  }

  const currentLevel = profile.battlePass.level || 0;
  const isPremium = profile.battlePass.premium || false;

  const rewards = [];
  for (let lv = 1; lv <= config.maxLevel; lv++) {
    const free = config.freeRewards.find(r => r.level === lv);
    const premium = config.premiumRewards.find(r => r.level === lv);

    rewards.push({
      level: lv,
      unlocked: lv <= currentLevel,
      free: free ? {
        reward: free.reward,
        claimed: profile.battlePass.claimed.free.includes(lv),
        claimable: lv <= currentLevel && !profile.battlePass.claimed.free.includes(lv),
      } : null,
      premium: premium ? {
        reward: premium.reward,
        claimed: profile.battlePass.claimed.premium.includes(lv),
        claimable: isPremium && lv <= currentLevel && !profile.battlePass.claimed.premium.includes(lv),
        locked: !isPremium,
      } : null,
    });
  }
  return rewards;
}

/**
 * 领取奖励
 * @param {number} level - 等级
 * @param {string} track - 'free' 或 'premium'
 * @returns {boolean}
 */
function claimReward(level, track) {
  const profile = getProfile();
  const config = _getConfig();

  if (!profile.battlePass.claimed) {
    profile.battlePass.claimed = { free: [], premium: [] };
  }

  // 检查等级是否已达
  if ((profile.battlePass.level || 0) < level) return false;

  // 检查高级轨道权限
  if (track === 'premium' && !profile.battlePass.premium) return false;

  // 检查是否已领取
  if (profile.battlePass.claimed[track].includes(level)) return false;

  // 查找奖励
  const rewardList = track === 'free' ? config.freeRewards : config.premiumRewards;
  const rewardData = rewardList.find(r => r.level === level);
  if (!rewardData) return false;

  // 标记已领取
  profile.battlePass.claimed[track].push(level);

  // 发放奖励
  for (const [currency, amount] of Object.entries(rewardData.reward)) {
    profile.addCurrency(currency, amount);
  }

  saveProfile();
  return true;
}

/**
 * 一键领取所有可领奖励
 * @returns {object} { free: number, premium: number }
 */
function claimAll() {
  const profile = getProfile();
  const config = _getConfig();
  const currentLevel = profile.battlePass.level || 0;
  let freeCount = 0;
  let premiumCount = 0;

  for (let lv = 1; lv <= currentLevel; lv++) {
    if (claimReward(lv, 'free')) freeCount++;
    if (claimReward(lv, 'premium')) premiumCount++;
  }

  return { free: freeCount, premium: premiumCount };
}

export {
  getStatus,
  addExp,
  trackEvent,
  getLevelReward,
  getAllRewards,
  claimReward,
  claimAll,
};
export default {
  getStatus,
  addExp,
  trackEvent,
  getLevelReward,
  getAllRewards,
  claimReward,
  claimAll,
};
