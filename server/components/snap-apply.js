/**
 * Snap 读回：per-fund / portfolio RT1 替换 + row2 合计。
 */
import {
  getBaselineForDay,
  getCurrentPhase,
  isRt1SnapPhase,
  round2,
} from '../day-display-state.js';
import { resolveDisplaySession } from '../display-session.js';
import { beijingDateString } from '../time.js';
import { finalizeLiveFundDisplayRow, shouldSuppressDomesticRealtimeDisplay } from './suppress.js';
import { getReadyActiveScopeSnap } from './snap-ready.js';

/**
 * @param {number} fundId
 * @param {object} liveRow
 * @param {string} accrualDay
 * @param {Date} [now]
 */
export function applyFundRt1Snap(fundId, liveRow, accrualDay, now = new Date()) {
  if (!isRt1SnapPhase(now)) {
    return finalizeLiveFundDisplayRow(liveRow, now);
  }
  if (shouldSuppressDomesticRealtimeDisplay(liveRow?.market ?? 'cn', now)) {
    return finalizeLiveFundDisplayRow(liveRow, now);
  }
  const snap = getReadyActiveScopeSnap(accrualDay, now, 'portfolio');
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
  if (!isRt1SnapPhase(now)) {
    const baseline = getBaselineForDay(accrualDay, 'portfolio');
    if (baseline != null && totalsLive.realtimeProfit != null) {
      return {
        ...totalsLive,
        realtimeAssets: round2(baseline + totalsLive.realtimeProfit),
        baseline,
        liveMode: 'live',
        estimateFrozen: false,
      };
    }
    return { ...totalsLive, liveMode: 'live', estimateFrozen: false };
  }

  const snap = getReadyActiveScopeSnap(accrualDay, now, 'portfolio');
  if (!snap) {
    const baseline = getBaselineForDay(accrualDay, 'portfolio');
    if (baseline != null && totalsLive.realtimeProfit != null) {
      return {
        ...totalsLive,
        realtimeAssets: round2(baseline + totalsLive.realtimeProfit),
        baseline,
        liveMode: 'live',
        estimateFrozen: false,
      };
    }
    return { ...totalsLive, liveMode: 'live', estimateFrozen: false };
  }

  const baseline =
    getBaselineForDay(accrualDay, 'portfolio') ??
    getBaselineForDay(beijingDateString(now), 'portfolio') ??
    totalsLive.settledAssets;
  const rt1 = round2(totalsLive.realtimeProfit ?? 0);
  const est = round2(baseline + rt1);

  return {
    ...totalsLive,
    settledAssets: totalsLive.settledAssets,
    realtimeProfit: rt1,
    realtimeProfitPct:
      baseline > 0 ? round2((rt1 / baseline) * 10000) / 100 : totalsLive.realtimeProfitPct,
    realtimeAssets: est,
    baseline,
    liveMode: 'snap',
    estimateFrozen: true,
    snap,
  };
}

/**
 * @param {object[]} liveFunds
 * @param {Date} [now]
 */
export function sumExtendedProfit(liveFunds, now = new Date(), session = null) {
  const s = session ?? resolveDisplaySession(now, { persistedPhase: getCurrentPhase() });
  if (!s.showRow2Extended) {
    return { total: 0, pct: null, session: null };
  }
  let total = 0;
  let assets = 0;
  for (const f of liveFunds) {
    const ext = f.realTimeProfitExtended;
    if (ext != null && Number.isFinite(ext)) total += ext;
    if (f.market === 'us') assets += f.amount ?? 0;
  }
  return {
    total: round2(total),
    pct: assets > 0 ? round2((total / assets) * 10000) / 100 : null,
    session: s.extendedSession,
  };
}
