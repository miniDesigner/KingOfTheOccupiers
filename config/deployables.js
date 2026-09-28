/**
 * Auto-generated from deployables.json
 * Do not edit. Regenerate via: npm run build:config
 *
 * 微信小游戏专用: require('../../config/deployables.js') 即可加载
 */
module.exports = {
  "_doc": "上阵系统配置 - 40兵种卡/4羁绊卡/3建筑强化，玩家在局外收集升级，战斗前上阵安排",
  "units": {
    "swordsman": {
      "name": "剑士",
      "quality": 1,
      "icon": "⚔",
      "combatStyles": [
        "melee"
      ],
      "baseStats": {
        "attackCoeff": 1,
        "hpCoeff": 1,
        "speedCoeff": 1
      },
      "special": null,
      "unlockCost": {
        "starDust": 0,
        "gold": 0
      },
      "upgradeCost": {
        "starDust": 80,
        "gold": 300
      },
      "statsPerLevel": {
        "attackCoeff": 0.08,
        "hpCoeff": 0.08
      },
      "_doc": "基础近战兵种，属性均衡，开局免费解锁",
      "productionSpeed": 0.84,
      "attackRange": 1,
      "recruitRequired": 3
    },
    "archer": {
      "name": "弓箭手",
      "quality": 1,
      "icon": "🏹",
      "combatStyles": [
        "ranged"
      ],
      "baseStats": {
        "attackCoeff": 0.9,
        "hpCoeff": 0.7,
        "speedCoeff": 1.2
      },
      "special": null,
      "unlockCost": {
        "starDust": 0,
        "gold": 0
      },
      "upgradeCost": {
        "starDust": 80,
        "gold": 300
      },
      "statsPerLevel": {
        "attackCoeff": 0.08,
        "hpCoeff": 0.06
      },
      "_doc": "基础远程兵种，速度快，开局免费解锁",
      "productionSpeed": 0.92,
      "attackRange": 2,
      "recruitRequired": 3
    },
    "spearman": {
      "name": "枪兵",
      "quality": 1,
      "icon": "🔫",
      "combatStyles": [
        "melee"
      ],
      "baseStats": {
        "attackCoeff": 0.9,
        "hpCoeff": 1.1,
        "speedCoeff": 1
      },
      "special": null,
      "unlockCost": {
        "starDust": 50,
        "gold": 150
      },
      "upgradeCost": {
        "starDust": 60,
        "gold": 200
      },
      "statsPerLevel": {
        "attackCoeff": 0.07,
        "hpCoeff": 0.07
      },
      "_doc": "基础近战，略偏防御，造价低廉",
      "productionSpeed": 0.84,
      "attackRange": 1,
      "recruitRequired": 3
    },
    "scout": {
      "name": "斥候",
      "quality": 1,
      "icon": "🏃",
      "combatStyles": [
        "ranged"
      ],
      "baseStats": {
        "attackCoeff": 0.7,
        "hpCoeff": 0.6,
        "speedCoeff": 1.4
      },
      "special": null,
      "unlockCost": {
        "starDust": 50,
        "gold": 150
      },
      "upgradeCost": {
        "starDust": 60,
        "gold": 200
      },
      "statsPerLevel": {
        "attackCoeff": 0.06,
        "hpCoeff": 0.05
      },
      "_doc": "极速远程侦察兵，低攻低血但速度极快",
      "productionSpeed": 0.92,
      "attackRange": 2,
      "recruitRequired": 3
    },
    "militia": {
      "name": "民兵",
      "quality": 1,
      "icon": "🪖",
      "combatStyles": [
        "melee"
      ],
      "baseStats": {
        "attackCoeff": 0.8,
        "hpCoeff": 1.2,
        "speedCoeff": 0.9
      },
      "special": null,
      "unlockCost": {
        "starDust": 40,
        "gold": 120
      },
      "upgradeCost": {
        "starDust": 55,
        "gold": 180
      },
      "statsPerLevel": {
        "attackCoeff": 0.06,
        "hpCoeff": 0.08
      },
      "_doc": "廉价炮灰近战，高血量低攻击",
      "productionSpeed": 0.84,
      "attackRange": 1,
      "recruitRequired": 3
    },
    "slinger": {
      "name": "投石兵",
      "quality": 1,
      "icon": "🪨",
      "combatStyles": [
        "ranged"
      ],
      "baseStats": {
        "attackCoeff": 0.8,
        "hpCoeff": 0.7,
        "speedCoeff": 1.1
      },
      "special": {
        "type": "splash",
        "value": 0.1,
        "desc": "溅射伤害10%"
      },
      "unlockCost": {
        "starDust": 60,
        "gold": 200
      },
      "upgradeCost": {
        "starDust": 65,
        "gold": 220
      },
      "statsPerLevel": {
        "attackCoeff": 0.07,
        "hpCoeff": 0.05
      },
      "_doc": "基础远程带溅射，克制密集阵型",
      "productionSpeed": 0.92,
      "attackRange": 2,
      "recruitRequired": 3
    },
    "apprentice": {
      "name": "学徒",
      "quality": 1,
      "icon": "📖",
      "combatStyles": [
        "magic"
      ],
      "baseStats": {
        "attackCoeff": 0.8,
        "hpCoeff": 0.6,
        "speedCoeff": 1.1
      },
      "special": null,
      "unlockCost": {
        "starDust": 80,
        "gold": 250
      },
      "upgradeCost": {
        "starDust": 70,
        "gold": 250
      },
      "statsPerLevel": {
        "attackCoeff": 0.08,
        "hpCoeff": 0.04
      },
      "_doc": "基础法术兵种，低属性但提供魔法风格",
      "productionSpeed": 0.84,
      "attackRange": 2,
      "recruitRequired": 3
    },
    "shieldbearer": {
      "name": "盾兵",
      "quality": 1,
      "icon": "🛡",
      "combatStyles": [
        "melee",
        "defense"
      ],
      "baseStats": {
        "attackCoeff": 0.6,
        "hpCoeff": 1.5,
        "speedCoeff": 0.7
      },
      "special": {
        "type": "damage_reduction",
        "value": 0.05,
        "desc": "减伤5%"
      },
      "unlockCost": {
        "starDust": 80,
        "gold": 250
      },
      "upgradeCost": {
        "starDust": 70,
        "gold": 250
      },
      "statsPerLevel": {
        "attackCoeff": 0.04,
        "hpCoeff": 0.12
      },
      "_doc": "低级防御坦克，极慢但血厚带减伤",
      "productionSpeed": 0.71,
      "attackRange": 1,
      "recruitRequired": 3
    },
    "knight": {
      "name": "骑士",
      "quality": 2,
      "icon": "🐎",
      "combatStyles": [
        "melee",
        "defense"
      ],
      "baseStats": {
        "attackCoeff": 0.9,
        "hpCoeff": 1.4,
        "speedCoeff": 0.9
      },
      "special": {
        "type": "damage_reduction",
        "value": 0.1,
        "desc": "减伤10%"
      },
      "unlockCost": {
        "starDust": 150,
        "gold": 500
      },
      "upgradeCost": {
        "starDust": 100,
        "gold": 400
      },
      "statsPerLevel": {
        "attackCoeff": 0.06,
        "hpCoeff": 0.1
      },
      "_doc": "坦克型近战，高血量带减伤",
      "productionSpeed": 0.6,
      "attackRange": 1,
      "recruitRequired": 5
    },
    "berserker": {
      "name": "狂战士",
      "quality": 2,
      "icon": "🪓",
      "combatStyles": [
        "melee"
      ],
      "baseStats": {
        "attackCoeff": 1.3,
        "hpCoeff": 0.8,
        "speedCoeff": 1.1
      },
      "special": {
        "type": "crit_damage_multiplier",
        "value": 2,
        "desc": "暴击伤害x2"
      },
      "unlockCost": {
        "starDust": 200,
        "gold": 600
      },
      "upgradeCost": {
        "starDust": 120,
        "gold": 450
      },
      "statsPerLevel": {
        "attackCoeff": 0.12,
        "hpCoeff": 0.05
      },
      "_doc": "高攻低血近战，暴击伤害翻倍",
      "productionSpeed": 0.7,
      "attackRange": 1,
      "recruitRequired": 5
    },
    "skeleton": {
      "name": "骷髅兵",
      "quality": 2,
      "icon": "💀",
      "combatStyles": [
        "melee"
      ],
      "baseStats": {
        "attackCoeff": 0.95,
        "hpCoeff": 0.85,
        "speedCoeff": 1.1
      },
      "special": {
        "type": "post_battle_heal",
        "value": 0.2,
        "desc": "战后回血20%"
      },
      "unlockCost": {
        "starDust": 120,
        "gold": 400
      },
      "upgradeCost": {
        "starDust": 70,
        "gold": 250
      },
      "statsPerLevel": {
        "attackCoeff": 0.06,
        "hpCoeff": 0.06
      },
      "_doc": "廉价炮灰兵种，战后回血弥补战损",
      "productionSpeed": 0.77,
      "attackRange": 1,
      "recruitRequired": 5
    },
    "warrior": {
      "name": "战士",
      "quality": 2,
      "icon": "💪",
      "combatStyles": [
        "melee"
      ],
      "baseStats": {
        "attackCoeff": 1.1,
        "hpCoeff": 1.1,
        "speedCoeff": 1
      },
      "special": null,
      "unlockCost": {
        "starDust": 100,
        "gold": 350
      },
      "upgradeCost": {
        "starDust": 80,
        "gold": 300
      },
      "statsPerLevel": {
        "attackCoeff": 0.09,
        "hpCoeff": 0.08
      },
      "_doc": "均衡近战，攻防一体无短板",
      "productionSpeed": 0.7,
      "attackRange": 1,
      "recruitRequired": 5
    },
    "hunter": {
      "name": "猎人",
      "quality": 2,
      "icon": "🦎",
      "combatStyles": [
        "ranged"
      ],
      "baseStats": {
        "attackCoeff": 1,
        "hpCoeff": 0.8,
        "speedCoeff": 1.2
      },
      "special": {
        "type": "execute_bonus",
        "value": 0.3,
        "threshold": 0.4,
        "desc": "残血(40%)时攻击+30%"
      },
      "unlockCost": {
        "starDust": 130,
        "gold": 400
      },
      "upgradeCost": {
        "starDust": 80,
        "gold": 300
      },
      "statsPerLevel": {
        "attackCoeff": 0.08,
        "hpCoeff": 0.06
      },
      "_doc": "远程猎手，残血目标增伤",
      "productionSpeed": 0.77,
      "attackRange": 2,
      "recruitRequired": 5
    },
    "priest": {
      "name": "牧师",
      "quality": 2,
      "icon": "🙏",
      "combatStyles": [
        "magic"
      ],
      "baseStats": {
        "attackCoeff": 0.7,
        "hpCoeff": 0.8,
        "speedCoeff": 1
      },
      "special": {
        "type": "post_battle_heal",
        "value": 0.25,
        "desc": "战后回血25%"
      },
      "unlockCost": {
        "starDust": 140,
        "gold": 450
      },
      "upgradeCost": {
        "starDust": 90,
        "gold": 350
      },
      "statsPerLevel": {
        "attackCoeff": 0.05,
        "hpCoeff": 0.08
      },
      "_doc": "辅助法术兵种，低攻但战后回复力强",
      "productionSpeed": 0.7,
      "attackRange": 2,
      "recruitRequired": 5
    },
    "guardsman": {
      "name": "卫兵",
      "quality": 2,
      "icon": "💂",
      "combatStyles": [
        "melee",
        "defense"
      ],
      "baseStats": {
        "attackCoeff": 0.8,
        "hpCoeff": 1.5,
        "speedCoeff": 0.8
      },
      "special": {
        "type": "damage_reduction",
        "value": 0.08,
        "desc": "减伤8%"
      },
      "unlockCost": {
        "starDust": 150,
        "gold": 450
      },
      "upgradeCost": {
        "starDust": 90,
        "gold": 350
      },
      "statsPerLevel": {
        "attackCoeff": 0.05,
        "hpCoeff": 0.12
      },
      "_doc": "重甲防御兵种，高血量带减伤",
      "productionSpeed": 0.6,
      "attackRange": 1,
      "recruitRequired": 5
    },
    "pirate": {
      "name": "海盗",
      "quality": 2,
      "icon": "⚓",
      "combatStyles": [
        "melee"
      ],
      "baseStats": {
        "attackCoeff": 1.3,
        "hpCoeff": 0.9,
        "speedCoeff": 1.1
      },
      "special": {
        "type": "lifesteal",
        "value": 0.1,
        "desc": "吸血10%"
      },
      "unlockCost": {
        "starDust": 160,
        "gold": 500
      },
      "upgradeCost": {
        "starDust": 90,
        "gold": 350
      },
      "statsPerLevel": {
        "attackCoeff": 0.1,
        "hpCoeff": 0.06
      },
      "_doc": "凶猛近战，高攻带吸血续航",
      "productionSpeed": 0.7,
      "attackRange": 1,
      "recruitRequired": 5
    },
    "crossbowman": {
      "name": "弩手",
      "quality": 3,
      "icon": "🎯",
      "combatStyles": [
        "ranged"
      ],
      "baseStats": {
        "attackCoeff": 1.1,
        "hpCoeff": 0.8,
        "speedCoeff": 1
      },
      "special": {
        "type": "armor_pierce",
        "value": 0.3,
        "desc": "穿透30%防御"
      },
      "unlockCost": {
        "starDust": 180,
        "gold": 550
      },
      "upgradeCost": {
        "starDust": 100,
        "gold": 400
      },
      "statsPerLevel": {
        "attackCoeff": 0.1,
        "hpCoeff": 0.06
      },
      "_doc": "穿甲远程，克制高防建筑",
      "productionSpeed": 0.69,
      "attackRange": 2,
      "recruitRequired": 8
    },
    "ranger": {
      "name": "游侠",
      "quality": 3,
      "icon": "🏹",
      "combatStyles": [
        "ranged"
      ],
      "baseStats": {
        "attackCoeff": 1,
        "hpCoeff": 0.8,
        "speedCoeff": 1.3
      },
      "special": {
        "type": "execute_bonus",
        "value": 0.5,
        "threshold": 0.3,
        "desc": "残血(30%)时攻击+50%"
      },
      "unlockCost": {
        "starDust": 220,
        "gold": 650
      },
      "upgradeCost": {
        "starDust": 110,
        "gold": 420
      },
      "statsPerLevel": {
        "attackCoeff": 0.09,
        "hpCoeff": 0.06
      },
      "_doc": "高速远程，残血反杀型",
      "productionSpeed": 0.69,
      "attackRange": 2,
      "recruitRequired": 8
    },
    "pikeman": {
      "name": "长枪兵",
      "quality": 3,
      "icon": "🔱",
      "combatStyles": [
        "melee",
        "defense"
      ],
      "baseStats": {
        "attackCoeff": 1,
        "hpCoeff": 1.3,
        "speedCoeff": 0.9
      },
      "special": {
        "type": "damage_reduction",
        "value": 0.08,
        "desc": "减伤8%"
      },
      "unlockCost": {
        "starDust": 180,
        "gold": 550
      },
      "upgradeCost": {
        "starDust": 100,
        "gold": 400
      },
      "statsPerLevel": {
        "attackCoeff": 0.07,
        "hpCoeff": 0.1
      },
      "_doc": "攻守兼备的长柄兵种，减伤+高血量",
      "productionSpeed": 0.54,
      "attackRange": 1,
      "recruitRequired": 8
    },
    "marksman": {
      "name": "神射手",
      "quality": 3,
      "icon": "💥",
      "combatStyles": [
        "ranged"
      ],
      "baseStats": {
        "attackCoeff": 1.2,
        "hpCoeff": 0.7,
        "speedCoeff": 1.1
      },
      "special": {
        "type": "crit_bonus",
        "value": 0.1,
        "desc": "暴击率+10%"
      },
      "unlockCost": {
        "starDust": 200,
        "gold": 600
      },
      "upgradeCost": {
        "starDust": 110,
        "gold": 420
      },
      "statsPerLevel": {
        "attackCoeff": 0.1,
        "hpCoeff": 0.05
      },
      "_doc": "精准远程射手，高攻高暴击",
      "productionSpeed": 0.69,
      "attackRange": 2,
      "recruitRequired": 8
    },
    "ice_mage": {
      "name": "冰法师",
      "quality": 3,
      "icon": "❄",
      "combatStyles": [
        "magic"
      ],
      "baseStats": {
        "attackCoeff": 1,
        "hpCoeff": 0.7,
        "speedCoeff": 1
      },
      "special": {
        "type": "armor_pierce",
        "value": 0.2,
        "desc": "穿透20%防御"
      },
      "unlockCost": {
        "starDust": 200,
        "gold": 600
      },
      "upgradeCost": {
        "starDust": 110,
        "gold": 420
      },
      "statsPerLevel": {
        "attackCoeff": 0.09,
        "hpCoeff": 0.05
      },
      "_doc": "冰系法术兵种，穿甲+法术输出",
      "productionSpeed": 0.63,
      "attackRange": 2,
      "recruitRequired": 8
    },
    "templar": {
      "name": "圣堂武士",
      "quality": 3,
      "icon": "🕌",
      "combatStyles": [
        "melee",
        "defense"
      ],
      "baseStats": {
        "attackCoeff": 1,
        "hpCoeff": 1.3,
        "speedCoeff": 0.9
      },
      "special": {
        "type": "post_battle_heal",
        "value": 0.1,
        "desc": "战后回血10%"
      },
      "unlockCost": {
        "starDust": 220,
        "gold": 650
      },
      "upgradeCost": {
        "starDust": 110,
        "gold": 420
      },
      "statsPerLevel": {
        "attackCoeff": 0.07,
        "hpCoeff": 0.1
      },
      "_doc": "攻守双风格，战后回复兵力",
      "productionSpeed": 0.54,
      "attackRange": 1,
      "recruitRequired": 8
    },
    "chariot": {
      "name": "战车",
      "quality": 3,
      "icon": "🛞",
      "combatStyles": [
        "melee",
        "defense"
      ],
      "baseStats": {
        "attackCoeff": 1,
        "hpCoeff": 1.5,
        "speedCoeff": 1.2
      },
      "special": {
        "type": "damage_reduction",
        "value": 0.1,
        "desc": "减伤10%"
      },
      "unlockCost": {
        "starDust": 230,
        "gold": 700
      },
      "upgradeCost": {
        "starDust": 120,
        "gold": 450
      },
      "statsPerLevel": {
        "attackCoeff": 0.06,
        "hpCoeff": 0.12
      },
      "_doc": "高速重甲战车，攻防一体高机动",
      "productionSpeed": 0.54,
      "attackRange": 1,
      "recruitRequired": 8
    },
    "beast_tamer": {
      "name": "驯兽师",
      "quality": 3,
      "icon": "🐾",
      "combatStyles": [
        "ranged",
        "melee"
      ],
      "baseStats": {
        "attackCoeff": 1.1,
        "hpCoeff": 1,
        "speedCoeff": 1.1
      },
      "special": {
        "type": "crit_bonus",
        "value": 0.08,
        "desc": "暴击率+8%"
      },
      "unlockCost": {
        "starDust": 210,
        "gold": 620
      },
      "upgradeCost": {
        "starDust": 110,
        "gold": 420
      },
      "statsPerLevel": {
        "attackCoeff": 0.09,
        "hpCoeff": 0.07
      },
      "_doc": "双风格全能兵种，近战远程皆可",
      "productionSpeed": 0.63,
      "attackRange": 2,
      "recruitRequired": 8
    },
    "mage": {
      "name": "法师",
      "quality": 4,
      "icon": "🔮",
      "combatStyles": [
        "magic"
      ],
      "baseStats": {
        "attackCoeff": 1.2,
        "hpCoeff": 0.6,
        "speedCoeff": 1
      },
      "special": {
        "type": "crit_bonus",
        "value": 0.15,
        "desc": "暴击率+15%"
      },
      "unlockCost": {
        "starDust": 250,
        "gold": 700
      },
      "upgradeCost": {
        "starDust": 140,
        "gold": 500
      },
      "statsPerLevel": {
        "attackCoeff": 0.1,
        "hpCoeff": 0.05
      },
      "_doc": "法术兵种，高攻高暴击但脆弱",
      "productionSpeed": 0.56,
      "attackRange": 2,
      "recruitRequired": 12
    },
    "paladin": {
      "name": "圣骑士",
      "quality": 4,
      "icon": "✨",
      "combatStyles": [
        "melee",
        "defense"
      ],
      "baseStats": {
        "attackCoeff": 1.1,
        "hpCoeff": 1.2,
        "speedCoeff": 0.9
      },
      "special": {
        "type": "post_battle_heal",
        "value": 0.15,
        "desc": "战后回血15%"
      },
      "unlockCost": {
        "starDust": 300,
        "gold": 800
      },
      "upgradeCost": {
        "starDust": 150,
        "gold": 550
      },
      "statsPerLevel": {
        "attackCoeff": 0.08,
        "hpCoeff": 0.1
      },
      "_doc": "攻守兼备，战后回复兵力",
      "productionSpeed": 0.48,
      "attackRange": 1,
      "recruitRequired": 12
    },
    "executioner": {
      "name": "刽子手",
      "quality": 4,
      "icon": "🔪",
      "combatStyles": [
        "melee"
      ],
      "baseStats": {
        "attackCoeff": 1.3,
        "hpCoeff": 0.9,
        "speedCoeff": 1
      },
      "special": {
        "type": "execute_bonus",
        "value": 0.6,
        "threshold": 0.35,
        "desc": "残血(35%)时攻击+60%"
      },
      "unlockCost": {
        "starDust": 280,
        "gold": 800
      },
      "upgradeCost": {
        "starDust": 140,
        "gold": 500
      },
      "statsPerLevel": {
        "attackCoeff": 0.11,
        "hpCoeff": 0.06
      },
      "_doc": "处刑专家，残血目标伤害爆发",
      "productionSpeed": 0.56,
      "attackRange": 1,
      "recruitRequired": 12
    },
    "battle_mage": {
      "name": "战斗法师",
      "quality": 4,
      "icon": "⚡",
      "combatStyles": [
        "melee",
        "magic"
      ],
      "baseStats": {
        "attackCoeff": 1.2,
        "hpCoeff": 1,
        "speedCoeff": 1
      },
      "special": {
        "type": "crit_bonus",
        "value": 0.12,
        "desc": "暴击率+12%"
      },
      "unlockCost": {
        "starDust": 290,
        "gold": 820
      },
      "upgradeCost": {
        "starDust": 140,
        "gold": 520
      },
      "statsPerLevel": {
        "attackCoeff": 0.1,
        "hpCoeff": 0.07
      },
      "_doc": "近战法术双修，全能战士",
      "productionSpeed": 0.56,
      "attackRange": 2,
      "recruitRequired": 12
    },
    "archmage": {
      "name": "大法师",
      "quality": 4,
      "icon": "🌟",
      "combatStyles": [
        "magic"
      ],
      "baseStats": {
        "attackCoeff": 1.3,
        "hpCoeff": 0.6,
        "speedCoeff": 1
      },
      "special": {
        "type": "splash",
        "value": 0.15,
        "desc": "溅射伤害15%"
      },
      "unlockCost": {
        "starDust": 300,
        "gold": 850
      },
      "upgradeCost": {
        "starDust": 150,
        "gold": 550
      },
      "statsPerLevel": {
        "attackCoeff": 0.11,
        "hpCoeff": 0.04
      },
      "_doc": "顶级法术输出，高攻溅射",
      "productionSpeed": 0.56,
      "attackRange": 2,
      "recruitRequired": 12
    },
    "crusader": {
      "name": "十字军",
      "quality": 4,
      "icon": "✝",
      "combatStyles": [
        "melee",
        "defense"
      ],
      "baseStats": {
        "attackCoeff": 1.1,
        "hpCoeff": 1.4,
        "speedCoeff": 0.8
      },
      "special": {
        "type": "damage_reduction",
        "value": 0.12,
        "desc": "减伤12%"
      },
      "unlockCost": {
        "starDust": 310,
        "gold": 880
      },
      "upgradeCost": {
        "starDust": 150,
        "gold": 550
      },
      "statsPerLevel": {
        "attackCoeff": 0.07,
        "hpCoeff": 0.11
      },
      "_doc": "圣战骑士，高血量减伤坦克",
      "productionSpeed": 0.48,
      "attackRange": 1,
      "recruitRequired": 12
    },
    "necromancer": {
      "name": "死灵法师",
      "quality": 4,
      "icon": "☠",
      "combatStyles": [
        "magic"
      ],
      "baseStats": {
        "attackCoeff": 1.1,
        "hpCoeff": 0.8,
        "speedCoeff": 1
      },
      "special": {
        "type": "lifesteal",
        "value": 0.15,
        "desc": "吸血15%"
      },
      "unlockCost": {
        "starDust": 320,
        "gold": 900
      },
      "upgradeCost": {
        "starDust": 160,
        "gold": 580
      },
      "statsPerLevel": {
        "attackCoeff": 0.1,
        "hpCoeff": 0.06
      },
      "_doc": "亡灵法术兵种，吸血续航",
      "productionSpeed": 0.56,
      "attackRange": 2,
      "recruitRequired": 12
    },
    "vampire": {
      "name": "吸血鬼",
      "quality": 5,
      "icon": "🦇",
      "combatStyles": [
        "melee"
      ],
      "baseStats": {
        "attackCoeff": 1,
        "hpCoeff": 1,
        "speedCoeff": 1
      },
      "special": {
        "type": "lifesteal",
        "value": 0.2,
        "desc": "吸血20%"
      },
      "unlockCost": {
        "starDust": 280,
        "gold": 750
      },
      "upgradeCost": {
        "starDust": 140,
        "gold": 500
      },
      "statsPerLevel": {
        "attackCoeff": 0.08,
        "hpCoeff": 0.08
      },
      "_doc": "近战吸血，续航能力强",
      "productionSpeed": 0.42,
      "attackRange": 1,
      "recruitRequired": 18
    },
    "steam_tank": {
      "name": "蒸汽坦克",
      "quality": 5,
      "icon": "🏗",
      "combatStyles": [
        "melee",
        "defense"
      ],
      "baseStats": {
        "attackCoeff": 0.8,
        "hpCoeff": 2,
        "speedCoeff": 0.6
      },
      "special": {
        "type": "damage_reduction",
        "value": 0.15,
        "desc": "减伤15%"
      },
      "unlockCost": {
        "starDust": 400,
        "gold": 1000
      },
      "upgradeCost": {
        "starDust": 180,
        "gold": 700
      },
      "statsPerLevel": {
        "attackCoeff": 0.05,
        "hpCoeff": 0.15
      },
      "_doc": "重甲单位，极慢但几乎不可摧毁",
      "productionSpeed": 0.36,
      "attackRange": 1,
      "recruitRequired": 18
    },
    "death_knight": {
      "name": "死亡骑士",
      "quality": 5,
      "icon": "🗡",
      "combatStyles": [
        "melee",
        "defense"
      ],
      "baseStats": {
        "attackCoeff": 1,
        "hpCoeff": 1.8,
        "speedCoeff": 0.8
      },
      "special": {
        "type": "lifesteal",
        "value": 0.18,
        "desc": "吸血18%"
      },
      "unlockCost": {
        "starDust": 380,
        "gold": 950
      },
      "upgradeCost": {
        "starDust": 170,
        "gold": 650
      },
      "statsPerLevel": {
        "attackCoeff": 0.07,
        "hpCoeff": 0.14
      },
      "_doc": "亡灵重甲骑兵，高血量吸血坦克",
      "productionSpeed": 0.36,
      "attackRange": 1,
      "recruitRequired": 18
    },
    "storm_mage": {
      "name": "风暴法师",
      "quality": 5,
      "icon": "⛈",
      "combatStyles": [
        "magic"
      ],
      "baseStats": {
        "attackCoeff": 1.2,
        "hpCoeff": 0.7,
        "speedCoeff": 1
      },
      "special": {
        "type": "splash",
        "value": 0.25,
        "desc": "溅射伤害25%"
      },
      "unlockCost": {
        "starDust": 400,
        "gold": 1000
      },
      "upgradeCost": {
        "starDust": 180,
        "gold": 700
      },
      "statsPerLevel": {
        "attackCoeff": 0.11,
        "hpCoeff": 0.05
      },
      "_doc": "风暴法术大师，大范围溅射",
      "productionSpeed": 0.42,
      "attackRange": 2,
      "recruitRequired": 18
    },
    "war_elephant": {
      "name": "战象",
      "quality": 5,
      "icon": "🐘",
      "combatStyles": [
        "melee",
        "defense"
      ],
      "baseStats": {
        "attackCoeff": 1,
        "hpCoeff": 2.2,
        "speedCoeff": 0.6
      },
      "special": {
        "type": "damage_reduction",
        "value": 0.18,
        "desc": "减伤18%"
      },
      "unlockCost": {
        "starDust": 420,
        "gold": 1050
      },
      "upgradeCost": {
        "starDust": 190,
        "gold": 750
      },
      "statsPerLevel": {
        "attackCoeff": 0.05,
        "hpCoeff": 0.18
      },
      "_doc": "巨型战争巨兽，极慢极肉极减伤",
      "productionSpeed": 0.36,
      "attackRange": 1,
      "recruitRequired": 18
    },
    "phoenix": {
      "name": "凤凰",
      "quality": 5,
      "icon": "🔥",
      "combatStyles": [
        "magic",
        "ranged"
      ],
      "baseStats": {
        "attackCoeff": 1.2,
        "hpCoeff": 0.8,
        "speedCoeff": 1.2
      },
      "special": {
        "type": "post_battle_heal",
        "value": 0.3,
        "desc": "战后回血30%"
      },
      "unlockCost": {
        "starDust": 450,
        "gold": 1100
      },
      "upgradeCost": {
        "starDust": 200,
        "gold": 780
      },
      "statsPerLevel": {
        "attackCoeff": 0.1,
        "hpCoeff": 0.07
      },
      "_doc": "不死神鸟，高速飞行+战后满血恢复",
      "productionSpeed": 0.46,
      "attackRange": 3,
      "recruitRequired": 18
    },
    "dragonling": {
      "name": "幼龙",
      "quality": 6,
      "icon": "🐲",
      "combatStyles": [
        "melee",
        "magic"
      ],
      "baseStats": {
        "attackCoeff": 1.4,
        "hpCoeff": 1.1,
        "speedCoeff": 1
      },
      "special": {
        "type": "splash",
        "value": 0.2,
        "desc": "溅射伤害20%"
      },
      "unlockCost": {
        "starDust": 500,
        "gold": 1200
      },
      "upgradeCost": {
        "starDust": 200,
        "gold": 800
      },
      "statsPerLevel": {
        "attackCoeff": 0.1,
        "hpCoeff": 0.08
      },
      "_doc": "终极兵种，双风格高属性溅射",
      "productionSpeed": 0.35,
      "attackRange": 2,
      "recruitRequired": 25
    },
    "war_titan": {
      "name": "战争泰坦",
      "quality": 6,
      "icon": "🗿",
      "combatStyles": [
        "melee",
        "defense"
      ],
      "baseStats": {
        "attackCoeff": 1.5,
        "hpCoeff": 2,
        "speedCoeff": 0.7
      },
      "special": {
        "type": "damage_reduction",
        "value": 0.2,
        "desc": "减伤20%"
      },
      "unlockCost": {
        "starDust": 550,
        "gold": 1300
      },
      "upgradeCost": {
        "starDust": 220,
        "gold": 900
      },
      "statsPerLevel": {
        "attackCoeff": 0.08,
        "hpCoeff": 0.15
      },
      "_doc": "远古战争巨像，攻防双全的终极坦克",
      "productionSpeed": 0.3,
      "attackRange": 1,
      "recruitRequired": 25
    },
    "archdragon": {
      "name": "古龙",
      "quality": 6,
      "icon": "🐉",
      "combatStyles": [
        "melee",
        "magic"
      ],
      "baseStats": {
        "attackCoeff": 1.6,
        "hpCoeff": 1.3,
        "speedCoeff": 1.1
      },
      "special": {
        "type": "splash",
        "value": 0.3,
        "desc": "溅射伤害30%"
      },
      "unlockCost": {
        "starDust": 600,
        "gold": 1500
      },
      "upgradeCost": {
        "starDust": 250,
        "gold": 1000
      },
      "statsPerLevel": {
        "attackCoeff": 0.12,
        "hpCoeff": 0.1
      },
      "_doc": "传说古龙，全属性顶尖+大范围溅射",
      "productionSpeed": 0.35,
      "attackRange": 2,
      "recruitRequired": 25
    }
  },
  "synergies": {
    "warriors_will": {
      "name": "勇士意志",
      "icon": "⚔",
      "style": "melee",
      "levels": {
        "1": {
          "attackBonus": 0.05
        },
        "2": {
          "attackBonus": 0.1
        },
        "3": {
          "attackBonus": 0.15
        },
        "4": {
          "attackBonus": 0.2
        },
        "5": {
          "attackBonus": 0.25
        },
        "6": {
          "attackBonus": 0.3
        }
      },
      "_doc": "近战风格羁绊：上阵1-6个melee兵种 → Lv.1-6 攻击力+5%~30%（线性 = 该风格上阵数）"
    },
    "ranged_volley": {
      "name": "远程齐射",
      "icon": "🏹",
      "style": "ranged",
      "levels": {
        "1": {
          "speedBonus": 0.05
        },
        "2": {
          "speedBonus": 0.1
        },
        "3": {
          "speedBonus": 0.15,
          "firstStrike": true
        },
        "4": {
          "speedBonus": 0.2,
          "firstStrike": true
        },
        "5": {
          "speedBonus": 0.25,
          "firstStrike": true
        },
        "6": {
          "speedBonus": 0.3,
          "firstStrike": true
        }
      },
      "_doc": "远程风格羁绊：上阵1-6个ranged兵种 → Lv.1-2 速度+5%~10%；Lv.3-6 速度+15%~30% + 遭遇战先手"
    },
    "fortress": {
      "name": "堡垒之盾",
      "icon": "🛡",
      "style": "defense",
      "levels": {
        "1": {
          "buildingHpBonus": 0.05,
          "damageReduction": 0.03
        },
        "2": {
          "buildingHpBonus": 0.1,
          "damageReduction": 0.06
        },
        "3": {
          "buildingHpBonus": 0.15,
          "damageReduction": 0.09
        },
        "4": {
          "buildingHpBonus": 0.2,
          "damageReduction": 0.12
        },
        "5": {
          "buildingHpBonus": 0.25,
          "damageReduction": 0.15
        },
        "6": {
          "buildingHpBonus": 0.3,
          "damageReduction": 0.18
        }
      },
      "_doc": "防御风格羁绊：上阵1-6个defense兵种 → Lv.1-6 建筑血量+5%~30% + 减伤+3%~18%（建筑只接收这两类加成）"
    },
    "arcane_surge": {
      "name": "奥术涌动",
      "icon": "🔮",
      "style": "magic",
      "levels": {
        "1": {
          "critBonus": 0.04,
          "damageBonus": 0.02
        },
        "2": {
          "critBonus": 0.08,
          "damageBonus": 0.04
        },
        "3": {
          "critBonus": 0.12,
          "damageBonus": 0.06
        },
        "4": {
          "critBonus": 0.16,
          "damageBonus": 0.08
        },
        "5": {
          "critBonus": 0.2,
          "damageBonus": 0.1
        },
        "6": {
          "critBonus": 0.24,
          "damageBonus": 0.12
        }
      },
      "_doc": "法术风格羁绊：上阵1-6个magic兵种 → Lv.1-6 暴击率+4%~24% + 遭遇战伤害+2%~12%"
    }
  },
  "buildingUpgrades": {
    "barracks": {
      "name": "兵营",
      "icon": "🏰",
      "levels": {
        "1": {
          "hp": 20,
          "warriorRate": 1,
          "cost": 30,
          "defense": 0
        },
        "2": {
          "hp": 35,
          "warriorRate": 2,
          "cost": 50,
          "defense": 2
        },
        "3": {
          "hp": 55,
          "warriorRate": 4,
          "cost": 80,
          "defense": 5
        },
        "4": {
          "hp": 80,
          "warriorRate": 6,
          "cost": 120,
          "defense": 8
        }
      },
      "defaultLevel": 1,
      "maxLevel": 4,
      "upgradeCost": {
        "starDust": 100,
        "gold": 400
      },
      "_doc": "兵营强化，提升HP/出兵率/防御"
    },
    "arrow_tower": {
      "name": "箭塔",
      "icon": "🏹",
      "levels": {
        "1": {
          "hp": 30,
          "defense": 5,
          "range": 2,
          "attackDamage": 4,
          "attackCooldown": 1.5,
          "cost": 25
        },
        "2": {
          "hp": 45,
          "defense": 8,
          "range": 2,
          "attackDamage": 7,
          "attackCooldown": 1.2,
          "cost": 40
        },
        "3": {
          "hp": 65,
          "defense": 12,
          "range": 3,
          "attackDamage": 10,
          "attackCooldown": 1,
          "cost": 60
        }
      },
      "defaultLevel": 1,
      "maxLevel": 3,
      "upgradeCost": {
        "starDust": 120,
        "gold": 450
      },
      "_doc": "箭塔强化，提升HP/防御/射程/伤害"
    },
    "gold_mine": {
      "name": "金矿",
      "icon": "💰",
      "levels": {
        "1": {
          "hp": 15,
          "goldRate": 1,
          "cost": 15
        },
        "2": {
          "hp": 20,
          "goldRate": 2,
          "cost": 20
        },
        "3": {
          "hp": 30,
          "goldRate": 3,
          "cost": 30
        }
      },
      "defaultLevel": 1,
      "maxLevel": 3,
      "upgradeCost": {
        "starDust": 80,
        "gold": 300
      },
      "_doc": "金矿强化，提升HP/金币产出率"
    }
  },
  "deploymentSlots": {
    "unitSlots": 6,
    "buildingUpgradeSlots": 3,
    "_doc": "上阵槽位：6兵种(槽位1-6，兵营从中随机抽兵) + 3建筑强化(兵营/箭塔/金矿各1)；羁绊不再手选，按上阵兵种风格自动派生"
  },
  "defaultDeployment": {
    "units": [
      "swordsman",
      "knight",
      "berserker",
      "archer",
      "crossbowman",
      "paladin"
    ],
    "synergies": [],
    "buildingUpgrades": {
      "barracks": 1,
      "arrow_tower": 1,
      "gold_mine": 1
    },
    "_doc": "默认上阵配置(新玩家)：剑士(白)+骑士(绿)+狂战士(绿)+弓箭手(白)+弩手(蓝)+圣骑士(紫) + 羁绊自动派生(初始4种都为Lv.1) + 所有建筑Lv1"
  }
};
