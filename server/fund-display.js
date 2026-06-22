/**
 * 展示层 per-fund 唯一计算入口：display impact → estimateProfit / estimateAssets / row2。
 * 穿透 raw impact 由 market.js 提供；本模块不做 snap，snap 由 live-pipeline 后续阶段应用。
 */
import {
  getFundProfitWindows,
  isDailyProfitPending,
  resolveLiveDisplayImpact,
} from './market-session.js';
import { finalizeLiveFundDisplayRow, shouldSuppressDomesticRealtimeDisplay } from './components/suppress.js';
import { enrichFundSettled, resolveDisplayedSettledFields } from './nav.js';
import {
  fundEstimateImpactPct,
  fundEstimateProfit,
  fundEstimatedAssets,
} from './fund-estimate.js';

/**
 * @param {object} f portfolio fund
 * @param {object} impactRaw market.js 穿透结果
 * @param {object|null} navInfo
 * @param {string} beijingDate
 * @param {Date} now
 */
export function buildDisplayFundRow(f, impactRaw, navInfo, beijingDate, now) {
  const settled = enrichFundSettled(f, navInfo);
  const windows = getFundProfitWindows(
    { ...f, lastNavDate: settled.settledNavDate ?? f.lastNavDate },
    beijingDate,
    now,
    navInfo,
  );
  const displayImpact = resolveLiveDisplayImpact(f.id, windows.market, impactRaw, now);
  const {
    impactPct,
    impactPctRegular,
    impactPctExtended,
    impactSession,
    rawImpactPct,
  } = displayImpact;
  const amount = f.amount ?? 0;
  const displayLive =
    impactPct != null && Number.isFinite(impactPct)
      ? {
          market: windows.market,
          impactPct: impactPctRegular ?? impactPct,
          impactPctRegular: impactPctRegular ?? null,
          impactPctExtended: impactPctExtended ?? null,
        }
      : null;
  const impactPctRegularLive =
    impactRaw?.impactPctRegular != null && Number.isFinite(impactRaw.impactPctRegular)
      ? impactRaw.impactPctRegular
      : impactRaw?.impactPct != null && Number.isFinite(impactRaw.impactPct)
        ? impactRaw.impactPct
        : null;
  const impactPctExtendedLive =
    impactRaw?.impactPctExtended != null && Number.isFinite(impactRaw.impactPctExtended)
      ? impactRaw.impactPctExtended
      : null;
  const estimateImpactPct = displayLive ? fundEstimateImpactPct(displayLive, now) : null;
  const estimateProfit = displayLive ? fundEstimateProfit(amount, displayLive, now) : null;
  const dailyPending = isDailyProfitPending(f, windows.market, navInfo, beijingDate, now);
  const settledFields = resolveDisplayedSettledFields(f, settled, navInfo, dailyPending, now);
  const estimateAssets = fundEstimatedAssets(
    amount,
    settledFields.settledProfit ?? f.yesterdayProfit ?? null,
    displayLive,
    dailyPending,
    now,
    null,
    estimateProfit,
  );
  const suppressDomestic = shouldSuppressDomesticRealtimeDisplay(windows.market, now);
  const row = {
    id: f.id,
    code: f.code,
    name: f.name,
    amount,
    totalProfit: f.totalProfit ?? null,
    totalProfitPct: f.totalProfitPct ?? null,
    yesterdayProfit: f.yesterdayProfit ?? null,
    shares: f.shares ?? null,
    lastNav: f.lastNav ?? null,
    impactPct,
    impactPctRegular,
    impactPctExtended,
    impactPctRegularLive,
    impactPctExtendedLive,
    estimateImpactPct,
    impactSession,
    estimateProfit,
    estimateAssets,
    dailyPending,
    weightCoverage: impactRaw.weightCoverage ?? null,
    quoteCoverage: impactRaw.quoteCoverage ?? null,
    reportFundCount: impactRaw.reportFundCount ?? 0,
    holdingsCount: impactRaw.count ?? 0,
    lastNavDate: settled.settledNavDate ?? f.lastNavDate ?? null,
    ...settledFields,
    ...windows,
    realtimeActive: suppressDomestic ? false : windows.realtimeActive,
    rawImpactPct,
    impactSource: impactRaw.impactSource ?? null,
    estimateSource: impactRaw.impactSource ?? null,
    valuationConfidence: impactRaw.valuationConfidence ?? null,
    ensembleAlpha: impactRaw.ensembleAlpha ?? null,
    holdingsImpactPct: impactRaw.holdingsImpactPct ?? null,
    fundgzImpactPct: impactRaw.fundgzImpactPct ?? null,
    impactBreakdown: impactRaw.impactBreakdown ?? null,
    hasRegularHolding: impactRaw.hasRegularHolding ?? false,
    shouldRefreshLiveRt1: impactRaw.shouldRefreshLiveRt1 ?? false,
    officialNavDate: navInfo?.pdate ?? null,
    officialDisplayDate: navInfo?.displayDate ?? null,
  };
  return finalizeLiveFundDisplayRow(row, now);
}

/**
 * buildDisplayFundRow 失败时的最小行（无穿透，保留净值字段）
 * @param {object} f
 * @param {object|null} navInfo
 * @param {string} beijingDate
 * @param {Date} now
 */
export function buildDisplayFundRowFallback(f, navInfo, beijingDate, now) {
  const settled = enrichFundSettled(f, navInfo);
  const windows = getFundProfitWindows(
    { ...f, lastNavDate: settled.settledNavDate ?? f.lastNavDate },
    beijingDate,
    now,
  );
  return finalizeLiveFundDisplayRow(
    {
      id: f.id,
      code: f.code,
      name: f.name,
      impactPct: null,
      weightCoverage: null,
      holdingsCount: 0,
      lastNavDate: settled.settledNavDate ?? f.lastNavDate ?? null,
      ...settled,
      ...windows,
      rawImpactPct: null,
      officialNavDate: navInfo?.pdate ?? null,
      officialDisplayDate: navInfo?.displayDate ?? null,
    },
    now,
  );
}
