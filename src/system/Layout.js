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
  ladderBadgeR: 54, // 大厅段位大徽章半径（设计稿原值）
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
 * 大厅段位徽章下方一行文字（🏆 奖杯 · 最高）预留高度
 * 徽章整体 = 2R（圆） + 本文字区，必须 ≤ 功能行底到进度条顶的可用高度，否则中小屏会压到进度条/开战按钮
 */
export const LADDER_BADGE_TEXT_H = 14;

/**
 * 大厅段位进度条高度（徽章下方，居中表现）
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

// 段位组合单元垂直间距（徽章 → 奖杯文字 → 进度条 → 进度条下方文字 → 开战按钮）
const LADDER_PAD_TOP = 6;          // 组合单元顶 → 徽章顶
const LADDER_GAP_BADGE_INFO = 6;   // 徽章底 → 奖杯文字顶
const LADDER_GAP_INFO_BAR = 8;     // 奖杯文字底 → 进度条顶
const LADDER_PAD_BOTTOM = 18;      // 进度条底 → 组合单元底（开战按钮上方留白，含进度条下方文字「还差X杯·赛季剩X天」）

/**
 * 大厅段位组合单元布局：大徽章 + 奖杯文字 + 段位进度条，整体在 [rowBottom, battleTop] 内垂直居中
 *
 * P20：进度条由「开战按钮上方」移到「段位徽章下方」，与徽章组成一个视觉单元；
 * 进度条文字居中、长度随屏宽自适应（见 ladderBarWidth）。
 *
 * @param {number} rowBottom  功能按钮行底部 Y
 * @param {number} battleTop  开战按钮顶部 Y
 * @returns {{badgeR:number, badgeY:number, infoY:number, barY:number, barH:number}}
 *          badgeR 徽章半径 / badgeY 圆心 Y / infoY 奖杯文字中心 Y / barY 进度条顶 Y / barH 进度条高
 */
export function ladderCombo(rowBottom, battleTop) {
  const avail = battleTop - rowBottom;
  // 徽章直径之外的所有固定开销
  const fixed = LADDER_PAD_TOP + LADDER_BADGE_TEXT_H + LADDER_GAP_BADGE_INFO + LADDER_GAP_INFO_BAR + LADDER_BAR_H + LADDER_PAD_BOTTOM;
  const badgeR = Math.max(
    LAYOUT_MIN.ladderBadgeR,
    Math.min(LAYOUT_DESIGN_MAX.ladderBadgeR, Math.floor((avail - fixed) / 2))
  );
  const unitH = LADDER_PAD_TOP + 2 * badgeR + LADDER_GAP_BADGE_INFO + LADDER_BADGE_TEXT_H + LADDER_GAP_INFO_BAR + LADDER_BAR_H + LADDER_PAD_BOTTOM;
  const unitTop = rowBottom + (avail - unitH) / 2;
  const badgeY = unitTop + LADDER_PAD_TOP + badgeR;
  const infoY = badgeY + badgeR + LADDER_GAP_BADGE_INFO + LADDER_BADGE_TEXT_H / 2;
  const barY = infoY + LADDER_BADGE_TEXT_H / 2 + LADDER_GAP_INFO_BAR;
  return { badgeR, badgeY, infoY, barY, barH: LADDER_BAR_H };
}

/**
 * 大厅段位进度条宽度自适应（居中，左右各留 24px）
 * @param {number} screenW
 * @returns {number} 钳制在 [LADDER_BAR_MIN_W, LADDER_BAR_MAX_W]
 */
export function ladderBarWidth(screenW) {
  return rowItemWidth(1, 0, screenW, 24, LADDER_BAR_MIN_W, LADDER_BAR_MAX_W);
}

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