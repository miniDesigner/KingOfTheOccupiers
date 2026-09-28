/**
 * 机型适配 · 安全区工具（Phase 7 P8）
 *
 * 集中承载三件事，供 game.js（WX 入口）、RenderSystem（渲染）、Game（输入）共用，
 * 保证「取安全区 → 钳制 → 算 scaleY」全链路只有一份实现：
 *
 *  1. SAFE_AREA_MAX      —— 避让量上限，防御异常/伪造 safeArea 把 UI 压扁
 *  2. clampSafeArea()    —— 钳制 + 算纵向缩放系数 scaleY
 *  3. normalizeSafeAreaUnit() —— 单位自愈（个别 ROM 按物理像素返回时折算回逻辑像素）
 *
 * 单位约定：全部为逻辑像素（与 wx.getWindowInfo().screenHeight / windowHeight 同单位）。
 * 官方定义 safeArea 为逻辑像素；Unity 适配文档「需乘以 pixelRatio 才为 Unity 大小」
 * 也反证了这一点。单位自愈只是兜底，真实设备不会触发。
 */

/**
 * 安全区避让量上限（逻辑像素），依据真机实测极值：
 *   top    ≤ 59 —— iPhone 14 Pro / 15 / 16 系列灵动岛（历代最大，59/852 ≈ 7%）
 *   bottom ≤ 48 —— Android 虚拟导航栏（三键导航，高于 iPhone home indicator 的 34）
 * 真实设备永不触发；仅拦截异常值，避免 scaleY 过小导致 UI 纵向严重压扁。
 */
export const SAFE_AREA_MAX = { top: 64, bottom: 48 };

/**
 * safeArea 单位自愈
 * 判据：逻辑像素下 top+bottom 不可能超过屏高 30%（灵动岛实测 93/852 ≈ 11%）。
 *      超出即判定为物理像素，按 pixelRatio 折算回逻辑像素。
 *
 * @param {{top:number, bottom:number, left:number, right:number}|null|undefined} sa
 *        原始 safeArea，注意 bottom/right 是「安全区边界坐标」，不是高度
 * @param {number} screenWidth  逻辑屏宽
 * @param {number} screenHeight 逻辑屏高
 * @param {number} pixelRatio   设备像素比
 * @returns {{top:number, bottom:number, left:number, right:number}} 归一化后的四边避让量
 */
export function normalizeSafeAreaUnit(sa, screenWidth, screenHeight, pixelRatio) {
  if (!sa) return { top: 0, bottom: 0, left: 0, right: 0 };

  const dpr = pixelRatio > 1 ? pixelRatio : 1;

  // 判据（两个都按「原始值 vs 逻辑屏高」比较，避免先算错再判断）：
  //   a) safeArea.bottom 是安全区下边界坐标，逻辑像素下必然 ≤ 屏高；
  //      若 > 1.5 倍屏高，说明整个 safeArea 是物理像素（dpr=2 时为 1.9 倍、dpr=3 时为 2.9 倍）
  //   b) top 占屏高超过 20% —— 逻辑像素下最大约 7%（灵动岛 59/852）
  const isPhysical = dpr > 1 && (
    (sa.bottom || 0) > screenHeight * 1.5 ||
    (sa.top || 0) > screenHeight * 0.2
  );

  if (isPhysical) {
    // 整个 safeArea 坐标先折算回逻辑像素，再算四边避让量
    const bottomEdge = (sa.bottom || screenHeight * dpr) / dpr;
    const rightEdge = (sa.right || screenWidth * dpr) / dpr;
    return {
      top: (sa.top || 0) / dpr,
      bottom: (screenHeight - bottomEdge) || 0,
      left: (sa.left || 0) / dpr,
      right: (screenWidth - rightEdge) || 0,
    };
  }

  return {
    top: sa.top || 0,
    // safeArea.bottom 是安全区下边界纵坐标，避让高度 = 屏高 - 该坐标
    bottom: (screenHeight - (sa.bottom || screenHeight)) || 0,
    left: sa.left || 0,
    right: (screenWidth - (sa.right || screenWidth)) || 0,
  };
}

/**
 * 钳制安全区并算出纵向缩放系数
 * scaleY 把 inner 坐标系 [0, h] 线性映射到屏幕 [top, h-bottom]：
 *   screen_y = top + inner_y * scaleY
 *   inner_y  = (screen_y - top) / scaleY   （输入端反推，见 Game.onTileClick 等）
 *
 * @param {{top:number, bottom:number}|null|undefined} safeArea
 * @param {number} screenHeight 逻辑屏高
 * @returns {{top:number, bottom:number, scaleY:number}}
 */
export function clampSafeArea(safeArea, screenHeight) {
  const top = Math.min(Math.max(0, (safeArea && safeArea.top) || 0), SAFE_AREA_MAX.top);
  const bottom = Math.min(Math.max(0, (safeArea && safeArea.bottom) || 0), SAFE_AREA_MAX.bottom);
  const usableH = Math.max(1, screenHeight - top - bottom);
  return { top, bottom, scaleY: usableH / screenHeight };
}

export default { SAFE_AREA_MAX, normalizeSafeAreaUnit, clampSafeArea };
