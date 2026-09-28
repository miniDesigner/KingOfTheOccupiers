/**
 * Auto-generated from synergy.json
 * Do not edit. Regenerate via: npm run build:config
 *
 * 微信小游戏专用: require('../../config/synergy.js') 即可加载
 */
module.exports = {
  "_doc": "羁绊系统配置 - 种族羁绊(各族差异化) + 战斗方式羁绊(4种)",
  "_doc_race": "种族羁绊: 每族独立配置加成效果，触发阈值统一为2/4/6件",
  "_doc_style": "战斗方式羁绊: 近战(3/5/7)、远程(2/4)、防御(2/4)、法术(2/4)",
  "_doc_note": "种族羁绊的详细加成配置在 races.json 的 raceSynergy 字段中，本文件仅配置阈值和战斗方式羁绊",
  "raceSynergy": {
    "thresholds": [
      2,
      4,
      6
    ],
    "_doc_thresholds": "触发阶位: 2件=1阶 4件=2阶 6件=3阶(所有种族统一)",
    "_doc_bonuses": "各族的独立加成效果见 races.json -> {race}.raceSynergy.{1|2|3}"
  },
  "styleSynergy": {
    "melee": {
      "_doc": "近战羁绊: 近战兵种数量达到阈值触发",
      "thresholds": [
        3,
        5,
        7
      ],
      "bonuses": [
        {
          "attackBonus": 0.1,
          "_doc": "1阶(3件): 攻击力+10%"
        },
        {
          "attackBonus": 0.2,
          "_doc": "2阶(5件): 攻击力+20%"
        },
        {
          "attackBonus": 0.3,
          "_doc": "3阶(7件): 攻击力+30%"
        }
      ]
    },
    "ranged": {
      "_doc": "远程羁绊: 远程兵种数量达到阈值触发",
      "thresholds": [
        2,
        4
      ],
      "bonuses": [
        {
          "speedBonus": 0.15,
          "firstStrike": true,
          "_doc": "1阶(2件): 行军速度+15%, 遭遇战先手攻击"
        },
        {
          "speedBonus": 0.3,
          "firstStrike": true,
          "_doc": "2阶(4件): 行军速度+30%, 遭遇战先手攻击"
        }
      ]
    },
    "defense": {
      "_doc": "防御羁绊: 防御型建筑/兵种数量达到阈值触发",
      "thresholds": [
        2,
        4
      ],
      "bonuses": [
        {
          "buildingHpBonus": 0.2,
          "damageReduction": 0.1,
          "_doc": "1阶(2件): 建筑生命值+20%, 被攻击减免10%"
        },
        {
          "buildingHpBonus": 0.4,
          "damageReduction": 0.2,
          "_doc": "2阶(4件): 建筑生命值+40%, 被攻击减免20%"
        }
      ]
    },
    "magic": {
      "_doc": "法术羁绊: 法术兵种数量达到阈值触发",
      "thresholds": [
        2,
        4
      ],
      "bonuses": [
        {
          "critBonus": 0.15,
          "damageBonus": 0.1,
          "_doc": "1阶(2件): 暴击率+15%, 遭遇战伤害+10%"
        },
        {
          "critBonus": 0.3,
          "damageBonus": 0.25,
          "_doc": "2阶(4件): 暴击率+30%, 遭遇战伤害+25%"
        }
      ]
    }
  }
};
