// 诊断：全界面逻辑冒烟 —— 模拟浏览器环境驱动真实 Game 实例
// 遍历 10 种屏幕状态渲染 + 关键交互链路（导航/开战/暂停/翻格/结算）
// 命名 diag-* 不参与全量回归（test-*）
const noop = () => {};
const ctxProxy = new Proxy({}, {
  get: (t, p) => {
    if (p === 'canvas') return canvasStub;
    if (p === 'measureText') return () => ({ width: 50 });
    if (p === 'createLinearGradient' || p === 'createRadialGradient') return () => ({ addColorStop: noop });
    if (p === 'getImageData') return () => ({ data: [] });
    if (p === 'createPattern') return () => ({});
    return () => undefined;
  },
  set: () => true,
});
const canvasStub = {
  width: 390, height: 844, style: {},
  getContext: () => ctxProxy,
  addEventListener: noop, removeEventListener: noop,
  getBoundingClientRect: () => ({ left: 0, top: 0, width: 390, height: 844 }),
};
global.document = {
  getElementById: () => canvasStub,
  addEventListener: noop, removeEventListener: noop,
  createElement: () => canvasStub,
  body: { appendChild: noop, removeChild: noop },
  hidden: false,
};
global.window = {
  innerWidth: 390, innerHeight: 844, devicePixelRatio: 1,
  addEventListener: noop, removeEventListener: noop,
  requestAnimationFrame: (cb) => setTimeout(() => cb(Date.now()), 16),
  cancelAnimationFrame: clearTimeout,
  AudioContext: class { constructor(){} },
  location: { href: 'http://127.0.0.1:8890/preview/index.html', reload: noop },
};
global.requestAnimationFrame = window.requestAnimationFrame;
global.localStorage = { _d: {}, getItem(k) { return this._d[k] ?? null; }, setItem(k, v) { this._d[k] = String(v); }, removeItem(k) { delete this._d[k]; } };
Object.defineProperty(global, 'navigator', { value: { userAgent: 'node-test' }, configurable: true });
global.performance = { now: () => Date.now() };
global.alert = noop;
global.Audio = class { constructor(){ this.play = noop; this.pause = noop; } };
// fetch: 从真实服务器拉配置（与浏览器一致的网络路径）
global.fetch = async (path) => {
  const url = new URL(path, 'http://127.0.0.1:8890/preview/index.html').href;
  const r = await import('node:http').then(({ request }) => new Promise((res, rej) => {
    const req = request(url, (resp) => {
      let body = '';
      resp.on('data', (c) => body += c);
      resp.on('end', () => res({ ok: resp.statusCode === 200, status: resp.statusCode, json: async () => JSON.parse(body) }));
    });
    req.on('error', rej);
    req.end();
  }));
  return r;
};
// 让 Node ESM 支持 require（ConfigLoader WX 分支需要）
global.require = (await import('node:module')).createRequire(new URL('../src/data/ConfigLoader.js', import.meta.url));

// wx-shim 等价模拟（关键：storage 委托 localStorage 而非 Proxy noop）
global.wx = {
  createCanvas: () => canvasStub,
  getSystemInfoSync: () => ({ screenWidth: 390, screenHeight: 844, pixelRatio: 1, platform: 'browser' }),
  setStorageSync: (k, v) => global.localStorage.setItem(k, JSON.stringify(v)),
  getStorageSync: (k) => { const d = global.localStorage.getItem(k); return d ? JSON.parse(d) : null; },
  vibrateShort: noop, vibrateLong: noop,
  showToast: noop,
  shareAppMessage: noop, onShareAppMessage: noop, showShareMenu: noop,
  createInnerAudioContext: () => ({ play: noop, pause: noop, stop: noop, destroy: noop, seek: noop, onPlay: noop, onPause: noop, onStop: noop, onEnded: noop, onError: noop, src: '', volume: 1 }),
};

const origError = console.error;
console.error = (...a) => { origError('[console.error]', ...a); };
process.on('unhandledRejection', (e) => { origError('[unhandledRejection]', e); process.exit(1); });

let passed = 0, failed = 0;
function check(name, cond, extra = '') {
  if (cond) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; console.log(`  ❌ ${name} ${extra}`); }
}
async function renderFrame(game, label) {
  try { game.update(0.016); game.render(0.016); check(`${label} render 无异常`, true); }
  catch (e) { check(`${label} render 无异常`, false, `→ ${e.message}`); }
}
// 模拟点击（直接走 handleScreenClick 分发）
function click(game, x, y) {
  game.handleScreenClick(x, y);
  game.render(0.016); // 点击后渲染一帧，验证点击处理不崩渲染
}

const W = 390, H = 844;
const GameRef = await import('../src/game/Game.js');
const { Game } = GameRef;
const { hexToPixel } = await import('../src/world/HexMath.js');

// 预置老玩家存档（totalGames>0 → tutorialStep=-1，跳过引导）
const { reset: resetProfile, get: getProfile, save: saveProfile } = await import('../src/meta/ProfileManager.js');
resetProfile();
const prof = getProfile();
prof.totalGames = 5;
prof.tutorialStep = -1;
saveProfile();
console.log(`老玩家 profile: tutorialStep=${prof.tutorialStep}`);

const game = new Game(canvasStub, ctxProxy, W, H);
await game.start();
console.log('--- start OK ---');
console.log(`screenState=${game.screenState} HEX_SIZE=${GameRef.HEX_SIZE || '(config)'}`);

// ========== T1 大厅 ==========
console.log('\n[1] 大厅');
check('初始状态为 lobby', game.screenState === 'lobby');
await renderFrame(game, 'lobby');

// ========== T2 底部导航 5 项遍历 ==========
console.log('\n[2] 底部导航遍历');
const navY = Game.lobbyNavY(H);
const navStates = ['shop', 'gacha', 'deploy_select', 'tech_panel', 'leaderboard'];
for (let i = 0; i < 5; i++) {
  const x = Game.lobbyNavX(i, W);
  click(game, x + Game.LOBBY_LAYOUT.nav.w / 2, navY + 20);
  check(`导航[${i}] → ${navStates[i]}`, game.screenState === navStates[i], `实际=${game.screenState}`);
  await renderFrame(game, navStates[i]);
  // 返回大厅
  game.screenState = 'lobby';
  await renderFrame(game, 'lobby→back');
}
// 布阵界面返回按钮（真实点击路径：deploy 走 InputSystem.onDeployTouchEnd）
click(game, Game.lobbyNavX(2, W) + 20, navY + 20);
check('布阵 → deploy_select', game.screenState === 'deploy_select');
game.inputSystem.onDeployTouchEnd(56, H - 33, false); // 返回按钮（左下角）
game.render(0.016);
check('布阵返回 → lobby', game.screenState === 'lobby', `实际=${game.screenState}`);

// ========== T3 功能行 3 项（任务/成就/通行证，跳过分享） ==========
console.log('\n[3] 功能行遍历');
const rowY = Game.LOBBY_LAYOUT.row.y;
const rowStates = ['quest', 'achievement', 'battle_pass'];
for (let i = 1; i <= 3; i++) {
  const x = Game.lobbyRowX(i, W);
  click(game, x + Game.LOBBY_LAYOUT.row.w / 2, rowY + 20);
  check(`功能行[${i}] → ${rowStates[i - 1]}`, game.screenState === rowStates[i - 1], `实际=${game.screenState}`);
  await renderFrame(game, rowStates[i - 1]);
  game.screenState = 'lobby';
  await renderFrame(game, 'lobby→back');
}

// ========== T4 设置窗口 ==========
console.log('\n[4] 设置窗口');
click(game, W - 25, 25);
check('设置窗口打开', game._settingsOpen === true);
game._settingsOpen = false;
await renderFrame(game, 'lobby(settings closed)');

// ========== T5 开战（异步 PvP：点击 → searching → 触发对手检索成功 → playing） ==========
console.log('\n[5] 开战进入战斗');
const blY = Game.lobbyBattleY(H);
click(game, W / 2, blY + 25);
check('开战 → searching', game._asyncState === 'searching', `实际=${game._asyncState}`);
// 加速触发检索成功，进入战斗（与 test-ladder 测试12 同路径）
if (game._matchFoundTimer) { clearTimeout(game._matchFoundTimer); game._matchFoundTimer = null; }
if (game._matchTimeout) { clearTimeout(game._matchTimeout); game._matchTimeout = null; }
game._onAsyncOpponentFound();
check('检索成功 → playing', game.screenState === 'playing', `实际=${game.screenState}`);
check('gameStatus=playing', game.gameStatus === 'playing');
for (let i = 0; i < 6; i++) await renderFrame(game, `战斗帧${i}`);

// ========== T6 战斗内右上角设置（暂停按钮已移除，⚙ 独占右上角） ==========
console.log('\n[6] 战斗内右上角设置');
click(game, W - 75, 22); // 右上角 ⚙ 设置
check('点击右上角 → 打开设置窗口', game._settingsOpen === true);
game._settingsOpen = false;
await renderFrame(game, '设置窗口关闭后');

// ========== T7 战斗翻格 ==========
console.log('\n[7] 战斗中翻格');
const candidates = game.map.getAdjacentUnflippedTiles(1);
check('存在可翻格子', candidates.length > 0, `count=${candidates.length}`);
if (candidates.length > 0) {
  const t = candidates[0];
  const before = game.map.getTile(t.q, t.r).isFlipped;
  const p = hexToPixel(t.q, t.r, 32);
  const sx = p.x * game.inputSystem.scale + game.inputSystem.cameraX;
  const sy = p.y * game.inputSystem.scale + game.inputSystem.cameraY;
  click(game, sx, sy);
  // 翻格是动画制：startFlip 后 isFlipping>0（isFlipped 需等动画完成）
  const tileAfter = game.map.getTile(t.q, t.r);
  const flipped = tileAfter.isFlipping > 0 || tileAfter.isFlipped;
  check(`翻格成功 (${t.q},${t.r})`, before === false && flipped === true, `before=${before} isFlipping=${tileAfter.isFlipping}`);
  await renderFrame(game, '翻格后');
} else {
  check('翻格成功', false, '无候选格子');
}

// ========== T8 结算渲染 ==========
console.log('\n[8] 结算界面渲染');
game.gameStatus = 'won';
await renderFrame(game, '胜利结算');
game.gameStatus = 'lost';
await renderFrame(game, '失败结算');
click(game, W / 2, H / 2);
check('结算点击 → 返回大厅', game.screenState === 'lobby', `实际=${game.screenState}`);

// ========== T9 新玩家引导链路（快速验证不干扰老玩家 + 分步推进） ==========
console.log('\n[9] 新玩家引导链路');
resetProfile(); // tutorialStep=0
const p2seed = getProfile();
p2seed.totalGames = 0;
saveProfile();
const game2 = new Game(canvasStub, ctxProxy, W, H);
await game2.start();
// 注意：game2.start() 中 load() 会重建 profile 单例，必须每次用 getProfile() 读最新
check('新玩家 tutorialStep=0', getProfile().tutorialStep === 0);
check('引导状态生成(step0)', game2._buildTutorialState() !== null && game2._buildTutorialState().step === 0);
// 点非目标 → 不推进
click(game2, 30, 300);
check('点非目标不推进', game2.screenState === 'lobby' && getProfile().tutorialStep === 0);
// 点布阵按钮 → step1
const bx = Game.lobbyNavX(2, W);
click(game2, bx + 20, navY + 20);
check('点布阵 → step1 + deploy_select', getProfile().tutorialStep === 1 && game2.screenState === 'deploy_select', `step=${getProfile().tutorialStep} state=${game2.screenState}`);
await renderFrame(game2, '引导step1渲染');
// 点返回 → step2（返回按钮在左下角）
game2.inputSystem.onDeployTouchEnd(56, H - 33, false);
game2.render(0.016);
check('返回 → step2 + lobby', getProfile().tutorialStep === 2 && game2.screenState === 'lobby', `step=${getProfile().tutorialStep} state=${game2.screenState}`);
// 点开战 → step3
click(game2, W / 2, blY + 25);
check('点开战 → step3 + playing', getProfile().tutorialStep === 3 && game2.screenState === 'playing', `step=${getProfile().tutorialStep} state=${game2.screenState}`);
await renderFrame(game2, '引导step3战斗渲染');
// 翻格 → 完成 + 金币
const goldBefore = getProfile().gold;
const c2 = game2.map.getAdjacentUnflippedTiles(1);
if (c2.length > 0) {
  const pp = hexToPixel(c2[0].q, c2[0].r, 32);
  click(game2, pp.x * game2.inputSystem.scale + game2.inputSystem.cameraX, pp.y * game2.inputSystem.scale + game2.inputSystem.cameraY);
}
check('引导完成 step4', getProfile().tutorialStep === 4, `实际=${getProfile().tutorialStep}`);
check('引导奖励金币+100', getProfile().gold === goldBefore + 100, `gold=${getProfile().gold} before=${goldBefore}`);

// ========== T10 老玩家不受引导干扰（已验证） ==========
console.log('\n[10] 老玩家引导跳过');
check('老玩家 _buildTutorialState()=null', game._buildTutorialState() === null);

console.log(`\n========== 结果: ${passed} 通过, ${failed} 失败 ==========`);
process.exit(failed > 0 ? 1 : 0);
