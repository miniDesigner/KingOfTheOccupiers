/**
 * WeChat API 适配层 - 让微信小游戏代码在浏览器中运行
 */

// 模拟 wx 全局对象
const wx = {
  _canvas: null,
  _callbackQueue: [],

  createCanvas() {
    if (!this._canvas) {
      this._canvas = document.getElementById('gameCanvas');
    }
    // 添加微信小游戏Canvas特有的触摸事件
    const canvas = this._canvas;

    // 模拟微信触摸事件格式
    canvas.addEventListener = (function(original) {
      return function(type, listener) {
        if (type === 'touchstart' || type === 'touchmove' || type === 'touchend') {
          // 将浏览器触摸事件转换为微信格式
          original.call(canvas, type, (e) => {
            const touches = Array.from(e.touches).map(t => ({
              clientX: t.clientX,
              clientY: t.clientY,
              identifier: t.identifier
            }));
            const changedTouches = Array.from(e.changedTouches).map(t => ({
              clientX: t.clientX,
              clientY: t.clientY,
              identifier: t.identifier
            }));
            listener({ touches, changedTouches, preventDefault: () => e.preventDefault() });
          });
        } else {
          original.call(canvas, type, listener);
        }
      };
    })(canvas.addEventListener.bind(canvas));

    return canvas;
  },

  getSystemInfoSync() {
    return {
      screenWidth: window.innerWidth,
      screenHeight: window.innerHeight,
      pixelRatio: window.devicePixelRatio || 1,
      platform: 'browser',
    };
  },

  setStorageSync(key, data) {
    localStorage.setItem(key, JSON.stringify(data));
  },

  getStorageSync(key) {
    const data = localStorage.getItem(key);
    return data ? JSON.parse(data) : null;
  },

  vibrateShort() {},
  vibrateLong() {},

  showToast({ title }) {
    console.log('[Toast]', title);
  },

  /**
   * 模拟微信主动分享（浏览器预览用 + 真机 wx 完整转发 query 行为）
   * - 浏览器预览：fallback 走 _copyText 复制带房间号的 URL + 提示 "已复制邀请地址"
   * - 真机：用户主动触发后弹出微信原生分享面板，path 中的 query 会随卡片发给好友
   */
  shareAppMessage(opts) {
    console.log('[Share] shareAppMessage', opts);
    return true;
  },

  /**
   * 模拟微信被动分享注册（浏览器预览用 + 真机小游戏入口调用）
   * 真机上 path 含 ?room=XXXX 转发给好友 → 好友从分享卡片进入时 _checkLanRoomFromOptions 解析
   */
  onShareAppMessage(callback) {
    console.log('[Share] onShareAppMessage registered');
    this._shareCallback = callback;
  },

  /**
   * 模拟显示分享菜单（浏览器预览用）
   */
  showShareMenu(opts) {
    console.log('[Share] showShareMenu', opts);
  },

  /**
   * 微信小程序：复制到系统剪贴板（浏览器预览用 navigator.clipboard 桥接）
   * 真机上 wx.setClipboardData 走系统 API，无 secure context 限制
   */
  setClipboardData({ data, success, fail }) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(data).then(
        () => success && success({ data }),
        (err) => fail && fail({ errMsg: 'setClipboardData:fail ' + (err && err.message || 'unknown') })
      );
    } else if (document.execCommand) {
      // 非 secure context（如 http://192.168.x.x）降级
      try {
        const ta = document.createElement('textarea');
        ta.value = data;
        ta.style.position = 'fixed'; ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        const ok = document.execCommand('copy');
        document.body.removeChild(ta);
        if (ok) success && success({ data });
        else fail && fail({ errMsg: 'setClipboardData:fail execCommand returned false' });
      } catch (e) {
        fail && fail({ errMsg: 'setClipboardData:fail ' + (e && e.message || 'unknown') });
      }
    } else {
      fail && fail({ errMsg: 'setClipboardData:fail no clipboard API' });
    }
  },

  /**
   * 微信小游戏冷启动查询参数（path query 解析）
   * 浏览器预览：fallback 读 window.location.search，URL 拼接为 /?room=XYZ
   * 真机：直接读 wx.getLaunchOptionsSync().query（含转发 query）
   */
  getLaunchOptionsSync() {
    let query = {};
    try {
      if (typeof window !== 'undefined' && window.location && window.location.search) {
        const sp = new URLSearchParams(window.location.search);
        for (const [k, v] of sp.entries()) query[k] = v;
      }
    } catch (e) { /* ignore */ }
    return {
      query,
      scene: 1007,  // 模拟 1007 = 单人聊天小程序卡片（参考微信文档）
      referrerInfo: {},
    };
  },

  /**
   * 微信小游戏 onShow 热启动回调（从分享卡片再次进入时触发）
   * 真机上从后台唤起时也能拿到新的 query
   */
  onShow(callback) {
    if (typeof callback !== 'function') return;
    this._onShowCallback = callback;
  },

  offShow(callback) {
    if (this._onShowCallback === callback) this._onShowCallback = null;
  },

  /**
   * 模拟微信 InnerAudioContext (浏览器预览用)
   */
  createInnerAudioContext() {
    const audio = new Audio();
    return {
      _audio: audio,
      src: '',
      volume: 1.0,
      loop: false,
      get duration() { return audio.duration; },
      get currentTime() { return audio.currentTime; },
      set currentTime(v) { audio.currentTime = v; },
      set src(v) { this._src = v; audio.src = v; },
      get src() { return this._src; },
      set volume(v) { audio.volume = v; },
      get volume() { return audio.volume; },
      set loop(v) { audio.loop = v; },
      get loop() { return audio.loop; },
      play() { audio.play().catch(() => {}); },
      pause() { audio.pause(); },
      stop() { audio.pause(); audio.currentTime = 0; },
      seek(pos) { audio.currentTime = pos; },
      destroy() { audio.pause(); audio.src = ''; },
      onPlay(cb) { audio.addEventListener('play', cb); },
      onPause(cb) { audio.addEventListener('pause', cb); },
      onStop(cb) { audio.addEventListener('emptied', cb); },
      onEnded(cb) { audio.addEventListener('ended', cb); },
      onError(cb) { audio.addEventListener('error', cb); },
    };
  },
};

// 注入全局
window.wx = wx;
// 浏览器专属标记：让业务代码（如 ConfigLoader）能区分「微信小游戏原生」与「浏览器预览」
// 微信原生环境没有 window 全局（运行在 wx 沙箱里），业务代码可以用 typeof window === 'undefined'
// 或 wx.__tkBrowser === true 来判断。本工程用后者更明确。
wx.__tkBrowser = true;
window.__tkBrowser = true;
