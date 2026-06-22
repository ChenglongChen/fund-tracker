/**
 * 持仓/自选统一的 live 行解析与展示 profile（口径一致，UI 分支）。
 */
import { SCOPE_SUMMARY } from './accounts.js';
import { pickFundDisplayMetrics } from './fund-display-ui.js';
import { hasRealtimeProfit } from './components/session.js';

/** @typedef {'holdings'|'watchlist'} DetailSource */

export const FUND_DISPLAY_PROFILE = {
  holdings: { showAmount: true, showHoldingMetric: true, pctOnly: false },
  watchlist: { showAmount: false, showHoldingMetric: false, pctOnly: true },
};

/**
 * @param {object} state
 * @param {{ source: DetailSource, scope: string|null, code: string }} ctx
 */
export function resolveFundLiveRow(state, { source, scope, code }) {
  if (source === 'watchlist') {
    return state.watchlistRows?.find((r) => r.code === code) ?? null;
  }
  if (scope === SCOPE_SUMMARY) {
    return (
      state.fundRows?.find((r) => r.code === code && r.isMerged) ??
      state.displayRows?.find((r) => r.code === code) ??
      null
    );
  }
  if (scope) {
    return state.fundRows?.find((r) => r.code === code && r.accountId === scope) ?? null;
  }
  return null;
}

/**
 * @param {() => object[]} getFunds
 * @param {{ scope: string|null, code: string }} ctx
 */
export function resolvePortfolioFund(getFunds, { scope, code }) {
  if (scope === SCOPE_SUMMARY || !scope) return null;
  return getFunds().find((f) => f.code === code && f.accountId === scope) ?? null;
}

/**
 * @param {object|null} row
 * @param {object|null} portfolioFund
 */
export function fundForDetailView(row, portfolioFund) {
  if (portfolioFund) return portfolioFund;
  if (!row) return null;
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    amount: row.amount ?? row.displayAmount ?? 0,
    accountId: row.accountId,
    isMerged: row.isMerged ?? false,
    totalProfit: row.totalProfit ?? null,
    totalProfitPct: row.totalProfitPct ?? null,
  };
}

/** @param {object|null} row */
export function fundRealtimePct(row) {
  if (!row || !hasRealtimeProfit(row)) return null;
  return row.realTimePct ?? row.estimateImpactPct ?? null;
}

/** @param {object|null} row */
export function fundDailyPct(row) {
  if (!row) return null;
  if (row.settledPct != null && Number.isFinite(row.settledPct)) return row.settledPct;
  return null;
}

/**
 * @param {object} state
 * @param {{ source: DetailSource, scope: string|null, code: string }} ctx
 * @param {() => object[]} getFunds
 */
export function detailMetricsFor(state, ctx, getFunds) {
  const row = resolveFundLiveRow(state, ctx);
  const portfolioFund = resolvePortfolioFund(getFunds, ctx);
  const fund = fundForDetailView(row, portfolioFund);
  if (!fund) return { fund: null, metrics: null, row };
  const metrics = pickFundDisplayMetrics(row, fund);
  return { fund, metrics, row };
}

export function detailProfile(source) {
  return FUND_DISPLAY_PROFILE[source] ?? FUND_DISPLAY_PROFILE.holdings;
}
