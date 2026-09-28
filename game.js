/**
 * 占地之王 - 微信小游戏入口
 *
 * 职责（保持精简，游戏逻辑全部在 src/game/Game.js）：
 *  1. 创建 Canvas + 高分屏适配
 *  2. 启动 Game（异步加载 JSON 配置），失败时在画布上绘制可见错误
 *  3. 注册被动分享（右上角菜单「转发」/「分享到朋友圈」）
 *  4. Android 物理返回键 → game.tryBack()
 */

import { Game } from './src/game/Game.js';
import ShareSystem from './src/meta/ShareSystem.js';

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
const _DISPLAY_FALLBACK = { screenWidth: 375, screenHeight: 667, pixelRatio: 2 };

function _displayInfo() {
  if (typeof wx.getWindowInfo === 'function') {
    try {
      const win = wx.getWindowInfo();
      if (win && win.screenWidth && win.screenHeight) {
        return {
          screenWidth: win.screenWidth,
          screenHeight: win.screenHeight,
          pixelRatio: win.pixelRatio || 2,
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
        };
      }
    } catch (e) {
      // jsbridge not ready → 使用默认值，后续由 SafeArea/RenderSystem 校准
    }
  }
  return _DISPLAY_FALLBACK;
}

const { screenWidth, screenHeight, pixelRatio } = _displayInfo();

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

// ============ 2. 启动游戏 ============
const game = new Game(canvas, ctx, screenWidth, screenHeight);

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

// ============ 3. 被动分享（右上角菜单） ============
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

// ============ 4. Android 物理返回键 ============
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
