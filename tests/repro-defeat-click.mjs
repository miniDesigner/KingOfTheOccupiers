// 复现: 战斗失败后点击 → 期望再来一局(initBattle)，怀疑实际返回大厅
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

const { Game } = await import('../src/game/Game.js');
const ProfileManager = (await import('../src/meta/ProfileManager.js')).default;

const game = new Game(canvasStub, ctxProxy, 400, 700);
await game.start();
ProfileManager.get().tutorialStep = 4;
ProfileManager.save();

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; console.log(`  ✅ ${msg}`); }
  else { failed++; console.log(`  ❌ ${msg}`); }
}

console.log('=== 场景1: 正常开一局 ===');
{
  game.initBattle();
  assert(game.screenState === 'playing', `开战 → screenState=playing (实际 ${game.screenState})`);
  assert(game.gameStatus === 'playing', `开战 → gameStatus=playing (实际 ${game.gameStatus})`);
  const ai = game.players.find(p => p.id !== 1);
  const bundle = ai ? ai.deploymentBundle : null;
  assert(bundle && Object.keys(bundle.units || {}).length === 4, `AI bundle 4 槽位 (实际 ${bundle ? Object.keys(bundle.units || {}).length : 'null'})`);
}

console.log('=== 场景2: 战斗失败后点击 → 再来一局 ===');
{
  // 模拟失败（与 checkWinCondition 相同路径）
  game.gameStatus = 'lost';
  game.screenState = 'playing';
  // 模拟玩家大本营被毁后 isAlive false
  const human = game.players.find(p => p.id === 1);
  if (human.base) { human.base.building.hp = 0; human.base.building.alive = false; }
  human.tiles = [];
  human.territoryCount = 0;

  let err = null;
  try {
    // 点击结算画面任意处（避开分享按钮区域: cx±75, cy+78±17）
    game.handlePlayingClick(game.screenWidth / 2, game.screenHeight / 2 - 20);
  } catch (e) { err = e; }

  if (err) {
    failed++;
    console.log(`  ❌ 点击抛异常: ${err.message}\n    ${err.stack.split('\n').slice(0, 4).join('\n    ')}`);
  } else {
    assert(game.screenState === 'playing', `点击后 screenState=playing (实际 ${game.screenState})`);
    assert(game.gameStatus === 'playing', `点击后 gameStatus=playing (实际 ${game.gameStatus})`);
    assert(game.map !== null, '新地图已生成 (initBattle 被调用)');
  }
}

console.log('=== 场景3: 失败结算界面渲染冒烟 ===');
{
  let err = null;
  try {
    for (let i = 0; i < 3; i++) game.update(16);
    game.render();
  } catch (e) { err = e; }
  assert(!err, `渲染无异常${err ? ': ' + err.message : ''}`);
}

console.log(`\n结果: ${passed} 通过, ${failed} 失败`);
process.exit(failed > 0 ? 1 : 0);
