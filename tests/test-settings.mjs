// 测试: 设置窗口（声音按钮→⚙设置按钮）
// (音效/音乐独立开关 + 持久化 + 公告子窗口 + 打开期间屏蔽底层点击)
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
const { AccountManager } = await import('../src/meta/AccountManager.js');

const game = new Game(canvasStub, ctxProxy, 400, 700);
await game.start();
// 测试前置：完成新手引导（否则前4次点击被引导遮罩拦截）
ProfileManager.get().tutorialStep = 4;
ProfileManager.save();
const w = game.screenWidth;
const h = game.screenHeight;
const S = Game.SETTINGS_LAYOUT;
const panel = () => Game.settingsPanel(w, h);
const rowRect = (i) => Game.settingsRowRect(i, w, h);
const closeRect = () => Game.settingsCloseRect(w, h);

console.log('=== 测试1: 布局常量 ===');
{
  const p = panel();
  assert(p.x >= 0 && p.y >= 0 && p.x + p.w <= w && p.y + p.h <= h, `面板(${p.x},${p.y},${p.w}x${p.h})在屏内`);
  for (let i = 0; i < 3; i++) {
    const r = rowRect(i);
    assert(r.x >= p.x && r.x + r.w <= p.x + p.w && r.y >= p.y && r.y + r.h <= p.y + p.h, `第${i}行在面板内`);
  }
  assert(rowRect(0).y + rowRect(0).h <= rowRect(1).y, '行0与行1不重叠');
  assert(rowRect(1).y + rowRect(1).h <= rowRect(2).y, '行1与行2不重叠');
  assert(Array.isArray(Game.ANNOUNCEMENTS) && Game.ANNOUNCEMENTS.length > 0, '公告数据非空');
}

console.log('=== 测试2: 大厅 ⚙ 按钮 → 打开设置窗口 ===');
{
  assert(game.screenState === 'lobby' && !game._settingsOpen, '初始大厅且设置关闭');
  game.handleLobbyClick(w - 27, 25); // 原声音按钮位置
  assert(game._settingsOpen === true, '点击后设置窗口打开');
  assert(game.audioManager.muted === false, '不再直接触发静音（muted 不变）');
}

console.log('=== 测试3: 打开期间屏蔽底层界面点击 ===');
{
  const p = panel();
  game.handleScreenClick(w / 2, p.y + 28); // 面板内标题区（非按钮）
  assert(game._settingsOpen === true, '面板内非按钮区点击不关闭');
  game.handleScreenClick(10, 10); // 面板外 → 关闭但不透传到底层
  assert(game._settingsOpen === false, '点击面板外关闭窗口');
  assert(game.screenState === 'lobby', '关闭点击不透传到底层（未触发其他界面）');
  // 重新打开，验证面板内点击屏蔽底层
  game.handleLobbyClick(w - 27, 25);
  assert(game._settingsOpen === true, '重新打开');
  const r0 = rowRect(0);
  game.handleScreenClick(r0.x + 20, r0.y - 8); // 行间空隙（面板内、非按钮）
  assert(game._settingsOpen === true && game.screenState === 'lobby', '面板内空隙点击完全屏蔽');
}

console.log('=== 测试4: 音效开关切换 + 持久化 ===');
{
  const before = game.audioManager.sfxEnabled;
  const r0 = rowRect(0);
  game.handleScreenClick(r0.x + 20, r0.y + r0.h / 2);
  assert(game.audioManager.sfxEnabled === !before, `音效开关已切换(${before}→${game.audioManager.sfxEnabled})`);
  assert(ProfileManager.get().settings.sfx === !before, 'profile.settings.sfx 已保存');
  const profileKey = AccountManager.getCurrentId() ? `territory_king_profile_${AccountManager.getCurrentId()}` : 'territory_king_profile';
  const raw = global.localStorage.getItem(profileKey);
  assert(raw && raw.includes(`"sfx":${!before}`), 'localStorage 中已持久化');
  // 切回
  game.handleScreenClick(r0.x + 20, r0.y + r0.h / 2);
  assert(game.audioManager.sfxEnabled === before, '音效开关切回');
}

console.log('=== 测试5: 背景音乐开关切换 + 持久化 ===');
{
  const before = game.audioManager.bgmEnabled;
  const r1 = rowRect(1);
  game.handleScreenClick(r1.x + 20, r1.y + r1.h / 2);
  assert(game.audioManager.bgmEnabled === !before, `音乐开关已切换(${before}→${game.audioManager.bgmEnabled})`);
  assert(ProfileManager.get().settings.bgm === !before, 'profile.settings.bgm 已保存');
  game.handleScreenClick(r1.x + 20, r1.y + r1.h / 2);
  assert(game.audioManager.bgmEnabled === before, '音乐开关切回');
}

console.log('=== 测试6: 公告按钮 → 公告子窗口 ===');
{
  const r3 = rowRect(3); // 0=音效 1=音乐 2=震动 3=公告
  game.handleScreenClick(r3.x + 20, r3.y + r3.h / 2);
  assert(game._announceOpen === true, '公告窗口打开');
  assert(game._settingsOpen === true, '设置窗口保持打开');
  // 公告打开期间点设置面板内区域不触发开关
  const r0 = rowRect(0);
  const sfxBefore = game.audioManager.sfxEnabled;
  game.handleScreenClick(r0.x + 20, r0.y + r0.h / 2);
  assert(game.audioManager.sfxEnabled === sfxBefore, '公告期间音效开关不误触发');
}

console.log('=== 测试6b: 震动开关切换 ===');
{
  game._announceOpen = false; // 直接重置公告（保留设置窗口打开态）
  const r2 = rowRect(2);
  const hapticBefore = game.audioManager.hapticEnabled;
  game.handleScreenClick(r2.x + 20, r2.y + r2.h / 2);
  assert(game.audioManager.hapticEnabled !== hapticBefore, '震动开关切换');
  assert(ProfileManager.get().settings.haptic === game.audioManager.hapticEnabled, '震动设置持久化');
  game.handleScreenClick(r2.x + 20, r2.y + r2.h / 2); // 还原
  assert(game.audioManager.hapticEnabled === hapticBefore, '震动开关还原');
}

console.log('=== 测试7: 公告窗口关闭 ===');
{
  // 重新打开公告（测试6b 已重置为关闭态）
  const r3 = rowRect(3);
  game.handleScreenClick(r3.x + 20, r3.y + r3.h / 2);
  assert(game._announceOpen === true, '重新打开公告');
  game.handleScreenClick(10, h - 10); // 面板外
  assert(game._announceOpen === false, '点击面板外关闭公告');
  assert(game._settingsOpen === true, '设置窗口不受影响');
}

console.log('=== 测试8: 设置窗口关闭（✕ 与面板外） ===');
{
  const cb = closeRect();
  game.handleScreenClick(cb.x + 5, cb.y + 5);
  assert(game._settingsOpen === false, '✕ 关闭设置窗口');
  // 重新打开后点面板外关闭
  game.handleLobbyClick(w - 27, 25);
  assert(game._settingsOpen === true, '重新打开');
  game.handleScreenClick(5, 5);
  assert(game._settingsOpen === false, '点击面板外关闭');
}

console.log('=== 测试9: 关闭后底层界面恢复可点 ===');
{
  // 确保回到大厅（测试3曾把状态留在其他界面时重置）
  game.screenState = 'lobby';
  game.paused = false;
  const blY = Game.lobbyBattleY(h);
  game.handleScreenClick(w / 2, blY + 20);
  // 异步匹配：单击进入 searching → 立即触发检索成功 → 进入对战
  assert(game._asyncState === 'searching', '开战按钮命中 → 进入异步匹配');
  if (game._matchFoundTimer) { clearTimeout(game._matchFoundTimer); game._matchFoundTimer = null; }
  if (game._matchTimeout) { clearTimeout(game._matchTimeout); game._matchTimeout = null; }
  game._onAsyncOpponentFound();
  assert(game.screenState === 'playing' && game.gameStatus === 'playing', '检索成功后进入对战');
  // 清理
  game._cancelAsyncMatch();
  game.screenState = 'lobby';
}

console.log('=== 测试10: 对战中 ⚙ 按钮也能打开设置 ===');
{
  game.handlePlayingClick(w - 75, 22); // 对战界面右上 ⚙
  assert(game._settingsOpen === true, '对战界面打开设置窗口');
  // 对战中底层点击被屏蔽（原暂停按钮位置已无任何功能）
  game.handleScreenClick(w - 30, 22);
  assert(game.paused === false, '原暂停按钮位置无效果（暂停已移除）');
  game._settingsOpen = false;
}

console.log('=== 测试11: 设置持久化 → 重启恢复 ===');
{
  ProfileManager.get().settings = { sfx: false, bgm: false };
  ProfileManager.save();
  const game2 = new Game(canvasStub, ctxProxy, 400, 700);
  await game2.start();
  assert(game2.audioManager.sfxEnabled === false, '重启后音效开关恢复为关');
  assert(game2.audioManager.bgmEnabled === false, '重启后音乐开关恢复为关');
  // 还原
  game2._handleSettingsTap(Game.settingsRowRect(0, w, h).x + 20, Game.settingsRowRect(0, w, h).y + 20);
  game2._handleSettingsTap(Game.settingsRowRect(1, w, h).x + 20, Game.settingsRowRect(1, w, h).y + 20);
  assert(game2.audioManager.sfxEnabled === true && game2.audioManager.bgmEnabled === true, '还原为开');
}

console.log('=== 测试12: 设置/公告窗口渲染冒烟 ===');
{
  let ok = true;
  try {
    game.screenState = 'lobby';
    game._settingsOpen = true; game._announceOpen = false;
    game.render(0.016);
    game._announceOpen = true;
    game.render(0.016);
    game._settingsOpen = false; game._announceOpen = false;
    game.initBattle(); // playing 渲染需要完整对战状态（地图/玩家）
    game.render(0.016);
  } catch (e) { ok = false; console.log('    异常:', e.message); }
  assert(ok, '三种状态渲染无异常');
}

console.log(`\n结果: ${passed} 通过, ${failed} 失败`);
process.exit(failed > 0 ? 1 : 0);
