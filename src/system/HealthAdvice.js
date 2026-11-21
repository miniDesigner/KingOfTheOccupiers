/**
 * 健康游戏忠告 — 标准文案与加载页绘制。
 *
 * 文案为国家新闻出版署规定的健康游戏忠告标准文本，版号申报与微信小游戏
 * 提审均要求在显著位置完整、清晰展示。本模块是文案与布局的单一真相源：
 * 加载页绘制与此处的布局函数同源，测试直接锁定文案与坐标。
 *
 * 纯绘制模块：不读配置、不依赖 wx / document，Node 测试环境同样可用。
 */

import FontSystem from './FontSystem.js';

/** 标题（标准文案首行） */
export const HEALTH_ADVICE_TITLE = '健康游戏忠告';

/** 标准四句正文，顺序与措辞不可改动 */
export const HEALTH_ADVICE_LINES = [
  '抵制不良游戏，拒绝盗版游戏。',
  '注意自我保护，谨防受骗上当。',
  '适度游戏益脑，沉迷游戏伤身。',
  '合理安排时间，享受健康生活。',
];

/**
 * 加载页健康忠告布局：屏幕底部锚定的半透明底板 + 五行文字。
 * 底板保证在明亮插画上仍有足够对比度（版号要求清晰可辨）。
 * textBaseline 为 middle，返回的 y 即每行文字的垂直中心。
 *
 * @param {number} w 屏宽
 * @param {number} h 屏高
 * @param {number} bottomInset 底部留白（默认 24px，避开 Home 指示区）
 */
export function healthAdviceLayout(w, h, bottomInset = 24) {
  const lineH = 17;
  const padX = 16;
  const padY = 12;
  const titleH = 16;
  const n = HEALTH_ADVICE_LINES.length;
  const panelW = Math.min(w - 32, 236);
  const panelH = padY * 2 + titleH + lineH * n;
  const panelX = (w - panelW) / 2;
  const panelY = h - bottomInset - panelH;
  const firstLineY = panelY + padY + titleH + lineH / 2;

  return {
    panel: { x: panelX, y: panelY, w: panelW, h: panelH },
    title: { x: w / 2, y: panelY + padY + titleH / 2, size: 13 },
    lines: HEALTH_ADVICE_LINES.map((_, i) => ({
      x: w / 2,
      y: firstLineY + lineH * i,
      size: 12,
    })),
  };
}

/** 内联圆角矩形路径（加载页不依赖 RenderSystem） */
function roundRectPath(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
  ctx.lineTo(x + w, y + h - rr);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
  ctx.lineTo(x + rr, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
  ctx.lineTo(x, y + rr);
  ctx.quadraticCurveTo(x, y, x + rr, y);
  ctx.closePath();
}

/**
 * 在已有画布上绘制健康游戏忠告。
 * 先铺一层轻薄深色圆角底板，再写标题与四句正文——
 * 不依赖外部蒙层，插画明暗变化时文字始终清晰。
 */
export function drawHealthAdvice(ctx, w, h, bottomInset) {
  const L = healthAdviceLayout(w, h, bottomInset);
  ctx.save();

  roundRectPath(ctx, L.panel.x, L.panel.y, L.panel.w, L.panel.h, 12);
  ctx.fillStyle = 'rgba(14,26,46,0.46)';
  ctx.fill();

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = 'rgba(234,248,255,0.96)';
  ctx.font = FontSystem.font(L.title.size, 'bold');
  ctx.fillText(HEALTH_ADVICE_TITLE, L.title.x, L.title.y);

  ctx.fillStyle = 'rgba(234,248,255,0.9)';
  ctx.font = FontSystem.font(L.lines[0].size, 'normal');
  for (let i = 0; i < HEALTH_ADVICE_LINES.length; i++) {
    const row = L.lines[i];
    ctx.fillText(HEALTH_ADVICE_LINES[i], row.x, row.y);
  }
  ctx.restore();
}
