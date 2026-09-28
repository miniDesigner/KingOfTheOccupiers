/**
 * Auto-generated from tiles.json
 * Do not edit. Regenerate via: npm run build:config
 *
 * 微信小游戏专用: require('../../config/tiles.js') 即可加载
 */
module.exports = {
  "_doc": "地块分布配置 - 预设建筑出现概率 + 随机格翻转结果概率",
  "_doc_validation": "两个概率表的值之和必须等于1.0",
  "presetDistribution": {
    "_doc": "地图生成时每个格子的预设建筑类型概率分布",
    "barracks_lv1": 0.25,
    "barracks_lv2": 0.14,
    "barracks_lv3": 0.07,
    "barracks_lv4": 0.03,
    "arrow_tower": 0.13,
    "gold_mine_lv1": 0.1,
    "gold_mine_lv2": 0.06,
    "random": 0.22,
    "_doc_random": "random=随机格，翻转时按randomTileResults概率获得建筑"
  },
  "randomTileResults": {
    "_doc": "翻转随机格时的结果概率分布",
    "empty": 0.63,
    "barracks_lv1": 0.15,
    "arrow_tower": 0.1,
    "gold_mine_lv1": 0.1,
    "barracks_lv2": 0.02
  },
  "randomTileCost": 5,
  "_doc_randomTileCost": "翻转随机格的金币消耗(固定值)"
};
