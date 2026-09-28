// 诊断: 模拟浏览器环境跑 Game.start(), 定位"一直加载中"的卡点
const noop = () => {};
const ctxProxy = new Proxy({}, {
  get: (t, p) => {
    if (p === 'canvas') return canvasStub;
    return (...args) => {
      // measureText 等需要返回对象
      if (p === 'measureText') return { width: 50 };
      if (p === 'createLinearGradient' || p === 'createRadialGradient') return { addColorStop: noop };
      if (p === 'getImageData') return { data: [] };
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

// fetch: 从真实服务器拉配置(验证与浏览器一致的网络路径)
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

// wx-shim 模拟
global.wx = new Proxy({}, { get: (t, p) => (typeof p === 'string' ? (() => ({ errMsg: p + ':ok' })) : undefined) });

const origError = console.error;
console.error = (...a) => { origError('[console.error]', ...a); };

process.on('unhandledRejection', (e) => { origError('[unhandledRejection]', e); process.exit(1); });

(async () => {
  console.log('--- importing Game.js ---');
  const { Game } = await import('../src/game/Game.js');
  console.log('--- import OK, new Game() ---');
  const game = new Game(canvasStub, ctxProxy, 400, 700);
  console.log('--- game.start() ---');
  await game.start();
  console.log('--- START RESOLVED ✅ (loading should hide) ---');
  // 跑几帧 render/update 检查循环期错误
  for (let i = 0; i < 10; i++) {
    game.update(0.016);
    game.render(0.016);
  }
  console.log('--- 10 frames render/update OK ✅ ---');
  console.log('screenState =', game.screenState);
  process.exit(0);
})().catch((e) => { origError('!!! START FAILED:', e); process.exit(1); });
