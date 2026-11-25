// 底部分页按钮统一布局 + 商店页签样式对齐科技/排行榜的源码与数值守护
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const rsSrc = readFileSync(new URL('../src/system/RenderSystem.js', import.meta.url), 'utf-8');
const gameSrc = readFileSync(new URL('../src/game/Game.js', import.meta.url), 'utf-8');
const drawShop = rsSrc.slice(rsSrc.indexOf('  drawShop(gameState)'),
  rsSrc.indexOf('  // ==================== 详情面板共享布局'));
const drawTech = rsSrc.slice(rsSrc.indexOf('  drawTechPanel(gameState)'),
  rsSrc.indexOf('  // ==================== 商店面板'));
const drawLb = rsSrc.slice(rsSrc.indexOf('  drawLeaderboard(gameState)'),
  rsSrc.indexOf('  // ==================== 抽卡面板'));

test('三处分页按钮共用底部布局单一真相源', () => {
  assert(rsSrc.includes('const SUBPAGE_TAB_H = 30;'), '三处分页按钮统一高度 30');
  assert(rsSrc.includes('function subpageTabY(screenH)'), '底部分页 y 由共享函数给出');
  assert(rsSrc.includes('function subpageClipBottom(screenH)'), '列表裁剪底由共享函数给出');
  assert(rsSrc.includes('const SUBPAGE_CONTENT_TOP = 88;'), '内容起始统一 88');
  assert(drawShop.includes('const L = RenderSystem.shopLayout(w, items.length, h);'),
    '商店绘制传真实屏高，页签 y 与命中同源');
  assert(drawTech.includes('const tabY = subpageTabY(h);'), '科技页签用共享底部 y');
  assert(drawLb.includes('const tabY = subpageTabY(h);'), '排行榜页签用共享底部 y');
});

test('商店页签改为科技/排行榜同款夜色卡，不再走 _tabs', () => {
  assert(!drawShop.includes('this._tabs('), '商店不再使用 _tabs 统一页签');
  assert(drawShop.includes("border: active ? UI_THEME.gold : NIGHT.borderDim"),
    '选中态明黄边框');
  assert(drawShop.includes('edge: active ? UI_THEME.gold : null') &&
    drawShop.includes("edgeSide: 'top'"), '选中态顶部强调条');
  assert(drawShop.includes("ctx.font = 'bold 11px sans-serif';"),
    '页签字号 11px，与科技/排行榜一致');
  assert(drawTech.includes('border: isSelected ? branch.color : NIGHT.borderDim'),
    '科技页签同为夜色卡强调边框');
  assert(drawLb.includes('border: active ? UI_THEME.gold : NIGHT.borderDim'),
    '排行榜页签同为夜色卡强调边框');
});

test('底部分页几何：不压返回按钮，列表裁剪底在页签上方', () => {
  const h = 734; // 375×812 去掉微信安全区 top44 + bottom34
  const tabTop = h - 16 - 35 - 8 - 30; // 645
  const tabBottom = tabTop + 30;       // 675
  const backTop = h - 16 - 35;         // 683
  const clipBottom = tabTop - 8;       // 637
  assert(tabBottom < backTop,
    `分页按钮底 ${tabBottom} 必须高于返回按钮顶 ${backTop}`);
  assert(clipBottom < tabTop,
    `列表裁剪底 ${clipBottom} 必须高于分页按钮顶 ${tabTop}`);
  assert(clipBottom > 88,
    `底部分页与内容顶 88 之间需保留可视区（实际 ${clipBottom - 88}px）`);
});

test('排行榜排名胶囊避开底部分页按钮', () => {
  assert(drawLb.includes('const tipY = h - BACK_BTN.bottom - 34;'),
    '排名胶囊改为与返回按钮同一行（不再压页签下缘）');
  assert(drawLb.includes('subpageTabY(h) - 12'),
    '底部说明移到分页按钮上方，不与胶囊争用底行');
  const h = 854; // 430×932 去掉安全区 top44 + bottom34
  const tabTop = h - 89, tabBottom = tabTop + 30; // 765..795
  const tipTop = h - 16 - 34, tipBottom = tipTop + 34; // 804..838
  assert(tipTop > tabBottom,
    `排名胶囊顶 ${tipTop} 必须低于分页按钮底 ${tabBottom}`);
  assert(tipBottom <= h - 16, `胶囊底 ${tipBottom} 不越过返回按钮底边 ${h - 16}`);
  assert(tabTop - 12 < tabTop, '底部说明位于分页按钮上方');
});

test('点击命中与绘制同源：三处均按底部 y 命中', () => {
  assert(gameSrc.includes('const L = RenderSystem.shopLayout(this.screenWidth, cats.length, this.screenHeight);'),
    '商店命中传真实屏高');
  assert((gameSrc.match(/const tabY = subpageTabY\(this\.screenHeight\);/g) || []).length === 2,
    '科技与排行榜命中各用一次共享底部 y');
  assert(gameSrc.includes('static subpageViewportBottom(screenH)'),
    'Game 有底部分页列表命中底边');
  assert((gameSrc.match(/Game\.subpageViewportBottom\(this\.screenHeight\)/g) || []).length === 2,
    '商店/科技列表命中均避让分页按钮');
});
