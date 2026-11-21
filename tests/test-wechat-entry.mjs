/**
 * 微信小游戏真机入口（game.js）测试 — Phase 7
 *
 * 验证入口的 4 项职责：
 *   1. 启动链路：new Game → game.start() 被调用（P0 修复回归）→ 配置加载完成进大厅
 *   2. 屏幕信息：优先 wx.getWindowInfo（getSystemInfoSync 已废弃，mock 为 throw 证明未被调用）
 *   3. 被动分享注册：wx.showShareMenu + onShareAppMessage + onShareTimeline
 *   4. Android 返回键：wx.onKeyDown → tryBack；大厅=退出，面板=关闭，战斗=keep
 *   5. 工程配置：project.config.json packOptions 排除无关文件；game.json 合法
 *
 * 用法：node tests/test-wechat-entry.mjs
 */

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const noop = () => {};

let passed = 0, failed = 0;
function check(name, cond, extra = '') {
  if (cond) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; console.error(`  ❌ ${name}${extra ? ': ' + extra : ''}`); }
}

// === Canvas / ctx stub ===
const canvasStub = {
  width: 0, height: 0, style: {},
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

// === 浏览器侧全局（Game 类内部分支兼容） ===
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
global.alert = noop;

// === fetch polyfill：读本地 config/ 文件（ConfigLoader 走浏览器分支） ===
global.fetch = async (relOrAbsPath) => {
  const relUrl = String(relOrAbsPath).replace(/^(\.\.\/)+/, '').replace(/^config\//, '');
  const fullPath = path.join(ROOT, 'config', relUrl);
  try {
    const body = await fs.readFile(fullPath, 'utf-8');
    return { ok: true, status: 200, json: async () => JSON.parse(body) };
  } catch (e) {
    return { ok: false, status: 404, json: async () => ({ error: e.message }) };
  }
};

// === wx mock（在 import game.js 之前就位） ===
const spies = {
  showShareMenu: [],
  exitMiniProgram: 0,
  getApp: null,
};
let appShareHandler = null;
let timelineHandler = null;
let keyHandler = null;
// 特征值：证明用的是 getWindowInfo；safeArea 证明入口把安全区接到了 Game（灵动岛适配回归）
const WIN = {
  screenWidth: 812, screenHeight: 375, pixelRatio: 2,
  safeArea: { top: 44, bottom: 331, left: 0, right: 812, width: 812, height: 300 },
};

// 让 Node ESM 支持 require（ConfigLoader WX 分支需要）
global.require = (await import('node:module')).createRequire(new URL('../src/data/ConfigLoader.js', import.meta.url));

global.wx = {
  createCanvas: () => canvasStub,
  // 新 API：优先分支
  getWindowInfo: () => ({ ...WIN }),
  // 旧 API：已废弃，mock 为 throw —— 若被调用即测试失败
  getSystemInfoSync: () => { throw new Error('getSystemInfoSync should not be called (deprecated)'); },
  // 存储（AccountManager / ProfileManager / SessionManager 使用）
  setStorageSync: (k, v) => global.localStorage.setItem(k, JSON.stringify(v)),
  getStorageSync: (k) => { const s = global.localStorage.getItem(k); return s ? JSON.parse(s) : null; },
  removeStorageSync: (k) => global.localStorage.removeItem(k),
  // 分享注册（spies）
  showShareMenu: (opts) => { spies.showShareMenu.push(opts); },
  onShareAppMessage: (fn) => { appShareHandler = fn; },
  onShareTimeline: (fn) => { timelineHandler = fn; },
  // 返回键
  onKeyDown: (fn) => { keyHandler = fn; },
  exitMiniProgram: () => { spies.exitMiniProgram++; },
  // 其它
  vibrateShort: noop, vibrateLong: noop,
  showToast: noop,
  createInnerAudioContext: () => ({
    play: noop, pause: noop, stop: noop, destroy: noop, seek: noop,
    onPlay: noop, onPause: noop, onStop: noop, onEnded: noop, onError: noop,
    src: '', volume: 1,
  }),
};

// === 导入真机入口（顶层副作用立即执行：建 Canvas / new Game / start() / 分享注册 / 返回键注册） ===
await import('../game.js');

// === 等待 game.start() 完成（配置加载 + 进大厅），15s 超时 ===
async function waitFor(cond, timeoutMs = 15000, label = 'condition') {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if (cond()) return true;
    await new Promise(r => setTimeout(r, 50));
  }
  return false;
}
const game = globalThis.__game;
// 就绪信号：sessionManager 在 start() 第 4.2 步创建（晚于配置加载/同步），
// screenState 构造时即默认 'lobby' 不能单独作为就绪依据
const started = await waitFor(() => game && game.sessionManager && game.screenState === 'lobby');

console.log('\n=== 1. 启动链路（P0 修复回归：start() 必须被调用） ===');
{
  check('globalThis.__game 调试钩子已暴露', !!game);
  check('game.start() 已执行 → 配置加载完成进入大厅', started, `screenState=${game && game.screenState}`);
  check('Canvas 尺寸 = screenWidth × pixelRatio（高分屏适配）',
    canvasStub.width === WIN.screenWidth * WIN.pixelRatio && canvasStub.height === WIN.screenHeight * WIN.pixelRatio,
    `canvas=${canvasStub.width}x${canvasStub.height}`);
}

console.log('\n=== 2. 屏幕信息 API 兼容 ===');
{
  // getSystemInfoSync 被 mock 为 throw，而游戏正常起来了 → 证明走的是 getWindowInfo
  check('优先 wx.getWindowInfo（getSystemInfoSync 未被调用）', started);
  const src = await fs.readFile(path.join(ROOT, 'game.js'), 'utf-8');
  check('入口源码含 getWindowInfo 优先分支', src.includes('wx.getWindowInfo'));
  check('入口源码含 getSystemInfoSync 降级分支', src.includes('getSystemInfoSync'));
}

console.log('\n=== 2.5 灵动岛安全区接线（入口取值 → 归一化 → 传给 Game） ===');
{
  // WIN.safeArea: top=44, bottom 边界=331 → 避让 375-331=44（逻辑像素，不折算）
  // 若入口没传或忘了归一化，Game.safeAreaTop 会是 0 / 44*dpr=88，这里就会失败。
  check('入口把 wx.getWindowInfo().safeArea 传给 Game（top=44）',
    game.safeAreaTop === 44, `game.safeAreaTop=${game.safeAreaTop}`);
  check('入口归一化 bottom 边界 → 避让高度（bottom=44）',
    game.safeAreaBottom === 44, `game.safeAreaBottom=${game.safeAreaBottom}`);
  check('RenderSystem 与 Game 共用同一份钳制结果',
    game.renderSystem.safeAreaTop === game.safeAreaTop &&
    game.renderSystem.safeAreaScaleY === game.safeAreaScaleY);
  const src = await fs.readFile(path.join(ROOT, 'game.js'), 'utf-8');
  check('入口 import 了 normalizeSafeAreaUnit 归一化函数', src.includes('normalizeSafeAreaUnit'));
  check('入口把 safeArea 作为第 5 参数传给 Game',
    /new Game\([^)]*safeArea\s*\)/.test(src));
}

console.log('\n=== 3. 被动分享注册（右上角菜单） ===');
{
  check('wx.showShareMenu 已调用', spies.showShareMenu.length >= 1);
  const menus = (spies.showShareMenu[0] && spies.showShareMenu[0].menus) || [];
  check('菜单含「转发」shareAppMessage', menus.includes('shareAppMessage'));
  check('菜单含「朋友圈」shareTimeline', menus.includes('shareTimeline'));
  check('wx.onShareAppMessage 已注册', typeof appShareHandler === 'function');
  const cfg = typeof appShareHandler === 'function' ? appShareHandler() : null;
  check('转发 handler 返回非空 title', cfg && typeof cfg.title === 'string' && cfg.title.length > 0, JSON.stringify(cfg));
  check('转发配置无小程序页面残留路径', !cfg || !cfg.path || !String(cfg.path).startsWith('/pages'), JSON.stringify(cfg && cfg.path));
  check('wx.onShareTimeline 已注册', typeof timelineHandler === 'function');
  const tl = typeof timelineHandler === 'function' ? timelineHandler() : null;
  check('朋友圈 handler 返回 {title, query}', tl && typeof tl.title === 'string' && 'query' in tl, JSON.stringify(tl));
}

console.log('\n=== 4. Android 物理返回键 ===');
{
  check('wx.onKeyDown 已注册', typeof keyHandler === 'function');
  if (typeof keyHandler === 'function') {
    // 4a. 大厅 → tryBack 返回 'none' → exitMiniProgram
    game.screenState = 'lobby';
    keyHandler({ keyCode: 27 });
    check('大厅按返回 → exitMiniProgram（交还系统退出）', spies.exitMiniProgram === 1, `count=${spies.exitMiniProgram}`);
    // 4b. 账号面板打开 → 关面板，不退出
    game.screenState = 'lobby';
    game._accountOpen = true;
    keyHandler({ keyCode: 27 });
    check('面板打开按返回 → 关闭面板不退出', game._accountOpen === false && spies.exitMiniProgram === 1, `open=${game._accountOpen} count=${spies.exitMiniProgram}`);
    // 4c. 战斗中 → keep（不退出、不开暂停菜单）
    game.initBattle();
    keyHandler({ keyCode: 27 });
    check('战斗中按返回 → 页面保持（keep）', game.screenState === 'playing' && spies.exitMiniProgram === 1, `state=${game.screenState} count=${spies.exitMiniProgram}`);
    // 4d. keyCode 8（部分机型）同样生效
    game.screenState = 'lobby';
    keyHandler({ keyCode: 8 });
    check('keyCode=8（Backspace）同样触发退出', spies.exitMiniProgram === 2, `count=${spies.exitMiniProgram}`);
  }
}

console.log('\n=== 5. 工程配置 ===');
{
  const proj = JSON.parse(await fs.readFile(path.join(ROOT, 'project.config.json'), 'utf-8'));
  check('compileType = game', proj.compileType === 'game');
  check('es6 转换开启（import/export 需工具链编译）', proj.setting && proj.setting.es6 === true);
  const ignores = ((proj.packOptions || {}).ignore) || [];
  const vals = ignores.map(i => i.value);
  check('packOptions 排除 tests/', vals.includes('tests'));
  check('packOptions 排除 preview/', vals.includes('preview'));
  check('packOptions 排除 tools/__pycache__', vals.includes('tools') && vals.includes('__pycache__'));
  check('packOptions 排除 *.md 文档', ignores.some(i => i.type === 'regexp' && i.value.includes('md')));
  const gj = JSON.parse(await fs.readFile(path.join(ROOT, 'game.json'), 'utf-8'));
  check('game.json 合法（竖屏）', gj.deviceOrientation === 'portrait');

  // 2026-11-21 上传瘦身：工作区元数据 / git 历史不得进入微信包体
  check('packOptions 排除 .workbuddy/（437MB 工作区素材）', vals.includes('.workbuddy'));
  check('packOptions 排除 .git/（60MB 提交历史）', vals.includes('.git'));
  check('packOptions 排除 design/（设计稿）', vals.includes('design'));

  // assets/ 整目录拆为美术分包，主包只留代码 + config + boot 图
  check('game.json 配置 art 分包', Array.isArray(gj.subpackages) && gj.subpackages.some(s => s.name === 'art'));
  check('art 分包 root = assets/', (gj.subpackages || []).some(s => s.root === 'assets/'));
  // 微信硬性规则：目录型分包的 root 下必须有 game.js，否则上传时报
  // "未找到 subpackages[0].root 对应的 /assets/game.js 文件"
  const subEntry = await fs.stat(path.join(ROOT, 'assets/game.js')).catch(() => null);
  check('art 分包入口 assets/game.js 存在（目录分包硬性要求）', !!subEntry);
  const bootPath = path.join(ROOT, 'boot/loading.jpg');
  const bootStat = await fs.stat(bootPath).catch(() => null);
  check('主包 boot/loading.jpg 存在且 <1MB', !!bootStat && bootStat.size > 0 && bootStat.size < 1024 * 1024,
    bootStat ? `size=${(bootStat.size / 1024).toFixed(0)}KB` : 'missing');
  const src = await fs.readFile(path.join(ROOT, 'game.js'), 'utf-8');
  check('入口先注册主包 boot 图', src.includes("registerBoot('boot/loading'"));
  check('入口支持 wx.loadSubpackage 分包加载', src.includes('wx.loadSubpackage'));

  // 色调叠层瘦身：10 张 2.3MB PNG → 50KB JPG，manifest 路径同步
  const manifest = await fs.readFile(path.join(ROOT, 'src/system/ArtManifest.js'), 'utf-8');
  check('ArtManifest 色调叠层已改为 .jpg', manifest.includes('"path": "bg/battle_tone_plains.jpg"'));
  const tonePng = await fs.stat(path.join(ROOT, 'assets/bg/battle_tone_plains.png')).catch(() => null);
  check('旧色调 PNG 已移除', !tonePng);
}

console.log(`\n结果: ${passed} 通过 / ${failed} 失败`);

// 显式退出：入口桩启动的 Game 主循环用 requestAnimationFrame(=setTimeout) 无限调度，
// 若不主动结束进程，即使断言全通过也会一直挂着（历史坑：node --test 全量跑时超时）。
// 停止游戏循环 + 清空定时器后退出。
try { if (game && typeof game.stop === 'function') game.stop(); } catch (e) { /* 忽略 */ }
process.exit(failed > 0 ? 1 : 0);

