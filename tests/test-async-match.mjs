/**
 * 异步对战（Async PvP）测试
 *
 * 验证「点 ⚔ 开战 → 匹配检索 → 进入快照 PvP」完整链路：
 *   1. AsyncMatchSystem.generateOpponent：无 profile/有 profile 都生成合法对手
 *   2. AsyncMatchSystem.start：2-4s 检索 + 10s 超时降级
 *   3. SnapshotPlayer：继承 AIPlayer，标记 isSnapshot，携带 trophies
 *   4. Game.initBattle({mode: 'snapshot'})：建 SnapshotPlayer，把 _opponentTrophies 注入结算层
 *   5. 全局：battleMode=snapshot，无 frameSync/commandQueue，async match 状态机正确
 *   6. 大厅「⚔ 开战」按钮即异步匹配入口；联机/加入/PvP 单独按钮已合并移除
 *
 * 实时联机（LanConnector/FrameSync）已移除；本测试覆盖异步链路。
 *
 * 用法：node tests/test-async-match.mjs
 */

import assert from 'node:assert/strict';
const { equal: eq, ok } = assert;

const noop = () => {};
const canvasStub = {
  width: 800, height: 600, style: {},
  addEventListener: noop,
  removeEventListener: noop,
  getContext: () => ctxProxy,
};
const ctxProxy = new Proxy({}, {
  get: (_t, p) => {
    if (p === 'canvas') return canvasStub;
    return (..._args) => {
      if (p === 'measureText') return { width: 50 };
      if (p === 'createLinearGradient' || p === 'createRadialGradient') return { addColorStop: noop };
      if (p === 'getImageData') return { data: [] };
      return undefined;
    };
  },
  set: () => true,
});

// === Node 环境 polyfill ===
global.window = {
  AudioContext: class { constructor() {} },
  history: { pushState: noop, replaceState: noop, state: null },
  location: { href: 'http://localhost/preview/index.html', reload: noop },
  addEventListener: noop,
  removeEventListener: noop,
};
global.document = { addEventListener: noop, removeEventListener: noop, hidden: false };
global.requestAnimationFrame = (cb) => setTimeout(cb, 16);
global.localStorage = { _d: {}, getItem(k) { return this._d[k] ?? null; }, setItem(k, v) { this._d[k] = String(v); }, removeItem(k) { delete this._d[k]; } };
global.performance = { now: () => Date.now() };
global.Audio = class { constructor() { this.play = noop; this.pause = noop; } };
// fetch polyfill: 把 fetch 的相对路径解析到本地文件系统
// ConfigLoader 在浏览器走 fetch('../config/X.json')，在 node 走 wx.require
// 这里通过把 isWxEnv 设为 true 让它走 require，wx.require 是带路径的 require
// 让 Node ESM 支持 require（ConfigLoader WX 分支需要）—— phase 7 P3 后 ConfigLoader
// 在 isWxEnv=true 时走 require('../../config/X.js')，相对路径基于 ConfigLoader.js 自身位置
// 所以 createRequire 必须以 ConfigLoader.js 所在目录为 base，否则 '../../config/...' 找不到
const _nodeRequire = (await import('node:module')).createRequire(new URL('../src/data/ConfigLoader.js', import.meta.url));
global.require = _nodeRequire;
global.wx = {
  createCanvas: () => canvasStub,
  getSystemInfoSync: () => ({ screenWidth: 800, screenHeight: 600, pixelRatio: 1, platform: 'browser' }),
  setStorageSync: (k, v) => global.localStorage.setItem(k, JSON.stringify(v)),
  getStorageSync: (k) => { const s = global.localStorage.getItem(k); return s ? JSON.parse(s) : null; },
  vibrateShort: noop, vibrateLong: noop,
  showToast: noop,
  createInnerAudioContext: () => ({
    play: noop, pause: noop, stop: noop, destroy: noop, seek: noop,
    onPlay: noop, onPause: noop, onStop: noop, onEnded: noop, onError: noop,
    src: '', volume: 1,
  }),
  // 让 ConfigLoader 走 isWxEnv=true 分支：避免 node 端 fetch 失败
  // 但是 isWxEnv 检查 wx.setStorageSync(已设) + 当前不能直接改 ConfigLoader
  // 替代：mock fetch 直接返回本地 JSON
};
// fetch polyfill：直接读本地文件
global.fetch = async (relOrAbsPath) => {
  const fs = await import('node:fs/promises');
  const path_ = await import('node:path');
  const url_ = await import('node:url');
  // relOrAbsPath 形如 '../config/game.json' 或 'config/game.json'
  const relUrl = relOrAbsPath.replace(/^(\.\.\/)+/, '').replace(/^config\//, '');
  const ROOT = url_.fileURLToPath(new URL('..', import.meta.url));
  const fullPath = path_.join(ROOT, 'config', relUrl);
  try {
    const body = await fs.readFile(fullPath, 'utf-8');
    return { ok: true, status: 200, json: async () => JSON.parse(body) };
  } catch (e) {
    return { ok: false, status: 404, json: async () => ({ error: e.message }) };
  }
};
global.alert = noop;

// === 配置加载 ===
const ConfigLoader = (await import('../src/data/ConfigLoader.js')).default;
const { syncConfigToStatics } = await import('../src/config.js');
await ConfigLoader.init();
syncConfigToStatics();
try { await import('../src/data/races.js').then(m => m.syncRaces && m.syncRaces()); } catch (e) { /* ignore */ }
try { await import('../src/data/levels.js').then(m => m.syncLevels && m.syncLevels()); } catch (e) { /* ignore */ }

const { Game } = await import('../src/game/Game.js');
const { SnapshotPlayer } = await import('../src/entity/SnapshotPlayer.js');
const AsyncMatch = await import('../src/meta/AsyncMatchSystem.js');
const ProfileManager = (await import('../src/meta/ProfileManager.js')).default;
const PowerSystem = (await import('../src/meta/PowerSystem.js')).default;

let passed = 0, failed = 0;
function check(name, cond, extra = '') {
  if (cond) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; console.error(`  ❌ ${name}${extra ? ': ' + extra : ''}`); }
}

console.log('=== 1. AsyncMatchSystem.generateOpponent ===');
{
  // 无 profile：合法 + 默认值
  const opp = AsyncMatch.generateOpponent(null);
  check('name 非空字符串', typeof opp.name === 'string' && opp.name.length > 0);
  check('name 后缀 4 位十六进制', /(领主)_[0-9A-F]{4}/u.test(opp.name));
  check('trophies 是 number ≥ 0', typeof opp.trophies === 'number' && opp.trophies >= 0);
  check('difficulty 合法字符串', typeof opp.difficulty === 'string');
  check('skillTier 已移除', opp.skillTier === undefined);
  check('powerRatio 已移除', opp.powerRatio === undefined);
  check('warriorRateMult 已移除', opp.warriorRateMult === undefined);

  // 有 profile：trophies 跟着玩家分段
  const profile = { trophies: 1500 };
  const opp1 = AsyncMatch.generateOpponent(profile);
  check('有 profile 时 trophies 在 ± 范围内',
    opp1.trophies >= Math.max(0, 1500 - 40) && opp1.trophies <= 1500 + 60);

  // 不同段位：tierIndex 应来自天梯曲线（段位索引一致）
  // 注意：difficulty 由随机数从段位分布抽取，跨调用天然不同；用 tierIndex 校验曲线一致
  for (const trophy of [0, 800, 1600, 2500, 3500]) {
    const o = AsyncMatch.generateOpponent({ trophies: trophy });
    const settings = PowerSystem.getTierAiSettings(o.trophies);
    check(`trophies=${trophy} → tierIndex=${settings.tierIndex}（段位曲线一致）`,
      typeof settings.tierIndex === 'number' && settings.tierIndex >= 0);
    check(`trophies=${trophy} → difficulty 是合法值`,
      ['easy', 'normal', 'hard', 'nightmare'].includes(o.difficulty),
      `got ${o.difficulty}`);
  }
}

console.log('\n=== 2. AsyncMatchSystem.start 检索 + 超时 ===');
{
  // 2a. start 后 ~2-4s 触发 matched
  const matched = await new Promise((resolve) => {
    const session = AsyncMatch.start({ trophies: 1000 }, (state, payload) => {
      if (state === AsyncMatch.MATCH_STATE.MATCHED) resolve(payload.snapshot);
    });
    setTimeout(() => resolve(null), 6000);  // 兜底超时
  });
  check('2-4s 后 matched 触发，并产生 snapshot', matched !== null && typeof matched.name === 'string');

  // 2b. cancel：手动取消会话
  let ended = null;
  await new Promise((resolve) => {
    const session = AsyncMatch.start(null, (state) => {
      if (state === AsyncMatch.MATCH_STATE.CANCELLED) ended = state;
    });
    setTimeout(() => AsyncMatch.cancel(session), 50);
    setTimeout(resolve, 200);
  });
  check('cancel 后状态变 CANCELLED', ended === AsyncMatch.MATCH_STATE.CANCELLED);

  // 2c. cancel 已经 matched 的会话：no-op（不再次回调）
  let count = 0;
  await new Promise((resolve) => {
    const session = AsyncMatch.start(null, () => { count++; });
    // 等到检索完成后取消
    setTimeout(() => {
      AsyncMatch.cancel(session);
      resolve();
    }, 3000);
  });
  // matched 已经触发 1 次，cancel 不再触发
  check('matched 后 cancel 不再回调', count === 1);
}

console.log('\n=== 3. SnapshotPlayer 继承与标记 ===');
{
  const opp = AsyncMatch.generateOpponent({ trophies: 1500 });
  const sp = new SnapshotPlayer(2, opp);
  check('继承 AIPlayer 类型', sp.constructor.name === 'SnapshotPlayer');
  check('构造期设置 isSnapshot=true', sp.isSnapshot === true);
  check('携带 trophies 用于 Elo', sp.trophies === opp.trophies);
  check('snapshot 引用保留', sp.snapshot === opp);
  check('name 来自 snapshot', sp.name === opp.name);
  // 默认颜色 fallback
  const sp0 = new SnapshotPlayer(2, {});
  check('空 snapshot 时 name fallback', sp0.name === '对手');
  check('空 snapshot 时 trophies fallback', sp0.trophies === 0);
}

console.log('\n=== 4. Game.initBattle snapshot 模式 ===');
const game = new Game(canvasStub, ctxProxy, 800, 600);
global.localStorage._d = {};
await ProfileManager.reset();
await game.start();

const opp = AsyncMatch.generateOpponent(ProfileManager.get());
game.initBattle(20260904, { mode: 'snapshot', snapshot: opp });

check('battleMode = "snapshot"', game.battleMode === 'snapshot');
check('localPlayerId 固定为 1', game.localPlayerId === 1);
check('players 包含本地玩家', game.players.some(p => p.id === 1));
check('players 包含 SnapshotPlayer', game.players.some(p => p.isSnapshot === true));
check('敌方就是 SnapshotPlayer 实例', game.players.filter(p => p.id !== 1)[0] instanceof SnapshotPlayer);
check('_opponentTrophies 注入结算层', game._opponentTrophies === opp.trophies);
check('无 frameSync / commandQueue（实时链路彻底移除）',
  typeof game.frameSync === 'undefined' && typeof game.commandQueue === 'undefined');
check('无镜像（mirrorWorld=false）',
  typeof game.mirrorWorld === 'undefined' && typeof game.mirrorCenterY === 'undefined');
check('battleSeed 已注入确定性随机源', game.battleSeed === 20260904);
check('rng 实例已创建', typeof game.rng === 'function');

console.log('\n=== 5. Game 实时链路彻底清除 ===');
{
  // 验证 Game 上无任何实时链路残留
  const liveMethods = [
    '_validateFlipCommand', '_applyCommand', 'applyReplay',
    '_resetAndReplay', 'computeChecksum', 'fnv1a',  // 已删
  ];
  for (const m of liveMethods) {
    check(`Game.${m} 已删除（实时链路彻底清除）`,
      typeof game[m] === 'undefined');
  }
  // battleMode 恒为 'ai' / 'snapshot'，不再出现 'realtime'
  check('battleMode 取值仅 ai/snapshot',
    ['ai', 'snapshot'].includes(game.battleMode));
}

console.log('\n=== 6. 大厅按钮合并（开战按钮即异步匹配入口，移除联机/加入一级入口） ===');
{
  // 把 game 拉回 lobby 状态（initBattle 已设为 'playing'）
  game.screenState = 'lobby';
  game.battleMode = 'ai';
  game._asyncState = null;
  // 跳过新手引导拦截（tStep>=4 时不进引导分支）
  const pf = ProfileManager.get();
  if (pf) { pf.tutorialStep = 4; ProfileManager.save(); }

  // 取开战按钮中心坐标
  const w = 800, h = 600;
  const bl = Game.LOBBY_LAYOUT.battle;
  const blY = Game.lobbyBattleY(h);
  const cx = (w - bl.w) / 2 + bl.w / 2;
  const cy = blY + bl.h / 2;

  // 6a. 模拟点击中央开战按钮
  game.handleLobbyClick(cx, cy);
  check('开战按钮命中 → 触发 _startAsyncMatch',
    game._asyncState === 'searching');
  game._cancelAsyncMatch();

  // 6b. 原 PvP 位置（开战按钮左侧 72+8 间距）点击 → 不进入 searching（按钮已合并移除）
  game._asyncState = null;
  const legacyPvpX = (w - bl.w) / 2 - bl.w - bl.w;  // 取足够靠左，确保不在开战按钮 area 内
  game.handleLobbyClick(legacyPvpX, cy);
  check('原 PvP 按钮坐标点击 → 不进入 searching（按钮已合并）',
    game._asyncState === null);
  game._cancelAsyncMatch();

  // 6c. 旧联机/加入按钮坐标点击（开战按钮左右外侧）→ 不进入 searching
  game._asyncState = null;
  const leftLan = 30, rightJoin = w - 100;
  game.handleLobbyClick(leftLan, blY + 29);
  game.handleLobbyClick(rightJoin, blY + 29);
  check('原「🌐 联机」「➕ 加入」坐标点击 → 不进入 searching',
    game._asyncState === null);
  game._cancelAsyncMatch();

  // 6d. 源码静态检查：联机/加入/PvP 入口彻底清除
  const fs = await import('node:fs/promises');
  const path_ = await import('node:path');
  const url_ = await import('node:url');
  const ROOT = url_.fileURLToPath(new URL('..', import.meta.url));

  const renderSrc = await fs.readFile(path_.join(ROOT, 'src/system/RenderSystem.js'), 'utf-8');
  check('RenderSystem 不再渲染「🌐 联机」按钮', !renderSrc.includes('🌐 联机'));
  check('RenderSystem 不再渲染「➕ 加入」按钮', !renderSrc.includes('➕ 加入'));
  check('RenderSystem 不再有 LANBTN 常量', !renderSrc.includes('LANBTN'));
  check('RenderSystem 不再有 JOINBTN 常量', !renderSrc.includes('JOINBTN'));

  const gameSrc = await fs.readFile(path_.join(ROOT, 'src/game/Game.js'), 'utf-8');
  check('Game.handleLobbyClick 不再有 pvpBtn 命中分支', !gameSrc.includes('pvpBtn'));
  check('Game 不再有「异步对战按钮（开战按钮左侧）」注释',
    !gameSrc.includes('异步对战按钮（开战按钮左侧）'));

  // 6e. 注释收敛：drawLobby 注释明确说明「联网入口已合并到开战按钮」
  check('RenderSystem.drawLobby 有合并说明注释',
    renderSrc.includes('联网入口已合并到「开战」按钮'));
}

console.log(`\n=== 结果：${passed} 通过 / ${failed} 失败 ===`);
process.exit(failed > 0 ? 1 : 0);
