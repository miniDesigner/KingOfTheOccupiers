/**
 * 渲染系统
 * 六边形地图 / 建筑 / 战士 / HP条 / HUD / 动画 / 战斗特效
 * 集成 AnimationManager 实现粒子/屏幕震动/高级动画
 */

import { HEX_SIZE, PLAYER_COLORS, TILE_BACK_COLOR, TILE_BACK_BORDER,
  BUILDING_CONFIG, getFlipCost, FLIP_ANIMATION_DURATION, RANDOM_REVEAL_DURATION } from '../config.js';
import { hexToPixel, pixelToHex } from '../world/HexMath.js';
import { RACES } from '../data/races.js';
import ConfigLoader from '../data/ConfigLoader.js';
import DeploymentSystem, { UPGRADE_COST_GROWTH, MAX_UNIT_LEVEL } from '../meta/DeploymentSystem.js';
import { clampSafeArea } from './SafeArea.js';
import { rowItemWidth, rowStartX, adaptiveFontSize, techNodeWidth, techTabWidth, ladderCombo, ladderBarWidth, resourceBarLayout, LAYOUT_DESIGN_MAX, LAYOUT_MIN } from './Layout.js';

// 安全区常量的单一真相源在 SafeArea.js，这里 re-export 保持既有引用兼容
export { SAFE_AREA_MAX } from './SafeArea.js';

// 左下角返回按钮几何（与 Game.BACK_BUTTON 同源）：距左 16、距底 16、宽 80、高 35
const BACK_BTN = { x: 16, w: 80, h: 35, bottom: 16 };

// 品质色（Q1-Q6: 白/绿/蓝/紫/橙/红）—— 布阵槽位 / 兵种卡 / 大厅上阵预览共用
const QUALITY_COLORS = ['#9ca3af', '#22c55e', '#3b82f6', '#a855f7', '#f97316', '#ef4444'];
// 滚动列表底部裁剪间隙：内容不进入返回按钮上方 8px 以内，避免与返回按钮重叠（P21）
const SCROLL_BOTTOM_GAP = 8;

export class RenderSystem {
  constructor(ctx, screenWidth, screenHeight) {
    this.ctx = ctx;
    this.screenWidth = screenWidth;
    this.screenHeight = screenHeight;

    // === 安全区适配（Phase 7 P7）===
    // 默认 0（浏览器环境）；微信小游戏由 Game 构造期 setSafeArea() 注入。
    // 渲染策略：renderScreen 把所有 UI 画在 (0, safeAreaTop) ~ (w, h-bottom) 区间；
    //          顶部 [0, safeAreaTop] 与底部 [h-bottom, h] 各画一道黑底覆盖刘海/home indicator；
    //          点击命中由 Game 端对 clientY 减 topOffset 抵消，详见 Game 构造器注释。
    this.safeAreaTop = 0;
    this.safeAreaBottom = 0;
    // inner [0, h] → 屏幕 [top, h-bottom] 的纵向缩放比例（默认 1，浏览器环境无缩放）
    // 例：iPhone 14 Pro top=47 bottom=34 h=1334 → scaleY = (1334-81)/1334 ≈ 0.939
    this.safeAreaScaleY = 1;

    // 战斗特效列表(旧系统，保留向后兼容)
    this.effects = [];

    // AnimationManager 引用(由 Game 设置)
    this.animManager = null;

    // AudioManager 引用(用于UI按钮音效)
    this.audioManager = null;

    // 视口世界坐标边界（战斗渲染裁剪屏外格子/单位）
    this._viewBounds = null;

  }

  /**
   * 设置安全区（刘海上沿高度 + home indicator 高度），从 wx.getWindowInfo().safeArea 解出
   * @param {{ top: number, bottom: number, left: number, right: number }|null|undefined} safeArea
   */
  setSafeArea(safeArea) {
    if (!safeArea) return;
    // P8：钳制 + scaleY 计算统一走 SafeArea.clampSafeArea（Game 端回读同一份结果，
    // 保证「渲染映射」与「点击反推」永不漂移）。依据真机极值：灵动岛 top≤59、
    // Android 虚拟导航栏 bottom≤48，真实设备永不触发钳制，纯防御。
    const clamped = clampSafeArea(safeArea, this.screenHeight);
    this.safeAreaTop = clamped.top;
    this.safeAreaBottom = clamped.bottom;
    this.safeAreaScaleY = clamped.scaleY;
  }

  /**
   * 视角颜色映射：按玩家颜色设置（异步对战下玩家=蓝、对手=红恒定）
   * @param {number} ownerId 玩家 id
   * @param {object} gameState
   * @returns {string} 颜色 CSS
   */
  _ownerColor(ownerId, gameState) {
    const p = gameState ? gameState.players.find(pl => pl.id === ownerId) : null;
    return p ? p.color : (PLAYER_COLORS[ownerId] || '#888');
  }

  /**
   * 按钮按压缩放反馈：按下位置在按钮矩形内且 250ms 内 → 整体 0.95 缩放（松手回弹）
   * @param {{x:number,y:number,w:number,h:number}} rect - 按钮矩形
   * @param {{x:number,y:number,t:number}|null} press - gameState.press（按下位置与时间）
   * @param {Function} drawFn - 按钮绘制函数（在缩放变换内执行）
   */
  _drawPressed(rect, press, drawFn) {
    const { ctx } = this;
    let pressed = false;
    if (press && rect) {
      const age = Date.now() - (press.t || 0);
      if (age >= 0 && age < 250 &&
          press.x >= rect.x && press.x <= rect.x + rect.w &&
          press.y >= rect.y && press.y <= rect.y + rect.h) {
        pressed = true;
      }
    }
    if (!pressed) { drawFn(); return; }
    const cx = rect.x + rect.w / 2;
    const cy = rect.y + rect.h / 2;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(0.95, 0.95);
    ctx.translate(-cx, -cy);
    drawFn();
    ctx.restore();
  }

  /**
   * 主渲染入口：先渲染当前界面，再叠加设置/公告覆盖层
   */
  render(gameState, inputSystem, dt) {
    // P8：账号面板 / 设置窗口原在 renderScreen 之后（restore 外）绘制，不受安全区保护 ——
    // 刘海机上遮罩从 y=0 铺起、面板按全屏 h 居中，导致顶部被刘海物理遮挡、底部落进
    // home indicator 手势区。现已移入 renderScreen 的 safeArea 包裹内（见该方法）。
    this.renderScreen(gameState, inputSystem, dt);
  }

  /**
   * 按屏幕状态渲染对应界面。
   * 顶层 wrap：用 ctx.translate(0, top) + ctx.scale(1, scaleY) 把 inner 坐标系 [0, h]
   *          线性映射到屏幕 [top, h-bottom]（见 setSafeArea 公式推导）：
   *            screen_y = top + inner_y * scaleY
   *          所有 Scene 按全屏 h 设计的锚点（顶部状态栏 y=0、底部按钮 y=h-80 等），
   *          渲染后恰好落在刘海下沿与 home indicator 上沿之间的可见区。
   *          顶部刘海与底部 home indicator 区在 Scene 画完后用两道黑底 fillRect 覆盖。
   *          输入坐标由 Game 端对称反推 (screenY - top) / scaleY，命中 Scene 内 rect.y。
   *          浏览器环境 safeAreaTop/Bottom 均为 0，scaleY = 1，行为完全等同未启用安全区。
   */
  renderScreen(gameState, inputSystem, dt) {
    const { ctx } = this;
    const w = this.screenWidth;
    const h = this.screenHeight;
    const top = this.safeAreaTop;
    const bottom = this.safeAreaBottom;
    const scaleY = this.safeAreaScaleY || 1;

    // 安全区包裹：translate(0, top) + scale(1, scaleY)
    ctx.save();
    if (top > 0 || scaleY !== 1) {
      if (top > 0) ctx.translate(0, top);
      if (scaleY !== 1) ctx.scale(1, scaleY);
    }
    this._renderScreenInner(gameState, inputSystem, dt);

    // P8：最上层覆盖层同样纳入安全区包裹（画在 inner 之后保证盖在最上，
    // 但坐标系与 Scene 一致，面板顶部不会被刘海遮挡、底部不会落进 indicator 区）
    if (gameState.accountOpen) {
      this._drawAccountOverlay(gameState);
    }
    if (gameState.settingsOpen || gameState.announceOpen) {
      this._drawSettingsOverlay(gameState);
    }
    ctx.restore();

    // 刘海黑底（顶部）
    if (top > 0) {
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, w, top);
    }
    // home indicator 黑底（底部）
    if (bottom > 0) {
      ctx.fillStyle = '#000';
      ctx.fillRect(0, h - bottom, w, bottom);
    }
  }

  /**
   * renderScreen 主体：菜单分发 + 游戏中地图/HUD 渲染（被 renderScreen 的 ctx.save/translate 包裹）
   */
  _renderScreenInner(gameState, inputSystem, dt) {
    const { ctx } = this;

    // 根据屏幕状态选择渲染
    switch (gameState.screenState) {
      case 'lobby':
        this.drawLobby(gameState);
        this._drawResourceBar(gameState); // P16：大厅资源栏统一左上角（与子界面一致）
        this._drawTutorialOverlay(gameState, inputSystem);
        return;
      case 'deploy_select':
        this.drawDeploySelect(gameState);
        // 统一资源栏在界面(含兵种详情/招募/羁绊弹窗)之后叠加，弹窗打开时依然可见
        this._drawResourceBar(gameState);
        this._drawBackButton(ctx); // P16：返回按钮统一最上层，避免被滚动列表覆盖
        this._drawTutorialOverlay(gameState, inputSystem);
        return;
      case 'tech_panel':
        this.drawTechPanel(gameState);
        this._drawResourceBar(gameState);
        this._drawBackButton(ctx);
        return;
      case 'shop':
        this.drawShop(gameState);
        this._drawResourceBar(gameState);
        this._drawBackButton(ctx);
        return;
      case 'quest':
        this.drawQuest(gameState);
        this._drawResourceBar(gameState);
        this._drawBackButton(ctx);
        return;
      case 'achievement':
        this.drawAchievement(gameState);
        this._drawResourceBar(gameState);
        this._drawBackButton(ctx);
        return;
      case 'battle_pass':
        this.drawBattlePass(gameState);
        this._drawResourceBar(gameState);
        this._drawBackButton(ctx);
        return;
      case 'gacha':
        this.drawGacha(gameState);
        this._drawResourceBar(gameState);
        this._drawBackButton(ctx);
        return;
      case 'leaderboard':
        this.drawLeaderboard(gameState);
        this._drawResourceBar(gameState);
        this._drawBackButton(ctx);
        return;
      case 'playing':
      default:
        break;
    }

    // === 游戏中渲染 ===
    const { map, players, marchGroups } = gameState;

    // 清屏
    ctx.fillStyle = '#1a202c';
    ctx.fillRect(0, 0, this.screenWidth, this.screenHeight);

    // 应用相机变换(含屏幕震动偏移)
    const shake = this.animManager ? this.animManager.getShakeOffset() : { offsetX: 0, offsetY: 0 };
    ctx.save();
    ctx.translate(inputSystem.cameraX + shake.offsetX, inputSystem.cameraY + shake.offsetY);
    ctx.scale(inputSystem.scale, inputSystem.scale);

    // 计算视口世界坐标边界（供 isVisible 裁剪屏外格子/单位）
    {
      const s = inputSystem.scale || 1;
      const camX = inputSystem.cameraX + shake.offsetX;
      const camY = inputSystem.cameraY + shake.offsetY;
      const inv = 1 / s;
      const pad = HEX_SIZE * 1.5; // 外扩边距，避免边缘格子闪烁
      this._viewBounds = {
        minX: -camX * inv - pad,
        minY: -camY * inv - pad,
        maxX: (this.screenWidth - camX) * inv + pad,
        maxY: (this.screenHeight - camY) * inv + pad,
      };
    }

    // 绘制地图
    this.drawMap(map, players, gameState);

    // 绘制行军队伍
    this.drawMarchGroups(marchGroups, map, gameState);

    // 绘制旧版战斗特效(向后兼容)
    this.drawEffects(dt || 0.016);

    // 绘制 AnimationManager 世界空间特效(粒子/光环/飘字)
    if (this.animManager) {
      this.animManager.renderWorld(ctx);
    }

    ctx.restore();

    // 绘制 AnimationManager 屏幕空间特效(烟花/闪光)
    if (this.animManager) {
      this.animManager.renderScreen(ctx);
    }

    // 绘制HUD(不受相机变换影响)
    this.drawHUD(gameState);

    // 新手引导分步教学叠加（战斗中：高亮第一个可翻格子）
    this._drawTutorialOverlay(gameState, inputSystem);

    // 游戏结束画面（暂停界面已移除：战斗中不再有暂停态）
    if (gameState.gameStatus !== 'playing') {
      this.drawGameOver(gameState);
    }
  }

  /**
   * 统一顶部资源栏：所有独立界面（布阵/科技/商店/任务/通行证/招募/排行榜）叠加绘制。
   * 由 renderScreen 在各界面绘制完成后调用——布阵界面的兵种详情/招募/羁绊弹窗
   * 也是在界面内绘制的，因此弹窗打开时资源栏依然可见（升级决策需对照当前余额）。
   * 大厅已有自己的居中式资源栏，不重复叠加。
   * 顶栏区域(0~50)与各界面既有的返回按钮(左)和标题(居中)位置重合，仅轻微压暗不遮挡；
   * 货币簇固定左上角 2×2 网格（金币/钻石/星尘/奖杯），避开标题与返回按钮的点击区。
   */
  _drawResourceBar(gameState) {
    const { ctx } = this;
    const w = this.screenWidth;
    const profile = gameState.profile;

    // 顶栏底色 + 底部分隔线
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(0, 0, w, 50);
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    ctx.fillRect(0, 50, w, 1);

    // 左上角货币簇（2×2）—— 自适应宽度（详见 Layout.resourceBarLayout）
    const tier = gameState.ladderTier;
    const cells = [
      { icon: '💰', value: profile ? profile.gold : 0, color: '#fbbf24' },
      { icon: '💎', value: profile ? profile.diamond : 0, color: '#60a5fa' },
      { icon: '⭐', value: profile ? profile.stardust : 0, color: '#a78bfa' },
      { icon: '🏆', value: profile ? (profile.trophies || 0) : 0, color: tier ? tier.color : '#fbbf24' },
    ];

    // safeRight：右上角设置按钮范围 [w-95, w-55] 之前留 8px 间隙
    const layout = resourceBarLayout(cells.map(c => c.value), w, w - 103);
    const cellW = layout.cellW;
    const cellH = layout.cellH;
    const pad = layout.pad;
    const fontSize = layout.fontSize;
    const clusterW = layout.clusterW;
    const clusterH = cellH * 2 + pad * 2;
    const clusterX = 8;
    const clusterY = 4;
    ctx.fillStyle = 'rgba(15,23,42,0.92)';
    ctx.fillRect(clusterX, clusterY, clusterW, clusterH);
    ctx.strokeStyle = '#334155';
    ctx.lineWidth = 1;
    ctx.strokeRect(clusterX, clusterY, clusterW, clusterH);

    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    for (let i = 0; i < cells.length; i++) {
      const cx = clusterX + pad + (i % 2) * cellW;
      const cy = clusterY + pad + Math.floor(i / 2) * cellH + cellH / 2;
      ctx.font = '11px sans-serif';
      ctx.fillStyle = '#e2e8f0';
      ctx.fillText(cells[i].icon, cx, cy);
      ctx.font = `bold ${fontSize}px sans-serif`;
      ctx.fillStyle = cells[i].color;
      ctx.fillText(String(cells[i].value), cx + 16, cy);
    }
  }

  /**
   * 绘制地图
   */
  drawMap(map, players, gameState) {
    const { ctx } = this;
    const player = players.find(p => p.id === gameState.localPlayerId); // 本地玩家

    for (const tile of map.getAllTiles()) {
      const { x, y: worldY } = map.hexToPixel(tile.q, tile.r);
      const y = worldY;

      // 视口裁剪
      if (!this.isVisible(x, y)) continue;

      // 障碍格(山脉/河流)：始终可见，不参与翻转
      if (tile.isObstacle) {
        this.drawObstacleTile(tile, x, y);
        continue;
      }

      // 判断格子可见性
      const isAdjacent = player && tile.isAdjacentTo(map, player.id);
      const isOwned = tile.owner > 0 && tile.isFlipped;

      if (tile.isFlipping > 0 && tile.isFlipping < 1) {
        // 翻转动画中
        this.drawFlippingTile(tile, x, y, map, gameState);
      } else if (tile.isFlipped) {
        // 已翻转格子
        this.drawFlippedTile(tile, x, y, map, gameState);
      } else if (isAdjacent) {
        // 相邻可见的未翻转格子
        this.drawAdjacentTile(tile, x, y, map);
      } else {
        // 不可见的未翻转格子(暗色背面)
        this.drawHiddenTile(x, y);
      }
    }

    // 进攻方向指示：敌方大本营目标标记（玩家永远在下方向上进攻）
    const targetEnemy = players.find(p => p.id !== gameState.localPlayerId && p.isAlive && p.isAlive());
    if (targetEnemy && targetEnemy.base) {
      const { x, y: worldY } = map.hexToPixel(targetEnemy.base.q, targetEnemy.base.r);
      const y = worldY;
      const pulse = 0.5 + 0.5 * Math.sin(Date.now() / 350);
      ctx.save();
      // 呼吸准星圈
      ctx.strokeStyle = `rgba(239,68,68,${(0.35 + 0.55 * pulse).toFixed(3)})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x, y, HEX_SIZE * (0.75 + 0.2 * pulse), 0, Math.PI * 2);
      ctx.stroke();
      // 方向标签
      ctx.fillStyle = '#fca5a5';
      ctx.font = 'bold 11px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('⬆ 敌方大本营', x, y - HEX_SIZE - 10);
      ctx.restore();
    }
  }

  /**
   * 绘制障碍格(山脉/河流)：深色岩石风格，始终可见、不可翻转、不可通行
   */
  drawObstacleTile(tile, x, y) {
    const { ctx } = this;
    this.drawHexShape(x, y, HEX_SIZE);
    ctx.fillStyle = '#2f3b4a';
    ctx.fill();
    ctx.strokeStyle = '#5a6b7f';
    ctx.lineWidth = 2;
    ctx.stroke();

    // 岩石纹理：双峰剪影
    ctx.fillStyle = '#4a5a6e';
    ctx.beginPath();
    ctx.moveTo(x - HEX_SIZE * 0.55, y + HEX_SIZE * 0.38);
    ctx.lineTo(x - HEX_SIZE * 0.18, y - HEX_SIZE * 0.32);
    ctx.lineTo(x + HEX_SIZE * 0.2, y + HEX_SIZE * 0.38);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(x - HEX_SIZE * 0.02, y + HEX_SIZE * 0.38);
    ctx.lineTo(x + HEX_SIZE * 0.34, y - HEX_SIZE * 0.16);
    ctx.lineTo(x + HEX_SIZE * 0.58, y + HEX_SIZE * 0.38);
    ctx.closePath();
    ctx.fill();

    // 雪顶高光
    ctx.fillStyle = '#94a3b8';
    ctx.beginPath();
    ctx.moveTo(x - HEX_SIZE * 0.18, y - HEX_SIZE * 0.32);
    ctx.lineTo(x - HEX_SIZE * 0.08, y - HEX_SIZE * 0.14);
    ctx.lineTo(x - HEX_SIZE * 0.28, y - HEX_SIZE * 0.14);
    ctx.closePath();
    ctx.fill();

    // 「不可通行」小字
    ctx.fillStyle = '#8b9bb0';
    ctx.font = '9px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('阻挡', x, y + HEX_SIZE * 0.62);
  }

  /**
   * 绘制暗色背面格子
   */
  drawHiddenTile(x, y) {
    const { ctx } = this;
    this.drawHexShape(x, y, HEX_SIZE);
    ctx.fillStyle = TILE_BACK_COLOR;
    ctx.fill();
    ctx.strokeStyle = TILE_BACK_BORDER;
    ctx.lineWidth = 1;
    ctx.stroke();

    // 背面图案
    ctx.fillStyle = '#4a5568';
    ctx.font = '12px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('?', x, y);
  }

  /**
   * 绘制相邻可见格子(显示预设建筑和消耗)
   */
  drawAdjacentTile(tile, x, y, map) {
    const { ctx } = this;
    const preset = tile.presetBuilding;

    this.drawHexShape(x, y, HEX_SIZE);
    ctx.fillStyle = '#3a4556';
    ctx.fill();
    ctx.strokeStyle = '#718096';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // 显示预设建筑信息
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    if (preset) {
      if (preset.type === 'random') {
        // 随机格
        ctx.fillStyle = '#fbbf24';
        ctx.font = 'bold 14px sans-serif';
        ctx.fillText('?', x, y - 6);
        ctx.fillStyle = '#fbbf24';
        ctx.font = '10px sans-serif';
        ctx.fillText('5金', x, y + 10);
      } else {
        const config = BUILDING_CONFIG[preset.type];
        const levelConfig = config ? (config[preset.level || 1] || config[1]) : null;

        // 建筑图标(文字)
        const icon = this.getBuildingIcon(preset.type, preset.level);
        ctx.fillStyle = levelConfig ? levelConfig.color : '#888';
        ctx.font = 'bold 15px sans-serif';
        ctx.fillText(icon, x, y - 6);

        // 消耗
        const cost = getFlipCost(preset);
        ctx.fillStyle = cost <= 30 ? '#4ade80' : cost <= 60 ? '#fbbf24' : '#f87171';
        ctx.font = '10px sans-serif';
        ctx.fillText(cost + '金', x, y + 10);
      }
    }
  }

  /**
   * 绘制已翻转格子
   */
  drawFlippedTile(tile, x, y, map, gameState) {
    const { ctx } = this;
    const color = this._ownerColor(tile.owner, gameState);

    // 格子底色
    this.drawHexShape(x, y, HEX_SIZE);
    ctx.fillStyle = this.lightenColor(color, 0.15);
    ctx.fill();
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.stroke();

    if (tile.building) {
      const building = tile.building;

      // 建筑图标：兵营显示所产兵种的具体图标（unitData.icon），其余显示建筑图标
      let icon = this.getBuildingIcon(building.type, building.level);
      if (building.type === 'barracks' && building.unitData && building.unitData.icon) {
        icon = building.unitData.icon;
      }
      // 金矿/箭塔使用建筑自身颜色，兵营/大本营使用兵种风格色
      if (building.type === 'gold_mine' || building.type === 'arrow_tower') {
        ctx.fillStyle = building.color;
      } else {
        ctx.fillStyle = building.variantColor || building.color;
      }
      ctx.font = 'bold 15px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(icon, x, y - 4);

      // 兵营/金矿显示等级
      if (building.type === 'barracks' || building.type === 'gold_mine') {
        ctx.fillStyle = '#fff';
        ctx.font = '9px sans-serif';
        ctx.fillText('Lv' + building.level, x, y + 8);
      }

      // HP条
      if (building.currentHp < building.maxHp) {
        this.drawHPBar(x, y - HEX_SIZE + 4, building.currentHp / building.maxHp, HEX_SIZE * 0.8);
      }

      // 兵营待编组战士进度
      if (building.producesWarriors() && building.warriorBuffer > 0) {
        const progress = building.warriorBuffer / building.groupThreshold;
        this.drawProgressBar(x, y + HEX_SIZE - 6, progress, HEX_SIZE * 0.7, '#60a5fa');
      }

      // 金矿产出进度
      if (building.producesGold() && building.goldBuffer > 0) {
        const progress = building.goldBuffer;  // 0~1 表示当前金币积累进度
        this.drawProgressBar(x, y + HEX_SIZE - 6, progress, HEX_SIZE * 0.7, '#fbbf24');
      }
    } else {
      // 空地
      ctx.fillStyle = 'rgba(255,255,255,0.1)';
      ctx.font = '10px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('~', x, y);
    }
  }

  /**
   * 绘制翻转动画中的格子
   */
  drawFlippingTile(tile, x, y, map, gameState) {
    const { ctx } = this;
    const progress = tile.isFlipping;

    // 简单的Y轴压缩翻转效果
    const scaleY = Math.abs(Math.cos(progress * Math.PI));
    const showFront = progress > 0.5;

    ctx.save();
    ctx.translate(x, y);
    ctx.scale(1, Math.max(0.05, scaleY));

    this.drawHexShape(0, 0, HEX_SIZE);

    if (showFront) {
      // 翻转后半段：显示正面
      const color = this._ownerColor(tile.owner, gameState);
      ctx.fillStyle = this.lightenColor(color, 0.15);
      ctx.fill();
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.stroke();

      // 显示建筑图标(如果是随机格，显示"?")
      if (tile.presetBuilding) {
        if (tile.presetBuilding.type === 'random' && !tile.isRandomResult) {
          ctx.fillStyle = '#fbbf24';
          ctx.font = 'bold 16px sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText('?', 0, 0);
        } else if (tile.isRandomResult) {
          const icon = this.getBuildingIcon(tile.isRandomResult.type, tile.isRandomResult.level);
          ctx.fillStyle = '#fbbf24';
          ctx.font = 'bold 15px sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(icon, 0, 0);
        } else {
          const icon = this.getBuildingIcon(tile.presetBuilding.type, tile.presetBuilding.level);
          ctx.fillStyle = '#fff';
          ctx.font = 'bold 15px sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(icon, 0, 0);
        }
      }
    } else {
      // 翻转前半段：显示背面
      ctx.fillStyle = TILE_BACK_COLOR;
      ctx.fill();
      ctx.strokeStyle = TILE_BACK_BORDER;
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    ctx.restore();
  }

  /**
   * 绘制行军队伍
   */
  drawMarchGroups(marchGroups, map, gameState) {
    const { ctx } = this;
    const QUALITY_COLORS = ['#9ca3af', '#22c55e', '#3b82f6', '#a855f7', '#f97316', '#ef4444'];

    for (const group of marchGroups) {
      if (!group.isAlive() && group.state !== 'fighting_building' && group.state !== 'fighting_warrior') continue;

      const x = group.pixelX;
      const y = group.pixelY;

      if (!this.isVisible(x, y)) continue;

      const playerColor = this._ownerColor(group.owner, gameState);
      const quality = group._quality || 1;
      const qColor = QUALITY_COLORS[quality - 1] || '#9ca3af';
      const icon = group._unitIcon || '';
      const attackRange = group.getAttackRange ? group.getAttackRange() : 1;
      const isRanged = attackRange > 1;
      const combatStyles = group._combatStyles || group.combatStyles || ['melee'];
      const isMagic = combatStyles.includes('magic');
      const isDefense = combatStyles.includes('defense');

      // 基础半径：战士数 + 品质加成（高品质兵种略大）
      const baseRadius = 7 + Math.min(5, group.warriors / 4) + (quality - 1) * 0.8;

      // === 远程兵种：外圈虚线环 ===
      if (isRanged) {
        ctx.strokeStyle = isMagic ? 'rgba(192, 132, 252, 0.6)' : 'rgba(96, 165, 250, 0.6)';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([3, 2]);
        ctx.beginPath();
        ctx.arc(x, y, baseRadius + 5, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      // === 法术兵种：紫色光晕 ===
      if (isMagic) {
        const gradient = ctx.createRadialGradient(x, y, baseRadius, x, y, baseRadius + 8);
        gradient.addColorStop(0, 'rgba(168, 85, 247, 0.25)');
        gradient.addColorStop(1, 'rgba(168, 85, 247, 0)');
        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.arc(x, y, baseRadius + 8, 0, Math.PI * 2);
        ctx.fill();
      }

      // === 主圆点（玩家颜色） ===
      ctx.fillStyle = playerColor;
      ctx.beginPath();
      ctx.arc(x, y, baseRadius, 0, Math.PI * 2);
      ctx.fill();

      // === 品质边框（防御型更粗） ===
      ctx.strokeStyle = qColor;
      ctx.lineWidth = isDefense ? 3 : 2;
      ctx.stroke();

      // === 兵种图标（显示在圆点上方） ===
      if (icon) {
        ctx.font = `${Math.floor(baseRadius * 1.3)}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(icon, x, y - baseRadius - 8);
      }

      // === 有效生命值（战士数 × 生命系数，反映兵种耐久差异） ===
      const effectiveHP = Math.round(group.warriors * (group.hpCoeff || 1.0));
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 10px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(effectiveHP, x, y);

      // === 战斗状态标记 ===
      if (group.state === 'fighting_building' || group.state === 'fighting_warrior') {
        ctx.fillStyle = '#f87171';
        ctx.font = 'bold 14px sans-serif';
        ctx.fillText('⚔', x + baseRadius + 2, y - baseRadius - 2);
      }
    }
  }

  /**
   * 绘制HP条
   */
  drawHPBar(x, y, ratio, width) {
    const { ctx } = this;
    const height = 3;
    const startX = x - width / 2;

    ctx.fillStyle = '#1a202c';
    ctx.fillRect(startX, y, width, height);

    ctx.fillStyle = ratio > 0.5 ? '#4ade80' : ratio > 0.25 ? '#fbbf24' : '#f87171';
    ctx.fillRect(startX, y, width * ratio, height);
  }

  /**
   * 绘制进度条
   */
  drawProgressBar(x, y, ratio, width, color = '#60a5fa') {
    const { ctx } = this;
    const height = 3;
    const startX = x - width / 2;

    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(startX, y, width, height);

    ctx.fillStyle = color;
    ctx.fillRect(startX, y, width * Math.min(1, ratio), height);
  }

  /**
   * 绘制HUD
   */
  drawHUD(gameState) {
    const { ctx } = this;
    const player = gameState.players.find(p => p.id === gameState.localPlayerId);
    const enemies = gameState.players.filter(p => p.id !== gameState.localPlayerId);

    // 昵称截断：血条标签宽度有限，超长昵称截断（保留前 N 个字符）
    const truncateName = (name, max = 8) => {
      if (!name) return '';
      return name.length > max ? name.slice(0, max) + '…' : name;
    };

    // 顶部HUD背景
    ctx.fillStyle = 'rgba(0,0,0,0.75)';
    ctx.fillRect(0, 0, this.screenWidth, 55);

    // 对手信息 + 计时器
    ctx.fillStyle = '#e2e8f0';
    ctx.font = 'bold 13px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const battleText = 'PvP对战 vs ' + (gameState.enemyName || 'AI');
    ctx.fillText(battleText, this.screenWidth / 2, 12);

    // 计时器 + 本局棋盘布局名（上下对战：⬆向上进攻）
    const minutes = Math.floor(gameState.elapsedTime / 60);
    const seconds = Math.floor(gameState.elapsedTime % 60);
    const timeStr = minutes + ':' + (seconds < 10 ? '0' : '') + seconds;
    ctx.fillStyle = '#a0aec0';
    ctx.font = '11px sans-serif';
    const layoutTag = gameState.layoutName ? ` ⬆${gameState.layoutName}` : ' ⬆向上进攻';
    ctx.fillText(timeStr + ' ·' + layoutTag, this.screenWidth / 2, 28);

    // 大本营HP条(居中)
    if (player.base && player.base.building) {
      const hpRatio = player.base.building.currentHp / player.base.building.maxHp;
      ctx.fillStyle = '#4ade80';
      ctx.font = '9px sans-serif';
      ctx.fillText(truncateName(player.name) || '我方', this.screenWidth / 2 - 50, 44);
      this.drawHPBar(this.screenWidth / 2 - 50, 48, hpRatio, 60);
    }

    if (enemies.length > 0) {
      // 显示第一个敌人HP(多敌人时显示总计)
      const aliveEnemies = enemies.filter(e => e.isAlive());
      if (aliveEnemies.length > 0) {
        const firstEnemy = aliveEnemies[0];
        if (firstEnemy.base && firstEnemy.base.building) {
          const hpRatio = firstEnemy.base.building.currentHp / firstEnemy.base.building.maxHp;
          ctx.fillStyle = '#f87171';
          ctx.font = '9px sans-serif';
          const enemyLabel = truncateName(firstEnemy.name)
            || (aliveEnemies.length > 1 ? '敌方(' + aliveEnemies.length + ')' : '敌方');
          ctx.fillText(enemyLabel, this.screenWidth / 2 + 50, 44);
          this.drawHPBar(this.screenWidth / 2 + 50, 48, hpRatio, 60);
        }
      }
    }

    // 金币(左上)
    ctx.fillStyle = '#fbbf24';
    ctx.font = 'bold 15px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('💰' + Math.floor(player.gold), 8, 18);

    // 战士数（P36：warriorBuffer 按 rate*dt 累积为浮点，战斗表现统一取整）
    const marchingWarriors = player.getTotalMarchingWarriors(gameState.marchGroups);
    const bufferedWarriors = player.getBufferedWarriors();
    ctx.fillStyle = '#60a5fa';
    ctx.font = 'bold 13px sans-serif';
    ctx.fillText('⚔' + Math.floor(marchingWarriors + bufferedWarriors), 8, 38);

    // 敌方信息(右上)
    if (enemies.length > 0) {
      const firstEnemy = enemies[0];
      ctx.fillStyle = '#fca5a5';
      ctx.font = 'bold 13px sans-serif';
      ctx.textAlign = 'right';
      ctx.fillText('💰' + Math.floor(firstEnemy.gold), this.screenWidth - 55, 18);
      const enemyWarriors = firstEnemy.getTotalMarchingWarriors(gameState.marchGroups) + firstEnemy.getBufferedWarriors();
      ctx.fillText('⚔' + Math.floor(enemyWarriors), this.screenWidth - 55, 38);
    }

    // 设置按钮(右上角，打开设置窗口；暂停按钮已移除)
    ctx.fillStyle = '#334155';
    ctx.fillRect(this.screenWidth - 95, 5, 40, 35);
    ctx.strokeStyle = '#475569';
    ctx.lineWidth = 1;
    ctx.strokeRect(this.screenWidth - 95, 5, 40, 35);
    ctx.fillStyle = '#e2e8f0';
    ctx.font = 'bold 15px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('⚙', this.screenWidth - 75, 22);

    // 羁绊面板(左侧)
    let synergyY = 60;
    ctx.textAlign = 'left';
    ctx.font = '10px sans-serif';

    if (player.raceCount && Object.keys(player.raceCount).length > 0) {
      // 羁绊面板背景
      const panelH = Object.keys(player.raceCount).length * 14 + (player.synergyBonuses ? 30 : 10);
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillRect(5, synergyY - 5, 100, panelH);

      for (const [race, count] of Object.entries(player.raceCount)) {
        const raceData = RACES[race];
        if (raceData) {
          // 种族颜色点
          ctx.fillStyle = raceData.color || '#a78bfa';
          ctx.beginPath();
          ctx.arc(12, synergyY, 3, 0, Math.PI * 2);
          ctx.fill();

          // 种族名 + 数量
          ctx.fillStyle = '#c4b5fd';
          ctx.font = '10px sans-serif';
          ctx.fillText(raceData.name + ': ' + count, 20, synergyY + 1);

          // 羁绊进度条
          const thresholds = [2, 4, 6];
          let nextThreshold = thresholds.find(t => t > count);
          if (nextThreshold) {
            const progress = count / nextThreshold;
            this.drawProgressBar(55, synergyY + 5, progress, 45, '#8b5cf6');
          } else {
            // 已满羁绊
            ctx.fillStyle = '#4ade80';
            ctx.font = '8px sans-serif';
            ctx.fillText('MAX', 75, synergyY + 6);
          }
          synergyY += 14;
        }
      }

      // 羁绊加成汇总
      if (player.synergyBonuses) {
        const bonuses = player.synergyBonuses;
        let bonusText = '';
        if (bonuses.attack > 0) bonusText += '攻+' + Math.round(bonuses.attack * 100) + '% ';
        if (bonuses.defense > 0) bonusText += '防+' + Math.round(bonuses.defense * 100) + '% ';
        if (bonuses.speed > 0) bonusText += '速+' + Math.round(bonuses.speed * 100) + '% ';
        if (bonuses.critRate > 0) bonusText += '暴+' + Math.round(bonuses.critRate * 100) + '% ';
        if (bonuses.allStats > 0) bonusText += '全+' + Math.round(bonuses.allStats * 100) + '% ';
        if (bonusText) {
          ctx.fillStyle = '#4ade80';
          ctx.font = 'bold 9px sans-serif';
          ctx.fillText(bonusText.trim(), 8, synergyY + 2);
        }
      }
    }

    // 底部提示
    ctx.fillStyle = 'rgba(0,0,0,0.7)';
    ctx.fillRect(0, this.screenHeight - 28, this.screenWidth, 28);
    ctx.fillStyle = '#a0aec0';
    ctx.font = '11px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('点击相邻格子翻转占领 | 拖动平移 | 滚轮缩放 | ⚙设置', this.screenWidth / 2, this.screenHeight - 14);
  }

  /**
   * 绘制上阵选择界面
   * 玩家在战斗前安排兵种/羁绊上阵
   * 支持拖拽上阵 + 滚动浏览兵种/羁绊卡
   */
  drawDeploySelect(gameState) {
    const { ctx } = this;
    const w = this.screenWidth;
    const h = this.screenHeight;
    const summary = gameState.deploymentSummary;
    const drag = gameState.deployDrag || { active: false };
    const profile = gameState.profile;
    const scrollY = gameState.metaScrollY || 0;

    // === 布局（P36：统一走 RenderSystem.deployLayout，与 Game 命中框同源）===
    // 横排元素宽度按屏宽自适应（iPhone 5 320 屏宽下硬编码会溢出左右屏），
    // 区块垂直锚点由 deployLayout 一次性算好，渲染与点击共用同一份，杜绝双源漂移。
    const L = RenderSystem.deployLayout(w, h);
    const autoSynergies = gameState.autoSynergies || [];
    const unitListY = L.unit.listY;

    // 背景
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, 0, w, h);

    // 标题
    ctx.fillStyle = '#fbbf24';
    ctx.font = 'bold 18px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('⚔ 对战准备', w / 2, L.titleY);

    // 品质色（Q1-Q6: 白/绿/蓝/紫/橙/红）—— 槽位与卡片共用
    const QUALITY_COLORS = ['#9ca3af', '#22c55e', '#3b82f6', '#a855f7', '#f97316', '#ef4444'];
    const qualityColor = (q) => QUALITY_COLORS[(q || 1) - 1] || '#9ca3af';

    // === 兵种槽位 ===
    ctx.fillStyle = '#e2e8f0';
    ctx.font = 'bold 12px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('兵种槽位 (点击查看详情，长按兵种卡拖入替换)', 15, L.slot.labelY);

    const uslot = L.slot;
    const uStartX = (w - (uslot.count * uslot.w + (uslot.count - 1) * uslot.gap)) / 2;
    const unitSlots = summary?.units || [];
    for (let i = 0; i < uslot.count; i++) {
      const sx = uStartX + i * (uslot.w + uslot.gap);
      const slotData = unitSlots[i] || { empty: true, slot: i };
      const isDragTarget = drag.active && drag.type === 'unit' &&
        drag.x >= sx && drag.x <= sx + uslot.w && drag.y >= uslot.y && drag.y <= uslot.y + uslot.h;
      const isDragSource = drag.active && drag.type === 'unit' && drag.fromSlot === i;
      const qColor = qualityColor(slotData.quality);

      ctx.fillStyle = isDragTarget ? '#1e3a5f' : (slotData.empty ? '#1a2332' : '#1e293b');
      ctx.fillRect(sx, uslot.y, uslot.w, uslot.h);
      // 高品质(紫及以上)槽位内部微光，强化品质感
      if (!slotData.empty && !isDragSource && (slotData.quality || 1) >= 4) {
        ctx.fillStyle = qColor;
        ctx.globalAlpha = 0.08;
        ctx.fillRect(sx, uslot.y, uslot.w, uslot.h);
        ctx.globalAlpha = 1;
      }
      // 外框：空槽灰 / 有兵种按品质描边 / 拖拽目标蓝色高亮
      ctx.strokeStyle = isDragTarget ? '#60a5fa' : (slotData.empty ? '#334155' : qColor);
      ctx.lineWidth = isDragTarget ? 2.5 : (slotData.empty ? 1.5 : 2);
      ctx.strokeRect(sx, uslot.y, uslot.w, uslot.h);

      ctx.fillStyle = '#475569';
      ctx.font = '8px sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText('#' + (i + 1), sx + 3, uslot.y + 10);

      if (slotData.empty && !isDragSource) {
        ctx.fillStyle = '#475569';
        ctx.font = '9px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('空槽位', sx + uslot.w / 2, uslot.y + uslot.h / 2);
      } else if (!isDragSource) {
        ctx.fillStyle = qColor;
        ctx.font = 'bold 18px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(slotData.icon || '?', sx + uslot.w / 2, uslot.y + 30);
        ctx.fillStyle = '#e2e8f0';
        ctx.font = 'bold 8px sans-serif';
        ctx.fillText(slotData.name || '?', sx + uslot.w / 2, uslot.y + 48);
        // 品质名（左）+ 等级（右）—— 品质用名称描述（与抽卡界面一致），不用颜色字
        const qNames = ['普通', '精良', '稀有', '史诗', '传说', '神话'];
        ctx.fillStyle = qColor;
        ctx.font = 'bold 8px sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText(qNames[(slotData.quality || 1) - 1] || '普通', sx + 4, uslot.y + 62);
        ctx.fillStyle = '#fbbf24';
        ctx.font = '8px sans-serif';
        ctx.textAlign = 'right';
        ctx.fillText('Lv.' + (slotData.level || 1), sx + uslot.w - 4, uslot.y + 62);
        // P35：品质改由外框颜色 + 品质名表达，移除 ★ 重复计数
      } else {
        ctx.fillStyle = 'rgba(30,41,59,0.4)';
        ctx.fillRect(sx, uslot.y, uslot.w, uslot.h);
        ctx.fillStyle = '#334155';
        ctx.font = '9px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('(拖拽中)', sx + uslot.w / 2, uslot.y + uslot.h / 2);
      }
    }

    // === 自动羁绊预览面板（4 类风格羁绊，按上阵兵种自动派生，无需手选） ===
    ctx.fillStyle = '#c084fc';
    ctx.font = 'bold 12px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('羁绊 (点击查看详情，按上阵兵种自动派生)', 15, L.synergy.labelY);

    const ap = L.synergy;
    const aStartX = ap.startX; // 与 Game 点击命中同源（autoSynergyCardLayout）
    for (let i = 0; i < ap.count; i++) {
      const sx = aStartX + i * (ap.size + ap.gap);
      const syn = autoSynergies[i];
      const isActive = syn && syn.level > 0;
      const styleKey = syn?.style || ['melee', 'ranged', 'defense', 'magic'][i];
      const styleColor = { melee: '#ef4444', ranged: '#22c55e', defense: '#3b82f6', magic: '#a855f7' }[styleKey] || '#a855f7';
      // 卡背景：激活态用 style 色调暗底，未激活用灰
      ctx.fillStyle = isActive ? '#1e293b' : '#1a2332';
      ctx.fillRect(sx, ap.y, ap.size, ap.size);
      ctx.strokeStyle = isActive ? styleColor : '#334155';
      ctx.lineWidth = isActive ? 2 : 1.5;
      ctx.strokeRect(sx, ap.y, ap.size, ap.size);
      // P35：未激活也显示真实羁绊图标 + 中文羁绊名（不再回落英文 style key）
      ctx.fillStyle = isActive ? styleColor : '#475569';
      ctx.font = 'bold 22px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(syn?.icon || '?', sx + ap.size / 2, ap.y + 22);
      ctx.fillStyle = isActive ? '#e2e8f0' : '#64748b';
      ctx.font = 'bold 9px sans-serif';
      ctx.fillText(syn?.name || '羁绊', sx + ap.size / 2, ap.y + 38);
      // 等级 (Lv.X/6) 或未激活
      ctx.fillStyle = isActive ? '#fbbf24' : '#475569';
      ctx.font = 'bold 10px sans-serif';
      ctx.fillText(isActive ? `Lv.${syn.level}/${syn.maxLevel || 6}` : '未激活', sx + ap.size / 2, ap.y + 54);
    }

    // === 建筑强化展示 ===
    ctx.fillStyle = '#e2e8f0';
    ctx.font = 'bold 12px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('建筑强化 (科技树升级)', 15, L.building.labelY);

    const bldSlotW = L.building.w, bldSlotH = L.building.h, bldGap = L.building.gap;
    const bldStartX = (w - (3 * bldSlotW + 2 * bldGap)) / 2;
    const bldSlotY = L.building.y;
    const buildings = summary?.buildings || {};
    const bldKeys = ['barracks', 'arrow_tower', 'gold_mine'];
    const bldIcons = { barracks: '🏰', arrow_tower: '🏹', gold_mine: '💰' };
    const bldNames = { barracks: '兵营', arrow_tower: '箭塔', gold_mine: '金矿' };
    for (let i = 0; i < 3; i++) {
      const bldType = bldKeys[i];
      const bldData = buildings[bldType] || { level: 1, maxLevel: 1 };
      const sx = bldStartX + i * (bldSlotW + bldGap);
      ctx.fillStyle = '#1e293b';
      ctx.fillRect(sx, bldSlotY, bldSlotW, bldSlotH);
      ctx.strokeStyle = '#f59e0b';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(sx, bldSlotY, bldSlotW, bldSlotH);
      ctx.fillStyle = '#fbbf24';
      ctx.font = 'bold 16px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(bldIcons[bldType] || '?', sx + bldSlotW / 2, bldSlotY + 18);
      ctx.fillStyle = '#e2e8f0';
      ctx.font = 'bold 9px sans-serif';
      ctx.fillText(bldNames[bldType] || bldType, sx + bldSlotW / 2, bldSlotY + 34);
      const isMaxLevel = bldData.level >= bldData.maxLevel;
    ctx.fillStyle = isMaxLevel ? '#4ade80' : '#94a3b8';
      ctx.font = '8px sans-serif';
      ctx.fillText(`Lv.${bldData.level}/${bldData.maxLevel}`, sx + bldSlotW / 2, bldSlotY + 45);
      // P36: 可点击 hint —— 画在卡内右侧（原在卡下方 +65，与「已拥有兵种」标题重叠）
      if (!isMaxLevel) {
        ctx.fillStyle = '#fbbf24';
        ctx.font = 'bold 11px sans-serif';
        ctx.textAlign = 'right';
        ctx.fillText('▸', sx + bldSlotW - 7, bldSlotY + 45);
        ctx.textAlign = 'center';
      }
    }
    // 升级提示标题
    ctx.fillStyle = '#64748b';
    ctx.font = '9px sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText('点击升级', w - 15, L.building.labelY);
    ctx.textAlign = 'left';

    // 旧版"已拥有羁绊列表"已废弃（2026-09-09 改造：羁绊不再手选）
    // 当前等级加成由上方 autoSynergyPanel 卡片直接展示

    // === 「已拥有兵种」标题栏（固定区，不随兵种列表滚动，P22） ===
    const collected = gameState.collectedUnits || [];
    ctx.fillStyle = '#e2e8f0';
    ctx.font = 'bold 12px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(`已拥有兵种 (${collected.length})  未上阵可长按拖入`, 15, L.unit.labelY);

    // === 可滚动区域：兵种卡列表（clip 顶部 = unitListY，标题成为固定头不随滚动） ===
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, unitListY, w, L.scrollAreaBottom - unitListY);
    ctx.clip();

    const styleNames = { melee: '近战', ranged: '远程', defense: '防御', magic: '法术' };
    const styleColors = { melee: '#ef4444', ranged: '#22c55e', defense: '#3b82f6', magic: '#a855f7' };

    // --- 兵种卡列表 ---
    const card = L.unit;
    const cardStartX = (w - (card.perRow * card.w + (card.perRow - 1) * card.gap)) / 2;
    const deployedUnits = profile?.deployment?.units || [];

    for (let i = 0; i < collected.length; i++) {
      const col = i % card.perRow;
      const row = Math.floor(i / card.perRow);
      const cx = cardStartX + col * (card.w + card.gap);
      const cy = unitListY + row * (card.h + card.gap) - scrollY;
      const unit = collected[i];
      const isDeployed = deployedUnits.includes(unit.id);
      const isDragging = drag.active && drag.id === unit.id && drag.type === 'unit';

      ctx.fillStyle = isDragging ? 'rgba(30,41,59,0.3)' : '#1e293b';
      ctx.fillRect(cx, cy, card.w, card.h);
      // 品质色边框（已上阵时保留品质框，上阵状态由 #N 角标表达）
      const qColor = qualityColor(unit.quality);
      ctx.strokeStyle = qColor;
      ctx.lineWidth = isDeployed ? 2 : 1.5;
      ctx.strokeRect(cx, cy, card.w, card.h);
      // 已上阵：外圈蓝色光晕提示
      if (isDeployed && !isDragging) {
        ctx.strokeStyle = 'rgba(59,130,246,0.45)';
        ctx.lineWidth = 1;
        ctx.strokeRect(cx - 2, cy - 2, card.w + 4, card.h + 4);
      }

      // 可升级标记（右上角绿色角标）
      // 完整口径：等级上限 + 招募次数 + 星尘 + 金币全部满足才亮（与 upgradeUnit 校验一致），
      // 避免招募够了但买不起时误导玩家点进详情却显示「条件不足」
      if (!isDragging && DeploymentSystem.isUnitUpgradeable(unit.id)) {
        ctx.fillStyle = '#22c55e';
        ctx.beginPath();
        ctx.arc(cx + card.w - 8, cy + 8, 7, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 9px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('↑', cx + card.w - 8, cy + 8);
      }

      if (!isDragging) {
        // 图标
        ctx.fillStyle = qColor;
        ctx.font = 'bold 20px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(unit.icon || '?', cx + card.w / 2, cy + 22);
        // 名称
        ctx.fillStyle = '#e2e8f0';
        ctx.font = 'bold 9px sans-serif';
        ctx.fillText(unit.name || '?', cx + card.w / 2, cy + 38);
        // 等级 + 攻击范围
        ctx.fillStyle = '#fbbf24';
        ctx.font = '8px sans-serif';
        ctx.fillText('Lv.' + unit.level, cx + card.w / 2 - 10, cy + 50);
        ctx.fillStyle = unit.attackRange > 1 ? '#60a5fa' : '#64748b';
        ctx.fillText('射' + (unit.attackRange || 1), cx + card.w / 2 + 10, cy + 50);
        // 招募进度（如果有 recruitRequired）
        if (unit.recruitRequired > 0 && unit.level < MAX_UNIT_LEVEL) {
          const needed = unit.recruitRequired * unit.level;
          const current = unit.recruitCount || 0;
          const isReady = current >= needed;
          ctx.fillStyle = isReady ? '#22c55e' : '#64748b';
          ctx.font = '7px sans-serif';
          ctx.fillText(`招募 ${current}/${needed}`, cx + card.w / 2, cy + 62);
        } else if (unit.level >= MAX_UNIT_LEVEL) {
          ctx.fillStyle = '#22c55e';
          ctx.font = '7px sans-serif';
          ctx.fillText('MAX', cx + card.w / 2, cy + 62);
        }
        // 上阵标记：蓝色实底角标「阵N」（醒目区分是否已上阵，置于左上角）
        if (isDeployed) {
          const slotIdx = deployedUnits.indexOf(unit.id);
          const tagW = 22, tagH = 11;
          ctx.fillStyle = '#2563eb';
          ctx.fillRect(cx + 1, cy + 1, tagW, tagH);
          ctx.strokeStyle = '#60a5fa';
          ctx.lineWidth = 0.5;
          ctx.strokeRect(cx + 1, cy + 1, tagW, tagH);
          ctx.fillStyle = '#ffffff';
          ctx.font = 'bold 8px sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText('阵' + (slotIdx + 1), cx + 1 + tagW / 2, cy + tagH / 2 + 1);
        }
      }
    }

    ctx.restore(); // 恢复 clip（滚动区仅兵种卡列表）

    // === 底部提示（开战入口在大厅「⚔ 开战」按钮，本界面仅布阵） ===
    ctx.fillStyle = '#475569';
    ctx.font = '9px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('💡 点击卡片查看详情  |  长按或按住拖动兵种卡上阵（羁绊上阵在详情内）', this.screenWidth / 2, L.tipY1);
    ctx.fillStyle = '#64748b';
    ctx.fillText('布阵完成后回大厅点「⚔ 开战」出战', this.screenWidth / 2, L.tipY2);

    // === 拖拽视觉反馈（仅兵种） ===
    if (drag.active && drag.type === 'unit') {
      const deployables = ConfigLoader.getSafe('deployables');
      const cfg = deployables?.units?.[drag.id];
      if (cfg) {
        ctx.globalAlpha = 0.8;
        ctx.fillStyle = '#1e293b';
        ctx.fillRect(drag.x - 32, drag.y - 37, 64, 74);
        ctx.strokeStyle = qualityColor(cfg.quality);
        ctx.lineWidth = 2;
        ctx.strokeRect(drag.x - 32, drag.y - 37, 64, 74);
        ctx.globalAlpha = 1;
        ctx.fillStyle = '#60a5fa';
        ctx.font = 'bold 20px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(cfg.icon || '?', drag.x, drag.y - 15);
        ctx.fillStyle = '#e2e8f0';
        ctx.font = 'bold 9px sans-serif';
        ctx.fillText(cfg.name || '?', drag.x, drag.y + 5);
        ctx.fillStyle = '#fbbf24';
        ctx.font = '8px sans-serif';
        const collected = profile?.collectedUnits?.[drag.id];
        ctx.fillText('Lv.' + (collected?.level || 1), drag.x, drag.y + 20);
      }
    }

    // === 招募面板覆盖层 ===
    if (gameState.showRecruitPanel && gameState.recruitableUnits) {
      this._drawRecruitPanel(gameState);
    }

    // === 建筑详情面板覆盖层(P33: 优先于兵种详情面板渲染,但两者不会同时打开) ===
    // P35：羁绊详情面板（点击羁绊卡弹出）
    if (gameState.synergyDetailId && gameState.synergyDetailData) {
      this._drawSynergyDetailPanel(gameState);
    } else if (gameState.buildingDetailType && gameState.buildingDetailData) {
      this._drawBuildingDetailPanel(gameState);
    } else if (gameState.unitDetailId && gameState.unitDetailData) {
      this._drawUnitDetailPanel(gameState);
    }

  }

  /**
   * 绘制招募面板
   */
  _drawRecruitPanel(gameState) {
    const { ctx } = this;
    const w = this.screenWidth;
    const h = this.screenHeight;
    const profile = gameState.profile;
    const recruitable = gameState.recruitableUnits || [];

    // 遮罩
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(0, 0, w, h);

    // 面板
    const panelW = Math.min(w - 20, 340);
    const panelH = Math.min(h - 80, 460);
    const panelX = (w - panelW) / 2;
    const panelY = 50;

    ctx.fillStyle = '#1e293b';
    ctx.fillRect(panelX, panelY, panelW, panelH);
    ctx.strokeStyle = '#7c3aed';
    ctx.lineWidth = 2;
    ctx.strokeRect(panelX, panelY, panelW, panelH);

    // 标题
    ctx.fillStyle = '#c084fc';
    ctx.font = 'bold 16px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('📋 招募兵种', panelX + panelW / 2, panelY + 20);

    // 货币显示
    ctx.fillStyle = '#94a3b8';
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(`💰${profile?.gold || 0}  ⭐${profile?.stardust || 0}`, panelX + 10, panelY + 38);

    // 关闭按钮
    const closeX = panelX + panelW - 35;
    const closeY = panelY + 5;
    ctx.fillStyle = '#dc2626';
    ctx.fillRect(closeX, closeY, 30, 30);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 16px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('×', closeX + 15, closeY + 15);

    // 兵种卡片列表
    const cardW = 140, cardH = 85, cardGap = 8;
    const cols = Math.floor((panelW - 20) / (cardW + cardGap));
    const listStartY = panelY + 50;
    const styleNames = { melee: '近战', ranged: '远程', defense: '防御', magic: '法术' };

    if (recruitable.length === 0) {
      ctx.fillStyle = '#64748b';
      ctx.font = '13px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('所有兵种已招募完毕！', panelX + panelW / 2, listStartY + 40);
      return;
    }

    for (let i = 0; i < recruitable.length; i++) {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const cx = panelX + 10 + col * (cardW + cardGap);
      const cy = listStartY + row * (cardH + cardGap);
      const unit = recruitable[i];

      // 卡片背景
      ctx.fillStyle = unit.affordable ? '#1e293b' : '#1a2332';
      ctx.fillRect(cx, cy, cardW, cardH);
      ctx.strokeStyle = unit.affordable ? '#3b82f6' : '#334155';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(cx, cy, cardW, cardH);

      // 图标
      ctx.fillStyle = unit.affordable ? '#60a5fa' : '#475569';
      ctx.font = 'bold 22px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(unit.icon || '?', cx + 25, cy + 25);

      // 名称
      ctx.fillStyle = unit.affordable ? '#e2e8f0' : '#64748b';
      ctx.font = 'bold 11px sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(unit.name || '?', cx + 48, cy + 18);

      // 战斗风格
      ctx.fillStyle = '#94a3b8';
      ctx.font = '9px sans-serif';
      const styles = (unit.combatStyles || []).map(s => styleNames[s] || s).join('/');
      ctx.fillText(styles, cx + 48, cy + 32);

      // 特殊能力
      if (unit.special) {
        ctx.fillStyle = '#64748b';
        ctx.font = '8px sans-serif';
        ctx.fillText('特: ' + (unit.special.desc || unit.special.type || '未知'), cx + 48, cy + 45);
      }

      // 费用
      ctx.fillStyle = unit.affordable ? '#fbbf24' : '#ef4444';
      ctx.font = 'bold 10px sans-serif';
      ctx.textAlign = 'left';
      const costText = `⭐${unit.cost.starDust} 💰${unit.cost.gold}`;
      ctx.fillText(costText, cx + 8, cy + 68);

      // 招募提示
      ctx.fillStyle = unit.affordable ? '#4ade80' : '#ef4444';
      ctx.font = '9px sans-serif';
      ctx.textAlign = 'right';
      ctx.fillText(unit.affordable ? '点击招募' : '资源不足', cx + cardW - 8, cy + 68);
    }
  }

  /**
   * 绘制建筑详情/升级面板(P33)
   * 复用 _drawUnitDetailPanel 视觉风格但更紧凑(建筑无技能列表)
   */
  /**
   * 布阵界面羁绊卡几何（渲染与 Game 点击命中同源）
   * 固定 4 类风格，顺序 melee → ranged → defense → magic，正方形卡
   */
  static autoSynergyCardLayout(screenWidth, y = 170) {
    const count = 4;
    const size = 65;
    const gap = 6;
    const startX = (screenWidth - (count * size + (count - 1) * gap)) / 2;
    return { count, size, gap, y, startX };
  }

  /**
   * 布阵界面完整垂直布局（P36：渲染与 Game 命中框的单一真相源）
   *
   * 背景：此前 RenderSystem 与 Game 各自硬编码 buildY / unitListY 等锚点，
   * 两边必须手工同步（P33 曾因不同步导致命中错位）。这里改为一次性算出全部
   * 区块的 label / 内容 Y 与几何，两侧共用同一份结果。
   *
   * 垂直节奏（自上而下）：标题 → 兵种槽位 → 羁绊 → 建筑强化 → 已拥有兵种列表
   * 区块之间统一留 SECTION_GAP（按屏高分档，矮屏不至于把列表挤没）。
   *
   * @param {number} w 屏宽（inner 坐标）
   * @param {number} h 屏高（inner 坐标）
   */
  static deployLayout(w, h) {
    // 区块间距：屏高越大留得越开（矮屏 14 / 中屏 18 / 高屏 22）
    const SECTION_GAP = h >= 780 ? 24 : (h >= 680 ? 20 : 16);

    const titleY = 25;

    // --- 兵种槽位（顶部区域，须避开统一资源栏 0~50 的覆盖带）---
    const slotLabelY = 62;
    const slotY = 72;
    const slotH = 85;

    // --- 羁绊（4 类风格卡，正方形）---
    const synLabelY = slotY + slotH + SECTION_GAP;
    const synPanel = RenderSystem.autoSynergyCardLayout(w, synLabelY + 10);

    // --- 建筑强化（3 张卡）---
    const bldLabelY = synPanel.y + synPanel.size + SECTION_GAP;
    const bldY = bldLabelY + 10;
    const bldH = 50;

    // --- 已拥有兵种（可滚动区，标题固定不随滚动）---
    const unitLabelY = bldY + bldH + SECTION_GAP;
    const unitListY = unitLabelY + 8;

    return {
      sectionGap: SECTION_GAP,
      titleY,
      slot: {
        y: slotY,
        h: slotH,
        labelY: slotLabelY,
        gap: 5,
        count: 6,
        w: rowItemWidth(6, 5, w, 8, LAYOUT_MIN.unitSlot, LAYOUT_DESIGN_MAX.unitSlot),
      },
      synergy: Object.assign({ labelY: synLabelY }, synPanel),
      building: {
        y: bldY,
        h: bldH,
        labelY: bldLabelY,
        w: 105,
        gap: 8,
        count: 3,
      },
      unit: {
        listY: unitListY,
        labelY: unitLabelY,
        w: rowItemWidth(5, 5, w, 8, LAYOUT_MIN.unitCard, LAYOUT_DESIGN_MAX.unitCard),
        h: 72,
        gap: 8,
        perRow: 5,
      },
      // 可滚动区底边（底部两行提示之上留 14px）
      scrollAreaBottom: h - 94,
      tipY1: h - 80,
      tipY2: h - 64,
    };
  }

  /**
   * 羁绊详情面板（P35：点击羁绊卡弹出，说明激活方式与各级效果）
   */
  _drawSynergyDetailPanel(gameState) {
    const { ctx } = this;
    const w = this.screenWidth;
    const h = this.screenHeight;
    const d = gameState.synergyDetailData;
    if (!d) return;

    // 遮罩
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(0, 0, w, h);

    const { panelW, panelH, panelX, panelY } = RenderSystem.synergyDetailPanelLayout(w, h);
    const styleColor = { melee: '#ef4444', ranged: '#22c55e', defense: '#3b82f6', magic: '#a855f7' }[d.style] || '#a855f7';

    ctx.fillStyle = '#1e293b';
    ctx.fillRect(panelX, panelY, panelW, panelH);
    ctx.strokeStyle = styleColor;
    ctx.lineWidth = 2;
    ctx.strokeRect(panelX, panelY, panelW, panelH);

    ctx.textBaseline = 'middle';

    // 关闭按钮
    ctx.fillStyle = '#94a3b8';
    ctx.font = 'bold 18px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('×', panelX + panelW - 20, panelY + 20);

    // 标题：图标 + 羁绊名 + 当前等级
    ctx.textAlign = 'left';
    ctx.fillStyle = styleColor;
    ctx.font = 'bold 16px sans-serif';
    ctx.fillText(`${d.icon || '?'} ${d.name}`, panelX + 18, panelY + 26);
    ctx.textAlign = 'right';
    ctx.fillStyle = d.active ? '#fbbf24' : '#94a3b8';
    ctx.font = 'bold 12px sans-serif';
    ctx.fillText(d.active ? `Lv.${d.level}/${d.maxLevel}` : '未激活', panelX + panelW - 38, panelY + 26);

    let y = panelY + 50;
    const leftX = panelX + 18;

    // ---- 如何激活 ----
    ctx.textAlign = 'left';
    ctx.fillStyle = '#c084fc';
    ctx.font = 'bold 11px sans-serif';
    ctx.fillText('如何激活', leftX, y);
    y += 17;
    ctx.fillStyle = '#e2e8f0';
    ctx.font = '11px sans-serif';
    ctx.fillText(d.activateDesc, leftX + 8, y);
    y += 16;
    ctx.fillStyle = d.active ? '#4ade80' : '#94a3b8';
    ctx.fillText(d.currentDesc, leftX + 8, y);
    y += 16;
    if (d.sourceUnits && d.sourceUnits.length > 0) {
      ctx.fillStyle = '#94a3b8';
      ctx.font = '10px sans-serif';
      const names = d.sourceUnits.map((u) => `${u.icon}${u.name}`).join(' ');
      ctx.fillText('贡献兵种: ' + names, leftX + 8, y);
      y += 16;
    }

    // ---- 等级效果表 ----
    y += 6;
    ctx.fillStyle = '#c084fc';
    ctx.font = 'bold 11px sans-serif';
    ctx.fillText('等级效果', leftX, y);
    y += 17;
    for (const lv of d.levels || []) {
      if (y > panelY + panelH - 30) break;
      ctx.font = 'bold 10px sans-serif';
      ctx.fillStyle = lv.isCurrent ? '#fbbf24' : (lv.active ? '#4ade80' : '#64748b');
      ctx.textAlign = 'left';
      ctx.fillText(`Lv.${lv.level}`, leftX + 8, y);
      ctx.font = '10px sans-serif';
      ctx.fillStyle = lv.isCurrent ? '#fde68a' : (lv.active ? '#cbd5e1' : '#64748b');
      ctx.fillText((lv.effects || []).join('  '), leftX + 58, y);
      y += 15;
    }

    // 底部提示
    ctx.textAlign = 'center';
    ctx.fillStyle = '#64748b';
    ctx.font = '9px sans-serif';
    ctx.fillText(d.tip || '', panelX + panelW / 2, panelY + panelH - 14);
  }

  /**
   * 建筑效果文案（当前等级）
   */
  static buildingEffectLines(buildingType, stats) {
    if (!stats) return ['—'];
    if (buildingType === 'barracks') {
      return [
        `生命 ${stats.hp || 0}    出兵速率 ${stats.warriorRate || 0}`,
        `防御 ${stats.defense || 0}    建造 ${stats.cost || 0}`,
      ];
    }
    if (buildingType === 'arrow_tower') {
      return [
        `生命 ${stats.hp || 0}    攻击 ${stats.attackDamage || 0}`,
        `射程 ${stats.range || 0}    攻速 ${stats.attackCooldown || 0}s    防御 ${stats.defense || 0}`,
      ];
    }
    if (buildingType === 'gold_mine') {
      return [
        `生命 ${stats.hp || 0}    产金 ${stats.goldRate || 0}/秒`,
        `建造 ${stats.cost || 0}`,
      ];
    }
    return ['—'];
  }

  /**
   * 建筑升级前后对比文案（当前等级 → 下一级）
   */
  static buildingDiffLines(buildingType, cur, next) {
    if (!cur || !next) return [];
    if (buildingType === 'barracks') {
      return [
        `生命 ${cur.hp || 0} → ${next.hp || 0}    出兵速率 ${cur.warriorRate || 0} → ${next.warriorRate || 0}`,
        `防御 ${cur.defense || 0} → ${next.defense || 0}    建造 ${cur.cost || 0} → ${next.cost || 0}`,
      ];
    }
    if (buildingType === 'arrow_tower') {
      return [
        `生命 ${cur.hp || 0} → ${next.hp || 0}    攻击 ${cur.attackDamage || 0} → ${next.attackDamage || 0}`,
        `射程 ${cur.range || 0} → ${next.range || 0}    攻速 ${cur.attackCooldown || 0} → ${next.attackCooldown || 0}s`,
      ];
    }
    if (buildingType === 'gold_mine') {
      return [
        `生命 ${cur.hp || 0} → ${next.hp || 0}    产金 ${cur.goldRate || 0} → ${next.goldRate || 0}/秒`,
        `建造 ${cur.cost || 0} → ${next.cost || 0}`,
      ];
    }
    return [];
  }

  _drawBuildingDetailPanel(gameState) {
    const { ctx } = this;
    const w = this.screenWidth;
    const h = this.screenHeight;
    const bld = gameState.buildingDetailData;
    if (!bld) return;

    // 遮罩
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(0, 0, w, h);

    // 布局（与 Game._handleBuildingDetailTap 共享，含升级按钮命中区）
    const L = RenderSystem.buildingDetailPanelLayout(w, h);

    // 面板背景
    ctx.fillStyle = '#1e293b';
    ctx.fillRect(L.panelX, L.panelY, L.panelW, L.panelH);
    ctx.strokeStyle = '#f59e0b';
    ctx.lineWidth = 2;
    ctx.strokeRect(L.panelX, L.panelY, L.panelW, L.panelH);

    ctx.textBaseline = 'middle';

    // 关闭按钮
    ctx.fillStyle = '#94a3b8';
    ctx.font = 'bold 18px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('×', L.panelX + L.panelW - 20, L.panelY + 20);

    // 标题: 建筑名 + 等级（maxLevel 取自 upgradeCost 同源数据）
    const maxLv = bld.maxLevel || (bld.upgradeCost && bld.upgradeCost.maxLevel) || bld.level || 1;
    ctx.fillStyle = '#fbbf24';
    ctx.font = 'bold 17px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(`${bld.icon || '?'} ${bld.name || bld.type} Lv.${bld.level}/${maxLv}`, L.panelX + 18, L.panelY + 26);

    const leftX = L.panelX + 18;
    let y = L.panelY + 50;

    // ---- 当前效果 ----
    ctx.fillStyle = '#94a3b8';
    ctx.font = 'bold 11px sans-serif';
    ctx.fillText(`当前效果 (Lv.${bld.level})`, leftX, y);
    y += 17;
    ctx.fillStyle = '#e2e8f0';
    ctx.font = '11px sans-serif';
    for (const line of RenderSystem.buildingEffectLines(bld.type, bld.stats)) {
      ctx.fillText(line, leftX + 8, y);
      y += 15;
    }

    // ---- 下一级 / 满级 ----
    const cost = bld.upgradeCost;
    const maxed = !cost || cost.maxed || !bld.nextStats;
    y += 6;
    if (maxed) {
      ctx.fillStyle = '#4ade80';
      ctx.font = 'bold 11px sans-serif';
      ctx.fillText('已满级，无法继续强化', leftX, y);
    } else {
      ctx.fillStyle = '#94a3b8';
      ctx.font = 'bold 11px sans-serif';
      ctx.fillText(`升级至 Lv.${bld.level + 1}`, leftX, y);
      y += 17;
      ctx.fillStyle = '#cbd5e1';
      ctx.font = '11px sans-serif';
      for (const line of RenderSystem.buildingDiffLines(bld.type, bld.stats, bld.nextStats)) {
        ctx.fillText(line, leftX + 8, y);
        y += 15;
      }
      // 升级花费（与 DeploymentSystem.upgradeBuilding 同源）
      const cur = bld.currency || { stardust: 0, gold: 0 };
      const okStar = cur.stardust >= cost.starDust;
      const okGold = cur.gold >= cost.gold;
      y += 5;
      ctx.fillStyle = okStar ? '#c4b5fd' : '#f87171';
      ctx.fillText(`⭐ 星尘 ${cost.starDust}（拥有 ${cur.stardust}）${okStar ? '✓' : '✕'}`, leftX + 8, y);
      y += 15;
      ctx.fillStyle = okGold ? '#fbbf24' : '#f87171';
      ctx.fillText(`💰 金币 ${cost.gold}（拥有 ${cur.gold}）${okGold ? '✓' : '✕'}`, leftX + 8, y);
    }

    // ---- 升级按钮（命中区由 buildingDetailPanelLayout 统一给出）----
    const canUpgrade = !maxed && !!bld.canAfford;
    ctx.fillStyle = canUpgrade ? '#f59e0b' : '#475569';
    ctx.fillRect(L.btnX, L.btnY, L.btnW, L.btnH);
    ctx.fillStyle = canUpgrade ? '#0f172a' : '#94a3b8';
    ctx.font = 'bold 14px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(maxed ? '已满级' : (canUpgrade ? '升 级' : '资源不足'), L.btnX + L.btnW / 2, L.btnY + L.btnH / 2);
  }

  /**
   * 绘制兵种详情/升级面板
   */
  _drawUnitDetailPanel(gameState) {
    const { ctx } = this;
    const w = this.screenWidth;
    const h = this.screenHeight;
    const unit = gameState.unitDetailData;
    const profile = gameState.profile;

    // 遮罩
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(0, 0, w, h);

    // 面板（加高适配 6 行技能列表；布局与 Game._handleUnitDetailTap 共享 unitDetailPanelLayout）
    const { panelW, panelH, panelX, panelY } = RenderSystem.unitDetailPanelLayout(w, h);

    const qColors = ['#9ca3af', '#22c55e', '#3b82f6', '#a855f7', '#f97316', '#ef4444'];
    // 品质用名称描述（与抽卡界面一致），颜色仅用于视觉强调不再作为文字描述
    const qNames = ['普通', '精良', '稀有', '史诗', '传说', '神话'];
    const qColor = qColors[(unit.quality || 1) - 1] || '#9ca3af';
    const qName = qNames[(unit.quality || 1) - 1] || '?';

    // 面板背景
    ctx.fillStyle = '#1e293b';
    ctx.fillRect(panelX, panelY, panelW, panelH);
    ctx.strokeStyle = qColor;
    ctx.lineWidth = 2;
    ctx.strokeRect(panelX, panelY, panelW, panelH);

    // 标题栏
    ctx.fillStyle = qColor;
    ctx.globalAlpha = 0.2;
    ctx.fillRect(panelX, panelY, panelW, 35);
    ctx.globalAlpha = 1;

    ctx.fillStyle = '#e2e8f0';
    ctx.font = 'bold 15px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('兵种详情', panelX + panelW / 2, panelY + 18);

    // 关闭按钮
    const closeX = panelX + panelW - 35;
    const closeY = panelY + 5;
    ctx.fillStyle = '#dc2626';
    ctx.fillRect(closeX, closeY, 30, 30);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 16px sans-serif';
    ctx.fillText('×', closeX + 15, closeY + 15);

    // === 单位图标 + 名称 ===
    const iconY = panelY + 65;
    ctx.font = 'bold 36px sans-serif';
    ctx.fillText(unit.icon || '?', panelX + 50, iconY);

    ctx.textAlign = 'left';
    ctx.fillStyle = '#e2e8f0';
    ctx.font = 'bold 16px sans-serif';
    ctx.fillText(unit.name || '?', panelX + 90, panelY + 55);

    // 品质标签
    ctx.fillStyle = qColor;
    ctx.font = 'bold 11px sans-serif';
    ctx.fillText(`[${qName}]`, panelX + 90, panelY + 72);

    // 等级
    ctx.fillStyle = '#fbbf24';
    ctx.font = 'bold 13px sans-serif';
    ctx.fillText(`Lv.${unit.level}`, panelX + 90, panelY + 88);

    // 战斗风格
    const styleNames = { melee: '近战', ranged: '远程', defense: '防御', magic: '法术' };
    const styles = (unit.combatStyles || []).map(s => styleNames[s] || s).join('/');
    ctx.fillStyle = '#94a3b8';
    ctx.font = '10px sans-serif';
    ctx.fillText(styles, panelX + 130, panelY + 88);

    // === 属性区 ===
    const statsY = panelY + 110;
    ctx.fillStyle = '#334155';
    ctx.fillRect(panelX + 10, statsY, panelW - 20, 70);
    ctx.strokeStyle = '#475569';
    ctx.lineWidth = 1;
    ctx.strokeRect(panelX + 10, statsY, panelW - 20, 70);

    ctx.textAlign = 'left';
    ctx.font = '11px sans-serif';
    const colX1 = panelX + 20;
    const colX2 = panelX + panelW / 2 + 5;
    const rowH = 16;

    ctx.fillStyle = '#94a3b8';
    ctx.fillText('攻击', colX1, statsY + 15);
    ctx.fillText('生命', colX2, statsY + 15);
    ctx.fillText('速度', colX1, statsY + 15 + rowH);
    ctx.fillText('射程', colX2, statsY + 15 + rowH);
    ctx.fillText('生产', colX1, statsY + 15 + rowH * 2);

    ctx.fillStyle = '#e2e8f0';
    ctx.font = 'bold 11px sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(unit.attackCoeff.toFixed(2), colX1 + 60, statsY + 15);
    ctx.fillText(unit.hpCoeff.toFixed(2), colX2 + 60, statsY + 15);
    ctx.fillText(unit.speedCoeff.toFixed(2), colX1 + 60, statsY + 15 + rowH);
    ctx.fillText(`${unit.attackRange}格`, colX2 + 60, statsY + 15 + rowH);
    ctx.fillText(`${unit.productionSpeed.toFixed(1)}x`, colX1 + 60, statsY + 15 + rowH * 2);

    // === 特殊技能 ===
    let nextY = statsY + 80;
    if (unit.special && unit.special.desc) {
      ctx.textAlign = 'left';
      ctx.fillStyle = '#94a3b8';
      ctx.font = '10px sans-serif';
      ctx.fillText('特殊:', panelX + 15, nextY);
      ctx.fillStyle = '#c084fc';
      ctx.fillText(unit.special.desc, panelX + 50, nextY);
      nextY += 20;
    }

    // === 技能列表（3蓝默认 + 2紫Lv.6/12 + 1橙Lv.18；兵种品质≥5默认解锁橙色主动） ===
    const skills = unit.skills || [];
    if (skills.length > 0) {
      // 解锁判定（与 SkillSystem.getUnitSkillList 规则一致）
      const isSkillUnlocked = (sk) =>
        (sk.unlockLevel || 1) <= 1
        || (sk.kind === 'active' && (unit.quality || 1) >= 5)
        || (unit.level || 1) >= (sk.unlockLevel || 1);
      const unlockedCount = skills.filter(isSkillUnlocked).length;

      // 区块标题行
      ctx.textAlign = 'left';
      ctx.fillStyle = '#94a3b8';
      ctx.font = 'bold 10px sans-serif';
      ctx.fillText(`技能 (${unlockedCount}/${skills.length})`, panelX + 15, nextY);
      ctx.textAlign = 'right';
      ctx.font = '9px sans-serif';
      ctx.fillStyle = '#64748b';
      ctx.fillText('紫6/12级 · 橙18级解锁', panelX + panelW - 15, nextY);
      nextY += 5;

      // 技能类型 → 短标签
      const pct = (v) => '+' + Math.round(v * 100) + '%';
      const skLabel = (sk) => {
        switch (sk.type) {
          case 'attack_bonus': return '攻击' + pct(sk.value);
          case 'damage_bonus': return '伤害' + pct(sk.value);
          case 'crit_bonus': return '暴击' + pct(sk.value);
          case 'crit_damage': return '暴伤' + pct(sk.value);
          case 'damage_reduction': return '减伤' + pct(sk.value);
          case 'damage_reflect': return '反伤' + pct(sk.value);
          case 'armor_pierce': return '穿甲' + pct(sk.value);
          case 'spell_damage': return '法伤' + pct(sk.value);
          case 'execute_bonus': return '残血攻' + pct(sk.value);
          case 'kill_bonus': return '击杀攻' + pct(sk.value);
          case 'post_battle_heal': return '回血' + pct(sk.value);
          case 'splash': return '溅射' + pct(sk.value);
          case 'speed_bonus': return '速度' + pct(sk.value);
          case 'first_strike': return '先手攻击';
          case 'revive': return pct(sk.value) + '复活' + (sk.count || 1) + '人';
          case 'single': return `单体爆发·${sk.cooldown}s`;
          case 'aoe': return `范围杀伤·${sk.cooldown}s`;
          case 'pierce': return `直线穿透·${sk.cooldown}s`;
          case 'ray': return `毁灭射线·${sk.cooldown}s`;
          case 'taunt': return `嘲讽控场·${sk.cooldown}s`;
          case 'dash': return `极速冲刺·${sk.cooldown}s`;
          case 'summon': return `召唤援军·${sk.cooldown}s`;
          default: return '';
        }
      };
      // 技能品质色（蓝/紫/橙）
      const skQColors = { 3: '#3b82f6', 4: '#a855f7', 5: '#f97316' };

      for (const sk of skills) {
        nextY += 14;
        const unlocked = isSkillUnlocked(sk);

        // 品质色点
        ctx.beginPath();
        ctx.arc(panelX + 19, nextY - 3, 3, 0, Math.PI * 2);
        ctx.fillStyle = unlocked ? (skQColors[sk.quality] || '#94a3b8') : '#475569';
        ctx.fill();

        // 技能名（锁定置灰）
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = unlocked ? '#e2e8f0' : '#64748b';
        ctx.font = 'bold 10px sans-serif';
        ctx.fillText(sk.name, panelX + 27, nextY - 3);

        // 被动/主动 + 数值标签
        ctx.fillStyle = unlocked ? '#94a3b8' : '#475569';
        ctx.font = '9px sans-serif';
        ctx.fillText(`${sk.kind === 'active' ? '主动' : '被动'}·${skLabel(sk)}`, panelX + 92, nextY - 3);

        // 右侧解锁状态
        ctx.textAlign = 'right';
        if (!unlocked) {
          ctx.fillStyle = '#f87171';
          ctx.font = '9px sans-serif';
          ctx.fillText('🔒Lv.' + sk.unlockLevel, panelX + panelW - 15, nextY - 3);
        } else if (sk.kind === 'active') {
          ctx.fillStyle = '#fbbf24';
          ctx.font = 'bold 9px sans-serif';
          ctx.fillText('⚡主动', panelX + panelW - 15, nextY - 3);
        } else {
          ctx.fillStyle = '#4ade80';
          ctx.font = '9px sans-serif';
          ctx.fillText('✓', panelX + panelW - 15, nextY - 3);
        }
      }
      nextY += 14;
    }

    // === 招募进度 ===
    const recruitNeeded = (unit.recruitRequired || 0) * unit.level;
    const recruitCurrent = unit.recruitCount || 0;
    const recruitReady = recruitNeeded > 0 && recruitCurrent >= recruitNeeded;
    const isMaxLevel = unit.level >= MAX_UNIT_LEVEL;

    ctx.textAlign = 'left';
    ctx.fillStyle = '#94a3b8';
    ctx.font = '10px sans-serif';
    ctx.fillText('招募进度:', panelX + 15, nextY);

    ctx.fillStyle = isMaxLevel ? '#fbbf24' : (recruitReady ? '#4ade80' : '#94a3b8');
    ctx.textAlign = 'right';
    ctx.font = 'bold 10px sans-serif';
    if (isMaxLevel) {
      ctx.fillText('已满级', panelX + panelW - 15, nextY);
    } else {
      ctx.fillText(`${recruitCurrent}/${recruitNeeded}`, panelX + panelW - 15, nextY);
    }
    nextY += 8;

    // 进度条
    if (!isMaxLevel && recruitNeeded > 0) {
      const barX = panelX + 15;
      const barW = panelW - 30;
      const barH = 6;
      ctx.fillStyle = '#334155';
      ctx.fillRect(barX, nextY, barW, barH);
      const progress = Math.min(1, recruitCurrent / recruitNeeded);
      ctx.fillStyle = recruitReady ? '#4ade80' : '#3b82f6';
      ctx.fillRect(barX, nextY, barW * progress, barH);
    }
    nextY += 20;

    // === 升级消耗 ===
    let canUpgrade = false;
    if (!isMaxLevel) {
      const cost = unit.upgradeCost || { starDust: 0, gold: 0 };
      const scaledStarDust = Math.floor((cost.starDust || 0) * Math.pow(UPGRADE_COST_GROWTH, unit.level - 1));
      const scaledGold = Math.floor((cost.gold || 0) * Math.pow(UPGRADE_COST_GROWTH, unit.level - 1));
      const hasStarDust = (profile?.stardust || 0) >= scaledStarDust;
      const hasGold = (profile?.gold || 0) >= scaledGold;
      canUpgrade = recruitReady && hasStarDust && hasGold;

      ctx.textAlign = 'left';
      ctx.fillStyle = '#94a3b8';
      ctx.font = '10px sans-serif';
      ctx.fillText('升级消耗:', panelX + 15, nextY);

      ctx.textAlign = 'right';
      ctx.font = 'bold 10px sans-serif';
      ctx.fillStyle = hasStarDust ? '#4ade80' : '#ef4444';
      ctx.fillText(`✨${scaledStarDust}`, panelX + panelW / 2, nextY);
      ctx.fillStyle = hasGold ? '#4ade80' : '#ef4444';
      ctx.fillText(`💰${scaledGold}`, panelX + panelW - 15, nextY);
      nextY += 15;
    }

    // === 底部按钮区：上阵（左） + 升级（右） ===
    const deployedUnits = profile?.deployment?.units || [];
    const isDeployed = deployedUnits.includes(unit.id);
    const btnH = 38;
    const btnY = panelY + panelH - 50;
    const btnGap = 10;
    const btnW = (panelW - 40 - btnGap) / 2;
    const deployBtnX = panelX + 20;
    const upgradeBtnX = deployBtnX + btnW + btnGap;

    // 上阵按钮
    const slotsFull = !isDeployed && deployedUnits.filter(Boolean).length >= 6;
    const canDeploy = !isDeployed && !slotsFull;
    ctx.fillStyle = isDeployed ? '#14532d' : (canDeploy ? '#16a34a' : '#334155');
    ctx.fillRect(deployBtnX, btnY, btnW, btnH);
    ctx.strokeStyle = isDeployed ? '#4ade80' : (canDeploy ? '#86efac' : '#475569');
    ctx.lineWidth = 1;
    ctx.strokeRect(deployBtnX, btnY, btnW, btnH);
    ctx.fillStyle = isDeployed ? '#4ade80' : (canDeploy ? '#ffffff' : '#64748b');
    ctx.font = 'bold 13px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(isDeployed ? '✓ 已上阵' : '⚔ 上阵', deployBtnX + btnW / 2, btnY + btnH / 2);

    // 升级按钮 / 已满级
    if (!isMaxLevel) {
      ctx.fillStyle = canUpgrade ? '#2563eb' : '#334155';
      ctx.fillRect(upgradeBtnX, btnY, btnW, btnH);
      ctx.strokeStyle = canUpgrade ? '#60a5fa' : '#475569';
      ctx.lineWidth = 1;
      ctx.strokeRect(upgradeBtnX, btnY, btnW, btnH);

      ctx.fillStyle = canUpgrade ? '#ffffff' : '#64748b';
      ctx.font = 'bold 13px sans-serif';
      ctx.fillText(canUpgrade ? '⬆ 升级' : '条件不足', upgradeBtnX + btnW / 2, btnY + btnH / 2);
    } else {
      ctx.fillStyle = '#fbbf24';
      ctx.font = 'bold 14px sans-serif';
      ctx.fillText('★ 已满级 ★', upgradeBtnX + btnW / 2, btnY + btnH / 2);
    }
  }

  /**
   * 绘制游戏结束画面
   */
  drawGameOver(gameState) {
    const { ctx } = this;
    const isWin = gameState.gameStatus === 'won';
    const cx = this.screenWidth / 2;
    const cy = this.screenHeight / 2;

    // 半透明遮罩
    ctx.fillStyle = 'rgba(0,0,0,0.82)';
    ctx.fillRect(0, 0, this.screenWidth, this.screenHeight);

    // 标题
    ctx.fillStyle = isWin ? '#4ade80' : '#f87171';
    ctx.font = 'bold 36px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(isWin ? '胜 利!' : '失 败', cx, cy - 80);

    // 对手信息
    ctx.fillStyle = '#94a3b8';
    ctx.font = '13px sans-serif';
    ctx.fillText('对手: ' + (gameState.enemyName || 'AI'), cx, cy - 50);

    // 奖励信息（金币 + 星尘）
    const rewards = gameState.lastRewards || {};
    if (rewards.gold || rewards.stardust) {
      ctx.fillStyle = '#fbbf24';
      ctx.font = 'bold 16px sans-serif';
      let rewardText = '';
      if (rewards.gold) rewardText += '💰' + rewards.gold + ' ';
      if (rewards.stardust) rewardText += '✨' + rewards.stardust;
      ctx.fillText('奖励: ' + rewardText, cx, cy - 22);
    }

    // 天梯奖杯变化（胜利 ▲ 绿 / 失败 ▼ 红，附当前段位）
    if (rewards.trophyDelta !== undefined && rewards.tier) {
      const up = rewards.trophyDelta >= 0;
      ctx.fillStyle = up ? '#4ade80' : '#f87171';
      ctx.font = 'bold 15px sans-serif';
      const arrow = up ? '▲+' : '▼';
      ctx.fillText(`🏆 ${arrow}${rewards.trophyDelta}  →  ${rewards.trophies}杯`, cx, cy - 4);
      // 段位变动标记
      if (rewards.tierUp) {
        ctx.fillStyle = '#fbbf24';
        ctx.font = 'bold 12px sans-serif';
        ctx.fillText(`⬆ 晋升【${rewards.tier.icon}${rewards.tier.label}】！`, cx, cy + 12);
      } else {
        ctx.fillStyle = '#94a3b8';
        ctx.font = '11px sans-serif';
        ctx.fillText(`${rewards.tier.icon}${rewards.tier.label}段位`, cx, cy + 12);
      }
    }

    // 招募进度
    const recruitSummary = gameState.recruitSummary || [];
    if (recruitSummary.length > 0) {
      const recruitText = recruitSummary.slice(0, 4).map(r => `${r.icon}×${r.count}`).join('  ');
      ctx.fillStyle = '#94a3b8';
      ctx.font = '11px sans-serif';
      ctx.fillText('本局招募: ' + recruitText + (recruitSummary.length > 4 ? ' ...' : ''), cx, cy + 30);

      // 胜利时显示招募进度减半提示
      if (isWin) {
        ctx.fillStyle = '#a78bfa';
        ctx.font = '10px sans-serif';
        ctx.fillText('（胜利招募进度×0.5，通过抽卡获取更多兵种）', cx, cy + 46);
      }
    }

    if (isWin) {
      // 提示
      ctx.fillStyle = '#4ade80';
      ctx.font = 'bold 14px sans-serif';
      ctx.fillText('▼ 点击返回大厅 ▼', cx, cy + 64);
    } else {
      ctx.fillStyle = '#fff';
      ctx.font = '15px sans-serif';
      ctx.fillText('你的大本营被摧毁了', cx, cy + 48);

      ctx.fillStyle = '#f87171';
      ctx.font = 'bold 14px sans-serif';
      ctx.fillText('▼ 点击返回大厅 ▼', cx, cy + 68);
    }

    // 战绩分享按钮（Phase 5，仅胜利时显示；失败不再显示炫耀入口）
    if (isWin) {
      const sbW = 150, sbH = 34;
      const sbX = cx - sbW / 2, sbY = cy + 78;
      ctx.fillStyle = '#0891b2';
      ctx.fillRect(sbX, sbY, sbW, sbH);
      ctx.strokeStyle = '#22d3ee';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(sbX, sbY, sbW, sbH);
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 13px sans-serif';
      ctx.fillText('📤 炫耀战绩', sbX + sbW / 2, sbY + sbH / 2);
    }
  }

  /**
   * 绘制主城大厅
   */
  /**
   * 新手引导分步教学叠加层（P38 重做：遮罩挖洞 + 贴合高亮 + 文案卡避让）
   * tutorial = { step, text, target } | null
   *  - target 为屏幕矩形 {x,y,w,h}（大厅按钮/返回按钮）或 hex {q,r}（战斗格子）
   * 几何统一由 RenderSystem.tutorialLayout() 计算：渲染与点击命中共用同一份（P36 铁律）
   */
  _drawTutorialOverlay(gameState, inputSystem) {
    const tut = gameState.tutorial;
    if (!tut) return;
    const { ctx } = this;
    const w = this.screenWidth;
    const h = this.screenHeight;
    const L = RenderSystem.tutorialLayout(tut, inputSystem, w, h);
    if (!L) return;

    // 1. 半透明遮罩（挖洞）：外框顺时针 + 高亮区逆时针 → nonzero 规则下高亮区不填充，
    //    即圆圈内部完全透明，玩家能看到底下的真实按钮。
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, w, h);
    if (L.kind === 'circle') {
      ctx.arc(L.cx, L.cy, L.circleR, 0, Math.PI * 2, true);
    } else {
      this._roundRectPathCCW(L.holeX, L.holeY, L.holeW, L.holeH, L.holeR);
    }
    ctx.fillStyle = 'rgba(2,6,23,0.72)';
    ctx.fill();
    ctx.restore();

    // 2. 高亮圈（呼吸金色描边，紧贴高亮区外沿，不再是一个脱离目标的大圆）
    const pulse = Math.sin(Date.now() / 260) * 0.5 + 0.5;
    ctx.save();
    ctx.strokeStyle = `rgba(251,191,36,${0.72 + pulse * 0.28})`;
    ctx.lineWidth = 2 + pulse * 1.2;
    ctx.shadowColor = 'rgba(251,191,36,0.8)';
    ctx.shadowBlur = 8 + pulse * 6;
    if (L.kind === 'circle') {
      ctx.beginPath();
      ctx.arc(L.cx, L.cy, L.ringR, 0, Math.PI * 2);
      ctx.stroke();
    } else {
      this._roundRectPath(L.ringX, L.ringY, L.ringW, L.ringH, L.ringR);
      ctx.stroke();
    }
    ctx.restore();

    // 3. 指示箭头（固定落在「高亮区 ↔ 文案卡」之间，朝高亮区指）
    ctx.fillStyle = '#fbbf24';
    ctx.font = 'bold 20px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(L.arrowChar, L.arrowX, L.arrowY);

    // 4. 文案卡（自适应：高亮区下方放得下就放下方，否则翻到上方，绝不压住高亮区）
    const cardX = L.cardX;
    const cardY = L.cardY;
    const cardW = L.cardW;
    const cardH = L.cardH;
    this._roundRectPath(cardX, cardY, cardW, cardH, 12);
    ctx.fillStyle = 'rgba(15,23,42,0.94)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(251,191,36,0.6)';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // 步骤标题
    ctx.fillStyle = '#fbbf24';
    ctx.font = 'bold 14px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`\u65b0\u624b\u5f15\u5bfc ${tut.step + 1}/4`, w / 2, cardY + 20);

    // 正文（按字符宽度自动换行，最多3行）
    ctx.fillStyle = '#e2e8f0';
    ctx.font = '12px sans-serif';
    const maxW = cardW - 32;
    const lines = [];
    let line = '';
    for (const ch of (tut.text || '')) {
      const t = line + ch;
      if (ctx.measureText(t).width > maxW && line) {
        lines.push(line);
        line = ch;
      } else {
        line = t;
      }
    }
    if (line) lines.push(line);
    for (let i = 0; i < Math.min(lines.length, 3); i++) {
      ctx.fillText(lines[i], w / 2, cardY + 42 + i * 16);
    }

    // 底部提示
    ctx.fillStyle = '#94a3b8';
    ctx.font = '10px sans-serif';
    ctx.fillText('\u70b9\u51fb\u9ad8\u4eae\u7684\u533a\u57df\u7ee7\u7eed\u5f15\u5bfc', w / 2, cardY + cardH - 12);
  }

  /**
   * 新手引导几何布局（P38：渲染 /drawTutorialOverlay 与 点击命中 /Game._interceptTutorialClick 共用）
   * @param {{step:number,text:string,target:object}} tut
   * @param {object} inputSystem 战斗中取 scale/camera 用（inner 坐标系）
   * @returns {object|null} 布局对象（null = 无可高亮目标）
   *
   * 关键约定：
   *  - holeX/Y/W/H：高亮（挖洞）矩形；kind='circle' 时改看 cx/cy/circleR
   *  - cardX/Y/W/H：文案卡，自适应放在高亮区下方或上方，**保证与高亮区不相交**
   *  - arrowX/Y/Char：箭头固定落在高亮区与文案卡之间
   *  - 一切坐标均为 inner 坐标系（safeArea 变换之内），与 Game 点击反推后的 y 同坐标系
   */
  static tutorialLayout(tut, inputSystem, screenW, screenH) {
    if (!tut || !tut.target) return null;
    const w = screenW;
    const h = screenH;
    const target = tut.target;

    const PAD = 8;          // 高亮区相对目标矩形外扩
    const RING = 5;         // 光环相对高亮区外扩
    const CARD_H = 88;      // 文案卡高度
    const ARROW_GAP = 34;   // 高亮区与文案卡之间留给箭头的间距
    const TOP_LIMIT = 58;   // 统一资源栏覆盖 y 0~50，卡片不得上去
    const BOTTOM_MARGIN = 18;

    let kind, cx, cy, circleR = 0, holeX, holeY, holeW, holeH, holeR;

    if (target.q !== undefined && target.q !== null) {
      // 战斗中：hex 坐标 → 世界像素 → 屏幕（inner）坐标
      kind = 'circle';
      const sc = (inputSystem && inputSystem.scale) || 1;
      const camX = (inputSystem && inputSystem.cameraX) || 0;
      const camY = (inputSystem && inputSystem.cameraY) || 0;
      const px = hexToPixel(target.q, target.r, HEX_SIZE);
      cx = px.x * sc + camX;
      cy = px.y * sc + camY;
      circleR = HEX_SIZE * sc + 4;
      holeX = cx - circleR;
      holeY = cy - circleR;
      holeW = holeH = circleR * 2;
      holeR = circleR;
    } else {
      kind = 'rect';
      holeW = Math.max(24, Math.min(target.w + PAD * 2, w));
      holeH = Math.max(24, Math.min(target.h + PAD * 2, h));
      holeX = Math.max(0, Math.min(target.x - PAD, w - holeW));
      holeY = Math.max(0, Math.min(target.y - PAD, h - holeH));
      holeR = Math.min(holeH / 2, 14);
      cx = holeX + holeW / 2;
      cy = holeY + holeH / 2;
    }

    // 高亮圈（外扩一圈，用于描边）
    const ringX = holeX - RING;
    const ringY = holeY - RING;
    const ringW = holeW + RING * 2;
    const ringH = holeH + RING * 2;
    const ringR = holeR + RING;

    // 文案卡：优先放高亮区下方，放不下则翻到上方；两侧都放不下时选空间大的一侧并贴边
    const cardW = Math.min(w - 40, 360);
    const cardX = (w - cardW) / 2;
    const spaceBelow = h - BOTTOM_MARGIN - (holeY + holeH);
    const spaceAbove = holeY - TOP_LIMIT;
    let placeBelow;
    if (spaceBelow >= CARD_H + ARROW_GAP) placeBelow = true;
    else if (spaceAbove >= CARD_H + ARROW_GAP) placeBelow = false;
    else placeBelow = spaceBelow >= spaceAbove;

    let cardY = placeBelow
      ? (holeY + holeH + ARROW_GAP)
      : (holeY - ARROW_GAP - CARD_H);
    cardY = Math.max(TOP_LIMIT, Math.min(cardY, h - BOTTOM_MARGIN - CARD_H));

    // 箭头：卡片在下 → 箭头在高亮区下方指上；卡片在上 → 箭头在高亮区上方指下
    const arrowX = Math.max(cardX + 18, Math.min(cx, cardX + cardW - 18));
    const arrowY = placeBelow ? (holeY + holeH + 16) : (holeY - 14);
    const arrowChar = placeBelow ? '\u2B06' : '\u2B07';

    return {
      kind, cx, cy, circleR,
      holeX, holeY, holeW, holeH, holeR,
      ringX, ringY, ringW, ringH, ringR,
      cardX, cardY, cardW, cardH: CARD_H,
      placeBelow,
      arrowX, arrowY, arrowChar,
    };
  }

  /**
   * 圆角矩形路径（ctx 无原生 roundRect 时兜底）
   */
  /**
   * 逆时针圆角矩形路径（P38：用于引导遮罩挖洞）
   * 与 _roundRectPath 同形但绕行方向相反，配合外框顺时针矩形 + nonzero 填充规则即可挖洞，
   * 无需依赖 fill('evenodd') 参数（小游戏 Canvas2D 兼容性更稳）。
   */
  _roundRectPathCCW(x, y, w, h, r) {
    const { ctx } = this;
    const rr = Math.max(0, Math.min(r, w / 2, h / 2));
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x, y, x, y + rr, rr);
    ctx.lineTo(x, y + h - rr);
    ctx.arcTo(x, y + h, x + rr, y + h, rr);
    ctx.lineTo(x + w - rr, y + h);
    ctx.arcTo(x + w, y + h, x + w, y + h - rr, rr);
    ctx.lineTo(x + w, y + rr);
    ctx.arcTo(x + w, y, x + w - rr, y, rr);
    ctx.closePath();
  }

  _roundRectPath(x, y, w, h, r) {
    const { ctx } = this;
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.arcTo(x + w, y, x + w, y + r, r);
    ctx.lineTo(x + w, y + h - r);
    ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
    ctx.lineTo(x + r, y + h);
    ctx.arcTo(x, y + h, x, y + h - r, r);
    ctx.lineTo(x, y + r);
    ctx.arcTo(x, y, x + r, y, r);
    ctx.closePath();
  }

  drawLobby(gameState) {
    const { ctx } = this;
    const w = this.screenWidth;
    const h = this.screenHeight;
    const profile = gameState.profile;

    // 渐变背景（直接绘制，避免离屏缓存 canvas 在界面切换时被浏览器回收导致残留）
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, '#1e1b4b');
    grad.addColorStop(0.5, '#0f172a');
    grad.addColorStop(1, '#1e293b');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);

    // 顶部资源栏（含天梯奖杯，颜色随段位）：P16 统一改由 _drawResourceBar 在左上角绘制，
    // 大厅不再居中式横排。ladderTier 仍在此读取，供下方徽章/进度条使用。
    const ladderTier = gameState.ladderTier;

    // 设置按钮（右上角小图标，打开设置窗口）
    ctx.fillStyle = '#334155';
    ctx.fillRect(w - 45, 10, 35, 30);
    ctx.strokeStyle = '#475569';
    ctx.lineWidth = 1;
    ctx.strokeRect(w - 45, 10, 35, 30);
    ctx.fillStyle = '#e2e8f0';
    ctx.font = 'bold 15px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('⚙', w - 27, 25);

    // 标题
    ctx.fillStyle = '#fbbf24';
    ctx.font = 'bold 28px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('占地之王', w / 2, 85);

    // 副标题（天梯进度条已移至开战按钮上方，大段位徽章在功能行下方）
    ctx.fillStyle = '#94a3b8';
    ctx.font = '12px sans-serif';
    ctx.fillText('— 主城大厅 —', w / 2, 108);

    // 玩家账号信息（昵称 + 本地账号尾号，副标题下方；▾ 暗示可点击打开账号面板）
    if (gameState.accountInfo) {
      const ai = gameState.accountInfo;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = '11px sans-serif';
      ctx.fillStyle = '#cbd5e1';
      let label = '👤 ' + ai.nickname;
      if (ai.uid) label += '  ·  账号尾号 ' + ai.uid.slice(-6);
      ctx.fillText(label + ' ▾', w / 2, 124);
    }

    // 上阵兵种预览
    const deployY = 140;
    ctx.fillStyle = '#94a3b8';
    ctx.font = '11px sans-serif';
    ctx.fillText('上阵兵种', w / 2, deployY);

    if (profile && profile.deployment) {
      const deployables = ConfigLoader.getSafe('deployables');
      const units = profile.deployment.units || [];
      const slotGap = 5;
      const slotW = rowItemWidth(units.length, slotGap, w, 8, LAYOUT_MIN.lobbySlot, LAYOUT_DESIGN_MAX.lobbySlot);
      const slotStartX = rowStartX(units.length, slotW, slotGap, w);
      const y = deployY + 15;

      for (let i = 0; i < units.length; i++) {
        const actualX = slotStartX + i * (slotW + slotGap);
        const unitId = units[i];
        const u = (unitId && deployables?.units?.[unitId]) ? deployables.units[unitId] : null;
        // P35：品质外框（与布阵界面同色系；品质不再用星星表达）
        const q = u?.quality || 1;
        // 卡片背景
        ctx.fillStyle = '#1e293b';
        ctx.fillRect(actualX, y, slotW, 65);
        ctx.strokeStyle = u ? (QUALITY_COLORS[q - 1] || '#9ca3af') : '#475569';
        ctx.lineWidth = q >= 4 ? 2 : 1.5;
        ctx.strokeRect(actualX, y, slotW, 65);

        if (u) {
          const collected = profile.collectedUnits[unitId];
          // 图标
          ctx.fillStyle = '#e2e8f0';
          ctx.font = '20px sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText(u.icon || '?', actualX + slotW / 2, y + 22);
          // 名称
          ctx.fillStyle = '#94a3b8';
          ctx.font = '10px sans-serif';
          ctx.fillText(u.name, actualX + slotW / 2, y + 42);
          // 等级
          ctx.fillStyle = '#64748b';
          ctx.font = '9px sans-serif';
          ctx.fillText('Lv.' + (collected?.level || 1), actualX + slotW / 2, y + 56);
        } else {
          ctx.fillStyle = '#334155';
          ctx.font = '16px sans-serif';
          ctx.fillText('—', actualX + slotW / 2, y + 35);
        }
      }
    }

    // 战力值（总战力 + 当前段位参考战力，颜色随达成状态）
    if (gameState.powerInfo) {
      const pi = gameState.powerInfo;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = 'bold 15px sans-serif';
      ctx.fillStyle = pi.ratio >= 1 ? '#4ade80' : '#a78bfa';
      ctx.fillText(`⚔ 战力 ${pi.total}`, w / 2, 233);
      ctx.font = '10px sans-serif';
      ctx.fillStyle = pi.ratio >= 1 ? '#86efac' : '#94a3b8';
      const status = pi.ratio >= 1
        ? `↑ 已达本段位参考战力 ${pi.reference}`
        : `本段位参考战力 ${pi.reference}（还差 ${Math.max(0, Math.round(pi.reference - pi.total))}）`;
      ctx.fillText(status, w / 2, 251);
    }

    // === 功能按钮行（战力下方，与 Game.handleLobbyClick 命中框同源）：分享 / 任务 / 成就 [+通行证] ===
    // P9+P11：宽度按屏宽自适应。iPhone 5 (320) 70px，iPhone 6 (375) 83.75px，340 模拟器 74.75px。
    //        上一版硬编码 88 导致 iPhone 5 总宽 376>320，第 4 个按钮溢出屏外。
    // P25 features 开关：battlePass=false 时完全折叠通行证按钮（count 4→3，不留空位）
    const _features2 = ConfigLoader.getSafe('game')?.features || {};
    const _battlePassEnabled = _features2.battlePass !== false;
    const _rowCount = _battlePassEnabled ? 4 : 3;
    const ROW = {
      w: rowItemWidth(_rowCount, 8, w, 8, LAYOUT_MIN.lobbyRow, LAYOUT_DESIGN_MAX.lobbyRow),
      h: 40, gap: 8, y: 262, count: _rowCount,
    };
    const rowX = (i) => (w - (ROW.count * ROW.w + (ROW.count - 1) * ROW.gap)) / 2 + i * (ROW.w + ROW.gap);
    const rowDefs = [
      { bg: '#0e7490', border: '#22d3ee' },   // 分享
      { bg: '#065f46', border: '#10b981' },   // 任务
      { bg: '#6d28d9', border: '#a78bfa' },   // 成就
      { bg: '#92400e', border: '#f59e0b' },   // 通行证（仅 battlePass=true 时渲染）
    ];

    // 分享按钮（带每日奖励副标题）
    const shareClaimed = gameState.shareRewardClaimed;
    // P10 字号按屏宽自适应：iPhone 5 (320) 12→10，9→8；iPhone 6 (375) 维持 12/9
    const rowFontSize = adaptiveFontSize(12, w);
    const rowSubFontSize = adaptiveFontSize(9, w);
    for (let i = 0; i < ROW.count; i++) {
      const x = rowX(i);
      const rect = { x, y: ROW.y, w: ROW.w, h: ROW.h };
      this._drawPressed(rect, gameState.press, () => {
        ctx.fillStyle = rowDefs[i].bg;
        ctx.fillRect(x, ROW.y, ROW.w, ROW.h);
        ctx.strokeStyle = rowDefs[i].border;
        ctx.lineWidth = 1;
        ctx.strokeRect(x, ROW.y, ROW.w, ROW.h);
        ctx.fillStyle = '#ffffff';
        if (i === 0) {
          ctx.font = `${rowFontSize}px sans-serif`;
          ctx.fillText(shareClaimed ? '📤 分享' : '📤 分享🎁', x + ROW.w / 2, ROW.y + (shareClaimed ? ROW.h / 2 : ROW.h / 2 - 7));
          if (!shareClaimed) {
            ctx.fillStyle = '#fbbf24';
            ctx.font = `${rowSubFontSize}px sans-serif`;
            ctx.fillText('金币200✨5', x + ROW.w / 2, ROW.y + ROW.h / 2 + 10);
          }
        } else {
          ctx.font = `${rowFontSize}px sans-serif`;
          const label = i === 1 ? '📋 任务' : (i === 2 ? '🏆 成就' : '🎖 通行证');
          ctx.fillText(label, x + ROW.w / 2, ROW.y + ROW.h / 2);
        }
      });
    }

    // === 大段位徽章 + 段位进度条（组合单元，P20） ===
    // 组合单元整体在 [功能行底, 开战按钮顶] 内垂直居中，坐标由 Layout.ladderCombo 统一计算
    // 进度条由「开战按钮上方」移到「徽章下方」，与徽章组成一个视觉单元
    const ladderProgress = gameState.ladderProgress;
    const ladderComboLayout = (ladderTier || ladderProgress)
      ? ladderCombo(ROW.y + ROW.h, h - 150)   // battleTop = Game.lobbyBattleY(h)
      : null;
    if (ladderTier) {
      const { badgeR, badgeY, infoY } = ladderComboLayout;
      const cx = w / 2;
      // 外圈光晕（段位主题色，呼吸动效）
      const glow = Math.sin(Date.now() / 500) * 0.08 + 0.15;
      ctx.fillStyle = ladderTier.color + Math.round(glow * 255).toString(16).padStart(2, '0');
      ctx.beginPath();
      ctx.arc(cx, badgeY, badgeR, 0, Math.PI * 2);
      ctx.fill();
      // 主环
      ctx.strokeStyle = ladderTier.color;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(cx, badgeY, badgeR, 0, Math.PI * 2);
      ctx.stroke();
      // 内部深色圆盘（随半径缩放）
      const innerR = badgeR - Math.max(3, Math.round(badgeR * 0.13));
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.beginPath();
      ctx.arc(cx, badgeY, innerR, 0, Math.PI * 2);
      ctx.fill();
      // 大段位图标（字号随半径缩放）
      const iconSize = Math.round(badgeR * 0.85);
      ctx.fillStyle = '#e2e8f0';
      ctx.font = `${iconSize}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(ladderTier.icon, cx, badgeY - Math.round(badgeR * 0.11));
      // 段位名（徽章下沿，字号/位置随半径缩放）
      const labelSize = Math.max(8, Math.round(badgeR * 0.26));
      ctx.fillStyle = ladderTier.color;
      ctx.font = `bold ${labelSize}px sans-serif`;
      ctx.fillText(ladderTier.label, cx, badgeY + badgeR - Math.round(badgeR * 0.37));
      // 奖杯 + 最高纪录（一行，徽章下方，infoY 由 combo 统一计算）
      const highest = profile ? (profile.highestTrophies || 0) : 0;
      const infoSize = Math.max(9, Math.round(badgeR * 0.2));
      ctx.fillStyle = '#94a3b8';
      ctx.font = `${infoSize}px sans-serif`;
      ctx.fillText(`🏆 ${profile ? (profile.trophies || 0) : 0}杯 · 最高 ${highest}`, cx, infoY);
    }

    // === 段位进度条（徽章下方，居中，长度自适应，P20） ===
    if (ladderTier && ladderProgress) {
      const barW = ladderBarWidth(w);
      const barX = (w - barW) / 2;
      const barY = ladderComboLayout.barY;
      const barH = ladderComboLayout.barH;
      // 底色
      ctx.fillStyle = 'rgba(0,0,0,0.4)';
      ctx.fillRect(barX, barY, barW, barH);
      ctx.strokeStyle = ladderTier.color;
      ctx.lineWidth = 1;
      ctx.strokeRect(barX, barY, barW, barH);
      // 进度填充（最高段位满条）
      ctx.fillStyle = ladderTier.color + '88';
      ctx.fillRect(barX, barY, barW * (ladderProgress.next ? ladderProgress.ratio : 1), barH);
      // 进度条内文字（居中，只显示段位进度：当前杯 → 目标段位 / 巅峰王者）
      ctx.font = 'bold 11px sans-serif';
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'center';
      ctx.fillStyle = '#e2e8f0';
      if (ladderProgress.next) {
        ctx.fillText(`🏆 ${ladderProgress.cur} → ${ladderProgress.next.icon}${ladderProgress.next.label}`, w / 2, barY + barH / 2);
      } else {
        ctx.fillText('👑 巅峰王者', w / 2, barY + barH / 2);
      }
      // 进度条下方小字（P23）：还差杯数 + 赛季倒计时（文本信息统一放进度条下面，避免与上方奖杯文字重叠）
      ctx.fillStyle = '#64748b';
      ctx.font = '9px sans-serif';
      if (ladderProgress.next) {
        const need = ladderProgress.need - ladderProgress.cur;
        ctx.fillText(`距 ${ladderProgress.next.icon}${ladderProgress.next.label} 还差 ${need} 杯 · 赛季剩 ${gameState.seasonDaysLeft || 7} 天`, w / 2, barY + barH + 7);
      } else {
        ctx.fillText(`赛季剩 ${gameState.seasonDaysLeft || 7} 天`, w / 2, barY + barH + 7);
      }
    }

    // === 联网入口已合并到「开战」按钮（异步 PvP 匹配 + 10s 降级 AI），不再单独渲染联机/加入按钮 ===

    // === 开战按钮（导航栏上方，点击即进入异步 PvP 匹配 / 超时降级 AI） ===
    // P11：宽度按屏宽自适应。iPhone 5 (320) 钳到 240（设计稿上限），iPhone 6 (375)+ 同 240。
    const BL = {
      w: rowItemWidth(1, 0, w, 8, LAYOUT_MIN.battle, LAYOUT_DESIGN_MAX.battle),
      h: 58,
    };
    const blY = h - 150;          // = Game.lobbyBattleY(h)
    const battleRect = { x: (w - BL.w) / 2, y: blY, w: BL.w, h: BL.h };
    this._drawPressed(battleRect, gameState.press, () => {
      const blPulse = Math.sin(Date.now() / 300) * 0.1 + 0.9;
      ctx.fillStyle = `rgba(239, 68, 68, ${blPulse * 0.3})`;
      ctx.fillRect((w - BL.w) / 2 - 3, blY - 3, BL.w + 6, BL.h + 6);
      ctx.fillStyle = '#dc2626';
      ctx.fillRect((w - BL.w) / 2, blY, BL.w, BL.h);
      ctx.strokeStyle = '#f87171';
      ctx.lineWidth = 1.5;
      ctx.strokeRect((w - BL.w) / 2, blY, BL.w, BL.h);
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 20px sans-serif';
      ctx.fillText('⚔ 开 战', w / 2, blY + BL.h / 2);
    });

    // 新手引导遮罩（Phase 6 重做：分步教学叠加层，由 renderScreen 统一调用 _drawTutorialOverlay）
    // 旧版 TUTORIAL_TEXTS 纯文本遮罩已移除，改为高亮+箭头+文案的分步教学

    // 底部导航栏：商店 / 招募 / 布阵 / 科技 / 排行榜（与 Game.LOBBY_LAYOUT.nav 同源）
    // P9：宽度按屏宽自适应（5×68+4×6=364 在 339 屏/iPhone 5 严重溢出）
    // P25 features 开关：shop=false 时整行 5→4 隐藏商店入口（默认 true=显示）
    const _features = ConfigLoader.getSafe('game')?.features || {};
    const _shopEnabled = _features.shop !== false;
    const navGap = 6;
    const navCount = _shopEnabled ? 5 : 4;
    const btnW = rowItemWidth(navCount, navGap, w, 8, LAYOUT_MIN.lobbyNav, LAYOUT_DESIGN_MAX.lobbyNav);
    const btnH = 56;
    const totalW = navCount * btnW + (navCount - 1) * navGap;
    const navY = h - 72;
    const navStartX = (w - totalW) / 2;

    const navLabels = ['🏪 商店', '🎲 招募', '⚔ 布阵', '🔬 科技', '🏅 排行榜'];
    // 各按钮主题色（背景 + 边框），文字统一白色
    const navDefs = [
      { bg: '#92400e', border: '#fbbf24' },   // 商店（金币金）
      { bg: '#6d28d9', border: '#a78bfa' },   // 招募（紫色）
      { bg: '#7f1d1d', border: '#f87171' },   // 布阵（战斗红）
      { bg: '#0e7490', border: '#22d3ee' },   // 科技（科技青）
      { bg: '#3730a3', border: '#818cf8' },   // 排行榜（靛蓝）
    ];

    for (let i = 0; i < navCount; i++) {
      const x = navStartX + i * (btnW + navGap);
      const rect = { x, y: navY, w: btnW, h: btnH };
      this._drawPressed(rect, gameState.press, () => {
        ctx.fillStyle = navDefs[i].bg;
        ctx.fillRect(x, navY, btnW, btnH);
        ctx.strokeStyle = navDefs[i].border;
        ctx.lineWidth = 1;
        ctx.strokeRect(x, navY, btnW, btnH);

        ctx.fillStyle = '#ffffff';
        // P10 字号按屏宽自适应：iPhone 5 (320) 10→8；iPhone 6 (375) 维持 10
        ctx.font = `${adaptiveFontSize(10, w)}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(navLabels[i], x + btnW / 2, navY + btnH / 2);

        // 可升级角标（右上角红点 + 数量）：布阵=可升级兵种数 / 科技=可升级节点数
        // 来源 Game 注入的 lobbyBadges（仅大厅态有值），口径与实际升级校验一致
        const badgeCount = i === 2 ? (gameState.lobbyBadges?.deploy || 0)
          : i === 3 ? (gameState.lobbyBadges?.tech || 0) : 0;
        if (badgeCount > 0) {
          const bx = x + btnW - 5, by = navY + 5, br = badgeCount >= 10 ? 9 : 7;
          ctx.fillStyle = '#ef4444';
          ctx.beginPath();
          ctx.arc(bx, by, br, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = 1;
          ctx.stroke();
          ctx.fillStyle = '#ffffff';
          ctx.font = 'bold 8px sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(badgeCount >= 100 ? '99+' : String(badgeCount), bx, by + 0.5);
        }
      });
    }
  }


  /**
   * 绘制科技树面板
   */
  drawTechPanel(gameState) {
    const { ctx } = this;
    const w = this.screenWidth;
    const h = this.screenHeight;
    const profile = gameState.profile;

    // 背景
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, 0, w, h);

    // 顶部标题
    ctx.fillStyle = '#fbbf24';
    ctx.font = 'bold 18px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('科技树', w / 2, 25);

    // 星尘等资源已由统一顶部资源栏显示（renderScreen 尾部叠加）

    // 分支标签
    let techConfig = null;
    try { techConfig = ConfigLoader.getSafe('techTree'); } catch(e) {}

    if (!techConfig) {
      ctx.fillStyle = '#64748b';
      ctx.textAlign = 'center';
      ctx.fillText('配置加载中...', w / 2, h / 2);
      return;
    }

    const branchKeys = Object.keys(techConfig.branches);
    const tabW = techTabWidth(w), tabH = 35, tabGap = 4;
    const tabStartX = rowStartX(branchKeys.length, tabW, tabGap, w);
    const tabY = 50;
    const selectedBranch = gameState.selectedTechBranch || 'military';

    for (let i = 0; i < branchKeys.length; i++) {
      const key = branchKeys[i];
      const branch = techConfig.branches[key];
      const x = tabStartX + i * (tabW + tabGap);
      const isSelected = key === selectedBranch;

      ctx.fillStyle = isSelected ? branch.color + '44' : '#1e293b';
      ctx.fillRect(x, tabY, tabW, tabH);
      ctx.strokeStyle = isSelected ? branch.color : '#334155';
      ctx.lineWidth = isSelected ? 2 : 1;
      ctx.strokeRect(x, tabY, tabW, tabH);

      ctx.fillStyle = isSelected ? branch.color : '#64748b';
      ctx.font = 'bold 11px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(branch.icon + ' ' + branch.name, x + tabW / 2, tabY + tabH / 2);
    }

    // 节点网格
    const branch = techConfig.branches[selectedBranch];
    if (!branch) return;

    const nodeW = techNodeWidth(w), nodeH = 70, nodeGap = 10;
    const nodeStartX = rowStartX(2, nodeW, nodeGap, w);
    const nodesStartY = 100 - (gameState.metaScrollY || 0);

    // 裁剪：节点只在返回按钮/分支标签以下区域显示，上滚不盖顶部
    this._beginScrollClip(ctx, w, h, 90);

    for (const node of branch.nodes) {
      const col = Math.min(node.position.col, 1); // 防御：最多两列
      const x = nodeStartX + col * (nodeW + nodeGap);
      const y = nodesStartY + node.position.row * (nodeH + nodeGap);

      // 视口裁剪
      if (y > h || y + nodeH < 90) continue;

      const level = profile?.getTechNodeLevel(node.id) || 0;
      const isMax = level >= node.maxLevel;
      const hasPrereq = !node.prerequisite ||
        (profile?.getTechNodeLevel(node.prerequisite.node) || 0) >= node.prerequisite.level;
      const nextCost = level < node.maxLevel ? node.costPerLevel[level] : 0;
      const canAfford = profile && profile.stardust >= nextCost;

      // 节点背景
      let bgColor = '#1e293b';
      let borderColor = '#334155';
      if (level > 0) { bgColor = branch.color + '22'; borderColor = branch.color + '88'; }
      if (isMax) { bgColor = branch.color + '44'; borderColor = branch.color; }
      if (!hasPrereq) { bgColor = '#0f172a'; borderColor = '#1e293b'; }

      ctx.fillStyle = bgColor;
      ctx.fillRect(x, y, nodeW, nodeH);
      ctx.strokeStyle = borderColor;
      ctx.lineWidth = level > 0 ? 1.5 : 1;
      ctx.strokeRect(x, y, nodeW, nodeH);

      // 节点名
      ctx.fillStyle = hasPrereq ? (isMax ? branch.color : '#e2e8f0') : '#334155';
      ctx.font = 'bold 12px sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillText(node.name, x + 5, y + 5);

      // 描述
      ctx.fillStyle = hasPrereq ? '#94a3b8' : '#1e293b';
      ctx.font = '9px sans-serif';
      ctx.fillText(node.description, x + 5, y + 22);

      // 等级条
      const barY = y + 38;
      const barW = nodeW - 10;
      const barH2 = 6;
      ctx.fillStyle = '#0f172a';
      ctx.fillRect(x + 5, barY, barW, barH2);
      ctx.fillStyle = isMax ? '#4ade80' : branch.color;
      ctx.fillRect(x + 5, barY, barW * (level / node.maxLevel), barH2);

      // 等级文字
      ctx.fillStyle = isMax ? '#4ade80' : (level > 0 ? '#e2e8f0' : '#64748b');
      ctx.font = '9px sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText('Lv.' + level + '/' + node.maxLevel, x + 5, y + 48);

      // 消耗
      if (!isMax && hasPrereq) {
        ctx.fillStyle = canAfford ? '#fbbf24' : '#f87171';
        ctx.font = '9px sans-serif';
        ctx.textAlign = 'right';
        ctx.fillText('⭐' + nextCost, x + nodeW - 5, y + 48);
      } else if (!hasPrereq) {
        const prereqNode = branch.nodes.find(n => n.id === node.prerequisite.node);
        ctx.fillStyle = '#475569';
        ctx.font = '8px sans-serif';
        ctx.textAlign = 'right';
        ctx.fillText('需' + (prereqNode?.name || '?') + node.prerequisite.level + '级', x + nodeW - 5, y + 48);
      } else {
        ctx.fillStyle = '#4ade80';
        ctx.font = 'bold 9px sans-serif';
        ctx.textAlign = 'right';
        ctx.fillText('MAX', x + nodeW - 5, y + 48);
      }

      // 可升级标记
      if (hasPrereq && !isMax && canAfford) {
        ctx.fillStyle = '#4ade80';
        ctx.font = 'bold 10px sans-serif';
        ctx.textAlign = 'right';
        ctx.fillText('↑', x + nodeW - 5, y + 5);
      }
    }

    this._endScrollClip(ctx);
  }

  /**
   * 添加战斗特效
   */
  addEffect(effect) {
    this.effects.push(effect);
  }

  /**
   * 绘制并更新特效
   */
  drawEffects(dt) {
    const { ctx } = this;

    for (let i = this.effects.length - 1; i >= 0; i--) {
      const e = this.effects[i];
      e.timer += dt;
      const progress = e.timer / e.duration;

      if (progress >= 1) {
        this.effects.splice(i, 1);
        continue;
      }

      const color = e.color || '#ff6b6b';

      if (e.type === 'damage') {
        const alpha = 1 - progress;
        const yOffset = -25 * progress;
        ctx.globalAlpha = alpha;
        ctx.fillStyle = color;
        ctx.font = 'bold 14px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('-' + e.value, e.x, e.y + yOffset);
        ctx.globalAlpha = 1;
      } else if (e.type === 'explosion') {
        const radius = 8 + 25 * progress;
        const alpha = 1 - progress;
        ctx.globalAlpha = alpha;
        ctx.strokeStyle = color;
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.arc(e.x, e.y, radius, 0, Math.PI * 2);
        ctx.stroke();
        // 内圈
        ctx.globalAlpha = alpha * 0.4;
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(e.x, e.y, radius * 0.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
      } else if (e.type === 'arrow') {
        // 箭矢从fromX,fromY飞向toX,toY
        const curX = e.fromX + (e.toX - e.fromX) * progress;
        const curY = e.fromY + (e.toY - e.fromY) * progress;
        const alpha = 1 - progress * 0.5;
        ctx.globalAlpha = alpha;
        ctx.strokeStyle = '#10b981';
        ctx.lineWidth = 2;
        // 箭矢尾迹(从起点到当前位置的渐变线)
        ctx.beginPath();
        ctx.moveTo(e.fromX, e.fromY);
        ctx.lineTo(curX, curY);
        ctx.stroke();
        // 箭头
        ctx.fillStyle = '#10b981';
        ctx.beginPath();
        ctx.arc(curX, curY, 3, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
      }
    }
  }

  // ============ 工具方法 ============

  drawHexShape(cx, cy, size) {
    const { ctx } = this;
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const angle = Math.PI / 3 * i + Math.PI / 6;
      const x = cx + size * Math.cos(angle);
      const y = cy + size * Math.sin(angle);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
  }

  getBuildingIcon(type, level) {
    switch (type) {
      case 'barracks':
        return '兵';
      case 'arrow_tower': return '塔';
      case 'gold_mine': return '金';
      case 'headquarters': return '王';
      case 'empty': return '·';
      default: return '?';
    }
  }

  lightenColor(hex, amount) {
    // 简化版颜色变亮
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    const nr = Math.min(255, Math.floor(r + (255 - r) * amount));
    const ng = Math.min(255, Math.floor(g + (255 - g) * amount));
    const nb = Math.min(255, Math.floor(b + (255 - b) * amount));
    return `rgb(${nr},${ng},${nb})`;
  }

  isVisible(x, y) {
    // 视口裁剪：仅绘制相机可视范围内的格子/单位（世界坐标判定）
    const b = this._viewBounds;
    if (!b) return true;
    return x >= b.minX && x <= b.maxX && y >= b.minY && y <= b.maxY;
  }

  // ==================== 商店面板 ====================
  /**
   * 商店布局（与 Game.handleShopClick 共享 —— P34 铁律：渲染与命中必须同一份）
   *
   * P37：新增「免费」分页后最多 5 个分页，窄屏（320px）必须自适应等分，否则溢出屏幕。
   *
   * @param {number} screenWidth
   * @param {number} tabCount 分页数量（钻石充值分页被 features.shopDiamondTab 隐藏时会变）
   */
  static shopLayout(screenWidth, tabCount = 4) {
    const n = Math.max(1, tabCount || 1);
    const tabGap = 4;
    const tabH = 30;
    const tabStartX = 20;
    const tabY = 50;
    const avail = screenWidth - tabStartX * 2;
    const tabW = Math.max(38, Math.min(70, Math.floor((avail - (n - 1) * tabGap) / n)));

    const cardX = 20;
    const itemW = Math.min(340, screenWidth - 40);
    const itemH = 70;
    const gap = 8;
    const listStartY = 95;

    const btnW = 60;
    const btnH = 30;
    return {
      tabW, tabH, tabGap, tabStartX, tabY,
      cardX, itemW, itemH, gap, listStartY,
      btnW, btnH,
    };
  }

  /**
   * 商店第 index 个商品卡片的顶边 y（渲染与点击命中共用）
   */
  static shopItemTop(index, scrollY = 0, layout = null) {
    const L = layout || RenderSystem.shopLayout(375, 4);
    return L.listStartY - (scrollY || 0) + index * (L.itemH + L.gap);
  }

  drawShop(gameState) {
    const { ctx } = this;
    const w = this.screenWidth;
    const h = this.screenHeight;

    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, 0, w, h);

    // 标题
    ctx.fillStyle = '#10b981';
    ctx.font = 'bold 18px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('商店', w / 2, 25);

    // 货币已由统一顶部资源栏显示（renderScreen 尾部叠加）

    // 分类标签（P37：含「免费」分页，宽度自适应）
    const items = gameState.shopItems || [];
    const L = RenderSystem.shopLayout(w, items.length);
    for (let i = 0; i < items.length; i++) {
      const tx = L.tabStartX + i * (L.tabW + L.tabGap);
      const isActive = (gameState.shopTab === i);
      ctx.fillStyle = isActive ? '#10b98144' : '#1e293b';
      ctx.fillRect(tx, L.tabY, L.tabW, L.tabH);
      ctx.strokeStyle = isActive ? '#10b981' : '#334155';
      ctx.lineWidth = 1;
      ctx.strokeRect(tx, L.tabY, L.tabW, L.tabH);
      ctx.fillStyle = isActive ? '#10b981' : '#64748b';
      ctx.font = 'bold 11px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(items[i].categoryName, tx + L.tabW / 2, L.tabY + L.tabH / 2);
    }

    // 商品列表
    const cat = items[gameState.shopTab];
    if (!cat) return;
    const { cardX, itemW, itemH, gap, btnW, btnH } = L;
    const startY = RenderSystem.shopItemTop(0, gameState.metaScrollY || 0, L);

    // 裁剪：商品列表只在返回按钮/分类标签以下区域显示
    this._beginScrollClip(ctx, w, h, 88);

    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    for (let i = 0; i < cat.items.length; i++) {
      const item = cat.items[i];
      const iy = startY + i * (itemH + gap);
      if (iy + itemH < 90 || iy > h) continue;

      // 卡片背景（免费栏位用蓝色描边区分）
      ctx.fillStyle = '#1e293b';
      ctx.fillRect(cardX, iy, itemW, itemH);
      const active = item.canAfford && item.remaining !== 0;
      ctx.strokeStyle = active ? (item.isFree ? '#3b82f6' : '#10b981') : '#334155';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(cardX, iy, itemW, itemH);

      // ============ P37 免费栏位 ============
      if (item.isFree) {
        ctx.fillStyle = item.exhausted ? '#64748b' : '#e2e8f0';
        ctx.font = 'bold 13px sans-serif';
        ctx.fillText(item.name, cardX + 8, iy + 8);

        // 单次奖励
        const rwText = Object.entries(item.reward || {}).map(([k, v]) => {
          const icons = { diamond: '💎', gold: '💰', stardust: '⭐' };
          return `${icons[k] || k}+${v}`;
        }).join(' ');
        ctx.fillStyle = '#fbbf24';
        ctx.font = 'bold 12px sans-serif';
        ctx.fillText(`每次 ${rwText}`, cardX + 8, iy + 28);

        // 可领次数 + 领取规则
        ctx.fillStyle = item.exhausted ? '#64748b' : '#94a3b8';
        ctx.font = '10px sans-serif';
        const ruleText = item.exhausted
          ? '今日已领完，明日再来'
          : (item.needAd ? '观看广告后领取' : '首次直接领取，无需广告');
        ctx.fillText(`还可领 ${item.dailyRemaining} 次 · ${ruleText}`, cardX + 8, iy + 48);

        // 右上：已领 / 上限
        ctx.fillStyle = '#64748b';
        ctx.font = '10px sans-serif';
        ctx.textAlign = 'right';
        ctx.fillText(`已领 ${item.dailyClaimed}/${item.dailyLimit}`, cardX + itemW - 10, iy + 8);
        ctx.textAlign = 'left';

        // 免费按钮（蓝色；非首次加广告播放图标）
        if (!item.exhausted) {
          const bx = cardX + itemW - btnW - 10;
          const by = iy + 10;
          ctx.fillStyle = '#3b82f644';
          ctx.fillRect(bx, by, btnW, btnH);
          ctx.strokeStyle = '#3b82f6';
          ctx.lineWidth = 1;
          ctx.strokeRect(bx, by, btnW, btnH);
          ctx.fillStyle = '#3b82f6';
          ctx.font = 'bold 11px sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(item.needAd ? '📺免费' : '免费', bx + btnW / 2, by + btnH / 2);
          ctx.textAlign = 'left';
          ctx.textBaseline = 'top';
        }
        continue;
      }

      // ============ 普通商品 ============
      // 名称
      ctx.fillStyle = item.canAfford ? '#e2e8f0' : '#64748b';
      ctx.font = 'bold 13px sans-serif';
      ctx.fillText(item.name, cardX + 8, iy + 8);

      // 描述
      if (item.desc) {
        ctx.fillStyle = '#94a3b8';
        ctx.font = '10px sans-serif';
        ctx.fillText(item.desc, cardX + 8, iy + 28);
      }

      // 价格
      const costText = Object.entries(item.cost).map(([k, v]) => {
        const icons = { diamond: '💎', gold: '💰', stardust: '⭐', realMoney: '¥' };
        return `${icons[k] || k}${v}`;
      }).join(' ');
      ctx.fillStyle = item.canAfford ? '#fbbf24' : '#64748b';
      ctx.font = 'bold 12px sans-serif';
      ctx.fillText(costText, cardX + 8, iy + 48);

      // 限购
      if (item.limit > 0) {
        ctx.fillStyle = '#64748b';
        ctx.font = '10px sans-serif';
        ctx.textAlign = 'right';
        ctx.fillText(`${item.remaining >= 0 ? item.remaining : '∞'}/${item.limit}`, cardX + itemW - 10, iy + 8);
        ctx.textAlign = 'left';
      }

      // 购买按钮
      if (item.canAfford && item.remaining !== 0) {
        const bx = cardX + itemW - btnW - 10;
        const by = iy + 10;
        ctx.fillStyle = '#10b98144';
        ctx.fillRect(bx, by, btnW, btnH);
        ctx.strokeStyle = '#10b981';
        ctx.lineWidth = 1;
        ctx.strokeRect(bx, by, btnW, btnH);
        ctx.fillStyle = '#10b981';
        ctx.font = 'bold 11px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('购买', bx + btnW / 2, by + btnH / 2);
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
      }
    }

    this._endScrollClip(ctx);
  }

  // ==================== 详情面板共享布局 ====================
  /**
   * 建筑详情/升级面板布局（与 _drawBuildingDetailPanel + Game._handleBuildingDetailTap 三方共享）
   * 比兵种面板矮（建筑无技能列表）
   */
  static buildingDetailPanelLayout(screenWidth, screenHeight) {
    const panelW = Math.min(screenWidth - 40, 340);
    // P34：面板需容纳「当前效果 + 下级对比 + 双资源花费 + 升级按钮」
    const panelH = Math.min(Math.max(screenHeight * 0.44, 250), 330);
    const panelX = (screenWidth - panelW) / 2;
    const panelY = (screenHeight - panelH) / 2 - 30;
    const btnW = Math.min(180, panelW - 40);
    const btnH = 36;
    const btnX = panelX + (panelW - btnW) / 2;
    const btnY = panelY + panelH - btnH - 12;
    return { panelW, panelH, panelX, panelY, btnW, btnH, btnX, btnY };
  }

  /**
   * 招募（抽卡）主界面垂直布局（与 Game.handleGachaClick 共享）
   *
   * P34：各栏之间统一留 gap；概率一览整块居中；底部说明移到抽卡按钮上方
   */
  static gachaLayout(screenWidth, screenHeight) {
    const w = screenWidth;
    const h = screenHeight;

    // ---- 底部区域自下而上锚定，保证间隙固定、永不重叠 ----
    // P35：广告按钮必须让开左下角返回按钮（BACK_BTN 顶边 = h-51），
    // 否则全宽按钮会压在返回按钮上造成误触
    const backTop = h - BACK_BTN.bottom - BACK_BTN.h;
    const adBtnH = 38;
    const adBtnW = Math.min(280, w - 60);
    const adBtnX = (w - adBtnW) / 2;
    const adBtnY = backTop - 8 - adBtnH;     // 底边与返回按钮顶边留 8
    const discountY = adBtnY - 12;           // 十连优惠提示（按钮下方，与广告按钮间隔 12）
    const btnW = 130, btnH = 50;
    const btnY = discountY - 14 - btnH;      // 抽卡按钮底 与 优惠提示 间隔 14
    const singleX = w / 2 - btnW - 10;
    const multiX = w / 2 + 10;
    const noteY2 = btnY - 18;                // 底部说明第 2 行（按钮上方）
    const noteY1 = noteY2 - 16;              // 底部说明第 1 行

    // ---- 顶部区域自上而下排布 ----
    const titleY = 26;
    const ownedY = 52;
    const progressW = Math.min(280, w - 60);
    const progressX = (w - progressW) / 2;
    const progressY = 62;
    const pityTextY = 88;
    const pityBarY = 98;
    const rateTitleY = 126;
    const rateStartY = 148;

    // 概率行步长：按可用高度自适应，下限 16 保证不重叠
    const avail = (noteY1 - 16) - rateStartY;
    const rateStep = Math.max(16, Math.min(20, Math.floor(avail / 6)));

    // ---- 概率一览：整块（名称 | 进度条 | 百分比）居中 ----
    const labelW = 36, gapLB = 8, gapBP = 6, pctW = 32;
    const barW = Math.max(56, Math.min(96, w - 32 - labelW - gapLB - gapBP - pctW));
    const blockW = labelW + gapLB + barW + gapBP + pctW;
    const blockX = (w - blockW) / 2;
    const rateLabelRightX = blockX + labelW;
    const rateBarX = blockX + labelW + gapLB;
    const ratePctX = rateBarX + barW + gapBP;

    return {
      titleY, ownedY, progressX, progressY, progressW,
      pityTextY, pityBarY, rateTitleY, rateStartY, rateStep,
      rateBlockX: blockX, rateBlockW: blockW,
      rateLabelRightX, rateBarX, rateBarW: barW, ratePctX,
      noteY1, noteY2,
      btnW, btnH, btnY, singleX, multiX, discountY,
      adBtnX, adBtnY, adBtnW, adBtnH,
    };
  }

  /**
   * 兵种详情/升级面板布局（渲染与点击统一使用，防止命中区与绘制偏移）
   */
  static unitDetailPanelLayout(screenWidth, screenHeight) {
    const panelW = Math.min(screenWidth - 20, 300);
    const panelH = Math.min(screenHeight - 60, 465);
    return { panelW, panelH, panelX: (screenWidth - panelW) / 2, panelY: (screenHeight - panelH) / 2 };
  }

  /**
   * 羁绊详情面板布局（渲染与点击统一使用，防止命中区与绘制偏移）
   */
  static synergyDetailPanelLayout(screenWidth, screenHeight) {
    const panelW = Math.min(screenWidth - 20, 300);
    const panelH = Math.min(screenHeight - 80, 400);
    return { panelW, panelH, panelX: (screenWidth - panelW) / 2, panelY: (screenHeight - panelH) / 2 };
  }

  // ==================== 任务面板 ====================
  /**
   * 任务面板共享布局（渲染与点击统一使用，防止命中区与绘制偏移）
   * 返回: { itemW, itemH, dailyHeaderY, dailyRects[], weeklyHeaderY, weeklyRects[], seasonHeaderY, seasonRects[], claimAllRect }
   * 每个 rect: { id, x, y, w, h }；领取按钮区域 = { x+w-70, y+10, 60, 30 }
   */
  static questLayout(dailyQuests, weeklyQuests, seasonQuests, scrollY, screenWidth) {
    const itemW = Math.min(340, screenWidth - 40), itemH = 55, gap = 6;
    const dailyHeaderY = 60 - scrollY;
    let y = dailyHeaderY + 22; // "📋 每日任务" 标题占位
    const dailyRects = dailyQuests.map((q) => {
      const r = { id: q.id, x: 20, y, w: itemW, h: itemH };
      y += itemH + gap;
      return r;
    });
    y += 16; // 区块间隔
    const weeklyHeaderY = y;
    y += 22; // "📅 每周任务" 标题占位
    const weeklyRects = weeklyQuests.map((q) => {
      const r = { id: q.id, x: 20, y, w: itemW, h: itemH };
      y += itemH + gap;
      return r;
    });
    y += 16; // 区块间隔
    const seasonHeaderY = y;
    y += 22; // "🌟 赛季任务" 标题占位
    const seasonRects = seasonQuests.map((q) => {
      const r = { id: q.id, x: 20, y, w: itemW, h: itemH };
      y += itemH + gap;
      return r;
    });
    return {
      itemW, itemH,
      dailyHeaderY, dailyRects,
      weeklyHeaderY, weeklyRects,
      seasonHeaderY, seasonRects,
      claimAllRect: { x: screenWidth - 120, y: 50, w: 100, h: 32 },
    };
  }

  /**
   * 成就面板共享布局（渲染与点击统一使用）
   * 返回: { itemW, itemH, headerY, rects[], claimAllRect }
   */
  static achievementLayout(achievements, scrollY, screenWidth) {
    const itemW = Math.min(340, screenWidth - 40), itemH = 55, gap = 6;
    const headerY = 60 - scrollY;
    let y = headerY + 22; // "🏆 成就" 标题占位
    const rects = achievements.map((a) => {
      const r = { id: a.id, x: 20, y, w: itemW, h: itemH };
      y += itemH + gap;
      return r;
    });
    return {
      itemW, itemH, headerY, rects,
      claimAllRect: { x: screenWidth - 120, y: 50, w: 100, h: 32 },
    };
  }

  /**
   * 绘制一键领取按钮（任务/成就界面共用）
   */
  _drawClaimAllButton(ctx, rect) {
    ctx.fillStyle = '#f59e0b33';
    ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
    ctx.strokeStyle = '#f59e0b';
    ctx.lineWidth = 1;
    ctx.strokeRect(rect.x, rect.y, rect.w, rect.h);
    ctx.fillStyle = '#fbbf24';
    ctx.font = 'bold 12px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('⚡ 一键领取', rect.x + rect.w / 2, rect.y + rect.h / 2);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
  }

  /**
   * 绘制单个任务/成就条目（每日/每周/赛季/成就共用）
   * @param {string} accent 主题色（边框/领取按钮）
   */
  _drawQuestItem(ctx, item, y, itemW, itemH, accent) {
    ctx.fillStyle = '#1e293b';
    ctx.fillRect(20, y, itemW, itemH);
    ctx.strokeStyle = item.complete ? accent : '#334155';
    ctx.lineWidth = 1;
    ctx.strokeRect(20, y, itemW, itemH);

    ctx.fillStyle = '#e2e8f0';
    ctx.font = '12px sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(item.desc, 28, y + 6);

    // 进度
    ctx.fillStyle = '#94a3b8';
    ctx.font = '10px sans-serif';
    ctx.fillText(`进度: ${Math.min(item.progress, item.target)}/${item.target}`, 28, y + 24);

    // 奖励
    const rewardText = Object.entries(item.reward || {}).map(([k, v]) => {
      const icons = { gold: '💰', diamond: '💎', stardust: '⭐' };
      return `${icons[k] || k}+${v}`;
    }).join(' ');
    ctx.fillStyle = '#fbbf24';
    ctx.font = '10px sans-serif';
    ctx.fillText(rewardText, 28, y + 40);

    // 领取按钮 / 已领
    if (item.complete && !item.claimed) {
      ctx.fillStyle = accent + '44';
      ctx.fillRect(20 + itemW - 70, y + 10, 60, 30);
      ctx.strokeStyle = accent;
      ctx.lineWidth = 1;
      ctx.strokeRect(20 + itemW - 70, y + 10, 60, 30);
      ctx.fillStyle = accent;
      ctx.font = 'bold 11px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('领取', 20 + itemW - 40, y + 25);
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
    } else if (item.claimed) {
      ctx.fillStyle = '#64748b';
      ctx.font = 'bold 11px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('✓ 已领', 20 + itemW - 40, y + 25);
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
    }
  }

  drawQuest(gameState) {
    const { ctx } = this;
    const w = this.screenWidth;
    const h = this.screenHeight;

    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, 0, w, h);

    ctx.fillStyle = '#06b6d4';
    ctx.font = 'bold 18px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('任务', w / 2, 25);

    const layout = RenderSystem.questLayout(
      gameState.dailyQuests || [], gameState.weeklyQuests || [], gameState.seasonQuests || [],
      gameState.metaScrollY || 0, w
    );
    const { itemW, itemH } = layout;

    // 一键领取（每日+每周+赛季）
    this._drawClaimAllButton(ctx, layout.claimAllRect);

    // 裁剪：任务列表只在返回按钮/一键领取以下区域显示
    this._beginScrollClip(ctx, w, h, 88);

    // 每日任务
    ctx.fillStyle = '#06b6d4';
    ctx.font = 'bold 14px sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText('📋 每日任务', 20, layout.dailyHeaderY);

    (gameState.dailyQuests || []).forEach((q, i) => {
      const { y } = layout.dailyRects[i];
      if (y + itemH < 0 || y > h) return;
      this._drawQuestItem(ctx, q, y, itemW, itemH, '#06b6d4');
    });

    // 每周任务
    ctx.fillStyle = '#10b981';
    ctx.font = 'bold 14px sans-serif';
    ctx.fillText('📅 每周任务', 20, layout.weeklyHeaderY);

    (gameState.weeklyQuests || []).forEach((q, i) => {
      const { y } = layout.weeklyRects[i];
      if (y + itemH < 0 || y > h) return;
      this._drawQuestItem(ctx, q, y, itemW, itemH, '#10b981');
    });

    // 赛季任务
    ctx.fillStyle = '#a78bfa';
    ctx.font = 'bold 14px sans-serif';
    ctx.fillText('🌟 赛季任务', 20, layout.seasonHeaderY);

    (gameState.seasonQuests || []).forEach((q, i) => {
      const { y } = layout.seasonRects[i];
      if (y + itemH < 0 || y > h) return;
      this._drawQuestItem(ctx, q, y, itemW, itemH, '#a78bfa');
    });

    this._endScrollClip(ctx);
  }

  // ==================== 成就面板 ====================
  drawAchievement(gameState) {
    const { ctx } = this;
    const w = this.screenWidth;
    const h = this.screenHeight;

    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, 0, w, h);

    ctx.fillStyle = '#f59e0b';
    ctx.font = 'bold 18px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('成就', w / 2, 25);

    const layout = RenderSystem.achievementLayout(
      gameState.achievements || [], gameState.metaScrollY || 0, w
    );
    const { itemW, itemH } = layout;

    // 一键领取
    this._drawClaimAllButton(ctx, layout.claimAllRect);

    // 裁剪：成就列表只在返回按钮/一键领取以下区域显示
    this._beginScrollClip(ctx, w, h, 88);

    ctx.fillStyle = '#f59e0b';
    ctx.font = 'bold 14px sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText('🏆 成就', 20, layout.headerY);

    (gameState.achievements || []).forEach((a, i) => {
      const { y } = layout.rects[i];
      if (y + itemH < 0 || y > h) return;
      this._drawQuestItem(ctx, a, y, itemW, itemH, '#f59e0b');
    });

    this._endScrollClip(ctx);
  }

  // ==================== 通行证面板 ====================
  drawBattlePass(gameState) {
    const { ctx } = this;
    const w = this.screenWidth;
    const h = this.screenHeight;
    const status = gameState.battlePassStatus || {};
    const rewards = gameState.battlePassRewards || [];

    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, 0, w, h);

    ctx.fillStyle = '#ec4899';
    ctx.font = 'bold 18px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('通行证', w / 2, 25);

    // 状态信息
    ctx.fillStyle = '#e2e8f0';
    ctx.font = '12px sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(`赛季: ${status.seasonName || ''}`, 20, 55);
    ctx.fillStyle = status.premium ? '#fbbf24' : '#94a3b8';
    ctx.fillText(`等级: ${status.level || 0}/${status.maxLevel || 50}  ${status.premium ? '⭐ 高级' : '免费版'}`, 20, 72);

    // 进度条
    const barX = 20, barY = 90, barW = w - 140, barH = 8;
    ctx.fillStyle = '#1e293b';
    ctx.fillRect(barX, barY, barW, barH);
    const progress = status.exp / (status.expPerLevel || 100);
    ctx.fillStyle = '#ec4899';
    ctx.fillRect(barX, barY, barW * Math.min(1, progress), barH);
    ctx.fillStyle = '#94a3b8';
    ctx.font = '9px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(`EXP: ${status.exp || 0}/${status.expPerLevel || 100}`, barX, barY + 12);

    // 一键领取按钮
    const claimX = w - 120, claimY = 50;
    ctx.fillStyle = '#ec489944';
    ctx.fillRect(claimX, claimY, 100, 32);
    ctx.strokeStyle = '#ec4899';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(claimX, claimY, 100, 32);
    ctx.fillStyle = '#ec4899';
    ctx.font = 'bold 11px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('一键领取', claimX + 50, claimY + 16);

    // 奖励列表
    const rowH = 50, rowGap = 4;
    const startY = 115 - (gameState.metaScrollY || 0);
    const colFreeX = 40, colPremX = 180;
    const cellW = 120;

    // 裁剪：奖励列表只在状态/进度条以下区域显示
    this._beginScrollClip(ctx, w, h, 100);

    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.font = 'bold 10px sans-serif';
    ctx.fillStyle = '#06b6d4';
    ctx.fillText('免费轨道', colFreeX + cellW / 2, startY - 18);
    ctx.fillStyle = '#fbbf24';
    ctx.fillText('高级轨道', colPremX + cellW / 2, startY - 18);

    for (let i = 0; i < rewards.length; i++) {
      const r = rewards[i];
      const ry = startY + i * (rowH + rowGap);
      if (ry + rowH < 100 || ry > h) continue;

      // 等级标签
      ctx.fillStyle = r.unlocked ? '#ec4899' : '#334155';
      ctx.font = 'bold 10px sans-serif';
      ctx.textAlign = 'right';
      ctx.fillText(`Lv${r.level}`, 35, ry + 18);

      // 免费轨道
      if (r.free) {
        this._drawRewardCell(ctx, colFreeX, ry, cellW, rowH, r.free, '#06b6d4');
      }

      // 高级轨道
      if (r.premium) {
        this._drawRewardCell(ctx, colPremX, ry, cellW, rowH, r.premium, '#fbbf24', !status.premium);
      }
    }

    this._endScrollClip(ctx);
  }

  _drawRewardCell(ctx, x, y, w, h, reward, color, locked) {
    ctx.fillStyle = locked ? '#1a1a2e' : '#1e293b';
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = reward.claimed ? '#334155' : (reward.claimable ? color : '#334155');
    ctx.lineWidth = 1;
    ctx.strokeRect(x, y, w, h);

    if (locked) {
      ctx.fillStyle = '#475569';
      ctx.font = '10px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('🔒 需高级', x + w / 2, y + h / 2);
      return;
    }

    if (reward.claimed) {
      ctx.fillStyle = '#64748b';
      ctx.font = '10px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('✓ 已领取', x + w / 2, y + h / 2);
      return;
    }

    // 奖励内容
    const rewardText = Object.entries(reward.reward || {}).map(([k, v]) => {
      const icons = { gold: '💰', diamond: '💎', stardust: '⭐' };
      return `${icons[k] || k}+${v}`;
    }).join(' ');
    ctx.fillStyle = reward.claimable ? color : '#64748b';
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(rewardText, x + w / 2, y + h / 2);

    if (reward.claimable) {
      ctx.fillStyle = color + '22';
      ctx.fillRect(x, y, w, 3);
    }
  }

  // ==================== 排行榜面板（Phase 5） ====================
  drawLeaderboard(gameState) {
    const { ctx } = this;
    const w = this.screenWidth;
    const h = this.screenHeight;

    // 背景
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, 0, w, h);

    // 标题
    ctx.fillStyle = '#fbbf24';
    ctx.font = 'bold 18px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('🏅 排行榜', w / 2, 28);

    // 榜单标签（与 handleLeaderboardClick 命中框一致；tab数随榜单定义）
    const boards = gameState.leaderboardBoards || [];
    const tabCount = Math.min(boards.length, 4);
    const tabW = 80, tabH = 30, tabGap = 8;
    const tabStartX = (w - (tabCount * tabW + (tabCount - 1) * tabGap)) / 2;
    const tabY = 55;
    for (let i = 0; i < tabCount; i++) {
      const x = tabStartX + i * (tabW + tabGap);
      const active = gameState.leaderboardTab === i;
      ctx.fillStyle = active ? '#7c3aed' : '#1e293b';
      ctx.fillRect(x, tabY, tabW, tabH);
      ctx.strokeStyle = active ? '#a78bfa' : '#475569';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(x, tabY, tabW, tabH);
      ctx.fillStyle = active ? '#ffffff' : '#94a3b8';
      ctx.font = 'bold 11px sans-serif';
      ctx.fillText(boards[i].label, x + tabW / 2, tabY + tabH / 2);
    }

    // 榜单数据
    const data = gameState.leaderboardData;
    if (!data || data.entries.length === 0) {
      ctx.fillStyle = '#64748b';
      ctx.font = '13px sans-serif';
      ctx.fillText('暂无数据', w / 2, h / 2);
      return;
    }

    const metric = data.board.metric;
    const unit = data.board.unit;
    const listStartY = 100;
    const rowH = 24;

    ctx.font = '12px sans-serif';
    for (let i = 0; i < data.entries.length; i++) {
      const e = data.entries[i];
      const y = listStartY + i * rowH;
      if (y > h - 90) break;

      // 玩家行高亮
      if (e.isPlayer) {
        ctx.fillStyle = 'rgba(251, 191, 36, 0.15)';
        ctx.fillRect(20, y - rowH / 2, w - 40, rowH);
      }

      // 名次
      const rankColor = i === 0 ? '#fbbf24' : (i === 1 ? '#cbd5e1' : (i === 2 ? '#d97706' : '#64748b'));
      ctx.fillStyle = rankColor;
      ctx.font = 'bold 12px sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(`${i + 1}`, 28, y);
      // 名字
      ctx.fillStyle = e.isPlayer ? '#fbbf24' : '#e2e8f0';
      ctx.font = e.isPlayer ? 'bold 12px sans-serif' : '12px sans-serif';
      ctx.fillText(e.isPlayer ? e.name + '（你）' : e.name, 55, y);
      // 数值
      ctx.fillStyle = e.isPlayer ? '#fbbf24' : '#94a3b8';
      ctx.textAlign = 'right';
      ctx.fillText(String(e[metric]) + unit, w - 28, y);
      ctx.textAlign = 'center';
    }

    // 玩家排名提示
    if (data.playerRank > 0) {
      ctx.fillStyle = '#a78bfa';
      ctx.font = 'bold 12px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(`你的排名: 第${data.playerRank}名`, w / 2, h - 40);
    }

    // 底部说明
    ctx.fillStyle = '#475569';
    ctx.font = '10px sans-serif';
    ctx.fillText('微信好友排行榜将在小游戏版接入', w / 2, h - 20);
  }

  // ==================== 抽卡面板 ====================
  drawGacha(gameState) {
    const { ctx } = this;
    const w = this.screenWidth;
    const h = this.screenHeight;
    const info = gameState.gachaInfo;
    const results = gameState.gachaResults;
    const revealIdx = gameState.gachaRevealIdx || 0;

    // 背景（直接绘制，避免离屏缓存 canvas 在界面切换时被浏览器回收导致残留）
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, '#1a0a2e');
    grad.addColorStop(0.5, '#0f172a');
    grad.addColorStop(1, '#1e1b4b');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);

    // === 如果有抽卡结果，展示结果覆盖层 ===
    if (results && results.length > 0) {
      this._drawGachaResult(gameState, results, revealIdx);
      return;
    }

    // === 抽卡主界面 ===
    // P34：统一走 RenderSystem.gachaLayout（与 Game.handleGachaClick 命中框同源）
    const L = RenderSystem.gachaLayout(w, h);

    // 标题（18px 与其他独立界面统一，避免窄屏上与右上角货币簇重叠）
    ctx.fillStyle = '#c084fc';
    ctx.font = 'bold 18px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('🎲 兵种招募', w / 2, L.titleY);

    if (!info) {
      ctx.fillStyle = '#64748b';
      ctx.font = '13px sans-serif';
      ctx.fillText('加载中...', w / 2, h / 2);
      return;
    }

    // 资源（💰⭐）已由统一顶部资源栏显示（renderScreen 尾部叠加）

    // 收集进度
    ctx.textAlign = 'center';
    ctx.fillStyle = '#94a3b8';
    ctx.font = '11px sans-serif';
    ctx.fillText(`已收集: ${info.ownedUnits}/${info.totalUnits}`, w / 2, L.ownedY);

    // 收集进度条
    ctx.fillStyle = '#1e293b';
    ctx.fillRect(L.progressX, L.progressY, L.progressW, 6);
    const progress = info.totalUnits > 0 ? info.ownedUnits / info.totalUnits : 0;
    ctx.fillStyle = '#7c3aed';
    ctx.fillRect(L.progressX, L.progressY, L.progressW * progress, 6);

    // 保底计数
    const pityProgress = info.pityCount / info.pityThreshold;
    ctx.fillStyle = '#94a3b8';
    ctx.font = '10px sans-serif';
    ctx.fillText(`保底进度: ${info.pityCount}/${info.pityThreshold} (必出史诗+)`, w / 2, L.pityTextY);

    // 保底进度条
    ctx.fillStyle = '#1e293b';
    ctx.fillRect(L.progressX, L.pityBarY, L.progressW, 4);
    ctx.fillStyle = pityProgress >= 0.8 ? '#f59e0b' : '#a78bfa';
    ctx.fillRect(L.progressX, L.pityBarY, L.progressW * pityProgress, 4);

    // === 概率展示（整块居中：名称 | 概率条 | 百分比）===
    ctx.fillStyle = '#64748b';
    ctx.font = 'bold 11px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('— 概率一览 —', w / 2, L.rateTitleY);

    const qualityNames = { 1: '普通', 2: '精良', 3: '稀有', 4: '史诗', 5: '传说', 6: '神话' };
    const qualityColors = { 1: '#9ca3af', 2: '#22c55e', 3: '#3b82f6', 4: '#a855f7', 5: '#f97316', 6: '#ef4444' };

    for (let i = 0; i < info.rates.length; i++) {
      const r = info.rates[i];
      const ry = L.rateStartY + i * L.rateStep;
      ctx.fillStyle = qualityColors[r.quality];
      ctx.font = '11px sans-serif';
      ctx.textAlign = 'right';
      ctx.fillText(qualityNames[r.quality], L.rateLabelRightX, ry);
      // 概率条
      ctx.fillStyle = '#1e293b';
      ctx.fillRect(L.rateBarX, ry - 4, L.rateBarW, 8);
      ctx.fillStyle = qualityColors[r.quality];
      ctx.fillRect(L.rateBarX, ry - 4, L.rateBarW * r.rate, 8);
      ctx.fillStyle = '#94a3b8';
      ctx.font = '10px sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText((r.rate * 100).toFixed(0) + '%', L.ratePctX, ry);
    }

    // === 底部说明（P34：移到单抽/十连按钮上方居中）===
    ctx.textAlign = 'center';
    ctx.fillStyle = '#475569';
    ctx.font = '10px sans-serif';
    ctx.fillText('重复兵种将转化为招募进度 + 星尘', w / 2, L.noteY1);
    ctx.fillText('保底：每10抽必出史诗品质以上兵种', w / 2, L.noteY2);

    // === 抽卡按钮 ===
    // 单抽按钮
    const canSingle = info.gold >= info.singleCost;
    ctx.fillStyle = canSingle ? '#7c3aed44' : '#1e293b';
    ctx.fillRect(L.singleX, L.btnY, L.btnW, L.btnH);
    ctx.strokeStyle = canSingle ? '#7c3aed' : '#334155';
    ctx.lineWidth = 2;
    ctx.strokeRect(L.singleX, L.btnY, L.btnW, L.btnH);
    ctx.fillStyle = canSingle ? '#c084fc' : '#475569';
    ctx.font = 'bold 14px sans-serif';
    ctx.fillText('单抽 ×1', L.singleX + L.btnW / 2, L.btnY + 16);
    ctx.fillStyle = canSingle ? '#fbbf24' : '#475569';
    ctx.font = 'bold 12px sans-serif';
    ctx.fillText('💰' + info.singleCost, L.singleX + L.btnW / 2, L.btnY + 36);

    // 十连按钮
    const canMulti = info.gold >= info.multiCost;
    ctx.fillStyle = canMulti ? '#f59e0b44' : '#1e293b';
    ctx.fillRect(L.multiX, L.btnY, L.btnW, L.btnH);
    ctx.strokeStyle = canMulti ? '#f59e0b' : '#334155';
    ctx.lineWidth = 2;
    ctx.strokeRect(L.multiX, L.btnY, L.btnW, L.btnH);
    ctx.fillStyle = canMulti ? '#fbbf24' : '#475569';
    ctx.font = 'bold 14px sans-serif';
    ctx.fillText('十连 ×10', L.multiX + L.btnW / 2, L.btnY + 16);
    ctx.fillStyle = canMulti ? '#fbbf24' : '#475569';
    ctx.font = 'bold 12px sans-serif';
    ctx.fillText('💰' + info.multiCost, L.multiX + L.btnW / 2, L.btnY + 36);

    // 十连优惠提示（按钮下方，与广告按钮保持间隙）
    ctx.fillStyle = '#4ade80';
    ctx.font = '10px sans-serif';
    ctx.fillText('（9折优惠 + 保底史诗+）', L.multiX + L.btnW / 2, L.discountY);

    // === 激励视频：看广告免费抽 ===
    // 全宽按钮（w-60），仅当 profile.dailyAdWatched 还有配额时启用
    const adCan = info.adsFreeDrawAvailable;
    const adWatched = info.adsFreeDrawWatched || 0;
    const adLimit = info.adsFreeDrawLimit || 1;

    // 按钮底色（绿色 = 激励视频标识）
    ctx.fillStyle = adCan ? '#10b98133' : '#1e293b';
    ctx.fillRect(L.adBtnX, L.adBtnY, L.adBtnW, L.adBtnH);
    ctx.strokeStyle = adCan ? '#10b981' : '#334155';
    ctx.lineWidth = 2;
    ctx.strokeRect(L.adBtnX, L.adBtnY, L.adBtnW, L.adBtnH);
    ctx.fillStyle = adCan ? '#6ee7b7' : '#475569';
    ctx.font = 'bold 13px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(adCan ? '📺 看广告免费抽 ×1' : `📺 今日已用完 (${adWatched}/${adLimit})`, L.adBtnX + L.adBtnW / 2, L.adBtnY + L.adBtnH / 2 - 1);
    ctx.fillStyle = adCan ? '#94a3b8' : '#475569';
    ctx.font = '9px sans-serif';
    ctx.fillText(adCan ? '观看完整视频可获得一次免费单抽' : '明天再来', L.adBtnX + L.adBtnW / 2, L.adBtnY + L.adBtnH - 7);
  }

  /**
   * 绘制抽卡结果展示
   */
  _drawGachaResult(gameState, results, revealIdx) {
    const { ctx } = this;
    const w = this.screenWidth;
    const h = this.screenHeight;

    // 全屏遮罩
    ctx.fillStyle = 'rgba(0,0,0,0.85)';
    ctx.fillRect(0, 0, w, h);

    const qualityColors = { 1: '#9ca3af', 2: '#22c55e', 3: '#3b82f6', 4: '#a855f7', 5: '#f97316', 6: '#ef4444' };
    const qualityNames = { 1: '普通', 2: '精良', 3: '稀有', 4: '史诗', 5: '传说', 6: '神话' };
    const qualityGlow = { 1: 'rgba(156,163,175,0.3)', 2: 'rgba(34,197,94,0.4)', 3: 'rgba(59,130,246,0.5)', 4: 'rgba(168,85,247,0.6)', 5: 'rgba(249,115,22,0.7)', 6: 'rgba(239,68,68,0.8)' };

    const isLast = revealIdx >= results.length - 1;
    const current = results[revealIdx];
    if (!current) return;

    const cardW = 180, cardH = 240;
    const cardX = (w - cardW) / 2;
    const cardY = (h - cardH) / 2 - 20;
    const color = qualityColors[current.quality] || '#9ca3af';
    const glow = qualityGlow[current.quality] || 'rgba(156,163,175,0.3)';

    // 光晕背景
    const glowGrad = ctx.createRadialGradient(w / 2, cardY + cardH / 2, 30, w / 2, cardY + cardH / 2, 200);
    glowGrad.addColorStop(0, glow);
    glowGrad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = glowGrad;
    ctx.fillRect(0, 0, w, h);

    // 卡片背景
    ctx.fillStyle = '#1e293b';
    ctx.fillRect(cardX, cardY, cardW, cardH);

    // 品质边框
    ctx.strokeStyle = color;
    ctx.lineWidth = 3;
    ctx.strokeRect(cardX, cardY, cardW, cardH);

    // 品质光带（顶部）
    const topGrad = ctx.createLinearGradient(cardX, cardY, cardX + cardW, cardY);
    topGrad.addColorStop(0, 'transparent');
    topGrad.addColorStop(0.5, color);
    topGrad.addColorStop(1, 'transparent');
    ctx.fillStyle = topGrad;
    ctx.fillRect(cardX, cardY, cardW, 4);

    // 品质标签
    ctx.fillStyle = color;
    ctx.font = 'bold 12px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(qualityNames[current.quality] || '', w / 2, cardY + 18);

    // 兵种图标（大）
    ctx.fillStyle = current.isNew ? color : '#64748b';
    ctx.font = 'bold 64px sans-serif';
    ctx.fillText(current.icon || '?', w / 2, cardY + 80);

    // 兵种名称
    ctx.fillStyle = current.isNew ? '#e2e8f0' : '#94a3b8';
    ctx.font = 'bold 18px sans-serif';
    ctx.fillText(current.name, w / 2, cardY + 140);

    // 新获得 / 重复
    if (current.isNew) {
      ctx.fillStyle = '#4ade80';
      ctx.font = 'bold 14px sans-serif';
      ctx.fillText('✨ 新兵种解锁！', w / 2, cardY + 165);
    } else {
      // 重复转化奖励
      const dr = current.duplicateReward;
      if (dr) {
        ctx.fillStyle = '#fbbf24';
        ctx.font = '12px sans-serif';
        ctx.fillText('🔄 重复转化', w / 2, cardY + 160);
        ctx.fillStyle = '#a78bfa';
        ctx.font = '11px sans-serif';
        ctx.fillText(`招募进度 +${dr.recruit}  ⭐+${dr.stardust}`, w / 2, cardY + 178);
      }
    }

    // 进度指示器（十连时显示当前位置）
    if (results.length > 1) {
      const dotsY = cardY + cardH + 15;
      const dotSize = 8, dotGap = 6;
      const dotsW = results.length * dotSize + (results.length - 1) * dotGap;
      const dotsX = (w - dotsW) / 2;
      for (let i = 0; i < results.length; i++) {
        const dx = dotsX + i * (dotSize + dotGap);
        ctx.fillStyle = i <= revealIdx ? color : '#334155';
        ctx.beginPath();
        ctx.arc(dx + dotSize / 2, dotsY + dotSize / 2, dotSize / 2, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // 点击提示
    ctx.fillStyle = '#94a3b8';
    ctx.font = '13px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    if (isLast) {
      ctx.fillText('▼ 点击关闭 ▼', w / 2, h - 50);
    } else {
      ctx.fillText(`点击继续 (${revealIdx + 1}/${results.length})`, w / 2, h - 50);
    }
  }

  _drawBackButton(ctx) {
    // 返回按钮统一放左下角（距左 16、距底 16），便于单手操作；顶部留给资源栏（左上角）
    const h = this.screenHeight;
    const { x: bx, w: bw, h: bh, bottom } = BACK_BTN;
    const by = h - bottom - bh;
    ctx.fillStyle = '#334155';
    ctx.fillRect(bx, by, bw, bh);
    ctx.strokeStyle = '#475569';
    ctx.lineWidth = 1;
    ctx.strokeRect(bx, by, bw, bh);
    ctx.fillStyle = '#e2e8f0';
    ctx.font = '12px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('← 返回', bx + bw / 2, by + bh / 2);
  }

  /**
   * 滚动列表裁剪：把可滚动内容限制在顶部固定区（分类标签/一键领取）以下、左下角返回按钮上方，
   * 防止列表上滚盖住顶部按钮、下滚与返回按钮重叠（P14 顶部 + P21 底部）。与 _endScrollClip 成对使用。
   * @param {number} topY 顶部固定区下边界（滚动内容可见区起点）
   */
  _beginScrollClip(ctx, w, h, topY) {
    const bottomY = h - BACK_BTN.bottom - BACK_BTN.h - SCROLL_BOTTOM_GAP;
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, topY, w, bottomY - topY);
    ctx.clip();
  }

  _endScrollClip(ctx) {
    ctx.restore();
  }

  /**
   * 绘制设置窗口 / 公告子窗口（覆盖层，点击由 Game._handleSettingsTap 处理）
   * 布局常量与 Game.SETTINGS_LAYOUT 同源（RenderSystem 不导入 Game，避免循环依赖）
   */
  _drawSettingsOverlay(gameState) {
    const { ctx } = this;
    const w = this.screenWidth;
    const h = this.screenHeight;
    // = Game.SETTINGS_LAYOUT
    const L = { panelW: 290, panelH: 316, rowW: 232, rowH: 44, rowGap: 14, rowStartOffset: 64, closeSize: 30 };

    // 半透明遮罩
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(0, 0, w, h);

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // === 公告子窗口 ===
    if (gameState.announceOpen) {
      const list = gameState.announcements || [];
      const itemH = 86;
      const aW = 300;
      const aH = Math.min(h - 30, 76 + list.length * itemH + 16);
      const ax = (w - aW) / 2;
      const ay = (h - aH) / 2;

      // 面板
      ctx.fillStyle = '#1e293b';
      ctx.fillRect(ax, ay, aW, aH);
      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = 2;
      ctx.strokeRect(ax, ay, aW, aH);

      // 标题
      ctx.fillStyle = '#38bdf8';
      ctx.font = 'bold 17px sans-serif';
      ctx.fillText('📢 公告', w / 2, ay + 26);

      // 关闭按钮
      const acb = { x: ax + aW - L.closeSize - 8, y: ay + 8, w: L.closeSize, h: L.closeSize };
      ctx.fillStyle = '#ef4444';
      ctx.fillRect(acb.x, acb.y, acb.w, acb.h);
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 14px sans-serif';
      ctx.fillText('✕', acb.x + acb.w / 2, acb.y + acb.h / 2);

      // 公告条目
      let iy = ay + 56;
      for (const item of list) {
        ctx.textAlign = 'left';
        ctx.fillStyle = '#fbbf24';
        ctx.font = 'bold 13px sans-serif';
        ctx.fillText(`${item.date}  ${item.title}`, ax + 14, iy);
        ctx.fillStyle = '#cbd5e1';
        ctx.font = '11px sans-serif';
        let ly = iy + 18;
        for (const line of (item.lines || [])) {
          ctx.fillText('· ' + line, ax + 16, ly);
          ly += 16;
        }
        ctx.textAlign = 'center';
        iy += itemH;
      }
      return;
    }

    // === 设置窗口 ===
    const p = { x: (w - L.panelW) / 2, y: (h - L.panelH) / 2, w: L.panelW, h: L.panelH };

    // 面板
    ctx.fillStyle = '#1e293b';
    ctx.fillRect(p.x, p.y, p.w, p.h);
    ctx.strokeStyle = '#475569';
    ctx.lineWidth = 2;
    ctx.strokeRect(p.x, p.y, p.w, p.h);

    // 标题
    ctx.fillStyle = '#e2e8f0';
    ctx.font = 'bold 17px sans-serif';
    ctx.fillText('⚙ 设置', w / 2, p.y + 28);

    // 关闭按钮（面板右上角）
    const cb = { x: p.x + p.w - L.closeSize - 8, y: p.y + 8, w: L.closeSize, h: L.closeSize };
    ctx.fillStyle = '#ef4444';
    ctx.fillRect(cb.x, cb.y, cb.w, cb.h);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 14px sans-serif';
    ctx.fillText('✕', cb.x + cb.w / 2, cb.y + cb.h / 2);

    // 行按钮：0=音效 1=音乐 2=震动 3=公告
    const rows = [
      { label: '🔔 音效', on: gameState.audioSfxEnabled !== false, onText: '开启', offText: '关闭' },
      { label: '🎵 背景音乐', on: gameState.audioBgmEnabled !== false, onText: '开启', offText: '关闭' },
      { label: '📳 震动', on: gameState.audioHapticEnabled !== false, onText: '开启', offText: '关闭' },
    ];
    for (let i = 0; i < 4; i++) {
      const r = { x: (w - L.rowW) / 2, y: p.y + L.rowStartOffset + i * (L.rowH + L.rowGap), w: L.rowW, h: L.rowH };

      if (i < 3) {
        // 开关行：开启=绿色，关闭=灰色
        const on = rows[i].on;
        ctx.fillStyle = on ? '#065f46' : '#374151';
        ctx.fillRect(r.x, r.y, r.w, r.h);
        ctx.strokeStyle = on ? '#34d399' : '#6b7280';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(r.x, r.y, r.w, r.h);

        ctx.textAlign = 'left';
        ctx.fillStyle = '#e2e8f0';
        ctx.font = 'bold 14px sans-serif';
        ctx.fillText(rows[i].label, r.x + 16, r.y + r.h / 2);

        // 右侧开关状态胶囊
        const pillW = 56;
        const pill = { x: r.x + r.w - pillW - 14, y: r.y + (r.h - 26) / 2, w: pillW, h: 26 };
        ctx.fillStyle = on ? '#10b981' : '#4b5563';
        ctx.fillRect(pill.x, pill.y, pill.w, pill.h);
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 12px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(on ? rows[i].onText : rows[i].offText, pill.x + pillW / 2, pill.y + 13);
      } else {
        // 公告按钮
        ctx.fillStyle = '#1d4ed8';
        ctx.fillRect(r.x, r.y, r.w, r.h);
        ctx.strokeStyle = '#60a5fa';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(r.x, r.y, r.w, r.h);
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 15px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('📢 公告', r.x + r.w / 2, r.y + r.h / 2);
      }
    }

    // 底部版本信息
    ctx.fillStyle = '#64748b';
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('占地之王 v1.7 · 设置自动保存', w / 2, p.y + p.h - 16);
  }

  /**
   * 绘制账号面板（登录 / 切换 / 注销多账号）
   */
  _drawAccountOverlay(gameState) {
    const { ctx } = this;
    const w = this.screenWidth;
    const h = this.screenHeight;
    // = Game.ACCOUNT_LAYOUT（与 Game.js 同源约定）
    const L = { panelW: 300, panelH: 340, rowH: 46, rowGap: 8, rowStartOffset: 54, maxRows: 3, btnH: 46, btnGap: 8, closeSize: 30 };

    // 半透明遮罩
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(0, 0, w, h);

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    const p = { x: (w - L.panelW) / 2, y: (h - L.panelH) / 2, w: L.panelW, h: L.panelH };

    // 面板
    ctx.fillStyle = '#1e293b';
    ctx.fillRect(p.x, p.y, p.w, p.h);
    ctx.strokeStyle = '#475569';
    ctx.lineWidth = 2;
    ctx.strokeRect(p.x, p.y, p.w, p.h);

    // 标题
    ctx.fillStyle = '#e2e8f0';
    ctx.font = 'bold 17px sans-serif';
    ctx.fillText('👤 账号', w / 2, p.y + 26);

    // 关闭按钮（右上角）
    const cb = { x: p.x + p.w - L.closeSize - 8, y: p.y + 8, w: L.closeSize, h: L.closeSize };
    ctx.fillStyle = '#ef4444';
    ctx.fillRect(cb.x, cb.y, cb.w, cb.h);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 14px sans-serif';
    ctx.fillText('✕', cb.x + cb.w / 2, cb.y + cb.h / 2);

    // 账号列表
    const list = gameState.accountList || [];
    const curId = gameState.currentAccountId;
    const rowCount = Math.min(list.length, L.maxRows);
    for (let i = 0; i < rowCount; i++) {
      const acc = list[i];
      const r = { x: p.x + 12, y: p.y + L.rowStartOffset + i * (L.rowH + L.rowGap), w: p.w - 24, h: L.rowH };
      const isCurrent = acc.id === curId;

      ctx.fillStyle = isCurrent ? '#064e3b' : '#334155';
      ctx.fillRect(r.x, r.y, r.w, r.h);
      ctx.strokeStyle = isCurrent ? '#34d399' : '#64748b';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(r.x, r.y, r.w, r.h);

      // 昵称 + 账号尾号
      ctx.textAlign = 'left';
      ctx.fillStyle = '#e2e8f0';
      ctx.font = 'bold 14px sans-serif';
      ctx.fillText('👤 ' + acc.nickname, r.x + 14, r.y + 16);
      ctx.fillStyle = '#94a3b8';
      ctx.font = '11px sans-serif';
      ctx.fillText('账号尾号 ' + (acc.uid ? acc.uid.slice(-6) : '—'), r.x + 14, r.y + 32);

      // 右侧操作区
      if (isCurrent) {
        ctx.textAlign = 'right';
        ctx.fillStyle = '#34d399';
        ctx.font = 'bold 13px sans-serif';
        ctx.fillText('✓ 当前', r.x + r.w - 14, r.y + r.h / 2);
      } else {
        // 删除按钮
        const del = { x: r.x + r.w - 32, y: r.y + (r.h - 28) / 2, w: 28, h: 28 };
        ctx.fillStyle = '#7f1d1d';
        ctx.fillRect(del.x, del.y, del.w, del.h);
        ctx.strokeStyle = '#f87171';
        ctx.lineWidth = 1;
        ctx.strokeRect(del.x, del.y, del.w, del.h);
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 13px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('🗑', del.x + del.w / 2, del.y + del.h / 2);
        // 切换提示
        ctx.textAlign = 'right';
        ctx.fillStyle = '#60a5fa';
        ctx.font = 'bold 12px sans-serif';
        ctx.fillText('⇄ 切换', r.x + r.w - 42, r.y + r.h / 2);
      }
      ctx.textAlign = 'center';
    }

    // 账号数超出 maxRows 提示
    if (list.length > L.maxRows) {
      ctx.fillStyle = '#94a3b8';
      ctx.font = '10px sans-serif';
      ctx.fillText(`…共 ${list.length} 个账号，仅显示前 ${L.maxRows} 个`, w / 2, p.y + L.rowStartOffset + L.maxRows * (L.rowH + L.rowGap) - 2);
    }

    // 「登录新账号」按钮
    const loginRect = { x: p.x + 16, y: p.y + L.rowStartOffset + L.maxRows * (L.rowH + L.rowGap) + L.btnGap, w: p.w - 32, h: L.btnH };
    ctx.fillStyle = '#1d4ed8';
    ctx.fillRect(loginRect.x, loginRect.y, loginRect.w, loginRect.h);
    ctx.strokeStyle = '#60a5fa';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(loginRect.x, loginRect.y, loginRect.w, loginRect.h);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 15px sans-serif';
    ctx.fillText('➕ 登录新账号', w / 2, loginRect.y + loginRect.h / 2);

    // 「注销当前账号」按钮
    const logoutRect = { x: p.x + 16, y: loginRect.y + L.btnH + L.btnGap, w: p.w - 32, h: L.btnH };
    ctx.fillStyle = '#7f1d1d';
    ctx.fillRect(logoutRect.x, logoutRect.y, logoutRect.w, logoutRect.h);
    ctx.strokeStyle = '#f87171';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(logoutRect.x, logoutRect.y, logoutRect.w, logoutRect.h);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 15px sans-serif';
    ctx.fillText('🚪 注销当前账号', w / 2, logoutRect.y + logoutRect.h / 2);
  }

  /**
   * 绘制屏幕浮动 Toast 提示（所有屏幕状态通用，最上层）
   */
  drawToast(gameState) {
    if (!gameState.toastText || gameState.toastTimer <= 0) return;

    const { ctx } = this;
    const w = this.screenWidth;
    const h = this.screenHeight;
    const text = gameState.toastText;

    // 淡入淡出：最后 0.5 秒透明度递减
    const alpha = gameState.toastTimer < 0.5 ? gameState.toastTimer / 0.5 : 1;

    ctx.save();
    ctx.globalAlpha = Math.max(0, Math.min(1, alpha));

    // 测量文本宽度
    ctx.font = 'bold 14px sans-serif';
    const metrics = ctx.measureText(text);
    const textW = metrics.width;
    const boxW = textW + 40;
    const boxH = 36;
    const boxX = (w - boxW) / 2;
    const boxY = h * 0.35; // 屏幕上方 35% 处

    // 背景
    ctx.fillStyle = 'rgba(15, 23, 42, 0.92)';
    ctx.fillRect(boxX, boxY, boxW, boxH);
    ctx.strokeStyle = '#ef4444';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(boxX, boxY, boxW, boxH);

    // 文本
    ctx.fillStyle = '#fef2f2';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, w / 2, boxY + boxH / 2);

    ctx.restore();
  }
}
