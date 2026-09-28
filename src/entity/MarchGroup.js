/**
 * 行军队伍类
 * 支持上阵模式(deploymentBundle)和种族模式(向后兼容)的差异化属性
 * 兵种数据来源：优先从 Building.unitData 获取（上阵模式），否则从 races.js 查找（种族模式）
 */

import { MARCH_SPEED } from '../config.js';
import { getUnitInfo, getUnitFullInfo } from '../data/races.js';
import { hexToPixel, pixelToHex } from '../world/HexMath.js';
import { SkillSystem } from '../system/SkillSystem.js';
import { battleRandom } from '../utils/rng.js';

let groupIdCounter = 0;

/**
 * 障碍净空系数(× hexSize)：路径与障碍格中心须保持的最小距离
 * 六边形内切圆半径 = √3/2 ≈ 0.866×size，取 0.9 保证不压进山/河图形
 * 拐点收紧用更严的 1.4，给转角圆弧化预留内切空间
 */
const CLEAR_STRAIGHT = 0.9;  // LOS 拉直 / 切角弦允许的最小净空
const CLEAR_PULL = 1.4;      // 拐点收紧(贴障碍边缘)的最小净空

export class MarchGroup {
  /**
   * @param {number} owner - 所属玩家ID
   * @param {number} warriors - 战士数量
   * @param {Building} sourceBuilding - 产出建筑
   * @param {HexTile} startTile - 起始格子
   */
  constructor(owner, warriors, sourceBuilding, startTile) {
    this.id = ++groupIdCounter;
    this.owner = owner;
    this.warriors = warriors;
    this._initialWarriors = warriors;  // 记录初始战士数(用于回血计算)
    this.attackBonus = sourceBuilding.attackBonus;
    this.unitType = sourceBuilding.unitType || '步兵';
    this.race = sourceBuilding.race;
    this.combatStyles = sourceBuilding.combatStyles || ['melee'];
    this.level = sourceBuilding.level || 1;

    // 兵种数据：优先从 Building.unitData 获取（上阵模式），否则从种族配置查找
    if (sourceBuilding.unitData) {
      const ud = sourceBuilding.unitData;
      this.speedCoeff = ud.speedCoeff || 1.0;
      this.hpCoeff = ud.hpCoeff || 1.0;
      this.unitSpecial = ud.special || null;
      // attackCoeff 已包含品质加成（由 DeploymentSystem.getUnitStats 计算）
      this._attackCoeff = ud.attackCoeff || 1.0;
      this._quality = ud.quality || 1;
      this._qualityMultiplier = ud.qualityMultiplier || 1.0;
      this._attackRange = ud.attackRange || 1;
      this._unitId = ud.unitId || null;
      // 外观数据：用于战斗渲染区分兵种
      this._unitIcon = ud.icon || '';
      this._unitName = ud.name || sourceBuilding.unitType || '';
      this._combatStyles = ud.combatStyles || sourceBuilding.combatStyles || ['melee'];
    } else {
      const unitInfo = getUnitFullInfo(this.race, this.level);
      this.speedCoeff = unitInfo ? (unitInfo.speedCoeff || 1.0) : 1.0;
      this.hpCoeff = unitInfo ? (unitInfo.hpCoeff || 1.0) : 1.0;
      this.unitSpecial = unitInfo ? (unitInfo.special || null) : null;
      this._attackCoeff = unitInfo ? (unitInfo.attackCoeff || 1.0) : 1.0;
      this._attackRange = 1; // 种族模式默认近战
      this._unitId = null;
      this._unitIcon = unitInfo ? (unitInfo.icon || '') : '';
      this._unitName = unitInfo ? (unitInfo.name || '') : this.unitType;
      this._combatStyles = sourceBuilding.combatStyles || ['melee'];
    }

    // 羁绊加成(实时更新，由 SynergySystem 写入)
    this.synergyBonuses = null;  // 完整羁绊加成对象
    // 向后兼容(种族模式)
    this.raceSynergyBonus = 0;
    this.styleSynergyBonus = 0;

    // 技能系统：被动聚合(SkillSystem.aggregatePassives 产物) + 主动技能状态
    // 上阵模式消费 unitData.skills(已按兵种等级解锁过滤)；种族模式按AI难度档位解锁
    this.skillPassives = null;
    this.activeSkill = null;
    this.skillCooldownTimer = 0;
    // 冲刺状态(主动技能 dash)：行军速度临时倍率
    this.dashFactor = 1.0;
    this.dashTimer = 0;
    // 召唤物标记(主动技能 summon 产物，不携带主动技能)
    this.isSummon = false;

    if (sourceBuilding.unitData && sourceBuilding.unitData.skills) {
      // 上阵模式：DeploymentSystem 已按兵种等级/品质解锁过滤
      SkillSystem.initGroupSkills(this, sourceBuilding.unitData.skills);
    } else {
      // 种族模式(敌方)：按当前AI难度档位解锁
      SkillSystem.initGroupSkills(this, SkillSystem.getEnemySkillList(this.race, this.level));
    }

    this.path = [];
    this.pathIndex = 0;
    this.currentTile = startTile;
    // 像素移动：路标点数组(各格中心像素坐标)，waypointIndex 为当前追踪的路标下标
    this.waypoints = [];
    this.waypointIndex = 0;
    this.state = 'marching';  // marching/fighting_building/fighting_warrior/destroyed/disbanded/arrived
    this.fightTarget = null;
    this.combatTimer = 0;

    // 基础行军速度 × 兵种速度系数
    this.speed = MARCH_SPEED * this.speedCoeff;

    // 减速状态(被诅咒尖塔攻击)
    this.slowFactor = 1.0;
    this.slowTimer = 0;

    // 局外养成加成
    this.metaSpeedBonus = 0;

    // 视觉
    this.pixelX = 0;
    this.pixelY = 0;
    this.targetPixelX = 0;
    this.targetPixelY = 0;

    // 击杀计数(兽族战争领主: 击杀后攻击力加成)
    this.killCount = 0;
    this.killBonus = 0;
  }

  /**
   * 召唤援军工厂(主动技能 summon 产物)
   * 从施法者复制兵种数据生成一支新队伍：
   *   - 不携带任何技能(空 skills → 无被动聚合、无主动技能，防无限召唤)
   *   - 出生于施法者当前位置，由 SkillSystem 负责设置路径并推入 marchGroups
   * @param {MarchGroup} caster - 施法者队伍
   * @param {number} warriors - 召唤兵力
   * @param {HexTile} startTile - 出生格子
   * @returns {MarchGroup}
   */
  static createSummon(caster, warriors, startTile) {
    const stub = {
      attackBonus: caster.attackBonus || 0,
      unitType: caster.unitType,
      race: caster.race,
      combatStyles: caster.combatStyles || ['melee'],
      level: caster.level || 1,
      // 空技能表：构造器 initGroupSkills 对空表直接跳过
      unitData: {
        attackCoeff: caster._attackCoeff || 1.0,
        hpCoeff: caster.hpCoeff || 1.0,
        speedCoeff: caster.speedCoeff || 1.0,
        attackRange: caster._attackRange || 1,
        productionSpeed: 1.0,
        special: caster.unitSpecial || null,
        quality: caster._quality || 1,
        qualityMultiplier: caster._qualityMultiplier || 1.0,
        unitId: caster._unitId || null,
        icon: caster._unitIcon || '',
        name: caster._unitName || caster.unitType || '',
        combatStyles: caster._combatStyles || ['melee'],
        skills: [],
      },
    };
    const g = new MarchGroup(caster.owner, Math.max(1, warriors), stub, startTile);
    g.isSummon = true;
    g.activeSkill = null;
    g.skillPassives = null;
    g.skillCooldownTimer = 0;
    // 出生于施法者当前位置
    g.pixelX = caster.pixelX;
    g.pixelY = caster.pixelY;
    g.state = 'marching';
    return g;
  }

  /**
   * 设置路径
   * 像素移动模式：先将格子路径换算为像素路标点(各格中心)，
   * 再做 line-of-sight 平滑——跳过能被当前路标直线看到的所有中间格，
   * 避免「先直走一段再 60° 拐弯」的多段折线感。
   * @param {HexTile[]} path - 格子路径(含起点和终点)
   * @param {HexMap} hexMap - 地图(用于格→像素换算)
   */
  setPath(path, hexMap) {
    this.path = path || [];
    this.pathIndex = 0;
    this.waypoints = [];
    this.waypointIndex = 0;
    if (this.path.length === 0 || !hexMap) {
      if (this.path.length > 0) this.currentTile = this.path[0];
      return;
    }

    this.currentTile = this.path[0];

    // 1) 收集原始路标点(像素坐标)
    //    - 若像素位置已初始化(行军中重寻路)，把当前位置作为首路标，
    //      这样 LOS 平滑会从「正在走的这一段」开始往后算，而不是回到 currentTile 折返
    //    - 未初始化(刚产兵)直接用 path[0] 作为起点
    const raw = [];
    const uninit = (this.pixelX === 0 && this.pixelY === 0);
    if (!uninit) {
      raw.push({ x: this.pixelX, y: this.pixelY });
    }
    for (const tile of this.path) {
      const p = hexToPixel(tile.q, tile.r, hexMap.size);
      raw.push({ x: p.x, y: p.y });
    }
    if (uninit) {
      this.pixelX = raw[0].x;
      this.pixelY = raw[0].y;
    }

    // 2) LOS 视线平滑：贪心从最远点往前找第一个能直接看到的
    this.waypoints = MarchGroup._smoothWaypoints(raw, hexMap);
    // 3) 追踪起点(已到达 waypoints[0])，下一目标为 waypoints[1]
    this.waypointIndex = this.waypoints.length > 1 ? 1 : 0;
    this.pathIndex = this.path.length > 1 ? 1 : 0;
  }

  /**
   * 路标点平滑：LOS 拉直 + 拐点收紧 + 转角圆弧化
   *
   * 1) LOS 拉直：每个路标 i 贪心跳到最远"直线净空可见"的路标 j，合并中间所有点
   * 2) 拐点收紧：拐点向弦(A→B)方向拉到贴住障碍边缘(净空 CLEAR_PULL)，
   *    不再绕到障碍旁格子的中心才转弯
   * 3) 转角圆弧化：Chaikin 切角——拐点两侧各取 1/3 处生成两个切点，
   *    锐角拐弯变成两段短斜线(视觉为圆弧)，方向连续变化
   *
   * 净空判定基于"线段到障碍格中心的最小距离"而非采样落格，
   * 拉直/贴边/切角均有精确几何保证(仅山脉/河流 isObstacle 算障碍)。
   */
  static _smoothWaypoints(points, hexMap) {
    if (points.length < 3) return points;
    const obstacles = MarchGroup._collectObstacleCenters(hexMap);
    if (obstacles.length === 0) return [points[0], points[points.length - 1]];
    const clearStraight = (a, b) =>
      MarchGroup._segmentClear(a, b, obstacles, hexMap.size * CLEAR_STRAIGHT);

    // 1) LOS 拉直
    const straight = [points[0]];
    let i = 0;
    while (i < points.length - 1) {
      let j = points.length - 1;
      while (j > i + 1 && !clearStraight(points[i], points[j])) j--;
      straight.push(points[j]);
      i = j;
    }
    if (straight.length < 3) return straight;

    // 2)+3) 拐点收紧 + 转角圆弧化
    return MarchGroup._roundCorners(straight, obstacles, hexMap.size);
  }

  /**
   * 拐点处理：先收紧(贴障碍边缘)，再两轮 Chaikin 切角(圆弧化)
   * 收紧阶段链式处理(A 取上一个已收紧拐点)，保证相邻拐角互不冲突；
   * 切角阶段每轮把顶点两侧 ≤30% 处切成两段斜线，单点转向角逐轮减半。
   */
  static _roundCorners(pts, obstacles, size) {
    const clearStraight = (a, b) =>
      MarchGroup._segmentClear(a, b, obstacles, size * CLEAR_STRAIGHT);
    const clearPull = (a, b) =>
      MarchGroup._segmentClear(a, b, obstacles, size * CLEAR_PULL);

    /**
     * 2a) 拐点收紧：多候选方向二分搜索，取 |A→C|+|C→B| 总长最短的可行角点
     * 单一「P→弦投影」方向存在盲区：当 A/B 与障碍形成对称(如 S/G 同 x 的纵墙)，
     * 投影方向指向弦但理想拐点(两条切线的交点)位于障碍侧旁——不在投影射线上，
     * 导致收紧完全失效，士兵越过障碍顶后仍直行一段才转弯。
     * 候选方向(沿各自射线二分找最远可行点)：
     *   1. P→弦投影 (CLEAR_PULL)  —— 原逻辑，圆弧化净空最充裕
     *   2. P→弦投影 (CLEAR_STRAIGHT) —— 放宽净空，可贴得更近
     *   3. P→弦中点 (CLEAR_STRAIGHT) —— 对称绕行时切线交点在此射线上
     *   4. P→A (CLEAR_STRAIGHT) —— 沿入弧滑回：LOS 段 A→P 本身常是贴障碍切线，
     *      理想拐点(入切线与出切线的交点)就在该线段上，越过障碍顶的拐点可大幅回退
     *   5. P→B (CLEAR_STRAIGHT) —— 沿出弧滑回，与 4 对称
     */
    const retractCorner = (A, P, B) => {
      const totalLen = (C) =>
        Math.hypot(C.x - A.x, C.y - A.y) + Math.hypot(B.x - C.x, B.y - C.y);
      let best = P;
      let bestLen = totalLen(P);
      const search = (target, clear) => {
        if (!target) return;
        if (Math.abs(target.x - P.x) < 1 && Math.abs(target.y - P.y) < 1) return;
        let lo = 0, hi = 1, corner = null;
        for (let k = 0; k < 7; k++) {
          const t = (lo + hi) / 2;
          const cand = {
            x: P.x + (target.x - P.x) * t,
            y: P.y + (target.y - P.y) * t,
          };
          if (clear(A, cand) && clear(cand, B)) { corner = cand; lo = t; }
          else { hi = t; }
        }
        if (corner && totalLen(corner) < bestLen - 0.5) {
          best = corner;
          bestLen = totalLen(corner);
        }
      };
      const proj = MarchGroup._projectOnSegment(P, A, B);
      search(proj, clearPull);
      search(proj, clearStraight);
      search({ x: (A.x + B.x) / 2, y: (A.y + B.y) / 2 }, clearStraight);
      search(A, clearStraight);
      search(B, clearStraight);
      return best;
    };

    const pulled = [pts[0]];
    for (let i = 1; i < pts.length - 1; i++) {
      pulled.push(retractCorner(pulled[pulled.length - 1], pts[i], pts[i + 1]));
    }
    pulled.push(pts[pts.length - 1]);

    // 2b) 转角圆弧化：两轮 Chaikin 切角
    let rounded = pulled;
    for (let pass = 0; pass < 2; pass++) {
      rounded = MarchGroup._chaikinPass(rounded, clearStraight, size);
    }
    return rounded;
  }

  /**
   * 单轮 Chaikin 切角：每个内部顶点替换为两侧的两条短线段
   * 切角量 = min(两侧段长 × 30%, 0.8×size)，弦净空不足则减半重试
   */
  static _chaikinPass(pts, clear, size) {
    if (pts.length < 3) return pts;
    const out = [pts[0]];
    for (let i = 1; i < pts.length - 1; i++) {
      const A = pts[i - 1], P = pts[i], B = pts[i + 1];
      const dIn = Math.hypot(P.x - A.x, P.y - A.y);
      const dOut = Math.hypot(B.x - P.x, B.y - P.y);
      if (dIn < 4 || dOut < 4) { out.push(P); continue; }

      let cut = Math.min(dIn * 0.3, dOut * 0.3, size * 0.8);
      let placed = false;
      while (cut > 1 && !placed) {
        const tIn = (dIn - cut) / dIn;
        const cutIn = {
          x: A.x + (P.x - A.x) * tIn,
          y: A.y + (P.y - A.y) * tIn,
        };
        const tOut = cut / dOut;
        const cutOut = {
          x: P.x + (B.x - P.x) * tOut,
          y: P.y + (B.y - P.y) * tOut,
        };
        if (clear(cutIn, cutOut)) { out.push(cutIn, cutOut); placed = true; }
        else { cut /= 2; }
      }
      if (!placed) out.push(P);
    }
    out.push(pts[pts.length - 1]);
    return out;
  }

  /**
   * 收集地图上全部障碍格(山脉/河流)的像素中心
   */
  static _collectObstacleCenters(hexMap) {
    const centers = [];
    if (hexMap && hexMap.tiles && typeof hexMap.tiles.values === 'function') {
      for (const tile of hexMap.tiles.values()) {
        if (tile.isObstacle) {
          const p = hexToPixel(tile.q, tile.r, hexMap.size);
          centers.push({ x: p.x, y: p.y });
        }
      }
    }
    return centers;
  }

  /**
   * 线段净空检查：线段 a→b 与所有障碍格中心的距离均 ≥ clearance
   */
  static _segmentClear(a, b, obstacleCenters, clearance) {
    const dist = Math.hypot(b.x - a.x, b.y - a.y);
    if (dist < 1) return true;
    // 中点粗筛：距中点超过 dist/2 + clearance 的障碍必不可能靠近线段
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    const rough = dist / 2 + clearance;
    for (const c of obstacleCenters) {
      if (Math.abs(c.x - mx) > rough || Math.abs(c.y - my) > rough) continue;
      if (MarchGroup._distPointToSegment(c.x, c.y, a, b) < clearance) return false;
    }
    return true;
  }

  /**
   * 点到线段的最小距离
   */
  static _distPointToSegment(px, py, a, b) {
    const dx = b.x - a.x, dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    let t = len2 > 0 ? ((px - a.x) * dx + (py - a.y) * dy) / len2 : 0;
    t = Math.max(0, Math.min(1, t));
    const cx = a.x + dx * t, cy = a.y + dy * t;
    return Math.hypot(px - cx, py - cy);
  }

  /**
   * 点 p 在线段 a→b 上的投影(约束在线段范围内)
   */
  static _projectOnSegment(p, a, b) {
    const dx = b.x - a.x, dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    if (len2 < 1e-6) return { x: a.x, y: a.y };
    let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
    t = Math.max(0, Math.min(1, t));
    return { x: a.x + dx * t, y: a.y + dy * t };
  }

  /**
   * 像素反查：当前像素位置所在的格子
   * 用于战斗后重寻路起点(比 currentTile 更精确，后者仅在路标点到达时更新)
   * @param {HexMap} hexMap - 地图
   * @returns {HexTile} 所在格，查不到时回退 currentTile
   */
  getTileAt(hexMap) {
    if (!hexMap) return this.currentTile;
    const { q, r } = pixelToHex(this.pixelX, this.pixelY, hexMap.size);
    return hexMap.getTile(q, r) || this.currentTile;
  }

  /**
   * 获取队伍总战力
   * 综合: 战士数 × 攻击系数 × 生命系数 × 建筑加成 × 羁绊加成 × 击杀加成
   * hpCoeff代表兵种耐久度：高血量兵种更难被击溃(如坦克hp=2.0)，低血量兵种更脆弱(如斥候hp=0.6)
   */
  getPower() {
    const attackCoeff = this._attackCoeff || 1.0;
    const hpCoeff = this.hpCoeff || 1.0;

    // 羁绊攻击加成
    let synergyMultiplier = 1 + this.raceSynergyBonus + this.styleSynergyBonus;
    if (this.synergyBonuses) {
      synergyMultiplier = 1 + (this.synergyBonuses.attackBonus || 0) + (this.synergyBonuses.damageBonus || 0);
    }
    // 技能被动: 攻击/伤害加成
    if (this.skillPassives) {
      synergyMultiplier += (this.skillPassives.attackBonus || 0) + (this.skillPassives.damageBonus || 0);
    }

    // 兵种特殊: 残血加成(游侠等)
    let executeBonus = 1.0;
    if (this.unitSpecial && this.unitSpecial.type === 'execute_bonus') {
      const maxPower = this.warriors * attackCoeff * hpCoeff * (1 + this.attackBonus) * synergyMultiplier;
      // 简化判断: 如果当前战士数低于初始的50%
      if (this.warriors <= this._initialWarriors * (this.unitSpecial.threshold || 0.5)) {
        executeBonus = 1 + this.unitSpecial.value;
      }
    }
    // 技能被动: 残血加成(紫色被动 execute_bonus)
    if (this.skillPassives && this.skillPassives.executeBonus > 0
        && this.warriors <= this._initialWarriors * (this.skillPassives.executeThreshold || 0.5)) {
      executeBonus += this.skillPassives.executeBonus;
    }

    // 兵种特殊: 击杀加成(战争领主等)
    const killMultiplier = 1 + this.killBonus;

    // 战力 = 战士数 × 攻击 × 生命 × 加成
    // hpCoeff使高血量兵种(如坦克/战象)在战力对比中更占优势，更难被击败
    return this.warriors * attackCoeff * hpCoeff * (1 + this.attackBonus) * synergyMultiplier * executeBonus * killMultiplier;
  }

  /**
   * 获取队伍攻击力(用于vs建筑)
   */
  getAttackPower() {
    return this.getPower();
  }

  /**
   * 获取暴击率
   */
  getCritRate() {
    let crit = 0;
    if (this.synergyBonuses) {
      crit += this.synergyBonuses.critBonus || 0;
    }
    // 兵种特殊: 暴击率加成
    if (this.unitSpecial && this.unitSpecial.type === 'crit_bonus') {
      crit += this.unitSpecial.value;
    }
    // 技能被动: 暴击率加成
    if (this.skillPassives) {
      crit += this.skillPassives.critBonus || 0;
    }
    return Math.min(0.75, crit); // 上限75%
  }

  /**
   * 获取暴击伤害倍率
   */
  getCritDamageMultiplier() {
    let mult = 1.5; // 基础暴击伤害1.5倍
    if (this.synergyBonuses && this.synergyBonuses.critDamageMultiplier) {
      mult = Math.max(mult, this.synergyBonuses.critDamageMultiplier);
    }
    // 技能被动: 暴击伤害加成(叠加到基础之上)
    if (this.skillPassives && this.skillPassives.critDamageBonus > 0) {
      mult += this.skillPassives.critDamageBonus;
    }
    return mult;
  }

  /**
   * 获取减伤比例
   */
  getDamageReduction() {
    let reduction = 0;
    if (this.synergyBonuses) {
      reduction += this.synergyBonuses.damageReduction || 0;
    }
    // 兵种特殊: 减伤
    if (this.unitSpecial && this.unitSpecial.type === 'damage_reduction') {
      reduction += this.unitSpecial.value;
    }
    // 技能被动: 减伤
    if (this.skillPassives) {
      reduction += this.skillPassives.damageReduction || 0;
    }
    return Math.min(0.75, reduction); // 上限75%
  }

  /**
   * 获取反伤比例
   */
  getDamageReflect() {
    let reflect = 0;
    if (this.synergyBonuses) {
      reflect += this.synergyBonuses.damageReflect || 0;
    }
    // 兵种特殊: 反伤
    if (this.unitSpecial && this.unitSpecial.type === 'damage_reflect') {
      reflect += this.unitSpecial.value;
    }
    // 技能被动: 反伤
    if (this.skillPassives) {
      reflect += this.skillPassives.damageReflect || 0;
    }
    return reflect;
  }

  /**
   * 获取战后回血比例
   */
  getPostBattleHeal() {
    let heal = 0;
    if (this.synergyBonuses) {
      heal += this.synergyBonuses.postBattleHeal || 0;
    }
    // 技能被动: 战后回血
    if (this.skillPassives) {
      heal += this.skillPassives.postBattleHeal || 0;
    }
    return heal;
  }

  /**
   * 获取复活概率和数量
   */
  getReviveInfo() {
    if (this.synergyBonuses && this.synergyBonuses.reviveChance > 0) {
      return {
        chance: this.synergyBonuses.reviveChance,
        count: this.synergyBonuses.reviveCount || 1,
      };
    }
    // 技能被动: 复活(紫色被动 revive)
    if (this.skillPassives && this.skillPassives.reviveChance > 0) {
      return {
        chance: this.skillPassives.reviveChance,
        count: this.skillPassives.reviveCount || 1,
      };
    }
    return null;
  }

  /**
   * 获取溅射伤害比例
   */
  getSplash() {
    let splash = 0;
    if (this.synergyBonuses) {
      splash += this.synergyBonuses.splash || 0;
    }
    // 技能被动: 溅射
    if (this.skillPassives) {
      splash += this.skillPassives.splash || 0;
    }
    return splash;
  }

  /**
   * 是否有先手攻击
   */
  hasFirstStrike() {
    if (this.synergyBonuses && this.synergyBonuses.firstStrike) {
      return true;
    }
    // 技能被动: 先手攻击
    return !!(this.skillPassives && this.skillPassives.firstStrike);
  }

  /**
   * 获取护甲穿透比例
   */
  getArmorPierce() {
    let pierce = 0;
    if (this.unitSpecial && this.unitSpecial.type === 'armor_pierce') {
      pierce += this.unitSpecial.value;
    }
    // 技能被动: 护甲穿透
    if (this.skillPassives) {
      pierce += this.skillPassives.armorPierce || 0;
    }
    return pierce;
  }

  /**
   * 获取法术伤害加成
   */
  getSpellDamageBonus() {
    let bonus = 0;
    if (this.unitSpecial && this.unitSpecial.type === 'spell_damage_bonus') {
      bonus += this.unitSpecial.value;
    }
    // 技能被动: 法术伤害加成
    if (this.skillPassives) {
      bonus += this.skillPassives.spellDamageBonus || 0;
    }
    return bonus;
  }

  /**
   * 获取攻击范围（1=近战, 2=远程/法术, 3=精英远程）
   */
  getAttackRange() {
    return this._attackRange || 1;
  }

  /**
   * 是否为远程兵种（攻击范围 > 1）
   */
  isRanged() {
    return (this._attackRange || 1) > 1;
  }

  /**
   * 获取实际行军速度(考虑减速效果)
   */
  getEffectiveSpeed() {
    let speed = this.speed;

    // 羁绊速度加成(远程羁绊等)
    if (this.synergyBonuses && this.synergyBonuses.speedBonus) {
      speed *= (1 + this.synergyBonuses.speedBonus);
    }

    // 技能被动: 行军速度加成
    if (this.skillPassives && this.skillPassives.speedBonus) {
      speed *= (1 + this.skillPassives.speedBonus);
    }

    // 局外养成: 行军速度加成
    if (this.metaSpeedBonus) {
      speed *= (1 + this.metaSpeedBonus);
    }

    // 冲刺(主动技能 dash): 临时速度倍率
    if (this.dashTimer > 0 && this.dashFactor > 1) {
      speed *= this.dashFactor;
    }

    // 减速效果(诅咒尖塔等)
    speed *= this.slowFactor;

    return speed;
  }

  /**
   * 应用减速效果
   */
  applySlow(factor, duration) {
    this.slowFactor = Math.min(this.slowFactor, factor);
    this.slowTimer = Math.max(this.slowTimer, duration);
  }

  /**
   * 更新减速计时器
   * @param {number} dt - 帧时间
   */
  updateSlow(dt) {
    if (this.slowTimer > 0) {
      this.slowTimer -= dt;
      if (this.slowTimer <= 0) {
        this.slowFactor = 1.0;
        this.slowTimer = 0;
      }
    }
    // 冲刺计时(主动技能 dash)
    if (this.dashTimer > 0) {
      this.dashTimer -= dt;
      if (this.dashTimer <= 0) {
        this.dashFactor = 1.0;
        this.dashTimer = 0;
      }
    }
  }

  /**
   * 记录击杀(兵种特殊: 击杀加成)
   */
  recordKill() {
    this.killCount++;
    if (this.unitSpecial && this.unitSpecial.type === 'kill_bonus') {
      this.killBonus += this.unitSpecial.value;
    }
    // 技能被动: 击杀加成
    if (this.skillPassives && this.skillPassives.killBonus > 0) {
      this.killBonus += this.skillPassives.killBonus;
    }
  }

  /**
   * 战后回血(兵种特殊: 战后回血)
   * @returns {number} 实际恢复的战士数
   */
  healAfterBattle() {
    const healRate = this.getPostBattleHeal();
    if (healRate <= 0) return 0;

    // 计算初始战力的恢复量
    const healWarriors = Math.ceil(this._initialWarriors * healRate);
    this.warriors = Math.min(this._initialWarriors, this.warriors + healWarriors);
    return healWarriors;
  }

  /**
   * 尝试复活(种族模式兼容)
   * @returns {number} 复活的战士数(0表示未复活)
   */
  tryRevive() {
    const reviveInfo = this.getReviveInfo();
    if (!reviveInfo) return 0;

    if (battleRandom() < reviveInfo.chance) {
      const revived = reviveInfo.count;
      this.warriors = revived;
      this.state = 'marching';
      return revived;
    }
    return 0;
  }

  /**
   * 是否存活
   */
  isAlive() {
    return this.state !== 'destroyed' && this.state !== 'disbanded' && this.state !== 'arrived' && this.warriors > 0;
  }

  /**
   * 遭遇损失
   */
  takeLosses(losses) {
    this.warriors -= losses;
    if (this.warriors <= 0) {
      this.warriors = 0;
      this.state = 'destroyed';
    } else if (this.warriors < 3) {
      this.state = 'disbanded';
    }
  }

  /**
   * 更新羁绊加成
   * @param {object} bonuses - 完整羁绊加成对象 或 {raceBonus, styleBonus} 向后兼容
   */
  updateSynergyBonuses(bonuses) {
    if (bonuses && typeof bonuses === 'object' && 'attackBonus' in bonuses) {
      // 新格式: 完整羁绊加成对象
      this.synergyBonuses = bonuses;
      // 向后兼容
      this.raceSynergyBonus = bonuses.attackBonus || 0;
      this.styleSynergyBonus = 0;
    } else {
      // 旧格式: (raceBonus, styleBonus) — 不会走到这里，但保留兼容
      this.raceSynergyBonus = arguments[0] || 0;
      this.styleSynergyBonus = arguments[1] || 0;
    }
  }

  /**
   * 获取剩余路径长度
   */
  getRemainingPath() {
    if (!this.path || this.pathIndex >= this.path.length) return 0;
    return this.path.length - this.pathIndex;
  }

  /**
   * 获取下一个目标格子
   */
  getNextTile() {
    if (!this.path || this.pathIndex + 1 >= this.path.length) return null;
    return this.path[this.pathIndex + 1];
  }
}
