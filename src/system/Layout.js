// src/system/Layout.js —— 横排元素自适应宽度工具
// 设计原则：
//   1. 元素总宽 + 总 gap ≤ screenWidth - 2*padX（不溢出）
//   2. 单元素宽 ≥ minW（保证文字可读、icon 不被裁）
//   3. 屏宽够大时不缩放：单元素宽上限 = 设计稿原值（DESIGN_MAX），防止拉伸变形

/**
 * 计算横排元素单元素自适应宽度
 * @param {number} count  元素数量
 * @param {number} gap    元素之间间隔（px）
 * @param {number} screenW 屏宽（逻辑像素）
 * @param {number} padX   左右内边距之和的一半（默认 8，即左右各 8）
 * @param {number} minW   单元素最小宽度（保证文字可读）
 * @param {number} [maxW] 单元素最大宽度（屏宽够大时不拉伸）
 * @returns {number} 单元素宽
 *
 * 公式：availableW = screenW - 2*padX
 *      width = (availableW - (count-1)*gap) / count
 *      最终 = clamp(width, minW, maxW ?? Infinity)
 */
export function rowItemWidth(count, gap, screenW, padX = 8, minW = 40, maxW) {
  if (count <= 0) return 0;
  const availableW = screenW - 2 * padX;
  const ideal = (availableW - (count - 1) * gap) / count;
  let w = Math.max(minW, ideal);
  if (maxW != null) w = Math.min(maxW, w);
  return w;
}

/**
 * 计算横排起始 X（水平居中）
 * @param {number} count  元素数量
 * @param {number} itemW  单元素宽
 * @param {number} gap    元素之间间隔
 * @param {number} screenW 屏宽
 * @returns {number} 起始 X
 */
export function rowStartX(count, itemW, gap, screenW) {
  if (count <= 0) return 0;
  return (screenW - (count * itemW + (count - 1) * gap)) / 2;
}

/**
 * 计算横排第 i 个元素的 X
 * @param {number} i
 * @param {number} count
 * @param {number} itemW
 * @param {number} gap
 * @param {number} screenW
 * @returns {number} 第 i 个元素 X
 */
export function rowItemX(i, count, itemW, gap, screenW) {
  return rowStartX(count, itemW, gap, screenW) + i * (itemW + gap);
}

/**
 * 设计稿原值参考（用于 maxW 钳制，避免宽屏上元素被拉伸变形）
 * 上阵槽位 52 / 兵种卡 58 / 羁绊槽 105 / 羁绊卡 75 / 功能按钮 88 / 底部 nav 68 / 开战按钮 220
 */
export const LAYOUT_DESIGN_MAX = {
  unitSlot: 52,    // 上阵槽位（设计稿原值，6×52+5×5=337 在 375+ 屏宽下刚好）
  synSlot: 105,
  unitCard: 58,
  synCard: 75,
  lobbySlot: 70,   // 大厅上阵预览卡
  lobbyRow: 88,    // 功能按钮行
  lobbyNav: 68,    // 底部 nav
  battle: 220,     // 开战按钮
  techNode: 150,   // 科技树节点（设计稿原值，2 列）
  techTab: 80,     // 科技树分支标签
  ladderBadgeR: 62, // 大厅段位城堡图标半径（设计稿原值；放大后的 3D 城堡）
};

/**
 * 最小宽度（下限，保护文字可读）
 */
export const LAYOUT_MIN = {
  unitSlot: 42,    // Lv.10 + ★★★+icon 最小可读
  synSlot: 80,     // "史诗 · 3级羁绊"
  unitCard: 46,    // icon 18 + Lv.1 18 刚好
  synCard: 60,     // "弓箭手"
  lobbySlot: 42,   // 大厅上阵预览卡最小宽（6 满编在 320 屏 6×46.5+25=304 不溢出）
  lobbyRow: 60,    // "🎖 通行证"
  lobbyNav: 50,    // "🏪 商店"
  battle: 180,
  techNode: 120,   // 描述文字可读下限
  techTab: 68,     // icon + 4 汉字
  ladderBadgeR: 20, // 大厅段位徽章最小半径（图标+段位名仍可读）
};

/**
 * 字号自适应（解决窄屏上"🎖 通行证"等文字溢出按钮的问题）
 *
 * 现象：iPhone 5 (320) 功能按钮 width=70px，但 12px 字号下 "🎖 通行证" 实际渲染 ~62px
 *   (emoji 18px + 空格 4px + 3 个汉字 14px×3=42px)，紧贴按钮边缘，"证"字出屏。
 *
 * 阶梯式降字号（保留整数像素对齐，避免模糊）：
 *   screenW ≥ 360 → baseSize（原字号）
 *   340 ≤ screenW < 360 → baseSize - 1
 *   screenW < 340 → baseSize - 2（最低 8px）
 *
 * @param {number} baseSize  屏宽 ≥360 时使用的字号
 * @param {number} screenW   当前屏宽
 * @param {number} [minSize] 字号下限，默认 8
 * @returns {number} 实际字号
 */
export function adaptiveFontSize(baseSize, screenW, minSize = 8) {
  if (screenW >= 360) return baseSize;
  const delta = screenW >= 340 ? 1 : 2;
  return Math.max(minSize, baseSize - delta);
}

/**
 * 科技树节点宽度（固定 2 列，居中布局）
 * @param {number} screenW
 * @returns {number}
 */
export function techNodeWidth(screenW) {
  return rowItemWidth(2, 10, screenW, 12, LAYOUT_MIN.techNode, LAYOUT_DESIGN_MAX.techNode);
}

/**
 * 科技树分支标签宽度（4 分支，居中布局）
 * @param {number} screenW
 * @returns {number}
 */
export function techTabWidth(screenW) {
  return rowItemWidth(4, 4, screenW, 8, LAYOUT_MIN.techTab, LAYOUT_DESIGN_MAX.techTab);
}

/**
 * 大厅段位进度条高度（城堡下方，居中表现）
 */
export const LADDER_BAR_H = 20;

/**
 * 大厅段位进度条最大宽度（设计稿原值，宽屏不拉伸）
 */
export const LADDER_BAR_MAX_W = 300;

/**
 * 大厅段位进度条最小宽度（文字可读下限）
 */
export const LADDER_BAR_MIN_W = 200;

// 段位组合单元垂直间距（城堡 → 进度条 → 赛季文字 → 上阵区）
const LADDER_PAD_TOP = 6;          // 组合单元顶 → 城堡顶
const LADDER_GAP_CASTLE_BAR = 12;  // 城堡底 → 进度条顶（原杯数信息栏已移除，间距保留给城堡呼吸）
const LADDER_PAD_BOTTOM = 28;      // 进度条底 → 组合单元底（赛季文字中心在 barY+barH+16，含胶囊内边距）

/** 赛季剩余时间文字中心相对进度条底的偏移（拉开间距，避免文字贴条） */
export const LADDER_SEASON_TEXT_OFFSET = 16;

/**
 * 大厅段位组合单元布局：大城堡图标 + 段位进度条 + 赛季剩余时间，整体在 [rowBottom, battleTop] 内垂直居中
 *
 * v3：图标改为 3D 城堡图片（无圆形底盘），移除图标下方杯数文字栏；
 *     赛季剩余时间与进度条间距由 LADDER_SEASON_TEXT_OFFSET 统一控制。
 *
 * @param {number} rowBottom  顶部区块底 Y
 * @param {number} battleTop  开战按钮顶部 Y
 * @returns {{badgeR:number, badgeY:number, barY:number, barH:number, seasonY:number}}
 */
export function ladderCombo(rowBottom, battleTop) {
  const avail = battleTop - rowBottom;
  // 城堡直径之外的所有固定开销
  const fixed = LADDER_PAD_TOP + LADDER_GAP_CASTLE_BAR + LADDER_BAR_H + LADDER_PAD_BOTTOM;
  const badgeR = Math.max(
    LAYOUT_MIN.ladderBadgeR,
    Math.min(LAYOUT_DESIGN_MAX.ladderBadgeR, Math.floor((avail - fixed) / 2))
  );
  const unitH = LADDER_PAD_TOP + 2 * badgeR + LADDER_GAP_CASTLE_BAR + LADDER_BAR_H + LADDER_PAD_BOTTOM;
  const unitTop = rowBottom + (avail - unitH) / 2;
  const badgeY = unitTop + LADDER_PAD_TOP + badgeR;
  const barY = badgeY + badgeR + LADDER_GAP_CASTLE_BAR;
  const seasonY = barY + LADDER_BAR_H + LADDER_SEASON_TEXT_OFFSET;
  return { badgeR, badgeY, barY, barH: LADDER_BAR_H, seasonY };
}

/**
 * 大厅段位进度条宽度自适应（居中，左右各留 24px）
 * @param {number} screenW
 * @returns {number} 钳制在 [LADDER_BAR_MIN_W, LADDER_BAR_MAX_W]
 */
export function ladderBarWidth(screenW) {
  return rowItemWidth(1, 0, screenW, 24, LADDER_BAR_MIN_W, LADDER_BAR_MAX_W);
}

// ==================== 大厅 v2 布局（渲染 / 命中 / 引导共用单一真相源）====================
// 布局：左上玩家信息卡（账号+战力） / 右上功能按钮纵列 / 中偏上赛季区 / 开战按钮上方上阵兵种 / 底部导航
// 顶部资源栏 0~50：货币簇（左）+ 设置按钮（右），由 _drawResourceBar 独立绘制，不在此列。

const LOBBY_TOP_Y = 54;          // 资源栏（0~50）下方起始
const FUNC_BTN_H = 36;           // 功能按钮纵列：单按钮高
const FUNC_BTN_GAP = 6;          // 功能按钮纵列：间距
const PLAYER_CARD_H = 82;        // 左上玩家信息卡高
const DEPLOY_CARD_H = 65;        // 上阵卡片高（沿用 v1 的 65，仅位置上移到开战按钮上方）
const DEPLOY_BATTLE_GAP = 12;    // 上阵卡片底 → 开战按钮顶

/** 右上角功能按钮单按钮宽（窄屏下限 72 / 宽屏上限 96） */
export function lobbyFuncBtnW(screenW) {
  return Math.max(72, Math.min(96, Math.round(screenW * 0.25)));
}

/** 右上角功能按钮纵列：第 i 个按钮 rect（分享/任务/成就/通行证） */
export function lobbyFuncBtnRect(i, screenW, funcCount = 3) {
  const w = lobbyFuncBtnW(screenW);
  return {
    x: screenW - 8 - w,
    y: LOBBY_TOP_Y + i * (FUNC_BTN_H + FUNC_BTN_GAP),
    w,
    h: FUNC_BTN_H,
  };
}

/** 右上角功能按钮纵列底部 Y */
export function lobbyFuncBottom(funcCount = 3) {
  return LOBBY_TOP_Y + funcCount * FUNC_BTN_H + (funcCount - 1) * FUNC_BTN_GAP;
}

/** 左上角玩家信息卡 rect（账号 + 战力合并到同一框体） */
export function lobbyPlayerCardRect(screenW) {
  const funcX = lobbyFuncBtnRect(0, screenW).x;
  return { x: 8, y: LOBBY_TOP_Y, w: Math.max(140, funcX - 16), h: PLAYER_CARD_H };
}

/** 上阵兵种卡片顶 Y（开战按钮上方） */
export function lobbyDeployCardY(screenH) {
  return screenH - 150 - DEPLOY_BATTLE_GAP - DEPLOY_CARD_H;
}

/** 上阵兵种标签中心 Y */
export function lobbyDeployLabelY(screenH) {
  return lobbyDeployCardY(screenH) - 12;
}

/** 赛季区顶部 Y（顶部玩家卡/功能按钮列下方的可用区起点） */
export function lobbySeasonTop(screenW, funcCount = 3) {
  const card = lobbyPlayerCardRect(screenW);
  return Math.max(card.y + card.h, lobbyFuncBottom(funcCount)) + 8;
}

/** 赛季区 combo（中偏上）：复用 ladderCombo 的间距规则，区间 = [顶部区块底, 上阵区上方] */
export function lobbySeasonCombo(screenW, screenH, funcCount = 3) {
  const top = lobbySeasonTop(screenW, funcCount);
  const bottom = lobbyDeployLabelY(screenH) - 16;
  return ladderCombo(top, bottom);
}

export const LOBBY_V2 = { LOBBY_TOP_Y, FUNC_BTN_H, FUNC_BTN_GAP, PLAYER_CARD_H, DEPLOY_CARD_H, DEPLOY_BATTLE_GAP };

/**
 * 顶部资源栏布局：根据最长货币数字字符串自适应
 * PM 2026-09-07：货币上限提到 99999999（8 位），资源栏必须能完整显示
 *
 * @param {number[]} values 4 个值（gold/diamond/stardust/trophies）
 * @param {number} screenW 屏幕宽（用于 clusterW 钳制到右下不撞设置按钮）
 * @param {number} safeRight clusterX+clusterW 必须 ≤ 此值（默认留给设置按钮）
 * @returns {{cellW:number, cellH:number, pad:number, fontSize:number, clusterW:number, maxChars:number, wide:boolean}}
 */
export function resourceBarLayout(values, screenW, safeRight = 217) {
  let maxChars = 0;
  for (const v of values || []) {
    const n = typeof v === 'number' ? v : Number(v) || 0;
    maxChars = Math.max(maxChars, String(n).length);
  }
  // 分档：≤5 字符用窄格+大字号；6~8 字符用宽格+小字号
  const wide = maxChars > 5;
  const narrow = { cellW: 56, cellH: 17, pad: 4, fontSize: 11 };
  const widen  = { cellW: 76, cellH: 17, pad: 4, fontSize: 9  };
  const cur = wide ? widen : narrow;
  // clusterW 上限：不超过 safeRight 减去 clusterX(8)，保证不撞右上角设置按钮
  const minClusterW = narrow.cellW * 2 + narrow.pad * 2; // 120，保证最窄形态也成立
  let clusterW = cur.cellW * 2 + cur.pad * 2;
  const maxClusterW = Math.max(minClusterW, safeRight - 8);
  if (clusterW > maxClusterW) clusterW = maxClusterW;
  return { ...cur, clusterW, maxChars, wide };
}