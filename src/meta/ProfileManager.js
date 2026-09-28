/**
 * ProfileManager — 局外数据管理
 * 负责玩家Profile的加载、保存、初始化
 * 支持微信小游戏 wx.setStorageSync / wx.getStorageSync
 * 支持浏览器 localStorage
 */

import { PlayerProfile } from './PlayerProfile.js';
import { AccountManager } from './AccountManager.js';
import { CloudClient } from '../net/CloudClient.js';
import { settle as ladderSettle, settlePvp as ladderSettlePvp, rewardText as ladderRewardText } from './LadderSystem.js';

const STORAGE_KEY = 'territory_king_profile';

/**
 * 当前存储 key：多账号模型下按当前账号 id 加后缀（uid 与 profile 原子绑定）。
 * AccountManager 未初始化（独立使用/旧测试）时返回旧固定 key，向后兼容。
 */
function storageKey() {
  const id = AccountManager.getCurrentId();
  return id ? `territory_king_profile_${id}` : STORAGE_KEY;
}

/**
 * 判断是否为微信环境
 */
function isWxEnv() {
  return typeof wx !== 'undefined' && typeof wx.setStorageSync === 'function';
}

/**
 * 当前玩家Profile（单例）
 */
let _currentProfile = null;

/**
 * 云同步开关（默认关闭，本地优先；Phase A 联调时由 Game.start 按配置开启）
 */
let _cloudEnabled = false;

/**
 * 加载存档
 */
function load() {
  let data = null;
  const key = storageKey();

  if (isWxEnv()) {
    try {
      data = wx.getStorageSync(key);
    } catch (e) {
      console.warn('[ProfileManager] Failed to read wx storage:', e);
    }
  } else {
    try {
      const raw = localStorage.getItem(key);
      if (raw) data = JSON.parse(raw);
    } catch (e) {
      console.warn('[ProfileManager] Failed to read localStorage:', e);
    }
  }

  if (data) {
    _currentProfile = PlayerProfile.fromJSON(data);
    console.log('[ProfileManager] Profile loaded. Power:', _currentProfile.getTotalPower());
  } else {
    _currentProfile = new PlayerProfile();
    console.log('[ProfileManager] New profile created.');
    save();
  }

  return _currentProfile;
}

/**
 * 保存存档
 */
function save() {
  if (!_currentProfile) return;

  const data = _currentProfile.serialize();
  const key = storageKey();

  if (isWxEnv()) {
    try {
      wx.setStorageSync(key, data);
    } catch (e) {
      console.warn('[ProfileManager] Failed to save wx storage:', e);
    }
  } else {
    try {
      localStorage.setItem(key, JSON.stringify(data));
    } catch (e) {
      console.warn('[ProfileManager] Failed to save localStorage:', e);
    }
  }

  // 云同步（若启用）：本地已落盘，异步防抖推云端（失败静默，下次再推）
  if (_cloudEnabled) {
    const uid = AccountManager.getUID();
    if (uid) {
      let power = 0;
      try { power = _currentProfile.getTotalPower ? _currentProfile.getTotalPower() : 0; } catch (e) { power = 0; }
      CloudClient.schedulePush({ uid, nickname: _currentProfile.nickname, data, power });
    }
  }
}

/**
 * 获取当前Profile（必须先load）
 */
function get() {
  if (!_currentProfile) {
    console.warn('[ProfileManager] Profile not loaded, loading now...');
    return load();
  }
  return _currentProfile;
}

/**
 * 重置存档（慎用）
 */
function reset() {
  _currentProfile = new PlayerProfile();
  save();
  console.log('[ProfileManager] Profile reset.');
  return _currentProfile;
}

/**
 * PvP对战结算奖励
 * 胜利：金币和星尘奖励丰富，但招募进度减半（因为主要通过抽卡获取兵种）
 * 失败：安慰奖，招募进度全额；额外扣奖杯（不扣货币，保段保护见 LadderSystem）
 * @param {boolean} isWin
 * @param {string} difficulty - 对手AI难度 easy/normal/hard/nightmare（决定奖杯增减幅度）
 */
function grantBattleRewards(isWin, difficulty = 'normal') {
  const profile = get();
  let totalGold = 0;
  let totalStardust = 0;

  if (isWin) {
    // 胜利奖励：金币和星尘
    totalGold = 80 + Math.floor(Math.random() * 40); // 80-120
    totalStardust = 3 + Math.floor(Math.random() * 3); // 3-5
    // 连胜额外奖励
    if (profile.pvpWinStreak >= 3) {
      totalStardust += 2;
      totalGold += 20;
    }
    if (profile.pvpWinStreak >= 5) {
      totalStardust += 3;
      totalGold += 30;
    }
  } else {
    // 失败安慰奖
    totalGold = 15 + Math.floor(Math.random() * 15); // 15-30
    totalStardust = 1;
  }

  profile.addCurrency('gold', Math.round(totalGold));
  profile.addCurrency('stardust', totalStardust);
  profile.recordBattleResult(isWin);

  // 天梯结算（失败只扣奖杯，保段保护）
  const ladder = ladderSettle(profile, isWin, difficulty);

  save();
  return {
    gold: Math.round(totalGold),
    stardust: totalStardust,
    isWin,
    // 天梯信息（结算界面展示）
    trophyDelta: ladder.delta,
    trophies: ladder.trophies,
    tier: ladder.tierTo,
    tierUp: ladder.tierUp,
    tierDown: ladder.tierDown,
    tierUpRewardText: ladder.tierRewards.length ? ladder.tierRewards.map(r => `${r.icon}${r.tier} ${ladderRewardText({ gold: r.gold, stardust: r.stardust, diamond: r.diamond })}`).join('；') : '',
  };
}

/**
 * 真人 PvP 对战结算奖励（realtime 模式专用）
 * 与 grantBattleRewards 唯一区别：天梯结算用 Elo 公式（对手奖杯分），而非 AI 难度档位。
 * @param {boolean} isWin
 * @param {number|null} oppTrophies 对手奖杯分（配对时经 bundle 交换而来）
 */
function grantPvpRewards(isWin, oppTrophies = null) {
  const profile = get();
  let totalGold = 0;
  let totalStardust = 0;

  if (isWin) {
    totalGold = 80 + Math.floor(Math.random() * 40); // 80-120
    totalStardust = 3 + Math.floor(Math.random() * 3); // 3-5
    if (profile.pvpWinStreak >= 3) { totalStardust += 2; totalGold += 20; }
    if (profile.pvpWinStreak >= 5) { totalStardust += 3; totalGold += 30; }
  } else {
    totalGold = 15 + Math.floor(Math.random() * 15); // 15-30
    totalStardust = 1;
  }

  profile.addCurrency('gold', Math.round(totalGold));
  profile.addCurrency('stardust', totalStardust);
  profile.recordBattleResult(isWin);

  // 真人 Elo 天梯结算（对手奖杯未知时按同段位 expected=0.5）
  const ladder = ladderSettlePvp(profile, isWin, oppTrophies);

  save();
  return {
    gold: Math.round(totalGold),
    stardust: totalStardust,
    isWin,
    trophyDelta: ladder.delta,
    trophies: ladder.trophies,
    tier: ladder.tierTo,
    tierUp: ladder.tierUp,
    tierDown: ladder.tierDown,
    tierUpRewardText: ladder.tierRewards.length ? ladder.tierRewards.map(r => `${r.icon}${r.tier} ${ladderRewardText({ gold: r.gold, stardust: r.stardust, diamond: r.diamond })}`).join('；') : '',
  };
}

/**
 * 应用战斗中兵种招募计数到存档
 * @param {Object} recruitLog - { unitId: count }
 * @param {number} multiplier - 招募进度倍率，胜利时0.5（减半），失败时1.0（全额）
 */
function applyRecruits(recruitLog, multiplier = 1.0) {
  if (!recruitLog || Object.keys(recruitLog).length === 0) return;
  const profile = get();
  let changed = false;
  for (const [unitId, count] of Object.entries(recruitLog)) {
    if (profile.collectedUnits[unitId]) {
      const applied = Math.floor(count * multiplier);
      if (applied <= 0) continue;
      const cur = profile.collectedUnits[unitId].recruitCount || 0;
      profile.collectedUnits[unitId].recruitCount = cur + applied;
      changed = true;
      console.log(`[ProfileManager] Recruit: ${unitId} +${applied} (total: ${cur + applied}) [multiplier: ${multiplier}]`);
    }
  }
  if (changed) save();
}

/**
 * 检查并解锁种族（基于PvP胜场）
 */
function checkRaceUnlock() {
  const profile = get();
  // 基于PvP胜场解锁种族
  const unlockMap = {
    3: 'beast',     // 3胜解锁兽族
    10: 'undead',   // 10胜解锁亡灵
    20: 'elf',      // 20胜解锁精灵
    35: 'dwarf',    // 35胜解锁矮人
  };
  for (const [wins, race] of Object.entries(unlockMap)) {
    if (profile.pvpWins >= parseInt(wins) && !profile.unlockedRaces.includes(race)) {
      profile.unlockRace(race);
      save();
      return race;
    }
  }
  return null;
}

/**
 * 启用云同步（Phase A 联调时由 Game.start 按配置调用）
 */
function enableCloud(baseUrl) {
  _cloudEnabled = true;
  CloudClient.enable(baseUrl);
}

function disableCloud() {
  _cloudEnabled = false;
  CloudClient.disable();
}

function isCloudEnabled() {
  return _cloudEnabled;
}

/**
 * 启动时云端同步：登录（按 uid 找回账号）+ 拉取云端档覆盖本地（云端为真相）。
 * 云端无档时推送本地档做首次备份。
 * @returns {Promise<{source:'cloud'|'local'|'none', version?:number}>}
 */
async function syncFromCloud() {
  if (!_cloudEnabled) return { source: 'none' };
  const uid = AccountManager.getUID();
  if (!uid) return { source: 'none' };

  try {
    const loginRes = await CloudClient.login(uid, _currentProfile ? _currentProfile.nickname : undefined);
    // 云端权威身份回写：accountId 作为稳定 uid，nickname 以云端为准（本地多账号共享同一 openid 存档）
    if (loginRes && (loginRes.accountId || loginRes.nickname)) {
      AccountManager.bindCloudIdentity({ accountId: loginRes.accountId, uid: loginRes.uid, nickname: loginRes.nickname });
    }
    const prof = await CloudClient.getProfile();
    if (prof && prof.data) {
      _currentProfile = PlayerProfile.fromJSON(prof.data);
      // 云端 nickname 回写 profile（若不一致），让大厅昵称与后台/云端一致
      if (loginRes && loginRes.nickname && _currentProfile.nickname !== loginRes.nickname) {
        _currentProfile.nickname = loginRes.nickname;
      }
      save();
      console.log('[Cloud] pulled cloud profile → v' + prof.version);
      return { source: 'cloud', version: prof.version };
    }
    // 云端无档 → 推本地档做首次备份
    let power = 0;
    try { power = _currentProfile ? _currentProfile.getTotalPower() : 0; } catch (e) { power = 0; }
    CloudClient.schedulePush({ uid, nickname: _currentProfile ? _currentProfile.nickname : undefined, data: _currentProfile.serialize(), power });
    console.log('[Cloud] no cloud profile, pushing local');
    return { source: 'local' };
  } catch (e) {
    console.warn('[Cloud] syncFromCloud failed:', e && e.message || e);
    return { source: 'none' };
  }
}

/**
 * 服务端权威结算（Phase C 防作弊核心）：
 * 只上报「胜负 + 模式 + 对手」，服务端用同款纯函数重算奖励，返回权威结果覆盖本地。
 * 失败抛错，调用方降级为本地结算。
 * @param {boolean} isWin
 * @param {string} mode 'ai' | 'realtime' | 'snapshot'
 * @param {string} difficulty 对手 AI 难度（mode=ai 时用）
 * @param {number|null} oppTrophies 对手奖杯（mode=realtime/snapshot 时用）
 * @returns {Promise<object>} 与 grantBattleRewards/grantPvpRewards 同结构的 rewards
 */
async function settleAuthoritative(isWin, mode, difficulty = 'normal', oppTrophies = null) {
  if (!_cloudEnabled) throw new Error('cloud disabled');
  const uid = AccountManager.getUID();
  if (!uid) throw new Error('no uid');

  let power = 0;
  try { power = _currentProfile.getTotalPower ? _currentProfile.getTotalPower() : 0; } catch (e) { power = 0; }

  const res = await CloudClient.settle(isWin ? 'win' : 'lose', mode, { difficulty, oppTrophies, power });
  if (res && res.profile) {
    _currentProfile = PlayerProfile.fromJSON(res.profile);
    save(); // 本地刷新为权威结果（save 的云推幂等同步回云端）
    return res.rewards;
  }
  throw new Error('settle returned no profile');
}

export {
  load, save, get, reset,
  grantBattleRewards, grantPvpRewards, applyRecruits, checkRaceUnlock, isWxEnv,
  enableCloud, disableCloud, isCloudEnabled, syncFromCloud, settleAuthoritative,
};
export default {
  load, save, get, reset,
  grantBattleRewards, grantPvpRewards, applyRecruits, checkRaceUnlock, isWxEnv,
  enableCloud, disableCloud, isCloudEnabled, syncFromCloud, settleAuthoritative,
};
