/**
 * AdManager — 微信广告统一封装
 *
 * 设计目标：
 *   1. 封装 wx.createRewardedVideoAd / createInterstitialAd / createBannerAd 三大 API
 *   2. Promise 化 onLoad/onClose/onError，回调用 await/then 写法更直观
 *   3. 自动预加载（仅激励视频，激励视频预加载完才能秒播）
 *   4. isWxEnv 三态兼容：真微信/模拟器/浏览器预览，后两者走 noop 兜底
 *   5. 广告位 adUnitId 来自 config/ads.json，无配置时直接视为不可用
 *
 * 合规硬要求（微信平台规则）：
 *   - 激励视频必须真实发奖励：onClose 回调的 res.isEnded=true 才发放
 *   - 不能用 wx.requestPayment 替代（小游戏需走 wx.requestVirtualPayment / 米大师）
 *   - adUnitId 必须在微信公众平台后台申请，开发阶段用测试 ID（adUnitId = 'adunit-xxx'）
 *
 * 用法示例（抽卡界面）：
 *   import AdManager from './AdManager.js';
 *
 *   async function onFreeDrawClick() {
 *     if (!AdManager.canShowRewarded('gachaFreeDraw')) {
 *       toast('今日免费次数已用完');
 *       return;
 *     }
 *     const res = await AdManager.showRewarded('gachaFreeDraw');
 *     if (res.isEnded) {
 *       // 用户看完，发奖励：免费抽一次
 *       doFreeDraw();
 *     } else {
 *       toast('需看完视频才能领取奖励');
 *     }
 *   }
 */

// 微信广告 API 标志位（与 ConfigLoader.isWxEnv 一致）
// 微信小游戏真机：typeof require === 'function' && typeof wx !== 'undefined' && wx.__tkBrowser !== true
// 模拟器（nw.js）：与真机一致（wx 原生存在）
// 浏览器预览：wx-shim 注入了 __tkBrowser=true
function isWxEnv() {
  if (typeof require !== 'function') return false;
  if (typeof wx === 'undefined') return false;
  if (wx.__tkBrowser === true) return false;
  // 真微信还需要有 createRewardedVideoAd 等广告 API
  if (typeof wx.createRewardedVideoAd !== 'function') return false;
  return true;
}

// 广告配置（由 init() 从 config/ads.json 注入）
let _adsConfig = null;
// 是否启用广告（默认开启，浏览器预览关闭）
let _enabled = true;

// 各类型广告实例缓存（按 adUnitId 复用）
const _rewardedInstances = new Map();   // adUnitId -> RewardedVideoAd instance
const _interstitialInstance = null;    // 全局仅一个
const _bannerInstance = null;          // 全局仅一个

// 激励视频预加载队列（哪些 id 已经预加载过）
const _rewardedPreloaded = new Set();

/**
 * 初始化广告配置
 *
 * 由 Game.js 在 ConfigLoader.init() 完成后执行：
 *   const adsConfig = await ConfigLoader.get('ads');
 *   AdManager.init(adsConfig);
 *
 * @param {Object} config - config/ads.json 解析后的对象
 *        { enabled: bool, rewarded: { gachaFreeDraw: 'adunit-xxx', ... }, interstitial: 'adunit-xxx', banner: 'adunit-xxx' }
 */
function init(config) {
  _adsConfig = config || {};
  _enabled = _adsConfig.enabled !== false; // 默认 true

  if (isWxEnv() && _enabled) {
    // 预热第一个激励视频位（不报错时不刷日志，错误一律静默）
    const firstRewardedId = Object.values(_adsConfig.rewarded || {})[0];
    if (firstRewardedId) {
      _preloadRewarded(firstRewardedId);
    }
  }
}

/**
 * 业务标识 -> adUnitId
 * @param {string} key - 业务标识，如 'gachaFreeDraw'、'victoryDouble'
 * @returns {string|null} adUnitId，未配置返回 null
 */
function _getRewardedId(key) {
  if (!_adsConfig || !_adsConfig.rewarded) return null;
  return _adsConfig.rewarded[key] || null;
}

/**
 * 预加载激励视频（内部用）
 * 微信规定激励视频必须在 load() 后才能 show()，且预加载过的下次秒播
 */
function _preloadRewarded(adUnitId) {
  if (!adUnitId) return;
  if (_rewardedPreloaded.has(adUnitId)) return;
  if (!isWxEnv() || !_enabled) return;

  try {
    const ad = wx.createRewardedVideoAd({ adUnitId });
    if (!ad) return;

    // 错误一律静默（开发期没有 adUnitId 会触发）
    ad.onError(() => {});

    ad.load().then(() => {
      _rewardedInstances.set(adUnitId, ad);
      _rewardedPreloaded.add(adUnitId);
    }).catch(() => {
      // 加载失败，丢弃实例，下次再创建
      _rewardedInstances.delete(adUnitId);
    });
  } catch (e) {
    // 沙箱/兼容性错误静默吞掉
  }
}

/**
 * 判断是否可以展示激励视频（业务层决策，如每日限次）
 * 注意：此函数只做配置检查 + 业务开关判定，不强制要求预加载完成
 *
 * @param {string} key - 业务标识
 * @returns {boolean} 是否可展示
 */
function canShowRewarded(key) {
  if (!_enabled || !isWxEnv()) return false;
  if (!_getRewardedId(key)) return false;
  return true;
}

/**
 * 展示激励视频，等待用户看完或中途退出
 * @param {string} key - 业务标识（如 'gachaFreeDraw'）
 * @returns {Promise<{isEnded: boolean, reason?: string}>}
 *          - isEnded=true: 用户完整看完，应发奖励
 *          - isEnded=false: 用户中途关闭，reason='closed' 或 'error'
 *          - reason='unavailable': 非真微信环境或未配置 adUnitId（业务层可降级处理）
 */
function showRewarded(key) {
  return new Promise((resolve) => {
    if (!canShowRewarded(key)) {
      resolve({ isEnded: false, reason: 'unavailable' });
      return;
    }

    const adUnitId = _getRewardedId(key);
    // 复用已预加载的实例，否则新创建
    let ad = _rewardedInstances.get(adUnitId);
    if (!ad) {
      try {
        ad = wx.createRewardedVideoAd({ adUnitId });
        if (!ad) {
          resolve({ isEnded: false, reason: 'error' });
          return;
        }
        _rewardedInstances.set(adUnitId, ad);
      } catch (e) {
        resolve({ isEnded: false, reason: 'error' });
        return;
      }
    }

    let settled = false;
    const settle = (result) => {
      if (settled) return;
      settled = true;
      // 清理本次的回调监听（避免下次复用时残留）
      try { ad.offClose && ad.offClose(); } catch (e) { /* noop */ }
      // 预加载下次可用实例
      _preloadRewarded(adUnitId);
      resolve(result);
    };

    // 监听关闭
    const onClose = (res) => {
      // res && res.isEnded === true 表示完整看完
      if (res && res.isEnded) {
        settle({ isEnded: true });
      } else {
        settle({ isEnded: false, reason: 'closed' });
      }
    };

    // 错误监听
    const onError = (err) => {
      // 开发期没有 adUnitId 会触发，静默兜底
      settle({ isEnded: false, reason: 'error', detail: err });
    };

    if (typeof ad.onClose === 'function') ad.onClose(onClose);
    if (typeof ad.onError === 'function') ad.onError(onError);

    // 展示
    if (typeof ad.show === 'function') {
      ad.show().catch(() => {
        // show 失败（首次未 load 完成），尝试重新 load 后再 show
        ad.load && ad.load().then(() => ad.show()).catch(() => {
          settle({ isEnded: false, reason: 'error' });
        });
      });
    } else {
      settle({ isEnded: false, reason: 'error' });
    }
  });
}

/**
 * 展示插屏广告（结算页用）
 * @returns {Promise<{shown: boolean, reason?: string}>}
 */
function showInterstitial() {
  return new Promise((resolve) => {
    if (!_enabled || !isWxEnv()) {
      resolve({ shown: false, reason: 'unavailable' });
      return;
    }
    const adUnitId = _adsConfig && _adsConfig.interstitial;
    if (!adUnitId) {
      resolve({ shown: false, reason: 'no_config' });
      return;
    }
    try {
      const ad = wx.createInterstitialAd({ adUnitId });
      if (!ad) {
        resolve({ shown: false, reason: 'error' });
        return;
      }
      let settled = false;
      const settle = (result) => {
        if (settled) return;
        settled = true;
        resolve(result);
      };
      ad.onLoad && ad.onLoad(() => {
        ad.show && ad.show().then(() => settle({ shown: true }))
                       .catch(() => settle({ shown: false, reason: 'error' }));
      });
      ad.onError && ad.onError((err) => settle({ shown: false, reason: 'error', detail: err }));
      ad.load && ad.load();
    } catch (e) {
      resolve({ shown: false, reason: 'error' });
    }
  });
}

/**
 * 展示 Banner 广告（大厅底部用）
 * @returns {Promise<{shown: boolean, reason?: string, ad?: null }>}
 */
function showBanner() {
  return new Promise((resolve) => {
    if (!_enabled || !isWxEnv()) {
      resolve({ shown: false, reason: 'unavailable' });
      return;
    }
    const adUnitId = _adsConfig && _adsConfig.banner;
    if (!adUnitId) {
      resolve({ shown: false, reason: 'no_config' });
      return;
    }
    try {
      const ad = wx.createBannerAd({
        adUnitId,
        style: { left: 0, top: 0, width: 0 }, // 实际定位在 Game 端按 safeArea 调整
      });
      if (!ad) {
        resolve({ shown: false, reason: 'error' });
        return;
      }
      ad.onLoad && ad.onLoad(() => resolve({ shown: true, ad }));
      ad.onError && ad.onError((err) => resolve({ shown: false, reason: 'error', detail: err }));
    } catch (e) {
      resolve({ shown: false, reason: 'error' });
    }
  });
}

/**
 * 隐藏 Banner 广告
 */
function hideBanner(ad) {
  if (ad && typeof ad.hide === 'function') {
    try { ad.hide(); } catch (e) { /* noop */ }
  }
}

/**
 * 检查当前是否在真微信环境（业务层做降级判断）
 * @returns {boolean}
 */
function isAvailable() {
  return isWxEnv();
}

export default {
  init,
  isAvailable,
  canShowRewarded,
  showRewarded,
  showInterstitial,
  showBanner,
  hideBanner,
};