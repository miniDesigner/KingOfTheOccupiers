// 模态遮罩不压暗顶栏（设置按钮 / 右上角标题）的源码级守护
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const rsSrc = readFileSync(new URL('../src/system/RenderSystem.js', import.meta.url), 'utf-8');
const gameSrc = readFileSync(new URL('../src/game/Game.js', import.meta.url), 'utf-8');

const screenStart = rsSrc.indexOf('  renderScreen(gameState, inputSystem, dt)');
const screenEnd = rsSrc.indexOf('  /**\n   * renderScreen 主体', screenStart);
const screenSrc = rsSrc.slice(screenStart, screenEnd);

test('顶栏缓存每帧重建，避免跨界面串台', () => {
  assert(screenSrc.includes('this._lastHeader = null;'), 'renderScreen 每帧清空标题缓存');
  assert(screenSrc.includes('this._modalDimActive = false;'), 'renderScreen 每帧清空模态标记');
  assert(rsSrc.includes('this._lastHeader = { title: text, opts: { ...o, cy, leftLimit, rightLimit } };'),
    '_screenHeader 缓存本帧标题与解析后的几何');
});

test('顶栏无条件在遮罩之后重绘，标题不被资源栏暗条压暗', () => {
  const overlayIdx = screenSrc.indexOf('this._drawComplianceOverlay(gameState);');
  const redrawIdx = screenSrc.indexOf('this.redrawTopChrome(gameState);');
  const restoreIdx = screenSrc.indexOf('ctx.restore();');
  assert(redrawIdx > overlayIdx && redrawIdx < restoreIdx,
    '重绘位于所有覆盖层之后、安全区 restore 之前');
  assert(!screenSrc.includes('if (this._modalDimActive) this.redrawTopChrome(gameState);'),
    '不再只在模态时重绘：无模态也要重绘，否则资源栏暗条会压暗标题');
  assert(rsSrc.includes('this._drawResourceBar(gameState);'), '存在常驻资源栏暗条');
  assert(rsSrc.includes('if (o.flat) this._drawCard(headerRect, paintHeader);') ||
    rsSrc.includes('if (o.noShadow) this._drawCard(headerRect, paintHeader);'),
  '标题重绘走无阴影版本，避免阴影二次叠加');
  assert(rsSrc.includes('if (state.screenState === \'lobby\') this._drawLobbySettingButton(settingOverlayOpen);'),
    '大厅设置按钮在遮罩后重绘，设置覆盖层时传 dim 参数');
  assert(rsSrc.includes('const settingOverlayOpen = !!(state.settingsOpen || state.announceOpen || state.accountOpen);'),
    '设置/公告/账号覆盖层被识别为需压暗设置按钮的场景');
  assert(rsSrc.includes('ctx.globalAlpha = 0.6;') && rsSrc.includes('if (dim) ctx.restore();'),
    '设置按钮支持 dim 压暗重绘（仍可见但不喧宾夺主）');
  assert(rsSrc.includes('if (cached) this._screenHeader(cached.title, { ...cached.opts, noShadow: true });'),
    '右上角标题按缓存几何原样重绘（无阴影版）');
});

test('设置按钮抽成单一绘制方法，几何与命中不变', () => {
  const helperStart = rsSrc.indexOf('  _drawLobbySettingButton(dim) {');
  assert(helperStart > 0, '存在独立设置按钮绘制方法（含 dim 参数）');
  const helper = rsSrc.slice(helperStart, rsSrc.indexOf('\n  }', helperStart));
  assert(helper.includes('{ x: w - 45, y: 10, w: 35, h: 30, r: 9 }'), '按钮几何与原版一致');
  assert(!rsSrc.includes('const lobbySet = { x: w - 45'), '旧内联绘制已移除');
  assert(gameSrc.includes('screenX >= w - 45 && screenX <= w - 10'), '点击命中区未改动');
});

test('全部全屏模态遮罩都标记顶栏重绘', () => {
  const methods = [
    '_drawRecruitPanel(gameState)', '_drawSynergyDetailPanel(gameState)',
    '_drawBuildingDetailPanel(gameState)', '_drawUnitDetailPanel(gameState)',
    'drawGameOver(gameState)', 'drawMatchOverlay()', '_drawSettingsOverlay(gameState)',
    '_drawAccountOverlay(gameState)', '_drawComplianceOverlay(gameState)',
  ];
  for (const name of methods) {
    const start = rsSrc.indexOf(`  ${name}`);
    assert(start > 0, `存在 ${name}`);
    const body = rsSrc.slice(start, rsSrc.indexOf('\n  }', start));
    assert(body.includes('this._modalDimActive = true;'), `${name} 标记顶栏重绘`);
  }
  assert(!rsSrc.includes("this._artIcon(ART_PREFIXES.setting, 'music', w - 22, 22, 18, 0.6)"),
    '设置窗口内不再画半透明假设置图标');
  assert(!rsSrc.includes("this._artIcon(ART_PREFIXES.account, 'switch', w - 22, 22, 18, 0.6)"),
    '账号窗口内不再画半透明假图标');
});

test('匹配 overlay 在 renderScreen 之后绘制，由 Game 手动补回顶栏', () => {
  assert(gameSrc.includes('this._drawMatchOverlay();') && gameSrc.includes(
    'this.renderSystem.redrawTopChrome({ screenState: this.screenState });'),
  'Game 在匹配遮罩后调用顶栏重绘');
});

test('设置界面标题图标为齿轮，不再用音符', () => {
  // _drawSettingsOverlay 里 _modalShell 的图标参数
  const settingsStart = rsSrc.indexOf('  _drawSettingsOverlay(gameState)');
  const settingsSrc = rsSrc.slice(settingsStart, rsSrc.indexOf('\n  }', settingsStart));
  assert(settingsSrc.includes("this._modalShell(p, cb, '设置', {"),
    '设置面板使用 _modalShell');
  assert(settingsSrc.includes('iconPrefix: ART_PREFIXES.hud, iconName: \'setting\''),
    '标题图标用 hud/setting（齿轮）');
  assert(!settingsSrc.includes('iconName: \'music\''),
    '不再用 setting/music（音符）作标题图标');
});

test('设置覆盖层不再 emit BIND_SETTINGS 装饰层（左上角奇怪图标来源）', () => {
  const alSrc = readFileSync(new URL('../src/system/ArtLayer.js', import.meta.url), 'utf-8');
  assert(!alSrc.includes('emit(SCREEN_BINDINGS.settings)'),
    'drawArtLayer 不再绘制设置装饰组');
  assert(!alSrc.includes('const BIND_SETTINGS'),
    'BIND_SETTINGS 死代码已删除');
  assert(!alSrc.includes("'settings': BIND_SETTINGS"),
    'SCREEN_BINDINGS 不再注册 settings 组');
  const genSrc = readFileSync(new URL('../tools/gen-art-layer.mjs', import.meta.url), 'utf-8');
  assert(!genSrc.includes("emit(SCREEN_BINDINGS.settings)"),
    '生成脚本同步移除 settings emit');
});
