/**
 * Auto-generated from quests.json
 * Do not edit. Regenerate via: npm run build:config
 *
 * 微信小游戏专用: require('../../config/quests.js') 即可加载
 */
module.exports = {
  "dailyRefreshHour": 5,
  "dailyQuestCount": 4,
  "dailyQuests": [
    {
      "id": "d_play_1",
      "desc": "完成1场战斗",
      "type": "games_played",
      "target": 1,
      "reward": {
        "gold": 100,
        "diamond": 10
      }
    },
    {
      "id": "d_play_3",
      "desc": "完成3场战斗",
      "type": "games_played",
      "target": 3,
      "reward": {
        "gold": 200,
        "diamond": 20
      }
    },
    {
      "id": "d_win_1",
      "desc": "获得1场胜利",
      "type": "games_won",
      "target": 1,
      "reward": {
        "gold": 150,
        "stardust": 5
      }
    },
    {
      "id": "d_flip_50",
      "desc": "翻转50个格子",
      "type": "tiles_flipped",
      "target": 50,
      "reward": {
        "gold": 100,
        "stardust": 3
      }
    },
    {
      "id": "d_build_20",
      "desc": "建造20个建筑",
      "type": "buildings_built",
      "target": 20,
      "reward": {
        "gold": 120,
        "stardust": 3
      }
    },
    {
      "id": "d_kill_30",
      "desc": "消灭30个敌方建筑",
      "type": "enemies_killed",
      "target": 30,
      "reward": {
        "gold": 150,
        "stardust": 5
      }
    },
    {
      "id": "d_gacha_1",
      "desc": "进行1次招募",
      "type": "gacha_pulled",
      "target": 1,
      "reward": {
        "gold": 80,
        "diamond": 10
      }
    },
    {
      "id": "d_3star",
      "desc": "获得1次3星评价",
      "type": "stars_earned_3",
      "target": 1,
      "reward": {
        "gold": 200,
        "diamond": 30,
        "stardust": 10
      }
    },
    {
      "id": "d_upgrade_tech",
      "desc": "升级1次科技",
      "type": "tech_upgraded",
      "target": 1,
      "reward": {
        "gold": 100,
        "stardust": 5
      }
    },
    {
      "id": "d_upgrade_hero",
      "desc": "升级1次将领",
      "type": "hero_upgraded",
      "target": 1,
      "reward": {
        "gold": 100,
        "stardust": 5
      }
    }
  ],
  "achievements": [
    {
      "id": "a_first_win",
      "desc": "首次通关",
      "type": "games_won",
      "target": 1,
      "reward": {
        "diamond": 50
      }
    },
    {
      "id": "a_win_10",
      "desc": "累计胜利10场",
      "type": "games_won",
      "target": 10,
      "reward": {
        "diamond": 100,
        "stardust": 20
      }
    },
    {
      "id": "a_win_50",
      "desc": "累计胜利50场",
      "type": "games_won",
      "target": 50,
      "reward": {
        "diamond": 300,
        "stardust": 50
      }
    },
    {
      "id": "a_stars_30",
      "desc": "累计获得30颗星",
      "type": "total_stars",
      "target": 30,
      "reward": {
        "diamond": 100,
        "stardust": 30
      }
    },
    {
      "id": "a_stars_60",
      "desc": "累计获得60颗星",
      "type": "total_stars",
      "target": 60,
      "reward": {
        "diamond": 200,
        "stardust": 60,
        "heroTickets": 1
      }
    },
    {
      "id": "a_all_levels",
      "desc": "通关全部关卡",
      "type": "max_level_reached",
      "target": 20,
      "reward": {
        "diamond": 500,
        "stardust": 100,
        "heroTickets": 3
      }
    },
    {
      "id": "a_hero_count_5",
      "desc": "拥有5位将领",
      "type": "hero_count",
      "target": 5,
      "reward": {
        "diamond": 100,
        "stardust": 20
      }
    },
    {
      "id": "a_hero_count_10",
      "desc": "拥有10位将领",
      "type": "hero_count",
      "target": 10,
      "reward": {
        "diamond": 300,
        "stardust": 50,
        "heroTickets": 2
      }
    },
    {
      "id": "a_gacha_100",
      "desc": "累计招募100次",
      "type": "total_pulls",
      "target": 100,
      "reward": {
        "diamond": 200,
        "stardust": 40
      }
    },
    {
      "id": "a_tech_max",
      "desc": "一个科技分支全部满级",
      "type": "tech_branch_maxed",
      "target": 1,
      "reward": {
        "diamond": 200,
        "stardust": 50
      }
    },
    {
      "id": "a_equipment_legendary",
      "desc": "获得1件传说装备",
      "type": "equipment_quality",
      "target": 1,
      "targetMeta": {
        "quality": "legendary"
      },
      "reward": {
        "diamond": 100,
        "stardust": 30
      }
    },
    {
      "id": "a_equipment_mythic",
      "desc": "获得1件神话装备",
      "type": "equipment_quality",
      "target": 1,
      "targetMeta": {
        "quality": "mythic"
      },
      "reward": {
        "diamond": 300,
        "stardust": 80,
        "heroTickets": 1
      }
    },
    {
      "id": "a_play_100",
      "desc": "累计战斗100场",
      "type": "games_played",
      "target": 100,
      "reward": {
        "diamond": 200,
        "stardust": 50
      }
    },
    {
      "id": "a_hero_count_20",
      "desc": "收集20种兵种",
      "type": "hero_count",
      "target": 20,
      "reward": {
        "diamond": 200,
        "stardust": 50
      }
    },
    {
      "id": "a_hero_count_40",
      "desc": "集齐全部40种兵种",
      "type": "hero_count",
      "target": 40,
      "reward": {
        "diamond": 1000,
        "stardust": 200,
        "heroTickets": 3
      }
    },
    {
      "id": "a_share_first",
      "desc": "首次分享游戏",
      "type": "share_count",
      "target": 1,
      "reward": {
        "gold": 300,
        "stardust": 10
      }
    },
    {
      "id": "a_share_10",
      "desc": "累计分享10次",
      "type": "share_count",
      "target": 10,
      "reward": {
        "diamond": 100,
        "stardust": 30
      }
    },
    {
      "id": "a_gacha_500",
      "desc": "累计招募500次",
      "type": "total_pulls",
      "target": 500,
      "reward": {
        "diamond": 500,
        "stardust": 100,
        "heroTickets": 2
      }
    },
    {
      "id": "a_streak_5",
      "desc": "达成5连胜",
      "type": "max_streak",
      "target": 5,
      "reward": {
        "diamond": 150,
        "stardust": 30
      }
    },
    {
      "id": "a_streak_10",
      "desc": "达成10连胜",
      "type": "max_streak",
      "target": 10,
      "reward": {
        "diamond": 400,
        "stardust": 80,
        "heroTickets": 1
      }
    },
    {
      "id": "a_power_2000",
      "desc": "战力达到2000",
      "type": "total_power",
      "target": 2000,
      "reward": {
        "diamond": 200,
        "stardust": 50
      }
    },
    {
      "id": "a_power_5000",
      "desc": "战力达到5000",
      "type": "total_power",
      "target": 5000,
      "reward": {
        "diamond": 500,
        "stardust": 120,
        "heroTickets": 2
      }
    }
  ],
  "weeklyQuestCount": 4,
  "weeklyQuests": [
    {
      "id": "w_play_10",
      "desc": "本周完成10场战斗",
      "type": "games_played",
      "target": 10,
      "reward": {
        "gold": 300,
        "stardust": 15
      }
    },
    {
      "id": "w_win_5",
      "desc": "本周获得5场胜利",
      "type": "games_won",
      "target": 5,
      "reward": {
        "gold": 400,
        "diamond": 50,
        "stardust": 20
      }
    },
    {
      "id": "w_flip_300",
      "desc": "本周翻转300个格子",
      "type": "tiles_flipped",
      "target": 300,
      "reward": {
        "gold": 300,
        "stardust": 15
      }
    },
    {
      "id": "w_build_80",
      "desc": "本周建造80个建筑",
      "type": "buildings_built",
      "target": 80,
      "reward": {
        "gold": 350,
        "stardust": 18
      }
    },
    {
      "id": "w_kill_100",
      "desc": "本周消灭100个敌方单位",
      "type": "enemies_killed",
      "target": 100,
      "reward": {
        "gold": 400,
        "diamond": 40,
        "stardust": 20
      }
    },
    {
      "id": "w_gacha_10",
      "desc": "本周招募10次",
      "type": "gacha_pulled",
      "target": 10,
      "reward": {
        "gold": 250,
        "diamond": 30
      }
    },
    {
      "id": "w_tech_3",
      "desc": "本周升级3次科技",
      "type": "tech_upgraded",
      "target": 3,
      "reward": {
        "gold": 300,
        "stardust": 20
      }
    },
    {
      "id": "w_share_3",
      "desc": "本周分享3次",
      "type": "share_count",
      "target": 3,
      "reward": {
        "gold": 200,
        "diamond": 30,
        "stardust": 10
      }
    }
  ],
  "seasonQuestCount": 3,
  "seasonQuests": [
    {
      "id": "s_play_50",
      "desc": "本赛季完成50场战斗",
      "type": "games_played",
      "target": 50,
      "reward": {
        "gold": 800,
        "diamond": 100,
        "stardust": 40
      }
    },
    {
      "id": "s_win_25",
      "desc": "本赛季获得25场胜利",
      "type": "games_won",
      "target": 25,
      "reward": {
        "gold": 1000,
        "diamond": 150,
        "stardust": 60
      }
    },
    {
      "id": "s_flip_1000",
      "desc": "本赛季翻转1000个格子",
      "type": "tiles_flipped",
      "target": 1000,
      "reward": {
        "gold": 800,
        "diamond": 100,
        "stardust": 50
      }
    },
    {
      "id": "s_build_300",
      "desc": "本赛季建造300个建筑",
      "type": "buildings_built",
      "target": 300,
      "reward": {
        "gold": 900,
        "diamond": 120,
        "stardust": 50
      }
    },
    {
      "id": "s_gacha_50",
      "desc": "本赛季招募50次",
      "type": "gacha_pulled",
      "target": 50,
      "reward": {
        "gold": 600,
        "diamond": 120,
        "stardust": 40
      }
    }
  ]
};
