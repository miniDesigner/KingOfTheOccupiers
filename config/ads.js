/**
 * Auto-generated from ads.json
 * Do not edit. Regenerate via: npm run build:config
 *
 * 微信小游戏专用: require('../../config/ads.js') 即可加载
 */
module.exports = {
  "enabled": true,
  "_comment": "广告位配置。adUnitId 在微信公众平台后台申请（https://mp.weixin.qq.com → 推广 → 广告位管理）。开发阶段先用占位 ID，会触发 wx 广告 API 错误，AdManager 静默兜底。激励视频是必填项，插屏与 Banner 可选。",
  "rewarded": {
    "_comment": "激励视频广告位：每个 key 对应一个业务场景（看一次视频 = 发一次奖励）。key 命名建议与业务模块同名，便于检索。",
    "gachaFreeDraw": "adunit-rewarded-gacha-free",
    "victoryDouble": "adunit-rewarded-victory-double",
    "taskRefresh": "adunit-rewarded-task-refresh",
    "reviveContinue": "adunit-rewarded-revive",
    "shopFreeDiamond": "adunit-rewarded-shop-free-diamond",
    "shopFreeGold": "adunit-rewarded-shop-free-gold"
  },
  "interstitial": "adunit-interstitial-settlement",
  "banner": "adunit-banner-lobby",
  "_limits": {
    "_comment": "业务层每日观看限制（防刷），由 Game.js 配合 PlayerProfile.dailyAdWatched 实现，不在本配置里强约束。商店免费分页的每日领取次数由 shop.json 的 dailyLimit 控制（首次直领，其余看广告），此处为广告观看上限。",
    "gachaFreeDraw": 1,
    "victoryDouble": 3,
    "taskRefresh": 1,
    "reviveContinue": 2,
    "shopFreeDiamond": 4,
    "shopFreeGold": 4
  }
};
