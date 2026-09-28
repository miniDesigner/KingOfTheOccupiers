/**
 * 游戏主类
 * 游戏循环 + 状态管理 + 系统调度
 */

import { HexMap } from '../world/HexMap.js';
import { HexTile } from '../world/HexTile.js';
import { Player } from '../entity/Player.js';
import { AIPlayer } from '../entity/AIPlayer.js';
import { SnapshotPlayer } from '../entity/SnapshotPlayer.js';
import { Building } from '../entity/Building.js';
import { MarchGroup } from '../entity/MarchGroup.js';

import { SessionManager } from '../net/SessionManager.js';

import { EconomySystem } from '../system/EconomySystem.js';
import { BuildSystem } from '../system/BuildSystem.js';
import { PathfindingSystem } from '../system/PathfindingSystem.js';
import { MarchSystem } from '../system/MarchSystem.js';
import { CombatSystem } from '../system/CombatSystem.js';
import { TowerSystem } from '../system/TowerSystem.js';
import { SynergySystem } from '../system/SynergySystem.js';
import { SkillSystem } from '../system/SkillSystem.js';
import { InputSystem } from '../system/InputSystem.js';
import { RenderSystem } from '../system/RenderSystem.js';
import { AnimationManager } from '../system/AnimationManager.js';
import AudioManager from '../system/AudioManager.js';
import AdManager from '../system/AdManager.js';

import { FLIP_ANIMATION_DURATION, PLAYER_COLORS, getFlipCost,
  syncConfigToStatics } from '../config.js';
import { getRandomBattleConfig,
  syncLevels } from '../data/levels.js';
import { syncRaces, RACES } from '../data/races.js';
import ConfigLoader from '../data/ConfigLoader.js';
import { pixelToHex, hexToPixel } from '../world/HexMath.js';
import { setBattleRng, createRng } from '../utils/rng.js';
import { rowItemWidth, rowStartX, techNodeWidth, techTabWidth, ladderCombo, ladderBarWidth, LAYOUT_DESIGN_MAX, LAYOUT_MIN } from '../system/Layout.js';

// 局外养成系统
import ProfileManager from '../meta/ProfileManager.js';
import AccountManager from '../meta/AccountManager.js';
import BonusCalculator from '../meta/BonusCalculator.js';
import TechTreeSystem from '../meta/TechTreeSystem.js';
import QuestSystem from '../meta/QuestSystem.js';
import ShopSystem from '../meta/ShopSystem.js';
import BattlePassSystem from '../meta/BattlePassSystem.js';
import DeploymentSystem from '../meta/DeploymentSystem.js';
import * as LadderSystem from '../meta/LadderSystem.js';
import PowerSystem from '../meta/PowerSystem.js';
import ShareSystem from '../meta/ShareSystem.js';
import LeaderboardSystem from '../meta/LeaderboardSystem.js';
import { generateOpponent, searchDelay,
  ASYNC_MATCH_TIMEOUT_MS } from '../meta/AsyncMatchSystem.js';

export class Game {
  constructor(canvas, ctx, screenWidth, screenHeight, safeArea) {
    this.canvas = canvas;
    this.ctx = ctx;
    this.screenWidth = screenWidth;
    this.screenHeight = screenHeight;

    // ===== 安全区适配（iPhone 刘海 / Android 状态栏 / home indicator） =====
    // Phase 7 P7：微信小游戏渲染全屏 Canvas，但部分设备顶部有刘海、底部有 home indicator。
    // 解决方案：RenderSystem 用 ctx.translate(0, top) + ctx.scale(1, scaleY) 把 inner 坐标系
    //          [0, h] 线性映射到屏幕 [top, h-bottom]，所有 Scene 按全屏 h 设计的锚点
    //          （顶部状态栏 y=0、底部按钮 y=h-80）渲染后恰好落在刘海下沿与 home indicator 上沿之间。
    //          顶部 [0, top] + 底部 [h-bottom, h] 各画一道黑底覆盖；
    //          点击命中由 Game 端对 clientY 反推 (y - top) / scaleY 命中 Scene 坐标。
    // 浏览器环境（safari/iframe 预览）safeArea 全为 0，scaleY = 1，等同无刘海，行为不变。
    this.safeArea = safeArea || { top: 0, bottom: 0, left: 0, right: 0 };

    // 系统
    this.inputSystem = new InputSystem(canvas, screenWidth, screenHeight);
    this.renderSystem = new RenderSystem(ctx, screenWidth, screenHeight);
    // P8：RenderSystem 是安全区的单一真相源 —— 内部做防御钳制（SAFE_AREA_MAX）并算出 scaleY。
    // 这里回读钳制后的值，保证「点击反推」与「渲染映射」用同一个 scaleY，两边绝不会漂移。
    this.renderSystem.setSafeArea(this.safeArea);
    this.safeAreaTop = this.renderSystem.safeAreaTop;
    this.safeAreaBottom = this.renderSystem.safeAreaBottom;
    this.safeAreaScaleY = this.renderSystem.safeAreaScaleY;
    // P8：同步给输入层 —— 地图拖拽 / 菜单滚动的增量需要换算回 inner 坐标系才跟手
    this.inputSystem.touchScaleY = this.safeAreaScaleY;
    // P36：top 偏移一并同步 —— 双指缩放要以「双指中心」为锚点，中心点是屏幕坐标，
    // 必须按 inner_y = (screen_y - top) / scaleY 折算后才能与 cameraY 同一坐标系运算。
    this.inputSystem.touchTop = this.safeAreaTop;

    // 始终绑定点击事件（handleScreenClick 内部根据 screenState 分发，不存在时机冲突）
    // 安全区适配：RenderSystem 用 translate(0, top) + scale(1, scaleY) 把 inner [0, h] 映射到屏幕
    // [top, h-bottom]，点击坐标反推 inner_y = (screenY - top) / scaleY 命中 Scene 内 rect.y
    this.inputSystem.onTileClick = (screenX, screenY) => {
      this.handleScreenClick(screenX, (screenY - this.safeAreaTop) / this.safeAreaScaleY);
    };
    // 按压状态（按钮按压缩放反馈：记录按下位置与时间，渲染层据此轻微缩放）
    this._press = null;
    // P8：按压坐标同样要反推到 inner 坐标系 —— RenderSystem._drawPressed 拿 press.y 去比
    // Scene 内 rect.y，若不反推，刘海机上会偏差 safeAreaTop(≈59px)，表现为
    // 「点 A 按钮、B 按钮缩放」的按压反馈错位。
    this.inputSystem.onPress = (x, y) => {
      this._press = { x, y: (y - this.safeAreaTop) / this.safeAreaScaleY, t: Date.now() };
    };
    this.inputSystem.onRelease = () => { if (this._press) this._press.t = Date.now(); };
    this.pathfindingSystem = PathfindingSystem;
    this.animManager = new AnimationManager();
    this.audioManager = AudioManager;

    // 连接 CombatSystem → RenderSystem + AnimationManager + AudioManager
    CombatSystem.renderSystem = this.renderSystem;
    CombatSystem.animManager = this.animManager;
    CombatSystem.audioManager = this.audioManager;

    // 连接 SynergySystem → AnimationManager + AudioManager
    SynergySystem.animManager = this.animManager;
    SynergySystem.audioManager = this.audioManager;

    // 连接 RenderSystem → AnimationManager + AudioManager
    this.renderSystem.animManager = this.animManager;
    this.renderSystem.audioManager = this.audioManager;

    // 游戏状态
    this.map = null;
    this.players = [];
    this.marchGroups = [];
    this.gameStatus = 'playing'; // playing / won / lost
    this.elapsedTime = 0;

    // 当前对战配置
    this.currentBattleConfig = null;

    // 对战形态（实时联机已移除）
    this.battleMode = 'ai';          // 'ai'（快速AI对战） | 'snapshot'（异步快照PvP）
    this.localPlayerId = 1;          // 我方恒为 1
    this._opponentTrophies = null;   // 快照对手奖杯分（Elo 结算输入）

    // 异步对战匹配状态：'searching' = 匹配搜索中（overlay 展示），null = 未在匹配
    this._asyncState = null;
    this._asyncStartAt = 0;          // 匹配开始时间戳（内部记录用；overlay 不展示等待秒数）
    this._matchFoundTimer = null;    // 模拟检索延迟定时器（2~4s 找到快照对手）
    this._matchTimeout = null;       // 10s 匹配超时定时器 → 降级 AI

    // 解锁的种族（从ProfileManager同步）
    this.unlockedRaces = ['human', 'beast'];

    // 当前选择的种族阵容（保留兼容，玩家建筑不再依赖此字段）
    this.selectedRace = 'human';

    // 上阵数据包（每局开始时从局外养成生成）
    this.deploymentBundle = null;

    // 屏幕状态: 'lobby' / 'deploy_select' / 'playing' / 'tech_panel' / 'shop' / 'quest' / 'battle_pass' / 'gacha' / 'leaderboard'
    this.screenState = 'lobby';

    // 翻转中的格子队列(等待动画完成)
    this.flippingTiles = [];

    // 暂停状态
    this.paused = false;

    this.metaScrollY = 0;
    this.shopTab = 0;   // P37：商店默认停在「免费」分页（config/shop.json 中 free 排第一）

    // 当前BonusBundle（每局开始时重新计算）
    this.currentBonusBundle = null;

    // Toast 提示（屏幕浮动文字）
    this._toastText = '';
    this._toastTimer = 0;

    // 上阵拖拽状态
    this._deployDrag = { active: false, type: null, id: null, fromSlot: -1, x: 0, y: 0 };
    this._deployPress = null;       // 长按待激活的拖拽候选（兵种专用）
    this._deployPressTimer = null;  // 长按计时器（DEPLOY_LONG_PRESS_MS 后激活拖拽）
    this._lastDeployY = null; // 上阵界面滚动辅助
    // 招募面板开关
    this._showRecruitPanel = false;
    // 兵种详情/升级面板
    this._unitDetailId = null;
    this._buildingDetailType = null;  // P33: 建筑升级详情面板状态('barracks'/'arrow_tower'/'gold_mine'/null)
    this._synergyDetailId = null;      // P35: 羁绊详情面板状态(羁绊ID/null)
    // 抽卡系统状态
    this._gachaResults = null;   // 抽卡结果数组
    this._gachaRevealIdx = 0;    // 当前展示到第几张
    this._gachaAnimating = false; // 抽卡动画进行中

    // 排行榜状态（Phase 5）
    this.leaderboardTab = 0;     // 0=天梯榜 1=战力榜 2=胜场榜 3=收集榜
    this._leaderboardData = null;

    // 新手引导状态（Phase 5）
    this._tutorialActive = false;

    // 设置窗口 / 公告子窗口（覆盖层，打开时屏蔽底层界面点击）
    this._settingsOpen = false;
    this._announceOpen = false;

    // 账号面板（覆盖层，大厅点击账号信息行打开；登录/切换/注销多账号）
    this._accountOpen = false;

    // 系统返回键支持（浏览器 history 占位层 / 微信 Android 返回键）
    this._backEnabled = false;    // 是否启用（浏览器环境自动启用）
    this._lastLayerActive = false; // 上一帧是否有界面层（面板/战斗/窗口）打开
    this._onPopState = null;       // popstate 回调（浏览器返回键）
  }

  /**
   * 初始化对战
   * @param {number} [seed] - 对局随机种子（测试复现用；日常对局不传，battleRandom() 回退 Math.random）
   * @param {object|null} [session] - 对局会话：
   *   - null → 快速 AI 对战（「开战」按钮 / 新手引导 / 离线练习）
   *   - { mode: 'snapshot', snapshot } → 异步快照 PvP（SnapshotPlayer 对手 + Elo 结算）
   */
  initBattle(seed, session = null) {
    // 确定性随机源：注入种子后本局所有随机决策（地图/AI/兵种/暴击/复活）走同一随机流
    this.battleSeed = typeof seed === 'number' ? seed : null;
    this.rng = this.battleSeed !== null ? createRng(this.battleSeed) : null;
    setBattleRng(this.rng);

    // 对局形态：ai（快速AI对战）/ snapshot（异步快照PvP）
    const isSnapshot = !!(session && session.mode === 'snapshot');
    this.battleMode = isSnapshot ? 'snapshot' : 'ai';
    this.localPlayerId = 1;

    // 天梯匹配：按当前奖杯决定对手 AI 难度（段位难度分布，养成模拟，无金币/产兵/技能档位/战力作弊）
    const _profile = ProfileManager.get();
    const _trophies = _profile ? (_profile.trophies || 0) : 0;
    const config = getRandomBattleConfig(_trophies);
    this.currentBattleConfig = config;

    // 技能系统：AI 兵种一致化后，敌方兵种技能由等级自然驱动（getUnitStats→getUnitSkillList），
    // 不再用独立技能档位；setEnemyDifficulty 仅保留难度（种族模式旧链路兼容用）
    SkillSystem.reset();
    SkillSystem.setEnemyDifficulty(
      isSnapshot && session.snapshot
        ? (session.snapshot.difficulty || 'normal')
        : (config.enemies?.[0]?.ai || 'normal'),
    );
    this.gameStatus = 'playing';
    this.screenState = 'playing';
    this.elapsedTime = 0;
    this.marchGroups = [];
    this.flippingTiles = [];
    this.paused = false;

    // 重置战斗招募日志
    EconomySystem.resetRecruitLog();

    // 清除上一局的所有特效
    this.animManager.clear();

    // 播放BGM
    this.audioManager.playBGM();

    // 生成地图（行列制矩形棋盘 + 随机布局的障碍格：山脉/河流，切分进攻战线）
    this.map = new HexMap();
    this.map.generate(config.cols, config.rows, config.obstacles);

    // 保底：玩家大本营周围一圈至少3个一级地块（开局扩张平滑，避免周围全是高级地块卡死前期）
    this.map.ensureLevelOneAround(config.playerBase.q, config.playerBase.r, 3);

    // 战斗开始时只建造大本营，不放置预设建筑
    // if (config.presetBuildings && config.presetBuildings.length > 0) {
    //   for (const pb of config.presetBuildings) {
    //     const tile = this.map.getTile(pb.q, pb.r);
    //     if (tile) {
    //       tile.presetBuilding = { type: pb.type, level: pb.level || 1 };
    //     }
    //   }
    // }

    // 创建玩家(使用上阵系统数据)
    this.players = [];
    const localId = this.localPlayerId; // 恒为 1
    const _localName = (_profile && _profile.nickname) ? _profile.nickname : '玩家';
    const humanPlayer = new Player(localId, _localName, PLAYER_COLORS[localId], false);
    humanPlayer.gold = config.player.initialGold;

    // 生成上阵数据包
    this.deploymentBundle = DeploymentSystem.generateBundle();
    humanPlayer.deploymentBundle = this.deploymentBundle;
    humanPlayer.race = 'custom';
    humanPlayer.raceLineup = ['custom'];
    this.players.push(humanPlayer);

    // 应用局外养成加成
    this.currentBonusBundle = BonusCalculator.calculate();
    BonusCalculator.applyToPlayer(humanPlayer, this.currentBonusBundle);

    // 创建敌方：异步快照局用 SnapshotPlayer（快照阵容 + AI 决策），快速局用 AIPlayer
    if (isSnapshot) {
      const snap = session.snapshot || {};
      const remoteCfg = (config.enemies && config.enemies[0]) || {};
      const enemyId = remoteCfg.id || 2;
      const sp = new SnapshotPlayer(enemyId, snap);
      sp.gold = typeof remoteCfg.initialGold === 'number'
        ? remoteCfg.initialGold
        : (snap.initialGold || config.player.initialGold);
      sp.race = 'custom';
      sp.raceLineup = ['custom'];
      // 战力规则匹配：段位产兵乘数（快照对手用其奖杯分段的天梯曲线值）
      if (typeof snap.warriorRateMult === 'number') {
        sp.warriorRateMult = snap.warriorRateMult;
      } else if (typeof remoteCfg.warriorRateMult === 'number') {
        sp.warriorRateMult = remoteCfg.warriorRateMult;
      }
      // 快照对手阵容：按其难度档生成玩家同款 deploymentBundle（养成模拟，无技能档位/战力比修正）
      sp.deploymentBundle = PowerSystem.generateAiDeployment(sp.aiLevel);
      this.players.push(sp);
      // 对手奖杯分：Elo 结算输入（呈现层 + 结算层，不参与战斗演算）
      this._opponentTrophies = typeof snap.trophies === 'number' ? snap.trophies : null;
    } else {
      // 创建敌方AI
      for (const enemyConfig of config.enemies) {
        const ai = new AIPlayer(enemyConfig.id, enemyConfig.name, enemyConfig.color, enemyConfig.ai);
        ai.gold = enemyConfig.initialGold;
        ai.race = enemyConfig.race;
        ai.raceLineup = [enemyConfig.race];
        // 战力规则匹配：段位产兵乘数（覆盖难度默认值）
        if (typeof enemyConfig.warriorRateMult === 'number') {
          ai.warriorRateMult = enemyConfig.warriorRateMult;
        }
        // AI 兵种一致化：按难度生成玩家同款 deploymentBundle（养成模拟：品质上限+等级基准随难度）
        ai.deploymentBundle = PowerSystem.generateAiDeployment(enemyConfig.ai);
        this.players.push(ai);
      }
    }

    // 世界状态按 playerId 固化：players 数组顺序 canonical（升序）
    this.players.sort((a, b) => a.id - b.id);

    // 设置玩家大本营（本地玩家恒 id=1 拥有 playerBase）
    const playerBaseOwnerId = localId;
    const playerBaseTile = this.map.getTile(config.playerBase.q, config.playerBase.r);
    if (playerBaseTile) {
      const basePlayer = this.players.find(p => p.id === playerBaseOwnerId);
      playerBaseTile.owner = playerBaseOwnerId;
      playerBaseTile.isFlipped = true;
      playerBaseTile.building = new Building('headquarters', 1, 'custom', playerBaseOwnerId, basePlayer ? basePlayer.deploymentBundle : this.deploymentBundle);
      if (basePlayer) basePlayer.setBase(playerBaseTile);
    }

    // 设置敌方大本营（AI 用 config.enemies[0].id；快照局沿用同一 enemy id）
    const firstEnemyId = (config.enemies && config.enemies[0]) ? config.enemies[0].id : 2;
    const enemyBaseTile = this.map.getTile(config.enemyBase.q, config.enemyBase.r);
    if (enemyBaseTile) {
      const enemy = this.players.find(p => p.id === firstEnemyId);
      if (enemy) {
        enemyBaseTile.owner = enemy.id;
        enemyBaseTile.isFlipped = true;
        enemyBaseTile.building = new Building('headquarters', 1, enemy.race, enemy.id, enemy.deploymentBundle);
        enemy.setBase(enemyBaseTile);
      }
    }

    // 多敌人: 其他敌人也设置大本营（仅 AI 模式；快照局只有 1 个对手）
    if (!isSnapshot) {
      for (let i = 1; i < config.enemies.length; i++) {
        const ec = config.enemies[i];
        const enemy = this.players.find(p => p.id === ec.id);
        if (ec.base && enemy) {
          const tile = this.map.getTile(ec.base.q, ec.base.r);
          if (tile) {
            tile.owner = enemy.id;
            tile.isFlipped = true;
            tile.building = new Building('headquarters', 1, enemy.race, enemy.id, enemy.deploymentBundle);
            enemy.setBase(tile);
          }
        }
      }
    }

    // 战斗开始时只建造大本营，不预置其他建筑
    // this.setupInitialTerritory();

    // 设置相机：自动缩放适配整张棋盘（上下布局，上方留出HUD空间），再居中
    const bounds = this.map.getBounds();
    const fitScale = Math.min(
      1,
      this.screenWidth / (bounds.width + 40),
      (this.screenHeight * 0.86) / (bounds.height + 40)
    );
    this.inputSystem.scale = Math.max(0.35, fitScale);
    const centerX = (bounds.minX + bounds.width / 2) * this.inputSystem.scale;
    const centerY = (bounds.minY + bounds.height / 2) * this.inputSystem.scale;
    this.inputSystem.cameraX = this.screenWidth / 2 - centerX;
    this.inputSystem.cameraY = (this.screenHeight * 0.93) / 2 - centerY + this.screenHeight * 0.035;

    const enemyPlayer = this.players.find(p => p.id === firstEnemyId);
    const enemyBundle = enemyPlayer ? enemyPlayer.deploymentBundle : null;
    const aiUnits = enemyBundle ? Object.values(enemyBundle.units || {}).map(u => `${u.name}(Lv${u.level})`).join('/') : '种族固定兵';
    console.log('[Game] Battle initialized | Mode:', this.battleMode,
      '| Enemy:', enemyPlayer ? enemyPlayer.name : '',
      '| AI:', enemyPlayer ? (enemyPlayer.aiLevel || '') : '',
      '| Race:', enemyPlayer ? enemyPlayer.race : '',
      '| Layout:', config.layoutName || `${config.rows}x${config.cols}`, '| Obstacles:', (config.obstacles || []).length,
      '| Enemy Units:', aiUnits);
  }

  // === 异步对战匹配（PvP 快照对手 + 10s 超时降级 AI） ===

  /**
   * 启动异步对战匹配：
   *   0~10s 匹配搜索（模拟 2~4s 检索延迟找到快照对手）→ 快照 PvP；
   *   10s 超时未找到 → 降级本地 AI 对战。
   */
  _startAsyncMatch() {
    this._cancelAsyncMatch();
    this._asyncState = 'searching';
    this._asyncStartAt = Date.now();
    // 模拟检索延迟：2~4s 后「找到」快照对手（营造匹配感；本地生成即得）
    this._matchFoundTimer = setTimeout(() => this._onAsyncOpponentFound(), searchDelay());
    // 10s 匹配超时 → 降级 AI（仅当检索延迟定时器异常未触发时兜底）
    this._matchTimeout = setTimeout(() => {
      this._matchTimeout = null;
      if (this._asyncState === 'searching') {
        this._fallbackToAI();
      }
    }, ASYNC_MATCH_TIMEOUT_MS);
  }

  /** 匹配成功：生成快照对手并进入异步 PvP 对局 */
  _onAsyncOpponentFound() {
    if (this._asyncState !== 'searching') return; // 已取消/已降级
    const opponent = generateOpponent(ProfileManager.get());
    this._cancelAsyncMatch();
    this.initBattle(null, { mode: 'snapshot', snapshot: opponent });
    this.showToast(`⚔ 已匹配对手：${opponent.name}（🏆${opponent.trophies}）`, 2.5);
  }

  /** 取消/清理异步匹配（清定时器 + 复位状态） */
  _cancelAsyncMatch() {
    if (this._matchFoundTimer) { clearTimeout(this._matchFoundTimer); this._matchFoundTimer = null; }
    if (this._matchTimeout) { clearTimeout(this._matchTimeout); this._matchTimeout = null; }
    this._asyncState = null;
    this._asyncStartAt = 0;
  }

  /** 匹配超时：降级本地 AI 对战（按当前奖杯匹配难度） */
  _fallbackToAI() {
    this._cancelAsyncMatch();
    this.showToast('匹配超时，已为你匹配 AI 对手', 2);
    this.initBattle();
  }

  /** 匹配中 overlay 点击（取消按钮；遮罩点击不关闭，避免误触） */
  _handleMatchOverlayClick(screenX, screenY) {
    const w = this.screenWidth, h = this.screenHeight;
    const panelW = 300, panelH = 240;
    const panelY = (h - panelH) / 2;
    const btnW = 220, btnH = 44;
    const btnX = (w - btnW) / 2;
    const cancelBtnY = panelY + panelH - btnH - 20;
    if (screenX >= btnX && screenX <= btnX + btnW &&
        screenY >= cancelBtnY && screenY <= cancelBtnY + btnH) {
      this.audioManager.playButtonClick();
      this._cancelAsyncMatch();
      this.showToast('已取消匹配', 1.5);
    }
  }

  /** 绘制异步匹配等待 overlay（匹配成功后自动消失） */
  _drawMatchOverlay() {
    const ctx = this.ctx;
    const w = this.screenWidth, h = this.screenHeight;

    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(0, 0, w, h);

    const panelW = 300, panelH = 240;
    const panelX = (w - panelW) / 2, panelY = (h - panelH) / 2;
    ctx.fillStyle = '#1f2937';
    ctx.fillRect(panelX, panelY, panelW, panelH);
    ctx.strokeStyle = '#3b82f6';
    ctx.lineWidth = 2;
    ctx.strokeRect(panelX, panelY, panelW, panelH);

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 18px sans-serif';
    ctx.fillText('🎯 异步对战匹配', w / 2, panelY + 40);

    // 检索状态提示（不显示倒计时/等待秒数/超时信息；超时降级由 _fallbackToAI 自动处理）
    const dots = '.'.repeat(1 + Math.floor((Date.now() / 400) % 3));
    ctx.fillStyle = '#60a5fa';
    ctx.font = 'bold 20px sans-serif';
    ctx.fillText(`正在检索实力相近的对手${dots}`, w / 2, panelY + 95);
    ctx.fillStyle = '#9ca3af';
    ctx.font = '12px sans-serif';
    ctx.fillText('通常几秒内即可开战', w / 2, panelY + 130);

    // 取消按钮
    const btnW = 220, btnH = 44;
    const btnX = (w - btnW) / 2;
    const cancelBtnY = panelY + panelH - btnH - 20;
    ctx.fillStyle = '#4b5563';
    ctx.fillRect(btnX, cancelBtnY, btnW, btnH);
    ctx.strokeStyle = '#9ca3af';
    ctx.lineWidth = 1;
    ctx.strokeRect(btnX, cancelBtnY, btnW, btnH);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 15px sans-serif';
    ctx.fillText('取消', w / 2, cancelBtnY + btnH / 2);
  }

  /**
   * 获取本局对手AI难度（天梯结算用）
   */
  _getEnemyDifficulty() {
    const cfg = this.currentBattleConfig;
    return (cfg && cfg.enemies && cfg.enemies[0] && cfg.enemies[0].ai) || 'normal';
  }

  /**
   * 天梯变动反馈：晋段金光 + toast
   */
  _notifyLadderChange(rewards) {
    if (!rewards) return;
    if (rewards.tierUp) {
      this.animManager.flashScreen('#ffd700', 0.4);
      this.showToast(`⬆ 晋升【${rewards.tier.icon} ${rewards.tier.label}】段位！${rewards.tierUpRewardText ? '奖励 ' + rewards.tierUpRewardText : ''}`, 3);
    } else if (rewards.protectedNotice) {
      // 预留：保段提示（当前静默处理，避免败方连续弹窗）
    }
  }

  /**
   * AI初始占领格子
   * 玩家获得2格，AI获得1格
   */
  setupInitialTerritory() {
    const enemy = this.players.find(p => p.isAI);
    if (!enemy || !enemy.base) return;

    // AI大本营周围占领1个格子
    const neighbors = this.map.getNeighbors(enemy.base.q, enemy.base.r);
    if (neighbors.length > 0) {
      const tile = neighbors[0];
      tile.owner = enemy.id;
      tile.isFlipped = true;

      const preset = tile.presetBuilding;
      let buildingType = 'barracks';
      let buildingLevel = 1;
      if (preset && preset.type !== 'random') {
        buildingType = preset.type;
        buildingLevel = preset.level || 1;
      }
      tile.building = new Building(buildingType, buildingLevel, enemy.race, enemy.id, enemy.deploymentBundle);
      enemy.addTile(tile);
    }

    // 玩家大本营周围给2个格子
    const humanPlayer = this.players.find(p => p.id === this.localPlayerId);
    if (humanPlayer && humanPlayer.base) {
      const playerNeighbors = this.map.getNeighbors(humanPlayer.base.q, humanPlayer.base.r);
      for (let i = 0; i < Math.min(2, playerNeighbors.length); i++) {
        const tile = playerNeighbors[i];
        tile.owner = this.localPlayerId;
        tile.isFlipped = true;
        const preset = tile.presetBuilding;
        let buildingType = 'barracks';
        let buildingLevel = 1;
        if (preset && preset.type !== 'random') {
          buildingType = preset.type;
          buildingLevel = preset.level || 1;
        }
        tile.building = new Building(buildingType, buildingLevel, 'custom', this.localPlayerId, this.deploymentBundle);
        humanPlayer.addTile(tile);
      }
    }
  }

  /**
   * 系统返回键处理（浏览器后退 / Android 物理返回 / 微信侧滑手势）
   * 语义：逐级关闭当前打开的子窗口/界面，主大厅再返回才交还系统退出。
   * @returns {'consumed'|'keep'|'none'}
   *  - 'consumed'：已关闭一个界面层（浏览器占位层自然消费，不再推回）
   *  - 'keep'   ：返回被消费但必须保持页面（战斗暂停/继续，需推回占位层）
   *  - 'none'   ：无可退界面（主大厅），交还系统默认行为（退出页面/小游戏）
   */
  tryBack() {
    // 异步匹配搜索中（大厅模态 overlay）优先取消
    if (this._asyncState === 'searching') {
      this._cancelAsyncMatch();
      this.audioManager.playButtonClick();
      this.showToast('已取消匹配', 1.5);
      return 'consumed';
    }
    // 子窗口优先：设置 → 公告 → 账号面板
    if (this._settingsOpen) {
      this._settingsOpen = false;
      this.audioManager.playButtonClick();
      return 'consumed';
    }
    if (this._announceOpen) {
      this._announceOpen = false;
      this.audioManager.playButtonClick();
      return 'consumed';
    }
    if (this._accountOpen) {
      this._accountOpen = false;
      this.audioManager.playButtonClick();
      return 'consumed';
    }
    switch (this.screenState) {
      case 'lobby':
        return 'none';
      case 'playing': {
        if (this.gameStatus !== 'playing') {
          // 战斗结算界面 → 返回大厅（与结算点击行为一致）
          this.audioManager.playButtonClick();
          this.screenState = 'lobby';
          return 'consumed';
        }
        // 战斗进行中 → 保持页面（暂停功能已移除：返回键不呼暂停菜单，仅挡退出）
        return 'keep';
      }
      case 'deploy_select':
        // 子面板优先：兵种详情 → 建筑详情 → 羁绊详情 → 招募面板 → 返回大厅
        if (this._unitDetailId) { this._unitDetailId = null; return 'consumed'; }
        if (this._buildingDetailType) { this._buildingDetailType = null; return 'consumed'; }
        if (this._synergyDetailId) { this._synergyDetailId = null; return 'consumed'; }
        if (this._showRecruitPanel) { this._showRecruitPanel = false; return 'consumed'; }
        this.audioManager.playButtonClick();
        this.screenState = 'lobby';
        return 'consumed';
      case 'gacha':
        // 翻卡结果展示中 → 先关闭结果
        if (this._gachaResults && this._gachaResults.length > 0) {
          this._gachaResults = null;
          this._gachaRevealIdx = 0;
          return 'consumed';
        }
        this.audioManager.playButtonClick();
        this.screenState = 'lobby';
        return 'consumed';
      case 'shop':
      case 'tech_panel':
      case 'leaderboard':
      case 'quest':
      case 'achievement':
      case 'battle_pass':
        this.audioManager.playButtonClick();
        this.screenState = 'lobby';
        return 'consumed';
      default:
        return 'none';
    }
  }

  /**
   * 初始化系统返回键支持
   * 浏览器环境：挂 history 占位层 + popstate——后退键先触发 tryBack 关闭界面；
   * 战斗类返回（keep）推回占位层保持页面；主大厅（none）放行浏览器正常退出。
   * 微信小游戏：Android 返回键由 game.js 监听 wx.onKeyDown 调用 tryBack。
   */
  _initBackHandler() {
    if (typeof window === 'undefined' || !window.history || !window.addEventListener) return;
    this._backEnabled = true;
    this._lastLayerActive = false;
    this._onPopState = () => {
      const result = this.tryBack();
      if (result === 'keep') {
        // 战斗暂停/继续：占位层已被浏览器消费，推回保持页面不退出
        try { window.history.pushState({ tk: 1 }, ''); } catch (err) { /* 忽略 */ }
      }
      // 'consumed'：界面已关闭，占位层自然消费（栈回到初始层）
      // 'none'：主大厅，放行浏览器正常退出
    };
    window.addEventListener('popstate', this._onPopState);
  }

  /**
   * 统一屏幕点击处理(根据屏幕状态分发)
   */
  handleScreenClick(screenX, screenY) {
    // P38：新手引导激活时，遮罩（高亮区以外）的点击一律吞掉。
    // 之前引导只在大厅分支里做了「未命中就提示」，其它界面/路径根本没挡，
    // 表现为「黑色遮罩能点到后面的按钮」。这里统一在最前面收口。
    if (this._interceptTutorialClick(screenX, screenY)) return;
    // 异步匹配搜索中（大厅模态 overlay）：优先处理（取消按钮），屏蔽底层界面点击
    if (this._asyncState === 'searching') {
      this._handleMatchOverlayClick(screenX, screenY);
      return;
    }
    // 账号面板打开时优先处理并屏蔽底层界面点击
    if (this._accountOpen) {
      this._handleAccountTap(screenX, screenY);
      return;
    }
    // 设置/公告窗口打开时优先处理并屏蔽底层界面点击
    if (this._settingsOpen || this._announceOpen) {
      this._handleSettingsTap(screenX, screenY);
      return;
    }
    switch (this.screenState) {
      case 'lobby':
        this.handleLobbyClick(screenX, screenY);
        break;
      case 'playing':
        this.handlePlayingClick(screenX, screenY);
        break;
      case 'tech_panel':
        this.handleTechPanelClick(screenX, screenY);
        break;
      case 'shop':
        this.handleShopClick(screenX, screenY);
        break;
      case 'quest':
        this.handleQuestClick(screenX, screenY);
        break;
      case 'achievement':
        this.handleAchievementClick(screenX, screenY);
        break;
      case 'battle_pass':
        this.handleBattlePassClick(screenX, screenY);
        break;
      case 'gacha':
        this.handleGachaClick(screenX, screenY);
        break;
      case 'leaderboard':
        this.handleLeaderboardClick(screenX, screenY);
        break;
    }
  }

  /**
   * 上阵选择界面点击
   * 玩家在战斗前安排兵种/羁绊上阵
   */
  // === 上阵界面布局常量 ===
  /** 长按激活拖拽的时长（ms），从按下起持续超过该时长即拿起 */
  static get DEPLOY_LONG_PRESS_MS() { return 200; }

  // === 上阵界面布局 ===
  // P36：垂直锚点（slot/synergy/building/unit 的 y 与 labelY）与横排宽度全部由
  // RenderSystem.deployLayout(w, h) 统一算出，渲染与命中共用同一份，禁止各自硬编码
  // （P33 曾因两边硬编码不同步导致点击错位）。下面两个静态方法仅为兼容旧调用保留。
  static deployLayoutOf(screenW, screenH) {
    return RenderSystem.deployLayout(screenW, screenH);
  }

  /** @deprecated 请用 RenderSystem.deployLayout(w, h).slot.w */
  static deployUnitSlotW(screenW) {
    return RenderSystem.deployLayout(screenW, 844).slot.w;
  }
  /** @deprecated 请用 RenderSystem.deployLayout(w, h).unit.w */
  static deployUnitCardW(screenW) {
    return RenderSystem.deployLayout(screenW, 844).unit.w;
  }
  // 注：deploySynSlotW / deploySynCardW 已废弃（2026-09-09 改造：羁绊自动派生，无须 slot/card 布局）

  // === 大厅布局常量（handleLobbyClick 与 RenderSystem.drawLobby 同源使用） ===
  // P9：row.w / nav.w / battle.w 不再用静态数值，而是按屏宽动态计算（见下方静态方法）
  // LOBBY_LAYOUT 仍保留 row/ nav/ battle 对象，但 .w 字段仅作「设计稿参考值」，
  // 运行时命中框全部通过 lobbyRowItemW / lobbyNavItemW / battleBtnW 三个静态方法取值
  static get LOBBY_LAYOUT() {
    return {
      // 功能按钮行（战力下方）：分享 / 任务 / 成就 [+通行证]
      // P25：battlePass=false 时 count=3，lobbyRowItemW 用 lobbyRowItemWByCount(3, screenW)
      //   battlePass=true 时 count=4，lobbyRowItemW 用 lobbyRowItemWByCount(4, screenW)
      //   默认值仍为 4（向后兼容无 features 配置的旧版本）
      row: { w: LAYOUT_DESIGN_MAX.lobbyRow, h: 40, gap: 8, y: 262, count: 4 },
      // 开战按钮（底部导航上方）：使用当前布阵直接开战
      battle: { w: LAYOUT_DESIGN_MAX.battle, h: 58, yOffset: 150 },
      // 底部导航：商店 / 招募 / 布阵 / 科技 / 排行榜
      nav: { w: LAYOUT_DESIGN_MAX.lobbyNav, h: 56, gap: 6, count: 5 },
      // 天梯区：大段位徽章 + 奖杯文字 + 段位进度条（进度条在徽章下方，P20）
      // badgeR/barH 仅作设计稿参考值；运行时坐标由 Layout.ladderCombo 统一计算
      ladder: { barH: 20, barGap: 34, badgeR: 54 },
    };
  }

  /** 功能按钮行单按钮自适应宽（按 count 动态） */
  static lobbyRowItemWByCount(count, screenW) {
    return rowItemWidth(count, 8, screenW, 8, LAYOUT_MIN.lobbyRow, LAYOUT_DESIGN_MAX.lobbyRow);
  }
  /** 功能按钮行单按钮自适应宽（跟随 features.battlePass 决定 count，渲染与点击同源） */
  static lobbyRowItemW(screenW) {
    return Game.lobbyRowItemWByCount(Game.lobbyRowCount(), screenW);
  }
  /** 底部 nav 单按钮自适应宽 */
  static lobbyNavItemW(screenW) {
    return rowItemWidth(5, 6, screenW, 8, LAYOUT_MIN.lobbyNav, LAYOUT_DESIGN_MAX.lobbyNav);
  }
  /** 开战按钮自适应宽（padX=16 表示左右各 16，屏宽够大时维持设计稿 220） */
  static battleBtnW(screenW) {
    return rowItemWidth(1, 0, screenW, 16, LAYOUT_MIN.battle, LAYOUT_DESIGN_MAX.battle);
  }

  /** 功能按钮行当前实际 count（依 features.battlePass 决定，4=含通行证/3=折叠） */
  static lobbyRowCount() {
    const _features = ConfigLoader.getSafe('game')?.features || {};
    return _features.battlePass !== false ? 4 : 3;
  }

  /** 功能按钮行第 i 个按钮的 X（跟随 features.battlePass 决定 count，渲染与点击同源） */
  static lobbyRowX(i, screenW) {
    return Game.lobbyRowXByCount(i, Game.lobbyRowCount(), screenW);
  }

  /** 功能按钮行第 i 个按钮的 X（指定 count，count=3 用于折叠通行证场景） */
  static lobbyRowXByCount(i, count, screenW) {
    const r = Game.LOBBY_LAYOUT.row;
    const w = Game.lobbyRowItemWByCount(count, screenW);
    return (screenW - (count * w + (count - 1) * r.gap)) / 2 + i * (w + r.gap);
  }

  /** 段位组合单元布局（大徽章 + 奖杯文字 + 进度条，整体居中，P20） */
  static lobbyLadderCombo(screenH) {
    const row = Game.LOBBY_LAYOUT.row;
    return ladderCombo(row.y + row.h, Game.lobbyBattleY(screenH));
  }

  /** 段位进度条 Y（徽章下方，跟随徽章） */
  static lobbyLadderBarY(screenH) {
    return Game.lobbyLadderCombo(screenH).barY;
  }

  /** 大段位徽章中心 Y */
  static lobbyBadgeY(screenH) {
    return Game.lobbyLadderCombo(screenH).badgeY;
  }

  /** 大段位徽章半径 */
  static lobbyBadgeRadius(screenH) {
    return Game.lobbyLadderCombo(screenH).badgeR;
  }

  /** 段位进度条宽度（居中，长度随屏宽自适应） */
  static lobbyLadderBarWidth(screenW) {
    return ladderBarWidth(screenW);
  }

  /** 底部导航 Y */
  static lobbyNavY(screenH) { return screenH - 72; }

  /** 底部导航第 i 个按钮的 X（按当前屏宽动态计算） */
  static lobbyNavX(i, screenW) {
    const n = Game.LOBBY_LAYOUT.nav;
    const w = Game.lobbyNavItemW(screenW);
    return (screenW - (n.count * w + (n.count - 1) * n.gap)) / 2 + i * (w + n.gap);
  }

  /** 开战按钮 Y（导航栏上方） */
  static lobbyBattleY(screenH) {
    return screenH - Game.LOBBY_LAYOUT.battle.yOffset;
  }

  /** 返回按钮（左下角）布局常量：距左 16、距底 16，宽 80 高 35（P16，与 RenderSystem._drawBackButton 同源） */
  static get BACK_BUTTON() {
    return { x: 16, w: 80, h: 35, bottomOffset: 16 };
  }

  /** 返回按钮命中判定（左下角，所有子界面共用） */
  static isBackButtonHit(x, y, screenH) {
    const b = Game.BACK_BUTTON;
    return x >= b.x && x <= b.x + b.w &&
           y >= screenH - b.bottomOffset - b.h && y <= screenH - b.bottomOffset;
  }

  /** 滚动列表可见区底部边界 Y（与 RenderSystem._beginScrollClip 底部裁剪同源：返回按钮顶部再留 8px） */
  static scrollViewportBottom(screenH) {
    const b = Game.BACK_BUTTON;
    return screenH - b.bottomOffset - b.h - 8;
  }

  // === 设置窗口布局常量（_handleSettingsTap 与 RenderSystem._drawSettingsOverlay 同源使用） ===
  static get SETTINGS_LAYOUT() {
    return {
      panelW: 290,
      panelH: 316,
      rowW: 232,
      rowH: 44,
      rowGap: 14,
      rowStartOffset: 64, // 面板顶到第一行的距离（含标题）
      closeSize: 30,
    };
  }

  /** 设置窗口面板矩形（居中） */
  static settingsPanel(screenW, screenH) {
    const L = Game.SETTINGS_LAYOUT;
    return {
      x: (screenW - L.panelW) / 2,
      y: (screenH - L.panelH) / 2,
      w: L.panelW,
      h: L.panelH,
    };
  }

  /** 设置窗口第 i 行按钮矩形（0=音效 1=音乐 2=震动 3=公告） */
  static settingsRowRect(i, screenW, screenH) {
    const L = Game.SETTINGS_LAYOUT;
    const p = Game.settingsPanel(screenW, screenH);
    return {
      x: (screenW - L.rowW) / 2,
      y: p.y + L.rowStartOffset + i * (L.rowH + L.rowGap),
      w: L.rowW,
      h: L.rowH,
    };
  }

  /** 设置窗口关闭按钮矩形（面板右上角） */
  static settingsCloseRect(screenW, screenH) {
    const L = Game.SETTINGS_LAYOUT;
    const p = Game.settingsPanel(screenW, screenH);
    return { x: p.x + p.w - L.closeSize - 8, y: p.y + 8, w: L.closeSize, h: L.closeSize };
  }

  // === 账号面板布局常量（_handleAccountTap 与 RenderSystem._drawAccountOverlay 同源使用） ===
  static get ACCOUNT_LAYOUT() {
    return {
      panelW: 300,
      panelH: 340,
      rowH: 46,
      rowGap: 8,
      rowStartOffset: 54, // 面板顶到第一行账号的距离（含标题）
      maxRows: 3,         // 账号列表最多显示行数（超出截断，提示见绘制）
      btnH: 46,
      btnGap: 8,
      closeSize: 30,
    };
  }

  /** 账号面板矩形（居中） */
  static accountPanel(screenW, screenH) {
    const L = Game.ACCOUNT_LAYOUT;
    return { x: (screenW - L.panelW) / 2, y: (screenH - L.panelH) / 2, w: L.panelW, h: L.panelH };
  }

  /** 账号面板第 i 行矩形 */
  static accountRowRect(i, screenW, screenH) {
    const L = Game.ACCOUNT_LAYOUT;
    const p = Game.accountPanel(screenW, screenH);
    return { x: p.x + 12, y: p.y + L.rowStartOffset + i * (L.rowH + L.rowGap), w: p.w - 24, h: L.rowH };
  }

  /** 账号行内「删除」小按钮矩形（非当前账号，右上角） */
  static accountRowDeleteRect(i, screenW, screenH) {
    const r = Game.accountRowRect(i, screenW, screenH);
    return { x: r.x + r.w - 32, y: r.y + (r.h - 28) / 2, w: 28, h: 28 };
  }

  /** 「登录新账号」按钮矩形 */
  static accountLoginRect(screenW, screenH) {
    const L = Game.ACCOUNT_LAYOUT;
    const p = Game.accountPanel(screenW, screenH);
    const y = p.y + L.rowStartOffset + L.maxRows * (L.rowH + L.rowGap) + L.btnGap;
    return { x: p.x + 16, y, w: p.w - 32, h: L.btnH };
  }

  /** 「注销当前账号」按钮矩形 */
  static accountLogoutRect(screenW, screenH) {
    const L = Game.ACCOUNT_LAYOUT;
    const p = Game.accountPanel(screenW, screenH);
    const y = p.y + L.rowStartOffset + L.maxRows * (L.rowH + L.rowGap) + L.btnGap + L.btnH + L.btnGap;
    return { x: p.x + 16, y, w: p.w - 32, h: L.btnH };
  }

  /** 账号面板关闭按钮矩形（右上角） */
  static accountCloseRect(screenW, screenH) {
    const L = Game.ACCOUNT_LAYOUT;
    const p = Game.accountPanel(screenW, screenH);
    return { x: p.x + p.w - L.closeSize - 8, y: p.y + 8, w: L.closeSize, h: L.closeSize };
  }

  /** 公告内容（设置窗口 → 公告按钮查看） */
  static get ANNOUNCEMENTS() {
    return [
      {
        date: '2026-08-29',
        title: 'v1.8 天梯段位赛季上线',
        lines: [
          '🏆 8大段位：青铜→白银→黄金→铂金→钻石→大师→宗师→王者',
          '⚔ 胜利赢奖杯，失败扣奖杯（不扣货币），到段不跌段',
          '🎯 对手强度随奖杯匹配：低段练手，高段硬仗',
          '🎁 晋段一次性奖励 + 7天赛季结算，赛季末奖杯软重置',
          '🏅 排行榜新增「天梯榜」',
        ],
      },
      {
        date: '2026-08-29',
        title: 'v1.7 设置窗口上线',
        lines: [
          '右上角按钮升级为 ⚙ 设置窗口',
          '音效 / 背景音乐可独立开关并自动保存',
          '开战入口移至大厅「⚔ 开战」按钮',
        ],
      },
      {
        date: '2026-08-28',
        title: 'v1.6 布阵界面改版',
        lines: [
          '兵种卡显示品质外框与上阵角标',
          '羁绊列表固定显示，不随兵种列表滚动',
          '长按或按住拖动兵种卡即可拿起上阵',
        ],
      },
    ];
  }

  /**
   * 兵种卡列表起始 Y —— 紧贴自动羁绊预览面板下沿（2026-09-09 改造：羁绊不再占独立行数）
   * （渲染与点击共用，保证布局同源）
   */
  static deployUnitListY(_synCount, screenW = 390, screenH = 844) {
    return RenderSystem.deployLayout(screenW, screenH).unit.listY;
  }

  /**
   * 上阵界面触摸按下
   * - 兵种槽位/羁绊槽位/建筑区/羁绊列表：固定区，无拖拽不滚动，轻点在 DragEnd 中开详情
   * - 兵种卡（未上阵）：记录长按候选，DEPLOY_LONG_PRESS_MS 后激活拖拽；按住并移动超阈值也立即拿起
   * - 已上阵兵种卡：不可拖拽（轻点仍可查看详情，换位请用详情内「上阵」按钮）
   */
  _handleDeployDragStart(x, y) {
    // P38：引导激活时遮罩不可穿透 —— 除高亮区外禁止长按/拖拽拿起卡片
    if (this._interceptTutorialClick(x, y)) {
      this._cancelDeployPress();
      this._deployDrag.active = false;
      return;
    }
    // 如果招募面板打开，不处理拖拽
    if (this._showRecruitPanel) return;
    // 如果详情面板打开，不处理拖拽
    if (this._unitDetailId) return;
    if (this._buildingDetailType) return;
    if (this._synergyDetailId) return;

    const layout = RenderSystem.deployLayout(this.screenWidth, this.screenHeight);
    const w = this.screenWidth;
    const profile = ProfileManager.get();
    const unitListY = layout.unit.listY;

    // === 固定区（兵种槽位/羁绊槽位/建筑强化/羁绊列表）：不产生拖拽候选，不参与滚动 ===
    if (y < unitListY - 20) {
      return;
    }

    // === 可滚动区：兵种卡列表 ===
    this._lastDeployY = y; // 用于滚动计算
    const scrollY = this.metaScrollY || 0;
    if (profile) {
      const collected = DeploymentSystem.getCollectedUnitList();
      const deployed = profile?.deployment?.units || [];
      const card = layout.unit;
      const cardStartX = (w - (card.perRow * card.w + (card.perRow - 1) * card.gap)) / 2;
      for (let i = 0; i < collected.length; i++) {
        const col = i % card.perRow;
        const row = Math.floor(i / card.perRow);
        const cx = cardStartX + col * (card.w + card.gap);
        const cy = unitListY + row * (card.h + card.gap) - scrollY;
        if (x >= cx && x <= cx + card.w && y >= cy && y <= cy + card.h) {
          // 已上阵的兵种不可拖拽（换位请打开详情用「上阵」按钮）
          if (!deployed.includes(collected[i].id)) {
            this._startDeployPress({ type: 'unit', id: collected[i].id, fromSlot: -1, x, y });
          }
          return;
        }
      }
    }
  }

  /**
   * 启动长按候选：按住 DEPLOY_LONG_PRESS_MS 后激活拖拽；
   * 期间松手取消候选；按住并移动超过阈值 → 立即激活拖拽（按住拖拽也可拿起）
   */
  _startDeployPress(press) {
    this._deployPress = press;
    this._deployPressTimer = setTimeout(() => {
      this._deployPressTimer = null;
      this._activateDeployDrag();
    }, Game.DEPLOY_LONG_PRESS_MS);
  }

  /**
   * 激活拖拽（长按到时 / 按住移动超阈值 两条路径共用）
   */
  _activateDeployDrag() {
    if (!this._deployPress) return;
    this._deployDrag = {
      active: true,
      type: this._deployPress.type,
      id: this._deployPress.id,
      fromSlot: this._deployPress.fromSlot,
      x: this._deployPress.x,
      y: this._deployPress.y,
    };
    this._deployPress = null;
    this._lastDeployY = null; // 拖拽期间不参与列表滚动
    this.audioManager.playButtonClick(); // 「拿起」反馈
    this.showToast('已拿起 ⬆ 拖到槽位后松开', 0.8);
  }

  /**
   * 取消长按候选（松手/移动/离开界面时调用）
   */
  _cancelDeployPress() {
    if (this._deployPressTimer) {
      clearTimeout(this._deployPressTimer);
      this._deployPressTimer = null;
    }
    this._deployPress = null;
  }

  /**
   * 上阵界面拖拽移动
   */
  _handleDeployDragMove(x, y) {
    // 长按未激活前移动超过10px → 立即拿起（按住拖拽也可上阵）；
    // 列表滚动仅从卡片间隙/空白处起手触发
    if (this._deployPress && !this._deployDrag.active) {
      const dx = Math.abs(x - this._deployPress.x);
      const dy = Math.abs(y - this._deployPress.y);
      if (dx > 10 || dy > 10) {
        if (this._deployPressTimer) {
          clearTimeout(this._deployPressTimer);
          this._deployPressTimer = null;
        }
        this._activateDeployDrag();
      }
    }
    if (this._deployDrag.active) {
      this._deployDrag.x = x;
      this._deployDrag.y = y;
    } else if (this._lastDeployY != null) {
      // 没有激活的拖拽 → 滚动列表
      const dy = y - this._lastDeployY;
      this.metaScrollY = Math.max(0, this.metaScrollY - dy); // 上滑 dy<0 → scrollY 增 → 内容上移
    }
    this._lastDeployY = y;
  }

  /**
   * 上阵界面拖拽结束/点击
   */
  _handleDeployDragEnd(x, y, isDrag) {
    // P38：引导激活时遮罩不可穿透 —— 除高亮区外禁止点击（返回按钮即高亮区，可正常点）
    if (this._interceptTutorialClick(x, y)) {
      this._deployDrag.active = false;
      return;
    }
    this._lastDeployY = null;
    // 松手时取消未触发的长按计时器
    this._cancelDeployPress();
    const w = this.screenWidth;
    const h = this.screenHeight;
    const layout = RenderSystem.deployLayout(w, h);

    // 详情面板打开时，所有点击交给详情面板处理
    if (this._buildingDetailType) {
      this._handleBuildingDetailTap(x, y);
      return;
    }
    if (this._synergyDetailId) {
      this._handleSynergyDetailTap(x, y);
      return;
    }
    if (this._unitDetailId) {
      this._handleUnitDetailTap(x, y);
      return;
    }

    // 招募面板打开时，所有点击交给招募面板处理
    // 注意：不检查 isDrag，因为触摸屏上手指轻触很容易超过3px阈值被误判为拖拽，
    // 导致招募面板内的所有点击（兵种卡片、关闭按钮）永远无法触发
    if (this._showRecruitPanel) {
      this._handleRecruitPanelTap(x, y);
      return;
    }

    // 只要长按拿起了拖拽，松手一律按「拖拽放置」处理（不看 isDrag）：
    // 手指没怎么移动时 InputSystem 会判定为点击，若落入点击分支会在原位误开详情
    if (this._deployDrag.active) {
      // === 拖拽放置 ===
      const drag = this._deployDrag;

      if (drag.type === 'unit') {
        // 检查是否放在兵种槽位上
        // P36：槽位几何与 RenderSystem.drawDeploySelect 同源（避免命中框与渲染位置错位）
        const uslot = layout.slot;
        const uStartX = (w - (uslot.count * uslot.w + (uslot.count - 1) * uslot.gap)) / 2;
        for (let i = 0; i < uslot.count; i++) {
          const sx = uStartX + i * (uslot.w + uslot.gap);
          if (x >= sx && x <= sx + uslot.w && y >= uslot.y && y <= uslot.y + uslot.h) {
            // 放到槽位 i
            const result = DeploymentSystem.setDeployedUnit(i, drag.id);
      this._invalidateDeploymentBundle(); // P35：羁绊预览需重新派生
            if (!result.success) {
              this.showToast(result.reason || '无法上阵', 1.5);
            } else {
              this.audioManager.playButtonClick();
            }
            this._deployDrag.active = false;
            return;
          }
        }
        // 没有放在槽位上 → 视为「放回原处」，不触发点击、不弹详情
        // （从槽位拖出但不放在另一个槽位上，保持原样）
      }
      // 注：羁绊不再支持拖拽，上阵/卸下/换位在羁绊详情面板内操作

      this._deployDrag.active = false;
      return;
    }

    // === 滚动手势（有移动但未长按拿起）→ 不触发点击，避免滚动误开详情 ===
    if (isDrag) {
      this._deployDrag.active = false;
      return;
    }

    // === 点击（非拖拽）===
    // 点击意味着没有进行中的拖拽，复位拖拽状态（避免虚影残留）
    this._deployDrag.active = false;

    // 返回按钮
    if (Game.isBackButtonHit(x, y, h)) {
      this.audioManager.playButtonClick();
      this.screenState = 'lobby';
      // 新手引导第2步：从布阵界面返回 → 进入大厅第3步（高亮开战）
      const tProf = ProfileManager.get();
      if (tProf && tProf.tutorialStep === 1) {
        tProf.tutorialStep = 2;
        ProfileManager.save();
      }
      return;
    }

    // 注：开始对战入口已移至大厅「开战」按钮，本界面只做布阵

    // 点击已上阵的兵种槽位 → 打开该兵种详情（槽位不可拖拽，替换请长按兵种卡拖入或详情内上阵）
    const clickProfile = ProfileManager.get();
    const uslotClick = layout.slot;
    const uClickStartX = (w - (uslotClick.count * uslotClick.w + (uslotClick.count - 1) * uslotClick.gap)) / 2;
    for (let i = 0; i < uslotClick.count; i++) {
      const sx = uClickStartX + i * (uslotClick.w + uslotClick.gap);
      if (x >= sx && x <= sx + uslotClick.w && y >= uslotClick.y && y <= uslotClick.y + uslotClick.h) {
        const unitId = clickProfile?.deployment?.units?.[i];
        if (unitId) this._openUnitDetail(unitId);
        return;
      }
    }

    // P35: 点击羁绊卡 → 打开羁绊详情面板（激活方式 + 各级效果）
    // 卡片几何与 RenderSystem.autoSynergyCardLayout 同源
    {
      const apc = layout.synergy;
      const synList = SynergySystem.getAutoSynergyPanelData(this.deploymentBundle);
      for (let i = 0; i < apc.count; i++) {
        const sx = apc.startX + i * (apc.size + apc.gap);
        if (x >= sx && x <= sx + apc.size && y >= apc.y && y <= apc.y + apc.size) {
          const syn = synList[i];
          if (syn) this._openSynergyDetail(syn.id);
          return;
        }
      }
    }

    // 点击建筑强化卡 → 打开建筑详情/升级面板(P33: 复用 _unitDetailId 同套机制)
    const bldSlotW = layout.building.w, bldSlotH = layout.building.h, bldGap = layout.building.gap;
    const bldStartX = (w - (3 * bldSlotW + 2 * bldGap)) / 2;
    const bldSlotY = layout.building.y;
    const bldKeysArr = ['barracks', 'arrow_tower', 'gold_mine'];
    for (let i = 0; i < 3; i++) {
      const bldType = bldKeysArr[i];
      const sx = bldStartX + i * (bldSlotW + bldGap);
      if (x >= sx && x <= sx + bldSlotW && y >= bldSlotY && y <= bldSlotY + bldSlotH) {
        this._openBuildingDetail(bldType);
        return;
      }
    }

    // 点击兵种卡(可滚动区) → 打开详情/升级面板
    const scrollY = this.metaScrollY || 0;
    const card = layout.unit;
    const collected = DeploymentSystem.getCollectedUnitList();
    const unitListY = layout.unit.listY;
    const cardStartX = (w - (card.perRow * card.w + (card.perRow - 1) * card.gap)) / 2;
    for (let i = 0; i < collected.length; i++) {
      const col = i % card.perRow;
      const row = Math.floor(i / card.perRow);
      const cx = cardStartX + col * (card.w + card.gap);
      const cy = unitListY + row * (card.h + card.gap) - scrollY;
      if (x >= cx && x <= cx + card.w && y >= cy && y <= cy + card.h) {
        this._openUnitDetail(collected[i].id);
        return;
      }
    }
  }

  /**
   * 打开建筑详情/升级面板(P33)
   * 复用 _unitDetailId 同套机制：字段+面板+点击+gameState
   */
  _openBuildingDetail(bldType) {
    this._buildingDetailType = bldType;
    if (this.audioManager) this.audioManager.playButtonClick();
  }

  /**
   * 建筑详情面板点击处理：关闭 / 升级 / 遮罩关闭
   * 面板布局与 _drawBuildingDetailPanel 共享 RenderSystem.buildingDetailPanelLayout
   */
  _handleBuildingDetailTap(x, y) {
    const w = this.screenWidth;
    const h = this.screenHeight;
    const { panelW, panelH, panelX, panelY } = RenderSystem.buildingDetailPanelLayout(w, h);

    // 关闭按钮
    const closeBtnX = panelX + panelW - 35, closeBtnY = panelY + 5, closeBtnSize = 30;
    if (x >= closeBtnX && x <= closeBtnX + closeBtnSize &&
        y >= closeBtnY && y <= closeBtnY + closeBtnSize) {
      this._buildingDetailType = null;
      if (this.audioManager) this.audioManager.playButtonClick();
      return;
    }

    // 背景遮罩点击(关闭面板)
    if (x < panelX || x > panelX + panelW || y < panelY || y > panelY + panelH) {
      this._buildingDetailType = null;
      return;
    }

    // 升级按钮(面板底部居中，命中区由 buildingDetailPanelLayout 统一给出)
    const { btnX, btnY, btnW, btnH } = RenderSystem.buildingDetailPanelLayout(w, h);
    if (x >= btnX && x <= btnX + btnW && y >= btnY && y <= btnY + btnH) {
      const result = DeploymentSystem.upgradeBuilding(this._buildingDetailType);
      this._invalidateDeploymentBundle(); // P35：羁绊预览需重新派生
      if (result.success) {
        if (this.audioManager) this.audioManager.playButtonClick();
        this.showToast(`升级成功 Lv.${result.newLevel}`, 1.5);
      } else {
        this.showToast(result.reason || '升级失败', 1.8);
      }
      return;
    }
  }

  /**
   * 布阵界面需要 deploymentBundle 做羁绊预览
   * 战斗中由 initLevel 注入；布阵界面不在战斗中，此处按需生成（P35）
   */
  _ensureDeploymentBundle() {
    if (!this.deploymentBundle) this.deploymentBundle = DeploymentSystem.generateBundle();
    return this.deploymentBundle;
  }

  /**
   * 上阵/升级/抽卡等养成变更后调用 → 下一帧重新生成 bundle（羁绊预览同步刷新）
   */
  _invalidateDeploymentBundle() {
    this.deploymentBundle = null;
  }

  /**
   * 打开羁绊详情面板(P35)
   * 内容与渲染由 SynergySystem.getSynergyDetail + RenderSystem._drawSynergyDetailPanel 提供
   */
  _openSynergyDetail(synergyId) {
    this._synergyDetailId = synergyId;
    if (this.audioManager) this.audioManager.playButtonClick();
  }

  /**
   * 羁绊详情面板点击处理：关闭按钮 / 遮罩关闭（面板内无交互按钮）
   */
  _handleSynergyDetailTap(x, y) {
    const w = this.screenWidth;
    const h = this.screenHeight;
    const { panelW, panelH, panelX, panelY } = RenderSystem.synergyDetailPanelLayout(w, h);

    // 关闭按钮
    const closeBtnX = panelX + panelW - 35, closeBtnY = panelY + 5, closeBtnSize = 30;
    if (x >= closeBtnX && x <= closeBtnX + closeBtnSize &&
        y >= closeBtnY && y <= closeBtnY + closeBtnSize) {
      this._synergyDetailId = null;
      if (this.audioManager) this.audioManager.playButtonClick();
      return;
    }

    // 点击面板外遮罩 → 关闭
    if (x < panelX || x > panelX + panelW || y < panelY || y > panelY + panelH) {
      this._synergyDetailId = null;
      return;
    }
  }

  /**
   * 打开兵种详情/升级面板
   */
  _openUnitDetail(unitId) {
    this._unitDetailId = unitId;
    this.audioManager.playButtonClick();
  }

  /**
   * 兵种详情面板点击处理
   */
  _handleUnitDetailTap(x, y) {
    const w = this.screenWidth;
    const h = this.screenHeight;

    // 面板尺寸（与 RenderSystem._drawUnitDetailPanel 共享 unitDetailPanelLayout）
    const { panelW, panelH, panelX, panelY } = RenderSystem.unitDetailPanelLayout(w, h);

    // 关闭按钮
    const closeBtnX = panelX + panelW - 35, closeBtnY = panelY + 5, closeBtnSize = 30;
    if (x >= closeBtnX && x <= closeBtnX + closeBtnSize &&
        y >= closeBtnY && y <= closeBtnY + closeBtnSize) {
      this._unitDetailId = null;
      this.audioManager.playButtonClick();
      return;
    }

    // 背景遮罩点击（关闭面板）
    if (x < panelX || x > panelX + panelW || y < panelY || y > panelY + panelH) {
      this._unitDetailId = null;
      return;
    }

    // === 底部按钮区（与 _drawUnitDetailPanel 布局一致）：上阵（左） + 升级（右） ===
    const btnH = 38;
    const btnY = panelY + panelH - 50;
    const btnGap = 10;
    const btnW = (panelW - 40 - btnGap) / 2;
    const deployBtnX = panelX + 20;
    const upgradeBtnX = deployBtnX + btnW + btnGap;

    // 上阵按钮（左）
    if (x >= deployBtnX && x <= deployBtnX + btnW && y >= btnY && y <= btnY + btnH) {
      const profile = ProfileManager.get();
      const deployed = profile?.deployment?.units || [];
      if (deployed.includes(this._unitDetailId)) {
        this.audioManager.playButtonClick();
        this.showToast('该兵种已在阵上', 1.5);
      } else {
        let emptySlot = -1;
        for (let s = 0; s < 6; s++) {
          if (!deployed[s]) { emptySlot = s; break; }
        }
        if (emptySlot >= 0) {
          const result = DeploymentSystem.setDeployedUnit(emptySlot, this._unitDetailId);
      this._invalidateDeploymentBundle(); // P35：羁绊预览需重新派生
          if (result.success) {
            this.audioManager.playButtonClick();
            this.showToast(`已上阵到 #${emptySlot + 1} 槽位`, 1.5);
          } else {
            this.showToast(result.reason || '无法上阵', 1.5);
          }
        } else {
          this.showToast('槽位已满，请返回拖拽替换', 1.5);
        }
      }
      return;
    }

    // 升级按钮（右）
    if (x >= upgradeBtnX && x <= upgradeBtnX + btnW && y >= btnY && y <= btnY + btnH) {
      const result = DeploymentSystem.upgradeUnit(this._unitDetailId);
      this._invalidateDeploymentBundle(); // P35：羁绊预览需重新派生
      if (result.success) {
        this.audioManager.playSynergy();
        this.animManager.flashScreen('#ffd700', 0.2);
        this.showToast(`升级成功！现在等级 ${result.newLevel}`, 2.0);
      } else {
        this.audioManager.playButtonClick();
        this.showToast(result.reason || '升级失败', 1.5);
      }
      return;
    }
  }

  /**
   * 招募面板点击处理
   */
  _handleRecruitPanelTap(x, y) {
    const w = this.screenWidth;
    const h = this.screenHeight;

    // 面板尺寸（与 RenderSystem._drawRecruitPanel 一致）
    const panelW = Math.min(w - 20, 340);
    const panelH = Math.min(h - 80, 460);
    const panelX = (w - panelW) / 2;
    const panelY = 50;

    // 关闭按钮（与渲染位置一致：panelX + panelW - 35, panelY + 5）
    const closeBtnX = panelX + panelW - 35, closeBtnY = panelY + 5, closeBtnSize = 30;
    if (x >= closeBtnX && x <= closeBtnX + closeBtnSize &&
        y >= closeBtnY && y <= closeBtnY + closeBtnSize) {
      this._showRecruitPanel = false;
      this.audioManager.playButtonClick();
      return;
    }

    // 背景遮罩点击（关闭面板）
    if (x < panelX || x > panelX + panelW || y < panelY || y > panelY + panelH) {
      this._showRecruitPanel = false;
      return;
    }

    // 兵种卡片点击 → 招募
    const recruitable = DeploymentSystem.getRecruitableUnits();
    const cardW = 140, cardH = 85, cardGap = 8;
    const cols = Math.floor((panelW - 20) / (cardW + cardGap));
    const listStartY = panelY + 50;  // 与 RenderSystem._drawRecruitPanel 渲染位置一致
    for (let i = 0; i < recruitable.length; i++) {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const cx = panelX + 10 + col * (cardW + cardGap);
      const cy = listStartY + row * (cardH + cardGap);
      if (x >= cx && x <= cx + cardW && y >= cy && y <= cy + cardH) {
        const unit = recruitable[i];
        const result = DeploymentSystem.unlockUnit(unit.id);
        if (result.success) {
          this.audioManager.playSynergy();
          this.animManager.flashScreen('#ffd700', 0.2);
          this.showToast(`成功招募 ${unit.name}！`, 2.0);
        } else {
          this.audioManager.playButtonClick();
          this.showToast(result.reason || '招募失败', 1.5);
        }
        return;
      }
    }
  }

  /**
   * 设置窗口点击（同时接管公告子窗口；打开期间屏蔽所有底层界面点击）
   * 布局与 RenderSystem._drawSettingsOverlay 通过 Game.SETTINGS_LAYOUT 同源
   */
  _handleSettingsTap(x, y) {
    const w = this.screenWidth;
    const h = this.screenHeight;

    // --- 公告子窗口：点关闭按钮或面板外任意处关闭 ---
    if (this._announceOpen) {
      const p = Game.settingsPanel(w, h);
      const cb = Game.settingsCloseRect(w, h);
      const insidePanel = x >= p.x && x <= p.x + p.w && y >= p.y && y <= p.y + p.h;
      if (!insidePanel || (x >= cb.x && x <= cb.x + cb.w && y >= cb.y && y <= cb.y + cb.h)) {
        this._announceOpen = false;
        this.audioManager.playButtonClick();
      }
      return;
    }

    // --- 设置窗口 ---
    const p = Game.settingsPanel(w, h);
    const cb = Game.settingsCloseRect(w, h);

    // 关闭按钮
    if (x >= cb.x && x <= cb.x + cb.w && y >= cb.y && y <= cb.y + cb.h) {
      this._settingsOpen = false;
      this.audioManager.playButtonClick();
      return;
    }
    // 点击面板外 → 关闭
    if (x < p.x || x > p.x + p.w || y < p.y || y > p.y + p.h) {
      this._settingsOpen = false;
      return;
    }

    // 行按钮：0=音效开关 1=背景音乐开关 2=震动开关 3=公告
    for (let i = 0; i < 4; i++) {
      const r = Game.settingsRowRect(i, w, h);
      if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) {
        const profile = ProfileManager.get();
        if (!profile.settings) profile.settings = { sfx: true, bgm: true, haptic: true };
        if (i === 0) {
          const next = this.audioManager.setSfxEnabled(!this.audioManager.sfxEnabled);
          profile.settings.sfx = next;
          ProfileManager.save();
          this.showToast(next ? '🔔 音效已开启' : '🔕 音效已关闭', 1.2);
        } else if (i === 1) {
          const next = this.audioManager.setBgmEnabled(!this.audioManager.bgmEnabled);
          profile.settings.bgm = next;
          ProfileManager.save();
          this.showToast(next ? '🎵 背景音乐已开启' : '🚫 背景音乐已关闭', 1.2);
        } else if (i === 2) {
          this.audioManager.hapticEnabled = !this.audioManager.hapticEnabled;
          profile.settings.haptic = this.audioManager.hapticEnabled;
          ProfileManager.save();
          this.showToast(this.audioManager.hapticEnabled ? '📳 震动已开启' : '📴 震动已关闭', 1.2);
        } else {
          this.audioManager.playButtonClick();
          this._announceOpen = true;
        }
        return;
      }
    }
  }

  /**
   * 游戏中点击
   */
  handlePlayingClick(screenX, screenY) {
    // 对战结束后点击 → 返回大厅或再来一局
    // （放在最前：结算界面不应响应右上角暂停/设置按钮，避免失败后误触暂停再点"返回大厅"）
    if (this.gameStatus !== 'playing') {
      // 战绩分享按钮（结算界面中部，仅胜利时响应；失败不显示炫耀入口）
      if (this.gameStatus === 'won') {
        const cx = this.screenWidth / 2;
        const cy = this.screenHeight / 2;
        const sbW = 150, sbH = 34;
        const sbX = cx - sbW / 2, sbY = cy + 78;
        if (screenX >= sbX && screenX <= sbX + sbW &&
            screenY >= sbY && screenY <= sbY + sbH) {
          this.audioManager.playButtonClick();
          const enemy = this.players.find(p => p.id !== this.localPlayerId);
          const result = ShareSystem.shareAndReward({ scene: 'victory', enemyName: enemy ? enemy.name : '' });
          this.showToast(result.message, 2.5);
          return;
        }
      }

      this.audioManager.playButtonClick();
      // 无论胜利/失败 → 统一返回大厅
      this.screenState = 'lobby';
      return;
    }

    // 设置按钮(右上角) → 打开设置窗口（仅战斗中；暂停按钮已移除，⚙ 独占右上角）
    const muteBtnX = this.screenWidth - 95;
    const muteBtnY = 5;
    if (screenX >= muteBtnX && screenX <= muteBtnX + 40 &&
        screenY >= muteBtnY && screenY <= muteBtnY + 35) {
      this.audioManager.playButtonClick();
      this._settingsOpen = true;
      return;
    }

    // 屏幕坐标 → 世界坐标 → 六边形坐标
    const world = this.inputSystem.screenToWorld(screenX, screenY);
    const hexCoord = pixelToHex(world.x, world.y, this.map.size);
    const tile = this.map.getTile(hexCoord.q, hexCoord.r);

    if (!tile) return;

    // 真人局：翻格收口到命令队列（发帧 + 下一 tick drain 统一执行）

    const player = this.players.find(p => p.id === this.localPlayerId);
    this._executeFlip(tile, player);
  }

  /**
   * 执行翻格（直接执行与命令 apply 共用的统一入口）
   * @param {HexTile} tile
   * @param {Player} player
   * @returns {boolean} 是否成功开始翻转
   */
  _executeFlip(tile, player) {
    const success = BuildSystem.tryFlipTile(tile, player, this.map);
    if (!success) return false;

    this.flippingTiles.push(tile);
    this.audioManager.playFlip();

    // 仅本地玩家翻格触发这些副作用（震动/任务/新手引导）
    if (player.id === this.localPlayerId) {
      this.audioManager.vibrateLight();
      QuestSystem.trackEvent('tiles_flipped');
      QuestSystem.trackEvent('buildings_built');
      // 新手引导第4步：翻格成功 → 引导完成 + 奖励
      const tProf = ProfileManager.get();
      if (tProf && tProf.tutorialStep === 3) {
        tProf.tutorialStep = 4;
        ProfileManager.save();
        tProf.addCurrency('gold', 100);
        ProfileManager.save();
        this.showToast('新手引导完成！金币+100', 2.5);
        this.audioManager.playVictory();
      }
    }
    return true;
  }

  /**
   * 应用一条翻格命令（命令队列 drain 时逐条调用）
   * @param {{type:string, playerId:number, seq:number, payload:{q:number,r:number}}} cmd
   */
  handleLobbyClick(screenX, screenY) {
    const w = this.screenWidth;
    const h = this.screenHeight;

    // 新手引导（Phase 6 重做）：分步教学——step0 大厅高亮「⚔ 布阵」→ 进布阵界面；
    // step2 大厅高亮「⚔ 开战」→ 开战。step1/3 分别在布阵界面与战斗内处理。
    // tutorialStep：0-3 进行中，4+ 完成，-1 老玩家（跳过）
    const profile = ProfileManager.get();
    const tStep = profile ? (profile.tutorialStep || 0) : 4;
    if (profile && tStep >= 0 && tStep < 4) {
      if (tStep === 0) {
        // 第1步：点击「⚔ 布阵」（底部导航 index 2）
        const nav = Game.LOBBY_LAYOUT.nav;
        const navY = Game.lobbyNavY(h);
        const btnX = Game.lobbyNavX(2, w);
        const navItemW = Game.lobbyNavItemW(w);
        if (screenX >= btnX && screenX <= btnX + navItemW && screenY >= navY && screenY <= navY + nav.h) {
          this.audioManager.playButtonClick();
          profile.tutorialStep = 1;
          ProfileManager.save();
          this.metaScrollY = 0;
          this.screenState = 'deploy_select';
        } else {
          this.showToast('请点击高亮的「⚔ 布阵」按钮', 1.2);
        }
        return;
      }
      if (tStep === 2) {
        // 第3步：点击「⚔ 开战」
        const bl = Game.LOBBY_LAYOUT.battle;
        const blY = Game.lobbyBattleY(h);
        const blW = Game.battleBtnW(w);
        if (screenX >= (w - blW) / 2 && screenX <= (w + blW) / 2 &&
            screenY >= blY && screenY <= blY + bl.h) {
          this.audioManager.playButtonClick();
          profile.tutorialStep = 3;
          ProfileManager.save();
          this.initBattle();
        } else {
          this.showToast('请点击高亮的「⚔ 开战」按钮', 1.2);
        }
        return;
      }
      // tStep 为 1/3 但不在对应界面 → 防御性放行（不屏蔽，避免卡死）
    }

    // 设置按钮（右上角小图标）→ 打开设置窗口
    if (screenX >= w - 45 && screenX <= w - 10 &&
        screenY >= 10 && screenY <= 40) {
      this.audioManager.playButtonClick();
      this._settingsOpen = true;
      return;
    }

    // 玩家账号信息行（副标题下方，👤 昵称 · 账号尾号）→ 打开账号面板（登录/切换/注销）
    if (screenY >= 112 && screenY <= 138 &&
        screenX >= w / 2 - 140 && screenX <= w / 2 + 140) {
      this.audioManager.playButtonClick();
      this._accountOpen = true;
      return;
    }

    // === 功能按钮行（战力下方）：分享 / 任务 / 成就 [+通行证] ===
    // P25 features 开关：battlePass=false 时该入口完全折叠（count 4→3，i 最大 2）
    const _features2 = ConfigLoader.getSafe('game')?.features || {};
    const _battlePassEnabled2 = _features2.battlePass !== false;
    const row = Game.LOBBY_LAYOUT.row;
    const _rowCount = _battlePassEnabled2 ? 4 : 3;
    const _rowItemW = Game.lobbyRowItemWByCount(_rowCount, w);
    if (screenY >= row.y && screenY <= row.y + row.h) {
      for (let i = 0; i < _rowCount; i++) {
        const x = Game.lobbyRowXByCount(i, _rowCount, w);
        if (screenX >= x && screenX <= x + _rowItemW) {
          this.audioManager.playButtonClick();
          if (i === 0) {
            // 分享 + 每日奖励
            const result = ShareSystem.shareAndReward({ scene: 'lobby' });
            this.showToast(result.message, 2.5);
          } else if (i === 1) {
            // 任务
            this.metaScrollY = 0;
            QuestSystem.checkDailyRefresh();
            QuestSystem.checkWeeklyRefresh();
            QuestSystem.checkSeasonRefresh();
            this.screenState = 'quest';
          } else if (i === 2) {
            // 成就
            this.metaScrollY = 0;
            this.screenState = 'achievement';
          } else if (i === 3 && _battlePassEnabled2) {
            // 通行证（仅 battlePass=true 时才会进入此分支）
            this.metaScrollY = 0;
            this.screenState = 'battle_pass';
          }
          return;
        }
      }
    }

    // === 大段位徽章（功能行与进度条之间）：点击打开排行榜天梯榜 ===
    const badgeY = Game.lobbyBadgeY(h);
    const badgeR = Game.lobbyBadgeRadius(h);
    const bdx = screenX - w / 2;
    const bdy = screenY - badgeY;
    if (bdx * bdx + bdy * bdy <= badgeR * badgeR) {
      this.audioManager.playButtonClick();
      this.leaderboardTab = 0; // 天梯榜
      this.screenState = 'leaderboard';
      return;
    }

    // === 开战按钮（导航栏上方，居中唯一一级入口）：
    //   异步 PvP 匹配（2~4s 检索 → 快照对手）；10s 超时降级本地 AI 对局 ===
    const bl = Game.LOBBY_LAYOUT.battle;
    const blY = Game.lobbyBattleY(h);
    const blW = Game.battleBtnW(w);
    if (screenX >= (w - blW) / 2 && screenX <= (w + blW) / 2 &&
        screenY >= blY && screenY <= blY + bl.h) {
      this.audioManager.playButtonClick();
      this._startAsyncMatch();
      return;
    }

    // === 底部导航：商店 / 招募 / 布阵 / 科技 / 排行榜 ===
    // P25 features 开关：shop=false 时完全隐藏入口（功能行 4 项）；shopDiamondTab/battlePass 在各自页面内部控制分页可见性
    const _features = ConfigLoader.getSafe('game')?.features || {};
    const _shopEnabled = _features.shop !== false;
    const nav = Game.LOBBY_LAYOUT.nav;
    const navY = Game.lobbyNavY(h);
    const navItems = [];
    if (_shopEnabled) {
      navItems.push({ label: '🏪 商店', action: () => { this.metaScrollY = 0; this.shopTab = 0; this.screenState = 'shop'; } });
    }
    navItems.push({ label: '🎲 招募', action: () => { this.metaScrollY = 0; this._gachaResults = null; this._gachaRevealIdx = 0; this.screenState = 'gacha'; } });
    navItems.push({ label: '⚔ 布阵', action: () => { this.metaScrollY = 0; this.screenState = 'deploy_select'; } });
    navItems.push({ label: '🔬 科技', action: () => { this.metaScrollY = 0; this.screenState = 'tech_panel'; } });
    navItems.push({ label: '🏅 排行榜', action: () => { this.leaderboardTab = 0; this.screenState = 'leaderboard'; } });

    for (let i = 0; i < navItems.length; i++) {
      const x = Game.lobbyNavX(i, w);
      const navItemW = Game.lobbyNavItemW(w);
      if (screenX >= x && screenX <= x + navItemW &&
          screenY >= navY && screenY <= navY + nav.h) {
        this.audioManager.playButtonClick();
        navItems[i].action();
        return;
      }
    }
  }

  /**
   * 账号面板点击（登录 / 切换 / 注销 / 关闭）
   */
  _handleAccountTap(x, y) {
    const w = this.screenWidth;
    const h = this.screenHeight;
    const p = Game.accountPanel(w, h);
    const L = Game.ACCOUNT_LAYOUT;

    // 关闭按钮
    const cb = Game.accountCloseRect(w, h);
    if (x >= cb.x && x <= cb.x + cb.w && y >= cb.y && y <= cb.y + cb.h) {
      this._accountOpen = false;
      this.audioManager.playButtonClick();
      return;
    }
    // 点击面板外 → 关闭
    if (x < p.x || x > p.x + p.w || y < p.y || y > p.y + p.h) {
      this._accountOpen = false;
      return;
    }

    const list = AccountManager.list();
    const curId = AccountManager.getCurrentId();

    // 账号行：删除按钮优先，其次整行切换
    const rowCount = Math.min(list.length, L.maxRows);
    for (let i = 0; i < rowCount; i++) {
      const r = Game.accountRowRect(i, w, h);
      if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) {
        const acc = list[i];
        if (acc.id === curId) {
          this.showToast(`当前账号：${acc.nickname}`, 1.2);
          return;
        }
        // 行内删除按钮 → 注销该账号
        const del = Game.accountRowDeleteRect(i, w, h);
        if (x >= del.x && x <= del.x + del.w && y >= del.y && y <= del.y + del.h) {
          this.audioManager.playButtonClick();
          this._logoutAccount(acc.id);
          return;
        }
        // 整行 → 切换
        this.audioManager.playButtonClick();
        this._applyAccountSwitch(acc);
        return;
      }
    }

    // 「登录新账号」按钮
    const loginRect = Game.accountLoginRect(w, h);
    if (x >= loginRect.x && x <= loginRect.x + loginRect.w && y >= loginRect.y && y <= loginRect.y + loginRect.h) {
      this.audioManager.playButtonClick();
      this._loginNewAccount();
      return;
    }

    // 「注销当前账号」按钮
    const logoutRect = Game.accountLogoutRect(w, h);
    if (x >= logoutRect.x && x <= logoutRect.x + logoutRect.w && y >= logoutRect.y && y <= logoutRect.y + logoutRect.h) {
      this.audioManager.playButtonClick();
      this._logoutAccount(null);
      return;
    }
  }

  /**
   * 切换账号：保存当前档 → 切换指针 → 重载新账号状态
   */
  _applyAccountSwitch(acc) {
    if (!acc) return;
    ProfileManager.save(); // 落盘当前账号未保存改动
    AccountManager.switchTo(acc.id);
    this._reloadAccountState();
    this.showToast(`已切换账号：${acc.nickname}`, 1.6);
  }

  /**
   * 登录新账号：新建账号 + 空档 + 更新会话
   */
  _loginNewAccount() {
    ProfileManager.save();
    const acc = AccountManager.login();
    // 新账号空档：reset 会 save 到新账号命名空间 key；昵称对齐账号元数据
    ProfileManager.reset();
    ProfileManager.get().nickname = acc.nickname;
    ProfileManager.save();
    this._reloadAccountState();
    this.showToast(`✅ 已创建并登录新账号：${acc.nickname}`, 2);
  }

  /**
   * 注销账号：删除其数据；若注销的是当前账号 → 自动切到剩余账号并重载
   * @param {string|null} accountId null = 注销当前账号
   */
  _logoutAccount(accountId) {
    const currentId = AccountManager.getCurrentId();
    const wasCurrent = (accountId || currentId) === currentId;
    const removed = AccountManager.logout(accountId);
    if (!removed) return;
    if (wasCurrent) {
      this._reloadAccountState();
      this.showToast(`已注销「${removed.nickname}」，已切换账号`, 1.8);
    } else {
      this.showToast(`已注销「${removed.nickname}」`, 1.6);
    }
  }

  /**
   * 重载当前账号状态：profile + 会话 uid + 音频设置，并关闭面板
   */
  _reloadAccountState() {
    ProfileManager.load();
    this.syncProfile();
    if (this.sessionManager) {
      this.sessionManager.uid = AccountManager.getUID();
      this.sessionManager.token = null;
      this.sessionManager.openid = null;
    }
    const s = ProfileManager.get().settings || { sfx: true, bgm: true, haptic: true };
    this.audioManager.setSfxEnabled(s.sfx !== false);
    this.audioManager.setBgmEnabled(s.bgm !== false);
    this.audioManager.hapticEnabled = s.haptic !== false;
    this._accountOpen = false;
  }

  /**
   * 商店面板点击
   */
  handleShopClick(screenX, screenY) {
    // 返回按钮
    if (Game.isBackButtonHit(screenX, screenY, this.screenHeight)) {
      this.audioManager.playButtonClick();
      this.screenState = 'lobby';
      return;
    }

    // 分类标签（P37：与 drawShop 共用 shopLayout，5 个分页窄屏也不溢出）
    const cats = ShopSystem.getCategoryNames();
    const L = RenderSystem.shopLayout(this.screenWidth, cats.length);
    for (let i = 0; i < cats.length; i++) {
      const tx = L.tabStartX + i * (L.tabW + L.tabGap);
      if (screenX >= tx && screenX <= tx + L.tabW && screenY >= L.tabY && screenY <= L.tabY + L.tabH) {
        this.audioManager.playButtonClick();
        this.shopTab = i;
        this.metaScrollY = 0;
        return;
      }
    }

    // 商品列表点击（先裁底部：点击返回按钮下方空白区不误命中被裁剪的列表项）
    if (screenY > Game.scrollViewportBottom(this.screenHeight)) return;
    const items = ShopSystem.getShopItems();
    const cat = items[this.shopTab];
    if (!cat) return;
    const startY = RenderSystem.shopItemTop(0, this.metaScrollY, L);
    for (let i = 0; i < cat.items.length; i++) {
      const iy = startY + i * (L.itemH + L.gap);
      if (screenX >= L.cardX && screenX <= L.cardX + L.itemW && screenY >= iy && screenY <= iy + L.itemH) {
        const item = cat.items[i];
        // P37 免费栏位：首次直领，之后需看广告（异步流程）
        if (item.isFree) {
          this._handleShopFreeClaim(item);
          return;
        }
        if (item.canAfford && item.remaining !== 0) {
          const result = ShopSystem.purchase(item.id);
          if (result.success) {
            this.audioManager.playSynergy();
            this.animManager.flashScreen('#ffd700', 0.2);
          } else {
            this.audioManager.playButtonClick();
          }
        }
        return;
      }
    }
  }

  /**
   * P37 商店「免费」栏位领取
   *
   * 规则：
   *   - 每日首次点击 → 直接发放，不弹广告
   *   - 之后每次点击 → 必须看完激励视频（AdManager.showRewarded，isEnded=true）才发放
   *   - 每日次数用完 → 提示明日再来
   * 非真机环境（浏览器预览）无广告 API，降级为直接发放，保证可预览可自测。
   */
  async _handleShopFreeClaim(item) {
    if (!item || item.exhausted) {
      this.showToast('今日免费次数已用完，明天再来', 1.5);
      this.audioManager.playButtonClick();
      return;
    }

    if (item.needAd) {
      if (AdManager.isAvailable()) {
        if (!AdManager.canShowRewarded(item.adKey)) {
          this.showToast('广告暂不可用，请稍后再试', 1.5);
          this.audioManager.playButtonClick();
          return;
        }
        this.audioManager.playButtonClick();
        this.showToast('正在加载广告...', 1.0);
        const res = await AdManager.showRewarded(item.adKey);
        if (!res || !res.isEnded) {
          this.showToast(res && res.reason === 'closed' ? '需看完视频才能领取奖励' : '广告播放失败', 1.5);
          return;
        }
        // 看完了 → 记广告配额（在 purchase 落盘前修改，序列化会带新配额一起保存）
        const p = ProfileManager.get();
        if (p) {
          p.consumeAdQuota(item.adKey);
          ProfileManager.save();
        }
      }
      // 非真机（浏览器预览）：无广告 API，直接发放
    }

    // 广告门槛已在上面过完，adVerified=true 放行发放
    const result = ShopSystem.purchase(item.id, { adVerified: true });
    if (result.success) {
      this.audioManager.playSynergy();
      this.animManager.flashScreen('#ffd700', 0.2);
      const icons = { diamond: '💎', gold: '💰', stardust: '⭐' };
      const rw = Object.entries((result.reward && result.reward.currencies) || {})
        .map(([k, v]) => `${icons[k] || k}+${v}`).join(' ');
      this.showToast(`领取成功 ${rw}（今日 ${result.dailyClaimed}/${item.dailyLimit}）`, 1.5);
    } else {
      this.showToast(result.reason || '领取失败', 1.5);
      this.audioManager.playButtonClick();
    }
  }

  /**
   * 任务面板点击
   */
  handleQuestClick(screenX, screenY) {
    // 返回按钮
    if (Game.isBackButtonHit(screenX, screenY, this.screenHeight)) {
      this.audioManager.playButtonClick();
      this.screenState = 'lobby';
      return;
    }

    const dailyQuests = QuestSystem.getDailyQuests();
    const weeklyQuests = QuestSystem.getWeeklyQuests();
    const seasonQuests = QuestSystem.getSeasonQuests();
    // 与 drawQuest 共享同一布局计算，保证命中区与绘制完全一致
    const layout = RenderSystem.questLayout(dailyQuests, weeklyQuests, seasonQuests, this.metaScrollY || 0, this.screenWidth);

    // 一键领取（每日+每周+赛季）
    const ca = layout.claimAllRect;
    if (screenX >= ca.x && screenX <= ca.x + ca.w && screenY >= ca.y && screenY <= ca.y + ca.h) {
      const result = QuestSystem.claimAllQuests();
      if (result.count > 0) {
        this.audioManager.playSynergy();
        this.animManager.flashScreen('#ffd700', 0.2);
        this.showToast(`已领取 ${result.count} 项任务奖励`, 2);
      } else {
        this.audioManager.playButtonClick();
        this.showToast('暂无可领取的任务', 1.5);
      }
      return;
    }

    // 底部裁剪：点击返回按钮下方空白区不误命中被裁剪的列表项
    if (screenY > Game.scrollViewportBottom(this.screenHeight)) return;

    // 每日任务领取按钮
    dailyQuests.forEach((q, i) => {
      if (!(q.complete && !q.claimed)) return;
      const r = layout.dailyRects[i];
      const btnX = r.x + r.w - 70, btnY = r.y + 10;
      if (screenX >= btnX && screenX <= btnX + 60 && screenY >= btnY && screenY <= btnY + 30) {
        if (QuestSystem.claimDailyReward(q.id)) {
          this.audioManager.playSynergy();
          BattlePassSystem.trackEvent('dailyQuestComplete');
        }
      }
    });

    // 每周任务领取按钮
    weeklyQuests.forEach((q, i) => {
      if (!(q.complete && !q.claimed)) return;
      const r = layout.weeklyRects[i];
      const btnX = r.x + r.w - 70, btnY = r.y + 10;
      if (screenX >= btnX && screenX <= btnX + 60 && screenY >= btnY && screenY <= btnY + 30) {
        if (QuestSystem.claimWeeklyReward(q.id)) {
          this.audioManager.playSynergy();
        }
      }
    });

    // 赛季任务领取按钮
    seasonQuests.forEach((q, i) => {
      if (!(q.complete && !q.claimed)) return;
      const r = layout.seasonRects[i];
      const btnX = r.x + r.w - 70, btnY = r.y + 10;
      if (screenX >= btnX && screenX <= btnX + 60 && screenY >= btnY && screenY <= btnY + 30) {
        if (QuestSystem.claimSeasonReward(q.id)) {
          this.audioManager.playSynergy();
        }
      }
    });
  }

  /**
   * 成就界面点击
   */
  handleAchievementClick(screenX, screenY) {
    // 返回按钮
    if (Game.isBackButtonHit(screenX, screenY, this.screenHeight)) {
      this.audioManager.playButtonClick();
      this.screenState = 'lobby';
      return;
    }

    const achievements = QuestSystem.getAchievements();
    // 与 drawAchievement 共享同一布局计算
    const layout = RenderSystem.achievementLayout(achievements, this.metaScrollY || 0, this.screenWidth);

    // 一键领取
    const ca = layout.claimAllRect;
    if (screenX >= ca.x && screenX <= ca.x + ca.w && screenY >= ca.y && screenY <= ca.y + ca.h) {
      const result = QuestSystem.claimAllAchievements();
      if (result.count > 0) {
        this.audioManager.playSynergy();
        this.animManager.flashScreen('#ffd700', 0.2);
        this.showToast(`已领取 ${result.count} 项成就奖励`, 2);
      } else {
        this.audioManager.playButtonClick();
        this.showToast('暂无可领取的成就', 1.5);
      }
      return;
    }

    // 底部裁剪：点击返回按钮下方空白区不误命中被裁剪的列表项
    if (screenY > Game.scrollViewportBottom(this.screenHeight)) return;

    // 成就领取按钮
    achievements.forEach((a, i) => {
      if (!(a.complete && !a.claimed)) return;
      const r = layout.rects[i];
      const btnX = r.x + r.w - 70, btnY = r.y + 10;
      if (screenX >= btnX && screenX <= btnX + 60 && screenY >= btnY && screenY <= btnY + 30) {
        if (QuestSystem.claimAchievementReward(a.id)) {
          this.audioManager.playSynergy();
        }
      }
    });
  }

  /**
   * 通行证面板点击
   */
  handleBattlePassClick(screenX, screenY) {
    // 返回按钮
    if (Game.isBackButtonHit(screenX, screenY, this.screenHeight)) {
      this.audioManager.playButtonClick();
      this.screenState = 'lobby';
      return;
    }

    // 一键领取按钮
    const w = this.screenWidth;
    const claimX = w - 120, claimY = 50;
    if (screenX >= claimX && screenX <= claimX + 100 && screenY >= claimY && screenY <= claimY + 32) {
      const result = BattlePassSystem.claimAll();
      if (result.free > 0 || result.premium > 0) {
        this.audioManager.playSynergy();
        this.animManager.flashScreen('#ffd700', 0.2);
      } else {
        this.audioManager.playButtonClick();
      }
      return;
    }

    // 单个等级奖励领取（行起点 115 与 drawBattlePass 一致；先裁底部避免误命中被裁剪行）
    if (screenY > Game.scrollViewportBottom(this.screenHeight)) return;
    const rewards = BattlePassSystem.getAllRewards();
    const rowH = 50, rowGap = 4;
    const startY = 115 - this.metaScrollY;
    for (let i = 0; i < rewards.length; i++) {
      const r = rewards[i];
      const ry = startY + i * (rowH + rowGap);
      // 免费轨道
      if (r.free && r.free.claimable) {
        const fx = 40;
        if (screenX >= fx && screenX <= fx + 120 && screenY >= ry && screenY <= ry + rowH) {
          if (BattlePassSystem.claimReward(r.level, 'free')) {
            this.audioManager.playSynergy();
          }
          return;
        }
      }
      // 高级轨道
      if (r.premium && r.premium.claimable) {
        const px = 180;
        if (screenX >= px && screenX <= px + 120 && screenY >= ry && screenY <= ry + rowH) {
          if (BattlePassSystem.claimReward(r.level, 'premium')) {
            this.audioManager.playSynergy();
          }
          return;
        }
      }
    }
  }

  /**
   * 排行榜面板点击处理（Phase 5）
   */
  handleLeaderboardClick(screenX, screenY) {
    const w = this.screenWidth;

    // 返回按钮
    if (Game.isBackButtonHit(screenX, screenY, this.screenHeight)) {
      this.audioManager.playButtonClick();
      this.screenState = 'lobby';
      return;
    }

    // 榜单标签切换（与 drawLeaderboard 绘制坐标一致；tab数随榜单定义，最多4）
    const tabW = 80, tabH = 30, tabGap = 8;
    const tabCount = Math.min(LeaderboardSystem.BOARDS.length, 4);
    const totalTabW = tabCount * tabW + (tabCount - 1) * tabGap;
    const tabStartX = (w - totalTabW) / 2;
    const tabY = 55;
    for (let i = 0; i < tabCount; i++) {
      const x = tabStartX + i * (tabW + tabGap);
      if (screenX >= x && screenX <= x + tabW &&
          screenY >= tabY && screenY <= tabY + tabH) {
        if (this.leaderboardTab !== i) {
          this.leaderboardTab = i;
          this.audioManager.playButtonClick();
        }
        return;
      }
    }
  }

  /**
   * 抽卡面板点击处理
   */
  handleGachaClick(screenX, screenY) {
    const w = this.screenWidth;
    const h = this.screenHeight;

    // 如果有抽卡结果正在展示，点击切换到下一张或关闭
    if (this._gachaResults && this._gachaResults.length > 0) {
      this._gachaRevealIdx++;
      if (this._gachaRevealIdx >= this._gachaResults.length) {
        // 全部展示完毕，清除结果
        this._gachaResults = null;
        this._gachaRevealIdx = 0;
      }
      this.audioManager.playButtonClick();
      return;
    }

    // 返回按钮
    if (Game.isBackButtonHit(screenX, screenY, this.screenHeight)) {
      this.audioManager.playButtonClick();
      this.screenState = 'lobby';
      return;
    }

    // 单抽按钮
    const info = DeploymentSystem.getGachaInfo();
    if (!info) return;

    // P34：与 RenderSystem.drawGacha 共用 gachaLayout，杜绝命中框与绘制漂移
    const L = RenderSystem.gachaLayout(w, h);
    const { btnW, btnH, singleX, multiX, btnY } = L;

    // 单抽
    if (screenX >= singleX && screenX <= singleX + btnW &&
        screenY >= btnY && screenY <= btnY + btnH) {
      if (info.gold < info.singleCost) {
        this.showToast(`金币不足，需要${info.singleCost}`, 1.5);
        this.audioManager.playButtonClick();
        return;
      }
      const result = DeploymentSystem.gachaDraw();
      this._invalidateDeploymentBundle(); // P35
      if (result.success) {
        this._gachaResults = result.results;
        this._gachaRevealIdx = 0;
        this.audioManager.playSynergy();
        this.animManager.flashScreen('#ffd700', 0.3);
      } else {
        this.showToast(result.reason || '抽卡失败', 1.5);
      }
      return;
    }

    // 十连
    if (screenX >= multiX && screenX <= multiX + btnW &&
        screenY >= btnY && screenY <= btnY + btnH) {
      if (info.gold < info.multiCost) {
        this.showToast(`金币不足，需要${info.multiCost}`, 1.5);
        this.audioManager.playButtonClick();
        return;
      }
      const result = DeploymentSystem.gachaMultiDraw();
      this._invalidateDeploymentBundle(); // P35
      if (result.success) {
        this._gachaResults = result.results;
        this._gachaRevealIdx = 0;
        this.audioManager.playSynergy();
        this.animManager.flashScreen('#ffd700', 0.3);
      } else {
        this.showToast(result.reason || '抽卡失败', 1.5);
      }
      return;
    }

    // === 激励视频：看广告免费抽 ===
    // 命中框与 RenderSystem.drawGacha 中广告按钮绘制完全同步（共享 gachaLayout）
    const { adBtnX, adBtnY, adBtnW, adBtnH } = L;
    if (screenX >= adBtnX && screenX <= adBtnX + adBtnW &&
        screenY >= adBtnY && screenY <= adBtnY + adBtnH) {
      this._handleGachaAdFreeDraw(info);
      return;
    }
  }

  /**
   * 抽卡界面：看广告免费抽
   * 流程：AdManager 检查可用性 → 展示激励视频 → onClose.isEnded=true 发奖励（免费单抽）
   */
  async _handleGachaAdFreeDraw(info) {
    if (!info || !info.adsFreeDrawAvailable) {
      this.showToast('今日免费次数已用完，明天再来', 1.5);
      this.audioManager.playButtonClick();
      return;
    }
    if (!AdManager.canShowRewarded('gachaFreeDraw')) {
      this.showToast('广告暂不可用', 1.5);
      this.audioManager.playButtonClick();
      return;
    }

    this.audioManager.playButtonClick();
    this.showToast('正在加载广告...', 1.0);

    const res = await AdManager.showRewarded('gachaFreeDraw');
    if (res && res.isEnded) {
      // 用户完整看完，发奖励：免费单抽（不走金币校验，激励视频专属入口）
      const result = DeploymentSystem.gachaFreeDraw();
      this._invalidateDeploymentBundle(); // P35
      if (result.success) {
        // 扣配额（在 gachaFreeDraw save 之前修改，序列化会带新配额落盘）
        const profile = ProfileManager.get();
        if (profile) {
          profile.consumeAdQuota('gachaFreeDraw');
          ProfileManager.save();
        }
        this._gachaResults = result.results;
        this._gachaRevealIdx = 0;
        this.audioManager.playSynergy();
        this.animManager.flashScreen('#ffd700', 0.3);
      } else {
        this.showToast(result.reason || '抽卡失败', 1.5);
      }
    } else if (res && res.reason === 'closed') {
      this.showToast('需看完视频才能领取奖励', 1.5);
    } else if (res && res.reason === 'unavailable') {
      this.showToast('广告暂不可用，请稍后再试', 1.5);
    } else {
      this.showToast('广告播放失败', 1.5);
    }
  }

  /**
   * 科技树面板点击
   */
  handleTechPanelClick(screenX, screenY) {
    // 返回按钮
    if (Game.isBackButtonHit(screenX, screenY, this.screenHeight)) {
      this.audioManager.playButtonClick();
      this.screenState = 'lobby';
      return;
    }

    // 分支切换标签
    const branches = TechTreeSystem.getBranches();
    const tabW = techTabWidth(this.screenWidth), tabH = 35, tabGap = 4;
    const tabStartX = rowStartX(Object.keys(branches).length, tabW, tabGap, this.screenWidth);
    const tabY = 50;
    const branchKeys = Object.keys(branches);

    for (let i = 0; i < branchKeys.length; i++) {
      const x = tabStartX + i * (tabW + tabGap);
      if (screenX >= x && screenX <= x + tabW &&
          screenY >= tabY && screenY <= tabY + tabH) {
        this.selectedTechBranch = branchKeys[i];
        this.metaScrollY = 0;
        this.audioManager.playButtonClick();
        return;
      }
    }

    // 科技节点点击（先裁底部：点击返回按钮下方空白区不误命中被裁剪节点）
    if (screenY > Game.scrollViewportBottom(this.screenHeight)) return;
    const nodes = TechTreeSystem.getBranchNodes(this.selectedTechBranch);
    const nodeW = techNodeWidth(this.screenWidth), nodeH = 70, nodeGap = 10;
    const nodeStartX = rowStartX(2, nodeW, nodeGap, this.screenWidth);
    const nodesStartY = 100 - this.metaScrollY;

    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      const col = Math.min(node.position.col, 1); // 防御：最多两列
      const x = nodeStartX + col * (nodeW + nodeGap);
      const y = nodesStartY + node.position.row * (nodeH + nodeGap);

      if (screenX >= x && screenX <= x + nodeW &&
          screenY >= y && screenY <= y + nodeH) {
        if (node.canUpgrade) {
          const result = TechTreeSystem.upgradeNode(node.id);
          if (result.success) {
            this.animManager.synergyActivation(
              x + nodeW / 2, y + nodeH / 2,
              branches[this.selectedTechBranch].color, 3
            );
            this.audioManager.playSynergy();
            QuestSystem.trackEvent('tech_upgraded');
          }
        } else {
          this.audioManager.playButtonClick();
        }
        return;
      }
    }
  }

  /**
   * 显示屏幕浮动提示
   */
  showToast(text, duration = 2.5) {
    this._toastText = text;
    this._toastTimer = duration;
  }

  /**
   * 从ProfileManager同步数据到Game实例
   */
  syncProfile() {
    const profile = ProfileManager.get();
    this.unlockedRaces = profile.unlockedRaces;
  }

  /**
   * 构建本局招募摘要（供战斗结算界面显示）
   * @returns {Array} [{ icon, name, count }]
   */
  _buildRecruitSummary() {
    const log = EconomySystem.getRecruitLog();
    const entries = Object.entries(log);
    if (entries.length === 0) return [];
    const collected = DeploymentSystem.getCollectedUnitList();
    return entries.map(([id, count]) => {
      const unit = collected.find(u => u.id === id);
      return {
        icon: unit ? unit.icon : '?',
        name: unit ? unit.name : id,
        count,
      };
    });
  }

  /**
   * 启动加载画面（配置加载期间显示，避免冷启动白屏）
   * 独立于 RenderSystem：不依赖任何已加载配置
   * @param {number} progress - 0~1
   */
  renderLoadingScreen(progress) {
    const { ctx } = this;
    const w = this.screenWidth;
    const h = this.screenHeight;

    // 背景渐变
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, '#1e1b4b');
    grad.addColorStop(0.5, '#0f172a');
    grad.addColorStop(1, '#1e293b');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // 标题
    ctx.fillStyle = '#fbbf24';
    ctx.font = 'bold 30px sans-serif';
    ctx.fillText('⚔ 占地之王', w / 2, h * 0.36);

    ctx.fillStyle = '#94a3b8';
    ctx.font = '13px sans-serif';
    ctx.fillText('六边形领地争夺战', w / 2, h * 0.36 + 30);

    // 进度条
    const barW = Math.min(220, w * 0.6);
    const barH = 10;
    const barX = (w - barW) / 2;
    const barY = h * 0.55;
    const p = Math.max(0, Math.min(1, progress));
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    ctx.fillRect(barX, barY, barW, barH);
    ctx.fillStyle = '#fbbf24';
    ctx.fillRect(barX, barY, barW * p, barH);
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 1;
    ctx.strokeRect(barX, barY, barW, barH);

    // 百分比
    const pct = Math.round(p * 100);
    ctx.fillStyle = '#e2e8f0';
    ctx.font = 'bold 14px sans-serif';
    ctx.fillText(`加载中... ${pct}%`, w / 2, barY + barH + 26);
  }

  /**
   * 启动游戏循环
   * 异步: 先加载 JSON 配置，再启动
   */
  async start() {
    // 加载页面最小展示时长（ms）：冷启动强制显示满 3 秒，避免一闪而过
    const LOADING_MIN_MS = 3000;
    const startTs = Date.now();

    // 0. 先绘制启动加载画面（避免配置加载期间白屏）
    this.renderLoadingScreen(0);

    // 1. 加载 JSON 配置（带进度回调，每加载一个文件刷新加载画面）
    await ConfigLoader.init((done, total) => {
      this.renderLoadingScreen(done / total);
    });

    // 1.1 强制加载页展示满 3 秒：配置加载完先显示 100%，再补齐剩余等待时长
    this.renderLoadingScreen(1);
    const elapsed = Date.now() - startTs;
    if (elapsed < LOADING_MIN_MS) {
      await new Promise(res => setTimeout(res, LOADING_MIN_MS - elapsed));
    }

    // 2. 同步配置到静态导出变量
    syncConfigToStatics();
    syncRaces();
    syncLevels();

    // 2.1 P25 features 兜底：如果 features.shopDiamondTab=false（默认）但上次停留在 diamond 分页，重置到第 0 分页
    //     防御场景：用户上次停在 diamondTab=2，重启后 diamond 被隐藏，越界到不存在分类导致 drawShop 显示空白
    {
      const _feat = ConfigLoader.getSafe('game')?.features || {};
      if (_feat.shopDiamondTab === false) {
        const _cats = ShopSystem.getCategoryNames(); // 已过滤
        if (this.shopTab >= _cats.length) {
          this.shopTab = 0;
        }
      }
    }

    // 3. 初始化音频系统
    const audioConfig = ConfigLoader.getSafe('audio');
    if (audioConfig) {
      this.audioManager.init(audioConfig);
    }

    // 3.1 初始化广告系统（在 ConfigLoader 完成后才能拿到 ads 配置）
    //     真微信环境预热激励视频，浏览器预览自动 noop
    const adsConfig = ConfigLoader.getSafe('ads');
    AdManager.init(adsConfig);

    // 4. 初始化账号管理器（多账号：加载账号列表 + 旧单账号数据迁移 + 确定当前账号）
    //    必须先于 ProfileManager.load（其存储 key 依赖当前账号 id）和 SessionManager.init（uid 来自账号元数据）。
    AccountManager.init();

    // 4.1 加载当前账号的玩家存档（key 已按当前账号命名空间）
    ProfileManager.load();
    this.syncProfile();

    // 4.2 初始化账号会话（uid 来自 AccountManager，联机「谁是谁」的身份基础）
    this.sessionManager = new SessionManager();
    await this.sessionManager.init();

    // 4.3 云同步（可选，默认关闭）：由 globalThis.TK_CLOUD_ENABLED 注入开启
    //     开启后：登录找回账号 → 拉云端档覆盖本地（云端为真相）；云端无档则推本地备份。
    if (typeof globalThis !== 'undefined' && globalThis.TK_CLOUD_ENABLED) {
      ProfileManager.enableCloud(globalThis.TK_CLOUD_BASE || undefined);
      ProfileManager.syncFromCloud()
        .then(r => {
          if (r && r.source === 'cloud') {
            this.syncProfile();
            console.log('[Cloud] 已从云端恢复存档');
          }
        })
        .catch(e => console.warn('[Cloud] 初始同步失败', e));
    }

    // 4.1 恢复音频设置（音效/背景音乐/震动开关，设置窗口保存）
    const savedSettings = ProfileManager.get().settings;
    if (savedSettings) {
      this.audioManager.setSfxEnabled(savedSettings.sfx !== false);
      this.audioManager.setBgmEnabled(savedSettings.bgm !== false);
      this.audioManager.hapticEnabled = savedSettings.haptic !== false;
    }

    // 4.2 天梯赛季检查：到期则结算上赛季（发奖励+软重置），并开始新赛季
    {
      const _p = ProfileManager.get();
      LadderSystem.ensureSeason(_p);
      const _ended = LadderSystem.checkSeasonEnd(_p);
      if (_ended) {
        ProfileManager.save();
        const _rt = LadderSystem.rewardText(_ended.rewards);
        this.showToast(`🏁 第${_ended.season}赛季结束！最高${_ended.tierIcon}${_ended.tierLabel}(${_ended.highestTrophies}杯) 奖励${_rt}，奖杯回落至${_ended.resetTo}`, 5);
      }
    }

    // 4.5 初始化每日任务
    QuestSystem.checkDailyRefresh();

    // 4.6 系统返回键支持：浏览器环境挂 history 占位层 + popstate
    // （返回键先关闭打开的界面，主大厅再返回才真正退出页面）
    this._initBackHandler();

    // 5. 进入主城大厅
    this.screenState = 'lobby';

    // 6. 启动游戏循环（固定时间步长：逻辑帧与渲染帧解耦）
    // 逻辑帧恒用 FIXED_DT 推进——真人联机双端只要「同 seed + 同命令序列 + 同固定步长」，
    // 逐逻辑帧世界状态就确定一致，消除「双端 rAF 帧率/卡顿差异 → dt 漂移 → 演算分叉」。
    // 渲染帧用真实 frameDt 插值动画（视觉平滑），不参与逻辑演算/checksum。
    const FIXED_DT = 1 / 60;
    let lastTime = Date.now();
    let accumulator = 0;
    const loop = () => {
      const now = Date.now();
      const frameDt = Math.min(0.25, (now - lastTime) / 1000);
      lastTime = now;

      accumulator += frameDt;
      let steps = 0;
      while (accumulator >= FIXED_DT && steps < 10) {
        this.update(FIXED_DT);
        accumulator -= FIXED_DT;
        steps++;
      }
      if (steps >= 10) accumulator = 0; // 追帧螺旋保护：积压过多时丢弃

      this.render(frameDt);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  /**
   * 更新逻辑
   */
  update(dt) {
    // Toast 计时器递减（所有屏幕状态通用）
    if (this._toastTimer > 0) {
      this._toastTimer -= dt;
      if (this._toastTimer <= 0) {
        this._toastText = '';
        this._toastTimer = 0;
      }
    }
    // 非游戏状态：仅更新动画系统(用于UI过渡)
    if (this.screenState !== 'playing') {
      this.animManager.update(dt);
      return;
    }

    // 更新动画系统(即使在暂停时也更新，以便播放结束特效)
    this.animManager.update(dt);



    if (this.paused) return;
    if (this.gameStatus !== 'playing') return;

    this.elapsedTime += dt;

    // 恢复本实例随机源：多实例（realtime 双端测试）并行时，每个实例的模拟必须用各自
    // 独立的 RNG 闭包，而非被其它实例覆盖的全局随机流
    setBattleRng(this.rng);


    // 1. 翻转动画更新
    this.updateFlippingTiles(dt);

    // 2. 经济系统(资源产出 + 编组)
    const prevGroupCount = this.marchGroups.length;
    EconomySystem.update(dt, this.players, this.map, this.marchGroups, this.pathfindingSystem);
    // 新编组出发音效
    if (this.marchGroups.length > prevGroupCount) {
      this.audioManager.playMarch();
    }

    // 3. 羁绊系统
    for (const player of this.players) {
      SynergySystem.updatePlayerSynergies(player, this.map);
    }
    SynergySystem.updateGroupSynergies(this.marchGroups, this.players, this.map);

    // 3.5 技能系统(主动技能冷却 + 自动释放；召唤会向 marchGroups 推入新队伍)
    SkillSystem.update(dt, this.marchGroups, this.map, this.players);

    // 4. 行军系统(移动 + 遭遇检测)
    MarchSystem.update(dt, this.marchGroups, this.map, CombatSystem, this.players);

    // 5. 箭塔远程攻击
    TowerSystem.update(dt, this.players, this.map, this.marchGroups, CombatSystem);

    // 6. AI决策
    for (const player of this.players) {
      if (player.isAI && player.isAlive()) {
        if (player.tick(dt)) {
          player.makeDecision(this.map, this, (tile, aiPlayer) => {
            const success = BuildSystem.tryFlipTile(tile, aiPlayer, this.map);
            if (success) {
              this.flippingTiles.push(tile);
              this.audioManager.playFlip();
            }
          });
        }
      }
    }

    // 7. 清理已死亡队伍
    this.marchGroups = this.marchGroups.filter(g =>
      g.state !== 'destroyed' && g.state !== 'disbanded' && g.state !== 'arrived'
    );

    // 8. 胜负判定
    this.checkWinCondition();

    // 9. 超时判定（realtime 210s 按领地/金币裁定）
    this._checkTimeout();
  }

  /**
   * 更新翻转中的格子
   */
  updateFlippingTiles(dt) {
    for (let i = this.flippingTiles.length - 1; i >= 0; i--) {
      const tile = this.flippingTiles[i];
      const isRandom = tile.presetBuilding && tile.presetBuilding.type === 'random';
      const duration = FLIP_ANIMATION_DURATION;

      // 随机格在翻转动画过半时决定结果
      if (isRandom && !tile.isRandomResult && tile.isFlipping >= 0.5) {
        BuildSystem.rollRandomTile(tile, this.map);
        this.audioManager.playRandomReveal();
      }

      const done = tile.updateFlip(dt, duration);
      if (done) {
        const player = this.players.find(p => p.id === tile.owner);
        if (player) {
          BuildSystem.completeFlip(tile, player, this.map);
          this.audioManager.playBuild();
          this.audioManager.vibrateMedium();

          // 翻转完成时触发小粒子效果
          const pixel = this.map.hexToPixel(tile.q, tile.r);
          const sparkColor = (tile.owner === this.localPlayerId) ? PLAYER_COLORS[1] : PLAYER_COLORS[2];
          this.animManager.spark(pixel.x, pixel.y, sparkColor, 4);
        }
        this.flippingTiles.splice(i, 1);
      }
    }
  }

  /**
   * 胜负判定（大本营存活）
   */
  checkWinCondition() {
    const humanPlayer = this.players.find(p => p.id === this.localPlayerId);
    const enemies = this.players.filter(p => p.id !== this.localPlayerId);

    if (!humanPlayer.isAlive()) {
      this._finishBattle(false);
    } else if (enemies.every(e => !e.isAlive())) {
      this._finishBattle(true);
    }
  }

  /**
   * 统一对局结算入口（大本营摧毁 / 超时裁定共用）
   * @param {boolean} isWin 本地视角是否胜出
   */
  _finishBattle(isWin) {
    if (this.gameStatus !== 'playing') return;
    this.gameStatus = isWin ? 'won' : 'lost';

    const mode = this.battleMode === 'realtime' ? 'realtime' : 'ai';
    const difficulty = this._getEnemyDifficulty();

    // 云端权威结算：只上报「胜负+模式+对手」，服务端重算奖励（防作弊），
    // 返回权威结果覆盖本地；失败降级为本地结算（离线兜底）。
    if (ProfileManager.isCloudEnabled()) {
      ProfileManager.settleAuthoritative(isWin, mode, difficulty, this._opponentTrophies)
        .then(rewards => {
          this._lastRewards = rewards;
          this._notifyLadderChange(rewards);
          this._postSettleCommon(isWin);
        })
        .catch(e => {
          console.warn('[Cloud] 权威结算失败，降级本地结算:', e && e.message || e);
          this._applyLocalSettle(isWin, mode, difficulty);
          this._postSettleCommon(isWin);
        });
      return;
    }

    // 本地结算（默认，离线可用）
    this._applyLocalSettle(isWin, mode, difficulty);
    this._postSettleCommon(isWin);
  }

  /** 本地结算：真人局走 Elo（对手奖杯分），AI 局走难度档位 */
  _applyLocalSettle(isWin, mode, difficulty) {
    const rewards = mode === 'realtime'
      ? ProfileManager.grantPvpRewards(isWin, this._opponentTrophies)
      : ProfileManager.grantBattleRewards(isWin, difficulty);
    this._lastRewards = rewards;
    this._notifyLadderChange(rewards);
  }

  /** 结算后的公共流程：招募进度 + 任务/通行证 + 音效特效 */
  _postSettleCommon(isWin) {
    // 招募进度：胜利减半（主要通过抽卡获取兵种），失败全额
    ProfileManager.applyRecruits(EconomySystem.getRecruitLog(), isWin ? 0.5 : 1.0);

    // 任务 + 通行证
    QuestSystem.trackEvent('games_played');
    BattlePassSystem.trackEvent('levelComplete');

    if (isWin) {
      const newRace = ProfileManager.checkRaceUnlock();
      if (newRace) this._newlyUnlockedRace = newRace;
      this.syncProfile();
      QuestSystem.trackEvent('games_won');
      BattlePassSystem.trackEvent('levelWin');
      this.audioManager.stopBGM();
      this.audioManager.playVictory();
      this.audioManager.vibrateStrong();
      this.animManager.victoryFireworks(this.screenWidth, this.screenHeight);
    } else {
      this.audioManager.stopBGM();
      this.audioManager.playDefeat();
      this.audioManager.vibrateStrong();
      this.animManager.defeatEffect(this.screenWidth, this.screenHeight);
    }
  }

  /**
   * 战斗超时裁定（realtime 210s）：双方大本营都存活时按领地数裁定，平局看金币，再平局房主胜。
   * 用「本地 vs 对手」的相对比较，双端镜像一致（A 端 A 胜 = B 端 B 负），不引入分叉。
   */
  _checkTimeout() {
    if (this.battleMode !== 'realtime') return;
    if (this.gameStatus !== 'playing') return;
    if (this.elapsedTime < BATTLE_TIMEOUT_S) return;

    const me = this.players.find(p => p.id === this.localPlayerId);
    const foe = this.players.find(p => p.id !== this.localPlayerId);
    if (!me || !foe) return;

    const myTiles = (me.tiles ? me.tiles.length : 0);
    const foeTiles = (foe.tiles ? foe.tiles.length : 0);

    let iWin;
    if (myTiles !== foeTiles) iWin = myTiles > foeTiles;
    else if (me.gold !== foe.gold) iWin = me.gold > foe.gold;
    else iWin = false; // 完全平局（异步快照无房主概念）：兜底判对手（snapshot）胜

    this._isTimeout = true;
    this._timeoutWin = iWin;
    this.showToast(iWin ? '⏱ 超时判定：领地领先，获胜！' : '⏱ 超时判定：领地落后，惜败', 2);
    this._finishBattle(iWin);
  }

  /**
   * 当前引导高亮布局（P38：渲染 RenderSystem._drawTutorialOverlay 与点击命中同源）
   * @returns {object|null} null = 引导未激活或无高亮目标
   */
  _tutorialLayout() {
    const tut = this._buildTutorialState();
    if (!tut) return null;
    const L = RenderSystem.tutorialLayout(tut, this.inputSystem, this.screenWidth, this.screenHeight);
    if (!L) return null;
    L.step = tut.step;
    L.text = tut.text;
    return L;
  }

  /**
   * 判断 inner 坐标是否落在引导高亮区内
   * @returns {boolean|null} null = 引导未激活（调用方按"不拦截"处理）
   */
  _isInTutorialHole(x, y, tol = 6) {
    const L = this._tutorialLayout();
    if (!L) return null;
    if (L.kind === 'circle') {
      const dx = x - L.cx;
      const dy = y - L.cy;
      const rr = L.circleR + tol;
      return dx * dx + dy * dy <= rr * rr;
    }
    return x >= L.holeX - tol && x <= L.holeX + L.holeW + tol &&
           y >= L.holeY - tol && y <= L.holeY + L.holeH + tol;
  }

  /**
   * 引导遮罩点击拦截：引导激活时，高亮区以外的点击一律吞掉（不再穿透到后面的按钮）
   * @param {number} x inner 坐标 X
   * @param {number} y inner 坐标 Y（handleScreenClick / deploy 回调传入的都是已反推的 inner 值）
   * @returns {boolean} true = 已拦截，调用方应直接 return
   */
  _interceptTutorialClick(x, y) {
    const L = this._tutorialLayout();
    if (!L) return false;
    if (this._isInTutorialHole(x, y)) return false;
    // 战斗第 4 步：文案是「相邻的格子都可以翻转」，地图是多点容错的，
    // 只拦右上角 ⚙ 设置按钮（与 handlePlayingClick 同源坐标），地图点击全部放行。
    if (L.step === 3) {
      const mX = this.screenWidth - 95;
      const mY = 5;
      if (x >= mX && x <= mX + 40 && y >= mY && y <= mY + 35) {
        this.showToast('\u5f15\u5bfc\u4e2d\uff1a\u5148\u70b9\u51fb\u9ad8\u4eae\u7684\u683c\u5b50', 1.2);
        return true;
      }
      return false;
    }
    this.showToast('\u8bf7\u70b9\u51fb\u9ad8\u4eae\u7684\u533a\u57df\u7ee7\u7eed\u5f15\u5bfc', 1.2);
    return true;
  }

  /**
   * 新手引导分步教学状态（Phase 6 重做）
   * 返回 null（完成/老玩家）或 { step, text, target }：
   *  - step 0：大厅高亮「⚔ 布阵」按钮（底部导航 index 2）
   *  - step 1：布阵界面高亮返回按钮
   *  - step 2：大厅高亮「⚔ 开战」按钮
   *  - step 3：战斗中高亮第一个可翻格子
   */
  _buildTutorialState() {
    const profile = ProfileManager.get();
    const step = profile ? (profile.tutorialStep || 0) : 4;
    if (!profile || step < 0 || step >= 4) return null;
    const w = this.screenWidth;
    const h = this.screenHeight;

    if (step === 0) {
      // 第1步：引导点击「⚔ 布阵」（底部导航 index 2）
      const nav = Game.LOBBY_LAYOUT.nav;
      return {
        step,
        text: '欢迎来到占地之王！点击「⚔ 布阵」配置出战兵种',
        target: { x: Game.lobbyNavX(2, w), y: Game.lobbyNavY(h), w: Game.lobbyNavItemW(w), h: nav.h },
      };
    }
    if (step === 1) {
      // 第2步：布阵界面，引导点击返回按钮（左下角）
      return {
        step,
        text: '这是布阵界面：可以查看兵种与羁绊搭配。确认后点左下角「返回」回到大厅',
        target: { x: 16, y: h - 51, w: 80, h: 35 },
      };
    }
    if (step === 2) {
      // 第3步：大厅，引导点击「⚔ 开战」
      const bl = Game.LOBBY_LAYOUT.battle;
      const blW = Game.battleBtnW(w);
      return {
        step,
        text: '准备好了！点击「⚔ 开战」开始第一场战斗',
        target: { x: (w - blW) / 2, y: Game.lobbyBattleY(h), w: blW, h: bl.h },
      };
    }
    if (step === 3) {
      // 第4步：战斗中，高亮第一个可翻格子（与己方领地相邻的未翻转格）
      const flipTargets = this.map ? this.map.getAdjacentUnflippedTiles(this.localPlayerId) : [];
      const target = flipTargets.length > 0 ? { q: flipTargets[0].q, r: flipTargets[0].r } : null;
      return {
        step,
        text: '点击高亮的格子翻转让它属于你！相邻的格子都可以翻转',
        target,
      };
    }
    return null;
  }

  /**
   * 渲染
   */
  render(dt) {
    // 系统返回键：界面层状态变化时同步 history 占位层
    // （从主大厅进入任何界面/窗口 push 一层；回到主大厅 replace 清标记，
    //  保证浏览器后退键「先关界面、主大厅再按才退出页面」）
    if (this._backEnabled && typeof window !== 'undefined' && window.history) {
      const layerActive = this.screenState !== 'lobby' || this._settingsOpen || this._announceOpen;
      if (layerActive !== this._lastLayerActive) {
        this._lastLayerActive = layerActive;
        try {
          if (layerActive && !(window.history.state && window.history.state.tk)) {
            window.history.pushState({ tk: 1 }, '');
          } else if (!layerActive && window.history.state && window.history.state.tk) {
            // 手动关闭界面回大厅：清除占位标记（replace 不产生历史，不影响返回语义）
            window.history.replaceState(null, '');
          }
        } catch (err) { /* 隐私模式等异常环境忽略 */ }
      }
    }

    // 设置输入系统模式
    this.inputSystem.cameraEnabled = (this.screenState === 'playing' && !this.paused);
    this.inputSystem.onMenuScroll = (this.screenState === 'tech_panel' || this.screenState === 'shop' || this.screenState === 'quest' || this.screenState === 'achievement' || this.screenState === 'battle_pass')
      ? (dy) => {
          this.metaScrollY = Math.max(0, this.metaScrollY + dy);
        }
      : null;

    // deploy_select 界面的拖拽回调（safeArea 适配：UI 经 translate+scaleY 映射，点击反推 inner_y）
    if (this.screenState === 'deploy_select') {
      this.inputSystem.onDeployTouchStart = (x, y) => this._handleDeployDragStart(x, (y - this.safeAreaTop) / this.safeAreaScaleY);
      this.inputSystem.onDeployTouchMove = (x, y) => this._handleDeployDragMove(x, (y - this.safeAreaTop) / this.safeAreaScaleY);
      this.inputSystem.onDeployTouchEnd = (x, y, isDrag) => this._handleDeployDragEnd(x, (y - this.safeAreaTop) / this.safeAreaScaleY, isDrag);
    } else {
      this.inputSystem.onDeployTouchStart = null;
      this.inputSystem.onDeployTouchMove = null;
      this.inputSystem.onDeployTouchEnd = null;
      this._deployDrag.active = false;
      this._cancelDeployPress();
      this._showRecruitPanel = false;
      this._unitDetailId = null;
    }

    // 获取Profile数据
    const profile = ProfileManager.get();

    // 对手信息
    const enemyPlayer = this.players.find(p => p.id !== this.localPlayerId);

    const gameState = {
      screenState: this.screenState,
      map: this.map,
      players: this.players,
      marchGroups: this.marchGroups,
      gameStatus: this.gameStatus,
      elapsedTime: this.elapsedTime,
      // 本局棋盘布局（上下对战：玩家在下方向上进攻）
      layoutName: this.currentBattleConfig ? (this.currentBattleConfig.layoutName || '') : '',
      layoutLanes: this.currentBattleConfig ? (this.currentBattleConfig.layoutLanes || 0) : 0,
      enemyName: enemyPlayer ? enemyPlayer.name : '',
      enemyRace: enemyPlayer ? enemyPlayer.race : '',
      enemyAiLevel: enemyPlayer ? enemyPlayer.aiLevel : '',
      paused: this.paused,
      // 视角镜像（realtime guest 端渲染/输入上下翻转标记 + 翻转中心线世界 Y）
      localPlayerId: this.localPlayerId,
      // 局外养成数据
      profile: profile,
      bonusBundle: this.currentBonusBundle,
      lastRewards: this._lastRewards,
      newlyUnlockedRace: this._newlyUnlockedRace,
      recruitSummary: this._buildRecruitSummary(),
      metaScrollY: this.metaScrollY,
      selectedTechBranch: this.selectedTechBranch,
      shopTab: this.shopTab,
      toastText: this._toastText,
      toastTimer: this._toastTimer,
      dailyQuests: this.screenState === 'quest' ? QuestSystem.getDailyQuests() : null,
      weeklyQuests: this.screenState === 'quest' ? QuestSystem.getWeeklyQuests() : null,
      seasonQuests: this.screenState === 'quest' ? QuestSystem.getSeasonQuests() : null,
      achievements: this.screenState === 'achievement' ? QuestSystem.getAchievements() : null,
      battlePassStatus: this.screenState === 'battle_pass' ? BattlePassSystem.getStatus() : null,
      battlePassRewards: this.screenState === 'battle_pass' ? BattlePassSystem.getAllRewards() : null,
      shopItems: this.screenState === 'shop' ? ShopSystem.getShopItems() : null,
      deploymentSummary: (this.screenState === 'deploy_select' || this.screenState === 'lobby') ? DeploymentSystem.getDeploymentSummary() : null,
      collectedUnits: this.screenState === 'deploy_select' ? DeploymentSystem.getCollectedUnitList() : null,
      // P35：布阵界面不在战斗中，players[0] 为空 → 必须从 deploymentBundle 派生，
      // 否则羁绊栏拿不到数据会回落到英文 style key 与 ? 图标
      autoSynergies: this.screenState === 'deploy_select'
        ? SynergySystem.getAutoSynergyPanelData(this._ensureDeploymentBundle()) : null,
      synergyDetailId: this._synergyDetailId,
      synergyDetailData: (this.screenState === 'deploy_select' && this._synergyDetailId)
        ? SynergySystem.getSynergyDetail(this._synergyDetailId, this._ensureDeploymentBundle())
        : null,
      recruitableUnits: (this.screenState === 'deploy_select' && this._showRecruitPanel) ? DeploymentSystem.getRecruitableUnits() : null,
      deployDrag: this._deployDrag,
      showRecruitPanel: this._showRecruitPanel,
      unitDetailId: this._unitDetailId,
      unitDetailData: (this.screenState === 'deploy_select' && this._unitDetailId)
        ? (DeploymentSystem.getCollectedUnitList().find(u => u.id === this._unitDetailId) || null)
        : null,
      buildingDetailType: this._buildingDetailType,
      buildingDetailData: (this.screenState === 'deploy_select' && this._buildingDetailType)
        ? (DeploymentSystem.getDeploymentSummary().buildings?.[this._buildingDetailType] || null)
        : null,
      // 抽卡系统
      gachaInfo: this.screenState === 'gacha' ? DeploymentSystem.getGachaInfo() : null,
      gachaResults: this._gachaResults,
      gachaRevealIdx: this._gachaRevealIdx,
      // 排行榜（Phase 5）
      leaderboardTab: this.leaderboardTab,
      leaderboardBoards: this.screenState === 'leaderboard' ? LeaderboardSystem.BOARDS : null,
      leaderboardData: this.screenState === 'leaderboard'
        ? LeaderboardSystem.getLeaderboard(LeaderboardSystem.BOARDS[this.leaderboardTab].key)
        : null,
      // 分享状态（Phase 5）
      shareRewardClaimed: ShareSystem.isDailyRewardClaimed(),
      // 天梯段位（大厅徽章 / 结算界面展示）
      ladderTier: profile ? LadderSystem.getTier(profile.trophies || 0) : null,
      ladderProgress: profile ? LadderSystem.getProgress(profile.trophies || 0) : null,
      seasonDaysLeft: profile ? LadderSystem.seasonDaysLeft(profile) : 0,
      // 战力信息（大厅显示：总战力 + 当前段位参考战力）
      powerInfo: (this.screenState === 'lobby' && profile) ? PowerSystem.getLobbyPowerInfo(profile) : null,
      // 可升级角标（大厅底部导航：布阵=可升级兵种数 / 科技=可升级节点数）
      lobbyBadges: (this.screenState === 'lobby' && profile) ? {
        deploy: DeploymentSystem.getUpgradeableUnitCount(),
        tech: TechTreeSystem.getUpgradeableNodeCount(),
      } : null,
      // 玩家账号信息（大厅显示：昵称 + 本地账号 uid 尾号；呈现层数据，不进 checksum）
      accountInfo: (this.screenState === 'lobby' && profile) ? {
        nickname: profile.nickname || '领主',
        uid: this.sessionManager ? this.sessionManager.getUID() : null,
      } : null,
      // 账号面板（大厅点击账号信息行打开；登录/切换/注销多账号；呈现层，不进 checksum）
      accountOpen: this._accountOpen,
      accountList: this._accountOpen ? AccountManager.list() : null,
      currentAccountId: this._accountOpen ? AccountManager.getCurrentId() : null,
      // 新手引导（Phase 6 重做：分步教学）
      tutorialStep: profile ? (profile.tutorialStep || 0) : 4,
      tutorial: this._buildTutorialState(),
      // 设置窗口 / 公告子窗口（覆盖层）
      settingsOpen: this._settingsOpen,
      announceOpen: this._announceOpen,
      audioSfxEnabled: !!this.audioManager.sfxEnabled,
      audioBgmEnabled: !!this.audioManager.bgmEnabled,
      audioHapticEnabled: !!this.audioManager.hapticEnabled,
      press: this._press,
      announcements: (this._settingsOpen || this._announceOpen) ? Game.ANNOUNCEMENTS : null,
    };
    this.renderSystem.render(gameState, this.inputSystem, dt);
    // 在最上层绘制 Toast 提示
    this.renderSystem.drawToast(gameState);
    // 异步对战匹配中 overlay（最顶层，取消或匹配成功后自动消失）
    if (this._asyncState === 'searching') this._drawMatchOverlay();
  }
}
