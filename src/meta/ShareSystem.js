/**
 * ShareSystem — 分享系统（Phase 5）
 * 分享裂变：大厅分享 / 战绩分享 / 每日分享奖励
 *
 * 微信小游戏环境：调用 wx.shareAppMessage / wx.onShareAppMessage
 * 浏览器预览环境：wx-shim 提供 shareAppMessage stub
 *
 * 真机接入开放能力时的扩展点：
 *  - 被动分享：在 game.js 入口调用 wx.onShareAppMessage(() => ShareSystem.getShareConfig())
 *  - 朋友圈：wx.showShareMenu({ menus: ['shareAppMessage', 'shareTimeline'] })
 *  - 战绩分享带图片：wx.shareAppMessage({ imageUrl: canvas.toTempFilePathSync() })
 */

import { get as getProfile, save as saveProfile } from './ProfileManager.js';

/** 每日分享奖励（每天首次分享可领取） */
const DAILY_SHARE_REWARD = { gold: 200, stardust: 5 };

/** 今日日期字符串（本地时区） */
function _todayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

/**
 * 获取分享文案配置
 * @param {object} opts - { scene: 'lobby' | 'victory' | 'defeat', enemyName, streak }
 */
function getShareConfig(opts = {}) {
  const profile = getProfile();
  const scene = opts.scene || 'lobby';

  const shareData = {
    title: '占地之王：策略占地的对战小游戏，来和我一决高下！',
    // 小游戏无页面路由：path 可省略（默认进入游戏主入口）；
    // 需要带参数时用 query 形式，如 'index?from=share'
  };

  if (scene === 'victory' && profile) {
    const streak = profile.pvpWinStreak || 0;
    shareData.title = streak >= 3
      ? `我在占地之王拿到${streak}连胜！谁能挡我？`
      : `我在占地之王击败了${opts.enemyName || '对手'}！来挑战我吧`;
  } else if (scene === 'defeat' && profile) {
    shareData.title = '我在占地之王被虐了...谁来帮我报仇？';
  } else if (profile) {
    const owned = Object.keys(profile.collectedUnits || {}).length;
    shareData.title = `我在占地之王已收集${owned}/40兵种，战力${profile.getTotalPower()}！快来超越我`;
  }

  return shareData;
}

/**
 * 发起分享
 * 微信环境调用 wx.shareAppMessage；浏览器预览由 wx-shim 兜底
 * @returns {boolean} 是否成功发起
 */
function share(opts = {}) {
  const config = getShareConfig(opts);

  if (typeof wx !== 'undefined' && typeof wx.shareAppMessage === 'function') {
    wx.shareAppMessage(config);
    return true;
  }
  console.log('[ShareSystem] share:', config.title);
  return false;
}

/**
 * 领取每日分享奖励（每日限1次）
 * 注意：微信分享回调无法可靠判定"分享成功"，业界通行做法是
 * 点击分享按钮即视为完成分享行为，直接发放每日奖励。
 * @returns {{ success: boolean, reason?: string, reward?: object, alreadyClaimed?: boolean }}
 */
function claimDailyShareReward() {
  const profile = getProfile();
  if (!profile) return { success: false, reason: '存档未加载' };

  const today = _todayKey();
  if (profile.lastShareDate === today) {
    return { success: false, alreadyClaimed: true, reason: '今日奖励已领取' };
  }

  profile.lastShareDate = today;
  profile.shareCount = (profile.shareCount || 0) + 1;
  for (const [currency, amount] of Object.entries(DAILY_SHARE_REWARD)) {
    profile.addCurrency(currency, amount);
  }
  saveProfile();
  return { success: true, reward: DAILY_SHARE_REWARD };
}

/**
 * 一键分享 + 领奖（大厅/结算界面按钮调用）
 * @returns {{ success: boolean, message: string }}
 */
function shareAndReward(opts = {}) {
  share(opts);
  const result = claimDailyShareReward();
  if (result.success) {
    const r = result.reward;
    const parts = [];
    if (r.gold) parts.push(`金币+${r.gold}`);
    if (r.stardust) parts.push(`星尘+${r.stardust}`);
    return { success: true, message: `分享成功！${parts.join(' ')}` };
  }
  return { success: true, message: '今日分享奖励已领取，明天再来~' };
}

/**
 * 今日是否已领取分享奖励
 */
function isDailyRewardClaimed() {
  const profile = getProfile();
  return profile ? profile.lastShareDate === _todayKey() : false;
}

export {
  getShareConfig,
  share,
  claimDailyShareReward,
  shareAndReward,
  isDailyRewardClaimed,
  DAILY_SHARE_REWARD,
};
export default {
  getShareConfig,
  share,
  claimDailyShareReward,
  shareAndReward,
  isDailyRewardClaimed,
  DAILY_SHARE_REWARD,
};
