/**
 * Auto-generated from equipment.json
 * Do not edit. Regenerate via: npm run build:config
 *
 * 微信小游戏专用: require('../../config/equipment.js') 即可加载
 */
module.exports = {
  "slots": [
    "weapon",
    "armor",
    "accessory",
    "medal"
  ],
  "slotNames": {
    "weapon": "武器",
    "armor": "护甲",
    "accessory": "饰品",
    "medal": "勋章"
  },
  "qualities": [
    {
      "id": "common",
      "name": "普通",
      "color": "#a0a0a0",
      "mainStatRange": [
        0.05,
        0.08
      ],
      "subStatCount": 1,
      "weight": 40
    },
    {
      "id": "rare",
      "name": "稀有",
      "color": "#4a9eff",
      "mainStatRange": [
        0.08,
        0.12
      ],
      "subStatCount": 2,
      "weight": 30
    },
    {
      "id": "epic",
      "name": "史诗",
      "color": "#a855f7",
      "mainStatRange": [
        0.12,
        0.16
      ],
      "subStatCount": 3,
      "weight": 20
    },
    {
      "id": "legendary",
      "name": "传说",
      "color": "#f59e0b",
      "mainStatRange": [
        0.16,
        0.22
      ],
      "subStatCount": 4,
      "weight": 8
    },
    {
      "id": "mythic",
      "name": "神话",
      "color": "#ef4444",
      "mainStatRange": [
        0.22,
        0.3
      ],
      "subStatCount": 4,
      "weight": 2
    }
  ],
  "statTypes": [
    {
      "id": "attack_percent",
      "name": "攻击力%",
      "minValue": 0.03,
      "maxValue": 0.06,
      "appliesTo": [
        "weapon",
        "medal"
      ]
    },
    {
      "id": "crit_rate",
      "name": "暴击率",
      "minValue": 0.02,
      "maxValue": 0.05,
      "appliesTo": [
        "weapon",
        "accessory"
      ]
    },
    {
      "id": "building_hp_percent",
      "name": "建筑生命%",
      "minValue": 0.05,
      "maxValue": 0.1,
      "appliesTo": [
        "armor",
        "medal"
      ]
    },
    {
      "id": "building_defense_percent",
      "name": "建筑防御%",
      "minValue": 0.05,
      "maxValue": 0.1,
      "appliesTo": [
        "armor"
      ]
    },
    {
      "id": "march_speed_percent",
      "name": "行军速度%",
      "minValue": 0.03,
      "maxValue": 0.06,
      "appliesTo": [
        "accessory",
        "medal"
      ]
    },
    {
      "id": "gold_production",
      "name": "金币产出%",
      "minValue": 0.05,
      "maxValue": 0.1,
      "appliesTo": [
        "accessory"
      ]
    },
    {
      "id": "tower_damage",
      "name": "箭塔伤害%",
      "minValue": 0.05,
      "maxValue": 0.1,
      "appliesTo": [
        "weapon",
        "medal"
      ]
    },
    {
      "id": "synergy_boost",
      "name": "羁绊增强%",
      "minValue": 0.03,
      "maxValue": 0.06,
      "appliesTo": [
        "accessory"
      ]
    },
    {
      "id": "heal_boost",
      "name": "回血加成%",
      "minValue": 0.05,
      "maxValue": 0.1,
      "appliesTo": [
        "armor"
      ]
    },
    {
      "id": "all_stat_boost",
      "name": "全属性%",
      "minValue": 0.02,
      "maxValue": 0.04,
      "appliesTo": [
        "medal"
      ]
    }
  ],
  "dropTable": {
    "levelComplete": {
      "baseDropRate": 0.35,
      "starBonusPerStar": 0.1,
      "qualityWeights": {
        "common": 45,
        "rare": 30,
        "epic": 18,
        "legendary": 6,
        "mythic": 1
      }
    },
    "bossLevel": {
      "baseDropRate": 0.8,
      "starBonusPerStar": 0.05,
      "qualityWeights": {
        "common": 15,
        "rare": 30,
        "epic": 35,
        "legendary": 17,
        "mythic": 3
      }
    }
  },
  "decompose": {
    "common": {
      "stardust": 5,
      "gold": 50
    },
    "rare": {
      "stardust": 15,
      "gold": 150
    },
    "epic": {
      "stardust": 40,
      "gold": 400
    },
    "legendary": {
      "stardust": 100,
      "gold": 1000
    },
    "mythic": {
      "stardust": 300,
      "gold": 3000
    }
  },
  "presetEquipments": [
    {
      "id": "newbie_sword",
      "name": "新手长剑",
      "slot": "weapon",
      "quality": "common",
      "mainStat": {
        "type": "attack_percent",
        "value": 0.06
      },
      "subStats": [
        {
          "type": "crit_rate",
          "value": 0.02
        }
      ]
    },
    {
      "id": "newbie_shield",
      "name": "新手圆盾",
      "slot": "armor",
      "quality": "common",
      "mainStat": {
        "type": "building_hp_percent",
        "value": 0.06
      },
      "subStats": [
        {
          "type": "building_defense_percent",
          "value": 0.04
        }
      ]
    },
    {
      "id": "newbie_ring",
      "name": "新手指环",
      "slot": "accessory",
      "quality": "common",
      "mainStat": {
        "type": "gold_production",
        "value": 0.05
      },
      "subStats": [
        {
          "type": "march_speed_percent",
          "value": 0.03
        }
      ]
    }
  ]
};
