/**
 * 美术资源层（ArtSystem）
 *
 * 职责：把 assets/ 下的美术素材（当前为占位图，后续同名替换为正式素材）
 *      接入 Canvas 渲染管线，提供按需加载 / 缓存 / 九宫格 / 等比缩放 / 兜底。
 *
 * 三环境行为：
 *  - 微信小游戏：wx.createImage()，路径前缀 'assets/'
 *  - 浏览器预览：new Image()，路径前缀 '../assets/'（相对 preview/index.html）
 *  - Node 测试：既无 Image 也无真 wx.createImage → available=false，
 *              所有 draw() 静默返回 false，程序化绘制原样兜底（测试零影响）
 *
 * 设计铁律（P36 延伸）：
 *  本系统只负责「画」，不改任何 Layout / 命中几何；
 *  图片未加载、加载失败、环境不支持时一律静默降级，绝不抛错、绝不改变游戏状态。
 *
 * 占位图带水印且为示意图，底图默认以 alpha 叠加；正式素材到位后
 *  setAlpha(1) 即可得到不透明贴图（也可由 config/game.json 的 features 控制）。
 */
import { ART_INDEX, ART_BY_CODE, ART_COUNT } from './ArtManifest.js';

class ArtSystemClass {
  constructor() {
    this.total = ART_COUNT;
    this.enabled = true;
    this.alpha = 0.5;              // 占位底图叠加不透明度
    this.subpageBgAlpha = 1;       // 子界面底图叠加不透明度（子界面复用大厅底图，默认满不透明）
    this._cache = new Map();       // key -> { status, img }
    this._stats = {
      requested: 0, ready: 0, failed: 0,
      missing: 0, drawn: 0, fallback: 0,
    };
    this._env = this._detectEnv();
  }

  /**
   * 环境探测。与 ConfigLoader.isWxEnv() 保持同一套判据：
   * 浏览器预览由 wx-shim 注入 wx.__tkBrowser === true；
   * 真微信原生支持 require()；Node 测试两者皆无。
   */
  _detectEnv() {
    const hasWxGlobal = typeof wx !== 'undefined' && !!wx;
    const isPreview = hasWxGlobal && wx.__tkBrowser === true;
    if (isPreview) return 'browser';

    const hasDom = typeof window !== 'undefined' && typeof document !== 'undefined';
    if (hasDom && typeof Image === 'function') return 'browser';

    // 真微信：require 是函数 + wx.createImage 可用
    const isRealWx = typeof require === 'function' && hasWxGlobal &&
                     typeof wx.createImage === 'function';
    if (isRealWx) return 'wx';

    return 'node';
  }

  get available() { return this._env !== 'node'; }
  get env() { return this._env; }
  get base() { return this._env === 'browser' ? '../assets/' : 'assets/'; }
  /** 主包 boot/ 资源根：微信分包下载前就能读，浏览器预览走 ../boot/ */
  get bootBase() { return this._env === 'browser' ? '../boot/' : 'boot/'; }

  /**
   * 注册主包资源（仅供分包下载前的加载页使用）。
   * 复用同一套缓存/绘制管线，仅路径根与 manifest 条目不同。
   * 注意：这里的 key 不要与 manifest 冲突；加载页优先 manifest 图，未就绪才回退 boot 图。
   */
  registerBoot(key, path) {
    ART_INDEX[key] = {
      key, path, root: 'boot', w: 1500, h: 2115, fmt: 'JPG',
      is9: false, slice: 0, quality: '', source: 'boot', note: 'split-package boot art',
    };
    return this;
  }

  setEnabled(v) { this.enabled = !!v; }
  setAlpha(v) { this.alpha = Math.max(0, Math.min(1, Number(v) || 0)); }
  setSubpageBgAlpha(v) { this.subpageBgAlpha = Math.max(0, Math.min(1, Number(v) || 0)); }

  /** 该编号下的全部 key（供按状态/序号批量取图） */
  byCode(code) { return ART_BY_CODE[code] || []; }

  /** 创建平台图片对象；任何异常返回 null */
  _createImage() {
    try {
      // 真微信与浏览器预览统一走 wx.createImage()（预览由 wx-shim 提供，
      // 返回浏览器原生 Image）；无 wx 的普通浏览器回退到 new Image()。
      // Node 测试环境两者皆无 → 返回 null，_ensure 静默标记 failed，draw 恒兜底。
      if (typeof wx !== 'undefined' && wx && typeof wx.createImage === 'function') {
        return wx.createImage();
      }
      if (this._env === 'browser' && typeof Image === 'function') return new Image();
    } catch (e) { /* 静默 */ }
    return null;
  }

  /**
   * 按需加载：首次调用发起异步加载，未 ready 时返回 null（本次走兜底，
   * 下一帧渲染自然生效）。加载失败不再重试，避免 404 风暴。
   */
  _ensure(key) {
    const e = ART_INDEX[key];
    if (!e) { this._stats.missing++; return null; }
    let c = this._cache.get(key);
    if (c) return c.status === 'ready' ? c.img : null;

    c = { status: 'loading', img: null };
    this._cache.set(key, c);
    this._stats.requested++;
    try {
      const img = this._createImage();
      if (!img) { c.status = 'failed'; this._stats.failed++; return null; }
      c.img = img;
      img.onload = () => { c.status = 'ready'; this._stats.ready++; };
      img.onerror = () => { c.status = 'failed'; this._stats.failed++; };
      img.src = (e.root === 'boot' ? this.bootBase : this.base) + e.path;
    } catch (err) {
      c.status = 'failed';
      this._stats.failed++;
    }
    return null;
  }

  /** 预加载一批 key（不阻塞启动） */
  preload(keys = []) { for (const k of keys) this._ensure(k); }

  /** 九宫格 3×3 切片绘制；保护边距取自占位图上画的同一份 slice 参数 */
  _draw9(ctx, img, e, x, y, w, h) {
    // 同 _drawFit：源坐标按图片实际像素算，声明尺寸仅作为兜底。
    // 实际尺寸与声明一致时（正常情况）mr/mc 恒等于 m，行为完全不变。
    const iw = (img && img.width) || e.w;
    const ih = (img && img.height) || e.h;
    const m = e.slice || Math.max(3, Math.floor(Math.min(e.w, e.h) * 0.16));
    const mr = m * (iw / e.w);
    const mc = m * (ih / e.h);
    const dm = Math.max(1, Math.min(m, w / 3, h / 3));
    const sx = [0, mr, iw - mr, iw];
    const sy = [0, mc, ih - mc, ih];
    const dx = [x, x + dm, x + w - dm, x + w];
    const dy = [y, y + dm, y + h - dm, y + h];
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) {
        const sw = sx[c + 1] - sx[c], sh = sy[r + 1] - sy[r];
        const dw = dx[c + 1] - dx[c], dh = dy[r + 1] - dy[r];
        if (sw <= 0 || sh <= 0 || dw <= 0 || dh <= 0) continue;
        ctx.drawImage(img, sx[c], sy[r], sw, sh, dx[c], dy[r], dw, dh);
      }
    }
  }

  /** 等比裁切（cover）/ 完整显示（contain），支持可选源矩形裁剪 crop */
  _drawFit(ctx, img, e, x, y, w, h, mode, crop) {
    // 源尺寸优先取图片实际像素，而不是清单声明值 e.w/e/h。
    // 原因：替换素材时若实际尺寸与 PLACEHOLDER-MANIFEST 声明不一致，
    // 用声明值算出的源矩形会越界到图片之外，drawImage 取不到像素，
    // 右侧/底部就会露出底层渐变（表现为背景左右两条浅色竖边）。
    const iw = (img && img.width) || e.w;
    const ih = (img && img.height) || e.h;
    // crop（2026-11-23）：按归一化比例裁源图，如 { bottom: 0.35 } 只取上方 65%（半身像）。
    // 先在完整源图上取有效区，再在有效区内做 cover/contain，保证任意目标比例都不变形。
    let bx = 0, by = 0, bw = iw, bh = ih;
    if (crop) {
      const top = Math.max(0, Math.min(0.9, crop.top || 0));
      const bottom = Math.max(0, Math.min(0.9, crop.bottom || 0));
      const left = Math.max(0, Math.min(0.9, crop.left || 0));
      const right = Math.max(0, Math.min(0.9, crop.right || 0));
      bx = iw * left;
      by = ih * top;
      bw = Math.max(1, iw * (1 - left - right));
      bh = Math.max(1, ih * (1 - top - bottom));
    }
    const ir = bw / bh, tr = w / h;
    let sx = bx, sy = by, sw = bw, sh = bh;
    if (mode === 'cover') {
      if (ir > tr) { sw = bh * tr; sx = bx + (bw - sw) / 2; }
      else { sh = bw / tr; sy = by + (bh - sh) / 2; }
      ctx.drawImage(img, sx, sy, sw, sh, x, y, w, h);
    } else {
      const scale = Math.min(w / bw, h / bh);
      const dw = bw * scale, dh = bh * scale;
      const dx = x + (w - dw) / 2, dy = y + (h - dh) / 2;
      // 无 crop 时保留原有 3 参数调用形式（测试与老基础库均依赖该签名）
      if (crop) ctx.drawImage(img, bx, by, bw, bh, dx, dy, dw, dh);
      else ctx.drawImage(img, dx, dy, dw, dh);
    }
  }

  /**
   * 绘制一张贴图。返回 true 表示本次确实用图片绘制了，
   * false 表示调用方应继续走程序化绘制（兜底）。
   *
   * @param {CanvasRenderingContext2D} ctx
   * @param {string} key  ART_INDEX 中的 key（如 'bg/lobby_bg'）
   * @param {number} x,y,w,h 目标矩形（逻辑坐标，与 Layout 同源）
   * @param {{alpha?:number, fit?:'cover'|'contain', crop?:{top?:number,bottom?:number,left?:number,right?:number}}} opts
   */
  draw(ctx, key, x, y, w, h, opts = {}) {
    if (!this.available || !this.enabled || !ctx || w <= 0 || h <= 0) {
      this._stats.fallback++;
      return false;
    }
    const e = ART_INDEX[key];
    if (!e) { this._stats.missing++; this._stats.fallback++; return false; }
    const img = this._ensure(key);
    if (!img) { this._stats.fallback++; return false; }
    try {
      ctx.save();
      // 与调用方已有的 globalAlpha 相乘继承（Toast 淡入淡出 / 翻转动画等），
      // 而不是直接覆盖；opts.alpha 显式给出时作为本次贴图的叠加系数。
      const _a = (opts.alpha === undefined ? this.alpha : Math.max(0, Math.min(1, opts.alpha)));
      const _base = (typeof ctx.globalAlpha === 'number' && isFinite(ctx.globalAlpha))
        ? ctx.globalAlpha : 1;
      ctx.globalAlpha = Math.max(0, Math.min(1, _base * _a));
      if (e.is9) this._draw9(ctx, img, e, x, y, w, h);
      else if (opts.fit === 'cover' || opts.fit === 'contain') {
        this._drawFit(ctx, img, e, x, y, w, h, opts.fit, opts.crop);
      } else if (opts.crop) {
        // crop 未配 fit 时默认按 cover 处理，保证源矩形裁剪生效且不变形
        this._drawFit(ctx, img, e, x, y, w, h, 'cover', opts.crop);
      } else ctx.drawImage(img, x, y, w, h);
      ctx.restore();
      this._stats.drawn++;
      return true;
    } catch (err) {
      // 图片对象异常 / ctx 不支持 drawImage → 静默兜底
      try { ctx.restore(); } catch (e2) { /* noop */ }
      this._stats.fallback++;
      return false;
    }
  }

  /** 审查用统计快照 */
  stats() {
    return {
      env: this._env,
      available: this.available,
      enabled: this.enabled,
      alpha: this.alpha,
      total: this.total,
      ...this._stats,
      cached: this._cache.size,
    };
  }
}

export const ArtSystem = new ArtSystemClass();
export default ArtSystem;
