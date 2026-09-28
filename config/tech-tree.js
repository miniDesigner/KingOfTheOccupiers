/**
 * Auto-generated from tech-tree.json
 * Do not edit. Regenerate via: npm run build:config
 *
 * 微信小游戏专用: require('../../config/tech-tree.js') 即可加载
 */
module.exports = {
  "_doc": "科技树配置表 — 4条分支26个节点，消耗星尘升级，提供永久加成",
  "_doc_branches": "military=军事 / economy=经济 / defense=防御 / command=统帅",
  "_doc_prerequisite": "前置节点ID，必须达到指定等级才能解锁后续",
  "upgradeCostBase": 50,
  "upgradeCostMultiplier": 1.5,
  "_doc_upgradeCost": "基础50星尘，每级×1.5",
  "branches": {
    "military": {
      "name": "军事科技",
      "color": "#ef4444",
      "icon": "⚔",
      "nodes": [
        {
          "id": "mil_atk_1",
          "name": "攻击强化 I",
          "description": "所有单位攻击力+5%",
          "maxLevel": 5,
          "costPerLevel": [
            50,
            75,
            113,
            169,
            253
          ],
          "bonus": {
            "type": "attack_percent",
            "valuePerLevel": 0.05
          },
          "prerequisite": null,
          "position": {
            "col": 0,
            "row": 0
          }
        },
        {
          "id": "mil_atk_2",
          "name": "攻击强化 II",
          "description": "所有单位攻击力+8%",
          "maxLevel": 5,
          "costPerLevel": [
            100,
            150,
            225,
            337,
            506
          ],
          "bonus": {
            "type": "attack_percent",
            "valuePerLevel": 0.08
          },
          "prerequisite": {
            "node": "mil_atk_1",
            "level": 3
          },
          "position": {
            "col": 0,
            "row": 1
          }
        },
        {
          "id": "mil_spd_1",
          "name": "急行军 I",
          "description": "行军速度+10%",
          "maxLevel": 5,
          "costPerLevel": [
            50,
            75,
            113,
            169,
            253
          ],
          "bonus": {
            "type": "march_speed_percent",
            "valuePerLevel": 0.1
          },
          "prerequisite": null,
          "position": {
            "col": 1,
            "row": 0
          }
        },
        {
          "id": "mil_spd_2",
          "name": "急行军 II",
          "description": "行军速度+15%",
          "maxLevel": 3,
          "costPerLevel": [
            120,
            180,
            270
          ],
          "bonus": {
            "type": "march_speed_percent",
            "valuePerLevel": 0.15
          },
          "prerequisite": {
            "node": "mil_spd_1",
            "level": 3
          },
          "position": {
            "col": 1,
            "row": 1
          }
        },
        {
          "id": "mil_group",
          "name": "编组扩展",
          "description": "编组阈值降低1",
          "maxLevel": 3,
          "costPerLevel": [
            80,
            120,
            180
          ],
          "bonus": {
            "type": "group_threshold_reduction",
            "valuePerLevel": 1
          },
          "prerequisite": {
            "node": "mil_spd_1",
            "level": 2
          },
          "position": {
            "col": 1,
            "row": 2
          }
        },
        {
          "id": "mil_synergy",
          "name": "羁绊精通",
          "description": "羁绊效果+10%",
          "maxLevel": 5,
          "costPerLevel": [
            100,
            150,
            225,
            337,
            506
          ],
          "bonus": {
            "type": "synergy_boost",
            "valuePerLevel": 0.1
          },
          "prerequisite": {
            "node": "mil_atk_1",
            "level": 2
          },
          "position": {
            "col": 1,
            "row": 3
          }
        },
        {
          "id": "mil_crit",
          "name": "暴击训练",
          "description": "暴击率+5%",
          "maxLevel": 5,
          "costPerLevel": [
            120,
            180,
            270,
            405,
            607
          ],
          "bonus": {
            "type": "crit_rate",
            "valuePerLevel": 0.05
          },
          "prerequisite": {
            "node": "mil_atk_2",
            "level": 2
          },
          "position": {
            "col": 0,
            "row": 2
          }
        },
        {
          "id": "mil_penetrate",
          "name": "穿透打击",
          "description": "无视防御+5%",
          "maxLevel": 3,
          "costPerLevel": [
            150,
            225,
            337
          ],
          "bonus": {
            "type": "penetrate",
            "valuePerLevel": 0.05
          },
          "prerequisite": {
            "node": "mil_crit",
            "level": 2
          },
          "position": {
            "col": 0,
            "row": 3
          }
        },
        {
          "id": "mil_berserk",
          "name": "狂战士",
          "description": "单位生命值低于50%时攻击力+20%",
          "maxLevel": 3,
          "costPerLevel": [
            200,
            300,
            450
          ],
          "bonus": {
            "type": "berserk",
            "valuePerLevel": 0.2
          },
          "prerequisite": {
            "node": "mil_penetrate",
            "level": 1
          },
          "position": {
            "col": 0,
            "row": 4
          }
        }
      ]
    },
    "economy": {
      "name": "经济科技",
      "color": "#f59e0b",
      "icon": "💰",
      "nodes": [
        {
          "id": "eco_gold_1",
          "name": "金币产出 I",
          "description": "金币产出+10%",
          "maxLevel": 5,
          "costPerLevel": [
            50,
            75,
            113,
            169,
            253
          ],
          "bonus": {
            "type": "gold_production",
            "valuePerLevel": 0.1
          },
          "prerequisite": null,
          "position": {
            "col": 0,
            "row": 0
          }
        },
        {
          "id": "eco_gold_2",
          "name": "金币产出 II",
          "description": "金币产出+15%",
          "maxLevel": 5,
          "costPerLevel": [
            100,
            150,
            225,
            337,
            506
          ],
          "bonus": {
            "type": "gold_production",
            "valuePerLevel": 0.15
          },
          "prerequisite": {
            "node": "eco_gold_1",
            "level": 3
          },
          "position": {
            "col": 0,
            "row": 1
          }
        },
        {
          "id": "eco_flip",
          "name": "高效翻转",
          "description": "翻转消耗-5%",
          "maxLevel": 5,
          "costPerLevel": [
            60,
            90,
            135,
            202,
            303
          ],
          "bonus": {
            "type": "flip_cost_reduction",
            "valuePerLevel": 0.05
          },
          "prerequisite": null,
          "position": {
            "col": 1,
            "row": 0
          }
        },
        {
          "id": "eco_random",
          "name": "幸运探索",
          "description": "随机格出好结果概率+5%",
          "maxLevel": 5,
          "costPerLevel": [
            70,
            105,
            157,
            236,
            354
          ],
          "bonus": {
            "type": "random_luck",
            "valuePerLevel": 0.05
          },
          "prerequisite": {
            "node": "eco_flip",
            "level": 2
          },
          "position": {
            "col": 1,
            "row": 1
          }
        },
        {
          "id": "eco_interest",
          "name": "利息系统",
          "description": "每10金币每秒额外产出0.1金币",
          "maxLevel": 3,
          "costPerLevel": [
            100,
            150,
            225
          ],
          "bonus": {
            "type": "gold_interest",
            "valuePerLevel": 0.01
          },
          "prerequisite": {
            "node": "eco_gold_1",
            "level": 2
          },
          "position": {
            "col": 0,
            "row": 2
          }
        },
        {
          "id": "eco_harvest",
          "name": "战争掠夺",
          "description": "摧毁敌方建筑额外获得20%金币",
          "maxLevel": 3,
          "costPerLevel": [
            120,
            180,
            270
          ],
          "bonus": {
            "type": "war_plunder",
            "valuePerLevel": 0.2
          },
          "prerequisite": {
            "node": "eco_gold_2",
            "level": 2
          },
          "position": {
            "col": 0,
            "row": 3
          }
        },
        {
          "id": "eco_trade",
          "name": "贸易路线",
          "description": "关卡结算金币奖励+25%",
          "maxLevel": 3,
          "costPerLevel": [
            80,
            120,
            180
          ],
          "bonus": {
            "type": "settlement_gold",
            "valuePerLevel": 0.25
          },
          "prerequisite": {
            "node": "eco_flip",
            "level": 1
          },
          "position": {
            "col": 1,
            "row": 2
          }
        }
      ]
    },
    "defense": {
      "name": "防御科技",
      "color": "#3b82f6",
      "icon": "🛡",
      "nodes": [
        {
          "id": "def_hp_1",
          "name": "建筑加固 I",
          "description": "建筑生命值+10%",
          "maxLevel": 5,
          "costPerLevel": [
            50,
            75,
            113,
            169,
            253
          ],
          "bonus": {
            "type": "building_hp_percent",
            "valuePerLevel": 0.1
          },
          "prerequisite": null,
          "position": {
            "col": 0,
            "row": 0
          }
        },
        {
          "id": "def_hp_2",
          "name": "建筑加固 II",
          "description": "建筑生命值+15%",
          "maxLevel": 5,
          "costPerLevel": [
            100,
            150,
            225,
            337,
            506
          ],
          "bonus": {
            "type": "building_hp_percent",
            "valuePerLevel": 0.15
          },
          "prerequisite": {
            "node": "def_hp_1",
            "level": 3
          },
          "position": {
            "col": 0,
            "row": 1
          }
        },
        {
          "id": "def_def_1",
          "name": "防御强化",
          "description": "建筑防御+10%",
          "maxLevel": 5,
          "costPerLevel": [
            60,
            90,
            135,
            202,
            303
          ],
          "bonus": {
            "type": "building_defense_percent",
            "valuePerLevel": 0.1
          },
          "prerequisite": null,
          "position": {
            "col": 1,
            "row": 0
          }
        },
        {
          "id": "def_tower",
          "name": "箭塔精通",
          "description": "箭塔攻击力+15%",
          "maxLevel": 5,
          "costPerLevel": [
            80,
            120,
            180,
            270,
            405
          ],
          "bonus": {
            "type": "tower_damage",
            "valuePerLevel": 0.15
          },
          "prerequisite": {
            "node": "def_def_1",
            "level": 2
          },
          "position": {
            "col": 1,
            "row": 1
          }
        },
        {
          "id": "def_reflect",
          "name": "反弹伤害",
          "description": "被攻击时反弹5%伤害",
          "maxLevel": 3,
          "costPerLevel": [
            120,
            180,
            270
          ],
          "bonus": {
            "type": "reflect_damage",
            "valuePerLevel": 0.05
          },
          "prerequisite": {
            "node": "def_hp_2",
            "level": 2
          },
          "position": {
            "col": 0,
            "row": 2
          }
        }
      ]
    },
    "command": {
      "name": "统帅科技",
      "color": "#a855f7",
      "icon": "👑",
      "nodes": [
        {
          "id": "cmd_exp",
          "name": "将领经验",
          "description": "将领经验获取+20%",
          "maxLevel": 5,
          "costPerLevel": [
            60,
            90,
            135,
            202,
            303
          ],
          "bonus": {
            "type": "hero_exp",
            "valuePerLevel": 0.2
          },
          "prerequisite": null,
          "position": {
            "col": 0,
            "row": 0
          }
        },
        {
          "id": "cmd_deputy",
          "name": "副将强化",
          "description": "副将技能效果+10%(从30%提升至40%)",
          "maxLevel": 3,
          "costPerLevel": [
            100,
            150,
            225
          ],
          "bonus": {
            "type": "deputy_effect",
            "valuePerLevel": 0.1
          },
          "prerequisite": {
            "node": "cmd_exp",
            "level": 2
          },
          "position": {
            "col": 0,
            "row": 1
          }
        },
        {
          "id": "cmd_gacha",
          "name": "招募天赋",
          "description": "抽卡史诗以上概率+2%",
          "maxLevel": 3,
          "costPerLevel": [
            120,
            180,
            270
          ],
          "bonus": {
            "type": "gacha_luck",
            "valuePerLevel": 0.02
          },
          "prerequisite": {
            "node": "cmd_exp",
            "level": 1
          },
          "position": {
            "col": 1,
            "row": 1
          }
        },
        {
          "id": "cmd_race",
          "name": "种族强化上限",
          "description": "种族强化上限+1级",
          "maxLevel": 3,
          "costPerLevel": [
            150,
            225,
            337
          ],
          "bonus": {
            "type": "race_enhance_cap",
            "valuePerLevel": 1
          },
          "prerequisite": {
            "node": "cmd_deputy",
            "level": 2
          },
          "position": {
            "col": 0,
            "row": 2
          }
        },
        {
          "id": "cmd_cost",
          "name": "高效运营",
          "description": "将领升级金币消耗-10%",
          "maxLevel": 3,
          "costPerLevel": [
            80,
            120,
            180
          ],
          "bonus": {
            "type": "hero_upgrade_discount",
            "valuePerLevel": 0.1
          },
          "prerequisite": {
            "node": "cmd_exp",
            "level": 1
          },
          "position": {
            "col": 1,
            "row": 0
          }
        }
      ]
    }
  }
};
