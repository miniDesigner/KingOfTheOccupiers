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
import { ArtSystem } from './ArtSystem.js';
import { FontSystem } from './FontSystem.js';
import { SCREEN_BG, RESULT_BG, ART_HOOKS, ART_PREFIXES, ART_INDEX } from './ArtManifest.js';
import { drawArtLayer, BATTLE_TONE_BY_LAYOUT, BG_BY_SCREEN, TERRITORY_EDGE,
  APP_ASSETS, FONT_CARDS, RACE_KEYS_ALL, UNIT_SMALL_KEYS_ALL,
  pick_rewardCell, pick_questItem, pick_qualityGlow, pick_gachaEpic,
  pick_tab, pick_tabIndicator, pick_switcher, pick_slider, pick_techNode,
  pick_techLine, pick_rankRow, pick_accountRow, pick_shopCard, pick_result,
  pick_gachaUi, pick_combatFx, pick_defeatFx, pick_buildBeam,
  pick_territoryWave, pick_rankShine, pick_ambient, pick_race, pick_unitSmall,
  pick_walkFrame, pick_unitDetail, pick_buildingDetail, pick_tutorialCard,
  pick_tutorialDots, pick_hudHp, pick_hudSynergy, pick_btnHover,
  iconKey, ICON_NAMES } from './ArtLayer.js';
import { rowItemWidth, rowStartX, adaptiveFontSize, techNodeWidth, techTabWidth, ladderBarWidth, resourceBarLayout, LAYOUT_DESIGN_MAX, LAYOUT_MIN, lobbyFuncBtnRect, lobbyPlayerCardRect, lobbySeasonCombo, lobbyDeployCardY, lobbyDeployLabelY } from './Layout.js';

// 安全区常量的单一真相源在 SafeArea.js，这里 re-export 保持既有引用兼容
export { SAFE_AREA_MAX } from './SafeArea.js';

// 左下角返回按钮几何（与 Game.BACK_BUTTON 同源）：距左 16、距底 16、宽 80、高 35
const BACK_BTN = { x: 16, w: 80, h: 35, bottom: 16 };

// 水印占位图总闸（P0 收口）：effects/*、ui/*、tiles/*、buildings/* 前缀的素材均为
// 带「特效/界面/地块/建筑 + 编号参数表」的粉紫水印占位图，无正式美术。它们通过
// _artHex/_artBuilding/_artFx 等直连通道绕过装饰层过滤，把水印贴到棋盘/建筑/引导层。
// 正式素材同名覆盖后把这些设 true（config artEffectDecor）即可恢复叠加；在此之前，
// _art() 统一在此拦下，露出底层本就完整的程序化绘制。兵种 units/* 按需求保留占位，不在名单内。
const WATERMARK_PREFIXES = ['effects/', 'ui/', 'tiles/', 'buildings/'];
// bg/ 前缀不能一刀切：lobby/battle/result/battle_tone/loading_art 是正式夜景图，
// 只有下列氛围叠层是带水印占位图（拼版逐一确认）。
const WATERMARK_BG_KEYS = new Set([
  'bg/lobby_fg', 'bg/gacha_circle', 'bg/bp_banner', 'bg/match_panel',
  'bg/panel_bg', 'bg/subpage_bg',
]);
// 已替换为正式美术的棋盘素材：这些 key 虽属 tiles/ 前缀，但不再是带水印占位图，
// 必须绕过 WATERMARK_PREFIXES 拦截。每出一版正式图并覆盖 assets/ 就往这里加一项。
// 注意：这些是「立体石砖」——自带六边形轮廓 + 厚度侧面，_artHex/_art 需走整图不裁剪 + 尺寸标定。
const SOLID_BOARD_KEYS = new Set(['tiles/hex_bright']);
// 立体石砖顶面在 312×312 图内的实测占比（OLD 饱满石砖）：
//   顶面 x≈30..280（宽 250 → 0.802）、y≈30..180（高 150 → 0.481）、中心 y≈105（0.337）。
// 形状铁律：顶面是横扁六边形(≈1.67)，格子是竖长尖顶六边形(≈0.87)，
//   若按 X/Y 分别拉到格子宽高，Y 向拉伸是 X 的 1.97 倍 → 石砖被拽成竖长盾牌形（变形）。
//   因此必须【等比】缩放：只按顶面宽度标定单一 draw，高度自然跟随，绝不单独拉伸 Y。
// 取顶面宽 = √3×HEX_SIZE × 1.08（略微过宽，让相邻石砖横向自然咬合、侧面/投影向下溢出格子）。
const SOLID_BOARD_FACE_W_RATIO = 0.802;
const SOLID_BOARD_FACE_CY_RATIO = 0.337;
const SOLID_BOARD_FACE_OVERSCAN = 1.08;
/** 立体石砖等比绘制矩形：draw 单一值，顶面横向≈格子宽、侧面/投影溢出格子下方 */
function solidBoardPlacement(x, y) {
  const draw = (Math.sqrt(3) * HEX_SIZE * SOLID_BOARD_FACE_OVERSCAN) / SOLID_BOARD_FACE_W_RATIO;
  return { drawW: draw, drawH: draw, ox: x - draw / 2, oy: y - draw * SOLID_BOARD_FACE_CY_RATIO };
}
function isWatermarkArtKey(key) {
  if (typeof key !== 'string') return false;
  if (SOLID_BOARD_KEYS.has(key)) return false;
  for (let i = 0; i < WATERMARK_PREFIXES.length; i++) {
    if (key.indexOf(WATERMARK_PREFIXES[i]) === 0) return true;
  }
  return WATERMARK_BG_KEYS.has(key);
}

// 已接入 ScreenShell（晴空乐园浅色骨架）的界面集合：逐个界面接入时往这里加一项。
// 用途：跳过 ArtLayer 的深色占位装饰层，避免水印/脏底透过云白卡。
const SHELL_SCREENS = new Set(['deploy_select', 'gacha', 'shop', 'tech_panel', 'battle_pass', 'quest', 'achievement', 'leaderboard']);

// 子界面兜底底色：底图未加载时用它顶上，避免露白底。
// 底图本身走 SCREEN_BG（当前全部子界面已统一为 bg/lobby_bg），保持单一真相源。
const SUBPAGE_BG_FALLBACK = '#0E1A2E';

// 深底（大厅夜景）上的文字三级色阶：标题 / 正文 / 弱提示
const ON_DARK = {
  title: '#EAF8FF',
  body: 'rgba(234, 248, 255, 0.88)',
  hint: 'rgba(234, 248, 255, 0.55)',
  green: '#4ADE80',   // UI_THEME.green(#168A4A) 在夜景底上几乎看不见
};

// 图标族语义键：与 assets/icons/ 下实际文件名一一对应；_artIcon 会在
// ART_INDEX 中做存在性检查，未命中即静默跳过，绝不产生 missing 统计。
// 大厅底部导航：商店 / 抽卡 / 布阵 / 科技 / 排行榜（第 6 项战斗复用 rank 兜底）
const NAV_ART_KEYS = ['shop', 'gacha', 'deploy', 'tech', 'rank', 'rank'];
// 大厅右上角功能按钮：分享 / 任务 / 成就 / 通行证（正式图标素材 icons/lobby_*.png）
const FUNC_ART_KEYS = ['share', 'quest', 'achieve', 'medal'];
// 右上角功能按钮文字（与图标一一对应，去掉底框后由图标+文字直接表达入口语义）
const FUNC_LABELS = ['分享', '任务', '成就', '通行证'];
// 商店分类：金币 / 钻石 / 兵种 / 道具 / 广告（P37 免费分页）
const SHOP_CAT_KEYS = ['coin', 'gem', 'unit', 'item', 'ad'];

// 品质色（Q1-Q6: 白/绿/蓝/紫/橙/红）—— 布阵槽位 / 兵种卡 / 大厅上阵预览共用
// 注意：这是功能色，独立于界面主调（ART-STYLE.md 2.4），不要随晴空乐园配色改动。
const QUALITY_COLORS = ['#9ca3af', '#22c55e', '#3b82f6', '#a855f7', '#f97316', '#ef4444'];

// 界面主调「晴空乐园」——与 ART-STYLE.md 2.1 同源。
// 用于程序化绘制的 UI（按钮/卡片/文字），与贴图素材保持同一视觉语言；
// 只影响「看起来」，不改任何 Layout 几何与点击命中。
const UI_THEME = {
  sky: '#5BB8E8', skyLight: '#7FC9EC', skyDeep: '#3E9FD1',
  cloud: '#EAF8FF', cloudDim: '#D6EEFB',
  // 文字三级色阶：ink 正文主色（最深）/ navy 次级 / navySoft 弱提示（仅深色底备用）
  ink: '#16304F', navy: '#2B4A6F', navySoft: '#4A6B8F',
  gold: '#FFD23F', goldDeep: '#E8A838',
  orange: '#FF8C42', orangeDeep: '#E8722F',
  white: '#FFFFFF', green: '#168A4A',
};

/**
 * 十六进制颜色 → rgba() 字符串，用于功能色发光/描边。异常输入回落白色半透明。
 */
function hexToRgba(color, alpha) {
  let hex = String(color || '').trim();
  if (hex[0] === '#') hex = hex.slice(1);
  if (hex.length === 3) hex = hex.split('').map(c => c + c).join('');
  if (!/^[0-9a-fA-F]{6}$/.test(hex)) return `rgba(255,255,255,${alpha})`;
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

/**
 * 由框体轮廓色/内容色派生「同色系淡底」，替代统一白底。
 * ratio = 原色占比（越小越接近白，保证深色文字可读）；返回不透明 rgb，彻底盖住背景地图。
 * 兼容 #RGB / #RRGGBB；异常输入回落到晴空乐园云白。
 */
function tintOf(color, ratio) {
  const k = Math.max(0.04, Math.min(0.55, ratio === undefined ? 0.14 : ratio));
  let hex = String(color || '').trim();
  if (hex[0] === '#') hex = hex.slice(1);
  if (hex.length === 3) hex = hex.split('').map(c => c + c).join('');
  if (!/^[0-9a-fA-F]{6}$/.test(hex)) return 'rgb(234,248,255)';
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  const mix = (c) => Math.round(c * k + 255 * (1 - k));
  return `rgb(${mix(r)},${mix(g)},${mix(b)})`;
}

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

    // === 美术资源层（占位图 / 后续正式素材共用）===
    // 只负责「画」，不改任何 Layout / 命中几何；图片未加载或环境不支持时静默兜底。
    this._curScreen = 'playing';
    this._curGameStatus = 'playing';
    this._artEnabled = true;

  }

  /**
   * 异步对战匹配 overlay 的命中/绘制单一真相源。
   * 数值与原 Game._handleMatchOverlayClick / _drawMatchOverlay 完全一致，仅换视觉容器。
   */
  static matchOverlayLayout(w, h) {
    const panelW = 300, panelH = 240;
    const panel = { x: (w - panelW) / 2, y: (h - panelH) / 2, w: panelW, h: panelH };
    const btnW = 220, btnH = 44;
    const cancelBtn = { x: (w - btnW) / 2, y: panel.y + panelH - btnH - 20, w: btnW, h: btnH, r: 12 };
    return { panel, cancelBtn };
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
   * 卡片式圆角绘制：用圆角路径裁剪画布后执行 drawFn（内部照常 fillRect/strokeRect）。
   * 这样几何与 fillRect 调用不变（测试断言不受影响），只在视觉上把直角方块变成圆角卡片。
   * 圆角半径随卡片高度自适应，避免小卡片过度圆润。
   * @param {{x:number,y:number,w:number,h:number,r?:number}} rect
   * @param {Function} drawFn
   */
  _drawCard(rect, drawFn) {
    const { ctx } = this;
    // 老基础库 / 测试桩可能没有 clip/arcTo：退化为直角绘制，视觉降级但几何与调用不变
    if (typeof ctx.clip !== 'function' || typeof ctx.arcTo !== 'function') {
      drawFn();
      return;
    }
    const r = Math.max(2, Math.min(rect.r === undefined ? 8 : rect.r, rect.w / 2, rect.h / 2));
    ctx.save();
    this._roundRectPath(rect.x, rect.y, rect.w, rect.h, r);
    ctx.clip();
    try {
      drawFn();
    } finally {
      ctx.restore();
    }
  }

  /**
   * 悬浮卡片：建立 UI 与背景的前后景层次。
   * 先在卡片矩形外扩一圈画柔和深色投影（不裁切、不落进 clip），
   * 再交给 _drawCard 用原有几何/fillRect 画卡片本体——测试断言与点击命中均不变。
   * 仅用于大厅；老基础库无 arcTo/fill 时静默跳过投影，视觉降级但不报错。
   */
  _drawRaisedCard(rect, drawFn) {
    const { ctx } = this;
    const r = Math.max(2, Math.min(rect.r === undefined ? 8 : rect.r, rect.w / 2, rect.h / 2));
    if (typeof ctx.arcTo === 'function' && typeof ctx.fill === 'function') {
      ctx.save();
      // 卡通厚底：卡片正下方偏移 4px 的海军蓝实心层，形成清晰的前后景分离（Q版卡片常用）
      ctx.fillStyle = 'rgba(22, 48, 79, 0.22)';
      this._roundRectPath(rect.x, rect.y + 4, rect.w, rect.h, r);
      ctx.fill();
      // 柔和阴影：让厚底与卡片本体之间的过渡更自然
      ctx.shadowColor = 'rgba(20, 48, 84, 0.26)';
      ctx.shadowBlur = 8;
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = 2;
      ctx.fillStyle = 'rgba(255,255,255,0.8)';
      this._roundRectPath(rect.x, rect.y, rect.w, rect.h, r);
      ctx.fill();
      ctx.restore();
    }
    this._drawCard(rect, drawFn);
  }

  /**
   * 信息胶囊底板：给「直接压在地图/天空上的裸文字」加一层云白承载区，
   * 让文字/图标与复杂背景分离。只画底板，不碰文字——调用方照常 ctx.fillText，
   * 因此测试的 fillText 断言与点击命中都不受影响。
   * @param {number} cx 文字水平中心
   * @param {number} cy 文字垂直中心
   * @param {string} text 文字内容（用于估算胶囊宽度）
   * @param {string} font 与文字一致的 font 字符串（用于解析字号）
   * @param {{padX?:number,padY?:number,border?:string,tint?:string}} opts
   *        tint: 底色来源色（轮廓/内容色），会派生同色系淡底；缺省用 border。
   */
  _drawTextPillBg(cx, cy, text, font, opts) {
    const { ctx } = this;
    const o = opts || {};
    const padX = o.padX === undefined ? 9 : o.padX;
    const padY = o.padY === undefined ? 3 : o.padY;
    const border = o.border || 'rgba(43,74,111,0.32)';
    const tint = o.tint || border;
    let fontSize = 12;
    const fm = /(\d+(?:\.\d+)?)px/.exec(font || '');
    if (fm) fontSize = parseFloat(fm[1]);
    let tw = fontSize * String(text || '').length * 0.82;
    if (typeof ctx.measureText === 'function') {
      ctx.save();
      ctx.font = font;
      const mt = ctx.measureText(text);
      if (mt && mt.width) tw = mt.width;
      ctx.restore();
    }
    const pillW = Math.min(this.screenWidth - 12, tw + padX * 2);
    const pillH = fontSize + padY * 2;
    const x = cx - pillW / 2;
    const y = cy - pillH / 2;
    const r = Math.min(pillH / 2, 12);
    // 薄厚底：与悬浮卡片同一视觉语言，但更轻
    if (typeof ctx.arcTo === 'function' && typeof ctx.fill === 'function') {
      ctx.save();
      ctx.fillStyle = 'rgba(22,48,79,0.16)';
      this._roundRectPath(x, y + 2, pillW, pillH, r);
      ctx.fill();
      ctx.restore();
    }
    this._drawCard({ x, y, w: pillW, h: pillH, r }, () => {
      ctx.fillStyle = tintOf(tint, 0.10);
      ctx.fillRect(x, y, pillW, pillH);
      ctx.strokeStyle = border;
      ctx.lineWidth = 1;
      ctx.strokeRect(x, y, pillW, pillH);
    });
  }

  // ===================== 统一纵向栅格 L-SCALE（方案 M1）=====================
  // 子界面没有底部导航（大厅独有），用独立一套三段栅格，所有屏共用同一基线：
  //   状态带 8→60 / 内容区 72→h-80 / 操作带 h-80→h-16，安全底 16。
  // 设计稿见 design/layout-grid.html，规格见 UI-LAYOUT-PLAN.md §1。
  // 纯计算、不依赖 ctx，渲染与命中两侧都可读，杜绝各屏自填 88/90/95 三套顶边。
  static L_SCALE(w, h) {
    const sw = Number(w) || 375;
    const sh = Number(h) || 667;
    const STATUS_Y = 8;
    const STATUS_H = 52;
    const CONTENT_TOP = 72;
    const FOOTER_H = 56;
    const FOOTER_GAP = 16;
    const CONTENT_BOTTOM = sh - 80; // = h - FOOTER_GAP - FOOTER_H - 8
    const SIDE = 16;
    const tier = (sw <= 360 || sh <= 640) ? 'S' : (sw <= 400 ? 'M' : 'L');
    // 主 CTA：返回按钮右侧起步（BACK_BTN.x + w + 12），右留 SIDE
    const ctaX = BACK_BTN.x + BACK_BTN.w + 12;
    const ctaW = Math.max(80, sw - ctaX - SIDE);
    const ctaY = sh - FOOTER_GAP - 48;
    return {
      w: sw, h: sh, tier,
      STATUS_Y, STATUS_H, CONTENT_TOP, FOOTER_H, FOOTER_GAP, CONTENT_BOTTOM, SIDE,
      statusRect: { x: SIDE, y: STATUS_Y, w: sw - SIDE * 2, h: STATUS_H },
      contentRect: { x: SIDE, y: CONTENT_TOP, w: sw - SIDE * 2, h: Math.max(0, CONTENT_BOTTOM - CONTENT_TOP) },
      footerRect: { x: SIDE, y: sh - FOOTER_GAP - FOOTER_H, w: sw - SIDE * 2, h: FOOTER_H },
      ctaRect: { x: ctaX, y: ctaY, w: ctaW, h: 48 },
    };
  }

  /** 标题胶囊左限：资源栏簇右缘 + 8 呼吸位。渲染侧算好传给 _screenHeader，保证命中/绘制同源。 */
  static headerLeftLimit(values, w) {
    const layout = resourceBarLayout(values || [], w, w - 103);
    return BACK_BTN.x + layout.clusterW + 8;
  }

  // ===================== 子界面统一骨架 ScreenShell =====================
  // 规格见 UI-SCREENS.md §3：夜景舞台底 + 云白厚底卡 + 海军蓝文字三级。
  // 全部为纯绘制，不改 Layout 几何、不改点击命中；各界面按制作顺序逐个接入。

  /**
   * 子界面统一背景：直接复用大厅底图（`bg/lobby_bg`），再叠一层压暗层当「舞台底」。
   *
   * 为什么不各自画渐变：大厅是深靛夜景，子界面若用天蓝→云白，切换时色调割裂。
   * 共用同一张底图后，远山/雾面/云海的层次在子界面同样成立，只是被压暗，
   * 让云白内容卡成为唯一亮面——背景负责氛围，卡片负责信息。
   *
   * @param {string} [bgKey] 覆盖底图 key（默认 SCREEN_BG[screen]）
   * @param {number} [artAlpha] 底图不透明度，缺省取 features.artSubpageBgAlpha
   */
  _screenBg(bgKey, artAlpha) {
    const { ctx } = this;
    const w = this.screenWidth;
    const h = this.screenHeight;
    const a = artAlpha === undefined ? ArtSystem.subpageBgAlpha : artAlpha;

    // 兜底底色：底图未加载 / 加载失败时不能露出白底
    ctx.fillStyle = SUBPAGE_BG_FALLBACK;
    ctx.fillRect(0, 0, w, h);

    const drawn = a > 0 && this._art(bgKey || this._screenBgKey(), 0, 0, w, h, { fit: 'cover', alpha: a });
    if (!drawn) {
      // 底图缺失时退化为一层夜景渐变，至少保持「深底 + 云白卡」的对比关系
      if (typeof ctx.createLinearGradient === 'function') {
        const fb = ctx.createLinearGradient(0, 0, 0, h);
        fb.addColorStop(0, '#0B1424');
        fb.addColorStop(0.55, '#16243A');
        fb.addColorStop(1, '#0A1220');
        ctx.fillStyle = fb;
      } else {
        ctx.fillStyle = SUBPAGE_BG_FALLBACK;
      }
      ctx.fillRect(0, 0, w, h);
    }

    // 压暗层：中段留亮（保住远山与雾面层次），两端沉下去托住资源栏与底部按钮
    if (typeof ctx.createLinearGradient === 'function') {
      const veil = ctx.createLinearGradient(0, 0, 0, h);
      veil.addColorStop(0, 'rgba(6, 14, 28, 0.52)');
      veil.addColorStop(0.42, 'rgba(6, 14, 28, 0.24)');
      veil.addColorStop(0.72, 'rgba(6, 14, 28, 0.34)');
      veil.addColorStop(1, 'rgba(6, 14, 28, 0.58)');
      ctx.fillStyle = veil;
    } else {
      ctx.fillStyle = 'rgba(6, 14, 28, 0.34)';
    }
    ctx.fillRect(0, 0, w, h);
  }

  /**
   * 子界面标题胶囊：云白厚底，居中标题 + 可选强调竖条。
   * 只画标题与底板，不改原有标题 baseline 语义（调用方不再单独 fillText）。
   * @param {string} title
   * @param {{cy?:number, accent?:string, icon?:string}} [opts]
   */
  _screenHeader(title, opts) {
    const { ctx } = this;
    const o = opts || {};
    const w = this.screenWidth;
    const text = String(title || '');
    const fontSize = o.fontSize || 17;
    const font = `bold ${fontSize}px sans-serif`;
    let tw = fontSize * text.length * 0.9;
    if (typeof ctx.measureText === 'function') {
      ctx.save();
      ctx.font = font;
      const mt = ctx.measureText(text);
      if (mt && mt.width) tw = mt.width;
      ctx.restore();
    }
    const padX = o.accent ? 16 : 18;
    // 标题在「资源栏簇右缘 → 右安全边」区间居中，不再全屏居中（方案 M1，关闭 G1）。
    // leftLimit 由调用方按 resourceBarLayout 真实结果传入；未传时用最窄簇(120)估算，
    // 保证即使漏传也不会压到货币格。删掉原 w<380→104 硬编码，三档共用同一算法。
    const leftLimit = o.leftLimit === undefined
      ? (BACK_BTN.x + Math.min(120, w - BACK_BTN.x - 95) + 8)
      : o.leftLimit;
    const rightLimit = o.rightLimit === undefined ? BACK_BTN.x : o.rightLimit;
    const availW = Math.max(80, w - leftLimit - rightLimit);
    const pillW = Math.min(availW, tw + padX * 2);
    const pillH = 34;
    const S = RenderSystem.L_SCALE(w, this.screenHeight);
    const cy = o.cy === undefined ? S.STATUS_Y + S.STATUS_H / 2 - 4 : o.cy;
    const cx = leftLimit + availW / 2;
    const x = cx - pillW / 2;
    const y = cy - pillH / 2;

    this._drawRaisedCard({ x, y, w: pillW, h: pillH, r: 12 }, () => {
      ctx.fillStyle = 'rgba(255,255,255,0.94)';
      ctx.fillRect(x, y, pillW, pillH);
      if (o.accent) {
        ctx.fillStyle = o.accent;
        ctx.fillRect(x + 8, y + 9, 4, pillH - 18);
      }
    });

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = UI_THEME.ink;
    ctx.font = font;
    ctx.fillText(text, cx + (o.accent ? 4 : 0), cy + 1);
  }

  /**
   * 区块标题：左侧 3px 竖条 + 12px bold 海军蓝，可选右侧弱提示。
   * @param {string} text 主标题
   * @param {number} x 左边界
   * @param {number} y 文字垂直中心
   * @param {{accent?:string, hint?:string, hintRight?:number}} [opts]
   */
  _sectionLabel(text, x, y, opts) {
    const { ctx } = this;
    const o = opts || {};
    const accent = o.accent || UI_THEME.skyDeep;
    // 子界面底已改为大厅夜景：标题直接压背景，必须用浅色；压在云白卡内时传 onLight
    const onLight = !!o.onLight;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = accent;
    if (typeof ctx.fillRect === 'function') ctx.fillRect(x, y - 7, 3, 14);
    ctx.fillStyle = onLight ? UI_THEME.navy : ON_DARK.title;
    ctx.font = 'bold 12px sans-serif';
    ctx.fillText(text, x + 8, y);
    if (o.hint) {
      ctx.textAlign = 'right';
      ctx.fillStyle = onLight ? 'rgba(22,48,79,0.45)' : ON_DARK.hint;
      ctx.font = '9px sans-serif';
      ctx.fillText(o.hint, o.hintRight === undefined ? this.screenWidth - 15 : o.hintRight, y);
      ctx.textAlign = 'left';
    }
  }

  /**
   * 内容卡底：云白厚底 + 圆角 + 可选左侧/顶部强调色条。
   * 只负责底板，卡内内容仍由调用方按原几何绘制（因此点击命中完全不变）。
   * @param {{x:number,y:number,w:number,h:number,r?:number}} rect
   * @param {{tint?:string, border?:string, edge?:string, edgeSide?:'left'|'top', dashed?:boolean}} [opts]
   */
  _cardBg(rect, opts) {
    const { ctx } = this;
    const o = opts || {};
    const r = o.r === undefined ? 12 : o.r;
    const x = rect.x, y = rect.y, cw = rect.w, ch = rect.h;

    const paint = () => {
      ctx.fillStyle = o.tint || 'rgba(255,255,255,0.90)';
      ctx.fillRect(x, y, cw, ch);
      if (o.edge) {
        ctx.fillStyle = o.edge;
        if (o.edgeSide === 'top') ctx.fillRect(x, y, cw, 3);
        else ctx.fillRect(x, y, 3, ch);
      }
    };

    // flat：只画平面底，不带厚底与投影。
    // 用于「容器底 / 空槽位」这类本该比内容更弱的面——_drawRaisedCard 会预填一层
    // rgba(255,255,255,0.8) 柔光，半透深色叠上去会变成灰白板，在夜景底上尤其明显。
    if (o.flat) {
      if (typeof ctx.arcTo === 'function') {
        ctx.save();
        this._roundRectPath(x, y, cw, ch, Math.max(2, Math.min(r, cw / 2, ch / 2)));
        ctx.clip();
        paint();
        ctx.restore();
      } else {
        paint();
      }
    } else {
      this._drawRaisedCard({ x, y, w: cw, h: ch, r }, paint);
    }
    if (o.border) {
      // 老基础库没有 arcTo：退化为直角描边，视觉降级但绝不能让整个界面抛错
      if (typeof ctx.arcTo === 'function') {
        ctx.save();
        this._roundRectPath(x, y, cw, ch, Math.max(2, Math.min(r, cw / 2, ch / 2)));
        ctx.strokeStyle = o.border;
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.restore();
      } else {
        ctx.strokeStyle = o.border;
        ctx.lineWidth = 1.5;
        ctx.strokeRect(x, y, cw, ch);
      }
    }
  }

  /**
   * 主 CTA 按钮：明黄→活力橙竖渐变 + 云白描边 + 深棕文字。
   * @param {{x:number,y:number,w:number,h:number,r?:number}} rect
   * @param {string} label
   * @param {{disabled?:boolean}} [opts]
   */
  _primaryButton(rect, label, opts) {
    const { ctx } = this;
    const o = opts || {};
    const r = rect.r === undefined ? 14 : rect.r;
    const x = rect.x, y = rect.y, bw = rect.w, bh = rect.h;
    if (o.disabled) {
      // 禁用态用平面暗块：亮灰块在夜景底上会显得"可点"，与语义相反
      this._cardBg({ x, y, w: bw, h: bh, r }, {
        tint: 'rgba(255,255,255,0.14)',
        border: 'rgba(234,248,255,0.20)',
        flat: true,
      });
      ctx.fillStyle = 'rgba(234,248,255,0.45)';
      ctx.font = 'bold 16px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, x + bw / 2, y + bh / 2 + 1);
      return;
    }
    this._drawRaisedCard(rect, () => {
      if (typeof ctx.createLinearGradient === 'function') {
        const g = ctx.createLinearGradient(0, y, 0, y + bh);
        g.addColorStop(0, UI_THEME.gold);
        g.addColorStop(1, UI_THEME.orange);
        ctx.fillStyle = g;
      } else {
        ctx.fillStyle = UI_THEME.gold;
      }
      ctx.fillRect(x, y, bw, bh);
    });
    // 白描边：老基础库无 arcTo 时退化为直角描边，绝不抛错（覆盖层 also 复用本组件）
    ctx.save();
    if (typeof ctx.arcTo === 'function') {
      this._roundRectPath(x, y, bw, bh, Math.max(2, Math.min(r, bw / 2, bh / 2)));
      ctx.strokeStyle = 'rgba(255,255,255,0.85)';
      ctx.lineWidth = 2;
      ctx.stroke();
    } else {
      ctx.strokeStyle = 'rgba(255,255,255,0.85)';
      ctx.lineWidth = 2;
      ctx.strokeRect(x, y, bw, bh);
    }
    ctx.restore();
    ctx.fillStyle = '#4A2A00';
    ctx.font = 'bold 16px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, x + bw / 2, y + bh / 2 + 1);
  }

  /**
   * 次级按钮：云白/浅蓝底 + 海军蓝描边与文字，语义为「取消 / 返回」而非主行动。
   * 与 _primaryButton 共用几何参数，老基础库无 arcTo 时退化为直角，绝不抛错。
   */
  _secondaryButton(rect, label, opts) {
    const { ctx } = this;
    const o = opts || {};
    const r = rect.r === undefined ? 12 : rect.r;
    const x = rect.x, y = rect.y, bw = rect.w, bh = rect.h;
    this._cardBg({ x, y, w: bw, h: bh, r }, {
      tint: o.tint || 'rgba(234,248,255,0.96)',
      border: o.border || 'rgba(43,74,111,0.42)',
    });
    ctx.save();
    if (typeof ctx.arcTo === 'function') {
      this._roundRectPath(x, y, bw, bh, Math.max(2, Math.min(r, bw / 2, bh / 2)));
      ctx.strokeStyle = o.border || 'rgba(43,74,111,0.42)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    } else {
      ctx.strokeStyle = o.border || 'rgba(43,74,111,0.42)';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(x, y, bw, bh);
    }
    ctx.restore();
    ctx.fillStyle = o.color || UI_THEME.navy;
    ctx.font = 'bold 15px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, x + bw / 2, y + bh / 2 + 1);
    ctx.textBaseline = 'alphabetic';
  }

  /**
   * 进度条：低饱和槽底 + 强调色填充（任务 / 通行证 / 科技 / 图鉴等所有进度复用）。
   * 只画底板与填充，不改调用方几何；ratio 自动夹在 0~1。
   * @param {{x:number,y:number,w:number,h:number}} rect
   * @param {number} ratio 0~1
   * @param {{color?:string, track?:string, r?:number}} [opts]
   */
  _progressBar(rect, ratio, opts) {
    const { ctx } = this;
    const o = opts || {};
    const x = rect.x, y = rect.y, bw = rect.w, bh = rect.h;
    const r = Math.max(1, Math.min(bh / 2, o.r === undefined ? bh / 2 : o.r));
    const v = Math.max(0, Math.min(1, Number(ratio) || 0));
    const track = o.track || 'rgba(43,74,111,0.13)';
    const fill = o.color || UI_THEME.skyDeep;
    if (typeof ctx.arcTo !== 'function') {
      ctx.fillStyle = track;
      ctx.fillRect(x, y, bw, bh);
      if (v > 0) {
        ctx.fillStyle = fill;
        ctx.fillRect(x, y, bw * v, bh);
      }
      return;
    }
    ctx.save();
    this._roundRectPath(x, y, bw, bh, r);
    ctx.fillStyle = track;
    ctx.fill();
    ctx.restore();
    if (v > 0) {
      ctx.save();
      // 填充段最小宽度取一个条高，避免 1% 时视觉上「消失」
      this._roundRectPath(x, y, Math.max(bh, bw * v), bh, r);
      ctx.fillStyle = fill;
      ctx.fill();
      ctx.restore();
    }
  }

  /**
   * 分段页签：云白胶囊底 + 激活项强调色实底药丸。
   * 用于商店品类、排行榜分类、任务/成就切换等「同一屏内多列表」的场景。
   * 返回值与各段几何一致，调用方可直接用来对齐原有命中框。
   * @param {{x:number,y:number,w:number,h:number}} rect 页签整条区域（不含外扩内边距）
   * @param {string[]} labels
   * @param {number} activeIndex
   * @param {{accent?:string}} [opts]
   * @returns {Array<{x:number,y:number,w:number,h:number,cx:number}>}
   */
  _tabs(rect, labels, activeIndex, opts) {
    const { ctx } = this;
    const o = opts || {};
    const accent = o.accent || UI_THEME.skyDeep;
    const list = Array.isArray(labels) ? labels : [];
    const n = Math.max(1, list.length);
    const gap = 4;
    const segW = (rect.w - gap * (n - 1)) / n;
    const cells = [];

    // 整体槽底：云白半透胶囊，托住所有页签
    this._cardBg(
      { x: rect.x - 4, y: rect.y - 4, w: rect.w + 8, h: rect.h + 8, r: (rect.h + 8) / 2 },
      { tint: 'rgba(255,255,255,0.74)' }
    );

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let i = 0; i < n; i++) {
      const x = rect.x + i * (segW + gap);
      const isActive = i === activeIndex;
      if (isActive) {
        if (typeof ctx.arcTo === 'function') {
          ctx.save();
          this._roundRectPath(x, rect.y, segW, rect.h, rect.h / 2);
          ctx.fillStyle = accent;
          ctx.fill();
          ctx.restore();
        } else {
          ctx.fillStyle = accent;
          ctx.fillRect(x, rect.y, segW, rect.h);
        }
      }
      ctx.fillStyle = isActive ? UI_THEME.white : UI_THEME.navy;
      ctx.font = isActive ? 'bold 13px sans-serif' : '12px sans-serif';
      ctx.fillText(list[i], x + segW / 2, rect.y + rect.h / 2 + 1);
      cells.push({ x, y: rect.y, w: segW, h: rect.h, cx: x + segW / 2 });
    }
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    return cells;
  }

  /**
   * 列表行底（任务 / 成就 / 排行榜通用）：云白卡 + 可选左侧强调条 + 可选交错底色。
   * 只画底板，行内图标/文字/按钮由调用方按原几何绘制。
   * @param {{x:number,y:number,w:number,h:number,r?:number}} rect
   * @param {{alt?:boolean, tint?:string, border?:string, edge?:string, edgeSide?:'left'|'top', r?:number}} [opts]
   */
  _listRow(rect, opts) {
    const o = opts || {};
    this._cardBg(rect, {
      tint: o.tint || (o.alt ? 'rgba(255,255,255,0.82)' : 'rgba(255,255,255,0.95)'),
      border: o.border || null,
      edge: o.edge || null,
      edgeSide: o.edgeSide || 'left',
      r: o.r === undefined ? 12 : (rect.h <= 32 ? 8 : o.r),
    });
    // leading 名次槽：方案 M2 要求 _listRow 支持 leading:'rank'。名次文字在两档都画，
    // compact 只额外把圆角收到 8px、字号调到 11px。行内其他内容仍由调用方按原几何绘制。
    if (o.leadingText !== undefined || o.compact) {
      const { ctx } = this;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = UI_THEME.navy;
      ctx.font = `${o.compact ? 11 : 13}px sans-serif`;
      if (o.leadingText !== undefined) ctx.fillText(String(o.leadingText), rect.x + 10, rect.y + rect.h / 2);
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
    }
  }

  /**
   * 商品卡（方案 M2）：云白卡 + 图标位 + 名称/副文 + 价格或购买按钮 + 可选「免费」角标。
   * 全部文字与孔洞按 rect 相对定位，调用方只需给卡几何与商品数据，不改点击命中。
   * @param {{x,y,w,h}} rect
   * @param {{icon?:string,name:string,desc?:string,price?:string,button?:string,
   *          free?:boolean,disabled?:boolean,iconKey?:string}} item
   */
  _goodsCard(rect, item) {
    const { ctx } = this;
    const d = item || {};
    const x = rect.x, y = rect.y, cw = rect.w, ch = rect.h;
    this._cardBg(rect, {
      tint: 'rgba(255,255,255,0.95)',
      border: d.disabled ? 'rgba(43,74,111,0.16)' : 'rgba(255,210,63,0.30)',
      r: 12,
    });
    const iconS = Math.min(48, ch - 20);
    const iconX = x + 10, iconY = y + 10;
    // 图标位：贴图优先，未加载画云白凹槽占位，绝不出现裸 emoji
    const drawn = d.iconKey ? this._artIcon(d.iconKey.icon, d.iconKey.name, iconX + iconS / 2, iconY + iconS / 2, iconS * 0.8) : false;
    if (!drawn) {
      this._cardBg({ x: iconX, y: iconY, w: iconS, h: iconS, r: 8 },
        { tint: 'rgba(43,74,111,0.06)', flat: true });
      if (d.icon) {
        ctx.fillStyle = UI_THEME.navySoft;
        ctx.font = `${Math.round(iconS * 0.42)}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(d.icon, iconX + iconS / 2, iconY + iconS / 2);
        ctx.textAlign = 'left';
        ctx.textBaseline = 'alphabetic';
      }
    }
    const tx = x + 68;
    const tw = Math.max(20, cw - 78);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = d.disabled ? UI_THEME.navySoft : UI_THEME.ink;
    ctx.font = 'bold 12px sans-serif';
    this._fitText(String(d.name || ''), tx, y + 16, tw, 12);
    if (d.desc) {
      ctx.fillStyle = UI_THEME.navySoft;
      ctx.font = '9px sans-serif';
      this._fitText(String(d.desc), tx, y + 33, tw, 9);
    }
    // 价格文案或购买按钮
    const btnW = Math.min(76, tw);
    const btnH = 26;
    const bx = tx, by = y + ch - btnH - 10;
    if (d.button) {
      if (d.disabled) {
        this._cardBg({ x: bx, y: by, w: btnW, h: btnH, r: 8 },
          { tint: 'rgba(43,74,111,0.14)', flat: true, border: 'rgba(43,74,111,0.18)' });
        ctx.fillStyle = UI_THEME.navySoft;
      } else {
        this._cardBg({ x: bx, y: by, w: btnW, h: btnH, r: 8 },
          { tint: d.free ? UI_THEME.gold : UI_THEME.skyDeep, flat: true });
        ctx.fillStyle = d.free ? '#4A2A00' : '#FFFFFF';
      }
      ctx.font = 'bold 10px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(String(d.button), bx + btnW / 2, by + btnH / 2 + 1);
      ctx.textAlign = 'left';
    } else if (d.price) {
      ctx.fillStyle = UI_THEME.goldDeep;
      ctx.font = 'bold 11px sans-serif';
      ctx.fillText(String(d.price), bx, by + btnH / 2);
    }
    // 免费角标：左上明黄小旗，盖在卡边角
    if (d.free) {
      const tagW = 52, tagH = 20;
      if (typeof ctx.arcTo === 'function') {
        ctx.save();
        this._roundRectPath(x, y, tagW, tagH, Math.min(10, tagW / 2));
        ctx.fillStyle = UI_THEME.gold;
        ctx.fill();
        ctx.restore();
      } else {
        ctx.fillStyle = UI_THEME.gold;
        ctx.fillRect(x, y, tagW, tagH);
      }
      ctx.fillStyle = '#4A2A00';
      ctx.font = 'bold 10px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('免费', x + tagW / 2, y + tagH / 2 + 1);
      ctx.textAlign = 'left';
    }
    ctx.textBaseline = 'alphabetic';
  }

  /**
   * 科技节点卡（方案 M2）：品质竖条 + 图标位 + 名称 + Lv/MAX 角标 + 花费条。
   * state: 'locked' | 'available' | 'max'；三态只改描边/文字明度，几何不变。
   * @param {{x,y,w,h}} rect
   * @param {{name:string,state?:string,quality?:string,level?:number,cost?:string,icon?:string,iconKey?:object}} d
   */
  _nodeCard(rect, d) {
    const { ctx } = this;
    d = d || {};
    const x = rect.x, y = rect.y, cw = rect.w, ch = rect.h;
    const state = d.state || 'available';
    const locked = state === 'locked';
    const max = state === 'max';
    this._cardBg(rect, {
      tint: locked ? 'rgba(234,248,255,0.72)' : 'rgba(255,255,255,0.95)',
      border: locked ? 'rgba(43,74,111,0.18)' : (max ? 'rgba(74,222,128,0.45)' : 'rgba(255,210,63,0.42)'),
      r: 12,
    });
    // 左侧 4px 品质竖条
    ctx.fillStyle = d.quality || UI_THEME.skyDeep;
    ctx.fillRect(x, y, 4, ch);
    const iconS = Math.min(40, ch - 40);
    const ix = x + 12, iy = y + 12;
    const drawn = d.iconKey ? this._artIcon(d.iconKey.icon, d.iconKey.name, ix + iconS / 2, iy + iconS / 2, iconS * 0.8) : false;
    if (!drawn) {
      this._cardBg({ x: ix, y: iy, w: iconS, h: iconS, r: 8 },
        { tint: 'rgba(43,74,111,0.06)', flat: true });
      if (d.icon) {
        ctx.fillStyle = locked ? UI_THEME.navySoft : UI_THEME.navy;
        ctx.font = `${Math.round(iconS * 0.42)}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(d.icon, ix + iconS / 2, iy + iconS / 2);
        ctx.textAlign = 'left';
        ctx.textBaseline = 'alphabetic';
      }
    }
    const tx = x + 60;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = locked ? UI_THEME.navySoft : UI_THEME.ink;
    ctx.font = 'bold 12px sans-serif';
    this._fitText(String(d.name || ''), tx, y + 22, Math.max(20, cw - 130), 12);
    // 右上 Lv / MAX 角标
    const badgeW = 30, badgeH = 16;
    const bgx = x + cw - badgeW - 8, bgy = y + 8;
    ctx.fillStyle = max ? 'rgba(74,222,128,0.22)' : 'rgba(43,74,111,0.10)';
    if (typeof ctx.arcTo === 'function') {
      ctx.save();
      this._roundRectPath(bgx, bgy, badgeW, badgeH, 6);
      ctx.fill();
      ctx.restore();
    } else {
      ctx.fillRect(bgx, bgy, badgeW, badgeH);
    }
    ctx.fillStyle = max ? '#15803D' : UI_THEME.navy;
    ctx.font = 'bold 9px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(max ? 'MAX' : `Lv${d.level || 1}`, bgx + badgeW / 2, bgy + badgeH / 2 + 1);
    ctx.textAlign = 'left';
    // 底部花费条
    const barW = cw - 24, barH = 22, barX = x + 12, barY = y + ch - barH - 10;
    if (locked) {
      this._cardBg({ x: barX, y: barY, w: barW, h: barH, r: 7 },
        { tint: 'rgba(43,74,111,0.12)', flat: true });
      ctx.fillStyle = UI_THEME.navySoft;
      ctx.font = '10px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('前置未解锁', barX + barW / 2, barY + barH / 2 + 1);
    } else if (max) {
      this._cardBg({ x: barX, y: barY, w: barW, h: barH, r: 7 },
        { tint: 'rgba(74,222,128,0.16)', flat: true });
      ctx.fillStyle = '#15803D';
      ctx.font = '10px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('已满级', barX + barW / 2, barY + barH / 2 + 1);
    } else {
      this._cardBg({ x: barX, y: barY, w: barW, h: barH, r: 7 },
        { tint: UI_THEME.gold, flat: true });
      ctx.fillStyle = '#4A2A00';
      ctx.font = 'bold 10px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(String(d.cost || ''), barX + barW / 2, barY + barH / 2 + 1);
    }
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
  }

  /**
   * 通行证奖励格（方案 M2）：四态（locked/claimable/claimed/premiumLock），
   * 可领态顶部 3px 明黄亮条，已领压暗显示「已领取」，高级锁走暗底 + 小锁文案。
   * @param {{x,y,w,h}} rect
   * @param {{label:string,state?:string}} d
   */
  _rewardCell(rect, d) {
    const { ctx } = this;
    d = d || {};
    const x = rect.x, y = rect.y, cw = rect.w, ch = rect.h;
    const state = d.state || 'locked';
    const premium = state === 'premiumLock';
    const claimed = state === 'claimed';
    const claimable = state === 'claimable';
    this._cardBg(rect, {
      tint: premium ? 'rgba(226,238,247,0.9)' : (claimable ? 'rgba(255,255,255,0.97)' : 'rgba(234,248,255,0.80)'),
      border: claimable ? 'rgba(255,210,63,0.55)' : (premium ? 'rgba(43,74,111,0.1)' : 'rgba(43,74,111,0.14)'),
      flat: true,
      r: 8,
    });
    if (claimable) {
      ctx.fillStyle = UI_THEME.gold;
      ctx.fillRect(x, y, cw, 3);
    }
    // premium 态：加明黄小锁图标 + 深色文字，替代原来整列发虚的浅灰块（文案不变）
    if (premium && typeof ctx.arc === 'function') {
      ctx.save();
      ctx.beginPath();
      ctx.arc(x + 16, y + ch / 2, 8, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,210,63,0.85)';
      ctx.fill();
      ctx.restore();
      ctx.fillStyle = '#4A2A00';
      ctx.font = 'bold 9px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('锁', x + 16, y + ch / 2 + 1);
    }
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = premium ? UI_THEME.navySoft : (claimed ? UI_THEME.navySoft : (claimable ? UI_THEME.ink : UI_THEME.navy));
    ctx.font = `${claimable ? 'bold ' : ''}10px sans-serif`;
    const text = premium ? '需高级' : (claimed ? '已领取' : (claimable ? `${d.label || ''} · 领` : String(d.label || '')));
    this._fitText(text, x + cw / 2 + (premium ? 6 : 0), y + ch / 2, cw - (premium ? 18 : 6), 10, 'center');
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
  }

  /**
   * 排行榜行（方案 M2）：名次槽 + 头像位 + 名称/副文 + 数值，前三名升格高亮。
   * @param {{x,y,w,h}} rect
   * @param {{rank:number,name:string,sub?:string,value:string,self?:boolean}} d
   */
  _rankRow(rect, d) {
    const { ctx } = this;
    d = d || {};
    const x = rect.x, y = rect.y, cw = rect.w, ch = rect.h;
    const rank = Math.max(1, Number(d.rank) || 1);
    const self = !!d.self;
    const top3 = rank <= 3;
    this._cardBg(rect, {
      tint: self ? 'rgba(255,210,63,0.14)' : 'rgba(255,255,255,0.92)',
      border: self ? 'rgba(255,210,63,0.45)' : 'rgba(43,74,111,0.10)',
      edge: self ? UI_THEME.gold : null,
      edgeSide: 'left',
      flat: true,
      r: 10,
    });
    // 名次槽 32：前三金银铜圆角底，4 名后纯数字
    const rankX = x + 8, rankW = 32, rankY = y + (ch - 26) / 2;
    if (top3) {
      const medal = ['#FFD23F', '#C7D2E0', '#E8A838'][rank - 1];
      ctx.fillStyle = medal;
      if (typeof ctx.arcTo === 'function') {
        ctx.save();
        this._roundRectPath(rankX, rankY, rankW, 26, 8);
        ctx.fill();
        ctx.restore();
      } else {
        ctx.fillRect(rankX, rankY, rankW, 26);
      }
      ctx.fillStyle = '#4A2A00';
    } else {
      ctx.fillStyle = UI_THEME.navy;
    }
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = 'bold 13px sans-serif';
    ctx.fillText(String(rank), rankX + rankW / 2, rankY + 13);
    // 头像位 36
    const avS = Math.min(36, ch - 12);
    const avX = x + 48, avY = y + (ch - avS) / 2;
    ctx.fillStyle = 'rgba(43,74,111,0.08)';
    if (typeof ctx.arcTo === 'function') {
      ctx.save();
      this._roundRectPath(avX, avY, avS, avS, 8);
      ctx.fill();
      ctx.restore();
    } else {
      ctx.fillRect(avX, avY, avS, avS);
    }
    const tx = avX + avS + 8;
    ctx.textAlign = 'left';
    ctx.fillStyle = UI_THEME.ink;
    ctx.font = 'bold 12px sans-serif';
    this._fitText(self ? '我' : String(d.name || ''), tx, y + ch / 2 - 7, Math.max(20, cw - (tx - x) - 90), 12);
    if (d.sub) {
      ctx.fillStyle = UI_THEME.navySoft;
      ctx.font = '9px sans-serif';
      this._fitText(String(d.sub), tx, y + ch / 2 + 9, Math.max(20, cw - (tx - x) - 90), 9);
    }
    ctx.textAlign = 'right';
    ctx.fillStyle = UI_THEME.goldDeep;
    ctx.font = 'bold 12px sans-serif';
    ctx.fillText(String(d.value || ''), x + cw - 12, y + ch / 2);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
  }

  /**
   * 顶部数据条（方案 M2）：赛季名/标题 + 等级胶囊 + EXP 进度条，通行证与招募图鉴共用。
   * @param {{x,y,w,h}} rect
   * @param {{title:string,level?:string,ratio?:number,ratioText?:string,color?:string,onDark?:boolean}} d
   */
  _statStrip(rect, d) {
    const { ctx } = this;
    d = d || {};
    const x = rect.x, y = rect.y, cw = rect.w, ch = rect.h;
    this._cardBg(rect, { tint: 'rgba(255,255,255,0.94)', border: 'rgba(255,210,63,0.30)', r: 12 });
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = UI_THEME.ink;
    ctx.font = 'bold 14px sans-serif';
    this._fitText(String(d.title || ''), x + 16, y + ch / 2 - 8, cw - 120, 14);
    if (d.level) {
      const lx = x + cw - 76;
      ctx.fillStyle = UI_THEME.gold;
      if (typeof ctx.arcTo === 'function') {
        ctx.save();
        this._roundRectPath(lx, y + 10, 60, 22, 8);
        ctx.fill();
        ctx.restore();
      } else {
        ctx.fillRect(lx, y + 10, 60, 22);
      }
      ctx.fillStyle = '#4A2A00';
      ctx.font = 'bold 11px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(String(d.level), lx + 30, y + 21);
      ctx.textAlign = 'left';
    }
    this._progressBar({ x: x + 16, y: y + ch - 22, w: cw - 32, h: 10 }, d.ratio || 0,
      { color: d.color || UI_THEME.skyDeep });
    if (d.ratioText) {
      ctx.fillStyle = UI_THEME.navySoft;
      ctx.font = '9px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(String(d.ratioText), x + cw / 2, y + ch - 17);
      ctx.textAlign = 'left';
    }
    ctx.textBaseline = 'alphabetic';
  }

  /**
   * 文本按可用宽自动缩放字号，超出则截断（部件页「行内文字不溢出」硬规则的落地）。
   * 只画文字，返回实际使用字号；measureText 不可用时按字宽估算。
   */
  _fitText(text, x, y, maxW, size, align) {
    const { ctx } = this;
    if (!text) return size;
    let fs = size;
    const measure = (t) => {
      if (typeof ctx.measureText === 'function') {
        ctx.save(); ctx.font = `${fs}px sans-serif`;
        const mw = ctx.measureText(t); ctx.restore();
        return mw && mw.width ? mw.width : String(t).length * fs;
      }
      return String(t).length * fs * 0.9;
    };
    while (fs > 8 && measure(text) > maxW) fs -= 1;
    ctx.save();
    ctx.font = `bold ${fs}px sans-serif`;
    ctx.textAlign = align || 'left';
    ctx.textBaseline = 'middle';
    // 仍超宽则逐字截断加省略号
    let out = String(text);
    if (measure(out) > maxW && typeof ctx.measureText === 'function') {
      while (out.length > 1 && measure(out + '…') > maxW) out = out.slice(0, -1);
      out += '…';
    }
    ctx.fillText(out, x, y);
    ctx.restore();
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    return fs;
  }

  /**
   * 空态提示：居中图标 + 主文案 + 可选副文案（列表为空 / 未解锁 / 无数据）。
   * @param {number} cx @param {number} cy 图标中心
   * @param {string} text 主文案
   * @param {{icon?:string, hint?:string}} [opts]
   */
  _emptyState(cx, cy, text, opts) {
    const { ctx } = this;
    const o = opts || {};
    const onLight = !!o.onLight;
    // card:true 时先垫一张云白卡，避免空态裸文字浮在夜景上显得悬空（非交互，不碰命中）
    if (o.card) {
      const ew = Math.min(280, this.screenWidth - 48), eh = 116;
      this._cardBg({ x: cx - ew / 2, y: cy - 46, w: ew, h: eh, r: 14 }, {
        r: 14, tint: 'rgba(255,255,255,0.9)', border: 'rgba(43,74,111,0.16)',
      });
    }
    const iconDrawn = o.iconPrefix && o.iconName
      ? this._artIcon(o.iconPrefix, o.iconName, cx, cy - 4, 30, 0.9)
      : false;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    if (!iconDrawn) {
      ctx.fillStyle = onLight ? 'rgba(43,74,111,0.26)' : (o.card ? UI_THEME.skyDeep : 'rgba(234,248,255,0.24)');
      ctx.font = 'bold 34px sans-serif';
      ctx.fillText(o.icon || '▤', cx, cy);
    }
    ctx.fillStyle = onLight ? 'rgba(22,48,79,0.58)' : (o.card ? UI_THEME.ink : ON_DARK.body);
    ctx.font = 'bold 12px sans-serif';
    ctx.fillText(text, cx, cy + 34);
    if (o.hint) {
      ctx.fillStyle = onLight ? 'rgba(22,48,79,0.40)' : (o.card ? UI_THEME.navySoft : ON_DARK.hint);
      ctx.font = '10px sans-serif';
      ctx.fillText(o.hint, cx, cy + 52);
    }
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
  }

  // ===================== 美术资源层接入 =====================
  // 铁律：只负责「画」，不改任何 Layout 几何 / 点击命中；
  //       图片未加载、加载失败、环境不支持时一律返回 false，调用方继续程序化绘制。

  /** 画一张贴图，返回是否真的用图片绘制了 */
  _art(key, x, y, w, h, opts) {
    if (!this._artEnabled) return false;
    // 水印占位图总闸：artEffectDecor 未显式开启时，拦截带水印的占位图前缀，
    // 让调用方的程序化兜底绘制接管（六边形/建筑汉字/粒子/云白卡等本就完整）。
    // 正式素材同名覆盖后设 artEffectDecor=true 即恢复，几何/命中全程不变。
    if (this._artEffectDecor !== true && isWatermarkArtKey(key)) return false;
    return ArtSystem.draw(this.ctx, key, x, y, w, h, opts);
  }

  /** 当前界面应使用的背景 key */
  _screenBgKey() {
    return SCREEN_BG[this._curScreen] || SCREEN_BG.playing;
  }

  /** 界面清屏后叠加占位底图（cover 等比裁切，正式素材可设 alpha=1） */
  _drawBackdrop(w, h, alpha) {
    const a = alpha === undefined ? ArtSystem.alpha : alpha;
    const ok = this._art(this._screenBgKey(), 0, 0, w, h, { fit: 'cover', alpha: a });

    // === 氛围叠层：bg/* 与 tiles/* 共 16 张按「界面 + 本局布局」选择 ===
    // 全部为低不透明度叠加，不删改任何既有绘制；未启用 / 图片失败静默跳过。
    if (!this._artEnabled || this._artLayerEnabled === false) return ok;
    const scale = typeof this._artLayerAlpha === 'number' ? this._artLayerAlpha : 1;
    if (scale <= 0) return ok;

    // 1) 界面专属氛围底图（lobby_fg / gacha_circle / bp_banner / match_panel / panel_bg）
    const sceneBg = BG_BY_SCREEN[this._curScreen];
    if (sceneBg && ART_INDEX[sceneBg]) {
      this._art(sceneBg, 0, 0, w, h, { fit: 'cover', alpha: 0.12 * scale });
    }

    // 2) 战斗态：按本局 layoutId 选 5 套地图色调（bg + tiles 各一张）+ 领土边界纹理
    if (this._curScreen === 'playing') {
      const tone = BATTLE_TONE_BY_LAYOUT[this._layoutId];
      if (tone) {
        if (ART_INDEX[tone[0]]) this._art(tone[0], 0, 0, w, h, { fit: 'cover', alpha: 0.10 * scale });
        if (ART_INDEX[tone[1]]) this._art(tone[1], 0, 0, w, h, { fit: 'cover', alpha: 0.08 * scale });
      }
      if (ART_INDEX[TERRITORY_EDGE]) {
        this._art(TERRITORY_EDGE, 0, h * 0.24, w, 48, { alpha: 0.10 * scale });
      }
    }
    return ok;
  }

  /** 六边形裁剪内贴图：方形素材被裁成六边形，不破坏 TL-01 轮廓 */
  _artHex(key, x, y, alpha) {
    const { ctx } = this;
    if (!this._artEnabled || !ArtSystem.available) return false;
    // 正式立体石砖（如 hex_bright）：自带六边形轮廓 + 厚度侧面，不能再裁剪。
    // 等比缩放贴入格子（solidBoardPlacement），保持顶面横扁比例不形变。
    if (SOLID_BOARD_KEYS.has(key)) {
      const p = solidBoardPlacement(x, y);
      return this._art(key, p.ox, p.oy, p.drawW, p.drawH,
        { alpha: alpha === undefined ? 0.92 : alpha });
    }
    ctx.save();
    this.drawHexShape(x, y, HEX_SIZE);
    ctx.clip();
    const ok = this._art(key, x - HEX_SIZE, y - HEX_SIZE, HEX_SIZE * 2, HEX_SIZE * 2,
      { alpha: alpha === undefined ? 0.8 : alpha });
    ctx.restore();
    return ok;
  }

  /** 建筑贴图：按 type/level 精确构造 key，不做模糊匹配 */
  _artBuilding(type, level, isEnemy, x, y, size) {
    let key;
    if (type === 'barracks') key = ART_PREFIXES.barracks + String(Math.max(1, Math.min(4, level || 1)));
    else if (type === 'arrow_tower') key = ART_HOOKS.tower;
    else if (type === 'gold_mine') key = ART_HOOKS.mine;
    else if (type === 'headquarters') key = isEnemy ? ART_HOOKS.hqEnemy : ART_HOOKS.hqAlly;
    else return false;
    if (!ART_INDEX[key]) return false;
    return this._art(key, x - size / 2, y - size / 2, size, size, { alpha: 0.92 });
  }

  /** 兵种贴图：序号精确构造 unit_01..40 / unit_small_01..40 */
  _artUnit(n, x, y, w, h, small) {
    if (!n || n < 1 || n > 40) return false;
    const key = (small ? ART_PREFIXES.unitSmall : ART_PREFIXES.unit) + String(n).padStart(2, '0');
    if (!ART_INDEX[key]) return false;
    return this._art(key, x, y, w, h, { alpha: 0.92 });
  }

  // ===================== 全量静态元素贴图通道 =====================
  // 全部为「叠加」语义：只负责在既有程序化图形之上叠一层素材，不删改任何
  // fillRect / fillText / Layout 几何；Node 测试环境 _art() 恒 false，零影响。
  // 正式素材同名覆盖后，把 config/game.json 的 artAlpha 设为 1 即可完全替代。
  // 本组方法把 34 个 ART_HOOKS 与 21 个 ART_PREFIXES 全部登记为可达通道。

  /** 图标族取图：prefix + name；key 不存在时静默跳过（不产生 missing 统计） */
  _artIcon(prefix, name, x, y, size, alpha) {
    if (!prefix || !name) return false;
    const key = prefix + name;
    if (!ART_INDEX[key]) return false;
    return this._art(key, x - size / 2, y - size / 2, size, size,
      { alpha: alpha === undefined ? 0.55 : alpha });
  }

  /** 按钮 4 态（normal / pressed / disabled / selected）；叠加在按钮底色之上 */
  _artButton(x, y, w, h, state) {
    const map = {
      normal: ART_HOOKS.btnNormal,
      pressed: ART_HOOKS.btnPressed,
      disabled: ART_HOOKS.btnDisabled,
      selected: ART_HOOKS.btnSelected,
    };
    return this._art(map[state] || map.normal, x, y, w, h, { alpha: 0.5 });
  }

  /** 面板 / 卡片 / 空卡 / 空槽 / 拖拽槽 */
  _artPanel(x, y, w, h, kind) {
    const map = {
      panel: ART_HOOKS.panel,
      card: ART_HOOKS.card,
      cardEmpty: ART_HOOKS.cardEmpty,
      slotEmpty: ART_HOOKS.slotEmpty,
      slotDrag: ART_HOOKS.slotDrag,
    };
    return this._art(map[kind] || map.panel, x, y, w, h, { alpha: 0.4 });
  }

  /** 进度条：底轨 + 填充两层叠加 */
  _artBar(x, y, w, h, ratio) {
    const a = this._art(ART_HOOKS.barTrack, x, y, w, h, { alpha: 0.45 });
    const fw = w * Math.min(1, Math.max(0, ratio));
    const b = fw > 0 ? this._art(ART_HOOKS.barFill, x, y, fw, h, { alpha: 0.45 }) : false;
    return a || b;
  }

  /** Toast 3 类（info / success / warn） */
  _artToast(x, y, w, h, kind) {
    const map = {
      info: ART_HOOKS.toastInfo,
      success: ART_HOOKS.toastSuccess,
      warn: ART_HOOKS.toastWarn,
    };
    return this._art(map[kind] || map.warn, x, y, w, h, { alpha: 0.5 });
  }

  /** 段位 / 奖章 / 品质标：圆形区域内贴图 */
  _artBadge(prefix, name, cx, cy, r) {
    if (!prefix || !name) return false;
    const key = prefix + name;
    if (!ART_INDEX[key]) return false;
    return this._art(key, cx - r, cy - r, r * 2, r * 2, { alpha: 0.6 });
  }

  /**
   * 杂项 / 特效贴图：集中登记剩余 ART_HOOKS，保证 34 个钩子全部可达。
   * name ∈ hexEmpty / river / ruin / medalGold / settingNotify /
   *        achieveStamp / firework / tutorialHalo / hudBottom / backPressed
   */
  _artFx(name, x, y, w, h, alpha) {
    const FX_KEYS = {
      hexEmpty: ART_HOOKS.hexEmpty,
      river: ART_HOOKS.river,
      ruin: ART_HOOKS.ruin,
      medalGold: ART_HOOKS.medalGold,
      settingNotify: ART_HOOKS.settingNotify,
      achieveStamp: ART_HOOKS.achieveStamp,
      firework: ART_HOOKS.firework,
      tutorialHalo: ART_HOOKS.tutorialHalo,
      hudBottom: ART_HOOKS.hudBottom,
      backPressed: ART_HOOKS.backPressed,
    };
    const key = FX_KEYS[name];
    if (!key || !ART_INDEX[key]) return false;
    return this._art(key, x, y, w, h, { alpha: alpha === undefined ? 0.45 : alpha });
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
    // 记录当前界面 / 战斗结果，供美术资源层选择底图
    this._curScreen = (gameState && gameState.screenState) || 'playing';
    this._curGameStatus = (gameState && gameState.gameStatus) || 'playing';
    // 本局棋盘布局 id（供 bg/battle_tone_* 与 tiles/territory_tone_* 5 套色调选图）
    this._layoutId = (gameState && gameState.layoutId) || 'plains';
    // 返回按钮按下态：与 UI-08/09 两态贴图配套，几何与 BACK_BTN 同源（不改命中）
    const _bp = (gameState && gameState.press) || null;
    const _bpy = this.screenHeight - BACK_BTN.bottom - BACK_BTN.h;
    this._backPressed = !!(_bp &&
      _bp.x >= BACK_BTN.x && _bp.x <= BACK_BTN.x + BACK_BTN.w &&
      _bp.y >= _bpy && _bp.y <= _bpy + BACK_BTN.h &&
      Date.now() - (_bp.t || 0) < 250);

    // 安全区包裹：translate(0, top) + scale(1, scaleY)
    ctx.save();
    if (top > 0 || scaleY !== 1) {
      if (top > 0) ctx.translate(0, top);
      if (scaleY !== 1) ctx.scale(1, scaleY);
    }
    this._renderScreenInner(gameState, inputSystem, dt);

    // 美术装饰层：把上一轮审查判定「有素材但零引用」的占位图按界面语义叠加。
    // 放在场景绘制之后、模态覆盖层之前 —— 只画不改几何，模态窗口仍盖在最上。
    // 由 Game.start() 从 features.artExtendedLayer 注入开关；图片失败静默兜底。
    // 已接入晴空乐园骨架的界面不再叠加占位装饰层：装饰层是深色面板/卡片占位图，
    // 压在云白卡上会显出水印与脏底；正式素材到位后若需要氛围层再单独按界面开。
    // 结算态：drawGameOver 已画在战斗画面之上，ArtLayer 的占位背景会盖住结算内容，
    // 故结算期间跳过装饰层；战斗进行中仍保留氛围层。
    const isGameOver = gameState.screenState === 'playing' && gameState.gameStatus !== 'playing';
    if (!SHELL_SCREENS.has(gameState.screenState) && !isGameOver) drawArtLayer(this, gameState);

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
    this._drawBackdrop(this.screenWidth, this.screenHeight);

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

    // 顶栏底色 + 底部分隔线：深底上用压暗条，浅色条会变成一道亮带把画面切开
    ctx.fillStyle = 'rgba(6,14,28,0.55)';
    ctx.fillRect(0, 0, w, 50);
    ctx.fillStyle = 'rgba(234,248,255,0.14)';
    ctx.fillRect(0, 50, w, 1);

    // 左上角货币簇（2×2）—— 自适应宽度（详见 Layout.resourceBarLayout）
    const tier = gameState.ladderTier;
    const cells = [
      { icon: '◆', value: profile ? profile.gold : 0, color: UI_THEME.goldDeep },
      { icon: '✧', value: profile ? profile.diamond : 0, color: UI_THEME.skyDeep },
      { icon: '⭐', value: profile ? profile.stardust : 0, color: UI_THEME.navySoft },
      { icon: '★', value: profile ? (profile.trophies || 0) : 0, color: tier ? tier.color : UI_THEME.goldDeep },
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
    // 货币簇用云白厚底：与内容卡同一套语言，深底上也能一眼读出数值
    this._cardBg(
      { x: clusterX, y: clusterY, w: clusterW, h: clusterH, r: 9 },
      { tint: 'rgba(255,255,255,0.93)', border: 'rgba(234,248,255,0.30)' }
    );

    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    for (let i = 0; i < cells.length; i++) {
      const cx = clusterX + pad + (i % 2) * cellW;
      const cy = clusterY + pad + Math.floor(i / 2) * cellH + cellH / 2;
      ctx.font = '11px sans-serif';
      ctx.fillStyle = UI_THEME.navy;
      // 贴图优先：IC-01 货币图标 4 张（132×132 @3x → 44×44 逻辑）
      const _currencyKeys = [ART_PREFIXES.currency + 'coin', ART_PREFIXES.currency + 'gem',
        ART_PREFIXES.currency + 'stardust', ART_PREFIXES.currency + 'trophy'];
      if (!this._art(_currencyKeys[i], cx - 1, cy - 7, 14, 14, { alpha: 0.95 })) {
        ctx.fillText(cells[i].icon, cx, cy);
      }
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
    this._artHex(ART_HOOKS.mountain, x, y);
    // 障碍氛围：按格坐标稳定分配河流 / 废墟贴图（此前只登记未实贴）
    const _terr = Math.abs((tile.q || 0) * 3 + (tile.r || 0)) % 3;
    if (_terr === 1) this._artFx('river', x - 20, y - 20, 40, 40, 0.22);
    else if (_terr === 2) this._artFx('ruin', x - 20, y - 20, 40, 40, 0.22);

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
    this._artHex(ART_HOOKS.hexDark, x, y);
    // 空格底纹（hexEmpty hook，此前只登记未实贴）
    this._artFx('hexEmpty', x - 18, y - 18, 36, 36, 0.16);

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
    this._artHex(ART_HOOKS.hexFlippable, x, y);

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
        // 贴图优先：BL-01/02 建筑图标（312×312 @3x → 104×104 逻辑）
        if (!this._artBuilding(preset.type, preset.level, false, x, y - 6, 34)) {
          ctx.fillText(icon, x, y - 6);
        }

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
    this._artHex(ART_HOOKS.hexBright, x, y);

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
      // 2026-11 玩法改造：格子放大后建筑图标同步放大 15→24
      ctx.font = 'bold 24px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      // 贴图优先：BL-01/02 建筑图标
      if (!this._artBuilding(building.type, building.level, false, x, y - 5, 40)) {
        ctx.fillText(icon, x, y - 5);
      }

      // 兵营/金矿显示等级
      if (building.type === 'barracks' || building.type === 'gold_mine') {
        ctx.fillStyle = '#fff';
        ctx.font = '13px sans-serif';
        ctx.fillText('Lv' + building.level, x, y + 12);
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

    // 翻格过渡帧：正面亮格 / 背面可翻格贴图，跟随同一 scaleY 变换
    // 正式立体石砖需按主体占比放大（同 _artHex），否则翻格瞬间石砖缩水。
    const flipKey = showFront ? 'tiles/hex_bright' : 'tiles/hex_flippable';
    if (SOLID_BOARD_KEYS.has(flipKey)) {
      const p = solidBoardPlacement(0, 0);
      this._art(flipKey, p.ox, p.oy, p.drawW, p.drawH, { alpha: 0.22 });
    } else {
      this._art(flipKey, -HEX_SIZE, -HEX_SIZE, HEX_SIZE * 2, HEX_SIZE * 2, { alpha: 0.22 });
    }

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
      // 2026-11 玩法改造：格子 32→52，兵种圆盘同步放大（直径≤42px < 格心距 78px，多队堆叠不重叠）
      const baseRadius = 10 + Math.min(8, group.warriors / 4) + (quality - 1) * 0.6;

      // === 远程兵种：外圈虚线环 ===
      if (isRanged) {
        ctx.strokeStyle = isMagic ? 'rgba(192, 132, 252, 0.6)' : 'rgba(96, 165, 250, 0.6)';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([3, 2]);
        ctx.beginPath();
        ctx.arc(x, y, baseRadius + 7, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      // === 法术兵种：紫色光晕 ===
      if (isMagic) {
        const gradient = ctx.createRadialGradient(x, y, baseRadius, x, y, baseRadius + 10);
        gradient.addColorStop(0, 'rgba(168, 85, 247, 0.25)');
        gradient.addColorStop(1, 'rgba(168, 85, 247, 0)');
        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.arc(x, y, baseRadius + 10, 0, Math.PI * 2);
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

      // === 兵种小头像 / 行走序列帧 / 品质光晕（占位素材真实贴图） ===
      const _uid = group._unitId || 1;
      const _smallKey = pick_unitSmall(typeof _uid === 'number' ? _uid : 1);
      this._art(_smallKey, x - baseRadius, y - baseRadius - 22,
        baseRadius * 2, baseRadius * 2, { alpha: 0.30 });
      // 序列帧播放：行军时 start/loop 按时间轮播，交战时切 attack 帧
      const _fighting = group.state === 'fighting_warrior' || group.state === 'fighting_building';
      const _walkState = _fighting ? 'attack'
        : (Math.floor((Date.now() + (group.owner || 0) * 60) / 140) % 2 === 0 ? 'start' : 'loop');
      this._art(pick_walkFrame(_walkState), x - 14, y - 14, 28, 28, { alpha: 0.18 });
      this._art(pick_qualityGlow(quality), x - baseRadius - 8, y - baseRadius - 8,
        baseRadius * 2 + 16, baseRadius * 2 + 16, { alpha: 0.14 });

      // === 兵种图标（显示在圆点上方） ===
      if (icon) {
        ctx.font = `${Math.floor(baseRadius * 1.5)}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(icon, x, y - baseRadius - 10);
      }

      // === 有效生命值（战士数 × 生命系数，反映兵种耐久差异） ===
      const effectiveHP = Math.round(group.warriors * (group.hpCoeff || 1.0));
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 14px sans-serif';
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
    this._artBar(startX, y, width, height, ratio);
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
    this._artBar(startX, y, width, height, ratio);
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

    // 顶部HUD背景（程序化黑底兜底，始终绘制）
    ctx.fillStyle = 'rgba(0,0,0,0.75)';
    ctx.fillRect(0, 0, this.screenWidth, 55);
    // 贴图装饰：UI-30 HUD 顶栏/底栏/HP 条/羁绊面板均为带水印占位图，
    // 由 artEffectDecor 开关控制；默认关闭时跳过，程序化黑底 + 语义图标已足够。
    // 待这些 .9 图同名替换为正式素材后设 artEffectDecor=true 恢复。
    const _hudDecor = this._artEffectDecor === true;
    if (_hudDecor) {
      this._art(ART_HOOKS.hudTop, 0, 0, this.screenWidth, 55, { alpha: 0.8 });
    }
    this._artIcon(ART_PREFIXES.hud, 'timer', this.screenWidth - 18, 27, 16, 0.6);
    if (_hudDecor) {
      this._artFx('hudBottom', 0, this.screenHeight - 66, this.screenWidth, 66, 0.28);
      this._art(pick_hudHp(), 0, 0, this.screenWidth, 50, { alpha: 0.10 });
      this._art(pick_hudSynergy(), 0, 55, 106, 90, { alpha: 0.10 });
    }
    const _hudIcons = ['setting', 'battle', 'enemy_hq', 'layout', 'synergy'];
    for (let i = 0; i < _hudIcons.length; i++) {
      const k = iconKey('hud', _hudIcons[i]);
      if (k) this._art(k, 8 + i * 26, 30, 22, 22, { alpha: 0.22 });
    }

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

    // 金币(左上)：正式货币图标 + 数值，不再用 emoji
    const goldText = String(Math.floor(player.gold));
    ctx.fillStyle = '#fbbf24';
    ctx.font = 'bold 15px sans-serif';
    ctx.textAlign = 'left';
    if (!this._artIcon(ART_PREFIXES.currency, 'coin', 15, 17, 14, 1)) ctx.fillText('◆', 8, 18);
    ctx.fillText(goldText, 24, 18);

    // 战士数（P36：warriorBuffer 按 rate*dt 累积为浮点，战斗表现统一取整）
    const marchingWarriors = player.getTotalMarchingWarriors(gameState.marchGroups);
    const bufferedWarriors = player.getBufferedWarriors();
    const warText = String(Math.floor(marchingWarriors + bufferedWarriors));
    ctx.fillStyle = '#EAF8FF';
    ctx.font = 'bold 13px sans-serif';
    if (!this._artIcon(ART_PREFIXES.hud, 'battle', 15, 37, 14, 1)) ctx.fillText('⚔', 8, 38);
    ctx.fillText(warText, 24, 38);

    // 敌方信息(右上)
    if (enemies.length > 0) {
      const firstEnemy = enemies[0];
      const eGold = String(Math.floor(firstEnemy.gold));
      ctx.fillStyle = '#FCA5A5';
      ctx.font = 'bold 13px sans-serif';
      ctx.textAlign = 'right';
      const eGoldW = ctx.measureText(eGold).width;
      if (!this._artIcon(ART_PREFIXES.currency, 'coin', this.screenWidth - 66 - eGoldW, 17, 13, 1)) {
        ctx.textAlign = 'left';
        ctx.fillText('◆', this.screenWidth - 78 - eGoldW, 18);
        ctx.textAlign = 'right';
      }
      ctx.fillText(eGold, this.screenWidth - 55, 18);
      const enemyWarriors = firstEnemy.getTotalMarchingWarriors(gameState.marchGroups) + firstEnemy.getBufferedWarriors();
      const eWar = String(Math.floor(enemyWarriors));
      const eWarW = ctx.measureText(eWar).width;
      if (!this._artIcon(ART_PREFIXES.hud, 'battle', this.screenWidth - 66 - eWarW, 37, 13, 1)) {
        ctx.textAlign = 'left';
        ctx.fillText('⚔', this.screenWidth - 78 - eWarW, 38);
        ctx.textAlign = 'right';
      }
      ctx.fillText(eWar, this.screenWidth - 55, 38);
    }

    // 设置按钮(右上角，打开设置窗口；暂停按钮已移除)
    // 命中矩形不变，只把深蓝裸块换成云白圆角底 + 正式设置图标。
    const setRect = { x: this.screenWidth - 95, y: 5, w: 40, h: 35, r: 9 };
    this._cardBg(setRect, {
      tint: 'rgba(234,248,255,0.94)',
      border: 'rgba(43,74,111,0.30)',
    });
    if (!this._artIcon(ART_PREFIXES.hud, 'setting', setRect.x + setRect.w / 2, setRect.y + setRect.h / 2, 20, 1)) {
      ctx.fillStyle = UI_THEME.navy;
      ctx.font = 'bold 15px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('⚙', setRect.x + setRect.w / 2, setRect.y + setRect.h / 2 + 1);
    }

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
    ctx.fillText('点击相邻格子翻转占领 | 拖动平移 | 滚轮缩放 | 右上角设置', this.screenWidth / 2, this.screenHeight - 14);
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

    // 背景 / 标题：接入晴空乐园统一骨架（天蓝→云白 + 底图占位期仅作纹理）
    const leftLimit = RenderSystem.headerLeftLimit(
      [profile?.gold, profile?.diamond, profile?.stardust, profile?.trophies], w);
    this._screenBg();
    this._screenHeader('对战准备', { cy: L.titleY, accent: UI_THEME.orange, leftLimit });

    // 品质色（Q1-Q6: 白/绿/蓝/紫/橙/红）—— 槽位与卡片共用
    const QUALITY_COLORS = ['#9ca3af', '#22c55e', '#3b82f6', '#a855f7', '#f97316', '#ef4444'];
    const qualityColor = (q) => QUALITY_COLORS[(q || 1) - 1] || '#9ca3af';

    // === 兵种槽位 ===
    this._sectionLabel('兵种槽位', 15, L.slot.labelY, { accent: UI_THEME.skyDeep, hint: '点击详情 · 长按拖入' });

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

      // 云白厚底卡：品质只走外缘描边与顶部色条，卡底不再压深色
      const _q = slotData.quality || 1;
      this._cardBg({ x: sx, y: uslot.y, w: uslot.w, h: uslot.h, r: 10 }, {
        // 空槽在深底上压成半透暗块（表示"待填"），实槽才是云白亮面
        tint: slotData.empty ? 'rgba(255,255,255,0.10)' : 'rgba(255,255,255,0.97)',
        border: isDragTarget ? UI_THEME.skyDeep : (slotData.empty ? 'rgba(234,248,255,0.26)' : qColor),
        edge: slotData.empty ? null : qColor,
        edgeSide: 'top',
        flat: slotData.empty,
      });
      if (!slotData.empty) {
        const _uid = Number(slotData.unitId || slotData.id || slotData.unitIndex || 0);
        if (_uid >= 1 && _uid <= 40) {
          this._artUnit(_uid, sx + 3, uslot.y + 4, uslot.w - 6, uslot.h - 8, false);
        }
      }
      // 高品质(紫及以上)槽位内部微光，强化品质感
      if (!slotData.empty && !isDragSource && (slotData.quality || 1) >= 4) {
        ctx.fillStyle = qColor;
        ctx.globalAlpha = 0.08;
        ctx.fillRect(sx, uslot.y, uslot.w, uslot.h);
        ctx.globalAlpha = 1;
      }
      ctx.fillStyle = 'rgba(43,74,111,0.45)';
      ctx.font = '8px sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText('#' + (i + 1), sx + 5, uslot.y + 10);

      if (slotData.empty && !isDragSource) {
        ctx.fillStyle = 'rgba(234,248,255,0.55)';
        ctx.font = '9px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('空槽位', sx + uslot.w / 2, uslot.y + uslot.h / 2);
      } else if (!isDragSource) {
        ctx.fillStyle = qColor;
        ctx.font = 'bold 18px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(slotData.icon || '?', sx + uslot.w / 2, uslot.y + 30);
        ctx.fillStyle = UI_THEME.ink;
        ctx.font = 'bold 8px sans-serif';
        ctx.fillText(slotData.name || '?', sx + uslot.w / 2, uslot.y + 48);
        // 品质名（左）+ 等级（右）—— 品质用名称描述（与抽卡界面一致），不用颜色字
        // 卡宽 < 50 时两端会挤在一起（320 屏约 46）：品质已由描边色表达，此处只留居中等级。
        // 注意 430 屏卡宽被 LAYOUT_DESIGN_MAX 夹到 52，仍属可放下，阈值不能设到 52 以上。
        const qNames = ['普通', '精良', '稀有', '史诗', '传说', '神话'];
        if (uslot.w < 50) {
          ctx.fillStyle = UI_THEME.orangeDeep;
          ctx.font = 'bold 8px sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText('Lv.' + (slotData.level || 1), sx + uslot.w / 2, uslot.y + 62);
        } else {
          ctx.fillStyle = qColor;
          ctx.font = 'bold 8px sans-serif';
          ctx.textAlign = 'left';
          ctx.fillText(qNames[(slotData.quality || 1) - 1] || '普通', sx + 5, uslot.y + 62);
          ctx.fillStyle = UI_THEME.orangeDeep;
          ctx.font = 'bold 8px sans-serif';
          ctx.textAlign = 'right';
          ctx.fillText('Lv.' + (slotData.level || 1), sx + uslot.w - 5, uslot.y + 62);
        }
        // P35：品质改由外框颜色 + 品质名表达，移除 ★ 重复计数
      } else {
        ctx.fillStyle = 'rgba(255,255,255,0.35)';
        ctx.fillRect(sx, uslot.y, uslot.w, uslot.h);
        ctx.fillStyle = 'rgba(43,74,111,0.45)';
        ctx.font = '9px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('(拖拽中)', sx + uslot.w / 2, uslot.y + uslot.h / 2);
      }
    }

    // === 自动羁绊预览面板（4 类风格羁绊，按上阵兵种自动派生，无需手选） ===
    this._sectionLabel('羁绊', 15, L.synergy.labelY, { accent: '#A855F7', hint: '点击详情 · 自动派生' });

    const ap = L.synergy;
    const aStartX = ap.startX; // 与 Game 点击命中同源（autoSynergyCardLayout）
    for (let i = 0; i < ap.count; i++) {
      const sx = aStartX + i * (ap.size + ap.gap);
      const syn = autoSynergies[i];
      const isActive = syn && syn.level > 0;
      const styleKey = syn?.style || ['melee', 'ranged', 'defense', 'magic'][i];
      const styleColor = { melee: '#ef4444', ranged: '#22c55e', defense: '#3b82f6', magic: '#a855f7' }[styleKey] || '#a855f7';
      // 激活态云白亮卡 + style 色外缘；未激活用平面暗块，深底上与背景融为一体
      this._cardBg({ x: sx, y: ap.y, w: ap.size, h: ap.size, r: 10 }, {
        tint: isActive ? 'rgba(255,255,255,0.94)' : 'rgba(255,255,255,0.10)',
        border: isActive ? styleColor : 'rgba(234,248,255,0.22)',
        edge: isActive ? styleColor : null,
        edgeSide: 'top',
        flat: !isActive,
      });
      // P35：未激活也显示真实羁绊图标 + 中文羁绊名（不再回落英文 style key）
      ctx.fillStyle = isActive ? styleColor : 'rgba(234,248,255,0.38)';
      ctx.font = 'bold 22px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(syn?.icon || '?', sx + ap.size / 2, ap.y + 22);
      ctx.fillStyle = isActive ? UI_THEME.ink : 'rgba(234,248,255,0.50)';
      ctx.font = 'bold 9px sans-serif';
      ctx.fillText(syn?.name || '羁绊', sx + ap.size / 2, ap.y + 38);
      // 等级 (Lv.X/6) 或未激活
      ctx.fillStyle = isActive ? UI_THEME.orangeDeep : 'rgba(234,248,255,0.45)';
      ctx.font = 'bold 10px sans-serif';
      ctx.fillText(isActive ? `Lv.${syn.level}/${syn.maxLevel || 6}` : '未激活', sx + ap.size / 2, ap.y + 54);
    }

    // === 建筑强化展示 ===
    this._sectionLabel('建筑强化', 15, L.building.labelY, { accent: UI_THEME.orange, hint: '点击升级' });

    const bldSlotW = L.building.w, bldSlotH = L.building.h, bldGap = L.building.gap;
    const bldStartX = (w - (3 * bldSlotW + 2 * bldGap)) / 2;
    const bldSlotY = L.building.y;
    const buildings = summary?.buildings || {};
    const bldKeys = ['barracks', 'arrow_tower', 'gold_mine'];
    const bldNames = { barracks: '兵营', arrow_tower: '箭塔', gold_mine: '金矿' };
    const bldArtKeys = ['barracks', 'tower', 'mine'];
    const bldFallback = ['▣', '➶', '◆'];
    for (let i = 0; i < 3; i++) {
      const bldType = bldKeys[i];
      const bldData = buildings[bldType] || { level: 1, maxLevel: 1 };
      const sx = bldStartX + i * (bldSlotW + bldGap);
      this._cardBg({ x: sx, y: bldSlotY, w: bldSlotW, h: bldSlotH, r: 10 }, {
        tint: 'rgba(255,255,255,0.92)',
        border: 'rgba(232,114,47,0.55)',
        edge: UI_THEME.orange,
        edgeSide: 'left',
      });
      if (!this._artIcon(ART_PREFIXES.buildingUp, bldArtKeys[i], sx + bldSlotW / 2, bldSlotY + 18, 18, 1)) {
        ctx.fillStyle = UI_THEME.orangeDeep;
        ctx.font = 'bold 16px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(bldFallback[i], sx + bldSlotW / 2, bldSlotY + 18);
      }
      ctx.fillStyle = UI_THEME.ink;
      ctx.font = 'bold 9px sans-serif';
      ctx.fillText(bldNames[bldType] || bldType, sx + bldSlotW / 2, bldSlotY + 34);
      const isMaxLevel = bldData.level >= bldData.maxLevel;
      ctx.fillStyle = isMaxLevel ? UI_THEME.green : UI_THEME.navySoft;
      ctx.font = '8px sans-serif';
      ctx.fillText(`Lv.${bldData.level}/${bldData.maxLevel}`, sx + bldSlotW / 2, bldSlotY + 45);
      // P36: 可点击 hint —— 画在卡内右侧（原在卡下方 +65，与「已拥有兵种」标题重叠）
      if (!isMaxLevel) {
        ctx.fillStyle = UI_THEME.orangeDeep;
        ctx.font = 'bold 11px sans-serif';
        ctx.textAlign = 'right';
        ctx.fillText('▸', sx + bldSlotW - 7, bldSlotY + 45);
        ctx.textAlign = 'center';
      }
    }
    // 旧版"已拥有羁绊列表"已废弃（2026-09-09 改造：羁绊不再手选）
    // 当前等级加成由上方 autoSynergyPanel 卡片直接展示

    // === 「已拥有兵种」标题栏（固定区，不随兵种列表滚动，P22） ===
    const collected = gameState.collectedUnits || [];
    this._sectionLabel(`已拥有兵种 ${collected.length}`, 15, L.unit.labelY, {
      accent: UI_THEME.skyDeep, hint: '长按拖入上阵',
    });

    // === 列表容器底：高度按实际内容自适应（最少一行），内容少时不铺成一大块空白板 ===
    const _listTop = unitListY - 6;
    const _listMaxH = L.scrollAreaBottom - unitListY + 4;
    const _unitRows = Math.ceil(Math.max(1, collected.length) / Math.max(1, L.unit.perRow));
    const _contentH = _unitRows * (L.unit.h + L.unit.gap) - L.unit.gap + 16;
    const _listH = Math.min(_listMaxH, Math.max(_contentH, 128));
    this._cardBg(
      { x: 8, y: _listTop, w: w - 16, h: _listH, r: 14 },
      { tint: 'rgba(6,14,28,0.34)', flat: true }
    );

    // 内容不足可视高度时，空区给招募引导（否则界面上半截有东西、下半截空荡）
    const _guideTop = _listTop + _listH;
    if (L.scrollAreaBottom - _guideTop > 90) {
      const _gy = (_guideTop + L.scrollAreaBottom) / 2 - 10;
      this._emptyState(w / 2, _gy, '兵种还不够多', {
        card: true,
        iconPrefix: ART_PREFIXES.nav, iconName: 'gacha',
        icon: '✦',
        hint: '去「招募」收服更多兵种，壮大你的军团',
      });
    }

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

      const qColor = qualityColor(unit.quality);
      // 品质色走左侧竖条：卡片左上要留给「阵N」上阵角标，顶部色条会与之叠在一起显脏
      this._cardBg({ x: cx, y: cy, w: card.w, h: card.h, r: 10 }, {
        tint: isDragging ? 'rgba(255,255,255,0.35)' : 'rgba(255,255,255,0.97)',
        border: isDeployed ? qColor : 'rgba(43,74,111,0.20)',
        edge: qColor,
        edgeSide: 'left',
      });

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
        ctx.fillStyle = UI_THEME.ink;
        ctx.font = 'bold 9px sans-serif';
        ctx.fillText(unit.name || '?', cx + card.w / 2, cy + 38);
        // 等级 + 攻击范围
        ctx.fillStyle = UI_THEME.orangeDeep;
        ctx.font = 'bold 8px sans-serif';
        ctx.fillText('Lv.' + unit.level, cx + card.w / 2 - 10, cy + 50);
        ctx.fillStyle = unit.attackRange > 1 ? UI_THEME.skyDeep : 'rgba(43,74,111,0.45)';
        ctx.font = '8px sans-serif';
        ctx.fillText('射' + (unit.attackRange || 1), cx + card.w / 2 + 10, cy + 50);
        // 招募进度（如果有 recruitRequired）
        if (unit.recruitRequired > 0 && unit.level < MAX_UNIT_LEVEL) {
          const needed = unit.recruitRequired * unit.level;
          const current = unit.recruitCount || 0;
          const isReady = current >= needed;
          ctx.fillStyle = isReady ? UI_THEME.green : 'rgba(22,48,79,0.58)';
          ctx.font = '8px sans-serif';
          ctx.fillText(`招募 ${current}/${needed}`, cx + card.w / 2, cy + 62);
        } else if (unit.level >= MAX_UNIT_LEVEL) {
          ctx.fillStyle = UI_THEME.green;
          ctx.font = 'bold 8px sans-serif';
          ctx.fillText('MAX', cx + card.w / 2, cy + 62);
        }
        // 上阵标记：「阵N」圆角胶囊（醒目区分是否已上阵，置于左上角）
        if (isDeployed) {
          const slotIdx = deployedUnits.indexOf(unit.id);
          const tagW = 22, tagH = 11;
          const tagX = cx + 5, tagY = cy + 4;
          if (typeof ctx.arcTo === 'function') {
            ctx.save();
            this._roundRectPath(tagX, tagY, tagW, tagH, tagH / 2);
            ctx.fillStyle = UI_THEME.skyDeep;
            ctx.fill();
            ctx.restore();
          } else {
            ctx.fillStyle = UI_THEME.skyDeep;
            ctx.fillRect(tagX, tagY, tagW, tagH);
          }
          ctx.fillStyle = UI_THEME.white;
          ctx.font = 'bold 8px sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText('阵' + (slotIdx + 1), tagX + tagW / 2, tagY + tagH / 2 + 0.5);
          ctx.textBaseline = 'alphabetic';
        }
      }
    }

    ctx.restore(); // 恢复 clip（滚动区仅兵种卡列表）

    // === 底部提示（开战入口在大厅「⚔ 开战」按钮，本界面仅布阵） ===
    this._drawTextPillBg(this.screenWidth / 2, L.tipY1, '点击卡片查看详情  |  长按拖动兵种卡上阵', '9px sans-serif', { padX: 10, padY: 4, border: 'rgba(43,74,111,0.22)' });
    ctx.fillStyle = UI_THEME.navy;
    ctx.font = '9px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('点击卡片查看详情  |  长按拖动兵种卡上阵', this.screenWidth / 2, L.tipY1);
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = ON_DARK.body;
    ctx.fillText('布阵完成后回大厅点「⚔ 开战」出战', this.screenWidth / 2, L.tipY2);

    // === 拖拽视觉反馈（仅兵种） ===
    if (drag.active && drag.type === 'unit') {
      const deployables = ConfigLoader.getSafe('deployables');
      const cfg = deployables?.units?.[drag.id];
      if (cfg) {
        ctx.globalAlpha = 0.92;
        this._cardBg({ x: drag.x - 32, y: drag.y - 37, w: 64, h: 74, r: 10 }, {
          tint: 'rgba(255,255,255,0.96)',
          border: qualityColor(cfg.quality),
          edge: qualityColor(cfg.quality),
          edgeSide: 'top',
        });
        ctx.fillStyle = qualityColor(cfg.quality);
        ctx.font = 'bold 20px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(cfg.icon || '?', drag.x, drag.y - 15);
        ctx.fillStyle = UI_THEME.ink;
        ctx.font = 'bold 9px sans-serif';
        ctx.fillText(cfg.name || '?', drag.x, drag.y + 5);
        ctx.fillStyle = UI_THEME.orangeDeep;
        ctx.font = '8px sans-serif';
        const collectedUnit = profile?.collectedUnits?.[drag.id];
        ctx.fillText('Lv.' + (collectedUnit?.level || 1), drag.x, drag.y + 20);
        ctx.globalAlpha = 1;
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

    // 云白面板 + 紫色强调条（招募题材色，几何不变）
    this._cardBg({ x: panelX, y: panelY, w: panelW, h: panelH }, {
      r: 18, tint: 'rgba(255,255,255,0.98)', border: 'rgba(43,74,111,0.28)',
      edge: '#A855F7', edgeSide: 'left',
    });

    // 标题（深色文字 + 正式图标）
    this._artIcon(ART_PREFIXES.nav, 'gacha', panelX + 36, panelY + 20, 18, 0.95);
    ctx.fillStyle = UI_THEME.ink;
    ctx.font = 'bold 16px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('招募兵种', panelX + panelW / 2, panelY + 20);

    // 货币显示（深色文字）
    ctx.fillStyle = UI_THEME.navySoft;
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(`◆ ${profile?.gold || 0}   ✦ ${profile?.stardust || 0}`, panelX + 10, panelY + 38);

    // 关闭按钮（几何不变）
    const closeX = panelX + panelW - 35;
    const closeY = panelY + 5;
    this._cardBg({ x: closeX, y: closeY, w: 30, h: 30, r: 15 }, {
      r: 15, tint: 'rgba(214,238,251,0.95)', border: 'rgba(43,74,111,0.3)', flat: true,
    });
    ctx.fillStyle = UI_THEME.navy;
    ctx.font = 'bold 16px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('×', closeX + 15, closeY + 15);

    // 兵种卡片列表
    const cardW = 140, cardH = 85, cardGap = 8;
    const cols = Math.floor((panelW - 20) / (cardW + cardGap));
    const listStartY = panelY + 50;
    const styleNames = { melee: '近战', ranged: '远程', defense: '防御', magic: '法术' };

    if (recruitable.length === 0) {
      ctx.fillStyle = UI_THEME.navySoft;
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

      // 卡片背景（云白卡，可招募=明黄描边，资源不足=弱面，几何不变）
      this._cardBg({ x: cx, y: cy, w: cardW, h: cardH, r: 10 }, {
        r: 10,
        tint: unit.affordable ? 'rgba(255,255,255,0.98)' : 'rgba(226,238,247,0.85)',
        border: unit.affordable ? UI_THEME.goldDeep : 'rgba(43,74,111,0.2)',
      });

      // 图标
      ctx.fillStyle = unit.affordable ? UI_THEME.skyDeep : UI_THEME.navySoft;
      ctx.font = 'bold 22px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(unit.icon || '?', cx + 25, cy + 25);

      // 名称
      ctx.fillStyle = unit.affordable ? UI_THEME.ink : UI_THEME.navySoft;
      ctx.font = 'bold 11px sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(unit.name || '?', cx + 48, cy + 18);

      // 战斗风格
      ctx.fillStyle = UI_THEME.navySoft;
      ctx.font = '9px sans-serif';
      const styles = (unit.combatStyles || []).map(s => styleNames[s] || s).join('/');
      ctx.fillText(styles, cx + 48, cy + 32);

      // 特殊能力
      if (unit.special) {
        ctx.fillStyle = UI_THEME.navySoft;
        ctx.font = '8px sans-serif';
        ctx.fillText('特: ' + (unit.special.desc || unit.special.type || '未知'), cx + 48, cy + 45);
      }

      // 费用
      ctx.fillStyle = unit.affordable ? UI_THEME.orangeDeep : '#C0392B';
      ctx.font = 'bold 10px sans-serif';
      ctx.textAlign = 'left';
      const costText = `✦ ${unit.cost.starDust}  ◆ ${unit.cost.gold}`;
      ctx.fillText(costText, cx + 8, cy + 68);

      // 招募提示
      ctx.fillStyle = unit.affordable ? UI_THEME.green : '#C0392B';
      ctx.font = '9px sans-serif';
      ctx.textAlign = 'right';
      ctx.fillText(unit.affordable ? '点击招募' : '资源不足', cx + cardW - 8, cy + 68);
      ctx.textBaseline = 'alphabetic';
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
    // 卡片改成云白厚底后投影更明显，标题与首行卡之间留 12px 呼吸位
    const unitListY = unitLabelY + 12;

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
        // 3 张建筑卡按屏宽自适应：320 窄屏下固定 105 会溢出右边界
        w: Math.min(105, Math.floor((w - 16 - 2 * 8) / 3)),
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

    // 云白面板 + 功能色左侧竖条（沿用羁绊风格色，几何不变）
    this._cardBg({ x: panelX, y: panelY, w: panelW, h: panelH }, {
      r: 18, tint: 'rgba(255,255,255,0.98)', border: 'rgba(43,74,111,0.28)',
      edge: styleColor, edgeSide: 'left',
    });
    this._artIcon(ART_PREFIXES.synergy, d.style, panelX + 20, panelY + 20, 18, 0.95);

    ctx.textBaseline = 'middle';

    // 关闭按钮（几何不变，圆形云白底 + 深蓝 ✕）
    const synClose = { x: panelX + panelW - 36, y: panelY + 10, w: 26, h: 26 };
    this._cardBg(synClose, { r: 13, tint: 'rgba(214,238,251,0.95)', border: 'rgba(43,74,111,0.3)', flat: true });
    ctx.fillStyle = UI_THEME.navy;
    ctx.font = 'bold 15px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('✕', panelX + panelW - 20, panelY + 20);

    // 标题：图标 + 羁绊名 + 当前等级（深色文字，功能色仅用于未激活弱字）
    ctx.textAlign = 'left';
    ctx.fillStyle = UI_THEME.ink;
    ctx.font = 'bold 16px sans-serif';
    ctx.fillText(`${d.icon || '?'} ${d.name}`, panelX + 18, panelY + 26);
    ctx.textAlign = 'right';
    ctx.fillStyle = d.active ? UI_THEME.orangeDeep : UI_THEME.navySoft;
    ctx.font = 'bold 12px sans-serif';
    ctx.fillText(d.active ? `Lv.${d.level}/${d.maxLevel}` : '未激活', panelX + panelW - 38, panelY + 26);

    let y = panelY + 50;
    const leftX = panelX + 18;

    // ---- 如何激活 ----
    ctx.textAlign = 'left';
    ctx.fillStyle = UI_THEME.skyDeep;
    ctx.font = 'bold 11px sans-serif';
    ctx.fillText('如何激活', leftX, y);
    y += 17;
    ctx.fillStyle = UI_THEME.navy;
    ctx.font = '11px sans-serif';
    ctx.fillText(d.activateDesc, leftX + 8, y);
    y += 16;
    ctx.fillStyle = d.active ? UI_THEME.green : UI_THEME.navySoft;
    ctx.fillText(d.currentDesc, leftX + 8, y);
    y += 16;
    if (d.sourceUnits && d.sourceUnits.length > 0) {
      ctx.fillStyle = UI_THEME.navySoft;
      ctx.font = '10px sans-serif';
      const names = d.sourceUnits.map((u) => `${u.icon}${u.name}`).join(' ');
      ctx.fillText('贡献兵种: ' + names, leftX + 8, y);
      y += 16;
    }

    // ---- 等级效果表 ----
    y += 6;
    ctx.fillStyle = UI_THEME.skyDeep;
    ctx.font = 'bold 11px sans-serif';
    ctx.fillText('等级效果', leftX, y);
    y += 17;
    for (const lv of d.levels || []) {
      if (y > panelY + panelH - 30) break;
      ctx.font = 'bold 10px sans-serif';
      ctx.fillStyle = lv.isCurrent ? UI_THEME.orangeDeep : (lv.active ? UI_THEME.green : UI_THEME.navySoft);
      ctx.textAlign = 'left';
      ctx.fillText(`Lv.${lv.level}`, leftX + 8, y);
      ctx.font = '10px sans-serif';
      ctx.fillStyle = lv.isCurrent ? UI_THEME.orangeDeep : (lv.active ? UI_THEME.navy : UI_THEME.navySoft);
      ctx.fillText((lv.effects || []).join('  '), leftX + 58, y);
      y += 15;
    }

    // 底部提示
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(43,74,111,0.5)';
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

    // 云白面板 + 明黄左侧竖条（几何来自 buildingDetailPanelLayout，不变）
    this._cardBg({ x: L.panelX, y: L.panelY, w: L.panelW, h: L.panelH }, {
      r: 18, tint: 'rgba(255,255,255,0.98)', border: 'rgba(43,74,111,0.28)',
      edge: UI_THEME.gold, edgeSide: 'left',
    });
    const _buKey = ({ barracks: 'barracks', arrow_tower: 'tower', gold_mine: 'mine' })[bld.type];
    this._artIcon(ART_PREFIXES.buildingUp, _buKey, L.panelX + 20, L.panelY + 20, 18, 0.95);

    ctx.textBaseline = 'middle';

    // 关闭按钮（几何不变）
    const bldClose = { x: L.panelX + L.panelW - 36, y: L.panelY + 10, w: 26, h: 26 };
    this._cardBg(bldClose, { r: 13, tint: 'rgba(214,238,251,0.95)', border: 'rgba(43,74,111,0.3)', flat: true });
    ctx.fillStyle = UI_THEME.navy;
    ctx.font = 'bold 15px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('✕', L.panelX + L.panelW - 20, L.panelY + 20);

    // 标题: 建筑名 + 等级（深色文字）
    const maxLv = bld.maxLevel || (bld.upgradeCost && bld.upgradeCost.maxLevel) || bld.level || 1;
    ctx.fillStyle = UI_THEME.ink;
    ctx.font = 'bold 17px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(`${bld.icon || '?'} ${bld.name || bld.type} Lv.${bld.level}/${maxLv}`, L.panelX + 18, L.panelY + 26);

    const leftX = L.panelX + 18;
    let y = L.panelY + 50;

    // ---- 当前效果 ----
    ctx.fillStyle = UI_THEME.skyDeep;
    ctx.font = 'bold 11px sans-serif';
    ctx.fillText(`当前效果 (Lv.${bld.level})`, leftX, y);
    y += 17;
    ctx.fillStyle = UI_THEME.navy;
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
      ctx.fillStyle = UI_THEME.green;
      ctx.font = 'bold 11px sans-serif';
      ctx.fillText('已满级，无法继续强化', leftX, y);
    } else {
      ctx.fillStyle = UI_THEME.skyDeep;
      ctx.font = 'bold 11px sans-serif';
      ctx.fillText(`升级至 Lv.${bld.level + 1}`, leftX, y);
      y += 17;
      ctx.fillStyle = UI_THEME.navy;
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
      ctx.fillStyle = okStar ? UI_THEME.skyDeep : '#C0392B';
      ctx.fillText(`✦ 星尘 ${cost.starDust}（拥有 ${cur.stardust}）${okStar ? '✓' : '✕'}`, leftX + 8, y);
      y += 15;
      ctx.fillStyle = okGold ? UI_THEME.orangeDeep : '#C0392B';
      ctx.fillText(`◆ 金币 ${cost.gold}（拥有 ${cur.gold}）${okGold ? '✓' : '✕'}`, leftX + 8, y);
    }

    // ---- 升级按钮（命中区由 buildingDetailPanelLayout 统一给出，几何不变）----
    const canUpgrade = !maxed && !!bld.canAfford;
    if (canUpgrade) {
      this._primaryButton({ x: L.btnX, y: L.btnY, w: L.btnW, h: L.btnH, r: 10 }, maxed ? '已满级' : '升 级');
    } else {
      this._cardBg({ x: L.btnX, y: L.btnY, w: L.btnW, h: L.btnH, r: 10 }, {
        r: 10, tint: 'rgba(214,238,251,0.9)', border: 'rgba(43,74,111,0.25)',
      });
      ctx.fillStyle = UI_THEME.navySoft;
      ctx.font = 'bold 14px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(maxed ? '已满级' : '资源不足', L.btnX + L.btnW / 2, L.btnY + L.btnH / 2);
      ctx.textBaseline = 'alphabetic';
    }
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

    // 云白面板 + 品质色左侧竖条（几何来自 unitDetailPanelLayout，不变）
    this._cardBg({ x: panelX, y: panelY, w: panelW, h: panelH }, {
      r: 18, tint: 'rgba(255,255,255,0.98)', border: 'rgba(43,74,111,0.28)',
      edge: qColor, edgeSide: 'left',
    });

    // 标题栏：云白偏蓝软底 + 深色文字
    this._cardBg({ x: panelX + 2, y: panelY + 2, w: panelW - 4, h: 35, r: 12 }, {
      r: 12, tint: 'rgba(214,238,251,0.9)', flat: true,
    });
    ctx.fillStyle = UI_THEME.ink;
    ctx.font = 'bold 15px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('兵种详情', panelX + panelW / 2, panelY + 18);

    // 关闭按钮（几何不变，圆形云白底 + 深蓝 ✕）
    const closeX = panelX + panelW - 35;
    const closeY = panelY + 5;
    this._cardBg({ x: closeX, y: closeY, w: 30, h: 30, r: 15 }, {
      r: 15, tint: 'rgba(214,238,251,0.95)', border: 'rgba(43,74,111,0.3)', flat: true,
    });
    ctx.fillStyle = UI_THEME.navy;
    ctx.font = 'bold 16px sans-serif';
    ctx.fillText('×', closeX + 15, closeY + 15);

    // === 单位图标 + 名称（兵种立绘本轮不出，保留 emoji 文字兜底，仅转深色）===
    const iconY = panelY + 65;
    ctx.font = 'bold 36px sans-serif';
    ctx.fillStyle = UI_THEME.navy;
    ctx.fillText(unit.icon || '?', panelX + 50, iconY);

    ctx.textAlign = 'left';
    ctx.fillStyle = UI_THEME.ink;
    ctx.font = 'bold 16px sans-serif';
    ctx.fillText(unit.name || '?', panelX + 90, panelY + 55);

    // 品质标签（功能色保留）
    ctx.fillStyle = qColor;
    ctx.font = 'bold 11px sans-serif';
    ctx.fillText(`[${qName}]`, panelX + 90, panelY + 72);

    // 等级
    ctx.fillStyle = UI_THEME.orangeDeep;
    ctx.font = 'bold 13px sans-serif';
    ctx.fillText(`Lv.${unit.level}`, panelX + 90, panelY + 88);

    // 战斗风格
    const styleNames = { melee: '近战', ranged: '远程', defense: '防御', magic: '法术' };
    const styles = (unit.combatStyles || []).map(s => styleNames[s] || s).join('/');
    ctx.fillStyle = UI_THEME.navySoft;
    ctx.font = '10px sans-serif';
    ctx.fillText(styles, panelX + 130, panelY + 88);

    // === 属性区（云白卡 + 深色文字，几何不变）===
    const statsY = panelY + 110;
    this._cardBg({ x: panelX + 10, y: statsY, w: panelW - 20, h: 70, r: 10 }, {
      r: 10, tint: 'rgba(234,248,255,0.92)', border: 'rgba(43,74,111,0.18)', flat: true,
    });

    ctx.textAlign = 'left';
    ctx.font = '11px sans-serif';
    const colX1 = panelX + 20;
    const colX2 = panelX + panelW / 2 + 5;
    const rowH = 16;

    ctx.fillStyle = UI_THEME.navySoft;
    ctx.fillText('攻击', colX1, statsY + 15);
    ctx.fillText('生命', colX2, statsY + 15);
    ctx.fillText('速度', colX1, statsY + 15 + rowH);
    ctx.fillText('射程', colX2, statsY + 15 + rowH);
    ctx.fillText('生产', colX1, statsY + 15 + rowH * 2);

    ctx.fillStyle = UI_THEME.ink;
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
      ctx.fillStyle = UI_THEME.navySoft;
      ctx.font = '10px sans-serif';
      ctx.fillText('特殊:', panelX + 15, nextY);
      ctx.fillStyle = UI_THEME.skyDeep;
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
      ctx.fillStyle = UI_THEME.skyDeep;
      ctx.font = 'bold 10px sans-serif';
      ctx.fillText(`技能 (${unlockedCount}/${skills.length})`, panelX + 15, nextY);
      ctx.textAlign = 'right';
      ctx.font = '9px sans-serif';
      ctx.fillStyle = UI_THEME.navySoft;
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

        // 品质色点（功能色保留）
        ctx.beginPath();
        ctx.arc(panelX + 19, nextY - 3, 3, 0, Math.PI * 2);
        ctx.fillStyle = unlocked ? (skQColors[sk.quality] || UI_THEME.navySoft) : 'rgba(43,74,111,0.3)';
        ctx.fill();

        // 技能名（锁定置灰）
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = unlocked ? UI_THEME.ink : UI_THEME.navySoft;
        ctx.font = 'bold 10px sans-serif';
        ctx.fillText(sk.name, panelX + 27, nextY - 3);

        // 被动/主动 + 数值标签
        ctx.fillStyle = unlocked ? UI_THEME.navySoft : 'rgba(43,74,111,0.4)';
        ctx.font = '9px sans-serif';
        ctx.fillText(`${sk.kind === 'active' ? '主动' : '被动'}·${skLabel(sk)}`, panelX + 92, nextY - 3);

        // 右侧解锁状态
        ctx.textAlign = 'right';
        if (!unlocked) {
          ctx.fillStyle = '#C0392B';
          ctx.font = '9px sans-serif';
          ctx.fillText('锁 Lv.' + sk.unlockLevel, panelX + panelW - 15, nextY - 3);
        } else if (sk.kind === 'active') {
          ctx.fillStyle = UI_THEME.orangeDeep;
          ctx.font = 'bold 9px sans-serif';
          ctx.fillText('主动', panelX + panelW - 15, nextY - 3);
        } else {
          ctx.fillStyle = UI_THEME.green;
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
    ctx.fillStyle = UI_THEME.navySoft;
    ctx.font = '10px sans-serif';
    ctx.fillText('招募进度:', panelX + 15, nextY);

    ctx.fillStyle = isMaxLevel ? UI_THEME.orangeDeep : (recruitReady ? UI_THEME.green : UI_THEME.navySoft);
    ctx.textAlign = 'right';
    ctx.font = 'bold 10px sans-serif';
    if (isMaxLevel) {
      ctx.fillText('已满级', panelX + panelW - 15, nextY);
    } else {
      ctx.fillText(`${recruitCurrent}/${recruitNeeded}`, panelX + panelW - 15, nextY);
    }
    nextY += 8;

    // 进度条（云白槽底 + 明黄/功能色填充，几何不变）
    if (!isMaxLevel && recruitNeeded > 0) {
      const barX = panelX + 15;
      const barW = panelW - 30;
      const barH = 6;
      this._progressBar({ x: barX, y: nextY, w: barW, h: barH },
        Math.min(1, recruitCurrent / recruitNeeded),
        { color: recruitReady ? UI_THEME.green : UI_THEME.skyDeep });
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
      ctx.fillStyle = UI_THEME.navySoft;
      ctx.font = '10px sans-serif';
      ctx.fillText('升级消耗:', panelX + 15, nextY);

      ctx.textAlign = 'right';
      ctx.font = 'bold 10px sans-serif';
      ctx.fillStyle = hasStarDust ? UI_THEME.green : '#C0392B';
      ctx.fillText(`✦ ${scaledStarDust}`, panelX + panelW / 2, nextY);
      ctx.fillStyle = hasGold ? UI_THEME.green : '#C0392B';
      ctx.fillText(`◆ ${scaledGold}`, panelX + panelW - 15, nextY);
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

    // 上阵按钮（几何不变：已上阵=云白弱面，可上阵=明黄主 CTA，槽满=灰弱面）
    const slotsFull = !isDeployed && deployedUnits.filter(Boolean).length >= 6;
    const canDeploy = !isDeployed && !slotsFull;
    const deployRect = { x: deployBtnX, y: btnY, w: btnW, h: btnH, r: 10 };
    if (canDeploy) {
      this._primaryButton(deployRect, '上 阵');
    } else {
      this._cardBg(deployRect, {
        r: 10,
        tint: isDeployed ? 'rgba(198,239,214,0.92)' : 'rgba(214,238,251,0.9)',
        border: isDeployed ? 'rgba(22,138,74,0.45)' : 'rgba(43,74,111,0.25)',
      });
      ctx.fillStyle = isDeployed ? UI_THEME.green : UI_THEME.navySoft;
      ctx.font = 'bold 13px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(isDeployed ? '✓ 已上阵' : '槽位已满', deployBtnX + btnW / 2, btnY + btnH / 2);
    }

    // 升级按钮 / 已满级（几何不变）
    const upgradeRect = { x: upgradeBtnX, y: btnY, w: btnW, h: btnH, r: 10 };
    if (!isMaxLevel) {
      if (canUpgrade) {
        this._primaryButton(upgradeRect, '升 级');
      } else {
        this._cardBg(upgradeRect, { r: 10, tint: 'rgba(214,238,251,0.9)', border: 'rgba(43,74,111,0.25)' });
        ctx.fillStyle = UI_THEME.navySoft;
        ctx.font = 'bold 13px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('条件不足', upgradeBtnX + btnW / 2, btnY + btnH / 2);
      }
    } else {
      this._cardBg(upgradeRect, { r: 10, tint: 'rgba(255,237,213,0.95)', border: 'rgba(232,168,56,0.5)' });
      ctx.fillStyle = UI_THEME.orangeDeep;
      ctx.font = 'bold 14px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('★ 已满级 ★', upgradeBtnX + btnW / 2, btnY + btnH / 2);
    }
    ctx.textBaseline = 'alphabetic';
  }

  /**
   * 战斗结算界面按钮几何（P36：渲染与 Game.handlePlayingClick 命中共用的单一真相源）
   *
   * 2026-11 交互改造：结算界面不再支持「点击屏幕空白关闭」，改为必须通过
   * 「返回大厅」按钮关闭；胜利时另有「炫耀战绩」分享按钮置于主按钮上方。
   * 胜负两态共用同一份 back 几何：玩家肌肉记忆位置稳定，命中判定也无需区分胜负。
   *
   * 坐标系为 inner（renderScreen 的 ctx.translate/scale 包裹内），输入侧 Game 已按
   * (screenY - safeAreaTop) / safeAreaScaleY 反推到同一坐标系，两边天然对齐。
   *
   * @param {number} w inner 屏宽
   * @param {number} h inner 屏高
   */
  static gameOverLayout(w, h) {
    const cx = w / 2;
    const cy = h / 2;
    const backW = 200, backH = 48, backY = cy + 104;
    const shareW = 150, shareH = 34, shareY = cy + 60;
    return {
      back: { x: cx - backW / 2, y: backY, w: backW, h: backH },
      share: { x: cx - shareW / 2, y: shareY, w: shareW, h: shareH },
    };
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
    this._art(RESULT_BG[isWin ? 'won' : 'lost'], 0, 0, this.screenWidth, this.screenHeight, { fit: 'cover', alpha: 0.7 });
    // 结算三态图形（星级 / 晋升 / 摘要）+ 胜负粒子与段位流光。
    // 这些是占位九宫格/特效素材，自带粉紫框线与「占位图」文字；云白卡已达标，
    // 低 alpha 装饰反而透出脏底，故由 artResultDecor 开关控制（默认关闭）。
    // 待同名替换为正式素材后设 artResultDecor=true 即可恢复，几何/命中不变。
    const _rw = this.screenWidth, _rh = this.screenHeight;
    if (this._artResultDecor !== false) {
      this._art(pick_result('star'), _rw / 2 - 120, _rh * 0.30, 240, 54, { alpha: 0.14 });
      this._art(pick_result('promote'), _rw / 2 - 120, _rh * 0.30 + 58, 240, 54, { alpha: 0.12 });
      this._art(pick_result('summary'), _rw / 2 - 120, _rh * 0.30 + 116, 240, 54, { alpha: 0.12 });
      this._art(pick_rankShine(), _rw / 2 - 24, _rh * 0.30 - 40, 48, 48, { alpha: 0.18 });
      this._art(pick_defeatFx(isWin ? 'debris' : 'flash'), _rw / 2 - 60, _rh * 0.22, 120, 120, { alpha: 0.14 });
    }
    if (isWin) {
      if (this._artResultDecor !== false) this._artFx('firework', cx - 100, cy - 165, 200, 130, 0.45);
      this._artFx('medalGold', cx - 22, cy - 148, 44, 44, 0.65); // 奖牌为本轮正式图，保留
    }

    // ===== 云白结果卡：散落文字收进卡片，深色三级文字（夜景舞台底 + 云白卡语言） =====
    const L = RenderSystem.gameOverLayout(this.screenWidth, this.screenHeight);
    const cardW = Math.min(this.screenWidth - 40, 360);
    const cardX = cx - cardW / 2;
    const cardTop = cy - 100;
    this._cardBg({ x: cardX, y: cardTop, w: cardW, h: 152, r: 16 }, {
      tint: 'rgba(255,255,255,0.96)',
    });
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // 标题：胜负语义色，但压在云白卡上必须用深色系（浅绿/浅红在白卡上看不清）
    ctx.fillStyle = isWin ? UI_THEME.green : '#C0394B';
    ctx.font = FontSystem.font(34, 'bold', 'title');
    ctx.fillText(isWin ? '胜 利!' : '失 败', cx, cy - 76);

    // 对手信息
    ctx.fillStyle = UI_THEME.navy;
    ctx.font = '12px sans-serif';
    ctx.fillText('对手: ' + (gameState.enemyName || 'AI'), cx, cy - 48);

    // 奖励信息（金币 + 星尘）
    const rewards = gameState.lastRewards || {};
    if (rewards.gold || rewards.stardust) {
      ctx.fillStyle = UI_THEME.goldDeep;
      ctx.font = 'bold 15px sans-serif';
      let rewardText = '';
      if (rewards.gold) rewardText += '◆' + rewards.gold + ' ';
      if (rewards.stardust) rewardText += '✦' + rewards.stardust;
      ctx.fillText('奖励: ' + rewardText, cx, cy - 26);
    }

    // 天梯奖杯变化（胜利 ▲ 绿 / 失败 ▼ 红，附当前段位）
    if (rewards.trophyDelta !== undefined && rewards.tier) {
      const up = rewards.trophyDelta >= 0;
      ctx.fillStyle = up ? UI_THEME.green : '#C0394B';
      ctx.font = 'bold 14px sans-serif';
      const arrow = up ? '▲+' : '▼';
      ctx.fillText(`奖杯 ${arrow}${rewards.trophyDelta}  →  ${rewards.trophies}杯`, cx, cy - 10);
      // 段位变动标记
      if (rewards.tierUp) {
        ctx.fillStyle = UI_THEME.goldDeep;
        ctx.font = 'bold 12px sans-serif';
        ctx.fillText(`⬆ 晋升【${rewards.tier.icon}${rewards.tier.label}】！`, cx, cy + 8);
      } else {
        ctx.fillStyle = UI_THEME.navySoft;
        ctx.font = '11px sans-serif';
        ctx.fillText(`${rewards.tier.icon}${rewards.tier.label}段位`, cx, cy + 8);
      }
    }

    // 招募进度
    const recruitSummary = gameState.recruitSummary || [];
    if (recruitSummary.length > 0) {
      const recruitText = recruitSummary.slice(0, 4).map(r => `${r.icon}×${r.count}`).join('  ');
      ctx.fillStyle = UI_THEME.navySoft;
      ctx.font = '11px sans-serif';
      ctx.fillText('本局招募: ' + recruitText + (recruitSummary.length > 4 ? ' ...' : ''), cx, cy + 24);

      // 胜利时显示招募进度减半提示
      if (isWin) {
        ctx.fillStyle = '#7C3AED';
        ctx.font = '10px sans-serif';
        ctx.fillText('（胜利招募进度×0.5，通过抽卡获取更多兵种）', cx, cy + 40);
      }
    }

    if (!isWin) {
      ctx.fillStyle = UI_THEME.navySoft;
      ctx.font = 'bold 13px sans-serif';
      ctx.fillText('你的大本营被摧毁了', cx, cy + 24);
    }

    // 战绩分享按钮（Phase 5，仅胜利时显示；置于主按钮上方）
    if (isWin) {
      const s = L.share;
      this._drawPressed(s, gameState.press, () => {
        this._cardBg({ x: s.x, y: s.y, w: s.w, h: s.h, r: 12 }, {
          tint: 'rgba(255,255,255,0.94)', border: 'rgba(8,145,178,0.5)', flat: true,
        });
        ctx.fillStyle = '#0E7490';
        ctx.font = 'bold 13px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const shareCx = s.x + s.w / 2;
        if (!this._artIcon(ART_PREFIXES.lobby, 'share', shareCx - 48, s.y + s.h / 2, 14, 1)) {
          ctx.fillText('↗', shareCx - 48, s.y + s.h / 2 + 1);
        }
        ctx.fillText('炫耀战绩', shareCx + 8, s.y + s.h / 2);
      });
    }

    // 「返回大厅」主按钮（胜负共用，几何由 gameOverLayout 统一给出）
    // 2026-11 交互改造：结算界面只能通过此按钮关闭，点击空白不再退出。
    {
      const b = L.back;
      this._drawPressed(b, gameState.press, () => {
        this._cardBg({ x: b.x, y: b.y, w: b.w, h: b.h, r: 14 }, {
          tint: UI_THEME.gold, border: UI_THEME.goldDeep, edge: UI_THEME.orangeDeep, flat: true,
        });
        ctx.fillStyle = UI_THEME.ink;
        ctx.font = 'bold 17px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('返回大厅', b.x + b.w / 2, b.y + b.h / 2);
      });
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

    // 新手引导：高亮光环 hook + 文案卡 / 步骤点 / 箭头 / 手势图标
    const _haloR = L.circleR || L.ringR || 40;
    const _hcx = Number.isFinite(L.cx) ? L.cx : (Number.isFinite(L.holeX) ? L.holeX + L.holeW / 2 : w / 2);
    const _hcy = Number.isFinite(L.cy) ? L.cy : (Number.isFinite(L.holeY) ? L.holeY + L.holeH / 2 : h / 2);
    this._artFx('tutorialHalo', _hcx - _haloR - 12, _hcy - _haloR - 12,
      _haloR * 2 + 24, _haloR * 2 + 24, 0.22);
    this._art(pick_tutorialCard(), 20, h - 200, w - 40, 110, { alpha: 0.16 });
    this._art(pick_tutorialDots(), w / 2 - 45, h - 78, 90, 18, { alpha: 0.20 });
    const _ta = iconKey('tutorial', 'arrow');
    const _th = iconKey('tutorial', 'hand');
    if (_ta) this._art(_ta, _hcx - 14, _hcy - 60, 28, 28, { alpha: 0.30 });
    if (_th) this._art(_th, _hcx + 18, _hcy + 26, 28, 28, { alpha: 0.30 });

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

    // 4. 文案卡：接入云白内容卡语言（原深蓝裸块在浅色界面上过于突兀）
    //    几何仍取自 tutorialLayout（与点击命中同源），这里只换容器与文字色阶。
    const cardX = L.cardX;
    const cardY = L.cardY;
    const cardW = L.cardW;
    const cardH = L.cardH;
    this._cardBg({ x: cardX, y: cardY, w: cardW, h: cardH, r: 12 }, {
      tint: 'rgba(255,255,255,0.97)',
      border: 'rgba(255,210,63,0.72)',
      edge: UI_THEME.gold,
      edgeSide: 'top',
    });

    // 步骤标题
    ctx.fillStyle = UI_THEME.navy;
    ctx.font = 'bold 14px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`\u65b0\u624b\u5f15\u5bfc ${tut.step + 1}/4`, w / 2, cardY + 20);

    // 正文（按字符宽度自动换行，最多3行）
    ctx.fillStyle = UI_THEME.ink;
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
    ctx.fillStyle = UI_THEME.navySoft;
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

  /**
   * 段位城堡接地阴影：土台正下方的椭圆软投影，在城堡之前绘制。
   * 用 translate + scale + arc 画椭圆径向渐变（不依赖 ctx.ellipse，跨基础库安全）。
   * 只画在土台下方，不会在贴图矩形边缘留下硬边。
   */
  _drawRankCastleShadow(cx, cy, r) {
    const { ctx } = this;
    if (typeof ctx.createRadialGradient !== 'function' || typeof ctx.arc !== 'function') return;
    ctx.save();
    ctx.translate(cx, cy + r * 0.72);
    ctx.scale(1, 0.30);
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, r * 0.98);
    g.addColorStop(0, 'rgba(7, 10, 22, 0.66)');
    g.addColorStop(0.46, 'rgba(7, 10, 22, 0.32)');
    g.addColorStop(1, 'rgba(7, 10, 22, 0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.98, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  /**
   * 段位城堡环境整合：在城堡之后绘制三层，全部用渐变叠加。
   * ① 冷调渗透 —— 极淡夜空蓝拉近色温，几乎不改明度
   * ② 土台压暗 —— 只作用于圆盘侧壁（cy+0.34r 以下），塔身明度完全不受影响
   * ③ 边缘雾吞没 —— 以土台底部为中心的环形雾，把锐利贴图边缘融进背景空气
   */
  _drawRankCastleFusion(cx, cy, r) {
    const { ctx } = this;
    if (typeof ctx.createLinearGradient !== 'function' || typeof ctx.createRadialGradient !== 'function') return;

    if (typeof ctx.arc === 'function' && typeof ctx.clip === 'function') {
      // ① 冷调渗透
      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, r * 0.99, 0, Math.PI * 2);
      ctx.clip();
      const gc = ctx.createLinearGradient(0, cy - r, 0, cy + r);
      gc.addColorStop(0, 'rgba(54, 68, 122, 0.03)');
      gc.addColorStop(0.6, 'rgba(46, 58, 108, 0.05)');
      gc.addColorStop(1, 'rgba(28, 34, 66, 0.09)');
      ctx.fillStyle = gc;
      ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
      ctx.restore();

      // ② 土台压暗（椭圆裁剪，只覆盖圆盘侧壁）
      ctx.save();
      ctx.translate(cx, cy + r * 0.12);
      ctx.scale(1, 0.946);
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.93, 0, Math.PI * 2);
      ctx.clip();
      const gd = ctx.createLinearGradient(0, r * 0.38, 0, r * 0.98);
      gd.addColorStop(0, 'rgba(24, 28, 46, 0)');
      gd.addColorStop(0.55, 'rgba(24, 28, 46, 0.13)');
      gd.addColorStop(1, 'rgba(22, 26, 44, 0.28)');
      ctx.fillStyle = gd;
      ctx.fillRect(-r, -r, r * 2, r * 2);
      ctx.restore();
    }

    // ③ 边缘雾吞没
    const gb = ctx.createRadialGradient(cx, cy + r * 0.62, r * 0.26, cx, cy + r * 0.62, r * 0.95);
    gb.addColorStop(0, 'rgba(31, 37, 60, 0)');
    gb.addColorStop(0.52, 'rgba(31, 37, 60, 0.08)');
    gb.addColorStop(0.80, 'rgba(31, 37, 60, 0.24)');
    gb.addColorStop(1, 'rgba(33, 39, 64, 0.38)');
    ctx.fillStyle = gb;
    ctx.fillRect(cx - r, cy, r * 2, r);
  }

  drawLobby(gameState) {
    const { ctx } = this;
    const w = this.screenWidth;
    const h = this.screenHeight;
    const profile = gameState.profile;

    // 渐变背景（直接绘制，避免离屏缓存 canvas 在界面切换时被浏览器回收导致残留）
    // 晴空乐园：底色也从旧暗色系改为天蓝→云白，配合 artAlpha 贴图不会透出暗底
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, UI_THEME.sky);
    grad.addColorStop(0.55, UI_THEME.skyLight);
    grad.addColorStop(1, UI_THEME.cloud);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
    // 晴空乐园：大厅背景已是正式素材，以不透明绘制，避免 artAlpha=0.5 让城堡发白；
    // 全局 artAlpha 保持 0.5，只影响其他界面仍未替换的占位图水印。
    this._drawBackdrop(w, h, 1);
    // 背景按「大厅可见窗口」重排为层叠景深：夜空 0-20% → 远山 24-52% → 雾面平台 52-62%
    // → 云海+暖光 62-75% → 暗底 75-100%。其中 75% 以下全部被上阵卡/开战按钮/导航遮挡，
    // 故暗角只需收在两端：顶部压资源栏、底部压导航，58%-78% 的云海与暖光必须完全通透。
    const vignette = ctx.createLinearGradient(0, 0, 0, h);
    vignette.addColorStop(0, 'rgba(8, 12, 24, 0.34)');
    vignette.addColorStop(0.14, 'rgba(8, 12, 24, 0.15)');
    vignette.addColorStop(0.45, 'rgba(8, 12, 24, 0)');
    vignette.addColorStop(0.8, 'rgba(8, 12, 24, 0)');
    vignette.addColorStop(0.9, 'rgba(8, 12, 24, 0.16)');
    vignette.addColorStop(1, 'rgba(8, 12, 24, 0.34)');
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, w, h);

    // 顶部资源栏（含天梯奖杯，颜色随段位）：P16 统一改由 _drawResourceBar 在左上角绘制，
    // 大厅不再居中式横排。ladderTier 仍在此读取，供下方徽章/进度条使用。
    const ladderTier = gameState.ladderTier;

    // 设置按钮（右上角小图标，打开设置窗口）——晴空乐园圆角卡片 + 正式设置图标
    const lobbySet = { x: w - 45, y: 10, w: 35, h: 30, r: 9 };
    this._cardBg(lobbySet, { tint: 'rgba(234,248,255,0.95)', border: 'rgba(43,74,111,0.25)' });
    if (!this._artIcon(ART_PREFIXES.hud, 'setting', lobbySet.x + lobbySet.w / 2, lobbySet.y + lobbySet.h / 2, 18, 1)) {
      ctx.fillStyle = UI_THEME.navy;
      ctx.font = 'bold 15px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('⚙', lobbySet.x + lobbySet.w / 2, lobbySet.y + lobbySet.h / 2 + 1);
    }

    // v2 布局：已移除「占地之王」大标题与副标题，页面重心交给玩家卡 / 赛季区 / 上阵区。

    // === 左上角玩家信息卡（账号 + 战力合并，点击打开账号面板）===
    // 宽度 = 屏宽 1/3，内容紧凑分四行：昵称 / 尾号 / 战力 / 参考战力
    const card = lobbyPlayerCardRect(w);
    this._drawRaisedCard(card, () => {
      ctx.fillStyle = tintOf(UI_THEME.navy, 0.11);
      ctx.fillRect(card.x, card.y, card.w, card.h);
      ctx.strokeStyle = UI_THEME.navy;
      ctx.lineWidth = 1.5;
      ctx.strokeRect(card.x, card.y, card.w, card.h);
    });
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    const cardPadX = 7;
    const cardInnerW = card.w - cardPadX * 2;
    // 窄卡文本截断：真实浏览器按 measureText 实际宽度裁；测试 stub 返回固定宽度则原样保留
    const fitCardText = (text, maxW) => {
      if (typeof ctx.measureText !== 'function' || ctx.measureText(text).width <= maxW) return text;
      let out = text;
      while (out.length > 1 && ctx.measureText(out + '…').width > maxW) out = out.slice(0, -1);
      return out + '…';
    };
    // 行1：昵称（截断）+ ▾
    if (gameState.accountInfo) {
      const ai = gameState.accountInfo;
      ctx.font = 'bold 11px sans-serif';
      ctx.fillStyle = UI_THEME.ink;
      ctx.fillText(fitCardText(ai.nickname + ' ▾', cardInnerW), card.x + cardPadX, card.y + 14);
      // 行2：账号尾号（uid 后 6 位）
      if (ai.uid) {
        ctx.font = '9px sans-serif';
        ctx.fillStyle = tintOf(UI_THEME.ink, 0.35);
        ctx.fillText(fitCardText('账号尾号 ' + ai.uid.slice(-6), cardInnerW), card.x + cardPadX, card.y + 33);
      }
    }
    // 行3：战力（醒目大字）+ 行4：参考战力状态（颜色随达成状态）
    if (gameState.powerInfo) {
      const pi = gameState.powerInfo;
      const powerTone = pi.ratio >= 1 ? UI_THEME.green : UI_THEME.orangeDeep;
      ctx.font = 'bold 15px sans-serif';
      ctx.fillStyle = powerTone;
      ctx.fillText(fitCardText(`⚔ 战力 ${pi.total}`, cardInnerW), card.x + cardPadX, card.y + 54);
      ctx.font = '8px sans-serif';
      ctx.fillStyle = pi.ratio >= 1 ? UI_THEME.green : UI_THEME.navy;
      const status = pi.ratio >= 1
        ? `已达本段位参考战力 ${pi.reference}`
        : `本段位参考战力 ${pi.reference}（差 ${Math.max(0, Math.round(pi.reference - pi.total))}）`;
      ctx.fillText(fitCardText(status, cardInnerW), card.x + cardPadX, card.y + 72);
    }

    // === 上阵兵种预览：标题 + 兵种牌统一放进一个有质感的框，兵种牌本身不再画独立底框 ===
    const deployY = lobbyDeployLabelY(h);
    const deployCardY = lobbyDeployCardY(h);
    const deployBox = { x: 8, y: deployY - 15, w: w - 16, h: deployCardY + 65 + 6 - (deployY - 15), r: 12 };
    this._drawRaisedCard(deployBox, () => {
      ctx.fillStyle = tintOf(UI_THEME.skyDeep, 0.07);
      ctx.fillRect(deployBox.x, deployBox.y, deployBox.w, deployBox.h);
      ctx.strokeStyle = UI_THEME.skyDeep;
      ctx.lineWidth = 1.5;
      ctx.strokeRect(deployBox.x, deployBox.y, deployBox.w, deployBox.h);
    });
    ctx.font = 'bold 11px sans-serif';
    ctx.fillStyle = UI_THEME.ink;
    ctx.textAlign = 'center';
    ctx.fillText('上阵兵种', w / 2, deployY);

    if (profile && profile.deployment) {
      const deployables = ConfigLoader.getSafe('deployables');
      const units = profile.deployment.units || [];
      const slotGap = 5;
      const slotW = rowItemWidth(units.length, slotGap, w, 8, LAYOUT_MIN.lobbySlot, LAYOUT_DESIGN_MAX.lobbySlot);
      const slotStartX = rowStartX(units.length, slotW, slotGap, w);
      const y = deployCardY;

      for (let i = 0; i < units.length; i++) {
        const actualX = slotStartX + i * (slotW + slotGap);
        const unitId = units[i];
        const u = (unitId && deployables?.units?.[unitId]) ? deployables.units[unitId] : null;
        // 兵种牌去底框：品质色改为名称文字表达，不再画矩形卡底/描边/厚底
        const q = u?.quality || 1;
        const nameColor = u ? (QUALITY_COLORS[q - 1] || '#9ca3af') : '#475569';

        if (u) {
          const collected = profile.collectedUnits[unitId];
          // 图标
          ctx.fillStyle = UI_THEME.navy;
          ctx.font = '20px sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText(u.icon || '?', actualX + slotW / 2, y + 22);
          // 名称：用品质色渲染（保留品质语义，去掉卡片底框）
          ctx.fillStyle = nameColor;
          ctx.font = 'bold 10px sans-serif';
          ctx.fillText(u.name, actualX + slotW / 2, y + 42);
          // 等级
          ctx.fillStyle = UI_THEME.navy;
          ctx.font = '9px sans-serif';
          ctx.fillText('Lv.' + (collected?.level || 1), actualX + slotW / 2, y + 56);
        } else {
          ctx.fillStyle = nameColor;
          ctx.font = '16px sans-serif';
          ctx.fillText('—', actualX + slotW / 2, y + 35);
        }
      }
    }

    // 战力信息已合并进左上角玩家信息卡（见上方），此处不再单独绘制。

    // === 功能按钮纵列（右上角，与 Game.handleLobbyClick 命中框同源）：分享 / 任务 / 成就 [+通行证] ===
    // v2：横向功能行改为右上角纵向排列，坐标由 Layout.lobbyFuncBtnRect 统一计算。
    // P25 features 开关：battlePass=false 时完全折叠通行证按钮（count 4→3，不留空位）
    const _features2 = ConfigLoader.getSafe('game')?.features || {};
    const _battlePassEnabled = _features2.battlePass !== false;
    const _rowCount = _battlePassEnabled ? 4 : 3;
    const rowDefs = [
      { border: UI_THEME.skyDeep },     // 分享（天蓝）
      { border: UI_THEME.orangeDeep },  // 任务（活力橙）
      { border: UI_THEME.goldDeep },    // 成就（明黄）
      { border: UI_THEME.navy },        // 通行证（海军蓝）
    ];
    const shareClaimed = gameState.shareRewardClaimed;
    for (let i = 0; i < _rowCount; i++) {
      const rect = lobbyFuncBtnRect(i, w, _rowCount);
      const { x, y, w: bw, h: bh } = rect;
      this._drawPressed(rect, gameState.press, () => {
        // 无底框：正方形按钮里图标居中偏上 + 下方一行入口文字。
        // 图标加功能色发光描边：在冷色夜空背景上让入口跳出来，不改几何与命中。
        const iconCx = x + bw / 2;
        const iconCy = y + bh * 0.42;
        const iconSize = Math.round(bh * 0.62);
        const glowColor = rowDefs[i].border;
        const glowR = iconSize * 0.62;
        if (typeof ctx.createRadialGradient === 'function' && typeof ctx.arc === 'function') {
          ctx.save();
          // 外发光：功能色径向渐变，中心亮、边缘透明，垫在图标下方
          const grad = ctx.createRadialGradient(iconCx, iconCy, iconSize * 0.28, iconCx, iconCy, glowR * 1.5);
          grad.addColorStop(0, hexToRgba(glowColor, 0.55));
          grad.addColorStop(0.55, hexToRgba(glowColor, 0.22));
          grad.addColorStop(1, hexToRgba(glowColor, 0));
          ctx.fillStyle = grad;
          ctx.beginPath();
          ctx.arc(iconCx, iconCy, glowR * 1.5, 0, Math.PI * 2);
          ctx.fill();
          // 功能色描边环：紧贴图标外沿的实心细环，强化轮廓
          ctx.beginPath();
          ctx.arc(iconCx, iconCy, glowR, 0, Math.PI * 2);
          ctx.strokeStyle = hexToRgba(glowColor, 0.9);
          ctx.lineWidth = 2;
          ctx.stroke();
          // 白色内描边：再套一圈细白线，让图标主体与功能色环分离、层次更清晰
          ctx.beginPath();
          ctx.arc(iconCx, iconCy, glowR - 2, 0, Math.PI * 2);
          ctx.strokeStyle = 'rgba(255,255,255,0.85)';
          ctx.lineWidth = 1;
          ctx.stroke();
          ctx.restore();
        }
        // 图标族：share/quest/achieve 走 lobby_；通行证走 medal_
        if (i === 3) {
          this._artIcon(ART_PREFIXES.medal, 'gold', iconCx, iconCy, iconSize, 1);
        } else {
          this._artIcon(ART_PREFIXES.lobby, FUNC_ART_KEYS[i], iconCx, iconCy, iconSize, 1);
        }
        // 图标下文字：无任何底框/胶囊，靠白色描边保证在天空背景上清晰可读
        const label = FUNC_LABELS[i];
        const labelY = y + bh - 8;
        ctx.font = `bold ${adaptiveFontSize(10, w)}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        if (typeof ctx.strokeText === 'function') {
          ctx.strokeStyle = 'rgba(255,255,255,0.95)';
          ctx.lineWidth = 3;
          ctx.lineJoin = 'round';
          ctx.strokeText(label, iconCx, labelY);
        }
        ctx.fillStyle = rowDefs[i].border;
        ctx.fillText(label, iconCx, labelY);
        // 分享未领取：右上角红点提示
        if (i === 0 && !shareClaimed) {
          const bx = x + bw - 7, by = y + 5;
          ctx.fillStyle = '#ef4444';
          ctx.beginPath();
          ctx.arc(bx, by, 5, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = 1;
          ctx.stroke();
        }
      });
    }

    // === 大段位徽章 + 段位进度条（v2：赛季区移到屏幕中偏上） ===
    // 组合单元整体在 [顶部玩家卡/功能按钮底, 上阵区上方] 内，坐标由 Layout.lobbySeasonCombo 统一计算
    const ladderProgress = gameState.ladderProgress;
    const ladderComboLayout = (ladderTier || ladderProgress)
      ? lobbySeasonCombo(w, h, _rowCount)
      : null;
    // rank_01~08 素材 key：大城堡单独使用；进度条左侧改用从城堡正面裁出的 rank_badge_01~08
    const rankKey = ladderTier
      ? String((ladderTier.index || 0) + 1).padStart(2, '0')
      : '01';
    if (ladderTier) {
      const { badgeR, badgeY } = ladderComboLayout;
      const cx = w / 2;
      // 3D 城堡图标：边长≈屏宽一半（badgeR 目标=screenW/4，矮屏按高度自适应缩小）
      // index 0-7 对应 rank_01(青铜)~rank_08(王者)
      const badgeImgSize = Math.round(badgeR * 2);
      // 段位城堡与夜景背景的物理整合：接地阴影在城堡之前，环境色/土台压暗/边缘雾在城堡之后。
      // 目的不是「压暗城堡」，而是补上它进入大气环境后必须有的三样关系：
      // ① 落地（土台下方有投影，不再是悬空圆盘）② 空气（边缘被雾吞没，不是锐利抠图边）
      // ③ 环境色（暗部染上天光冷色，与背景同处一个光照系统）。城堡主体明度刻意保持不变。
      this._drawRankCastleShadow(cx, badgeY, badgeR);
      this._artIcon(ART_PREFIXES.rank, rankKey, cx, badgeY, badgeImgSize, 1);
      this._drawRankCastleFusion(cx, badgeY, badgeR);
      // 段位名胶囊已移除：段位由进度条左侧的段位徽章 + 进度条颜色表达
    }

    // === 段位进度条（徽章下方，居中，长度自适应，P20） ===
    if (ladderTier && ladderProgress) {
      const barW = ladderBarWidth(w);
      const barX = (w - barW) / 2;
      const barY = ladderComboLayout.barY;
      const barH = ladderComboLayout.barH;
      // 当前段位徽章（城堡正面徽章裁切）：紧贴进度条左侧，与进度条同色语义表达当前段位
      const miniSize = Math.round(barH * 1.7);
      const miniCy = barY + barH / 2;
      const miniCx = barX - miniSize / 2 - 5;
      if (typeof ctx.arc === 'function') {
        // 淡色圆盘垫底，让小图标从背景中跳出来
        ctx.save();
        ctx.fillStyle = tintOf(ladderTier.color, 0.22);
        ctx.beginPath();
        ctx.arc(miniCx, miniCy, miniSize * 0.62, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
      this._artIcon(ART_PREFIXES.rankBadge, rankKey, miniCx, miniCy, miniSize, 1);
      // 底色（实心白轨道 + 悬浮厚底，圆角）
      this._drawRaisedCard({ x: barX, y: barY, w: barW, h: barH, r: 6 }, () => {
        ctx.fillStyle = tintOf(ladderTier.color, 0.14);
        ctx.fillRect(barX, barY, barW, barH);
        ctx.strokeStyle = ladderTier.color;
        ctx.lineWidth = 1;
        ctx.strokeRect(barX, barY, barW, barH);
      });
      // 进度填充（最高段位满条）
      ctx.fillStyle = ladderTier.color + '88';
      ctx.fillRect(barX, barY, barW * (ladderProgress.next ? ladderProgress.ratio : 1), barH);
      // 进度条内文字（居中）：当前杯 / 升级需要杯数（升级需求直接表达在进度条上，不再写下一级段位名）
      ctx.font = 'bold 11px sans-serif';
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'center';
      ctx.fillStyle = UI_THEME.ink;
      if (ladderProgress.next) {
        ctx.fillText(`${ladderProgress.cur} / ${ladderProgress.need} 杯`, w / 2, barY + barH / 2);
      } else {
        ctx.fillText('巅峰王者 · 已满级', w / 2, barY + barH / 2);
      }
      // 进度条下文字：统一用段位色表达「赛季剩余时间」（与进度条同一色彩语义）
      // 与进度条的间距由 Layout.LADDER_SEASON_TEXT_OFFSET 统一控制（已拉开，不再贴条）
      ctx.font = '10px sans-serif';
      const seasonText = `赛季剩 ${gameState.seasonDaysLeft || 7} 天`;
      this._drawTextPillBg(w / 2, ladderComboLayout.seasonY, seasonText, '10px sans-serif',
        { padX: 10, padY: 3, tint: ladderTier.color, border: ladderTier.color });
      ctx.fillStyle = ladderTier.color;
      ctx.fillText(seasonText, w / 2, ladderComboLayout.seasonY);
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
      const bx = (w - BL.w) / 2;
      const blPulse = Math.sin(Date.now() / 300) * 0.1 + 0.9;
      // 外发光：活力橙呼吸光晕
      ctx.fillStyle = `rgba(255, 140, 66, ${blPulse * 0.35})`;
      ctx.fillRect(bx - 3, blY - 3, BL.w + 6, BL.h + 6);
      // CTA 悬浮投影：海军蓝厚底 + 柔和阴影，让开战按钮从背景中跳出
      if (typeof ctx.arcTo === 'function' && typeof ctx.fill === 'function') {
        ctx.save();
        ctx.fillStyle = 'rgba(22, 48, 79, 0.28)';
        this._roundRectPath(bx, blY + 5, BL.w, BL.h, 12);
        ctx.fill();
        ctx.shadowColor = 'rgba(20, 48, 84, 0.3)';
        ctx.shadowBlur = 12;
        ctx.shadowOffsetX = 0;
        ctx.shadowOffsetY = 2;
        ctx.fillStyle = UI_THEME.orange;
        this._roundRectPath(bx, blY, BL.w, BL.h, 12);
        ctx.fill();
        ctx.restore();
      }
      // 主体：明黄→活力橙暖色 CTA（晴空乐园强调色），圆角
      const bGrad = ctx.createLinearGradient(0, blY, 0, blY + BL.h);
      bGrad.addColorStop(0, UI_THEME.gold);
      bGrad.addColorStop(1, UI_THEME.orange);
      this._drawCard({ x: bx, y: blY, w: BL.w, h: BL.h, r: 12 }, () => {
        ctx.fillStyle = bGrad;
        ctx.fillRect(bx, blY, BL.w, BL.h);
        ctx.strokeStyle = UI_THEME.white;
        ctx.lineWidth = 2;
        ctx.strokeRect(bx, blY, BL.w, BL.h);
      });
      ctx.fillStyle = UI_THEME.navy;
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

    const navLabels = ['商店', '招募', '布阵', '科技', '排行榜'];
    // 晴空乐园统一卡片式 Tab：云白底 + 主题色描边 + 深色字，5 个视觉一致不再花杂。
    // 不再叠加 btn_normal 明黄贴图底框——它与程序化底色叠色导致浑浊方块观感。
    const navDefs = [
      { border: UI_THEME.goldDeep },    // 商店（明黄）
      { border: UI_THEME.skyDeep },     // 招募（天蓝）
      { border: UI_THEME.orangeDeep },  // 布阵（活力橙）
      { border: UI_THEME.navy },        // 科技（海军蓝）
      { border: UI_THEME.sky },         // 排行榜（亮天蓝）
    ];

    for (let i = 0; i < navCount; i++) {
      const x = navStartX + i * (btnW + navGap);
      const rect = { x, y: navY, w: btnW, h: btnH };
      this._drawPressed(rect, gameState.press, () => {
        this._drawRaisedCard(rect, () => {
          ctx.fillStyle = tintOf(navDefs[i].border, 0.13);
          ctx.fillRect(x, navY, btnW, btnH);
          // 边框更清晰：3px 实线主题色 + 1px 白色内描边，双线强化按钮轮廓
          ctx.strokeStyle = navDefs[i].border;
          ctx.lineWidth = 3;
          ctx.strokeRect(x, navY, btnW, btnH);
          ctx.strokeStyle = 'rgba(255,255,255,0.85)';
          ctx.lineWidth = 1;
          ctx.strokeRect(x + 2.5, navY + 2.5, btnW - 5, btnH - 5);
        });
        // 图标加大：正式导航图标 34px（原 28px），上移到 navY+20，文字仍在底部
        this._artIcon(ART_PREFIXES.nav, NAV_ART_KEYS[i], x + btnW / 2, navY + 20, 34, 1);

        ctx.fillStyle = UI_THEME.ink;
        // P10 字号按屏宽自适应：iPhone 5 (320) 10→8；iPhone 6 (375) 维持 10
        ctx.font = `bold ${adaptiveFontSize(10, w)}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(navLabels[i], x + btnW / 2, navY + btnH - 11);

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

    // 背景：接入统一夜景舞台底（P5，与大厅/商店同一套语言，去占位水印）
    this._screenBg();
    const tp = profile || {};
    const techLeftLimit = RenderSystem.headerLeftLimit(
      [tp.gold, tp.diamond, tp.stardust, tp.trophies], w);
    this._screenHeader('科技树', { cy: 25, accent: UI_THEME.gold, leftLimit: techLeftLimit });

    // 星尘等资源已由统一顶部资源栏显示（renderScreen 尾部叠加）

    // 分支标签
    let techConfig = null;
    try { techConfig = ConfigLoader.getSafe('techTree'); } catch(e) {}

    if (!techConfig) {
      ctx.fillStyle = ON_DARK.hint;
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

      // 分支页签：云白卡语言 + 分支色强调；x/tabW/tabY/tabH 几何不动（命中同源）
      this._cardBg({ x, y: tabY, w: tabW, h: tabH, r: 9 }, {
        tint: isSelected ? 'rgba(255,255,255,0.98)' : 'rgba(255,255,255,0.82)',
        border: isSelected ? branch.color : 'rgba(43,74,111,0.18)',
        edge: isSelected ? branch.color : null,
        edgeSide: 'top',
      });

      ctx.fillStyle = isSelected ? UI_THEME.ink : UI_THEME.navySoft;
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

      // 节点背景：云白卡语言；未解锁用更淡的弱面（对比度修复，深底浅字在白卡不可读）。
      // 分支色作为边框/等级条强调保留，几何（x/y/nodeW/nodeH）与命中同源不变。
      this._cardBg({ x, y, w: nodeW, h: nodeH, r: 10 }, {
        tint: !hasPrereq ? 'rgba(234,242,250,0.72)' : (isMax ? 'rgba(255,255,255,0.98)' : 'rgba(255,255,255,0.94)'),
        border: !hasPrereq ? 'rgba(43,74,111,0.12)' : (level > 0 || isMax ? branch.color : 'rgba(43,74,111,0.22)'),
        edge: isMax ? UI_THEME.green : (level > 0 ? branch.color : null),
        edgeSide: 'left',
      });

      // 节点名
      ctx.fillStyle = !hasPrereq ? UI_THEME.navySoft : (isMax ? UI_THEME.green : UI_THEME.ink);
      ctx.font = 'bold 12px sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillText(node.name, x + 5, y + 5);

      // 描述
      ctx.fillStyle = !hasPrereq ? 'rgba(43,74,111,0.42)' : UI_THEME.navy;
      ctx.font = '9px sans-serif';
      ctx.fillText(node.description, x + 5, y + 22);

      // 等级条
      const barY = y + 38;
      const barW = nodeW - 10;
      const barH2 = 6;
      ctx.fillStyle = 'rgba(43,74,111,0.12)';
      ctx.fillRect(x + 5, barY, barW, barH2);
      ctx.fillStyle = isMax ? UI_THEME.green : branch.color;
      ctx.fillRect(x + 5, barY, barW * (level / node.maxLevel), barH2);

      // 等级文字
      ctx.fillStyle = isMax ? UI_THEME.green : (level > 0 ? UI_THEME.navy : UI_THEME.navySoft);
      ctx.font = '9px sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText('Lv.' + level + '/' + node.maxLevel, x + 5, y + 48);

      // 消耗
      if (!isMax && hasPrereq) {
        ctx.fillStyle = canAfford ? UI_THEME.goldDeep : '#C0394B';
        ctx.font = '9px sans-serif';
        ctx.textAlign = 'right';
        ctx.fillText('⭐' + nextCost, x + nodeW - 5, y + 48);
      } else if (!hasPrereq) {
        const prereqNode = branch.nodes.find(n => n.id === node.prerequisite.node);
        ctx.fillStyle = 'rgba(43,74,111,0.7)';
        ctx.font = '8px sans-serif';
        ctx.textAlign = 'right';
        ctx.fillText('需' + (prereqNode?.name || '?') + node.prerequisite.level + '级', x + nodeW - 5, y + 48);
      } else {
        ctx.fillStyle = UI_THEME.green;
        ctx.font = 'bold 9px sans-serif';
        ctx.textAlign = 'right';
        ctx.fillText('MAX', x + nodeW - 5, y + 48);
      }

      // 可升级标记
      if (hasPrereq && !isMax && canAfford) {
        ctx.fillStyle = UI_THEME.green;
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

      // 战斗特效贴图：按 damage / explosion / arrow 与暴击标记选 combat 光效
      // arrow 特效只有 fromX/fromY，没有 x/y → 统一兜底，避免 NaN 坐标
      const _fx = Number.isFinite(e.x) ? e.x : (Number.isFinite(e.fromX) ? e.fromX : 0);
      const _fy = Number.isFinite(e.y) ? e.y : (Number.isFinite(e.fromY) ? e.fromY : 0);
      const _fxType = e.type === 'explosion' ? 'flash'
        : e.type === 'arrow' ? 'knockback' : 'hit';
      this._art(pick_combatFx(_fxType, !!e.crit), _fx - 24, _fy - 24, 48, 48, { alpha: 0.28 });
      if (e.type === 'build') this._art(pick_buildBeam(), _fx - 12, _fy - 48, 24, 48, { alpha: 0.22 });
      if (e.type === 'territory') this._art(pick_territoryWave(), _fx - 32, _fy - 32, 64, 64, { alpha: 0.22 });
      this._art(pick_ambient(), _fx - 16, _fy - 16, 32, 32, { alpha: 0.08 });

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

    // 背景：接入统一夜景舞台底（P3 去占位水印，与大厅/布阵/招募同一套语言）
    this._screenBg();
    const gp = gameState.profile || {};
    const shopLeftLimit = RenderSystem.headerLeftLimit(
      [gp.gold, gp.diamond, gp.stardust, gp.trophies], w);
    this._screenHeader('商店', { cy: 25, accent: UI_THEME.gold, leftLimit: shopLeftLimit });

    // 货币已由统一顶部资源栏显示（renderScreen 尾部叠加）

    // 分类标签（P37：含「免费」分页，宽度自适应）
    // 视觉改用统一页签（明黄选中 + 云白未选），但 tx/tabW/tabY/tabH 几何与 Game 命中保持同源不变。
    const items = gameState.shopItems || [];
    const L = RenderSystem.shopLayout(w, items.length);
    const tabRect = { x: L.tabStartX, y: L.tabY, w: L.tabW * items.length + L.tabGap * (items.length - 1), h: L.tabH };
    if (items.length > 0) {
      this._tabs(tabRect, items.map(it => it.categoryName), gameState.shopTab || 0, { accent: UI_THEME.gold });
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

      // 卡片背景：统一云白厚底（P3）；免费栏顶部加明黄亮条区分。
      // 注意：描边文案颜色不进行任何改动——P37 测试守护免费按钮的蓝色 #3b82f6 语义。
      const active = item.canAfford && item.remaining !== 0;
      this._cardBg({ x: cardX, y: iy, w: itemW, h: itemH, r: 10 }, {
        tint: item.isFree ? 'rgba(255,255,255,0.97)' : 'rgba(255,255,255,0.92)',
        border: active ? 'rgba(255,210,63,0.45)' : 'rgba(43,74,111,0.16)',
        edge: item.isFree && active ? UI_THEME.gold : null,
        edgeSide: 'top',
      });

      // ============ P37 免费栏位 ============
      // 云白卡上文字改深色三级（深底浅字在白卡不可读）；按钮沿用云白次级体系。
      if (item.isFree) {
        ctx.fillStyle = item.exhausted ? UI_THEME.navySoft : UI_THEME.ink;
        ctx.font = 'bold 13px sans-serif';
        ctx.fillText(item.name, cardX + 8, iy + 8);

        // 单次奖励
        const rwText = Object.entries(item.reward || {}).map(([k, v]) => {
          const icons = { diamond: '✧', gold: '◆', stardust: '✦' };
          return `${icons[k] || k}+${v}`;
        }).join(' ');
        ctx.fillStyle = UI_THEME.goldDeep;
        ctx.font = 'bold 12px sans-serif';
        ctx.fillText(`每次 ${rwText}`, cardX + 8, iy + 28);

        // 可领次数 + 领取规则
        ctx.fillStyle = item.exhausted ? UI_THEME.navySoft : UI_THEME.navy;
        ctx.font = '10px sans-serif';
        const ruleText = item.exhausted
          ? '今日已领完，明日再来'
          : (item.needAd ? '观看广告后领取' : '首次直接领取，无需广告');
        ctx.fillText(`还可领 ${item.dailyRemaining} 次 · ${ruleText}`, cardX + 8, iy + 48);

        // 右上：已领 / 上限
        ctx.fillStyle = UI_THEME.navySoft;
        ctx.font = '10px sans-serif';
        ctx.textAlign = 'right';
        // 计数挪到按钮左缘外侧：原右对齐到卡片右缘会压在领取按钮上（白卡下暴露）
        ctx.fillText(`已领 ${item.dailyClaimed}/${item.dailyLimit}`, cardX + itemW - btnW - 20, iy + 8);
        ctx.textAlign = 'left';

        // 免费按钮：并入云白/深蓝的次级按钮体系；非首次用正式广告图标提示需看广告
        if (!item.exhausted) {
          const bx = cardX + itemW - btnW - 10;
          const by = iy + 10;
          this._cardBg({ x: bx, y: by, w: btnW, h: btnH, r: 8 }, {
            tint: 'rgba(214,238,251,0.96)',
            border: 'rgba(43,74,111,0.32)',
          });
          ctx.fillStyle = UI_THEME.navy;
          ctx.font = 'bold 11px sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          if (item.needAd && !this._artIcon(ART_PREFIXES.state, 'ad', bx + 13, by + btnH / 2, 13, 1)) {
            ctx.fillText('▶', bx + 13, by + btnH / 2 + 1);
          }
          ctx.fillText('免费', bx + btnW / 2 + (item.needAd ? 7 : 0), by + btnH / 2 + 1);
          ctx.textAlign = 'left';
          ctx.textBaseline = 'top';
        }
        continue;
      }

      // ============ 普通商品 ============
      // 名称
      ctx.fillStyle = item.canAfford ? UI_THEME.ink : UI_THEME.navySoft;
      ctx.font = 'bold 13px sans-serif';
      ctx.fillText(item.name, cardX + 8, iy + 8);

      // 描述
      if (item.desc) {
        ctx.fillStyle = UI_THEME.navySoft;
        ctx.font = '10px sans-serif';
        ctx.fillText(item.desc, cardX + 8, iy + 28);
      }

      // 价格
      const costText = Object.entries(item.cost).map(([k, v]) => {
        const icons = { diamond: '✧', gold: '◆', stardust: '✦', realMoney: '¥' };
        return `${icons[k] || k}${v}`;
      }).join(' ');
      ctx.fillStyle = item.canAfford ? UI_THEME.goldDeep : UI_THEME.navySoft;
      ctx.font = 'bold 12px sans-serif';
      ctx.fillText(costText, cardX + 8, iy + 48);

      // 限购
      if (item.limit > 0) {
        ctx.fillStyle = UI_THEME.navySoft;
        ctx.font = '10px sans-serif';
        ctx.textAlign = 'right';
        ctx.fillText(`${item.remaining >= 0 ? item.remaining : '∞'}/${item.limit}`, cardX + itemW - btnW - 20, iy + 8);
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

    // 商品较少时（如免费页仅 2 件），下方补非交互说明卡填充空区，避免下半屏纯空夜景。
    // 只画提示不影响任何命中（不占商品索引、不响应点击）。
    if (cat.items.length > 0 && cat.items.length <= 3) {
      const emptyY = startY + cat.items.length * (itemH + gap) + 8;
      if (emptyY < h - 90) {
        const eh = 96;
        this._cardBg({ x: cardX, y: emptyY, w: itemW, h: eh, r: 12 }, {
          r: 12, tint: 'rgba(234,248,255,0.82)', border: 'rgba(43,74,111,0.16)', flat: true,
        });
        this._artIcon(ART_PREFIXES.shopCat, 'item', cardX + itemW / 2, emptyY + 30, 24, 0.85);
        ctx.fillStyle = UI_THEME.navy;
        ctx.font = 'bold 12px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('更多商品陆续上架', cardX + itemW / 2, emptyY + 58);
        ctx.fillStyle = UI_THEME.navySoft;
        ctx.font = '10px sans-serif';
        ctx.fillText('每日免费福利记得领取', cardX + itemW / 2, emptyY + 76);
        ctx.textBaseline = 'alphabetic';
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
    // 纵向下移 6px：云白卡有 4px 厚底投影，标题胶囊下沿到卡顶需要留出呼吸位
    const ownedY = 64;
    const progressW = Math.min(280, w - 60);
    const progressX = (w - progressW) / 2;
    const progressY = 76;
    const pityTextY = 100;
    const pityBarY = 110;
    // 概率卡下移 10px：与上方图鉴卡留出卡片间隙（云白厚底卡需要呼吸位）
    const rateTitleY = 144;
    const rateStartY = 166;

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
    // 起点 68：首行 y=90 ≥ 裁剪 topY=88，避免云白卡顶边与文字被裁（P7 修复）
    const dailyHeaderY = 68 - scrollY;
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
    // 起点 68：与任务屏一致，首行 y=90 ≥ 裁剪 topY=88（P7 修复）
    const headerY = 68 - scrollY;
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
    // 一键领取：明黄主按钮（几何 rect 由 layout 给出，与 Game 命中同源，不动）
    this._cardBg({ x: rect.x, y: rect.y, w: rect.w, h: rect.h, r: 10 }, {
      tint: UI_THEME.gold, border: UI_THEME.goldDeep, flat: true,
    });
    ctx.fillStyle = UI_THEME.ink;
    ctx.font = 'bold 12px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('一键领取', rect.x + rect.w / 2, rect.y + rect.h / 2);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
  }

  /**
   * 绘制单个任务/成就条目（每日/每周/赛季/成就共用）
   * @param {string} accent 主题色（边框/领取按钮）
   */
  _drawQuestItem(ctx, item, y, itemW, itemH, accent) {
    // 任务/成就条目：云白卡 + 深色三级文字；可领取态左侧亮条。
    // 行几何（20/y/itemW/itemH）与领取按钮（右下 60×30）均与 Game 命中同源，绝不改动。
    const canClaim = item.complete && !item.claimed;
    this._cardBg({ x: 20, y, w: itemW, h: itemH, r: 10 }, {
      tint: item.claimed ? 'rgba(234,242,250,0.78)' : 'rgba(255,255,255,0.94)',
      border: canClaim ? accent : 'rgba(43,74,111,0.16)',
      edge: canClaim ? accent : null,
      edgeSide: 'left',
    });

    ctx.fillStyle = item.claimed ? UI_THEME.navySoft : UI_THEME.ink;
    ctx.font = '12px sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    this._fitText(String(item.desc || ''), 28, y + 6, itemW - 84, 12);

    // 进度
    ctx.fillStyle = UI_THEME.navy;
    ctx.font = '10px sans-serif';
    ctx.fillText(`进度: ${Math.min(item.progress, item.target)}/${item.target}`, 28, y + 24);

    // 奖励
    const rewardText = Object.entries(item.reward || {}).map(([k, v]) => {
      const icons = { gold: '◆', diamond: '✧', stardust: '✦' };
      return `${icons[k] || k}+${v}`;
    }).join(' ');
    ctx.fillStyle = UI_THEME.goldDeep;
    ctx.font = '10px sans-serif';
    ctx.fillText(rewardText, 28, y + 40);

    // 领取按钮 / 已领（几何不变，视觉改云白按钮 + 深色字，accent 作描边）
    if (canClaim) {
      this._cardBg({ x: 20 + itemW - 70, y: y + 10, w: 60, h: 30, r: 8 }, {
        tint: 'rgba(255,255,255,0.96)', border: accent, flat: true,
      });
      ctx.fillStyle = UI_THEME.ink;
      ctx.font = 'bold 11px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('领取', 20 + itemW - 40, y + 25);
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
    } else if (item.claimed) {
      ctx.fillStyle = UI_THEME.navySoft;
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

    // 背景：接入统一夜景舞台底（P7，去占位水印）
    this._screenBg();
    const qp = gameState.profile || {};
    const qLeftLimit = RenderSystem.headerLeftLimit(
      [qp.gold, qp.diamond, qp.stardust, qp.trophies], w);
    this._screenHeader('任务', { cy: 25, accent: '#06B6D4', leftLimit: qLeftLimit });

    const layout = RenderSystem.questLayout(
      gameState.dailyQuests || [], gameState.weeklyQuests || [], gameState.seasonQuests || [],
      gameState.metaScrollY || 0, w
    );
    const { itemW, itemH } = layout;

    // 一键领取（每日+每周+赛季）
    this._drawClaimAllButton(ctx, layout.claimAllRect);

    // 裁剪：任务列表只在返回按钮/一键领取以下区域显示
    this._beginScrollClip(ctx, w, h, 88);

    // 每日任务（分类标题在夜景底上：正式图标 + ON_DARK 浅色文字，几何不变）
    const drawCatTitle = (iconName, label, y, color) => {
      this._artIcon(ART_PREFIXES.quest, iconName, 27, y + 9, 16, 0.95);
      ctx.fillStyle = color;
      ctx.font = 'bold 14px sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillText(label, 40, y);
    };
    drawCatTitle('daily', '每日任务', layout.dailyHeaderY, '#67E8F9');

    (gameState.dailyQuests || []).forEach((q, i) => {
      const { y } = layout.dailyRects[i];
      if (y + itemH < 0 || y > h) return;
      this._drawQuestItem(ctx, q, y, itemW, itemH, '#06b6d4');
    });

    // 每周任务
    drawCatTitle('weekly', '每周任务', layout.weeklyHeaderY, ON_DARK.green);

    (gameState.weeklyQuests || []).forEach((q, i) => {
      const { y } = layout.weeklyRects[i];
      if (y + itemH < 0 || y > h) return;
      this._drawQuestItem(ctx, q, y, itemW, itemH, '#10b981');
    });

    // 赛季任务
    drawCatTitle('season', '赛季任务', layout.seasonHeaderY, '#DDD6FE');

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

    // 背景：接入统一夜景舞台底（P7，去占位水印）
    this._screenBg();
    const ap = gameState.profile || {};
    const aLeftLimit = RenderSystem.headerLeftLimit(
      [ap.gold, ap.diamond, ap.stardust, ap.trophies], w);
    this._screenHeader('成就', { cy: 25, accent: UI_THEME.gold, leftLimit: aLeftLimit });

    const layout = RenderSystem.achievementLayout(
      gameState.achievements || [], gameState.metaScrollY || 0, w
    );
    const { itemW, itemH } = layout;

    // 一键领取
    this._drawClaimAllButton(ctx, layout.claimAllRect);

    // 裁剪：成就列表只在返回按钮/一键领取以下区域显示
    this._beginScrollClip(ctx, w, h, 88);

    ctx.fillStyle = UI_THEME.gold;
    ctx.font = 'bold 14px sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText('成就', 20, layout.headerY);

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

    // 背景：接入统一夜景舞台底（P6，去占位水印）
    this._screenBg();
    const bp = gameState.profile || {};
    const bpLeftLimit = RenderSystem.headerLeftLimit(
      [bp.gold, bp.diamond, bp.stardust, bp.trophies], w);
    this._screenHeader('通行证', { cy: 25, accent: '#EC4899', leftLimit: bpLeftLimit });

    // 赛季卡：标题 + Lv 胶囊 + EXP 进度条（几何避开右侧一键领取按钮）
    const claimX = w - 120, claimY = 50;
    this._statStrip({ x: 16, y: 52, w: w - 32 - 8, h: 48 }, {
      title: status.seasonName || '赛季',
      level: `Lv${status.level || 0}/${status.maxLevel || 50}`,
      ratio: (status.exp || 0) / (status.expPerLevel || 100),
      ratioText: `EXP ${status.exp || 0}/${status.expPerLevel || 100}${status.premium ? ' · 高级' : ''}`,
      color: '#EC4899',
    });

    // 一键领取按钮：几何 claimX/claimY/100×32 与 Game 命中同源，不动；视觉改明黄主按钮
    this._cardBg({ x: claimX, y: claimY, w: 100, h: 32, r: 10 }, {
      tint: UI_THEME.gold, border: UI_THEME.goldDeep, flat: true,
    });
    ctx.fillStyle = UI_THEME.ink;
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
    // 列头在夜景底上（不在云白格内），用 ON_DARK 浅色保证对比
    ctx.textBaseline = 'top';
    ctx.font = 'bold 10px sans-serif';
    // 列头下移到赛季卡（底 100）下方，避免浅色字压在白卡下沿发虚
    ctx.fillStyle = '#22D3EE';
    ctx.fillText('免费轨道', colFreeX + cellW / 2, startY - 10);
    ctx.fillStyle = UI_THEME.gold;
    ctx.fillText('高级轨道', colPremX + cellW / 2, startY - 10);

    for (let i = 0; i < rewards.length; i++) {
      const r = rewards[i];
      const ry = startY + i * (rowH + rowGap);
      if (ry + rowH < 100 || ry > h) continue;

      // 等级标签：右对齐避免被左缘裁切；夜景底上用 ON_DARK 浅色
      ctx.fillStyle = r.unlocked ? '#F472B6' : ON_DARK.hint;
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
    // 奖励格 4 态：云白卡语言 + 深色文字；四态语义靠描边/顶条/弱面区分。
    // 几何（x/y/w/h）与 Game 领取命中同源，绝不改动。
    const claimable = !!reward.claimable;
    this._cardBg({ x, y, w, h, r: 8 }, {
      tint: locked ? 'rgba(226,236,246,0.72)' : (claimable ? 'rgba(255,255,255,0.98)' : 'rgba(255,255,255,0.88)'),
      border: claimable ? color : (reward.claimed ? 'rgba(43,74,111,0.10)' : 'rgba(43,74,111,0.18)'),
      edge: claimable ? color : null,
      edgeSide: 'top',
      flat: true,
    });

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '10px sans-serif';
    if (locked) {
      ctx.fillStyle = 'rgba(43,74,111,0.5)';
      ctx.fillText('需高级', x + w / 2, y + h / 2);
      return;
    }
    if (reward.claimed) {
      ctx.fillStyle = UI_THEME.navySoft;
      ctx.fillText('✓ 已领取', x + w / 2, y + h / 2);
      return;
    }

    const rewardText = Object.entries(reward.reward || {}).map(([k, v]) => {
      const icons = { gold: '◆', diamond: '✧', stardust: '✦' };
      return `${icons[k] || k}+${v}`;
    }).join(' ');
    ctx.fillStyle = claimable ? UI_THEME.ink : UI_THEME.navySoft;
    ctx.font = claimable ? 'bold 10px sans-serif' : '10px sans-serif';
    ctx.fillText(rewardText, x + w / 2, y + h / 2);
  }

  // ==================== 排行榜面板（Phase 5） ====================
  drawLeaderboard(gameState) {
    const { ctx } = this;
    const w = this.screenWidth;
    const h = this.screenHeight;

    // 背景：接入统一夜景舞台底（P8，去占位水印）
    this._screenBg();
    const lp = gameState.profile || {};
    const lbLeftLimit = RenderSystem.headerLeftLimit(
      [lp.gold, lp.diamond, lp.stardust, lp.trophies], w);
    this._screenHeader('排行榜', { cy: 25, accent: UI_THEME.gold, leftLimit: lbLeftLimit });

    // 榜单标签（与 handleLeaderboardClick 命中框一致；tabW/tabH/tabGap/tabY/tabStartX 几何不动）
    const boards = gameState.leaderboardBoards || [];
    const tabCount = Math.min(boards.length, 4);
    const tabW = 80, tabH = 30, tabGap = 8;
    const tabStartX = (w - (tabCount * tabW + (tabCount - 1) * tabGap)) / 2;
    const tabY = 55;
    for (let i = 0; i < tabCount; i++) {
      const x = tabStartX + i * (tabW + tabGap);
      const active = gameState.leaderboardTab === i;
      this._cardBg({ x, y: tabY, w: tabW, h: tabH, r: 9 }, {
        tint: active ? 'rgba(255,244,214,0.98)' : 'rgba(255,255,255,0.78)',
        border: active ? UI_THEME.gold : 'rgba(43,74,111,0.16)',
        edge: active ? UI_THEME.gold : null,
        edgeSide: 'top',
        flat: true,
      });
      ctx.fillStyle = active ? UI_THEME.ink : UI_THEME.navySoft;
      ctx.font = 'bold 11px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(boards[i].label, x + tabW / 2, tabY + tabH / 2);
    }

    // 榜单数据
    const data = gameState.leaderboardData;
    if (!data || data.entries.length === 0) {
      ctx.fillStyle = ON_DARK.hint;
      ctx.font = '13px sans-serif';
      ctx.textAlign = 'center';
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

      // 榜单行：云白卡 + 深色文字；前三金银铜章、自己行明黄竖条
      const medalFill = i === 0 ? '#FFD23F' : (i === 1 ? '#C0C8D0' : (i === 2 ? '#D9884A' : null));
      const rankColor = i < 3 ? '#5A3E00' : UI_THEME.navySoft;
      this._cardBg({ x: 16, y: y - rowH / 2 + 1, w: w - 32, h: rowH - 2, r: 8 }, {
        tint: e.isPlayer ? 'rgba(255,244,214,0.98)' : 'rgba(255,255,255,0.92)',
        border: e.isPlayer ? UI_THEME.gold : 'rgba(43,74,111,0.12)',
        edge: e.isPlayer ? UI_THEME.gold : null,
        edgeSide: 'left',
        flat: true,
      });
      // 名次：前三加金银铜圆章（名次数字位置不变，只加承载底）
      if (medalFill) {
        const mc = 26, mx = 20, my = y - mc / 2;
        if (typeof ctx.arc === 'function') {
          ctx.save();
          ctx.beginPath();
          ctx.arc(mx + mc / 2, y, mc / 2, 0, Math.PI * 2);
          ctx.fillStyle = medalFill;
          ctx.fill();
          ctx.strokeStyle = 'rgba(255,255,255,0.75)';
          ctx.lineWidth = 1.5;
          ctx.stroke();
          ctx.restore();
        } else {
          ctx.fillStyle = medalFill;
          ctx.fillRect(mx, my, mc, mc);
        }
      }
      ctx.fillStyle = rankColor;
      ctx.font = 'bold 12px sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(`${i + 1}`, 28, y);
      // 名字
      ctx.fillStyle = e.isPlayer ? UI_THEME.ink : UI_THEME.navy;
      ctx.font = e.isPlayer ? 'bold 12px sans-serif' : '12px sans-serif';
      this._fitText(e.isPlayer ? e.name + '（你）' : e.name, 55, y, w - 55 - 90, 12);
      // 数值
      ctx.fillStyle = e.isPlayer ? UI_THEME.goldDeep : UI_THEME.navySoft;
      ctx.textAlign = 'right';
      ctx.fillText(String(e[metric]) + unit, w - 28, y);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'alphabetic';
    }

    // 玩家排名提示：吸底云白胶囊
    if (data.playerRank > 0) {
      // 胶囊放到返回按钮右侧，避开左下角返回（16..96）：窄屏下也绝不与返回重叠
      const backRight = 16 + 80;
      const tipW = Math.min(240, w - backRight - 24);
      const tipX = backRight + 8 + (w - backRight - 8 - tipW) / 2, tipY = h - 66;
      this._cardBg({ x: tipX, y: tipY, w: tipW, h: 34, r: 17 }, {
        tint: 'rgba(255,244,214,0.98)', border: UI_THEME.gold, flat: true,
      });
      ctx.fillStyle = UI_THEME.orangeDeep;
      ctx.font = 'bold 12px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(`你的排名: 第${data.playerRank}名`, tipX + tipW / 2, tipY + 17);
      ctx.textBaseline = 'alphabetic';
    }

    // 底部说明
    ctx.fillStyle = ON_DARK.hint;
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'center';
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

    // === 如果有抽卡结果，展示结果覆盖层（底图仍走统一骨架，避免暗底闪烁）===
    if (results && results.length > 0) {
      this._screenBg();
      this._drawGachaResult(gameState, results, revealIdx);
      return;
    }

    // === 抽卡主界面 ===
    // P34：统一走 RenderSystem.gachaLayout（与 Game.handleGachaClick 命中框同源）
    const L = RenderSystem.gachaLayout(w, h);

    // 背景 / 标题：晴空乐园统一骨架
    this._screenBg();
    const gProfile = gameState.profile || {};
    const gachaLeftLimit = RenderSystem.headerLeftLimit(
      [gProfile.gold, gProfile.diamond, gProfile.stardust, gProfile.trophies], w);
    this._screenHeader('兵种招募', { cy: L.titleY, accent: '#A855F7', leftLimit: gachaLeftLimit });

    if (!info) {
      ctx.fillStyle = '#64748b';
      ctx.font = '13px sans-serif';
      ctx.fillText('加载中...', w / 2, h / 2);
      return;
    }

    // 资源（💰⭐）已由统一顶部资源栏显示（renderScreen 尾部叠加）

    // === 收集 / 保底卡 ===
    const pityProgress = info.pityCount / info.pityThreshold;
    const collectCard = { x: 12, y: 48, w: w - 24, h: 70, r: 14 };
    this._cardBg(collectCard, { tint: 'rgba(255,255,255,0.95)' });

    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = UI_THEME.ink;
    ctx.font = 'bold 12px sans-serif';
    ctx.fillText('图鉴收集', 24, L.ownedY + 2);
    ctx.textAlign = 'right';
    ctx.fillStyle = '#A855F7';
    ctx.font = 'bold 12px sans-serif';
    ctx.fillText(`${info.ownedUnits}/${info.totalUnits}`, w - 24, L.ownedY + 2);

    // 收集进度条
    ctx.fillStyle = 'rgba(43,74,111,0.14)';
    ctx.fillRect(L.progressX, L.progressY, L.progressW, 6);
    const progress = info.totalUnits > 0 ? info.ownedUnits / info.totalUnits : 0;
    ctx.fillStyle = '#A855F7';
    ctx.fillRect(L.progressX, L.progressY, L.progressW * progress, 6);

    // 保底计数
    ctx.textAlign = 'center';
    ctx.fillStyle = UI_THEME.navy;
    ctx.font = '10px sans-serif';
    ctx.fillText(`保底进度 ${info.pityCount}/${info.pityThreshold} · 必出史诗+`, w / 2, L.pityTextY + 2);

    // 保底进度条
    ctx.fillStyle = 'rgba(43,74,111,0.14)';
    ctx.fillRect(L.progressX, L.pityBarY, L.progressW, 4);
    ctx.fillStyle = pityProgress >= 0.8 ? UI_THEME.orange : '#A855F7';
    ctx.fillRect(L.progressX, L.pityBarY, L.progressW * Math.min(1, pityProgress), 4);

    // === 概率卡（整块居中：名称 | 概率条 | 百分比）===
    const qualityNames = { 1: '普通', 2: '精良', 3: '稀有', 4: '史诗', 5: '传说', 6: '神话' };
    const qualityColors = { 1: '#9CA3AF', 2: '#22C55E', 3: '#3B82F6', 4: '#A855F7', 5: '#F97316', 6: '#EF4444' };
    const rateCardTop = L.rateTitleY - 14;
    const rateCardBottom = L.rateStartY + (info.rates.length - 1) * L.rateStep + 16;
    this._cardBg({ x: 12, y: rateCardTop, w: w - 24, h: rateCardBottom - rateCardTop, r: 14 }, {
      tint: 'rgba(255,255,255,0.95)',
      edge: '#A855F7',
      edgeSide: 'left',
    });
    ctx.fillStyle = UI_THEME.navy;
    ctx.font = 'bold 11px sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText('概率一览', 24, L.rateTitleY);

    for (let i = 0; i < info.rates.length; i++) {
      const r = info.rates[i];
      const ry = L.rateStartY + i * L.rateStep;
      ctx.fillStyle = qualityColors[r.quality];
      ctx.font = 'bold 11px sans-serif';
      ctx.textAlign = 'right';
      ctx.fillText(qualityNames[r.quality], L.rateLabelRightX, ry);
      // 概率条
      ctx.fillStyle = 'rgba(43,74,111,0.12)';
      ctx.fillRect(L.rateBarX, ry - 4, L.rateBarW, 8);
      ctx.fillStyle = qualityColors[r.quality];
      ctx.fillRect(L.rateBarX, ry - 4, L.rateBarW * r.rate, 8);
      ctx.fillStyle = UI_THEME.navy;
      ctx.font = '10px sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText((r.rate * 100).toFixed(0) + '%', L.ratePctX, ry);
    }

    // === 召唤法阵：占位期用代码绘制（正式 BG-02 光柱素材到位后可淡出）===
    {
      const circleTop = rateCardBottom + 8;
      const circleBottom = L.noteY1 - 22;
      // 矮屏（320×568）概率卡底到说明文字只有 ~79px：阈值放到 40、半径下限 18，
      // 让矮屏也能落一个小法阵，否则整段中区空成一片纯渐变。半径上限由可用高度决定，
      // 保证圆环不会压到下方说明文字。
      if (circleBottom - circleTop > 40) {
        const cy = (circleTop + circleBottom) / 2;
        const r = Math.max(18, Math.min(132, (circleBottom - circleTop) / 2 - 4, w * 0.34));
        this._drawSummonCircle(w / 2, cy, r);
      }
    }

    // === 底部说明（P34：移到单抽/十连按钮上方居中）===
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = ON_DARK.hint;
    ctx.font = '10px sans-serif';
    ctx.fillText('重复兵种将转化为招募进度 + 星尘', w / 2, L.noteY1);
    ctx.fillText('保底：每 10 抽必出史诗品质以上兵种', w / 2, L.noteY2);
    ctx.textBaseline = 'alphabetic';

    // === 抽卡按钮 ===
    // 单抽：云白次按钮（海军蓝描边）；十连：明黄→橙主 CTA（付费/消耗主动作）
    const canSingle = info.gold >= info.singleCost;
    this._cardBg({ x: L.singleX, y: L.btnY, w: L.btnW, h: L.btnH, r: 13 }, {
      tint: canSingle ? 'rgba(255,255,255,0.96)' : 'rgba(255,255,255,0.55)',
      border: canSingle ? UI_THEME.navy : 'rgba(43,74,111,0.20)',
    });
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = canSingle ? UI_THEME.ink : 'rgba(43,74,111,0.40)';
    ctx.font = 'bold 14px sans-serif';
    ctx.fillText('单抽 ×1', L.singleX + L.btnW / 2, L.btnY + 17);
    ctx.fillStyle = canSingle ? UI_THEME.orangeDeep : 'rgba(43,74,111,0.35)';
    ctx.font = 'bold 12px sans-serif';
    ctx.fillText('◆ ' + info.singleCost, L.singleX + L.btnW / 2, L.btnY + 36);

    const canMulti = info.gold >= info.multiCost;
    this._primaryButton(
      { x: L.multiX, y: L.btnY, w: L.btnW, h: L.btnH, r: 13 },
      canMulti ? '十连 ×10' : '金币不足',
      { disabled: !canMulti }
    );
    if (canMulti) {
      ctx.fillStyle = '#4A2A00';
      ctx.font = 'bold 12px sans-serif';
      ctx.fillText('◆ ' + info.multiCost, L.multiX + L.btnW / 2, L.btnY + 34);
    }

    // 十连优惠提示（按钮下方，与广告按钮保持间隙）
    ctx.fillStyle = UI_THEME.gold;
    ctx.font = 'bold 10px sans-serif';
    ctx.fillText('9 折优惠 · 保底史诗+', L.multiX + L.btnW / 2, L.discountY);

    // === 激励视频：看广告免费抽 ===
    // 全宽按钮（w-60），仅当 profile.dailyAdWatched 还有配额时启用
    const adCan = info.adsFreeDrawAvailable;
    const adWatched = info.adsFreeDrawWatched || 0;
    const adLimit = info.adsFreeDrawLimit || 1;

    this._cardBg({ x: L.adBtnX, y: L.adBtnY, w: L.adBtnW, h: L.adBtnH, r: 12 }, {
      tint: adCan ? 'rgba(255,255,255,0.96)' : 'rgba(255,255,255,0.55)',
      border: adCan ? UI_THEME.skyDeep : 'rgba(43,74,111,0.20)',
    });
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = adCan ? UI_THEME.skyDeep : 'rgba(43,74,111,0.40)';
    ctx.font = 'bold 13px sans-serif';
    const adLabel = adCan ? '看广告免费抽 ×1' : `今日已用完 (${adWatched}/${adLimit})`;
    const adCy = L.adBtnY + L.adBtnH / 2 - 6;
    if (!this._artIcon(ART_PREFIXES.state, 'ad', L.adBtnX + 30, adCy, 16, adCan ? 1 : 0.5)) {
      ctx.fillText('▶', L.adBtnX + 30, adCy + 1);
    }
    ctx.fillText(adLabel, L.adBtnX + L.adBtnW / 2 + 12, adCy);
    ctx.fillStyle = 'rgba(22,48,79,0.55)';
    ctx.font = '9px sans-serif';
    ctx.fillText(adCan ? '观看完整视频可获得一次免费单抽' : '明天再来', L.adBtnX + L.adBtnW / 2, L.adBtnY + L.adBtnH - 9);
    ctx.textBaseline = 'alphabetic';
  }

  /**
   * 召唤法阵：纯代码绘制的占位主视觉（同心阵 + 旋转符文圈 + 呼吸光晕）。
   * 不使用占位图，避免水印；BG-02 光柱素材正式到位后可由画面自然压过。
   * @param {number} cx @param {number} cy @param {number} r
   */
  _drawSummonCircle(cx, cy, r) {
    const { ctx } = this;
    const t = Date.now() / 1000;
    const pulse = 0.5 + 0.5 * Math.sin(t * 1.6);

    // 呼吸光晕
    if (typeof ctx.createRadialGradient === 'function') {
      const glow = ctx.createRadialGradient(cx, cy, r * 0.15, cx, cy, r * 1.35);
      glow.addColorStop(0, `rgba(168,85,247,${0.16 + pulse * 0.06})`);
      glow.addColorStop(0.55, 'rgba(124,58,237,0.10)');
      glow.addColorStop(1, 'rgba(124,58,237,0)');
      ctx.fillStyle = glow;
      if (typeof ctx.arc === 'function') {
        ctx.beginPath();
        ctx.arc(cx, cy, r * 1.35, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.fillRect(cx - r * 1.35, cy - r * 1.35, r * 2.7, r * 2.7);
      }
    }

    // 外圈：细描边
    ctx.strokeStyle = 'rgba(168,85,247,0.45)';
    ctx.lineWidth = 2;
    if (typeof ctx.arc === 'function') {
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.stroke();
    }

    // 内圈：虚线旋转（用短弧段模拟，兼容无 setLineDash 的基础库）
    const segs = 12;
    const rot = t * 0.35;
    ctx.strokeStyle = 'rgba(124,58,237,0.55)';
    ctx.lineWidth = 3;
    for (let i = 0; i < segs; i++) {
      const a0 = rot + (i * Math.PI * 2) / segs;
      const a1 = a0 + (Math.PI * 2) / segs * 0.55;
      if (typeof ctx.arc !== 'function') break;
      ctx.beginPath();
      ctx.arc(cx, cy, r * 0.82, a0, a1);
      ctx.stroke();
    }

    // 外环光点：6 个绕行法球（旋转方向与外圈反向，制造层次）
    for (let i = 0; i < 6; i++) {
      const a = -rot * 1.6 + (i * Math.PI * 2) / 6;
      const ox = cx + Math.cos(a) * r * 0.66;
      const oy = cy + Math.sin(a) * r * 0.66;
      if (typeof ctx.arc !== 'function') break;
      ctx.beginPath();
      ctx.arc(ox, oy, 2.6 + pulse * 1.2, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(196,132,252,${0.55 + pulse * 0.35})`;
      ctx.fill();
    }

    // 中心徽记：六边形（与地块语言一致）+ 中心星芒
    const hr = r * 0.34;
    // 中心水晶：云白实底 + 紫色内外双描边。半透白在蓝底上会混成灰块，看不出是水晶
    ctx.fillStyle = 'rgba(255,255,255,0.94)';
    ctx.strokeStyle = 'rgba(168,85,247,0.55)';
    ctx.lineWidth = 5;
    if (typeof ctx.beginPath === 'function') {
      ctx.beginPath();
      for (let i = 0; i < 6; i++) {
        const a = -Math.PI / 2 + (i * Math.PI) / 3;
        const px = cx + Math.cos(a) * hr;
        const py = cy + Math.sin(a) * hr;
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      // 内描边：让水晶边缘从柔光里“立”起来
      ctx.strokeStyle = 'rgba(124,58,237,0.85)';
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    ctx.fillStyle = `rgba(124,58,237,${0.75 + pulse * 0.25})`;
    ctx.font = 'bold 26px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('✦', cx, cy + 1);
    ctx.textBaseline = 'alphabetic';
  }

  /**
   * 绘制抽卡结果展示
   */
  _drawGachaResult(gameState, results, revealIdx) {
    const { ctx } = this;
    const w = this.screenWidth;
    const h = this.screenHeight;

    // 全屏遮罩：海军蓝半透明，比纯黑更贴晴空乐园的冷色调
    ctx.fillStyle = 'rgba(6,14,28,0.72)';
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
    // 品质光晕/十连指示器/摘要底板：占位素材自带边框与文案，压在结果卡四周会形成脏框，
    // 故抽卡演出统一先走代码绘制（径向光晕 + 圆点指示），BG-02 演出素材到位后再接回来。
    const color = qualityColors[current.quality] || '#9ca3af';
    const glow = qualityGlow[current.quality] || 'rgba(156,163,175,0.3)';

    // 光晕背景
    const glowGrad = ctx.createRadialGradient(w / 2, cardY + cardH / 2, 30, w / 2, cardY + cardH / 2, 200);
    glowGrad.addColorStop(0, glow);
    glowGrad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = glowGrad;
    ctx.fillRect(0, 0, w, h);

    // 结果卡：云白厚底 + 品质外缘（品质色不再铺满卡面）
    this._cardBg({ x: cardX, y: cardY, w: cardW, h: cardH, r: 16 }, {
      tint: 'rgba(255,255,255,0.97)',
      border: color,
      edge: color,
      edgeSide: 'top',
    });

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
    ctx.fillStyle = current.isNew ? UI_THEME.ink : 'rgba(22,48,79,0.55)';
    ctx.font = 'bold 18px sans-serif';
    ctx.fillText(current.name, w / 2, cardY + 140);

    // 新获得 / 重复（emoji 换正式状态图标，无贴图时退化为纯符号）
    if (current.isNew) {
      const badgeX = w / 2 - 46;
      ctx.fillStyle = UI_THEME.green;
      ctx.font = 'bold 14px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      if (!this._artIcon(ART_PREFIXES.state, 'skill', badgeX, cardY + 165, 13, 1)) {
        ctx.fillText('✦', badgeX, cardY + 165);
      }
      ctx.fillText('新兵种解锁！', w / 2 + 8, cardY + 165);
    } else {
      // 重复转化奖励
      const dr = current.duplicateReward;
      if (dr) {
        const badgeX = w / 2 - 46;
        ctx.fillStyle = UI_THEME.orangeDeep;
        ctx.font = '12px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        if (!this._artIcon(ART_PREFIXES.state, 'stardust', badgeX, cardY + 160, 13, 1)) {
          ctx.fillText('↻', badgeX, cardY + 160);
        }
        ctx.fillText('重复转化', w / 2 + 8, cardY + 160);
        ctx.fillStyle = UI_THEME.navy;
        ctx.font = '11px sans-serif';
        ctx.fillText(`招募进度 +${dr.recruit}  ✦+${dr.stardust}`, w / 2, cardY + 178);
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
        ctx.fillStyle = i <= revealIdx ? color : 'rgba(255,255,255,0.35)';
        ctx.beginPath();
        ctx.arc(dx + dotSize / 2, dotsY + dotSize / 2, dotSize / 2, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // 点击提示
    ctx.fillStyle = 'rgba(255,255,255,0.80)';
    ctx.font = '13px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    if (isLast) {
      ctx.fillText('▼ 点击关闭 ▼', w / 2, h - 50);
    } else {
      ctx.fillText(`点击继续 (${revealIdx + 1}/${results.length})`, w / 2, h - 50);
    }
  }

  /**
   * 异步对战匹配等待弹窗：接入 ModalShell 云白皮肤，几何由 matchOverlayLayout 单一真相源提供。
   * 只画视觉；取消命中由 Game 端读取同一份 layout，二者永不漂移。
   */
  drawMatchOverlay() {
    const { ctx } = this;
    const { panel, cancelBtn } = RenderSystem.matchOverlayLayout(this.screenWidth, this.screenHeight);

    ctx.fillStyle = 'rgba(6,14,28,0.62)';
    ctx.fillRect(0, 0, this.screenWidth, this.screenHeight);
    this._modalShell(panel, null, '异步对战匹配', { showClose: false });

    // 检索动效：明黄旋转环 + 正式战斗图标（无贴图环境退化为 ⚔ 字符）
    const cx = this.screenWidth / 2;
    const cy = panel.y + 82;
    const a0 = (Date.now() / 520) % (Math.PI * 2);
    if (typeof ctx.arc === 'function') {
      ctx.save();
      ctx.strokeStyle = 'rgba(43,74,111,0.16)';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(cx, cy, 22, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = UI_THEME.gold;
      ctx.beginPath();
      ctx.arc(cx, cy, 22, a0, a0 + Math.PI * 0.75);
      ctx.stroke();
      ctx.restore();
    }
    if (!this._artIcon(ART_PREFIXES.hud, 'battle', cx, cy, 26, 1)) {
      ctx.fillStyle = UI_THEME.navy;
      ctx.font = 'bold 20px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('⚔', cx, cy + 1);
    }

    // 检索状态（不显示倒计时/等待秒数/超时信息；超时降级由 Game._fallbackToAI 自动处理）
    const dots = '.'.repeat(1 + Math.floor((Date.now() / 400) % 3));
    ctx.fillStyle = UI_THEME.ink;
    ctx.font = 'bold 15px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`正在检索实力相近的对手${dots}`, cx, panel.y + 121);
    ctx.fillStyle = UI_THEME.navySoft;
    ctx.font = '12px sans-serif';
    ctx.fillText('通常几秒内即可开战', cx, panel.y + 148);
    ctx.textBaseline = 'alphabetic';

    this._secondaryButton(cancelBtn, '取消');
  }

  /**
   * 统一覆盖层皮肤 ModalShell（P9）：云白厚底面板 + 顶部明黄强调条 + 标题 + 圆形关闭钮。
   * 只画「容器 + 标题 + 关闭钮」，行/按钮仍由各覆盖层按原几何自绘；几何一律由调用方
   * 从 Game 的同源 Layout 常量传入，因此点击命中完全不变（改造红线：只换视觉容器）。
   * 在老基础库（无 arcTo）上会退化为直角面板 + 方钮，绝不抛错。
   * @param {{x:number,y:number,w:number,h:number}} panel 面板矩形
   * @param {{x:number,y:number,w:number,h:number}} closeRect 关闭按钮矩形
   * @param {string} title 标题文字
   * @param {{iconPrefix?:string, iconName?:string, accent?:string, showClose?:boolean}} [opts]
   */
  _modalShell(panel, closeRect, title, opts) {
    const { ctx } = this;
    const o = opts || {};
    const accent = o.accent || UI_THEME.gold;

    // 云白厚底面板（复用主内容卡语言：厚底 + 柔光 + 描边）
    this._cardBg(panel, {
      r: 18,
      tint: 'rgba(255,255,255,0.98)',
      border: 'rgba(43,74,111,0.28)',
    });

    // 顶部强调条（面板宽度内的圆角明黄短条，居左上）
    if (typeof ctx.arcTo === 'function') {
      ctx.save();
      ctx.fillStyle = accent;
      this._roundRectPath(panel.x + 18, panel.y + 0, Math.min(64, panel.w - 72), 4, 2);
      ctx.fill();
      ctx.restore();
    } else {
      ctx.fillStyle = accent;
      ctx.fillRect(panel.x + 18, panel.y, Math.min(64, panel.w - 72), 4);
    }

    // 标题：可选正式图标 + 深色文字（不再用 emoji）
    const titleY = panel.y + 28;
    if (o.iconPrefix && o.iconName) {
      this._artIcon(o.iconPrefix, o.iconName, panel.x + 32, titleY, 18, 0.95);
      ctx.fillStyle = UI_THEME.ink;
      ctx.font = 'bold 17px sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(title, panel.x + 46, titleY);
    } else {
      ctx.fillStyle = UI_THEME.ink;
      ctx.font = 'bold 17px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(title, panel.x + panel.w / 2, titleY);
    }

    // 圆形关闭钮：云白底 + 海军蓝描边 + 深蓝 ✕（不用红方块）
    // 无关闭语义的模态（如匹配等待）可传 showClose:false，避免画出一个不可点的假按钮。
    if (closeRect && o.showClose !== false) {
      const cx = closeRect.x + closeRect.w / 2;
      const cy = closeRect.y + closeRect.h / 2;
      const cr = Math.min(closeRect.w, closeRect.h) / 2;
      if (typeof ctx.arc === 'function') {
        ctx.save();
        ctx.beginPath();
        ctx.arc(cx, cy, cr, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(214,238,251,0.95)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(43,74,111,0.35)';
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.restore();
      } else {
        ctx.fillStyle = 'rgba(214,238,251,0.95)';
        ctx.fillRect(closeRect.x, closeRect.y, closeRect.w, closeRect.h);
      }
      ctx.fillStyle = UI_THEME.navy;
      ctx.font = 'bold 14px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('✕', cx, cy + 1);
      ctx.textBaseline = 'alphabetic';
    }
  }

  /**
   * 覆盖层开关行：云白卡底 + 左侧图标/文字 + 右侧胶囊 toggle。几何由调用方传入。
   * @param {{x,y,w,h}} rect 行矩形（Game.settingsRowRect）
   * @param {string} label 标签文字
   * @param {boolean} on 开关状态
   * @param {{iconPrefix?:string,iconName?:string}} [opts]
   */
  _modalToggleRow(rect, label, on, opts) {
    const { ctx } = this;
    const o = opts || {};
    this._cardBg(rect, { r: 12, tint: 'rgba(234,248,255,0.96)', border: 'rgba(43,74,111,0.2)' });

    const iconSize = 18;
    const textX = rect.x + (o.iconPrefix && o.iconName ? 42 : 16);
    if (o.iconPrefix && o.iconName) {
      this._artIcon(o.iconPrefix, o.iconName, rect.x + 24, rect.y + rect.h / 2, iconSize, 0.95);
    }
    ctx.fillStyle = UI_THEME.ink;
    ctx.font = 'bold 14px sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, textX, rect.y + rect.h / 2);

    // 右侧胶囊 toggle：开=明黄填充+深棕字，关=灰蓝描边+弱字
    const pillW = 56;
    const pill = { x: rect.x + rect.w - pillW - 14, y: rect.y + (rect.h - 26) / 2, w: pillW, h: 26 };
    if (typeof ctx.arcTo === 'function') {
      ctx.save();
      this._roundRectPath(pill.x, pill.y, pill.w, pill.h, 13);
      ctx.fillStyle = on ? UI_THEME.gold : 'rgba(214,238,251,0.9)';
      ctx.fill();
      ctx.strokeStyle = on ? UI_THEME.orangeDeep : 'rgba(43,74,111,0.3)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.restore();
    } else {
      ctx.fillStyle = on ? UI_THEME.gold : 'rgba(214,238,251,0.9)';
      ctx.fillRect(pill.x, pill.y, pill.w, pill.h);
    }
    ctx.fillStyle = on ? '#4A2A00' : UI_THEME.navySoft;
    ctx.font = 'bold 12px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(on ? '开启' : '关闭', pill.x + pill.w / 2, pill.y + pill.h / 2 + 1);
    ctx.textBaseline = 'alphabetic';
  }

  _drawBackButton(ctx) {
    // 返回按钮统一放左下角（距左 16、距底 16），便于单手操作；顶部留给资源栏（左上角）
    const h = this.screenHeight;
    const { x: bx, w: bw, h: bh, bottom } = BACK_BTN;
    const by = h - bottom - bh;
    // 已接入晴空乐园骨架的界面：云白厚底 + 海军蓝文字，与内容卡同一套语言。
    // 占位期的 UI-08 返回按钮是深色水印图，压在浅色界面上会形成脏块，故不走贴图。
    if (SHELL_SCREENS.has(this._curScreen)) {
      const pressed = !!this._backPressed;
      this._cardBg({ x: bx, y: by, w: bw, h: bh, r: 12 }, {
        tint: pressed ? 'rgba(255,255,255,0.70)' : 'rgba(255,255,255,0.95)',
        border: 'rgba(43,74,111,0.22)',
      });
      ctx.fillStyle = UI_THEME.navy;
      ctx.font = 'bold 12px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('← 返回', bx + bw / 2, by + bh / 2 + 1);
      ctx.textBaseline = 'alphabetic';
      return;
    }
    // 贴图优先：UI-08 返回按钮 240×105 @3x → 逻辑 80×35，与 BACK_BTN 几何完全一致
    if (!this._art(this._backPressed ? ART_HOOKS.backPressed : ART_HOOKS.backButton, bx, by, bw, bh, { alpha: 1 })) {
      ctx.fillStyle = '#334155';
      ctx.fillRect(bx, by, bw, bh);
      ctx.strokeStyle = '#475569';
      ctx.lineWidth = 1;
      ctx.strokeRect(bx, by, bw, bh);
    }
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
   * 标准底部操作带（方案 M1）：左返回 + 右主 CTA，二者几何都来自 L_SCALE。
   * 只画主 CTA 的底板与文案；返回仍由 _drawBackButton 统一绘制（命中在 Game 层，
   * 保持 BACK_BTN 不变），本方法不碰任何命中。无主 CTA 的浏览屏不调用即可。
   * @param {string} label 主 CTA 文案
   * @param {{disabled?:boolean, accent?:string}} [opts]
   * @returns {{x:number,y:number,w:number,h:number}} 主 CTA 几何，供需要命中的屏对齐
   */
  _footerBar(label, opts) {
    const o = opts || {};
    const w = this.screenWidth;
    const h = this.screenHeight;
    const S = RenderSystem.L_SCALE(w, h);
    const r = Object.assign({}, S.ctaRect);
    if (o.accent) {
      // 自定义强调色时用平面卡底，保持与夜景舞台的关系；默认走明黄主 CTA。
      this._cardBg(r, { tint: o.accent, border: 'rgba(234,248,255,0.22)', flat: true });
      const { ctx } = this;
      ctx.fillStyle = ON_DARK.title;
      ctx.font = 'bold 15px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, r.x + r.w / 2, r.y + r.h / 2 + 1);
      ctx.textBaseline = 'alphabetic';
    } else {
      this._primaryButton(r, label, { disabled: !!o.disabled });
    }
    return r;
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
    this._artIcon(ART_PREFIXES.setting, 'music', w - 22, 22, 18, 0.6);
    this._artFx('settingNotify', w - 46, 18, 18, 18, 0.6);

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

      // 面板：统一 ModalShell 云白皮肤（几何 ax/ay/aW/aH 不变，只换容器）
      const acb = { x: ax + aW - L.closeSize - 8, y: ay + 8, w: L.closeSize, h: L.closeSize };
      this._modalShell({ x: ax, y: ay, w: aW, h: aH }, acb, '公告', {
        iconPrefix: ART_PREFIXES.quest, iconName: 'daily',
      });

      // 公告条目（深色三级文字，替代原浅字压深底）
      ctx.textAlign = 'center';
      let iy = ay + 56;
      for (const item of list) {
        ctx.textAlign = 'left';
        ctx.fillStyle = UI_THEME.navy;
        ctx.font = 'bold 13px sans-serif';
        ctx.fillText(`${item.date}  ${item.title}`, ax + 14, iy);
        ctx.fillStyle = UI_THEME.navySoft;
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

    // 面板 + 标题 + 关闭钮：统一 ModalShell 云白皮肤（几何来自 Game.SETTINGS_LAYOUT，不变）
    const cb = { x: p.x + p.w - L.closeSize - 8, y: p.y + 8, w: L.closeSize, h: L.closeSize };
    this._modalShell(p, cb, '设置', {
      iconPrefix: ART_PREFIXES.setting, iconName: 'music',
    });

    // 行按钮：0=音效 1=音乐 2=震动 3=公告（标签去掉 emoji，图标走正式素材）
    const rows = [
      { label: '音效', on: gameState.audioSfxEnabled !== false, icon: 'music' },
      { label: '背景音乐', on: gameState.audioBgmEnabled !== false, icon: 'notify' },
      { label: '震动', on: gameState.audioHapticEnabled !== false, icon: 'vibrate' },
    ];
    for (let i = 0; i < 4; i++) {
      const r = { x: (w - L.rowW) / 2, y: p.y + L.rowStartOffset + i * (L.rowH + L.rowGap), w: L.rowW, h: L.rowH };

      if (i < 3) {
        // 开关行：云白卡 + 明黄/灰蓝胶囊 toggle（几何不变）
        this._modalToggleRow(r, rows[i].label, rows[i].on, {
          iconPrefix: ART_PREFIXES.setting, iconName: rows[i].icon,
        });
      } else {
        // 公告按钮：云白次按钮 + 正式图标
        this._cardBg(r, { r: 12, tint: 'rgba(214,238,251,0.96)', border: 'rgba(43,74,111,0.3)' });
        this._artIcon(ART_PREFIXES.quest, 'daily', r.x + 30, r.y + r.h / 2, 18, 0.95);
        ctx.fillStyle = UI_THEME.ink;
        ctx.font = 'bold 15px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('公告', r.x + r.w / 2, r.y + r.h / 2);
        ctx.textBaseline = 'alphabetic';
      }
    }

    // 底部版本信息（弱提示色）
    ctx.fillStyle = 'rgba(43,74,111,0.5)';
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
    this._artIcon(ART_PREFIXES.account, 'switch', w - 22, 22, 18, 0.6);

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    const p = { x: (w - L.panelW) / 2, y: (h - L.panelH) / 2, w: L.panelW, h: L.panelH };

    // 面板 + 标题 + 关闭钮：统一 ModalShell 云白皮肤（几何来自 Game.ACCOUNT_LAYOUT，不变）
    const cb = { x: p.x + p.w - L.closeSize - 8, y: p.y + 8, w: L.closeSize, h: L.closeSize };
    this._modalShell(p, cb, '账号', {
      iconPrefix: ART_PREFIXES.account, iconName: 'switch',
    });

    // 账号列表
    const list = gameState.accountList || [];
    const curId = gameState.currentAccountId;
    const rowCount = Math.min(list.length, L.maxRows);
    for (let i = 0; i < rowCount; i++) {
      const acc = list[i];
      const r = { x: p.x + 12, y: p.y + L.rowStartOffset + i * (L.rowH + L.rowGap), w: p.w - 24, h: L.rowH };
      const isCurrent = acc.id === curId;

      // 云白卡底：当前账号用明黄左侧竖条高亮，其余平面弱面（几何不变）
      this._cardBg(r, {
        r: 12,
        tint: isCurrent ? 'rgba(255,255,255,0.98)' : 'rgba(234,248,255,0.9)',
        border: isCurrent ? UI_THEME.goldDeep : 'rgba(43,74,111,0.2)',
        ...(isCurrent ? { edge: UI_THEME.gold } : {}),
      });

      // 昵称 + 账号尾号（深色三级文字，去掉 emoji）
      ctx.textAlign = 'left';
      ctx.fillStyle = UI_THEME.ink;
      ctx.font = 'bold 14px sans-serif';
      ctx.fillText(acc.nickname, r.x + 14, r.y + 16);
      ctx.fillStyle = UI_THEME.navySoft;
      ctx.font = '11px sans-serif';
      ctx.fillText('账号尾号 ' + (acc.uid ? acc.uid.slice(-6) : '—'), r.x + 14, r.y + 32);

      // 右侧操作区
      if (isCurrent) {
        ctx.textAlign = 'right';
        ctx.fillStyle = UI_THEME.green;
        ctx.font = 'bold 13px sans-serif';
        ctx.fillText('✓ 当前', r.x + r.w - 14, r.y + r.h / 2);
      } else {
        // 删除按钮：云白底 + 珊瑚红 ✕（不用 emoji 🗑，几何 del 不变）
        const del = { x: r.x + r.w - 32, y: r.y + (r.h - 28) / 2, w: 28, h: 28 };
        this._cardBg(del, { r: 8, tint: 'rgba(254,226,226,0.95)', border: 'rgba(239,68,68,0.5)', flat: true });
        ctx.fillStyle = '#C0392B';
        ctx.font = 'bold 15px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('✕', del.x + del.w / 2, del.y + del.h / 2 + 1);
        ctx.textBaseline = 'alphabetic';
        // 切换提示
        ctx.textAlign = 'right';
        ctx.fillStyle = UI_THEME.skyDeep;
        ctx.font = 'bold 12px sans-serif';
        ctx.fillText('⇄ 切换', r.x + r.w - 42, r.y + r.h / 2);
      }
      ctx.textAlign = 'center';
    }

    // 账号数超出 maxRows 提示
    if (list.length > L.maxRows) {
      ctx.fillStyle = 'rgba(43,74,111,0.5)';
      ctx.font = '10px sans-serif';
      ctx.fillText(`…共 ${list.length} 个账号，仅显示前 ${L.maxRows} 个`, w / 2, p.y + L.rowStartOffset + L.maxRows * (L.rowH + L.rowGap) - 2);
    }

    // 「登录新账号」按钮：主 CTA 明黄（几何不变）
    const loginRect = { x: p.x + 16, y: p.y + L.rowStartOffset + L.maxRows * (L.rowH + L.rowGap) + L.btnGap, w: p.w - 32, h: L.btnH };
    this._primaryButton(loginRect, '登录新账号');

    // 「注销当前账号」按钮：云白次按钮 + 珊瑚红描边（几何不变）
    const logoutRect = { x: p.x + 16, y: loginRect.y + L.btnH + L.btnGap, w: p.w - 32, h: L.btnH };
    this._cardBg(logoutRect, { r: 12, tint: 'rgba(254,226,226,0.92)', border: 'rgba(239,68,68,0.5)' });
    ctx.fillStyle = '#A93226';
    ctx.font = 'bold 15px sans-serif';
    ctx.fillText('注销当前账号', w / 2, logoutRect.y + logoutRect.h / 2);
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
    // 美术资源层：Toast 3 类底图（按提示语义选取，失败静默；淡入淡出由外层 alpha 相乘继承）
    const _toastKind = gameState.toastType ||
      (/成功|获得|领取|完成|解锁|恭喜/.test(text) ? 'success' :
       /失败|不足|无法|错误|已满|不能/.test(text) ? 'warn' : 'info');
    this._artToast(boxX, boxY, boxW, boxH, _toastKind);

    // 文本
    ctx.fillStyle = '#fef2f2';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, w / 2, boxY + boxH / 2);

    ctx.restore();
  }
}
