/**
 * 占地之王 - 微信小游戏入口
 *
 * 职责（保持精简，游戏逻辑全部在 src/game/Game.js）：
 *  1. 创建 Canvas + 高分屏适配
 *  2. 主包启动：微信环境先下载 assets/ 美术分包，再启动 Game
 *  3. 注册被动分享（右上角菜单「转发」/「分享到朋友圈」）
 *  4. Android 物理返回键 → game.tryBack()
 *
 * 2026-11-21 分包改造：assets/ 整目录（37MB）配置为微信分包，
 * 主包只留代码 + config + boot/loading.jpg。分包下载前用主包图绘制进度页，
 * 下载完成后才 new Game()，避免游戏第一时间去读还不存在的分包资源。
 * 浏览器预览 / Node 测试不具 wx.loadSubpackage，走同步启动分支，行为不变。
 */

import { Game, BOOT_LOADING_BG } from './src/game/Game.js';
import { ArtSystem } from './src/system/ArtSystem.js';
import ShareSystem from './src/meta/ShareSystem.js';
import { normalizeSafeAreaUnit } from './src/system/SafeArea.js';

// ============ 1. Canvas + 屏幕信息 ============
const canvas = wx.createCanvas();
const ctx = canvas.getContext('2d');

/**
 * 屏幕信息（新基础库优先拆分 API，旧库降级 getSystemInfoSync）
 * 注：getSystemInfoSync 已被官方标记废弃，尽量拆用 getWindowInfo。
 *
 * 时序坑：微信开发者工具模拟器启动早期，jsbridge 尚未就绪时调用
 * getWindowInfo/getSystemInfo 会抛「jsbridge not ready」告警并返回兜底值。
 * 这里用 try/catch 兜底：先 getWindowInfo，失败降级 getSystemInfoSync，
 * 仍失败返回安全默认值，避免同步阶段把 jsbridge 告警刷到控制台。
 */
const _DISPLAY_FALLBACK = { screenWidth: 375, screenHeight: 667, pixelRatio: 2, safeArea: null };

function _displayInfo() {
  if (typeof wx.getWindowInfo === 'function') {
    try {
      const win = wx.getWindowInfo();
      if (win && win.screenWidth && win.screenHeight) {
        return {
          screenWidth: win.screenWidth,
          screenHeight: win.screenHeight,
          pixelRatio: win.pixelRatio || 2,
          // 灵动岛 / 状态栏 / home indicator 安全区（逻辑像素，个别 ROM 返回物理像素由归一化兜底）
          safeArea: win.safeArea || null,
        };
      }
    } catch (e) {
      // jsbridge not ready → 降级 getSystemInfoSync
    }
  }
  if (typeof wx.getSystemInfoSync === 'function') {
    try {
      const si = wx.getSystemInfoSync();
      if (si && si.screenWidth && si.screenHeight) {
        return {
          screenWidth: si.screenWidth,
          screenHeight: si.screenHeight,
          pixelRatio: si.pixelRatio || 2,
          safeArea: si.safeArea || null,
        };
      }
    } catch (e) {
      // jsbridge not ready → 使用默认值，后续由 SafeArea/RenderSystem 校准
    }
  }
  return _DISPLAY_FALLBACK;
}

const { screenWidth, screenHeight, pixelRatio, safeArea: rawSafeArea } = _displayInfo();
// 2026-11-21：接通安全区全链路 —— 此前整套机制（归一化/钳制/渲染映射/点击反推）
// 都写好了，唯独入口没取值也没传给 Game，导致真机上 safeArea 恒为 0，
// 顶部资源栏与标题被灵动岛（居中药丸）压住。归一化后再交给 Game/RenderSystem。
const safeArea = normalizeSafeAreaUnit(rawSafeArea, screenWidth, screenHeight, pixelRatio);

// 高分辨率渲染
canvas.width = screenWidth * pixelRatio;
canvas.height = screenHeight * pixelRatio;
ctx.scale(pixelRatio, pixelRatio);

// ============ 1.5 云开发初始化（原型阶段：默认关闭） ============
// 《占地之王》原型阶段走纯本地存档，不接云开发。
// 保留此段代码供后续启用：玩法定型后创建新云环境，替换 env 并解开注释即可。
// 历史环境 ID（原占城先锋项目，勿复用，避免数据混淆）：minigame-prod-d5g02fq8e40658692
//
// if (typeof wx.cloud === 'object' && typeof wx.cloud.init === 'function') {
//   try {
//     wx.cloud.init({ env: '<新云环境ID>', traceUser: true });
//     globalThis.TK_CLOUD_ENABLED = true;
//   } catch (e) {
//     console.warn('[boot] wx.cloud.init failed:', e && e.message || e);
//   }
// }
globalThis.TK_CLOUD_ENABLED = false;

// ============ 2. 分包下载进度页（只用主包资源） ============
// boot/loading.jpg 是 assets/bg/loading_art.jpg 的同图副本，尺寸 <350KB 留在主包。
// 注册进 ArtSystem 的独立路径根，这样加载页与正式加载页共用同一套 cover 绘制。
ArtSystem.registerBoot('boot/loading', 'loading.jpg');

function drawBootProgress(p) {
  try {
    ctx.fillStyle = '#5BB8E8';
    ctx.fillRect(0, 0, screenWidth, screenHeight);
    ArtSystem.draw(ctx, BOOT_LOADING_BG, 0, 0, screenWidth, screenHeight, { fit: 'cover', alpha: 1 });
    ctx.fillStyle = 'rgba(14,26,46,0.45)';
    ctx.fillRect(0, screenHeight * 0.72, screenWidth, screenHeight * 0.28);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#EAF8FF';
    ctx.font = '14px sans-serif';
    ctx.fillText(`资源加载中 ${Math.round(p * 100)}%`, screenWidth / 2, screenHeight * 0.84);
  } catch (e) {
    // 进度页绘制失败不应阻断启动（真机 canvas 状态异常时由 Game 自己的加载页兜底）
  }
}

// ============ 3. 启动游戏 ============
function bootstrap() {
  const game = new Game(canvas, ctx, screenWidth, screenHeight, safeArea);

  // 调试钩子：真机 vConsole / 自动化测试可通过 globalThis.__game 访问实例
  globalThis.__game = game;

  game.start().catch((err) => {
    console.error('[boot] 游戏启动失败:', err);
    // 画布上绘制可见错误（真机黑屏排查第一现场）
    ctx.fillStyle = '#1a202c';
    ctx.fillRect(0, 0, screenWidth, screenHeight);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#f87171';
    ctx.font = 'bold 16px sans-serif';
    ctx.fillText('游戏启动失败，请退出后重试', screenWidth / 2, screenHeight / 2 - 14);
    ctx.fillStyle = '#9ca3af';
    ctx.font = '12px sans-serif';
    const msg = String((err && err.message) || err).slice(0, 60);
    ctx.fillText(msg, screenWidth / 2, screenHeight / 2 + 14);
  });

  // ---- 被动分享（右上角菜单） ----
  // 打开「转发」和「分享到朋友圈」菜单开关
  if (typeof wx.showShareMenu === 'function') {
    wx.showShareMenu({ menus: ['shareAppMessage', 'shareTimeline'] });
  }
  // 转发给好友：文案由 ShareSystem 按当前存档生成
  if (typeof wx.onShareAppMessage === 'function') {
    wx.onShareAppMessage(() => ShareSystem.getShareConfig({ scene: 'lobby' }));
  }
  // 分享到朋友圈（需要单独注册，否则菜单项无效）
  if (typeof wx.onShareTimeline === 'function') {
    wx.onShareTimeline(() => {
      const cfg = ShareSystem.getShareConfig({ scene: 'lobby' });
      return { title: cfg.title, query: '' };
    });
  }

  // ---- Android 物理返回键 ----
  // 语义：返回键先关闭打开的界面/窗口，主大厅再按才退出小游戏
  // (keyCode 27 = ESC；部分机型 Backspace 8)
  if (typeof wx.onKeyDown === 'function') {
    wx.onKeyDown((res) => {
      if (res.keyCode === 27 || res.keyCode === 8) {
        const r = game.tryBack();
        if (r === 'none') {
          // 主大厅：交还系统默认行为（退出小游戏）
          if (typeof wx.exitMiniProgram === 'function') wx.exitMiniProgram();
        }
      }
    });
  }

  return game;
}

// 真实微信才有 loadSubpackage；浏览器预览由 wx-shim 注入 __tkBrowser，
// Node 测试也没有此 API —— 两者都走同步启动，保持原有行为与测试契约。
const hasSubpackage = typeof wx !== 'undefined' && wx && wx.__tkBrowser !== true &&
  typeof wx.loadSubpackage === 'function';

if (hasSubpackage) {
  drawBootProgress(0);
  try {
    wx.loadSubpackage({
      name: 'art',
      progress(res) {
        let p = 0;
        if (res && typeof res.progress === 'number') p = res.progress / 100;
        else if (res && res.totalBytes > 0) p = res.loadedBytes / res.totalBytes;
        drawBootProgress(Math.max(0, Math.min(1, p)));
      },
      success() { bootstrap(); },
      fail(err) {
        // 分包下载失败时仍启动游戏：资源层会静默降级到程序化绘制，不至于黑屏
        console.warn('[boot] art subpackage load failed, fallback to procedural art:', err);
        bootstrap();
      },
    });
  } catch (err) {
    console.warn('[boot] wx.loadSubpackage threw, starting without subpackage:', err);
    bootstrap();
  }
} else {
  bootstrap();
}
