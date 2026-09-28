/**
 * 音效系统
 *
 * 双平台支持：
 *  - 微信小游戏: wx.createInnerAudioContext()
 *  - 浏览器预览: new Audio()
 *
 * 功能：
 *  - 音效播放/停止/预加载
 *  - BGM 播放/暂停/切换
 *  - 音量控制 (总音量 + 单独音量)
 *  - 静音切换
 *  - 音效池 (同音效快速重复播放不卡顿)
 */

const MAX_POOL_SIZE = 6; // 每种音效最多同时播放实例数

/**
 * 微信小游戏音频资源就绪开关。
 *
 * 工程当前未放置任何 mp3（assets/audio/sfx/*.mp3 与 assets/audio/bgm/battle.mp3 均不存在）。
 * 若在 WX 环境强行 set src，会触发微信基础库主动打印的 stat:fail / operateAudio:fail 红字，
 * 这类日志不经过 InnerAudioContext.onError 回调，无法被吞掉。
 * 因此 WX 环境默认禁用音效/BGM 播放；策划放置音频文件后将其置为 true 即可恢复。
 */
const WX_AUDIO_ASSETS_READY = false;

class AudioManager {
  constructor() {
    /** @type {Object<string, {url: string, volume: number, pool: any[], poolIndex: number}>} */
    this.sounds = {};
    /** BGM 实例 */
    this.bgm = null;
    this.bgmUrl = '';
    /** 总音量 0~1 */
    this.masterVolume = 1.0;
    /** 音效音量 0~1 */
    this.sfxVolume = 0.8;
    /** BGM 音量 0~1 */
    this.bgmVolume = 0.5;
    /** 是否静音 */
    this.muted = false;
    /** 音效独立开关（设置窗口控制，与总静音互不影响） */
    this.sfxEnabled = true;
    /** BGM 独立开关（设置窗口控制，与总静音互不影响） */
    this.bgmEnabled = true;
    /** 触觉震动开关（设置窗口控制，默认开） */
    this.hapticEnabled = true;
    /** 震动防抖：各级别最小间隔(ms) */
    this.vibrateIntervals = { light: 90, medium: 200, strong: 500 };
    this._lastVibrateTime = { light: 0, medium: 0, strong: 0 };
    /** BGM 是否暂停 */
    this.bgmPaused = false;
    /** 平台检测 */
    this.platform = typeof wx !== 'undefined' ? 'wechat' : 'browser';
    /** 是否已初始化 */
    this.initialized = false;
    /** 配置数据 */
    this.config = null;
    /** 音效开关缓存(每个音效是否启用) */
    this.enabledMap = {};
    /** 防抖：同一音效最小播放间隔(秒) */
    this.throttleMap = {};
    this._lastPlayTime = {};
  }

  /**
   * 初始化音频系统
   * @param {object} config - audio.json 配置
   */
  init(config) {
    this.config = config;
    this.masterVolume = config.masterVolume !== undefined ? config.masterVolume : 1.0;
    this.sfxVolume = config.sfxVolume !== undefined ? config.sfxVolume : 0.8;
    this.bgmVolume = config.bgmVolume !== undefined ? config.bgmVolume : 0.5;
    this.muted = config.muted || false;

    // 注册所有音效
    if (config.sfx) {
      for (const [id, sfxConfig] of Object.entries(config.sfx)) {
        this.register(id, sfxConfig.url, sfxConfig.volume, sfxConfig.throttle);
        this.enabledMap[id] = sfxConfig.enabled !== false;
      }
    }

    // 注册 BGM
    if (config.bgm && config.bgm.url) {
      this.bgmUrl = config.bgm.url;
    }

    this.initialized = true;

    // WX 环境：音频资源未就绪时禁用音效/BGM 播放（缺失文件 set src 会刷基础库红字，无法拦截）
    this.wxAudioReady = this.platform !== 'wechat' || WX_AUDIO_ASSETS_READY;
    if (this.platform === 'wechat' && !this.wxAudioReady) {
      console.warn('[AudioManager] 音频资源未就绪（assets/audio/ 下无 mp3），已禁用音效播放以避免基础库报错；放置音频文件后请将 WX_AUDIO_ASSETS_READY 置为 true');
    }

    console.log('[AudioManager] Initialized with', Object.keys(config.sfx || {}).length, 'sound effects');
  }

  /**
   * 注册一个音效
   *
   * 微信环境懒创建音频实例（避免 IDE set src 时直接 readFile 报错）：
   *   - IDE 模拟器无 mp3 文件时，set src 会触发一堆 readFile 红字
   *   - 改为 play() 时按需创建音频，缺失则静默吞掉
   * 浏览器预览仍预创建池（同音效快速重复播放不卡顿）
   */
  register(id, url, volume = 1.0, throttle = 0) {
    this.sounds[id] = {
      url,
      volume,
      pool: [],
      poolIndex: 0,
      /** 微信环境下首次 play() 时才真正创建音频实例 */
      lazyCreated: this.platform === 'wechat',
    };
    this.throttleMap[id] = throttle || 0;
    this._lastPlayTime[id] = 0;

    // 浏览器环境预创建音效池（保留原行为）
    if (this.platform !== 'wechat') {
      const poolSize = Math.min(MAX_POOL_SIZE, 3);
      for (let i = 0; i < poolSize; i++) {
        this.sounds[id].pool.push(this._createAudio(url));
      }
    }
  }

  /**
   * 创建音频实例(跨平台)
   *
   * WX 环境容错：创建/初始化失败返回 null，play() 自行处理
   * 浏览器环境预创建池，错误抛出（上线路径明确）
   * @private
   */
  _createAudio(url) {
    if (this.platform === 'wechat') {
      try {
        const ctx = wx.createInnerAudioContext();
        ctx.src = url;
        ctx.volume = 1.0;
        // 静默吞掉 onError（mp3 缺失/路径错误不阻塞游戏）
        // IDE 模拟器主动 readFile 的红字无法拦截（这是 IDE 自身校验），
        // 但玩家真机上 line 是一次性 onError，永不刷屏
        try { ctx.onError(() => {}); } catch (e) {}
        return ctx;
      } catch (e) {
        return null;
      }
    } else {
      const audio = new Audio();
      audio.src = url;
      audio.preload = 'auto';
      return audio;
    }
  }

  /**
   * 播放音效
   * @param {string} id - 音效ID
   * @param {number} volumeOverride - 临时覆盖音量(可选)
   */
  play(id, volumeOverride) {
    if (!this.initialized || this.muted || !this.sfxEnabled) return;
    if (this.platform === 'wechat' && !this.wxAudioReady) return; // 音频资源缺失，静默跳过
    const sound = this.sounds[id];
    if (!sound || this.enabledMap[id] === false) return;

    // 节流检查
    const now = Date.now() / 1000;
    const throttle = this.throttleMap[id] || 0;
    if (throttle > 0 && now - this._lastPlayTime[id] < throttle) return;
    this._lastPlayTime[id] = now;

    // 微信懒创建：第一次 play() 才创建音频实例
    if (sound.lazyCreated && sound.pool.length === 0) {
      const inst = this._createAudio(sound.url);
      if (!inst) return; // mp3 缺失或创建失败，静默跳过
      sound.pool.push(inst);
    }

    // 从池中取一个实例
    const pool = sound.pool;
    if (pool.length === 0) return;
    const instance = pool[sound.poolIndex % pool.length];
    sound.poolIndex = (sound.poolIndex + 1) % pool.length;

    if (!instance) return;

    // 设置音量
    const vol = (volumeOverride !== undefined ? volumeOverride : sound.volume) * this.sfxVolume * this.masterVolume;
    try {
      instance.volume = Math.min(1, Math.max(0, vol));
    } catch (e) { /* 某些平台可能不支持动态音量 */ }

    // 播放
    try {
      if (this.platform === 'wechat') {
        // 微信: 需要stop再play才能重播
        try { instance.stop(); } catch (e) {}
        instance.play();
      } else {
        // 浏览器: 重置currentTime
        instance.currentTime = 0;
        instance.play().catch(() => {});
      }
    } catch (e) {
      // 静默失败，不阻塞游戏
    }
  }

  /**
   * 播放 BGM
   */
  playBGM() {
    if (!this.initialized || !this.bgmUrl) return;
    if (this.platform === 'wechat' && !this.wxAudioReady) return; // 音频资源缺失，静默跳过
    if (!this.bgmEnabled) return; // 设置窗口关闭了 BGM
    if (this.bgm && !this.bgmPaused) return; // 已经在播放

    if (!this.bgm) {
      this.bgm = this._createAudio(this.bgmUrl);
      if (this.platform === 'wechat') {
        this.bgm.loop = true;
      } else {
        this.bgm.loop = true;
      }
    }

    try {
      this.bgm.volume = this.bgmVolume * this.masterVolume;
      this.bgm.play();
      this.bgmPaused = false;
    } catch (e) {}
  }

  /**
   * 暂停 BGM
   */
  pauseBGM() {
    if (!this.bgm) return;
    try {
      this.bgm.pause();
      this.bgmPaused = true;
    } catch (e) {}
  }

  /**
   * 恢复 BGM
   */
  resumeBGM() {
    if (!this.bgm || !this.bgmPaused) return;
    try {
      this.bgm.play();
      this.bgmPaused = false;
    } catch (e) {}
  }

  /**
   * 停止 BGM
   */
  stopBGM() {
    if (!this.bgm) return;
    try {
      this.bgm.stop();
      this.bgmPaused = true;
    } catch (e) {}
  }

  /**
   * 切换静音
   * @returns {boolean} 切换后的静音状态
   */
  toggleMute() {
    this.muted = !this.muted;
    if (this.muted) {
      this.pauseBGM();
    } else {
      this.resumeBGM();
    }
    return this.muted;
  }

  /**
   * 设置音效独立开关（设置窗口）
   * @param {boolean} v
   */
  setSfxEnabled(v) {
    this.sfxEnabled = !!v;
    return this.sfxEnabled;
  }

  /**
   * 设置 BGM 独立开关（设置窗口）：关闭时立即暂停，开启时恢复（总静音时除外）
   * @param {boolean} v
   */
  setBgmEnabled(v) {
    this.bgmEnabled = !!v;
    if (!this.bgmEnabled) {
      this.pauseBGM();
    } else if (!this.muted) {
      this.resumeBGM();
    }
    return this.bgmEnabled;
  }

  /**
   * 设置总音量
   * @param {number} vol - 0~1
   */
  setMasterVolume(vol) {
    this.masterVolume = Math.min(1, Math.max(0, vol));
    if (this.bgm) {
      try { this.bgm.volume = this.bgmVolume * this.masterVolume; } catch (e) {}
    }
  }

  /**
   * 设置音效音量
   * @param {number} vol - 0~1
   */
  setSfxVolume(vol) {
    this.sfxVolume = Math.min(1, Math.max(0, vol));
  }

  /**
   * 设置 BGM 音量
   * @param {number} vol - 0~1
   */
  setBgmVolume(vol) {
    this.bgmVolume = Math.min(1, Math.max(0, vol));
    if (this.bgm) {
      try { this.bgm.volume = this.bgmVolume * this.masterVolume; } catch (e) {}
    }
  }

  /**
   * 销毁所有音频资源
   */
  destroy() {
    for (const id in this.sounds) {
      for (const instance of this.sounds[id].pool) {
        try {
          if (this.platform === 'wechat') {
            instance.destroy();
          } else {
            instance.pause();
            instance.src = '';
          }
        } catch (e) {}
      }
    }
    this.sounds = {};
    if (this.bgm) {
      try {
        if (this.platform === 'wechat') {
          this.bgm.destroy();
        }
      } catch (e) {}
      this.bgm = null;
    }
    this.initialized = false;
  }

  // ============ 便捷方法 ============

  /**
   * 翻格音效
   */
  playFlip() { this.play('flip'); }

  /**
   * 随机格揭晓
   */
  playRandomReveal() { this.play('random_reveal'); }

  /**
   * 建筑创建
   */
  playBuild() { this.play('build'); }

  /**
   * 建筑摧毁
   */
  playDestroy() { this.play('destroy'); }

  /**
   * 编组出发
   */
  playMarch() { this.play('march'); }

  /**
   * 战斗(vs建筑)
   */
  playCombatBuilding() { this.play('combat_building'); }

  /**
   * 战斗(vs战士)
   */
  playCombatWarrior() { this.play('combat_warrior'); }

  /**
   * 箭塔射击
   */
  playTowerShoot() { this.play('tower_shoot'); }

  /**
   * 暴击
   */
  playCrit() { this.play('crit'); }

  /**
   * 回血
   */
  playHeal() { this.play('heal'); }

  /**
   * 复活
   */
  playRevive() { this.play('revive'); }

  /**
   * 羁绊激活
   */
  playSynergy() { this.play('synergy'); }

  /**
   * 胜利
   */
  playVictory() { this.play('victory'); }

  /**
   * 失败
   */
  playDefeat() { this.play('defeat'); }

  /**
   * 按钮点击
   */
  playButtonClick() { this.play('button_click'); }

  /**
   * 关卡选择
   */
  playLevelSelect() { this.play('level_select'); }

  /**
   * 金币获取
   */
  playCoin() { this.play('coin'); }

  /**
   * 触觉震动（跨平台）
   *  - 微信: wx.vibrateShort({ type }) / 高强度用 vibrateLong
   *  - 浏览器: navigator.vibrate(ms)
   * @param {string} level - light(15ms) / medium(30ms) / strong(60ms)，带防抖
   */
  vibrate(level = 'light') {
    if (!this.hapticEnabled || this.muted) return;
    const durations = { light: 15, medium: 30, strong: 60 };
    const now = Date.now();
    const last = this._lastVibrateTime[level] || 0;
    if (now - last < (this.vibrateIntervals[level] || 90)) return;
    this._lastVibrateTime[level] = now;

    try {
      // 真机判据：wx.connectSocket 是微信小游戏独有 API（wx-shim 不暴露），
      // 避免浏览器预览加载 wx-shim 后，因 platform 被误判为 wechat 而调用空实现震动。
      // 与 Game._isWechatEnv() 保持一致的真机分界。
      const isWxNative = typeof wx !== 'undefined'
        && typeof wx.connectSocket === 'function';

      if (isWxNative) {
        if (level === 'strong' && typeof wx.vibrateLong === 'function') {
          wx.vibrateLong();
        } else if (typeof wx.vibrateShort === 'function') {
          wx.vibrateShort({ type: level === 'medium' ? 'medium' : 'light' });
        }
      } else if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
        navigator.vibrate(durations[level]);
      }
    } catch (e) { /* 震动失败静默忽略（部分设备/浏览器不支持） */ }
  }

  /** 轻震动（翻格/按钮/射击） */
  vibrateLight() { this.vibrate('light'); }

  /** 中震动（建造/命中/暴击） */
  vibrateMedium() { this.vibrate('medium'); }

  /** 强震动（胜负结算） */
  vibrateStrong() { this.vibrate('strong'); }
}

// 单例
const audioManager = new AudioManager();
export default audioManager;
