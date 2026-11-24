// 战斗结算界面视觉回归守护（2026-11-24）
// 问题：结算态仍绘制战斗 HUD，透过半透明遮罩在顶部留下 PvP 标题/VS/金币残影；
// result_star/promote/summary 奶黄九宫格以低透明度叠在夜色页上变成悬浮灰框；
// 奖杯负数文案出现「▼-22」双负号。修法：结算态跳过 HUD/引导，移除结算装饰叠层，
// 奖杯差值取绝对值。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const norm = (s) => s.replace(/\r\n/g, '\n');
const rsSrc = norm(readFileSync(new URL('../src/system/RenderSystem.js', import.meta.url), 'utf-8'));
const gameSrc = norm(readFileSync(new URL('../src/game/Game.js', import.meta.url), 'utf-8'));
const cfgSrc = norm(readFileSync(new URL('../config/game.json', import.meta.url), 'utf-8'));

function drawGameOverBody() {
  const start = rsSrc.indexOf('  drawGameOver(gameState) {');
  assert(start > 0, '存在 drawGameOver');
  const next = rsSrc.indexOf('\n  }\n', start);
  assert(next > start, 'drawGameOver 结束位置可定位');
  return rsSrc.slice(start, next);
}

test('结算态跳过战斗 HUD 与新手引导，避免顶部残影', () => {
  assert(rsSrc.includes('const isGameOver = gameState.gameStatus !== \'playing\';'),
    '结算判定在 HUD 之前');
  assert(rsSrc.includes("    if (!isGameOver) {\n      this.drawHUD(gameState);"),
    '仅非结算态绘制 HUD');
  assert(rsSrc.includes('      this._drawTutorialOverlay(gameState, inputSystem);\n    }'),
    '新手引导随 HUD 一起跳过');
  assert(rsSrc.includes("    if (isGameOver) {\n      this.drawGameOver(gameState);\n    }"),
    '结算态绘制结果卡');
});

test('结算页不再绘制悬浮灰框与脏斑装饰', () => {
  const body = drawGameOverBody();
  for (const token of ['pick_result(', 'pick_rankShine(', 'pick_defeatFx(', "'firework'"]) {
    assert(!body.includes(token), `结算页已移除 ${token}`);
  }
  assert(body.includes("this._artFx('medalGold'"), '保留正式奖牌图');
  assert(!gameSrc.includes('this.renderSystem._artResultDecor = '), 'Game 不再注入废弃结算装饰开关');
  assert(cfgSrc.includes('已废弃（2026-11-24）：结算装饰层已移除'),
    'config 文档标注结算开关废弃');
});

test('奖杯变化文案不出现双负号', () => {
  const body = drawGameOverBody();
  assert(body.includes('奖杯 ${arrow}${Math.abs(rewards.trophyDelta)}'),
    '负向奖杯差值取绝对值，箭头单独表意');
  assert(!body.includes('奖杯 ${arrow}${rewards.trophyDelta}'), '不再直接拼接负数');
});
