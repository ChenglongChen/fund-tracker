/**
 * Snap 读回：per-fund / portfolio RT1 替换。
 */
import {
  getBaselineForDay,
  getCurrentPhase,
  round2,
} from '../day-display-state.js';
import { resolveDisplaySession } from '../display-session.js';
import { beijingDateString } from '../time.js';
import { finalizeLiveFundDisplayRow, shouldSuppressDomesticRealtimeDisplay } from './suppress.js';
import { getReadyFundRt1Snap } from './snap-ready.js';

/**
 * @param {number} fundId
 * @param {object} liveRow
 * @param {string} accrualDay
 * @param {Date} [now]
 */
export function applyFundRt1Snap(fundId, liveRow, accrualDay, now = new Date()) {
  const shouldRefreshLive =
    liveRow?.shouldRefreshLiveRt1 === true || liveRow?.hasRegularHolding === true;
  if (shouldRefreshLive) {
    return finalizeLiveFundDisplayRow(liveRow, now);
  }
  if (shouldSuppressDomesticRealtimeDisplay(liveRow?.market ?? 'cn', now)) {
    return finalizeLiveFundDisplayRow(liveRow, now);
  }
  const snap = getReadyFundRt1Snap(accrualDay, now, 'portfolio');
  if (!snap) return liveRow;

  const fundSnap = snap.funds?.[fundId] ?? snap.funds?.[String(fundId)];
  if (fundSnap?.rt1 == null) return liveRow;

  const rt1 = fundSnap.rt1;
  const amount = fundSnap.amountAtSnap ?? liveRow.amount ?? 0;
  const pct = amount > 0 ? round2((rt1 / amount) * 10000) / 100 : null;

  return finalizeLiveFundDisplayRow(
    {
      ...liveRow,
      estimateProfit: rt1,
      estimateImpactPct: pct ?? liveRow.estimateImpactPct,
      impactPctRegular: fundSnap.impactPctRegular ?? liveRow.impactPctRegular,
      estimateAssets: round2(amount + rt1),
      displaySnap: true,
    },
    now,
  );
}

/**
 * @param {object} totalsLive
 * @param {string} accrualDay
 * @param {Date} [now]
 */
export function applyPortfolioTotalsSnap(totalsLive, accrualDay, now = new Date()) {
  const session = resolveDisplaySession(now, { persistedPhase: getCurrentPhase() });
  const baseline =
    getBaselineForDay(accrualDay, 'portfolio') ??
    getBaselineForDay(beijingDateString(now), 'portfolio') ??
    totalsLive.settledAssets;
  const rt1 = round2(totalsLive.realtimeProfit ?? 0);
  const est = round2((baseline ?? totalsLive.settledAssets ?? 0) + rt1);
  const estimateFrozen = session.isRt1SnapPhase;

  return {
    ...totalsLive,
    settledAssets: totalsLive.settledAssets,
    realtimeProfit: rt1,
    realtimeProfitPct:
      baseline > 0 ? round2((rt1 / baseline) * 10000) / 100 : totalsLive.realtimeProfitPct,
    realtimeAssets: est,
    baseline,
    liveMode: estimateFrozen ? 'snap' : 'live',
    estimateFrozen,
  };
}
