/**
 * Snap 读回：per-fund / portfolio RT1 替换。
 */
import {
  getBaselineForDay,
  getScopeSnap,
  round2,
} from '../day-display-state.js';
import { resolvePortfolioRealtimeAssets } from '../aggregate.js';
import { resolveDisplaySession } from '../display-session.js';
import { fundEstimateProfit } from '../fund-estimate.js';
import { getFundRegularImpactPct } from '../market-session.js';
import { beijingDateString } from '../time.js';
import { finalizeLiveFundDisplayRow, shouldSuppressDomesticRealtimeDisplay } from './suppress.js';
import { getReadyFundRt1Snap } from './snap-ready.js';
import {
  shouldFreezeUsIndexCloseSnapshot,
  shouldUseLiveUsIndexStyle,
  resolveUsIndexCloseImpactPct,
} from './snap-index-style.js';

/**
 * 无 eodSnap 时：读指数条 / impact-snapshots 上次正盘 pct。
 * @param {number} fundId
 * @param {object} liveRow
 * @param {Date} [now]
 */
function applyRegularSnapshotFallback(fundId, liveRow, now = new Date()) {
  const pct = shouldFreezeUsIndexCloseSnapshot(liveRow, now)
    ? resolveUsIndexCloseImpactPct(liveRow, getFundRegularImpactPct)
    : getFundRegularImpactPct(fundId);
  if (pct == null || !Number.isFinite(pct)) return null;
  const amount = liveRow.amount ?? 0;
  if (!Number.isFinite(amount) || amount <= 0) return null;
  const rt1 = fundEstimateProfit(amount, { market: liveRow.market ?? 'us', impactPct: pct }, now);
  if (rt1 == null) return null;
  return {
    ...liveRow,
    estimateProfit: rt1,
    estimateImpactPct: pct,
    impactPct: pct,
    impactPctRegular: pct,
    estimateAssets: round2(amount + rt1),
    displaySnap: true,
    rt1SnapSource: 'regularSnapshot',
  };
}

/**
 * @param {number} fundId
 * @param {object} liveRow
 * @param {object|null} fundSnap
 * @param {Date} [now]
 */
function applyFundSnapEntry(fundId, liveRow, fundSnap, now = new Date()) {
  if (fundSnap?.rt1 == null) {
    const fallback = applyRegularSnapshotFallback(fundId, liveRow, now);
    return finalizeLiveFundDisplayRow(fallback ?? liveRow, now);
  }
  const rt1 = fundSnap.rt1;
  const amountAtSnap = fundSnap.amountAtSnap ?? liveRow.amount ?? 0;
  const pct =
    amountAtSnap > 0 ? round2((rt1 / amountAtSnap) * 10000) / 100 : null;
  return finalizeLiveFundDisplayRow(
    {
      ...liveRow,
      estimateProfit: rt1,
      estimateImpactPct: pct ?? liveRow.estimateImpactPct,
      impactPct: pct ?? liveRow.impactPct,
      impactPctRegular: fundSnap.impactPctRegular ?? liveRow.impactPctRegular,
      estimateAssets: round2(amountAtSnap + rt1),
      displaySnap: true,
    },
    now,
  );
}

/**
 * @param {number} fundId
 * @param {object} liveRow
 * @param {string} accrualDay
 * @param {Date} [now]
 */
export function applyFundRt1Snap(fundId, liveRow, accrualDay, now = new Date()) {
  const clockSession = resolveDisplaySession(now);
  // snap 阶段（day_open / eod_freeze）强制读 snap，不得因欧股等 regular 持仓 bypass
  const shouldRefreshLive =
    !clockSession.isRt1SnapPhase &&
    (liveRow?.shouldRefreshLiveRt1 === true || liveRow?.hasRegularHolding === true);
  if (shouldRefreshLive) {
    return finalizeLiveFundDisplayRow(liveRow, now);
  }
  if (shouldSuppressDomesticRealtimeDisplay(liveRow?.market ?? 'cn', now)) {
    return finalizeLiveFundDisplayRow(liveRow, now);
  }
  // 美指 style：仅美股正盘 live index；休市后（如亚太午后）读 4:00 收盘 snapshot
  if (shouldUseLiveUsIndexStyle(liveRow, now)) {
    return finalizeLiveFundDisplayRow(liveRow, now);
  }
  if (shouldFreezeUsIndexCloseSnapshot(liveRow, now) && !clockSession.isRt1SnapPhase) {
    const closeFallback = applyRegularSnapshotFallback(fundId, liveRow, now);
    if (closeFallback) {
      return finalizeLiveFundDisplayRow(closeFallback, now);
    }
  }

  const readySnap = getReadyFundRt1Snap(accrualDay, now, 'portfolio');
  if (readySnap) {
    const fundSnap = readySnap.funds?.[fundId] ?? readySnap.funds?.[String(fundId)];
    return applyFundSnapEntry(fundId, liveRow, fundSnap, now);
  }

  const rawSnap = getScopeSnap(accrualDay, 'eodSnap', 'portfolio');
  const rawFundSnap = rawSnap?.funds?.[fundId] ?? rawSnap?.funds?.[String(fundId)];
  if (rawFundSnap?.rt1 != null) {
    return applyFundSnapEntry(fundId, liveRow, rawFundSnap, now);
  }

  const fallback = applyRegularSnapshotFallback(fundId, liveRow, now);
  if (fallback) {
    return finalizeLiveFundDisplayRow(fallback, now);
  }

  if (clockSession.isRt1SnapPhase) {
    return finalizeLiveFundDisplayRow(
      {
        ...liveRow,
        estimateProfit: null,
        estimateImpactPct: null,
        estimateAssets: round2(liveRow.amount ?? 0),
      },
      now,
    );
  }

  return finalizeLiveFundDisplayRow(liveRow, now);
}

/**
 * @param {object} totalsLive
 * @param {string} accrualDay
 * @param {Date} [now]
 */
export function applyPortfolioTotalsSnap(totalsLive, accrualDay, now = new Date()) {
  const session = resolveDisplaySession(now);
  const baseline =
    getBaselineForDay(accrualDay, 'portfolio') ??
    getBaselineForDay(beijingDateString(now), 'portfolio') ??
    totalsLive.settledAssets;
  const rt1Live = round2(totalsLive.realtimeProfit ?? 0);
  const settled = totalsLive.settledAssets ?? 0;
  const accLike = {
    settledAssets: settled,
    realtimeProfit: rt1Live,
    estimateAssetsSum: totalsLive.estimateAssetsSum ?? settled,
  };
  const estFromFunds = resolvePortfolioRealtimeAssets(accLike, baseline);
  const estimateFrozen = session.isRt1SnapPhase;
  const readySnap = estimateFrozen ? getReadyFundRt1Snap(accrualDay, now, 'portfolio') : null;

  let rt1 = rt1Live;
  let est = estFromFunds;
  if (estimateFrozen && readySnap) {
    if (readySnap.rt1 != null && Number.isFinite(readySnap.rt1)) {
      rt1 = round2(readySnap.rt1);
    }
    if (readySnap.est != null && Number.isFinite(readySnap.est)) {
      est = round2(readySnap.est);
    }
  }

  return {
    ...totalsLive,
    settledAssets: settled,
    realtimeProfit: rt1,
    realtimeProfitPct:
      baseline > 0 ? round2((rt1 / baseline) * 10000) / 100 : totalsLive.realtimeProfitPct,
    realtimeAssets: est,
    estimateAssetsSum: est,
    baseline,
    liveMode: estimateFrozen ? 'snap' : 'live',
    estimateFrozen,
  };
}
