/**
 * ShopSystem — 商店系统
 * 商品购买 / 限购检查 / 奖励发放
 *
 * P25 features 过滤：依据 game.json features.shopDiamondTab 控制是否过滤掉 'diamond' 分类
 * - shopDiamondTab=false 时（上线场景默认）→ 完全隐藏「钻石充值」分类
 * - shopDiamondTab=true 时 → 保留所有分类
 *
 * P26 联动过滤：features.battlePass=false 时 → 过滤掉 special 分类下的 battle_pass_premium
 *   （通行证高级版购买）。该商品与大厅「🎖 通行证」入口共享同一开关，
 *   关闭时不能让用户绕过大厅入口在商店里直接购买。
 * - battlePass=true 时 → 正常显示 battle_pass_premium
 *
 * P37 免费分页：商品配置带 dailyLimit 时视为「每日免费领取」商品
 * - 计数存 PlayerProfile.shopDailyClaims，跨天自动清零
 * - 规则：每日首次点击直接领取；之后每次必须看完激励视频（adKey）才能领取
 * - 防御层：needAd=true 时 purchase 必须带 { adVerified: true }，否则拒绝发放
 *   （与 P26 同理：即便绕过 UI 直接调 purchase 也不能白拿）
 * 注意：game.json 开关需在 ConfigLoader 启动时载入（已由 ConfigLoader.get('game') 统一管理）
 */

import ConfigLoader from '../data/ConfigLoader.js';
import { get as getProfile, save as saveProfile } from './ProfileManager.js';

/**
 * 获取配置
 */
function _getConfig() {
  return ConfigLoader.get('shop');
}

/**
 * 是否为「每日免费领取」商品（P37）
 * 判据：配了 dailyLimit 且没有真实货币/道具花费
 */
function _isFreeItem(item) {
  return !!(item && item.dailyLimit > 0);
}

/**
 * 计算免费商品的每日状态（P37）
 * @returns {{isFree, dailyLimit, dailyClaimed, dailyRemaining, needAd, adKey, exhausted}}
 *   - needAd: 已领过 ≥1 次且还有次数 → 本次需看完广告
 *   - exhausted: 今日次数已用完
 */
function _dailyState(profile, item) {
  const limit = item.dailyLimit || 0;
  const claimed = profile.getShopDailyClaimed(item.id);
  const remaining = Math.max(0, limit - claimed);
  return {
    isFree: true,
    dailyLimit: limit,
    dailyClaimed: claimed,
    dailyRemaining: remaining,
    // 每日首次（claimed === 0）直接领取；之后每次都要看广告
    needAd: claimed > 0 && remaining > 0,
    adKey: item.adKey || null,
    exhausted: remaining <= 0,
  };
}

/**
 * 获取所有商品(含购买状态)
 *
 * 免费商品（P37）额外返回：isFree / dailyLimit / dailyClaimed / dailyRemaining / needAd / adKey / exhausted
 */
function getShopItems() {
  const profile = getProfile();
  const config = _getConfig();
  // P25 features：钻石充值分类独立开关（保留商店其他分类：currency/packs/special）
  const _features = ConfigLoader.getSafe('game')?.features || {};
  const _diamondTabEnabled = _features.shopDiamondTab === true;
  // P26 联动：battlePass=false 时隐藏「通行证(高级)」商品项（按 item.id 过滤）
  const _battlePassEnabled = _features.battlePass !== false;

  if (!profile.shopPurchases) {
    profile.shopPurchases = {};
  }

  const result = [];
  for (const cat of config.categories) {
    // P25 features.shopDiamondTab=false 时隐藏「钻石充值」分类（仅此分类，其他保留）
    if (cat.id === 'diamond' && !_diamondTabEnabled) continue;
    result.push({
      categoryId: cat.id,
      categoryName: cat.name,
      items: cat.items
        // P26 联动：battlePass=false 时过滤掉 battle_pass_premium 商品（特惠分类下）
        .filter(i => !(i.id === 'battle_pass_premium' && !_battlePassEnabled))
        .map(item => {
          const purchased = profile.shopPurchases[item.id] || 0;
          const remaining = item.limit > 0 ? Math.max(0, item.limit - purchased) : -1; // -1 = 无限

          // P37 免费商品：按每日次数计，不走累计限购
          if (_isFreeItem(item)) {
            const st = _dailyState(profile, item);
            return {
              ...item,
              purchased: 0,
              remaining: st.dailyRemaining,
              canAfford: !st.exhausted, // 次数用完 → 按钮不可点
              ...st,
            };
          }

          return {
            ...item,
            purchased,
            remaining,
            canAfford: _canAfford(profile, item.cost),
            isFree: false,
          };
        }),
    });
  }
  return result;
}

/**
 * 检查是否买得起
 */
function _canAfford(profile, cost) {
  for (const [currency, amount] of Object.entries(cost)) {
    if (currency === 'realMoney') continue; // 真实货币另行处理
    if ((profile[currency] || 0) < amount) return false;
  }
  return true;
}

/**
 * 购买 / 领取商品
 *
 * @param {string} itemId
 * @param {object} [opts] P37 领取选项
 *        opts.adVerified=true 表示激励视频已看完（needAd 商品必填）
 * @returns {object} { success: boolean, reason?: string, reward?: object, ... }
 */
function purchase(itemId, opts = {}) {
  const profile = getProfile();
  const config = _getConfig();

  if (!profile.shopPurchases) {
    profile.shopPurchases = {};
  }

  // 查找商品
  let item = null;
  for (const cat of config.categories) {
    item = cat.items.find(i => i.id === itemId);
    if (item) break;
  }
  if (!item) return { success: false, reason: '商品不存在' };

  // P26 防御层：即使 getShopItems 过滤了，仍拦截绕过展示直接调 purchase 的请求
  // 场景：旧版本存档/旧逻辑直接调 purchase('battle_pass_premium')/后续脚本/调试 API
  const _features = ConfigLoader.getSafe('game')?.features || {};
  if (item.id === 'battle_pass_premium' && _features.battlePass === false) {
    return { success: false, reason: '通行证功能暂未开放' };
  }

  // === P37 免费商品：每日限次 + 广告校验 ===
  if (_isFreeItem(item)) {
    const st = _dailyState(profile, item);
    if (st.exhausted) {
      return { success: false, reason: '今日次数已用完', exhausted: true, needAd: false };
    }
    // 非首次领取必须先看完激励视频（UI 走 Game._handleShopFreeClaim → AdManager）
    if (st.needAd && opts.adVerified !== true) {
      return { success: false, reason: '需看完广告才能领取', needAd: true, adKey: st.adKey };
    }

    profile.claimShopDaily(item.id); // 计数（内部已处理跨天清零）
    const rewardResult = _grantReward(profile, item.reward);
    saveProfile();

    const after = _dailyState(profile, item);
    return {
      success: true,
      reward: rewardResult,
      free: true,
      dailyClaimed: after.dailyClaimed,
      dailyRemaining: after.dailyRemaining,
      needAdNext: after.needAd,
    };
  }

  // 检查限购
  const purchased = profile.shopPurchases[itemId] || 0;
  if (item.limit > 0 && purchased >= item.limit) {
    return { success: false, reason: '已达购买上限' };
  }

  // 检查货币
  if (!_canAfford(profile, item.cost)) {
    return { success: false, reason: '货币不足' };
  }

  // 扣除货币
  for (const [currency, amount] of Object.entries(item.cost)) {
    if (currency === 'realMoney') continue;
    profile.spendCurrency(currency, amount);
  }

  // 记录购买
  profile.shopPurchases[itemId] = purchased + 1;

  // 发放奖励
  const rewardResult = _grantReward(profile, item.reward);

  saveProfile();
  return { success: true, reward: rewardResult };
}

/**
 * 发放奖励(处理特殊类型)
 */
function _grantReward(profile, reward) {
  const result = { currencies: {}, items: [] };

  if (!reward) return result;

  if (reward.type === 'battlePassPremium') {
    profile.battlePass.premium = true;
    result.items.push({ type: 'battlePassPremium' });
    return result;
  }

  // 普通货币奖励
  for (const [currency, amount] of Object.entries(reward)) {
    if (currency === 'type' || currency === 'count' || currency === 'qualityPool') continue;
    profile.addCurrency(currency, amount);
    result.currencies[currency] = amount;
  }

  return result;
}

/**
 * 获取商品分类名称
 */
function getCategoryNames() {
  const config = _getConfig();
  // P25 features.shopDiamondTab=false 时过滤掉 diamond 分类（与 getShopItems 保持一致）
  const _features = ConfigLoader.getSafe('game')?.features || {};
  const _diamondTabEnabled = _features.shopDiamondTab === true;
  return config.categories
    .filter(c => !(c.id === 'diamond' && !_diamondTabEnabled))
    .map(c => ({ id: c.id, name: c.name }));
}

/**
 * 获取免费分页商品（P37，含每日状态）
 * 供 UI / 测试直接取用，避免各自遍历
 */
function getFreeItems() {
  const profile = getProfile();
  const config = _getConfig();
  const out = [];
  for (const cat of config.categories) {
    for (const item of cat.items) {
      if (!_isFreeItem(item)) continue;
      const st = _dailyState(profile, item);
      // canAfford 与 getShopItems 保持同一口径：次数用完 → 不可点
      out.push({ ...item, ...st, canAfford: !st.exhausted });
    }
  }
  return out;
}

export {
  getShopItems,
  getFreeItems,
  purchase,
  getCategoryNames,
};
export default {
  getShopItems,
  getFreeItems,
  purchase,
  getCategoryNames,
};
