/**
 * 异步对战匹配系统
 *
 * 实时联机（Lockstep 帧同步）已移除：PvP 改为异步快照对战——
 * 匹配到的对手是一份「快照镜像」（名字 + 奖杯分 + 按奖杯生成的阵容强度），
 * 由 SnapshotPlayer（AI 决策）操控，本地单人演算，胜负按真人 Elo 结算。
 *
 * 匹配节奏：
 *   - 点「🎯 对战」→ 匹配搜索（模拟 2~4s 网络检索延迟，营造匹配感）
 *   - 10s 超时未找到对手 → 降级 AI 对手（ASYNC_MATCH_TIMEOUT_MS）
 *
 * 对手来源（无后端阶段的本地策略）：
 *   按玩家当前奖杯 ± 浮动生成镜像对手，强度走 PowerSystem.getTierAiSettings
 *   的天梯曲线（与 AI 对战同曲线），保证「越打天梯 → 对手越强」的体感一致。
 */

import PowerSystem from './PowerSystem.js';

// 匹配节奏参数
export const ASYNC_MATCH_TIMEOUT_MS = 10000; // 10s 匹配超时 → 降级 AI
const SEARCH_DELAY_MIN_MS = 2000;            // 模拟检索延迟下限
const SEARCH_DELAY_MAX_MS = 4000;            // 模拟检索延迟上限

// 对手名池：前缀 × 随机十六进制后缀（领主风，与本地默认昵称「领主_XXXX」同体系）
const NAME_PREFIXES = [
  '铁手领主', '疾风领主', '寒霜领主', '烈焰领主', '黑岩领主',
  '白鸦领主', '苍狼领主', '孤峰领主', '碎星领主', '沉沙领主',
];

/** 生成随机十六进制后缀（4 位大写） */
function randomHexSuffix() {
  return Math.floor(Math.random() * 0x10000).toString(16).toUpperCase().padStart(4, '0');
}

/**
 * 生成一个异步快照对手
 * @param {object} [profile] 本地玩家 ProfileManager.get()（取奖杯做强度基准）
 * @returns {{name:string, trophies:number, difficulty:string}}
 */
export function generateOpponent(profile) {
  const myTrophies = profile ? (profile.trophies || 0) : 0;

  // 对手奖杯：与我相近（-40 ~ +60，略偏高制造挑战感），下限 0
  const drift = Math.round(Math.random() * 100 - 40);
  const trophies = Math.max(0, myTrophies + drift);

  // 强度走天梯曲线：与 AI 对战同源（getTierAiSettings），保证段位体感一致
  // 2026-09-09：AI 一致化后，快照只存难度档，skillTier/powerRatio/warriorRateMult 已移除
  const settings = PowerSystem.getTierAiSettings(trophies);

  const name = NAME_PREFIXES[Math.floor(Math.random() * NAME_PREFIXES.length)]
    + '_' + randomHexSuffix();

  return {
    name,
    trophies,
    difficulty: settings.difficulty,
  };
}

/**
 * 模拟匹配检索延迟（2~4s）：找到快照对手需要的时间
 * @returns {number} 毫秒
 */
export function searchDelay() {
  return SEARCH_DELAY_MIN_MS + Math.random() * (SEARCH_DELAY_MAX_MS - SEARCH_DELAY_MIN_MS);
}

/**
 * 匹配状态机（对外只读）
 * - 'idle'         未发起匹配
 * - 'searching'    检索中（模拟 2~4s 网络延迟）
 * - 'matched'      检索成功，产出对手快照
 * - 'timeout'      10s 超时未检索到
 * - 'cancelled'    外部取消（玩家主动返回大厅等）
 */
export const MATCH_STATE = Object.freeze({
  IDLE: 'idle', SEARCHING: 'searching', MATCHED: 'matched',
  TIMEOUT: 'timeout', CANCELLED: 'cancelled',
});

/**
 * 异步匹配会话句柄
 * 外部通过 start()/cancel() 控制，检索完成或超时后调 onState 回调。
 *
 * 用法：
 *   const session = AsyncMatchSystem.start(profile, (state, payload) => {
 *     if (state === 'matched') startBattle(payload.snapshot);
 *     else if (state === 'timeout') startAiBattle();
 *   });
 *   // 玩家返回可取消
 *   AsyncMatchSystem.cancel(session);
 */
class MatchmakingSession {
  constructor(profile, onState) {
    this.profile = profile || null;
    this.onState = onState;
    this.state = MATCH_STATE.SEARCHING;
    this.snapshot = null;                // matched 后注入对手快照
    this._searchTimer = null;
    this._timeoutTimer = null;
    this._startedAt = Date.now();
  }

  /** 取消会话（外部触发，玩家返回大厅/确认超时） */
  cancel() {
    if (this.state === MATCH_STATE.MATCHED
        || this.state === MATCH_STATE.TIMEOUT
        || this.state === MATCH_STATE.CANCELLED) return;
    this._clear();
    this.state = MATCH_STATE.CANCELLED;
    try { this.onState && this.onState(MATCH_STATE.CANCELLED, { session: this }); }
    catch (e) { /* 回调异常吞掉 */ }
  }

  _clear() {
    if (this._searchTimer) { clearTimeout(this._searchTimer); this._searchTimer = null; }
    if (this._timeoutTimer) { clearTimeout(this._timeoutTimer); this._timeoutTimer = null; }
  }

  _emit(state, payload) {
    this.state = state;
    try { this.onState && this.onState(state, { ...payload, session: this }); }
    catch (e) { /* 回调异常吞掉 */ }
  }
}

/**
 * 启动异步匹配会话（2~4s 检索 + 10s 超时降级 AI 的逻辑由 Game 层处理）
 *
 * 设计：检索延迟 + 10s 超时是两个独立计时，10s 是「匹配等待总时长上限」，
 * 一旦命中快照立即回调 matched。Game 层 tryBack/资源清理时 cancel 当前会话。
 *
 * @param {object|null} profile 本地玩家 ProfileManager.get()
 * @param {(state, payload) => void} onState 状态变化回调
 * @returns {MatchmakingSession} 会话句柄
 */
export function start(profile, onState) {
  const session = new MatchmakingSession(profile, onState);
  // 检索延迟：模拟网络检索
  session._searchTimer = setTimeout(() => {
    session._searchTimer = null;
    const snap = generateOpponent(profile);
    session.snapshot = snap;
    session._emit(MATCH_STATE.MATCHED, { snapshot: snap });
  }, searchDelay());
  // 10s 总超时：兜底防 cancelled/失败
  session._timeoutTimer = setTimeout(() => {
    if (session.state !== MATCH_STATE.SEARCHING) return;
    session._emit(MATCH_STATE.TIMEOUT, {});
  }, ASYNC_MATCH_TIMEOUT_MS);
  return session;
}

/** 取消当前匹配会话 */
export function cancel(session) {
  if (!session) return;
  session.cancel();
}
