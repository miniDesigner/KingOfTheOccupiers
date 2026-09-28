/**
 * 配置加载器
 * 负责从 JSON 配置文件加载所有游戏配置
 *
 * 支持两种环境:
 * - 浏览器预览: 使用 fetch 加载 config/*.json
 * - 微信小游戏: 使用 require 加载 config/*.js
 *   （小游戏 require() 不支持 .json；wx.getFileSystemManager().readFileSync() 会 permission denied）
 *   所以 build 时把 JSON 编译成 CommonJS 模块: tools/build-config-js.mjs
 *   调用示例: require('../../config/game.js')
 */

// 配置文件列表
const CONFIG_FILES = {
  game: 'game.json',
  buildings: 'buildings.json',
  tiles: 'tiles.json',
  combat: 'combat.json',
  synergy: 'synergy.json',
  races: 'races.json',
  levels: 'levels.json',
  audio: 'audio.json',
  techTree: 'tech-tree.json',
  equipment: 'equipment.json',
  quests: 'quests.json',
  shop: 'shop.json',
  battlePass: 'battle-pass.json',
  deployables: 'deployables.json',
  skills: 'skills.json',
  ads: 'ads.json',
};

// 缓存的配置数据
const _cache = {};

// 是否已初始化
let _initialized = false;

/**
 * 判断当前是否为微信小游戏环境
 *
 * 注意：浏览器预览的 wx-shim 也提供 getSystemInfoSync，导致单凭 wx API 不能
 * 区分「真微信」与「浏览器预览」。
 *
 * 真微信：wx.__tkBrowser 不存在
 * 浏览器预览：wx-shim.js 注入了 wx.__tkBrowser = true（且 window 全局存在）
 */
function isWxEnv() {
  // 真微信运行时原生支持 require()，浏览器原生没有。
  // 用 require 是否为函数做兜底识别，是最可靠的运行时差异。
  if (typeof require !== 'function') return false;
  if (typeof wx === 'undefined' || typeof wx.getSystemInfoSync !== 'function') return false;
  // 浏览器预览：wx-shim.js 注入 wx.__tkBrowser = true。
  // 注意：微信开发者工具「模拟器」底层是 Chromium(nw.js)，存在 window 全局，
  // 因此【不能】用 typeof window !== 'undefined' 来区分浏览器预览与真微信——
  // 否则模拟器会被误判为浏览器，走 fetch 分支（fetch is not defined 报错）。
  if (wx.__tkBrowser === true) return false;
  return true;
}

/**
 * 获取配置文件路径前缀
 *
 * 微信小游戏: require() 路径相对当前源文件 (src/data/ConfigLoader.js)
 *   目标 config/ 在项目根 → 需要 '../../config/<name>.js' (上溯两级)
 * 浏览器预览: fetch 相对 preview/index.html 的 URL
 *   '../config/<name>.json'
 */
function getConfigBasePath() {
  if (isWxEnv()) {
    return '../../config/';
  }
  return '../config/';
}

/**
 * 把 .json 文件名转为微信专用 .js 文件名
 *   game.json  →  game.js
 */
function wxModulePath(jsonFileName) {
  return jsonFileName.replace(/\.json$/, '.js');
}

/**
 * 加载单个 JSON 配置文件
 */
async function loadJson(fileName) {
  // 微信环境: 使用 require 加载 .js 模块
  if (isWxEnv()) {
    const basePath = getConfigBasePath();
    const jsPath = basePath + wxModulePath(fileName);
    try {
      // eslint-disable-next-line no-undef
      return require(jsPath);
    } catch (e) {
      console.error(`[ConfigLoader] Failed to require ${jsPath}:`, e);
      throw e;
    }
  }

  // 浏览器环境: 使用 fetch 加载 .json
  const basePath = getConfigBasePath();
  const path = basePath + fileName;
  try {
    const response = await fetch(path);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${path}`);
    }
    return await response.json();
  } catch (e) {
    console.error(`[ConfigLoader] Failed to fetch ${path}:`, e);
    throw e;
  }
}

/**
 * 初始化: 加载所有配置文件
 * 必须在游戏启动前调用
 * @param {Function} [onProgress] - 进度回调 (done, total, fileName)
 */
async function init(onProgress) {
  if (_initialized) return;

  console.log('[ConfigLoader] Loading config files...');

  const keys = Object.keys(CONFIG_FILES);
  const total = keys.length;
  let done = 0;
  const results = await Promise.all(
    keys.map(key => loadJson(CONFIG_FILES[key]).then(res => {
      done++;
      if (typeof onProgress === 'function') {
        onProgress(done, total, CONFIG_FILES[key]);
      }
      return res;
    }))
  );

  keys.forEach((key, i) => {
    _cache[key] = results[i];
    console.log(`[ConfigLoader] Loaded: ${CONFIG_FILES[key]}`);
  });

  _initialized = true;
  console.log('[ConfigLoader] All config files loaded.');
}

/**
 * 同步获取已加载的配置
 * 必须在 init() 完成后调用
 * @param {string} key - 配置名: game/buildings/tiles/combat/synergy/races/levels
 * @returns {object} 配置数据
 */
function get(key) {
  if (!_initialized) {
    throw new Error(`[ConfigLoader] Not initialized. Call init() first.`);
  }
  if (!_cache[key]) {
    throw new Error(`[ConfigLoader] Unknown config key: ${key}`);
  }
  return _cache[key];
}

/**
 * 同步获取已加载的配置(安全版，不存在返回 null)
 * @param {string} key - 配置名
 * @returns {object|null}
 */
function getSafe(key) {
  if (!_initialized) return null;
  return _cache[key] || null;
}

/**
 * 获取所有配置
 */
function getAll() {
  if (!_initialized) {
    throw new Error(`[ConfigLoader] Not initialized. Call init() first.`);
  }
  return { ..._cache };
}

/**
 * 重新加载配置(开发调试用)
 */
async function reload() {
  _initialized = false;
  Object.keys(_cache).forEach(k => delete _cache[k]);
  await init();
}

export { init, get, getSafe, getAll, reload, isWxEnv };

// 默认导出
export default { init, get, getSafe, getAll, reload, isWxEnv };
