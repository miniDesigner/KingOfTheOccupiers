/**
 * 字体资源层（FontSystem）
 *
 * 职责：加载 assets/fonts/ 下的真实 .ttf 占位字体，供渲染层在标题 / 数值处使用。
 *
 * 三环境行为：
 *  - 微信小游戏：wx.loadFont('assets/fonts/title.ttf') → 返回字体族名
 *  - 浏览器预览：FontFace API 加载 '../assets/fonts/title.ttf'（相对 preview/index.html）
 *  - Node 测试：无 wx / document → 静默降级，families 为空，渲染层继续用 sans-serif
 *
 * 设计铁律：字体只影响「文字外观」，不改任何 Layout / 命中几何；
 *          加载失败、环境不支持一律静默降级，绝不抛错、绝不改变游戏状态。
 *          正式字体同名覆盖 assets/fonts/*.ttf 即可，无需改代码。
 */
class FontSystemClass {
  constructor() {
    /** @type {Object<string,string>} key -> 已成功加载的字体族名 */
    this.families = {};
    /** @type {Object<string,string>} 已尝试加载的字体族名（含失败，避免重复尝试） */
    this._attempted = {};
    this._env = this._detectEnv();
  }

  _detectEnv() {
    const hasWxGlobal = typeof wx !== 'undefined' && !!wx;
    if (hasWxGlobal && wx.__tkBrowser === true) return 'browser';
    if (typeof window !== 'undefined' && typeof document !== 'undefined') return 'browser';
    if (hasWxGlobal && typeof wx.loadFont === 'function') return 'wx';
    return 'node';
  }

  get available() { return this._env !== 'node'; }
  get env() { return this._env; }

  /**
   * 按 key 取字体族名；未加载 / 失败时返回 ''（调用方应回退系统字体）
   * @param {'title'|'number'} key
   */
  family(key) { return this.families[key] || ''; }

  /** 供 canvas ctx.font 使用：返回带自定义族名的字体串，未加载则回退 sans-serif */
  font(size, weight, key) {
    const fam = this.family(key);
    const w = weight ? weight + ' ' : '';
    return `${w}${size}px ${fam ? `"${fam}", ` : ''}sans-serif`;
  }

  /**
   * 加载字体族。返回已成功加载的族名映射。
   * @param {{title?:string, number?:string}} paths 相对游戏根的路径
   * @param {{enabled?:boolean}} opts
   */
  load(paths = {}, opts = {}) {
    if (opts.enabled === false || !this.available) return this.families;
    const specs = [
      ['title', paths.title || 'assets/fonts/title.ttf', 'KingTitle'],
      ['number', paths.number || 'assets/fonts/number.ttf', 'KingNumber'],
    ];
    for (const [key, path, fallbackFamily] of specs) {
      if (this._attempted[key]) continue;
      this._attempted[key] = fallbackFamily;
      try {
        if (this._env === 'wx') {
          // 微信小游戏：loadFont 返回字体族名（通常与文件名或 font-family 一致）
          const fam = wx.loadFont(path);
          if (fam) this.families[key] = String(fam);
        } else if (this._env === 'browser' && typeof FontFace === 'function') {
          const url = '../' + path;   // 相对 preview/index.html
          const ff = new FontFace(fallbackFamily, `url("${url}")`);
          ff.load().then((loaded) => {
            if (typeof document !== 'undefined' && document.fonts) {
              document.fonts.add(loaded);
            }
            this.families[key] = fallbackFamily;
          }).catch(() => { /* 静默降级 */ });
        }
      } catch (e) { /* 静默降级：字体从不影响可玩性 */ }
    }
    return this.families;
  }

  /** 诊断快照 */
  stats() {
    return { env: this._env, available: this.available,
      families: { ...this.families }, attempted: { ...this._attempted } };
  }
}

export const FontSystem = new FontSystemClass();
export default FontSystem;
