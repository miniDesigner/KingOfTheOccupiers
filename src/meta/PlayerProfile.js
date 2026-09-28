/**
 * PlayerProfile — 玩家局外养成数据
 * 管理所有关卡之外的永久数据：货币、兵种上阵系统、科技树、装备、关卡进度
 */

import { calculatePlayerPower } from './PowerSystem.js';

export class PlayerProfile {
  constructor() {
    // === 身份标识 ===
    // 昵称：新用户默认随机游客名「领主_XXXX」，可在设置/改名界面修改
    this.nickname = PlayerProfile.generateDefaultNickname();

    // === 货币 ===
    this.gold = 500;          // 金币（局内+局外通用）
    this.diamond = 2000;      // 钻石
    this.stardust = 200;       // 星尘（初始赠送200，可招募1-2个兵种）

    // === 关卡进度（向后兼容，不再使用） ===
    this.maxUnlockedLevel = 1;
    this.levelStars = {};

    // === PvP战绩 ===
    this.pvpWins = 0;
    this.pvpLosses = 0;
    this.pvpWinStreak = 0;     // 当前连胜
    this.pvpMaxStreak = 0;     // 最高连胜

    // === 天梯段位（LadderSystem） ===
    this.trophies = 0;              // 当前奖杯
    this.highestTrophies = 0;       // 本赛季最高奖杯（赛季结算依据，赛季末重置）
    this.claimedTierRewards = [];   // 已领取的晋段一次性奖励（段位key，终身一次）
    this.seasonNumber = 1;          // 当前赛季编号
    this.seasonStart = null;        // 赛季开始日期（YYYY-MM-DD，首次进入游戏时初始化）
    this.seasonHistory = [];        // 历史赛季战绩 [{season,highestTrophies,tierLabel,tierIcon,rewards,resetTo}]

    // === 种族解锁 (保留兼容，但战斗不再依赖种族选择) ===
    this.unlockedRaces = ['human', 'beast'];

    // === 上阵系统：兵种/羁绊/建筑强化 ===
    // 已收集的兵种卡 { unitId: { level, recruitCount } }
    // 初始6兵种：2白(剑士+弓箭手) + 2绿(骑士+狂战士) + 1蓝(弩手) + 1紫(圣骑士)
    this.collectedUnits = {
      swordsman: { level: 1, recruitCount: 0 },
      archer: { level: 1, recruitCount: 0 },
      knight: { level: 1, recruitCount: 0 },
      berserker: { level: 1, recruitCount: 0 },
      crossbowman: { level: 1, recruitCount: 0 },
      paladin: { level: 1, recruitCount: 0 },
    };
    // 建筑强化等级 { barracks: 1, arrow_tower: 1, gold_mine: 1 }
    this.buildingUpgrades = { barracks: 1, arrow_tower: 1, gold_mine: 1 };
    // 当前上阵配置（6个不同兵种，每个兵种只能占一个槽位，槽位不可为空）
    // 羁绊不再手选 — 自动按上阵兵种风格派生，参见 SynergySystem.calculateSynergiesFromUnits
    this.deployment = {
      units: ['swordsman', 'knight', 'berserker', 'archer', 'crossbowman', 'paladin'],
      synergies: [], // 旧字段保留以兼容旧档读取，但已无业务意义
    };

    // === 科技树 ===
    this.techTree = {};       // { nodeId: currentLevel }

    // === 装备系统 (预留) ===
    this.equipments = [];     // [{ id, slot, quality, mainStat, subStats[] }]

    // === 任务系统 (预留) ===
    this.dailyTasks = {};
    this.weeklyTasks = {};
    this.seasonTasks = {};
    this.achievements = {};

    // === 通行证 ===
    this.battlePass = { level: 0, exp: 0, premium: false, claimed: { free: [], premium: [] } };

    // === 商店购买记录 ===
    this.shopPurchases = {};

    // === 统计 ===
    this.totalGames = 0;
    this.totalWins = 0;
    this.totalStars = 0;  // 向后兼容
    this.lastPlayDate = null;

    // === 抽卡系统 ===
    this.gachaPityCount = 0;  // 保底计数器（每10抽保底Q4+）
    this.totalPulls = 0;      // 累计抽卡次数（成就统计）

    // === 社交系统（Phase 5） ===
    this.shareCount = 0;      // 累计分享次数
    this.lastShareDate = null; // 最近分享领奖日期（YYYY-M-D，每日1次奖励）

    // === 广告系统（每日观看计数，防刷） ===
    // 业务层在 AdManager 看完发奖时调用 consumeAdQuota(key, limit)
    this.dailyAdWatched = {}; // { [adKey]: count }，每次看完 +1
    this.lastAdDate = null;   // 上次观看广告的日期（YYYY-M-D），跨天清零 dailyAdWatched

    // === 商店免费分页（P37：每日领取计数） ===
    // { [itemId]: count }，跨天自动清零（见 resetShopDailyIfNewDay）
    this.shopDailyClaims = {};
    this.shopDailyDate = null;

    // === 新手引导（Phase 5） ===
    // 0~4: 引导进行中的步骤；-1: 已完成；null: 旧档默认视为完成
    this.tutorialStep = 0;

    // === 设置（音效/背景音乐开关等，设置窗口读写） ===
    this.settings = { sfx: true, bgm: true, haptic: true };
  }

  /**
   * 生成默认游客昵称「领主_XXXX」（XXXX 为 4 位十六进制随机后缀）
   */
  static generateDefaultNickname() {
    const suffix = Math.floor(Math.random() * 0x10000).toString(16).padStart(4, '0');
    return '领主_' + suffix;
  }

  /**
   * 序列化为普通对象（用于存储）
   * 注意：不能用 toJSON() 方法名，否则 JSON.stringify 会无限递归
   */
  serialize() {
    return {
      nickname: this.nickname,
      gold: this.gold,
      diamond: this.diamond,
      stardust: this.stardust,
      maxUnlockedLevel: this.maxUnlockedLevel,
      levelStars: { ...this.levelStars },
      unlockedRaces: [...this.unlockedRaces],
      collectedUnits: JSON.parse(JSON.stringify(this.collectedUnits)),
      buildingUpgrades: { ...this.buildingUpgrades },
      deployment: JSON.parse(JSON.stringify(this.deployment)),
      techTree: { ...this.techTree },
      equipments: JSON.parse(JSON.stringify(this.equipments)),
      dailyTasks: { ...this.dailyTasks },
      weeklyTasks: { ...this.weeklyTasks },
      seasonTasks: { ...this.seasonTasks },
      achievements: { ...this.achievements },
      battlePass: JSON.parse(JSON.stringify(this.battlePass)),
      shopPurchases: { ...this.shopPurchases },
      totalGames: this.totalGames,
      totalWins: this.totalWins,
      totalStars: this.totalStars,
      pvpWins: this.pvpWins,
      pvpLosses: this.pvpLosses,
      pvpWinStreak: this.pvpWinStreak,
      pvpMaxStreak: this.pvpMaxStreak,
      // 天梯段位
      trophies: this.trophies || 0,
      highestTrophies: this.highestTrophies || 0,
      claimedTierRewards: [...(this.claimedTierRewards || [])],
      seasonNumber: this.seasonNumber || 1,
      seasonStart: this.seasonStart || null,
      seasonHistory: JSON.parse(JSON.stringify(this.seasonHistory || [])),
      lastPlayDate: this.lastPlayDate,
      gachaPityCount: this.gachaPityCount || 0,
      totalPulls: this.totalPulls || 0,
      shareCount: this.shareCount || 0,
      lastShareDate: this.lastShareDate || null,
      dailyAdWatched: JSON.parse(JSON.stringify(this.dailyAdWatched || {})),
      lastAdDate: this.lastAdDate || null,
      shopDailyClaims: JSON.parse(JSON.stringify(this.shopDailyClaims || {})),
      shopDailyDate: this.shopDailyDate || null,
      tutorialStep: this.tutorialStep === undefined ? 0 : this.tutorialStep,
      settings: this.settings ? { ...this.settings } : { sfx: true, bgm: true, haptic: true },
    };
  }

  /**
   * 从 JSON 恢复
   */
  static fromJSON(data) {
    const profile = new PlayerProfile();
    Object.assign(profile, data);
    // 2026-09-09 迁移：剥离已废弃字段（collectedSynergies + deployment.synergies 不再被业务使用）
    delete profile.collectedSynergies;
    if (Array.isArray(profile.deployment) && profile.deployment.synergies) {
      profile.deployment.synergies = [];
    }
    // 确保所有字段存在（兼容旧存档）
    if (!profile.nickname || typeof profile.nickname !== 'string') {
      profile.nickname = PlayerProfile.generateDefaultNickname();
    }
    if (!profile.settings) profile.settings = { sfx: true, bgm: true, haptic: true };
    // 天梯段位（旧档默认青铜0杯）
    if (profile.trophies === undefined) profile.trophies = 0;
    if (profile.highestTrophies === undefined) profile.highestTrophies = profile.trophies || 0;
    if (!Array.isArray(profile.claimedTierRewards)) profile.claimedTierRewards = [];
    if (!profile.seasonNumber) profile.seasonNumber = 1;
    if (!profile.seasonStart) profile.seasonStart = null;
    if (!Array.isArray(profile.seasonHistory)) profile.seasonHistory = [];
    if (!profile.techTree) profile.techTree = {};
    if (!profile.weeklyTasks) profile.weeklyTasks = {};
    if (!profile.seasonTasks) profile.seasonTasks = {};
    if (!profile.equipments) profile.equipments = [];
    if (!profile.levelStars) profile.levelStars = {};
    if (!profile.unlockedRaces) profile.unlockedRaces = ['human', 'beast'];
    if (!profile.collectedUnits) profile.collectedUnits = { swordsman: { level: 1, recruitCount: 0 }, archer: { level: 1, recruitCount: 0 } };
    // 旧档补发新起始兵种：骑士+狂战士+弩手+圣骑士
    if (!profile.collectedUnits.knight) profile.collectedUnits.knight = { level: 1, recruitCount: 0 };
    if (!profile.collectedUnits.berserker) profile.collectedUnits.berserker = { level: 1, recruitCount: 0 };
    if (!profile.collectedUnits.crossbowman) profile.collectedUnits.crossbowman = { level: 1, recruitCount: 0 };
    if (!profile.collectedUnits.paladin) profile.collectedUnits.paladin = { level: 1, recruitCount: 0 };
    // 迁移：确保所有已收集兵种都有 recruitCount 字段
    for (const uid of Object.keys(profile.collectedUnits)) {
      if (profile.collectedUnits[uid] && profile.collectedUnits[uid].recruitCount === undefined) {
        profile.collectedUnits[uid].recruitCount = 0;
      }
    }
    if (!profile.buildingUpgrades) profile.buildingUpgrades = { barracks: 1, arrow_tower: 1, gold_mine: 1 };
    if (!profile.deployment) profile.deployment = { units: ['swordsman', 'knight', 'berserker', 'archer', 'crossbowman', 'paladin'], synergies: ['warriors_will'] };
    // 迁移4槽→6槽：补齐新槽位
    if (!profile.deployment.units) profile.deployment.units = [];
    const _default6 = ['swordsman', 'knight', 'berserker', 'archer', 'crossbowman', 'paladin'];
    while (profile.deployment.units.length < 6) {
      // 找一个不在当前部署中的默认兵种填入
      const fill = _default6.find(u => !profile.deployment.units.includes(u));
      profile.deployment.units.push(fill || 'swordsman');
    }
    if (profile.deployment.units.length < 4) {
      profile.deployment.units = [..._default6];
    }
    // 修复旧档无效上阵：如果存在重复兵种，重置为默认
    const _depUnits = profile.deployment.units;
    const _unique = new Set(_depUnits.filter(u => u));
    if (_unique.size < _depUnits.filter(u => u).length) {
      console.log('[PlayerProfile] Fixing duplicate deployment units, resetting to default');
      profile.deployment.units = [..._default6];
    }
    // 修复旧档无效上阵：如果上阵了未收集的兵种，用默认兵种替换（不可为空）
    for (let i = 0; i < profile.deployment.units.length; i++) {
      const uid = profile.deployment.units[i];
      if (uid && !profile.collectedUnits[uid]) {
        console.log(`[PlayerProfile] Replacing uncollected unit in slot ${i}: ${uid}`);
        const fill = _default6.find(u => !profile.deployment.units.includes(u));
        profile.deployment.units[i] = fill || 'swordsman';
        if (fill && !profile.collectedUnits[fill]) {
          profile.collectedUnits[fill] = { level: 1 };
        }
      } else if (!uid) {
        // 空槽位：用默认兵种填充
        const fill = _default6.find(u => !profile.deployment.units.includes(u));
        profile.deployment.units[i] = fill || 'swordsman';
        if (fill && !profile.collectedUnits[fill]) {
          profile.collectedUnits[fill] = { level: 1 };
        }
      }
    }
    if (!profile.deployment.synergies) profile.deployment.synergies = [];
    // 注：旧档 deployment.synergies 字段不再过滤迁移（羁绊已废弃），仅兜底初始化空数组
    if (!profile.shopPurchases) profile.shopPurchases = {};
    if (!profile.battlePass) profile.battlePass = { level: 0, exp: 0, premium: false, claimed: { free: [], premium: [] } };
    if (!profile.battlePass.claimed) profile.battlePass.claimed = { free: [], premium: [] };
    // 旧档补发星尘：如果星尘 < 200 且只拥有默认兵种（≤4种，未招募过新兵种），补到200
    if ((profile.stardust || 0) < 200 && Object.keys(profile.collectedUnits || {}).length <= 6) {
      profile.stardust = 200;
      console.log('[PlayerProfile] Stardust bonus: set to 200 for existing save');
    }
    // PvP战绩兼容
    if (profile.pvpWins === undefined) profile.pvpWins = profile.totalWins || 0;
    if (profile.pvpLosses === undefined) profile.pvpLosses = Math.max(0, (profile.totalGames || 0) - (profile.totalWins || 0));
    if (profile.pvpWinStreak === undefined) profile.pvpWinStreak = 0;
    if (profile.pvpMaxStreak === undefined) profile.pvpMaxStreak = 0;
    if (profile.gachaPityCount === undefined) profile.gachaPityCount = 0;
    // Phase 5 社交/引导字段兼容：旧档（已有多局游戏记录）视为引导已完成
    if (profile.totalPulls === undefined) profile.totalPulls = 0;
    if (profile.shareCount === undefined) profile.shareCount = 0;
    if (profile.lastShareDate === undefined) profile.lastShareDate = null;
    if (profile.tutorialStep === undefined || profile.tutorialStep === null) {
      profile.tutorialStep = (profile.totalGames || 0) > 0 ? -1 : 0;
    }
    // 广告系统兼容（旧档默认无观看记录）
    if (!profile.dailyAdWatched || typeof profile.dailyAdWatched !== 'object') {
      profile.dailyAdWatched = {};
    }
    if (profile.lastAdDate === undefined) profile.lastAdDate = null;
    // P37 商店免费分页：旧档默认无领取记录
    if (!profile.shopDailyClaims || typeof profile.shopDailyClaims !== 'object') {
      profile.shopDailyClaims = {};
    }
    if (profile.shopDailyDate === undefined) profile.shopDailyDate = null;
    return profile;
  }

  /**
   * 添加货币
   */
  addCurrency(type, amount) {
    const caps = { gold: 99999999, diamond: 99999999, stardust: 99999999 };
    this[type] = Math.min((this[type] || 0) + amount, caps[type] || Infinity);
  }

  /**
   * 消费货币（成功返回true，不足返回false）
   */
  spendCurrency(type, amount) {
    if ((this[type] || 0) < amount) return false;
    this[type] -= amount;
    return true;
  }

  /**
   * 记录PvP对战结果
   */
  recordBattleResult(isWin) {
    this.totalGames++;
    if (isWin) {
      this.totalWins++;
      this.pvpWins++;
      this.pvpWinStreak++;
      if (this.pvpWinStreak > this.pvpMaxStreak) {
        this.pvpMaxStreak = this.pvpWinStreak;
      }
    } else {
      this.pvpLosses++;
      this.pvpWinStreak = 0;
    }
    this.lastPlayDate = new Date().toISOString().slice(0, 10);
  }

  /**
   * 解锁种族
   */
  unlockRace(raceId) {
    if (!this.unlockedRaces.includes(raceId)) {
      this.unlockedRaces.push(raceId);
    }
  }

  /**
   * 获取科技树节点等级
   */
  getTechNodeLevel(nodeId) {
    return this.techTree[nodeId] || 0;
  }

  /**
   * 获取总战力值
   * 委托 PowerSystem：基于上阵兵种实际属性（攻/血/速系数、品质乘数、技能、射程）
   * + 上阵羁绊等级 + 建筑强化等级 + 科技等级（只统计上阵内容）
   */
  getTotalPower() {
    return calculatePlayerPower(this).total;
  }

  /**
   * 检查今天还能否观看指定广告位的激励视频
   * 跨天自动清零 dailyAdWatched
   *
   * @param {string} key - 业务标识，如 'gachaFreeDraw'
   * @param {number} limit - 每日上限（从 ads.json 的 _limits 取）
   * @returns {boolean} 是否还有配额
   */
  canWatchAd(key, limit) {
    if (!key || !(limit > 0)) return false;
    const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    if (this.lastAdDate !== today) {
      this.dailyAdWatched = {};
      this.lastAdDate = today;
    }
    return (this.dailyAdWatched[key] || 0) < limit;
  }

  /**
   * 消耗一次广告配额（看完视频发奖后调用）
   * @param {string} key - 业务标识
   */
  consumeAdQuota(key) {
    if (!key) return;
    const today = new Date().toISOString().slice(0, 10);
    if (this.lastAdDate !== today) {
      this.dailyAdWatched = {};
      this.lastAdDate = today;
    }
    this.dailyAdWatched[key] = (this.dailyAdWatched[key] || 0) + 1;
  }

  // ============ P37：商店免费分页「每日领取计数」 ============

  /**
   * 跨天自动清零商店免费领取记录
   * @returns {object} 清零后的 shopDailyClaims
   */
  resetShopDailyIfNewDay() {
    const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    if (!this.shopDailyClaims || typeof this.shopDailyClaims !== 'object') {
      this.shopDailyClaims = {};
    }
    if (this.shopDailyDate !== today) {
      this.shopDailyClaims = {};
      this.shopDailyDate = today;
    }
    return this.shopDailyClaims;
  }

  /**
   * 查询某商品今日已领取次数
   * @param {string} itemId
   */
  getShopDailyClaimed(itemId) {
    this.resetShopDailyIfNewDay();
    return this.shopDailyClaims[itemId] || 0;
  }

  /**
   * 记录一次今日领取（领取成功后调用）
   * @param {string} itemId
   * @returns {number} 领取后的累计次数
   */
  claimShopDaily(itemId) {
    this.resetShopDailyIfNewDay();
    this.shopDailyClaims[itemId] = (this.shopDailyClaims[itemId] || 0) + 1;
    return this.shopDailyClaims[itemId];
  }
}
