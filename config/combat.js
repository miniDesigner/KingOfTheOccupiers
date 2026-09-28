/**
 * Auto-generated from combat.json
 * Do not edit. Regenerate via: npm run build:config
 *
 * 微信小游戏专用: require('../../config/combat.js') 即可加载
 */
module.exports = {
  "_doc": "战斗参数配置 - 遭遇战演出时长和阶段控制",
  "_doc_phases": "approach=接敌接近阶段 resolve=结算阶段 vs_building=vs建筑总时长 vs_warrior=vs战士总时长",
  "duration": {
    "vsBuilding": 1,
    "vsWarrior": 1.2,
    "approach": 0.3,
    "resolve": 0.5
  },
  "_doc_duration": "各阶段动画时长(秒)，影响战斗演出节奏",
  "warriorVsBuilding": {
    "_doc": "战士vs建筑战斗规则",
    "warriorAttackBase": 1,
    "_doc_warriorAttackBase": "每个战士对建筑的基础攻击力",
    "buildingDefenseReduction": 1,
    "_doc_buildingDefenseReduction": "建筑防御减伤系数(1.0=全额减伤)"
  },
  "warriorVsWarrior": {
    "_doc": "战士vs战士战斗规则 - 总力对决模式",
    "_doc_result": "根据双方战力比值判定5档结果: 完胜/大胜/小胜/惨胜/同归于尽"
  }
};
