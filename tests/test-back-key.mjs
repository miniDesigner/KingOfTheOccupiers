// 回归测试：系统返回键（浏览器后退 / Android 物理返回 / 微信侧滑手势）
// 覆盖：
//  1. Game.tryBack() 全分支语义（consumed/keep/none）
//  2. 浏览器 history 占位层同步（打开面板 push / 手动关闭 replace / popstate 消费）
//  3. 战斗内返回 = keep（推回占位层保持页面；暂停功能已移除，返回键不再呼出暂停菜单）
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

// 模拟浏览器 history（支持 popstate 消费语义）
const histStack = [{ tk: undefined }];
let histIdx = 0;
const mockHistory = {
  get state() { return histStack[histIdx]; },
  pushState: (st) => { histIdx++; histStack[histIdx] = st; },
  replaceState: (st) => { histStack[histIdx] = st; },
};
// 模拟浏览器"后退"消费一层历史（返回旧 state）
const browserBack = () => { if (histIdx > 0) histIdx--; };
// 简化断言用：当前占位层是否有 tk 标记
const hasBackLayer = () => !!(histStack[histIdx] && histStack[histIdx].tk);

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
  history: mockHistory,
  location: { href: 'http://127.0.0.1:8890/preview/index.html', reload: noop },
};
global.requestAnimationFrame = window.requestAnimationFrame;
global.localStorage = { _d: {}, getItem(k) { return this._d[k] ?? null; }, setItem(k, v) { this._d[k] = String(v); }, removeItem(k) { delete this._d[k]; } };
Object.defineProperty(global, 'navigator', { value: { userAgent: 'node-test' }, configurable: true });
global.performance = { now: () => Date.now() };
global.alert = noop;
global.Audio = class { constructor(){ this.play = noop; this.pause = noop; } };
// fetch：优先走真实 HTTP（模拟浏览器链路）；server 不可达时降级读本地文件（消除硬依赖，避免间歇 ECONNREFUSED 挂测试）
global.fetch = async (path) => {
  const url = new URL(path, 'http://127.0.0.1:8890/preview/index.html').href;
  try {
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
  } catch (e) {
    // 降级：直接读本地 config 文件（与 preview-server 返回内容一致）
    const fs = await import('node:fs');
    const pathMod = await import('node:path');
    const urlMod = await import('node:url');
    const ROOT = urlMod.fileURLToPath(new URL('..', import.meta.url));
    const rel = path.replace(/^(\.\.\/)+/, '').replace(/^config\//, '');
    const full = pathMod.join(ROOT, 'config', rel);
    try {
      const body = fs.readFileSync(full, 'utf-8');
      return { ok: true, status: 200, json: async () => JSON.parse(body) };
    } catch (e2) {
      return { ok: false, status: 404, json: async () => { throw new Error('404 ' + path); } };
    }
  }
};
// 让 Node ESM 支持 require（ConfigLoader WX 分支需要）—— 以 ConfigLoader.js 所在目录为 base
global.require = (await import('node:module')).createRequire(new URL('../src/data/ConfigLoader.js', import.meta.url));

global.wx = {
  createCanvas: () => canvasStub,
  getSystemInfoSync: () => ({ screenWidth: 390, screenHeight: 844, pixelRatio: 1, platform: 'browser' }),
  setStorageSync: (k, v) => global.localStorage.setItem(k, JSON.stringify(v)),
  getStorageSync: (k) => { const s = global.localStorage.getItem(k); return s ? JSON.parse(s) : null; },
  vibrateShort: noop, vibrateLong: noop,
  showToast: noop,
  shareAppMessage: noop, onShareAppMessage: noop, showShareMenu: noop,
  createInnerAudioContext: () => ({ play: noop, pause: noop, stop: noop, destroy: noop, seek: noop, onPlay: noop, onPause: noop, onStop: noop, onEnded: noop, onError: noop, src: '', volume: 1 }),
  onKeyDown: noop,
};

const { Game } = await import('../src/game/Game.js');
const { reset: resetProfile, get: getProfile, save: saveProfile } = await import('../src/meta/ProfileManager.js');

let passed = 0, failed = 0;
function check(name, cond, extra = '') {
  if (cond) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; console.log(`  ❌ ${name} ${extra}`); }
}
function section(title) { console.log(`\n[${title}]`); }

const W = 390, H = 844;
resetProfile();
const prof = getProfile();
prof.totalGames = 5;
prof.tutorialStep = -1;
saveProfile();

const game = new Game(canvasStub, ctxProxy, W, H);
await game.start();
check('启动后：返回键已启用', game._backEnabled === true, `backEnabled=${game._backEnabled}`);
check('启动后：无占位层', !hasBackLayer());
check('lobby 返回 → none', game.tryBack() === 'none');

// ========== 面板返回 ==========
section('面板返回（consumed → 回大厅）');
const navY = Game.lobbyNavY(H);
const nav = Game.LOBBY_LAYOUT.nav;
const navStates = [
  { idx: 0, name: '商店 shop', expect: 'shop' },
  { idx: 1, name: '招募 gacha', expect: 'gacha' },
  { idx: 3, name: '科技 tech', expect: 'tech_panel' },
  { idx: 4, name: '排行榜 leaderboard', expect: 'leaderboard' },
];
for (const t of navStates) {
  const x = Game.lobbyNavX(t.idx, W);
  game.handleLobbyClick(x + nav.w / 2, navY + nav.h / 2);
  game.render(0.016);
  check(`打开 ${t.name} + 占位层`, game.screenState === t.expect && hasBackLayer(), `state=${game.screenState} layer=${hasBackLayer()}`);
  browserBack(); // 模拟浏览器后退消费一层
  const r = game.tryBack();
  game.render(0.016);
  check(`返回关闭 ${t.name}（consumed）`, r === 'consumed' && game.screenState === 'lobby', `r=${r} state=${game.screenState}`);
  check(`关闭后无占位层`, !hasBackLayer());
}

// ========== 功能行面板 ==========
section('功能行面板返回');
const row = Game.LOBBY_LAYOUT.row;
const rowStates = [
  { idx: 1, name: '任务 quest', expect: 'quest' },
  { idx: 2, name: '成就 achievement', expect: 'achievement' },
  // P25 features.battlePass=false 默认：idx=3 通行证已折叠，点击不再切屏
  //   验证放在「折叠 vs 展开」分支测试（见下方）
];
for (const t of rowStates) {
  const x = Game.lobbyRowX(t.idx, W);
  game.handleLobbyClick(x + row.w / 2, row.y + row.h / 2);
  game.render(0.016);
  check(`打开 ${t.name}`, game.screenState === t.expect && hasBackLayer(), `state=${game.screenState}`);
  browserBack();
  const r = game.tryBack();
  game.render(0.016);
  check(`返回关闭 ${t.name}`, r === 'consumed' && game.screenState === 'lobby', `r=${r} state=${game.screenState}`);
}

// P25 折叠态验证：features.battlePass=false 时功能行 idx=3 不切屏
section('P25 features 折叠态：通行证点击不响应');
{
  const x = Game.lobbyRowX(3, W);
  game.handleLobbyClick(x + row.w / 2, row.y + row.h / 2);
  game.render(0.016);
  check('折叠态点击 idx=3 停留在 lobby', game.screenState === 'lobby', `state=${game.screenState}`);
}

// P25 展开态验证：临时开启 features.battlePass=true，idx=3 应能正常打开 battle_pass
section('P25 features 展开态：临时开 battlePass=true → idx=3 恢复通行');
{
  const ConfigLoader = (await import('../src/data/ConfigLoader.js')).default;
  const _cfg = ConfigLoader.get('game');
  const _origBattlePass = _cfg.features?.battlePass;
  _cfg.features = { ..._cfg.features, battlePass: true };
  const x = Game.lobbyRowX(3, W);
  game.handleLobbyClick(x + row.w / 2, row.y + row.h / 2);
  game.render(0.016);
  check('展开态 idx=3 → battle_pass', game.screenState === 'battle_pass' && hasBackLayer(), `state=${game.screenState}`);
  browserBack();
  const r = game.tryBack();
  check('展开态返回关闭 battle_pass', r === 'consumed' && game.screenState === 'lobby', `r=${r} state=${game.screenState}`);
  // 恢复折叠态
  _cfg.features = { ..._cfg.features, battlePass: _origBattlePass };
}

// ========== 布阵界面子面板 ==========
section('布阵界面返回（子面板优先）');
{
  const x = Game.lobbyNavX(2, W);
  game.handleLobbyClick(x + nav.w / 2, navY + nav.h / 2);
  game.render(0.016);
  check('打开布阵', game.screenState === 'deploy_select');
  // 模拟长按打开兵种详情
  game._unitDetailId = 'swordsman';
  browserBack();
  let r = game.tryBack();
  check('返回关闭兵种详情', r === 'consumed' && game._unitDetailId === null && game.screenState === 'deploy_select', `r=${r} detail=${game._unitDetailId}`);
  // 招募面板
  game._showRecruitPanel = true;
  browserBack();
  r = game.tryBack();
  check('返回关闭招募面板', r === 'consumed' && game._showRecruitPanel === false && game.screenState === 'deploy_select');
  // 无子面板 → 回大厅
  browserBack();
  r = game.tryBack();
  game.render(0.016);
  check('返回回大厅', r === 'consumed' && game.screenState === 'lobby', `r=${r} state=${game.screenState}`);
}

// ========== 抽卡翻卡结果 ==========
section('抽卡界面返回（先关翻卡结果）');
{
  const x = Game.lobbyNavX(1, W);
  game.handleLobbyClick(x + nav.w / 2, navY + nav.h / 2);
  game.render(0.016);
  game._gachaResults = [{ id: 'a' }, { id: 'b' }];
  game._gachaRevealIdx = 0;
  browserBack();
  const r = game.tryBack();
  check('返回先关翻卡结果', r === 'consumed' && game._gachaResults === null && game.screenState === 'gacha', `r=${r} results=${game._gachaResults} state=${game.screenState}`);
  browserBack();
  const r2 = game.tryBack();
  game.render(0.016);
  check('再返回关闭抽卡', r2 === 'consumed' && game.screenState === 'lobby');
}

// ========== 战斗内返回 ==========
section('战斗内返回（keep 保持页面，暂停功能已移除）');
{
  game.initBattle();
  game.render(0.016);
  check('开战：playing + 占位层', game.screenState === 'playing' && hasBackLayer(), `state=${game.screenState}`);
  // 返回 → keep（推回占位层保持页面；不再呼出暂停菜单）
  browserBack();
  game._onPopState();
  check('返回 → keep 不暂停', game.paused === false, `paused=${game.paused}`);
  check('返回后占位层已推回', hasBackLayer(), `layer=${hasBackLayer()}`);
  // 再返回 → 依然 keep（战斗中不退出）
  browserBack();
  game._onPopState();
  check('再返回 → 仍不暂停', game.paused === false, `paused=${game.paused}`);
  check('占位层仍保持', hasBackLayer());
  // 战斗结算 → 返回大厅（consumed）
  game.gameStatus = 'won';
  browserBack();
  const r3 = game.tryBack();
  game.render(0.016);
  check('结算返回 → 大厅', r3 === 'consumed' && game.screenState === 'lobby', `r=${r3} state=${game.screenState}`);
  check('结算后无占位层', !hasBackLayer());
}

// ========== 设置/公告子窗口 ==========
section('设置/公告子窗口返回');
{
  // 大厅打开设置 → 占位层
  game._settingsOpen = true;
  game.render(0.016);
  check('打开设置：有占位层', hasBackLayer());
  browserBack();
  const r1 = game.tryBack();
  game.render(0.016);
  check('返回关闭设置', r1 === 'consumed' && game._settingsOpen === false && game.screenState === 'lobby', `r=${r1} open=${game._settingsOpen}`);
  check('关闭设置后无占位层', !hasBackLayer());

  // 公告子窗口
  game._announceOpen = true;
  game.render(0.016);
  check('打开公告：有占位层', hasBackLayer());
  browserBack();
  const r2 = game.tryBack();
  game.render(0.016);
  check('返回关闭公告', r2 === 'consumed' && game._announceOpen === false, `r=${r2} open=${game._announceOpen}`);

  // 战斗中打开设置（战斗内返回先关设置；再返回 keep 不暂停）
  game.initBattle();
  game.render(0.016);
  game._settingsOpen = true;
  browserBack();
  const r3 = game.tryBack();
  check('战斗内设置：返回先关设置', r3 === 'consumed' && game._settingsOpen === false && game.screenState === 'playing');
  browserBack();
  const r4 = game.tryBack();
  check('再返回 → keep 不暂停（暂停已移除）', r4 === 'keep' && game.paused === false, `r=${r4} paused=${game.paused}`);
}

// ========== 手动关闭界面（非返回键）→ 占位层清除 ==========
section('手动关闭界面（点返回按钮）占位层同步');
{
  game.paused = false;
  game.screenState = 'lobby';
  game.render(0.016);
  check('回到大厅后无残留占位层', !hasBackLayer());
  // 打开商店 → 手动点左下角返回按钮关闭 → 占位层应清除
  const x = Game.lobbyNavX(0, W);
  game.handleLobbyClick(x + nav.w / 2, navY + nav.h / 2);
  game.render(0.016);
  check('打开商店有占位层', hasBackLayer());
  game.handleScreenClick(56, H - 33); // 点左下角返回按钮
  game.render(0.016);
  check('手动关闭商店 → 大厅', game.screenState === 'lobby');
  check('手动关闭后占位层已清（replaceState）', !hasBackLayer());
}

console.log(`\n结果: ${passed} 通过, ${failed} 失败`);
process.exit(failed > 0 ? 1 : 0);
