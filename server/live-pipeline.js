/**
 * 展示层唯一流水线：per-fund 计算 → snap 状态机 → snap 应用 → 组合求和。
 * refreshLive 与测试均应调用本模块，避免 live.js 与 snap 组件各自拼装。
 */
import { computeAccountTotalsMap, computePortfolioTotals } from './aggregate.js';
import {
  applyFundRt1Snap,
  applyPortfolioTotalsSnap,
} from './components/snap-apply.js';
import { reconcileDisplayState } from './components/snap-seed.js';
import { getCurrentPhase } from './day-display-state.js';
import { resolveDisplaySession } from './display-session.js';
import { finalizeLiveFundDisplayRow } from './components/suppress.js';
import { buildDisplayFundRow, buildDisplayFundRowFallback } from './fund-display.js';
import { applyFundMetricsLiveGate } from './fund-metrics-live.js';
import { beijingDateString } from './time.js';

/** 从 live cache 行还原 market.js 穿透 payload（reapply 不重拉行情） */
function impactRawFromCachedRow(row) {
  if (!row) return {};
  return {
    impactPct: row.rawImpactPct ?? row.impactPct,
    impactPctRegular: row.impactPctRegularLive ?? row.impactPctRegular,
    impactPctExtended: row.impactPctExtendedLive ?? row.impactPctExtended,
    weightCoverage: row.weightCoverage,
    quoteCoverage: row.quoteCoverage,
    reportFundCount: row.reportFundCount,
    count: row.holdingsCount,
    impactSource: row.impactSource,
    valuationConfidence: row.valuationConfidence,
    ensembleAlpha: row.ensembleAlpha,
    holdingsImpactPct: row.holdingsImpactPct,
    fundgzImpactPct: row.fundgzImpactPct,
    impactBreakdown: row.impactBreakdown,
    hasRegularHolding: row.hasRegularHolding,
    shouldRefreshLiveRt1: row.shouldRefreshLiveRt1,
  };
}

/** 从 live cache 行还原东财 navInfo（入账后 reapply 须读 portfolio，nav 仅用于 pending 门控） */
function navInfoFromCachedRow(row) {
  if (!row?.officialNavDate) return null;
  return {
    pdate: row.officialNavDate,
    navChgRt:
      row.settledSource === 'eastmoney' && row.settledPct != null && Number.isFinite(row.settledPct)
        ? row.settledPct
        : null,
    displayDate: row.officialDisplayDate ?? row.officialNavDate,
  };
}

/**
 * @param {{ funds: object[] }} portfolio
 * @param {object[]} impactRawList
 * @param {object[]} navInfos
 * @param {string} beijingDate
 * @param {Date} now
 */
export function buildDisplayFundRows(portfolio, impactRawList, navInfos, beijingDate, now) {
  return portfolio.funds.map((f, idx) => {
    try {
      return buildDisplayFundRow(f, impactRawList[idx] ?? {}, navInfos[idx] ?? null, beijingDate, now);
    } catch {
      return buildDisplayFundRowFallback(f, navInfos[idx] ?? null, beijingDate, now);
    }
  });
}

/**
 * snap 应用 + 组合合计（不含 reconcile / backfill）
 * @param {{ funds: object[] }} portfolio
 * @param {object[]} liveRows
 * @param {Date} now
 */
export function applyDisplaySnapAndTotals(portfolio, liveRows, now = new Date(), session = null) {
  const s = session ?? resolveDisplaySession(now, { persistedPhase: getCurrentPhase() });
  const accrualDay = s.accrualDay;
  const fundById = new Map(portfolio.funds.map((f) => [f.id, f]));
  const funds = liveRows.map((row) => {
    const snapped = finalizeLiveFundDisplayRow(
      applyFundRt1Snap(row.id, row, accrualDay, now),
      now,
    );
    return applyFundMetricsLiveGate(snapped, fundById.get(row.id), now);
  });
  let totals = applyPortfolioTotalsSnap(
    computePortfolioTotals(portfolio, funds, now),
    accrualDay,
    now,
  );
  return { funds, totals, accrualDay, session: s };
}

/**
 * @param {{ funds: object[] }} portfolio
 * @param {object[]} impactRawList
 * @param {object[]} navInfos
 * @param {string} beijingDate
 * @param {Date} now
 */
export async function runLiveDisplayPipeline(portfolio, impactRawList, navInfos, beijingDate, now) {
  const session = resolveDisplaySession(now, { persistedPhase: getCurrentPhase() });
  let funds = buildDisplayFundRows(portfolio, impactRawList, navInfos, beijingDate, now);

  const totalsPre = computePortfolioTotals(portfolio, funds, now);
  const displayState = reconcileDisplayState(
    portfolio,
    funds,
    totalsPre,
    impactRawList,
    now,
    session,
  );

  const snapped = applyDisplaySnapAndTotals(portfolio, funds, now, session);
  const totalsByAccount = computeAccountTotalsMap(
    portfolio,
    snapped.funds,
    portfolio.accounts ?? [],
    now,
  );
  return {
    funds: snapped.funds,
    totals: snapped.totals,
    totalsByAccount,
    displayState,
    accrualDay: session.accrualDay,
    session,
  };
}

/**
 * 切换资产口径或 cache 重算 totals（不重新拉穿透）
 * @param {{ funds: object[] }} portfolio
 * @param {object[]} cachedFunds
 * @param {Date} [now]
 */
export function reapplyDisplayFromCachedFunds(portfolio, cachedFunds, now = new Date()) {
  const beijingDate = beijingDateString(now);
  const byId = new Map(cachedFunds.map((r) => [r.id, r]));
  const impacts = portfolio.funds.map((f) => impactRawFromCachedRow(byId.get(f.id)));
  const navInfos = portfolio.funds.map((f) => navInfoFromCachedRow(byId.get(f.id)));
  const funds = buildDisplayFundRows(portfolio, impacts, navInfos, beijingDate, now);
  const snapped = applyDisplaySnapAndTotals(portfolio, funds, now);
  const totalsByAccount = computeAccountTotalsMap(
    portfolio,
    snapped.funds,
    portfolio.accounts ?? [],
    now,
  );
  return { ...snapped, totalsByAccount };
}
