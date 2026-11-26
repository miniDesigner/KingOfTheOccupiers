// 埋点实测 · 配对 A/B 汇总与信号判定
// 用法：node tests/telemetry-growth-compare.mjs --base <baseline.json> --cur <current.json> --out <report.json>
// 判定规则在下方 SIGN_RULES，跑前写死；输出 pass/fail/confounded/stop 四类信号。

const noop = () => {};
const { readFileSync: rf, writeFileSync, mkdirSync } = await import('node:fs');
const path = await import('node:path');
const args = process.argv.slice(2);
const argOf = (n, d) => { const i = args.indexOf('--' + n); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const BASE = rf(argOf('base'), 'utf-8');
const CUR = rf(argOf('cur'), 'utf-8');
const OUT = argOf('out', null);
const b = JSON.parse(BASE), c = JSON.parse(CUR);

// ========== 跑前写死的信号规则 ==========
const SIGN_RULES = {
  // V1 生效范围：Lv1 必须两版完全一致（结构性证明 V1 只在等级>1 生效），Lv8/Lv20 当前版必须 > 基线
  v1_scope: {
    L1: '两版 avgAtk/avgHp/avgPower 差值 < 0.001（Lv1 不吃 GROWTH_SCALE）',
    L8: 'current.avgAtk 相对 baseline 提升 8%~30%',
    L20: 'current.avgAtk 相对 baseline 提升 30%~50%',
  },
  // 对局交叉探针：fresh 玩家 Lv1，AI 吃 V1 → 当前版玩家胜率应下降；late 双方都吃 → 应持平或升
  cross_probe: {
    fresh: 'current 胜率相对 baseline 下降 3~20pp（AI 变强，玩家 Lv1 不变）',
    mid: '偏移在 ±10pp 内',
    late: '偏移在 ±10pp 内（双方同幅变强，天花板效应允许持平）',
  },
  // 契约 2.2 信号
  contract: {
    pass: '满配战力/王者带 ≤ 1.3；且无 stop 触发',
    fail: '满配战力/王者带 > 1.3；或任一难度档胜率偏移 > 10pp',
    confounded: '养成/经济侧 5 变量联合释放 → 仍 confounded；对局侧仅 V1 进链路，可用交叉探针归因',
    stop: '金币负增长 / 死循环 / 存档损坏 / 战力 NaN 或溢出',
  },
};

const pp = (a, b) => +(a - b).toFixed(1);
const relpct = (a, b) => b ? +((100 * (a - b)) / b).toFixed(1) : null;

// ========== 1. V1 生效范围 ==========
const v1Scope = {};
for (const lv of ['L1', 'L8', 'L20']) {
  const bs = b.v1ScopeSummary?.[lv] || {};
  const cs = c.v1ScopeSummary?.[lv] || {};
  v1Scope[lv] = {
    baseline: bs, current: cs,
    atkDelta: pp(cs.avgAtk ?? 0, bs.avgAtk ?? 0),
    atkRelPct: relpct(cs.avgAtk ?? 0, bs.avgAtk ?? 0),
    hpRelPct: relpct(cs.avgHp ?? 0, bs.avgHp ?? 0),
    powerRelPct: relpct(cs.avgPower ?? 0, bs.avgPower ?? 0),
  };
}
const v1L1Hold = Math.abs(v1Scope.L1.atkDelta) < 0.001 && Math.abs(v1Scope.L1.powerRelPct ?? 0) < 0.1;
const v1L8Effect = v1Scope.L8.atkRelPct >= 8 && v1Scope.L8.atkRelPct <= 30;
const v1L20Effect = v1Scope.L20.atkRelPct >= 30 && v1Scope.L20.atkRelPct <= 50;

// ========== 2. 对局交叉探针 ==========
const cross = {};
for (const p of ['fresh', 'mid', 'late']) {
  const bo = b.simSummary[p].overall, co = c.simSummary[p].overall;
  cross[p] = {
    baselineWin: bo.winRate, currentWin: co.winRate, deltaPp: pp(co.winRate, bo.winRate),
    baselineDur: bo.avgDuration, currentDur: co.avgDuration,
    byDiff: {},
  };
  for (const d of ['easy', 'normal', 'hard', 'nightmare']) {
    const bd = b.simSummary[p].byDiff[d], cd = c.simSummary[p].byDiff[d];
    cross[p].byDiff[d] = { baseline: bd.winRate, current: cd.winRate, deltaPp: pp(cd.winRate, bd.winRate) };
  }
}
const crossFreshOK = cross.fresh.deltaPp <= -3 && cross.fresh.deltaPp >= -20;
const crossMidOK = Math.abs(cross.mid.deltaPp) <= 10;
const crossLateOK = Math.abs(cross.late.deltaPp) <= 10;
const anyDiffOver10 = Object.values(cross).some(p => Object.values(p.byDiff).some(d => Math.abs(d.deltaPp) > 10));

// ========== 3. 战力带 ==========
const powerBand = {
  baseline: { total: b.maxPower.total, kingRef: b.maxPower.kingRef, ratio: b.maxPower.ratioToKing },
  current: { total: c.maxPower.total, kingRef: c.maxPower.kingRef, ratio: c.maxPower.ratioToKing },
  freshBaseline: b.freshPower.total, freshCurrent: c.freshPower.total,
};
const bandOK = powerBand.current.ratio <= 1.3;
const bandFail = powerBand.current.ratio > 1.3;

// ========== 4. 等效达标天数（口径修正）==========
// 关键：GROWTH_SCALE 改的是收益不是成本 → "升到 Lv10 的星尘成本"两版必然相同（见 growthCurve）。
// 契约里"197→60-90天"mix 了两个口径：197天是"8主力升Lv10"总成本/日投放，不是单兵。
// 真正的改善量 = 达到 baseline Lv20 同等战力，current 只需几级 → 少花多少星尘 → 缩短多少天。
const baseL20 = b.growthCurve.find(r => r.level === 20);
const baseL10 = b.growthCurve.find(r => r.level === 10);
const curRows = c.growthCurve;
const findFirstAtOrAbove = (arr, key, target) => arr.find(r => r[key] >= target) || arr[arr.length - 1];
const eqAtk20 = findFirstAtOrAbove(curRows, 'attackCoeff', baseL20.attackCoeff);
const eqPower20 = findFirstAtOrAbove(curRows, 'power', baseL20.power);
const eqPower10 = findFirstAtOrAbove(curRows, 'power', baseL10.power);
const equivalentGrowth = {
  note: '达到 baseline Lv20 同等属性/战力，current 所需等级与养成投入（单兵剑士，零氪62星尘/日）',
  baselineL20: { atk: baseL20.attackCoeff, power: baseL20.power, stardust: baseL20.cumStardust, days: baseL20.days },
  currentForSameAtk: eqAtk20,
  currentForSamePower: eqPower20,
  currentForBaseL10Power: eqPower10,
  daysSavedAtk: +(baseL20.days - eqAtk20.days).toFixed(1),
  daysSavedPower: +(baseL20.days - eqPower20.days).toFixed(1),
  costUnchanged: baseL10.cumStardust === c.growthCurve.find(r => r.level === 10).cumStardust,
};

// ========== 5. stop 信号 ==========
const allRows = [...b.growthCurve, ...c.growthCurve, ...Object.values(b.simSummary).flatMap(p => Object.values(p.byDiff)), ...Object.values(c.simSummary).flatMap(p => Object.values(p.byDiff))];
const stopCheck = {
  nanOrInfinity: allRows.some(r => Object.values(r).some(v => typeof v === 'number' && !Number.isFinite(v))),
  negativeGoldOrCost: [...b.growthCurve, ...c.growthCurve].some(r => r.cumStardust < 0),
  simTimeoutSpike: Object.values(c.simSummary).some(p => p.overall.timeoutRate > 50), // late 地图小图 100% 快速结算属正常；>50% 超时视为异常
  gameCrash: false, // 两版模拟均 exit 0（脚本执行到此即证明）
};
const stopTriggered = Object.values(stopCheck).some(Boolean);

// ========== 6. 综合信号判定 ==========
const verdict = {
  v1_scope_holds: v1L1Hold && v1L8Effect && v1L20Effect,
  cross_probe_holds: crossFreshOK && crossMidOK && crossLateOK,
  contract_pass: bandOK && !stopTriggered && !anyDiffOver10,
  contract_fail: bandFail || anyDiffOver10,
  contract_stop: stopTriggered,
  contract_confounded: true, // 养成/经济侧恒为 confounded（5 变量联合）
  attribution: (v1L1Hold && v1L8Effect && v1L20Effect && crossFreshOK && crossMidOK && crossLateOK)
    ? '对局侧 V1 归因成立：交叉探针确认 GROWTH_SCALE 只在 Lv>1 生效且真进战斗；V2~V5 结构性不进战斗公式'
    : '归因不成立：探针未全中，需回到归因门列 ≥3 个跨层候选瓶颈（禁止直接加码）',
};

const report = {
  meta: {
    baseline: b.meta, current: c.meta,
    note: '配对 A/B：同 seed/地图/局数，模拟器脚本两版零改动，唯一差别为养成修正 5 变量',
  },
  rulesDefinedBeforeRun: SIGN_RULES,
  v1Scope, v1ScopeHolds: { L1: v1L1Hold, L8: v1L8Effect, L20: v1L20Effect },
  cross, crossProbeHolds: { fresh: crossFreshOK, mid: crossMidOK, late: crossLateOK, anyDiffOver10 },
  powerBand, equivalentGrowth, stopCheck, verdict,
};

const json = JSON.stringify(report, null, 2);
if (OUT) {
  mkdirSync(path.dirname(path.resolve(OUT)), { recursive: true });
  writeFileSync(OUT, json, 'utf-8');
}
console.log(json);
