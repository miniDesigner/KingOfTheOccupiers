/**
 * Auto-generated from game.json
 * Do not edit. Regenerate via: npm run build:config
 *
 * 微信小游戏专用: require('../../config/game.js') 即可加载
 */
module.exports = {
  "_doc": "全局游戏参数配置 - 六边形/地图/颜色/经济/行军/AI等基础参数",
  "features": {
    "_doc": "功能开关（true=开启，false=关闭；缺省 false 即未配置时全部关闭）。上线场景：shop=true（大厅'🏪 商店'入口保留），shopDiamondTab=false（钻石充值分页隐藏，待版号合规后再开），battlePass=false（通行证入口完全折叠，功能行 4→3，且联动隐藏商店特惠分类里的 battle_pass_premium 通行证高级版购买）",
    "shop": true,
    "_doc_shop": "游戏内商店总开关。true=大厅'🏪 商店'入口可见（其他分页可单独控制），false=入口完全不可见（紧急下线用）。上线场景默认 true",
    "shopDiamondTab": false,
    "_doc_shopDiamondTab": "商店内'💎 钻石充值'分页按钮。true=显示该分页，false=完全隐藏（仅隐藏钻石充值，免费/星尘兑换/训练物资/特惠等其他分页保留）。上线场景默认 false（版号合规后再单独开启）",
    "battlePass": false,
    "_doc_battlePass": "赛季通行证（大厅功能行'🎖 通行证'按钮 + 商店特惠分类里的'🎖 通行证(高级)'商品项）。true=大厅入口显示在功能行（与商店/招募/任务并列，4 按钮）+ 商店里可购买高级通行证；false=大厅入口完全折叠（功能行 4→3 个按钮）+ 商店里 battle_pass_premium 商品联动隐藏（即使绕过展示调用也拒绝，防御层）。上线场景默认 false（待版本审核通过后开启）"
  },
  "hex": {
    "size": 32,
    "_doc_size": "六边形半径(像素)，影响地图整体大小"
  },
  "map": {
    "radius": 4,
    "_doc_radius": "默认地图半径(环数)，关卡可单独覆盖",
    "camera": {
      "initialX": 0,
      "initialY": 0,
      "minScale": 0.5,
      "maxScale": 2
    }
  },
  "colors": {
    "players": {
      "0": "#4a5568",
      "1": "#3b82f6",
      "2": "#ef4444",
      "3": "#f59e0b",
      "4": "#8b5cf6"
    },
    "_doc_players": "0=中立 1=玩家 2=敌方1 3=敌方2 4=敌方3",
    "tileBack": "#2d3748",
    "tileBackBorder": "#4a5568"
  },
  "economy": {
    "initialGold": 100,
    "_doc_initialGold": "默认初始金币，关卡可单独覆盖",
    "baseGoldRate": 1,
    "killGoldPerWarrior": 2,
    "_doc_killGoldPerWarrior": "击杀敌人兵种赏金：每击杀1名敌方战士获得的金币(基础值，随敌方兵种等级提升)",
    "killGoldLevelStep": 0.5,
    "_doc_killGoldLevelStep": "赏金等级加成：敌方兵种每高1级，单兵赏金额外增加的金币数",
    "_doc_baseGoldRate": "基础金币产出(每秒)，金矿产出=baseGoldRate*goldRate"
  },
  "march": {
    "speed": 0.6,
    "_doc_speed": "行军速度(格/秒)。2026-09-09 节奏调整：1→0.6（整体节奏放慢）",
    "groupThreshold": 8,
    "_doc_groupThreshold": "兵营战士累积到此数量自动编队出发",
    "hqBufferMax": 15,
    "_doc_hqBufferMax": "大本营战士缓冲上限，超过后不再从大本营产出"
  },
  "animation": {
    "flipDuration": 0.5,
    "_doc_flipDuration": "翻转格子动画时长(秒)",
    "randomRevealDuration": 0.3,
    "_doc_randomRevealDuration": "随机格揭晓动画时长(秒)",
    "particle": {
      "maxCount": 300,
      "_doc_maxCount": "最大同时粒子数量，超出后不再生成新粒子"
    },
    "explosion": {
      "defaultCount": 12,
      "_doc_defaultCount": "爆炸默认粒子数量",
      "hqCount": 30,
      "_doc_hqCount": "大本营爆炸粒子数量",
      "duration": 0.5,
      "_doc_duration": "爆炸特效持续时长(秒)"
    },
    "synergy": {
      "ringDuration": 0.8,
      "_doc_ringDuration": "羁绊光环扩散时长(秒)",
      "baseRadius": 30,
      "_doc_baseRadius": "羁绊光环基础半径(像素)，实际=base+tier*step",
      "radiusStep": 20,
      "_doc_radiusStep": "每阶羁绊增加的半径"
    },
    "shake": {
      "defaultIntensity": 5,
      "_doc_defaultIntensity": "默认震动强度(像素)",
      "hqIntensity": 12,
      "_doc_hqIntensity": "大本营被摧毁震动强度",
      "critIntensity": 4,
      "_doc_critIntensity": "暴击震动强度",
      "defaultDuration": 0.3,
      "_doc_defaultDuration": "默认震动时长(秒)"
    },
    "fireworks": {
      "count": 8,
      "_doc_count": "胜利烟花发射次数",
      "interval": 0.3,
      "_doc_interval": "烟花发射间隔(秒)",
      "particleCount": 24,
      "_doc_particleCount": "每个烟花的粒子数量"
    }
  },
  "ai": {
    "decisionInterval": 6,
    "_doc_decisionInterval": "AI决策间隔(秒)，越小AI越积极。2026-09-09 节奏调整：4→6（整体节奏放慢）"
  },
  "unitAttackCoefficient": 1,
  "_doc_unitAttackCoefficient": "全局兵种攻击力系数，影响所有战士的基础攻击力",
  "quality": {
    "_doc": "兵种品质等级配置（1~6），品质影响攻防属性倍率",
    "tiers": [
      {
        "name": "白",
        "color": "#9ca3af",
        "multiplier": 1,
        "_doc": "普通品质，无加成"
      },
      {
        "name": "绿",
        "color": "#22c55e",
        "multiplier": 1.15,
        "_doc": "良好品质，攻防+15%"
      },
      {
        "name": "蓝",
        "color": "#3b82f6",
        "multiplier": 1.35,
        "_doc": "优秀品质，攻防+35%"
      },
      {
        "name": "紫",
        "color": "#a855f7",
        "multiplier": 1.6,
        "_doc": "史诗品质，攻防+60%"
      },
      {
        "name": "橙",
        "color": "#f97316",
        "multiplier": 1.9,
        "_doc": "传说品质，攻防+90%"
      },
      {
        "name": "红",
        "color": "#ef4444",
        "multiplier": 2.3,
        "_doc": "神话品质，攻防+130%"
      }
    ]
  }
};
