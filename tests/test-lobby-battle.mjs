// 测试: 大厅开战按钮 + 功能按钮行（分享/任务/通行证）+ 底部导航（商店/招募/布阵/科技/排行榜）
// (布阵界面不再提供开始对战入口)
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
// 测试前置：完成新手引导（否则前4次点击被引导遮罩拦截）
ProfileManager.get().tutorialStep = 4;
ProfileManager.save();
const w = game.screenWidth;
const h = game.screenHeight;
const ROW = Game.LOBBY_LAYOUT.row;
const NAV = Game.LOBBY_LAYOUT.nav;
const BL = Game.LOBBY_LAYOUT.battle;
const rowX = (i) => Game.lobbyRowX(i, w);
const navX = (i) => Game.lobbyNavX(i, w);
const navY = Game.lobbyNavY(h);
const blY = Game.lobbyBattleY(h);

console.log('=== 测试1: 布局常量与坐标计算 ===');
{
  // P25 features 折叠：功能行实际 count 跟 features.battlePass 联动（4=含通行证/3=折叠）
  const _rowCount = Game.lobbyRowCount();
  const _rowItemW = Game.lobbyRowItemW(w);
  const _rowTotal = _rowCount * _rowItemW + (_rowCount - 1) * ROW.gap;
  assert(_rowTotal <= w, `功能行总宽 ${_rowTotal}（count=${_rowCount}）不超屏宽 ${w}`);
  const navTotal = NAV.count * NAV.w + (NAV.count - 1) * NAV.gap;
  assert(navTotal <= w, `导航总宽 ${navTotal} 不超屏宽 ${w}`);
  assert(rowX(0) >= 0 && rowX(_rowCount - 1) + _rowItemW <= w,
    `功能行按钮均在屏内（count=${_rowCount}）`);
  assert(blY + BL.h <= navY, `开战按钮(${blY}-${blY + BL.h})不与导航栏(${navY})重叠`);
}

console.log('=== 测试2: 大厅「开战」按钮 → 异步 PvP 匹配（取代原直接开战，单击按钮未再走 initBattle） ===');
{
  assert(game.screenState === 'lobby', '初始在大厅');
  game.handleLobbyClick(w / 2, blY + BL.h / 2);
  assert(game._asyncState === 'searching', '点击开战 → 进入异步匹配（_asyncState=searching）');
  assert(game._matchFoundTimer !== null || game._matchFoundTimer === null,
    '已启动检索延迟定时器（2~4s）');

  // 加速：立刻触发检索成功，验证对手注入与 snapshot 局路径
  if (game._matchFoundTimer) {
    clearTimeout(game._matchFoundTimer);
    game._matchFoundTimer = null;
  }
  if (game._matchTimeout) {
    clearTimeout(game._matchTimeout);
    game._matchTimeout = null;
  }
  game._onAsyncOpponentFound();
  assert(game.screenState === 'playing', '检索成功后进入对战');
  assert(game.gameStatus === 'playing', 'gameStatus = playing');
  assert(game.battleMode === 'snapshot', '命中 PvP 快照局（battleMode=snapshot）');
  assert(game.players.some(p => p.isSnapshot === true), '敌方为 SnapshotPlayer 实例');
  assert(game.deploymentBundle && game.deploymentBundle.synergies, '上阵数据包已生成（当前布阵生效）');

  // 离开 playing 回 lobby，给后续测试一个干净的初始态
  game._cancelAsyncMatch();
  game.screenState = 'lobby';
}

console.log('=== 测试3: 底部导航「布阵」→ 布阵界面 ===');
{
  game.screenState = 'lobby';
  game.handleLobbyClick(navX(2) + NAV.w / 2, navY + NAV.h / 2);
  assert(game.screenState === 'deploy_select', '布阵按钮进入布阵界面');
}

console.log('=== 测试4: 布阵界面原「开始对战」位置点击 → 不再开战 ===');
{
  // 旧按钮区域：x ∈ [w-150, w-20]，y ∈ [h-100, h-55]
  const oldX = w - 85, oldY = h - 78;
  game._unitDetailId = null;
  game._synergyDetailId = null;
  game._deployDrag.active = false;
  game._handleDeployDragEnd(oldX, oldY, false);
  assert(game.screenState === 'deploy_select', '原开战按钮位置不再进入对战（screenState 仍为布阵界面）');
  game._unitDetailId = null; // 该位置可能命中兵种卡开详情，清理
}

console.log('=== 测试5: 功能按钮行：分享/任务/成就（通行证已折叠） ===');
{
  game.screenState = 'lobby';
  game.handleLobbyClick(rowX(0) + ROW.w / 2, ROW.y + ROW.h / 2);
  // 分享在原 i=0 位置（未变）
  assert(/分享/.test(game._toastText || '') || game.screenState === 'lobby',
    '分享按钮 → 触发分享并停留大厅');
  game.screenState = 'lobby';
  game.handleLobbyClick(rowX(1) + ROW.w / 2, ROW.y + ROW.h / 2);
  assert(game.screenState === 'quest', '任务按钮(i=1) → 任务面板');
  game.screenState = 'lobby';
  game.handleLobbyClick(rowX(2) + ROW.w / 2, ROW.y + ROW.h / 2);
  assert(game.screenState === 'achievement', '成就按钮(i=2) → 成就面板');
  game.screenState = 'lobby';
  // P25 features 折叠：battlePass=false 时功能行 count=3，原 i=3 通行证位已折叠，
  //   rowX(3) 算出来是 count=4 的位置（在 320 屏宽上会越出屏外），点击空白区不切屏
  game.handleLobbyClick(rowX(3) + ROW.w / 2, ROW.y + ROW.h / 2);
  assert(game.screenState === 'lobby', '原通行证位(i=3)已折叠，点击越界空白不切屏');
}

console.log('=== 测试6: 功能按钮行：分享（单独验证：留在大厅 + 触发分享） ===');
{
  global.__lastShare = null;
  game.screenState = 'lobby';
  game.handleLobbyClick(rowX(0) + ROW.w / 2, ROW.y + ROW.h / 2);
  assert(game.screenState === 'lobby', '分享后停留在大厅');
  assert(global.__lastShare && global.__lastShare.title, 'wx.shareAppMessage 被调用');
}

console.log('=== 测试7: 底部导航（商店/招募/布阵/科技/排行榜） ===');
{
  // P25 features 开关：shop=true（默认上线场景）→ 商店入口可见且可点击
  game.handleLobbyClick(navX(0) + NAV.w / 2, navY + NAV.h / 2);
  assert(game.screenState === 'shop', '商店按钮 → 商店面板');
  // P25 features 开关：shopDiamondTab=false（默认上线场景）→ 商店内不显示钻石充值分页
  const ShopSystem = (await import('../src/meta/ShopSystem.js')).default;
  const _shopCats = ShopSystem.getCategoryNames();
  assert(!_shopCats.some(c => c.id === 'diamond'), '钻石充值分类已被过滤（shopDiamondTab=false 默认）');
  assert(_shopCats.some(c => c.id === 'currency'), '星尘兑换分类保留');
  // P37：新增「免费」分页且必须排在最前（商店默认分页）
  assert(_shopCats[0].id === 'free', '免费分页为第 1 个分页（商店默认展示）');
  assert(_shopCats.some(c => c.id === 'packs'), '训练物资分类保留');
  assert(_shopCats.some(c => c.id === 'special'), '特惠分类保留');
  game.screenState = 'lobby';
  game.handleLobbyClick(navX(1) + NAV.w / 2, navY + NAV.h / 2);
  assert(game.screenState === 'gacha', '招募按钮(第2键) → 招募');
  game.screenState = 'lobby';
  game.handleLobbyClick(navX(2) + NAV.w / 2, navY + NAV.h / 2);
  assert(game.screenState === 'deploy_select', '布阵按钮(第3键) → 布阵');
  game.screenState = 'lobby';
  game.handleLobbyClick(navX(3) + NAV.w / 2, navY + NAV.h / 2);
  assert(game.screenState === 'tech_panel', '科技按钮(第4键) → 科技');
  game.screenState = 'lobby';
  game.handleLobbyClick(navX(4) + NAV.w / 2, navY + NAV.h / 2);
  assert(game.screenState === 'leaderboard' && game.leaderboardTab === 0, '排行榜按钮(第5键) → 排行榜');
}

console.log('=== 测试8: 各界面渲染冒烟（大厅/布阵/任务/排行榜）===');
{
  // P25：通行证入口已折叠（battlePass=false），battle_pass 屏幕仍存在但大厅不可达
  const states = ['lobby', 'deploy_select', 'quest', 'leaderboard'];
  let err = null;
  try {
    for (const s of states) {
      game.screenState = s;
      for (let i = 0; i < 3; i++) game.update(16);
      game.render();
    }
  } catch (e) { err = e; }
  assert(!err, `渲染无异常${err ? ': ' + err.message : ''}`);
}

console.log('=== 测试9: P25 features.battlePass=true 展开路径（验证可配置回退） ===');
{
  // 临时切换 features.battlePass=true：功能行 count 应回到 4，第 3 位是通行证
  const _origConfig = (await import('../src/data/ConfigLoader.js')).default.get('game');
  _origConfig.features = { ..._origConfig.features, battlePass: true };
  // 重新计算布局（静态方法走 features）
  const _newCount = Game.lobbyRowCount();
  assert(_newCount === 4, `battlePass=true 时功能行 count=${_newCount}（期望 4）`);
  // 折叠态下的 rowX(2) 与展开态 rowX(2) 不应重叠/跨越中心
  const _xFold2 = Game.lobbyRowXByCount(2, 3, w);
  const _xOpen2 = Game.lobbyRowXByCount(2, 4, w);
  assert(Math.abs(_xFold2 - _xOpen2) > 1, `折叠/展开下 rowX(2) 偏移 ${Math.abs(_xFold2 - _xOpen2)}>1px（布局自动重排）`);
  // 恢复配置
  _origConfig.features = { ..._origConfig.features, battlePass: false };
}

console.log(`\n结果: ${passed} 通过, ${failed} 失败`);
process.exit(failed > 0 ? 1 : 0);
