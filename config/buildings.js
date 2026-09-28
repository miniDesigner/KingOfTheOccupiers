/**
 * Auto-generated from buildings.json
 * Do not edit. Regenerate via: npm run build:config
 *
 * 微信小游戏专用: require('../../config/buildings.js') 即可加载
 */
module.exports = {
  "_doc": "建筑配置表 - 所有建筑类型的数值参数，按建筑类型->等级组织",
  "_doc_types": "barracks=兵营(4级) arrow_tower=箭塔 gold_mine=金矿(2级) headquarters=大本营 empty=空地",
  "_doc_fields": {
    "cost": "翻转消耗(金币)",
    "hp": "建筑生命值",
    "warriorRate": "战士产出速率(个/秒)，0=不产出",
    "attackBonus": "攻击力加成(百分比，0.1=+10%)",
    "defense": "防御值(固定减伤)",
    "goldRate": "金币产出速率(个/秒)，金矿/大本营可用",
    "maxQuality": "兵营可随机到的最高品质等级(1~6)",
    "range": "攻击射程(格，箭塔/大本营)",
    "attackDamage": "每次攻击伤害(箭塔/大本营)",
    "attackCooldown": "攻击间隔(秒，箭塔/大本营)",
    "color": "建筑在地图上的显示颜色",
    "name": "建筑显示名称"
  },
  "barracks": {
    "1": {
      "cost": 30,
      "hp": 20,
      "warriorRate": 1,
      "attackBonus": 0,
      "defense": 0,
      "maxQuality": 2,
      "color": "#6b7280",
      "name": "兵营Lv1"
    },
    "2": {
      "cost": 50,
      "hp": 35,
      "warriorRate": 2,
      "attackBonus": 0.1,
      "defense": 2,
      "maxQuality": 3,
      "color": "#3b82f6",
      "name": "兵营Lv2"
    },
    "3": {
      "cost": 80,
      "hp": 55,
      "warriorRate": 4,
      "attackBonus": 0.25,
      "defense": 5,
      "maxQuality": 5,
      "color": "#8b5cf6",
      "name": "兵营Lv3"
    },
    "4": {
      "cost": 120,
      "hp": 80,
      "warriorRate": 6,
      "attackBonus": 0.5,
      "defense": 8,
      "maxQuality": 6,
      "color": "#f59e0b",
      "name": "兵营Lv4"
    }
  },
  "arrow_tower": {
    "1": {
      "cost": 25,
      "hp": 30,
      "warriorRate": 0,
      "attackBonus": 0,
      "defense": 5,
      "range": 2,
      "attackDamage": 4,
      "attackCooldown": 1.5,
      "color": "#10b981",
      "name": "箭塔"
    }
  },
  "gold_mine": {
    "1": {
      "cost": 15,
      "hp": 15,
      "warriorRate": 0,
      "attackBonus": 0,
      "defense": 0,
      "goldRate": 1,
      "color": "#fbbf24",
      "name": "金矿Lv1"
    },
    "2": {
      "cost": 20,
      "hp": 15,
      "warriorRate": 0,
      "attackBonus": 0,
      "defense": 0,
      "goldRate": 2,
      "color": "#fbbf24",
      "name": "金矿Lv2"
    }
  },
  "headquarters": {
    "1": {
      "cost": 0,
      "hp": 100,
      "warriorRate": 0,
      "goldRate": 1,
      "attackBonus": 0,
      "defense": 5,
      "range": 2,
      "attackDamage": 5,
      "attackCooldown": 2,
      "color": "#dc2626",
      "name": "大本营"
    }
  },
  "empty": {
    "1": {
      "cost": 0,
      "hp": 0,
      "warriorRate": 0,
      "attackBonus": 0,
      "defense": 0,
      "color": "#374151",
      "name": "空地"
    }
  }
};
