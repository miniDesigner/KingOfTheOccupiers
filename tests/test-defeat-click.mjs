// 验证修复: 失败结算界面不再误触设置按钮; 战斗中暂停功能已移除（点原暂停区域无效果）
const noop = () => {};
const ctxProxy = new Proxy({}, {
  get: (t, p) => p === 'canvas' ? canvasStub : ((...args) => {
    if (p === 'measureText') return { width: 50 };
    if (p === 'createLinearGradient' || p === 'createRadialGradient') return { addColorStop: noop };
    return undefined;
  }),
  set: () => true,
});
const canvasStub = {
  width: 400, height: 700, style: {},
  getContext: () => ctxProxy, addEventListener: noop, removeEventListener: noop,
  getBoundingClientRect: () => ({ left: 0, top: 0, width: 400, height: 700 }),
};
global.document = {
  getElementById: () => canvasStub, addEventListener: noop, removeEventListener: noop,
  createElement: () => canvasStub, body: { appendChild: noop, removeChild: noop }, hidden: false,
};
global.window = {
  innerWidth: 400, innerHeight: 700, devicePixelRatio: 1,
  addEventListener: noop, removeEventListener: noop, requestAnimationFrame: (cb) => 0,
  cancelAnimationFrame: noop, AudioContext: class {},
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
const { RenderSystem } = await import('../src/system/RenderSystem.js');
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
const w = game.screenWidth, h = game.screenHeight;
// P36：测试与渲染/命中同源，直接复用 RenderSystem.gameOverLayout，避免测试自身硬编码漂移
const L = RenderSystem.gameOverLayout(w, h);
const center = (r) => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });
const backC = center(L.back), shareC = center(L.share);

// 进入指定结算态（每次用例前重置，避免上一用例关闭界面后串状态）
function toResult(status) {
  game.initBattle();
  game.gameStatus = status;
  game.paused = false;
  game.screenState = 'playing';
}

console.log('=== 测试1: 失败结算界面点击右上角(原暂停按钮区域) → 不误触暂停，且【不关闭界面】 ===');
{
  toResult('lost');
  game.handlePlayingClick(w - 30, 20);   // 右上角暂停按钮区域（空白）
  assert(game.paused === false, 'paused 未被误触发 (实际 ' + game.paused + ')');
  assert(game.screenState === 'playing', '失败点右上角空白 → 仍停留结算界面 (实际 ' + game.screenState + ')');
  assert(game.gameStatus === 'lost', 'gameStatus 保持 lost');
}

console.log('=== 测试2: 失败结算界面点击中部(空白) → 【不关闭界面】 ===');
{
  toResult('lost');
  game.handlePlayingClick(w / 2, h / 2 - 20);   // 结算界面中部（奖励文字区，空白）
  assert(game.screenState === 'playing', '失败点中部空白 → 仍停留结算界面 (实际 ' + game.screenState + ')');
  assert(game.gameStatus === 'lost', 'gameStatus 保持 lost（未误开新局）');
}

console.log('=== 测试3: 胜利结算界面点击右上角 → 不误触暂停，且【不关闭界面】 ===');
{
  toResult('won');
  game.handlePlayingClick(w - 30, 20);   // 右上角（修复前会暂停）
  assert(game.paused === false, 'paused 未被误触发 (实际 ' + game.paused + ')');
  assert(game.screenState === 'playing', '胜利点右上角空白 → 仍停留结算界面 (实际 ' + game.screenState + ')');
}

console.log('=== 测试4: 结算界面多个空白位置 → 一律不关闭、不误触 ===');
{
  const blanks = [
    [10, 10], [w - 10, h - 10], [w / 2, 120], [30, h / 2], [w - 30, h / 2],
    [w / 2, h - 30], [L.back.x - 6, backC.y], [L.back.x + L.back.w + 6, backC.y],
  ];
  let allStay = true;
  for (const status of ['lost', 'won']) {
    for (const [x, y] of blanks) {
      toResult(status);
      game.handlePlayingClick(x, y);
      if (game.screenState !== 'playing' || game.paused !== false) allStay = false;
    }
  }
  assert(allStay, `${blanks.length * 2} 个空白点（含按钮左右外侧 6px）均不关闭界面、不误触暂停`);
}

console.log('=== 测试5: 点击「返回大厅」按钮 → 关闭结算界面（失败/胜利均生效） ===');
{
  toResult('lost');
  game.handlePlayingClick(backC.x, backC.y);
  assert(game.screenState === 'lobby', '失败态点按钮 → 返回大厅 (实际 ' + game.screenState + ')');

  toResult('won');
  game.handlePlayingClick(backC.x, backC.y);
  assert(game.screenState === 'lobby', '胜利态点按钮 → 返回大厅 (实际 ' + game.screenState + ')');
}

console.log('=== 测试6: 胜利态点击「炫耀战绩」分享按钮 → 触发分享且不关闭界面 ===');
{
  toResult('won');
  global.__lastShare = null;
  let err = null;
  try { game.handlePlayingClick(shareC.x, shareC.y); } catch (e) { err = e; }
  assert(!err, '分享按钮点击不抛异常' + (err ? ': ' + err.message : ''));
  assert(global.__lastShare && typeof global.__lastShare.title === 'string', '已发起战绩分享 (__lastShare.title)');
  assert(game.screenState === 'playing', '分享后仍停留结算界面（不误关）');
}

console.log('=== 测试7: 失败态无炫耀入口 → 点分享按钮原区域既不分享也不关闭 ===');
{
  toResult('lost');
  global.__lastShare = null;
  game.handlePlayingClick(shareC.x, shareC.y);
  assert(global.__lastShare === null, '失败态不发起分享');
  assert(game.screenState === 'playing', '失败态点分享区域（空白）→ 不关闭界面');
}

console.log('=== 测试8: 按钮命中精度（内 1px 命中 / 外 1px 不命中） ===');
{
  toResult('lost');
  game.handlePlayingClick(L.back.x + 1, L.back.y + 1);       // 左上角内 1px
  assert(game.screenState === 'lobby', '按钮内左上角 1px → 命中并关闭');

  toResult('lost');
  game.handlePlayingClick(L.back.x - 1, L.back.y - 1);       // 左上角外 1px
  assert(game.screenState === 'playing', '按钮外左上角 1px → 不命中、不关闭');
}

console.log('=== 测试9: 系统返回键仍保留结算界面的关闭通道（tryBack） ===');
{
  toResult('lost');
  const r = game.tryBack();
  assert(r === 'consumed' && game.screenState === 'lobby', '结算态 tryBack → 返回大厅 (实际 ' + r + '/' + game.screenState + ')');
}

console.log('=== 测试10: 战斗中暂停功能已移除（点原暂停按钮位置无任何暂停效果） ===');
{
  game.initBattle();   // 重新开一局 (gameStatus=playing)
  game.handlePlayingClick(w - 30, 20);   // 点原暂停按钮位置（右上角）
  assert(game.paused === false, '原暂停按钮位置点击 → 不再暂停（paused 恒 false）');
  assert(game.screenState === 'playing', '点击不切屏（仍战斗中）');
  game.handlePlayingClick(w / 2, h / 2);   // 点屏幕中央（原"继续"按钮位置）
  assert(game.paused === false, '原"继续"按钮位置点击 → 无暂停恢复逻辑');
  // 暂停菜单按钮（继续/返回大厅）区域点击也不再触发任何暂停菜单行为
  game.handlePlayingClick(w / 2, h / 2 + 50);
  assert(game.paused === false && game.screenState === 'playing', '原"返回大厅"按钮位置 → 不弹菜单不切屏');
}

console.log('=== 测试11: 暂停渲染层已彻底移除（drawPauseScreen 不存在） ===');
{
  // drawPauseScreen 方法应已删除；渲染失败状态时走 drawGameOver
  const rs = game.renderSystem;
  assert(typeof rs.drawPauseScreen === 'undefined', 'RenderSystem.drawPauseScreen 已删除');
  const origGo = rs.drawGameOver;
  let goCount = 0;
  rs.drawGameOver = () => { goCount++; };
  game.screenState = 'playing';
  game.gameStatus = 'lost';
  game.render();
  rs.drawGameOver = origGo;
  assert(goCount === 1, '失败状态渲染 drawGameOver');
  // 恢复
  game.gameStatus = 'playing';
}

console.log(`\n结果: ${passed} 通过, ${failed} 失败`);
process.exit(failed > 0 ? 1 : 0);
