// 回归守护：战斗结束返回大厅后，结算装饰不得残留在大厅中央形成半透明虚影（2026-11-25）
// 根因：返回大厅只改 screenState，gameStatus 残留 won/lost；大厅不在 SHELL_SCREENS 内会走
// 装饰层，drawArtLayer 仅凭 gameStatus!=='playing' 就叠加 BIND_RESULT 九宫格/特效。
// 修法：Game 返回大厅时重置 gameStatus；ArtLayer 结算装饰加 screen==='playing' 前置。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const alSrc = readFileSync(new URL('../src/system/ArtLayer.js', import.meta.url), 'utf-8');
const gameSrc = readFileSync(new URL('../src/game/Game.js', import.meta.url), 'utf-8');

test('装饰层结算素材叠加必须同时满足 screen===playing', () => {
  const marker = "if (screen === 'playing' && gameState && gameState.gameStatus && gameState.gameStatus !== 'playing') {";
  assert(alSrc.includes(marker), 'BIND_RESULT 叠加带 screen===playing 前置，隔离非战斗界面');
  const idx = alSrc.indexOf(marker);
  assert(idx > 0, '前置条件存在');
  const emitIdx = alSrc.indexOf('emit(SCREEN_BINDINGS.result)', idx);
  assert(emitIdx > idx && emitIdx < idx + marker.length + 80,
    '结算装饰 emit 紧跟在该前置条件块内，未被挪出');
});

test('旧的仅凭 gameStatus 判定已不存在', () => {
  assert(!alSrc.includes("if (gameState && gameState.gameStatus && gameState.gameStatus !== 'playing') {\n    emit(SCREEN_BINDINGS.result);"),
    '不再有只判 gameStatus 就叠加结算装饰的裸分支');
});

test('结算装饰 key 集合仍完整保留（不误删正式素材叠加）', () => {
  const start = alSrc.indexOf('const BIND_RESULT = [');
  assert(start > 0, 'BIND_RESULT 仍存在');
  const block = alSrc.slice(start, alSrc.indexOf('];', start) + 2);
  for (const key of ['effects/defeat_debris', 'effects/defeat_flash', 'effects/rank_shine',
    'ui/result_promote', 'ui/result_star', 'ui/result_summary']) {
    assert(block.includes(`'${key}'`), `结算装饰 key 保留：${key}`);
  }
});

test('结算页返回大厅时同步重置 gameStatus 为 playing', () => {
  const anchor = gameSrc.indexOf('// 「返回大厅」主按钮：关闭结算界面的唯一画布入口');
  assert(anchor > 0, '存在结算页返回大厅按钮分支');
  const window = gameSrc.slice(anchor, anchor + 520);
  assert(window.includes("this.screenState = 'lobby';"), '该分支切回大厅');
  assert(window.includes("this.gameStatus = 'playing';"),
    '结算返回大厅同步重置 gameStatus，避免残留 won/lost 影响装饰层/其它消费点');
});
