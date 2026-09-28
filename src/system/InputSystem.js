/**
 * 输入系统
 * 触控输入：点击翻转 / 拖动平移 / 双指缩放
 *
 * 微信小游戏 Canvas2D 实例没有 DOM 风格的 addEventListener，
 * 因此 WX 环境必须改用全局 wx.onTouchStart/Move/End（API 永不变）；
 * 浏览器环境走 DOM 路径（touchstart + mousedown + wheel 桌面调试）。
 */

export class InputSystem {
  constructor(canvas, screenWidth, screenHeight) {
    this.canvas = canvas;
    this.screenWidth = screenWidth;
    this.screenHeight = screenHeight;

    // 相机
    this.cameraX = 0;
    this.cameraY = 0;
    this.scale = 1;

    // 拖动状态
    this.isDragging = false;
    this.lastTouchX = 0;
    this.lastTouchY = 0;

    // 双指缩放
    this.lastDistance = 0;

    // P8 机型适配：纵向缩放系数（由 Game 注入 safeAreaScaleY，默认 1 = 无缩放）。
    // 渲染层把内容压缩了 scaleY 倍，手指在屏幕上移动 dy 像素时，内容需要移动
    // dy / scaleY 个 inner 像素才跟手。不除会让地图拖拽 / 菜单滚动「慢半拍」
    // （scaleY=0.89 时手指拖 100px 内容只走 89px）。
    this.touchScaleY = 1;
    // P36：安全区顶部偏移（由 Game 注入 safeAreaTop）。相机工作在 inner 坐标系，
    // 而触摸事件拿到的是屏幕坐标，双指中心必须换算回 inner 才能当缩放锚点。
    this.touchTop = 0;

    // 双指中心（已折算为 inner 坐标，与 cameraX/cameraY 同一坐标系），
    // 用于「以双指中心为锚点缩放」+ 双指整体平移
    this.lastCenterX = 0;
    this.lastCenterY = 0;

    // 相机是否启用(菜单界面禁用)
    this.cameraEnabled = false;

    // 菜单滚动回调
    this.onMenuScroll = null;

    // 拖拽回调（deploy_select 界面用）
    this.onDeployTouchStart = null;  // (x, y) => void
    this.onDeployTouchMove = null;   // (x, y) => void
    this.onDeployTouchEnd = null;    // (x, y, isDrag) => void

    // 回调
    this.onTileClick = null;

    // 按压状态回调（按钮按压缩放反馈：按下/释放）
    this.onPress = null;    // (x, y) => void
    this.onRelease = null;  // () => void

    // 标记是否在 WX 环境（构造时一次检测，bindEvents 内部使用）
    this._isWx = typeof wx !== 'undefined' && typeof wx.onTouchStart === 'function';

    this.bindEvents();
  }

  /**
   * 设置相机初始位置(居中地图)
   */
  centerCamera(mapWidth, mapHeight) {
    this.cameraX = this.screenWidth / 2;
    this.cameraY = this.screenHeight / 2;
  }

  /**
   * 绑定触摸/鼠标事件
   * WX 环境：wx.onTouchStart/Move/End（全局，永不变）
   * 浏览器环境：canvas.addEventListener（DOM） + 桌面调试 mouse/wheel
   */
  bindEvents() {
    if (this._isWx) {
      // === 微信小游戏：全局触摸 API ===
      wx.onTouchStart(this._onTouchStart.bind(this));
      wx.onTouchMove(this._onTouchMove.bind(this));
      wx.onTouchEnd(this._onTouchEnd.bind(this));
      wx.onTouchCancel(this._onTouchEnd.bind(this)); // cancel 复用 end 逻辑
    } else {
      // === 浏览器：DOM 事件 ===
      this.canvas.addEventListener('touchstart', this._onTouchStart.bind(this), { passive: true });
      this.canvas.addEventListener('touchmove', this._onTouchMove.bind(this), { passive: true });
      this.canvas.addEventListener('touchend', this._onTouchEnd.bind(this), { passive: true });
      this.canvas.addEventListener('touchcancel', this._onTouchEnd.bind(this), { passive: true });
      this._bindMouseEvents();
    }
  }

  /**
   * 桌面鼠标 + 滚轮（浏览器专用，手机端无 mouse 事件）
   */
  _bindMouseEvents() {
    let mouseDown = false;

    this.canvas.addEventListener('mousedown', (e) => {
      mouseDown = true;
      this.isDragging = false;
      this.lastTouchX = e.clientX;
      this.lastTouchY = e.clientY;
      if (this.onPress) this.onPress(e.clientX, e.clientY);
      if (this.onDeployTouchStart) {
        this.onDeployTouchStart(e.clientX, e.clientY);
      }
    });

    this.canvas.addEventListener('mousemove', (e) => {
      if (!mouseDown) return;
      // P8：增量换算到 inner 坐标系（内容被纵向压缩了 touchScaleY 倍，不除会「慢半拍」）
      const s = this.touchScaleY || 1;
      const dx = (e.clientX - this.lastTouchX) / s;
      const dy = (e.clientY - this.lastTouchY) / s;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
        this.isDragging = true;
      }
      if (this.isDragging) {
        if (this.onDeployTouchMove) {
          this.onDeployTouchMove(e.clientX, e.clientY);
        } else if (this.cameraEnabled) {
          this.cameraX += dx;
          this.cameraY += dy;
        } else if (this.onMenuScroll) {
          this.onMenuScroll(-dy); // 触摸/拖拽：dy 正=向下拖 → 内容下移(scrollY减)，取反对齐滚轮 deltaY 语义
        }
      }
      this.lastTouchX = e.clientX;
      this.lastTouchY = e.clientY;
    });

    this.canvas.addEventListener('mouseup', (e) => {
      if (mouseDown) {
        if (this.onRelease) this.onRelease(e.clientX, e.clientY);
        if (this.onDeployTouchEnd) {
          this.onDeployTouchEnd(e.clientX, e.clientY, this.isDragging);
        } else if (!this.isDragging) {
          this.handleTap(e.clientX, e.clientY);
        }
      }
      mouseDown = false;
      this.isDragging = false;
    });

    // 鼠标滚轮缩放(游戏中)/滚动(菜单)
    this.canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      if (this.cameraEnabled) {
        const delta = e.deltaY > 0 ? 0.9 : 1.1;
        const prevScale = this.scale;
        const nextScale = Math.max(0.35, Math.min(2.0, prevScale * delta));
        // P36：与双指一致，以指针位置为锚点缩放（桌面调试镜像真机手感）
        const s = this.touchScaleY || 1;
        const ax = e.clientX;
        const ay = (e.clientY - (this.touchTop || 0)) / s;
        const k = nextScale / prevScale;
        if (k !== 1) {
          this.cameraX = ax - k * (ax - this.cameraX);
          this.cameraY = ay - k * (ay - this.cameraY);
        }
        this.scale = nextScale;
      } else if (this.onMenuScroll) {
        this.onMenuScroll(e.deltaY);
      }
    }, { passive: false });
  }

  /**
   * touchstart 通用处理（WX + browser 共用）
   */
  _onTouchStart(e) {
    const touches = e.touches;
    if (touches.length === 1) {
      this.isDragging = false;
      const t = touches[0];
      this.lastTouchX = t.clientX;
      this.lastTouchY = t.clientY;
      if (this.onPress) this.onPress(t.clientX, t.clientY);
      if (this.onDeployTouchStart) {
        this.onDeployTouchStart(t.clientX, t.clientY);
      }
    } else if (touches.length === 2) {
      this.lastDistance = this.getTouchDistance(touches);
      const c = this._innerCenter(touches);
      this.lastCenterX = c.x;
      this.lastCenterY = c.y;
      // 双指落下即视为拖拽，避免抬起一指时残留的单指状态被判成点击
      this.isDragging = true;
    }
  }

  /**
   * touchmove 通用处理
   */
  _onTouchMove(e) {
    const touches = e.touches;
    if (touches.length === 1) {
      const t = touches[0];
      const x = t.clientX;
      const y = t.clientY;
      // P8：增量换算到 inner 坐标系（内容被纵向压缩了 touchScaleY 倍，不除会「慢半拍」）
      const s = this.touchScaleY || 1;
      const dx = (x - this.lastTouchX) / s;
      const dy = (y - this.lastTouchY) / s;

      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
        this.isDragging = true;
      }

      if (this.isDragging) {
        if (this.onDeployTouchMove) {
          this.onDeployTouchMove(x, y);
        } else if (this.cameraEnabled) {
          this.cameraX += dx;
          this.cameraY += dy;
        } else if (this.onMenuScroll) {
          this.onMenuScroll(-dy); // 触摸/拖拽：dy 正=向下拖 → 内容下移(scrollY减)，取反对齐滚轮 deltaY 语义
        }
      }

      this.lastTouchX = x;
      this.lastTouchY = y;
    } else if (touches.length === 2 && this.cameraEnabled) {
      const dist = this.getTouchDistance(touches);
      const c = this._innerCenter(touches);
      if (this.lastDistance > 0) {
        const prevScale = this.scale;
        let nextScale = prevScale * (dist / this.lastDistance);
        nextScale = Math.max(0.35, Math.min(2.0, nextScale));

        // ① 双指整体平移：相机跟随中心点位移（inner 坐标，与相机同坐标系）
        this.cameraX += c.x - this.lastCenterX;
        this.cameraY += c.y - this.lastCenterY;

        // ② 以双指中心为锚点缩放：让「中心下方那个世界点」缩放前后都停在中心
        //    渲染变换为 screen = camera + scale * world，故保持不动的条件是
        //    camera' = center - k * (center - camera)，k = newScale / oldScale
        const k = nextScale / prevScale;
        if (k !== 1) {
          this.cameraX = c.x - k * (c.x - this.cameraX);
          this.cameraY = c.y - k * (c.y - this.cameraY);
        }
        this.scale = nextScale;
      }
      this.lastDistance = dist;
      this.lastCenterX = c.x;
      this.lastCenterY = c.y;
    }
  }

  /**
   * touchend / touchcancel 通用处理
   */
  _onTouchEnd(e) {
    const changed = e.changedTouches;
    if (changed && changed.length === 1) {
      const t = changed[0];
      const x = t.clientX;
      const y = t.clientY;
      if (this.onRelease) this.onRelease(x, y);
      if (this.onDeployTouchEnd) {
        this.onDeployTouchEnd(x, y, this.isDragging);
      } else if (!this.isDragging) {
        this.handleTap(x, y);
      }
    }
    this.isDragging = false;
    this.lastDistance = 0;
    this.lastCenterX = 0;
    this.lastCenterY = 0;
    // P36：双指抬起一指后，剩余手指继续拖动必须以它的当前位置为基准，
    // 否则会沿用「最初单指按下」的 lastTouchX/Y，产生一次大幅跳变（且跳变会被判成拖拽）。
    if (e.touches && e.touches.length === 1) {
      this.lastTouchX = e.touches[0].clientX;
      this.lastTouchY = e.touches[0].clientY;
      this.isDragging = true;
    }
  }

  /**
   * 处理点击
   */
  handleTap(screenX, screenY) {
    if (this.onTileClick) {
      this.onTileClick(screenX, screenY);
    } else {
      console.warn('[InputSystem] onTileClick is null — click ignored');
    }
  }

  /**
   * 计算双指距离
   */
  getTouchDistance(touches) {
    const dx = touches[0].clientX - touches[1].clientX;
    const dy = touches[0].clientY - touches[1].clientY;
    return Math.sqrt(dx * dx + dy * dy);
  }

  /**
   * 计算双指中心（屏幕坐标）
   */
  getTouchCenter(touches) {
    return {
      x: (touches[0].clientX + touches[1].clientX) / 2,
      y: (touches[0].clientY + touches[1].clientY) / 2,
    };
  }

  /**
   * 双指中心 → inner 坐标（与 cameraX/cameraY 同一坐标系）
   * 渲染层把 inner [0, h] 映射到屏幕 [top, h-bottom]，故 inner_y = (screen_y - top) / scaleY
   */
  _innerCenter(touches) {
    const c = this.getTouchCenter(touches);
    const s = this.touchScaleY || 1;
    return { x: c.x, y: (c.y - (this.touchTop || 0)) / s };
  }

  /**
   * 屏幕坐标 → 世界坐标
   */
  screenToWorld(screenX, screenY) {
    const worldX = (screenX - this.cameraX) / this.scale;
    const worldY = (screenY - this.cameraY) / this.scale;
    return { x: worldX, y: worldY };
  }
}