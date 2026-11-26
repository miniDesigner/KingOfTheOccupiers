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
    "_doc_battlePass": "赛季通行证（大厅功能行'🎖 通行证'按钮 + 商店特惠分类里的'🎖 通行证(高级)'商品项）。true=大厅入口显示在功能行（与商店/招募/任务并列，4 按钮）+ 商店里可购买高级通行证；false=大厅入口完全折叠（功能行 4→3 个按钮）+ 商店里 battle_pass_premium 商品联动隐藏（即使绕过展示调用也拒绝，防御层）。上线场景默认 false（待版本审核通过后开启）",
    "usePlaceholderArt": true,
    "_doc_usePlaceholderArt": "美术资源层总开关。true=渲染走 assets/ 下素材（当前为占位图，正式素材同名覆盖后无需改代码）；false=完全回退程序化绘制。Node 测试环境无 Image 时自动静默降级，不受此开关影响",
    "artAlpha": 0.5,
    "_doc_artAlpha": "占位底图叠加不透明度（0~1）。占位图带水印，默认 0.5 半透明以免遮挡动态文本；正式素材到位后可设 1 使用不透明贴图",
    "artExtendedLayer": true,
    "_doc_artExtendedLayer": "全量装饰层总开关。true=把上一轮审查判定「有素材但零引用」的 192 张占位图按界面语义叠加绘制；false=只保留首轮已接入的 139 张核心贴图。正式素材到位后可分别调节 artLayerAlpha",
    "artLayerAlpha": 1,
    "_doc_artLayerAlpha": "装饰层叠加系数（0~1，与每张素材的基准 alpha 相乘）。占位图阶段设 1；若觉得水印偏花可下调到 0.5 或关闭 artExtendedLayer",
    "artSubpageBgAlpha": 1,
    "_doc_artSubpageBgAlpha": "子界面背景叠加不透明度（0~1）。子界面已改为直接复用大厅底图 bg/lobby_bg，默认 1；设为 0 会退化为纯夜景渐变（仅调试用）。",
    "artResultDecor": true,
    "_doc_artResultDecor": "已废弃（2026-11-24）：结算装饰层已移除。result_star/promote/summary 奶黄九宫格与 defeat 特效低透明度压在夜色结算页上会形成悬浮灰框/脏斑；结果卡由 RenderSystem 自绘。键保留兼容，不再生效。",
    "artEffectDecor": true,
    "_doc_artEffectDecor": "特效/界面/行动帧装饰层开关。2026-11-23 effects/* 22 张、ui/* 38 张、tiles/* 5 张、兵种进阶 24 + 行走帧 3 已全部替换为正式素材，开启恢复叠加。",
    "useAudioAssets": true,
    "_doc_useAudioAssets": "音频资源总开关。assets/audio/ 下已放置 17 个 sfx + 1 个 BGM 占位音频；true=真微信环境启用音效/BGM（浏览器预览始终启用），false=静默。正式音源同名覆盖即可",
    "useCustomFont": true,
    "_doc_useCustomFont": "自定义字体开关。主包根目录 fonts/ 下已放置 title.ttf / number.ttf 两个真实字体（2026-11-21 从 assets/ 分包移出，微信分包资源隔离会导致 wx.loadFont 404）；true=启动时尝试 wx.loadFont / FontFace 加载，失败静默回退系统 sans-serif"
  },
  "hex": {
    "size": 52,
    "_doc_size": "六边形半径(像素)，影响地图整体大小。2026-11 玩法改造：32→52（地图缩为 11×7 后放大单格表现，棋盘总像素基本不变）"
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
    "initialGold": 200,
    "_doc_initialGold": "默认初始金币（死配置：生效值在 src/data/levels.js 的 baseGold=200，此处仅同步口径防漂移）",
    "baseGoldRate": 0.4,
    "killGoldPerWarrior": 0.8,
    "_doc_killGoldPerWarrior": "击杀敌人兵种赏金：每击杀1名敌方战士获得的金币(基础值，随敌方兵种等级提升)",
    "killGoldLevelStep": 0.2,
    "_doc_killGoldLevelStep": "赏金等级加成：敌方兵种每高1级，单兵赏金额外增加的金币数",
    "_doc_baseGoldRate": "基础金币产出(每秒)。实现为 BASE_GOLD_RATE + Σ(各产金建筑 goldRate) 相加，再乘局外养成倍率，并非相乘。2026-11 玩法改造：1→2（快节奏）；2026-11 节奏回收：2→1（小图产出过密，回到改造前）；2026-11-26 整体调慢 60%：1→0.4（×0.4）。注意：利息加成以本值为基数，本值下调会放大利息权重的相对占比（见数值诊断报告 P1-3）。"
  },
  "march": {
    "speed": 0.34,
    "_doc_speed": "行军速度(格/秒)。2026-09-09：1→0.6；2026-11 玩法改造：0.6→0.85（地图缩为 11×7，行军距离-60%，提速补偿）。2026-11 节奏回收时曾保持 0.85 不动并警告「请勿按放慢节奏直觉下调此值」——2026-11-26 该决策已被明确推翻：整体节奏调慢 60%，0.85→0.34（×0.4），行军耗时 ×2.5，与出兵间隔 ×2.5、战斗结算 ×2.5、金币 ×0.4 配套。副作用：单局拉长 1.5~2.5 倍、开局前 30 秒可操作内容变少，属已知且接受的代价。",
    "groupThreshold": 9,
    "_doc_groupThreshold": "兵营战士累积到此数量自动编队出发。2026-11 玩法改造：8→6（更快成军）；2026-11 节奏回收：6→9（队伍更少更大、交战次数下降；每队战力更高使攻城更快分胜负，单局不拉长）",
    "hqBufferMax": 12,
    "_doc_hqBufferMax": "大本营战士缓冲上限，超过后不再从大本营产出。2026-11 玩法改造：15→12"
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
    "decisionInterval": 3,
    "_doc_decisionInterval": "AI决策间隔(秒)【死配置·未生效：生效值在 src/entity/AIPlayer.js 的 AI_DIFFICULTY 难度表（非 src/meta/），本处仅口径占位，数值写死在源码。当前真值 easy/normal/hard/nightmare = 3.8/2.6/2.2/1.95 秒，与本处的 3 无关】"
  },
  "unitAttackCoefficient": 1,
  "_doc_unitAttackCoefficient": "全局兵种攻击力系数，影响所有战士的基础攻击力",
  "quality": {
    "_doc": "兵种品质等级配置（1~6）。2026-11 玩法改造（战力压缩）：品质倍率大幅拉平，品质差异迁移到技能解锁/羁绊/射程；数值战力顶级/一级比压至 2~2.5 倍",
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
        "multiplier": 1.04,
        "_doc": "良好品质，攻防+4%"
      },
      {
        "name": "蓝",
        "color": "#3b82f6",
        "multiplier": 1.07,
        "_doc": "优秀品质，攻防+7%"
      },
      {
        "name": "紫",
        "color": "#a855f7",
        "multiplier": 1.1,
        "_doc": "史诗品质，攻防+10%"
      },
      {
        "name": "橙",
        "color": "#f97316",
        "multiplier": 1.14,
        "_doc": "传说品质，攻防+14%"
      },
      {
        "name": "红",
        "color": "#ef4444",
        "multiplier": 1.18,
        "_doc": "神话品质，攻防+18%"
      }
    ]
  }
};
