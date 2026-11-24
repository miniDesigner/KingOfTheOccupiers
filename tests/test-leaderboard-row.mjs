// 排行榜行框体加高 + 前三名奖牌替换为正式资源图标的源码级守护
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const rsSrc = readFileSync(new URL('../src/system/RenderSystem.js', import.meta.url), 'utf-8');
const manifestSrc = readFileSync(new URL('../src/system/ArtManifest.js', import.meta.url), 'utf-8');
const drawLb = rsSrc.slice(rsSrc.indexOf('  drawLeaderboard(gameState)'), rsSrc.indexOf('  // ==================== 抽卡面板'));

test('排行榜行高收口到共享常量 32px，不再硬编码 24', () => {
  assert(rsSrc.includes('const LEADERBOARD_ROW_H = 32;'), '存在 32px 行高常量');
  assert(rsSrc.includes('LEADERBOARD_LIST_Y, LEADERBOARD_ROW_H,'), '常量已导出供测试与调用方复用');
  assert(drawLb.includes('const rowH = LEADERBOARD_ROW_H;'), '绘制使用共享常量');
  assert(!drawLb.includes('const rowH = 24;'), '旧的 24px 硬编码已移除');
});

test('加高后末行仍不压住玩家排名胶囊', () => {
  const listY = 72 + 30 + 12 + 10; // LEADERBOARD_LIST_Y = 124
  const rowH = 32;
  const lastRowBottom = listY + 19 * rowH + (rowH - 2) / 2; // 732 + 15 = 747
  const tipTop = (932 - 44 - 34) - 66;                       // 788（安全区后内容高 854）
  assert(lastRowBottom < tipTop, `末行底 ${lastRowBottom} 必须小于提示胶囊顶 ${tipTop}`);
});

test('前三名奖牌走正式 medal_* 资源图标通道', () => {
  assert(drawLb.includes("const medalKey = i === 0 ? 'gold' : (i === 1 ? 'silver' : (i === 2 ? 'bronze' : null));"),
    '前三名依次映射 gold / silver / bronze');
  assert(drawLb.includes('this._artIcon(ART_PREFIXES.medal, medalKey, 33, y, 22, 1)'),
    '通过 _artIcon 正式图标通道绘制');
  for (const key of ['gold', 'silver', 'bronze']) {
    assert(manifestSrc.includes(`"key": "icons/medal_${key}"`), `icons/medal_${key} 已登记素材索引`);
  }
  assert(/medal:\s*\['gold',\s*'silver',\s*'bronze'\]|"medal": "icons\/medal_"/.test(manifestSrc),
    'medal 前缀映射存在');
});

test('图标未加载时保留程序化金银铜圆章兜底与名次数字', () => {
  assert(drawLb.includes('if (medalArt) {') && drawLb.includes('} else {'), '存在图标/兜底双分支');
  assert(drawLb.includes('if (medalFill) {') && drawLb.includes('ctx.arc(mx + mc / 2, y, mc / 2'),
    '程序化圆章兜底仍在');
  assert(drawLb.includes("ctx.fillText(`${i + 1}`, 28, y);"), '兜底名次数字位置不变');
});

test('奖牌图标附带名次角标，避免图标不带数字导致名次丢失', () => {
  assert(drawLb.includes('const badgeX = 43, badgeY = y + 7;'), '角标锚点在图标右下');
  assert(drawLb.includes("ctx.fillText(String(i + 1), badgeX, badgeY);"), '角标绘制名次');
  assert(drawLb.includes("ctx.strokeText(String(i + 1), badgeX, badgeY);"), '深色描边保证浅底可读');
});
