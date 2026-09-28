// 测试: Phase 6 新手引导分步教学重做
// 流程: step0 大厅高亮布阵 → 进布阵界面; step1 布阵点返回 → 回大厅;
//       step2 大厅点开战 → 战斗; step3 战斗中翻格成功 → 引导完成 +100金
// 兼容: 老玩家 tutorialStep=-1 跳过引导; 非目标点击不推进
const noop = () => {};
const ctxProxy = new Proxy({}, {
  get: (t, p) => {
    if (p === 'canvas') return canvasStub;
    return (...args) => {
      if (p === 'measureText') return { width: 50 };
      if (p === 'createLinearGradient' || p === 'createRadialGradient') return { addColorStop: noop };
      return undefined;
    };
  },
  set: () => true,
});
const canvasStub = {
  width: 400, height: 700, style: {},
  getContext: () => ctxProxy,
  addEventListener: noop, removeEventListener: noop,
  getBoundingClientRect: () => ({ left: 0, top: 0, width: 400, height: 700 }),
};
global.document = {
  getElementById: () => canvasStub,
  addEventListener: noop, removeEventListener: noop,
  createElement: () => canvasStub,
  body: { appendChild: noop, removeChild: noop },
  hidden: false,
};
global.window = {
  innerWidth: 400, innerHeight: 700, devicePixelRatio: 1,
  addEventListener: noop, removeEventListener: noop,
  requestAnimationFrame: (cb) => 0,
  cancelAnimationFrame: noop,
  AudioContext: class {},
  location: { href: 'http://127.0.0.1:8890/preview/index.html', reload: noop },
};
global.requestAnimationFrame = () => 0;
global.localStorage = { _d: {}, getItem(k) { return this._d[k] ?? null; }, setItem(k, v) { this._d[k] = String(v); }, removeItem(k) { delete this._d[k]; } };
global.wx = {
  shareAppMessage(cfg) { global.__lastShare = cfg; },
  createInnerAudioContext() {
    return { src: '', loop: false, volume: 1, play: noop, pause: noop, stop: noop, seek: noop, destroy: noop, onEnded: noop, onError: noop, onCanplay: noop };
  },
};
Object.defineProperty(global, 'navigator', { value: { userAgent: 'node-test' }, configurable: true });
global.performance = { now: () => Date.now() };
global.alert = noop;
global.Audio = class { constructor() { this.volume = 1; } play() { return Promise.resolve(); } pause() {} addEventListener() {} };
const { readFileSync: rf, existsSync } = await import('node:fs');
const { fileURLToPath: fURL } = await import('node:url');
const ROOT = fURL(new URL('..', import.meta.url));
global.fetch = async (path) => {
  const file = ROOT + path.replace('../', '');
  if (!existsSync(file)) return { ok: false, status: 404, json: async () => { throw new Error('404 ' + path); } };
  return { ok: true, status: 200, json: async () => JSON.parse(rf(file, 'utf-8')) };
};

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; console.log(`  ✅ ${msg}`); }
  else { failed++; console.log(`  ❌ ${msg}`); }
}

const { Game } = await import('../src/game/Game.js');
const ProfileManager = (await import('../src/meta/ProfileManager.js')).default;

const game = new Game(canvasStub, ctxProxy, 400, 700);
await game.start();
const w = game.screenWidth;
const h = game.screenHeight;
const NAV = Game.LOBBY_LAYOUT.nav;
const navY = Game.lobbyNavY(h);
const deployBtnX = Game.lobbyNavX(2, w); // 「⚔ 布阵」
const blY = Game.lobbyBattleY(h);
const BL = Game.LOBBY_LAYOUT.battle;

// 每个测试块前重置引导状态
function resetTutorial(step) {
  const p = ProfileManager.get();
  p.tutorialStep = step;
  ProfileManager.save();
  game.screenState = 'lobby';
}

console.log('=== 测试1: step0 大厅 → 点击「布阵」进入布阵界面 ===');
{
  resetTutorial(0);
  assert(game.screenState === 'lobby', '初始在大厅');
  const tut = game._buildTutorialState();
  assert(tut && tut.step === 0, '引导状态 step0 生成');
  assert(tut.target && tut.target.w === NAV.w, 'step0 目标为布阵按钮矩形');
  assert(tut.text.includes('布阵'), 'step0 文案提及布阵');

  // 点击布阵按钮 → 进布阵界面 + step1
  game.handleLobbyClick(deployBtnX + NAV.w / 2, navY + NAV.h / 2);
  assert(game.screenState === 'deploy_select', '点击布阵 → 布阵界面');
  assert(ProfileManager.get().tutorialStep === 1, 'tutorialStep 0 → 1');

  // 点击其他区域不推进
  resetTutorial(0);
  game.handleLobbyClick(10, 10);
  assert(ProfileManager.get().tutorialStep === 0, '点击非目标区域不推进');
  assert(game.screenState === 'lobby', '点击非目标区域不切屏');
}

console.log('=== 测试2: step1 布阵界面 → 点返回回大厅 ===');
{
  resetTutorial(1);
  game.screenState = 'deploy_select';
  // 模拟返回按钮点击（左下角 16, h-51 ~ 96, h-16 中心）
  game._handleDeployDragEnd(56, h - 33, false);
  assert(game.screenState === 'lobby', '点返回 → 大厅');
  assert(ProfileManager.get().tutorialStep === 2, 'tutorialStep 1 → 2');
}

console.log('=== 测试3: step2 大厅 → 点击「开战」进战斗 ===');
{
  resetTutorial(2);
  const tut = game._buildTutorialState();
  assert(tut && tut.step === 2, '引导状态 step2 生成');
  assert(tut.text.includes('开战'), 'step2 文案提及开战');

  // 点击非开战区域不推进
  game.handleLobbyClick(deployBtnX + NAV.w / 2, navY + NAV.h / 2);
  assert(ProfileManager.get().tutorialStep === 2, 'step2 点击非开战不推进');

  // 点击开战 → 战斗 + step3
  game.handleLobbyClick(w / 2, blY + BL.h / 2);
  assert(game.screenState === 'playing' && game.gameStatus === 'playing', '点击开战 → 战斗');
  assert(ProfileManager.get().tutorialStep === 3, 'tutorialStep 2 → 3');
}

console.log('=== 测试4: step3 战斗中 → 翻格成功完成引导 ===');
{
  const p = ProfileManager.get();
  p.tutorialStep = 3;
  p.gold = 500;
  ProfileManager.save();
  game.screenState = 'playing';
  game.gameStatus = 'playing';

  const tut = game._buildTutorialState();
  assert(tut && tut.step === 3, '引导状态 step3 生成');
  assert(tut.target && tut.target.q !== undefined, 'step3 目标为六边形格子坐标');
  assert(tut.text.includes('翻转'), 'step3 文案提及翻转');

  // 找到目标格子并模拟点击翻格
  const tile = game.map.getTile(tut.target.q, tut.target.r);
  assert(tile && !tile.isFlipped, '目标格子存在且未翻转');

  // 模拟屏幕点击该格中心（世界坐标 → 屏幕坐标）
  const world = game.map.hexToPixel(tut.target.q, tut.target.r);
  const sx = world.x * game.inputSystem.scale + game.inputSystem.cameraX;
  const sy = world.y * game.inputSystem.scale + game.inputSystem.cameraY;
  game.handlePlayingClick(sx, sy);

  assert(ProfileManager.get().tutorialStep === 4, '翻格成功 → tutorialStep 4');
  assert(ProfileManager.get().gold === 600, '引导完成奖励金币+100');
}

console.log('=== 测试5: 老玩家 tutorialStep=-1 跳过引导 ===');
{
  resetTutorial(-1);
  const tut = game._buildTutorialState();
  assert(tut === null, '老玩家不生成引导状态');
  // 点击布阵正常进界面，不拦截
  game.handleLobbyClick(deployBtnX + NAV.w / 2, navY + NAV.h / 2);
  assert(game.screenState === 'deploy_select', '老玩家点击布阵正常进入');
  assert(ProfileManager.get().tutorialStep === -1, '老玩家引导状态不变');
}

console.log('=== 测试6: 战斗中引导渲染叠加不报错 ===');
{
  const p = ProfileManager.get();
  p.tutorialStep = 3;
  ProfileManager.save();
  game.screenState = 'playing';
  game.gameStatus = 'playing';
  // 构造 gameState 并调用 render（含 _drawTutorialOverlay）
  game.render(0.016);
  assert(true, 'render 无异常（引导叠加层绘制通过）');
}

console.log('=== 测试7: 布阵界面引导叠加渲染不报错 ===');
{
  resetTutorial(1);
  game.screenState = 'deploy_select';
  game.render(0.016);
  assert(true, 'deploy_select render 无异常');
}

console.log(`\n结果: ${passed} 通过, ${failed} 失败`);
if (failed > 0) process.exit(1);
