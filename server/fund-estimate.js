import {
  getRt1AccrualDay,
  isUsExtendedEstimateWindow,
  isUsPremarketEstimateWindow,
} from './display-session.js';
import {
  getActiveScopeSnap,
  getBaselineForDay,
  isRt1SnapPhase,
  round2,
} from './day-display-state.js';
import { beijingDateString } from './time.js';

export { isUsExtendedEstimateWindow, isUsPremarketEstimateWindow };

/** @deprecated use day-display-state; kept for tests */
export function clearPremarketPortfolioEstimateSnap() {
  /* no-op: snaps live in day-display-state.json */
}

/**
 * 穿透层 live 结果（未冻结），用于实时收益 / 预估资产计算。
 * @param {object} r
 * @param {string} market
 */
export function liveImpactForEstimate(r, market) {
  const regular = r?.impactPctRegular ?? r?.impactPct ?? null;
  return {
    market,
    impactPct: regular,
    impactPctRegular: r?.impactPctRegular ?? null,
    impactPctExtended: r?.impactPctExtended ?? null,
  };
}

/**
 * 预估资产 / 组合实时收益用的涨跌幅（与实时收益列同口径）
 * - 美股盘前/盘后：仅 regular（row1），extended 为 row2
 * - 美股正盘：regular + extended
 * - A 股 / 黄金：与实时列 impactPct 一致
 * @param {{ market?: string, impactPct?: number|null, impactPctRegular?: number|null, impactPctExtended?: number|null } | null} live
 * @param {Date} [now]
 */
export function fundEstimateImpactPct(live, _now = new Date()) {
  if (!live || live.impactPct == null || !Number.isFinite(live.impactPct)) return null;
  return live.impactPct;
}

/**
 * @param {number|null|undefined} amount
 * @param {{ market?: string, impactPct?: number|null, impactPctRegular?: number|null, impactPctExtended?: number|null } | null} live
 * @param {Date} [now]
 */
export function fundEstimateProfit(amount, live, now = new Date()) {
  const pct = fundEstimateImpactPct(live, now);
  if (pct == null || amount == null || !Number.isFinite(amount)) return null;
  return round2((amount * pct) / 100);
}

/**
 * 预估资产 canonical：账户资产（T 日已入账 amount）+ 实时收益（当前会话 RT1）。
 * portfolio 级在 aggregate 对 Σ estimateAssets 求和。
 * @param {number|null|undefined} amount
 * @param {number|null|undefined} _settledProfit
 * @param {{ market?: string, impactPct?: number|null, impactPctRegular?: number|null, impactPctExtended?: number|null } | null} live
 * @param {boolean} [_dailyPending]
 * @param {Date} [now]
 * @param {number|null} [_baselinePortfolio]
 * @param {number|null} [estimateProfitOverride]
 */
export function fundEstimatedAssets(
  amount,
  _settledProfit,
  live,
  _dailyPending = false,
  now = new Date(),
  _baselinePortfolio = null,
  estimateProfitOverride = null,
) {
  const ep =
    estimateProfitOverride != null && Number.isFinite(estimateProfitOverride)
      ? estimateProfitOverride
      : fundEstimateProfit(amount, live, now);
  if (amount == null || !Number.isFinite(amount)) return null;
  if (ep == null) return round2(amount);
  return round2(amount + ep);
}

/**
 * @deprecated portfolio snap via components/snap-apply.applyPortfolioTotalsSnap
 */
export function applyPremarketPortfolioEstimateSnap(totals, now = new Date()) {
  const accrualDay = getRt1AccrualDay(now);
  const baseline = getBaselineForDay(accrualDay, 'portfolio') ?? getBaselineForDay(beijingDateString(now), 'portfolio');
  if (baseline == null || !isRt1SnapPhase(now)) {
    return { ...totals, estimateFrozen: false, liveMode: 'live' };
  }
  const snap = getActiveScopeSnap(accrualDay, now, 'portfolio');
  if (!snap) return { ...totals, estimateFrozen: false, liveMode: 'live' };
  return {
    ...totals,
    realtimeProfit: snap.rt1 ?? totals.realtimeProfit,
    realtimeAssets: snap.est ?? round2(baseline + (snap.rt1 ?? totals.realtimeProfit)),
    estimateFrozen: true,
    liveMode: 'snap',
    baseline,
  };
}

export { getActiveScopeSnap };
