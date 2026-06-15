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
import { getReadyFundRt1Snap, isScopeSnapReady } from './snap-ready.js';
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
 * snap 条目 rt1=0 且为美指 style 时视为无效（坏 seed），改读指数 4:00 收盘。
 * @param {object|null|undefined} fundSnap
 * @param {object} liveRow
 * @param {Date} [now]
 */
function snapEntryRt1Usable(fundSnap, liveRow, now) {
  if (fundSnap?.rt1 == null) return false;
  if (fundSnap.rt1 !== 0) return true;
  return !shouldFreezeUsIndexCloseSnapshot(liveRow, now);
}

/**
 * @param {number} fundId
 * @param {object} liveRow
 * @param {object|null|undefined} fundSnap
 * @param {Date} [now]
 */
function applyFundSnapEntry(fundId, liveRow, fundSnap, now = new Date()) {
  if (!snapEntryRt1Usable(fundSnap, liveRow, now)) {
    const fallback = applyRegularSnapshotFallback(fundId, liveRow, now);
    return finalizeLiveFundDisplayRow(fallback ?? liveRow, now);
  }
  const rt1 = fundSnap.rt1;
  const amountAtSnap = fundSnap.amountAtSnap ?? liveRow.amount ?? 0;
  const amountForEst = liveRow.amount ?? amountAtSnap;
  const pct =
    amountForEst > 0 ? round2((rt1 / amountForEst) * 10000) / 100 : null;
  return finalizeLiveFundDisplayRow(
    {
      ...liveRow,
      estimateProfit: rt1,
      estimateImpactPct: pct ?? liveRow.estimateImpactPct,
      impactPct: pct ?? liveRow.impactPct,
      impactPctRegular: fundSnap.impactPctRegular ?? liveRow.impactPctRegular,
      estimateAssets: round2(amountForEst + rt1),
      displaySnap: true,
    },
    now,
  );
}

/**
 * 穿透/融合基金在 asia_live 已算好 row1，不得用旧 regularSnapshot 覆盖。
 * @param {ReturnType<typeof resolveDisplaySession>} clockSession
 * @param {object} liveRow
 */
function isAsiaLiveHoldingsRow(clockSession, liveRow) {
  if (clockSession.clockPhase !== 'asia_live') return false;
  const src = String(liveRow?.impactSource ?? liveRow?.estimateSource ?? '');
  return src === 'holdings' || src === 'ensemble';
}

/**
 * @param {number} fundId
 * @param {object} liveRow
 * @param {string} accrualDay
 * @param {Date} [now]
 */
export function applyFundRt1Snap(fundId, liveRow, accrualDay, now = new Date()) {
  const clockSession = resolveDisplaySession(now);
  if (isAsiaLiveHoldingsRow(clockSession, liveRow)) {
    return finalizeLiveFundDisplayRow(liveRow, now);
  }
  // 仅美股正盘允许 regular 持仓 live bypass；asia_live / eod_freeze 读 snap 或 fallback
  const shouldRefreshLive =
    clockSession.clockPhase === 'us_regular_live' &&
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
  // eod_freeze：美指 style 读 4:00 指数收盘；snap 中 rt1=0 时 fallback
  if (clockSession.clockPhase === 'eod_freeze' && shouldFreezeUsIndexCloseSnapshot(liveRow, now)) {
    const readySnap = getReadyFundRt1Snap(accrualDay, now, 'portfolio');
    const fundSnap = readySnap?.funds?.[fundId] ?? readySnap?.funds?.[String(fundId)];
    if (!snapEntryRt1Usable(fundSnap, liveRow, now)) {
      const closeFallback = applyRegularSnapshotFallback(fundId, liveRow, now);
      if (closeFallback) {
        return finalizeLiveFundDisplayRow(closeFallback, now);
      }
    }
  }
  // day_open / asia_live 美指 style 读指数条 4:00 收盘
  if (
    shouldFreezeUsIndexCloseSnapshot(liveRow, now) &&
    clockSession.clockPhase !== 'eod_freeze'
  ) {
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
  if (rawSnap && isScopeSnapReady(rawSnap, now, accrualDay)) {
    const rawFundSnap = rawSnap?.funds?.[fundId] ?? rawSnap?.funds?.[String(fundId)];
    if (rawFundSnap?.rt1 != null) {
      return applyFundSnapEntry(fundId, liveRow, rawFundSnap, now);
    }
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

  // spec §2.2 / §9：header RT1/EST 恒为 Σ per-fund（amount+ep）；16:00 冻结在 per-fund snap 读回
  return {
    ...totalsLive,
    settledAssets: settled,
    realtimeProfit: rt1Live,
    realtimeProfitPct:
      settled > 0 ? round2((rt1Live / settled) * 10000) / 100 : totalsLive.realtimeProfitPct,
    realtimeAssets: estFromFunds,
    estimateAssetsSum: estFromFunds,
    baseline,
    liveMode: estimateFrozen ? 'snap' : 'live',
    estimateFrozen,
  };
}
