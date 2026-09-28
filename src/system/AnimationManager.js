/**
 * 动画与特效系统
 *
 * 统一管理：
 *  - 粒子系统 (爆炸/火花/碎片/光芒)
 *  - 屏幕震动
 *  - 建筑崩塌动画
 *  - 羁绊激活光效 (1/2/3阶)
 *  - 胜利烟花
 *  - 暴击特写
 *
 * 所有特效通过 addParticle / trigger* 方法注册，
 * 在 update(dt) 中推进生命周期，在 render(ctx) 中绘制。
 */

// ============ 缓动函数 ============
const Ease = {
  linear: t => t,
  easeOut: t => 1 - Math.pow(1 - t, 2),
  easeIn: t => t * t,
  easeInOut: t => t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2,
  easeOutBack: t => {
    const c1 = 1.70158, c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
  },
  easeOutBounce: t => {
    const n1 = 7.5625, d1 = 2.75;
    if (t < 1 / d1) return n1 * t * t;
    if (t < 2 / d1) return n1 * (t -= 1.5 / d1) * t + 0.75;
    if (t < 2.5 / d1) return n1 * (t -= 2.25 / d1) * t + 0.9375;
    return n1 * (t -= 2.625 / d1) * t + 0.984375;
  },
};

export class AnimationManager {
  constructor() {
    /** @type {Particle[]} */
    this.particles = [];
    /** @type {ComplexAnimation[]} */
    this.animations = [];
    /** Screen shake state */
    this.shake = { intensity: 0, duration: 0, timer: 0, offsetX: 0, offsetY: 0 };
    /** Flash overlay state (white/red screen flash) */
    this.flash = { color: '#fff', alpha: 0, duration: 0, timer: 0 };
    /** Max particles cap for performance */
    this.maxParticles = 300;
    /** Whether animations are enabled (can be toggled for low-end devices) */
    this.enabled = true;
  }

  // ============ 粒子系统 ============

  /**
   * 生成粒子
   * @param {number} x - 世界坐标X
   * @param {number} y - 世界坐标Y
   * @param {object} opts - 粒子选项
   */
  addParticle(x, y, opts = {}) {
    if (this.particles.length >= this.maxParticles) return;
    this.particles.push(new Particle(x, y, opts));
  }

  /**
   * 爆炸粒子效果
   * @param {number} x
   * @param {number} y
   * @param {string} color - 粒子颜色
   * @param {number} count - 粒子数量
   * @param {number} power - 爆炸力度
   */
  explosion(x, y, color = '#ff6b6b', count = 12, power = 80) {
    if (!this.enabled) return;
    for (let i = 0; i < count; i++) {
      const angle = (Math.PI * 2 * i) / count + Math.random() * 0.5;
      const speed = power * (0.5 + Math.random() * 0.5);
      this.addParticle(x, y, {
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        color,
        size: 2 + Math.random() * 3,
        life: 0.4 + Math.random() * 0.3,
        gravity: 60,
        fade: true,
        shrink: true,
      });
    }
  }

  /**
   * 火花粒子 (小范围)
   * @param {number} x
   * @param {number} y
   * @param {string} color
   * @param {number} count
   */
  spark(x, y, color = '#ffcc44', count = 6) {
    if (!this.enabled) return;
    for (let i = 0; i < count; i++) {
      this.addParticle(x, y, {
        vx: (Math.random() - 0.5) * 60,
        vy: (Math.random() - 0.5) * 60 - 20,
        color,
        size: 1.5 + Math.random() * 2,
        life: 0.3 + Math.random() * 0.2,
        gravity: 80,
        fade: true,
        shrink: true,
      });
    }
  }

  /**
   * 光环扩散效果 (羁绊激活用)
   * @param {number} x
   * @param {number} y
   * @param {string} color
   * @param {number} maxRadius
   * @param {number} duration
   */
  ringPulse(x, y, color = '#8b5cf6', maxRadius = 40, duration = 0.8) {
    if (!this.enabled) return;
    this.animations.push(new RingPulse(x, y, color, maxRadius, duration));
  }

  /**
   * 文字飘字效果
   * @param {number} x
   * @param {number} y
   * @param {string} text
   * @param {string} color
   * @param {number} duration
   * @param {number} size
   */
  floatingText(x, y, text, color = '#fff', duration = 0.8, size = 14) {
    if (!this.enabled) return;
    this.animations.push(new FloatingText(x, y, text, color, duration, size));
  }

  // ============ 屏幕震动 ============

  /**
   * 触发屏幕震动
   * @param {number} intensity - 震动幅度(像素)
   * @param {number} duration - 持续时间(秒)
   */
  shakeScreen(intensity = 5, duration = 0.3) {
    // 镜头震动已全局关闭（PM 需求 2026-09-09：关闭所有镜头震动）
    return;
    // 取较大值，避免小震动覆盖大震动
    if (intensity > this.shake.intensity || this.shake.timer <= 0) {
      this.shake.intensity = intensity;
      this.shake.duration = duration;
      this.shake.timer = duration;
    }
  }

  /**
   * 触发屏幕闪光
   * @param {string} color - 闪光颜色
   * @param {number} alpha - 最大透明度
   * @param {number} duration - 持续时间(秒)
   */
  flashScreen(color = '#fff', alpha = 0.4, duration = 0.15) {
    if (!this.enabled) return;
    this.flash.color = color;
    this.flash.alpha = alpha;
    this.flash.duration = duration;
    this.flash.timer = duration;
  }

  // ============ 高级动画 ============

  /**
   * 建筑崩塌动画
   * @param {number} x - 世界坐标X
   * @param {number} y - 世界坐标Y
   * @param {string} color - 建筑颜色
   * @param {boolean} isHeadquarters - 是否是大本营(更大爆炸)
   */
  buildingCollapse(x, y, color = '#888', isHeadquarters = false) {
    if (!this.enabled) return;
    const particleCount = isHeadquarters ? 30 : 15;
    const power = isHeadquarters ? 120 : 80;

    // 爆炸粒子
    this.explosion(x, y, color, particleCount, power);
    this.explosion(x, y, '#ffaa00', particleCount / 2, power * 0.7);

    // 崩塌碎片(向下掉落)
    for (let i = 0; i < (isHeadquarters ? 20 : 10); i++) {
      this.addParticle(x + (Math.random() - 0.5) * 20, y + (Math.random() - 0.5) * 20, {
        vx: (Math.random() - 0.5) * 50,
        vy: -Math.random() * 40 - 20,
        color,
        size: 2 + Math.random() * 4,
        life: 0.8 + Math.random() * 0.4,
        gravity: 200,
        fade: true,
        shrink: true,
        shape: 'square',
      });
    }

    // 烟雾效果
    for (let i = 0; i < (isHeadquarters ? 12 : 6); i++) {
      this.addParticle(x + (Math.random() - 0.5) * 15, y, {
        vx: (Math.random() - 0.5) * 20,
        vy: -30 - Math.random() * 20,
        color: '#666',
        size: 5 + Math.random() * 5,
        life: 1.0 + Math.random() * 0.5,
        gravity: -10,
        fade: true,
        grow: true,
      });
    }

    // 屏幕震动
    this.shakeScreen(isHeadquarters ? 12 : 5, isHeadquarters ? 0.5 : 0.2);

    // 大本营被摧毁时屏幕闪光
    if (isHeadquarters) {
      this.flashScreen('#ffaa00', 0.5, 0.2);
    }
  }

  /**
   * 羁绊激活光效
   * @param {number} x - 世界坐标X (通常是大本营位置)
   * @param {number} y - 世界坐标Y
   * @param {number} tier - 羁绊阶数 (1/2/3)
   * @param {string} color - 种族颜色
   */
  synergyActivate(x, y, tier = 1, color = '#8b5cf6') {
    if (!this.enabled) return;
    const maxRadius = 30 + tier * 20;
    const duration = 0.6 + tier * 0.2;
    const particleCount = 8 + tier * 6;

    // 光环扩散
    this.ringPulse(x, y, color, maxRadius, duration);
    if (tier >= 2) {
      setTimeout(() => this.ringPulse(x, y, color, maxRadius * 1.3, duration), 100);
    }
    if (tier >= 3) {
      setTimeout(() => this.ringPulse(x, y, '#ffd700', maxRadius * 1.6, duration), 200);
    }

    // 上升光粒子
    for (let i = 0; i < particleCount; i++) {
      const angle = (Math.PI * 2 * i) / particleCount;
      const dist = 10 + Math.random() * 15;
      this.addParticle(x + Math.cos(angle) * dist, y + Math.sin(angle) * dist, {
        vx: Math.cos(angle) * 20,
        vy: -30 - Math.random() * 30,
        color: tier >= 3 ? '#ffd700' : color,
        size: 2 + tier + Math.random() * 2,
        life: 0.8 + tier * 0.2,
        gravity: -20,
        fade: true,
        shrink: false,
        glow: true,
      });
    }

    // 飘字
    const tierText = ['', 'I', 'II', 'III'][tier] || '';
    this.floatingText(x, y - 30, `羁绊${tierText}!`, color, 1.0, 14 + tier * 2);

    // 高阶羁绊触发震动
    if (tier >= 2) {
      this.shakeScreen(3 + tier, 0.2);
    }
  }

  /**
   * 暴击特写效果
   * @param {number} x - 世界坐标X
   * @param {number} y - 世界坐标Y
   */
  critEffect(x, y) {
    if (!this.enabled) return;
    // 黄色爆炸
    this.explosion(x, y, '#ffdd00', 16, 100);
    this.explosion(x, y, '#ff6600', 8, 60);
    // 不做全屏闪光/屏幕抖动，避免频繁暴击时画面晃动刺眼
    // 暴击文字
    this.floatingText(x, y - 15, '暴击!', '#ffdd00', 1.0, 18);
  }

  /**
   * 胜利烟花
   * @param {number} screenWidth - 屏幕宽度
   * @param {number} screenHeight - 屏幕高度
   */
  victoryFireworks(screenWidth, screenHeight) {
    if (!this.enabled) return;
    const colors = ['#ff6b6b', '#4ade80', '#fbbf24', '#60a5fa', '#a78bfa', '#f472b6'];
    let count = 0;
    const maxFireworks = 8;
    const interval = 300; // ms

    const launch = () => {
      if (count >= maxFireworks) return;
      const x = screenWidth * (0.2 + Math.random() * 0.6);
      const y = screenHeight * (0.15 + Math.random() * 0.35);
      const color = colors[Math.floor(Math.random() * colors.length)];

      // 烟花粒子
      this.explosion(x, y, color, 20, 100);

      // 添加到动画列表(使用屏幕坐标，不经过相机变换)
      this.animations.push(new Firework(x, y, color));

      count++;
      setTimeout(launch, interval + Math.random() * 200);
    };
    launch();
  }

  /**
   * 失败灰暗效果
   * @param {number} screenWidth
   * @param {number} screenHeight
   */
  defeatEffect(screenWidth, screenHeight) {
    if (!this.enabled) return;
    this.flashScreen('#1a0000', 0.5, 0.4);
    this.shakeScreen(8, 0.4);
  }

  // ============ 更新 ============

  update(dt) {
    // 更新粒子
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.update(dt);
      if (p.life <= 0) {
        this.particles.splice(i, 1);
      }
    }

    // 更新复杂动画
    for (let i = this.animations.length - 1; i >= 0; i--) {
      const a = this.animations[i];
      a.update(dt);
      if (a.done) {
        this.animations.splice(i, 1);
      }
    }

    // 更新屏幕震动
    if (this.shake.timer > 0) {
      this.shake.timer -= dt;
      const progress = this.shake.timer / this.shake.duration;
      const decay = Math.max(0, progress);
      const intensity = this.shake.intensity * decay;
      this.shake.offsetX = (Math.random() - 0.5) * 2 * intensity;
      this.shake.offsetY = (Math.random() - 0.5) * 2 * intensity;
      if (this.shake.timer <= 0) {
        this.shake.offsetX = 0;
        this.shake.offsetY = 0;
      }
    }

    // 更新闪光
    if (this.flash.timer > 0) {
      this.flash.timer -= dt;
      if (this.flash.timer <= 0) {
        this.flash.alpha = 0;
      }
    }
  }

  // ============ 渲染 ============

  /**
   * 获取屏幕震动偏移
   * @returns {{offsetX: number, offsetY: number}}
   */
  getShakeOffset() {
    return { offsetX: this.shake.offsetX, offsetY: this.shake.offsetY };
  }

  /**
   * 在相机变换内绘制粒子(世界空间)
   * @param {CanvasRenderingContext2D} ctx
   */
  renderWorld(ctx) {
    // 绘制粒子
    for (const p of this.particles) {
      p.render(ctx);
    }

    // 绘制世界空间动画(光环/飘字等)
    for (const a of this.animations) {
      if (a.space === 'world') {
        a.render(ctx);
      }
    }
  }

  /**
   * 在相机变换外绘制(屏幕空间)
   * @param {CanvasRenderingContext2D} ctx
   */
  renderScreen(ctx) {
    // 屏幕空间动画(烟花等)
    for (const a of this.animations) {
      if (a.space === 'screen') {
        a.render(ctx);
      }
    }

    // 闪光覆盖层
    if (this.flash.alpha > 0 && this.flash.timer > 0) {
      const progress = this.flash.timer / this.flash.duration;
      ctx.globalAlpha = this.flash.alpha * progress;
      ctx.fillStyle = this.flash.color;
      ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
      ctx.globalAlpha = 1;
    }
  }

  /**
   * 清除所有特效
   */
  clear() {
    this.particles = [];
    this.animations = [];
    this.shake.timer = 0;
    this.shake.offsetX = 0;
    this.shake.offsetY = 0;
    this.flash.alpha = 0;
    this.flash.timer = 0;
  }
}

// ============ 粒子类 ============

class Particle {
  constructor(x, y, opts = {}) {
    this.x = x;
    this.y = y;
    this.vx = opts.vx || 0;
    this.vy = opts.vy || 0;
    this.gravity = opts.gravity || 0;
    this.color = opts.color || '#fff';
    this.size = opts.size || 3;
    this.life = opts.life || 0.5;
    this.maxLife = this.life;
    this.fade = opts.fade !== false;
    this.shrink = opts.shrink || false;
    this.grow = opts.grow || false;
    this.shape = opts.shape || 'circle'; // circle / square
    this.glow = opts.glow || false;
  }

  update(dt) {
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this.vy += this.gravity * dt;
    // 空气阻力
    this.vx *= 0.98;
    this.vy *= 0.98;
    this.life -= dt;
  }

  render(ctx) {
    const t = Math.max(0, this.life / this.maxLife);
    const alpha = this.fade ? t : 1;
    let size = this.size;
    if (this.shrink) size = this.size * t;
    if (this.grow) size = this.size * (1 + (1 - t) * 0.5);

    if (size <= 0.1) return;

    ctx.globalAlpha = alpha;

    if (this.glow) {
      ctx.shadowBlur = 8;
      ctx.shadowColor = this.color;
    }

    ctx.fillStyle = this.color;
    if (this.shape === 'square') {
      ctx.fillRect(this.x - size / 2, this.y - size / 2, size, size);
    } else {
      ctx.beginPath();
      ctx.arc(this.x, this.y, size, 0, Math.PI * 2);
      ctx.fill();
    }

    if (this.glow) {
      ctx.shadowBlur = 0;
    }
    ctx.globalAlpha = 1;
  }
}

// ============ 复杂动画基类 ============

class ComplexAnimation {
  constructor() {
    this.timer = 0;
    this.duration = 1;
    this.done = false;
    this.space = 'world'; // 'world' or 'screen'
  }
  update(dt) {
    this.timer += dt;
    if (this.timer >= this.duration) this.done = true;
  }
  get progress() { return Math.min(1, this.timer / this.duration); }
  render(ctx) {}
}

// ============ 光环扩散 ============

class RingPulse extends ComplexAnimation {
  constructor(x, y, color, maxRadius, duration) {
    super();
    this.x = x;
    this.y = y;
    this.color = color;
    this.maxRadius = maxRadius;
    this.duration = duration;
    this.space = 'world';
  }
  render(ctx) {
    const p = this.progress;
    const radius = this.maxRadius * Ease.easeOut(p);
    const alpha = 1 - p;
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = this.color;
    ctx.lineWidth = 2 + (1 - p) * 2;
    ctx.beginPath();
    ctx.arc(this.x, this.y, radius, 0, Math.PI * 2);
    ctx.stroke();
    // 内圈微光
    ctx.globalAlpha = alpha * 0.2;
    ctx.fillStyle = this.color;
    ctx.beginPath();
    ctx.arc(this.x, this.y, radius * 0.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }
}

// ============ 飘字 ============

class FloatingText extends ComplexAnimation {
  constructor(x, y, text, color, duration, size) {
    super();
    this.x = x;
    this.y = y;
    this.text = text;
    this.color = color;
    this.duration = duration;
    this.size = size;
    this.space = 'world';
  }
  render(ctx) {
    const p = this.progress;
    const yOffset = -30 * Ease.easeOut(p);
    const alpha = p < 0.7 ? 1 : 1 - (p - 0.7) / 0.3;
    ctx.globalAlpha = alpha;
    ctx.fillStyle = this.color;
    ctx.font = `bold ${this.size}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    // 描边
    ctx.strokeStyle = 'rgba(0,0,0,0.6)';
    ctx.lineWidth = 2;
    ctx.strokeText(this.text, this.x, this.y + yOffset);
    ctx.fillText(this.text, this.x, this.y + yOffset);
    ctx.globalAlpha = 1;
  }
}

// ============ 烟花 ============

class Firework extends ComplexAnimation {
  constructor(x, y, color) {
    super();
    this.x = x;
    this.y = y;
    this.color = color;
    this.duration = 1.2;
    this.space = 'screen';
    this.particles = [];
    // 生成烟花粒子
    const count = 24;
    for (let i = 0; i < count; i++) {
      const angle = (Math.PI * 2 * i) / count;
      const speed = 40 + Math.random() * 30;
      this.particles.push({
        x: 0, y: 0,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        size: 2 + Math.random() * 2,
      });
    }
  }
  render(ctx) {
    const p = this.progress;
    const alpha = p < 0.3 ? p / 0.3 : 1 - (p - 0.3) / 0.7;
    ctx.globalAlpha = alpha;
    ctx.fillStyle = this.color;
    ctx.shadowBlur = 6;
    ctx.shadowColor = this.color;
    for (const part of this.particles) {
      const px = this.x + part.vx * this.timer;
      const py = this.y + part.vy * this.timer + 30 * this.timer * this.timer; // 重力
      const ps = part.size * (1 - p * 0.5);
      ctx.beginPath();
      ctx.arc(px, py, ps, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.shadowBlur = 0;
    ctx.globalAlpha = 1;
  }
}

export default AnimationManager;
