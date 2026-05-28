import { dayProfitPct } from './store.js';
import { marketChipLabel } from './components/market-hours.js';
import { buildTableHeadLabels } from './components/table-head.js';
import { fundEstimatedAssets, liveImpactForEstimate } from './fund-estimate.js';
import { getBaselineForDay } from './day-display-state.js';
import { getRt1AccrualDay } from './display-session.js';

/**
 * scope 内 per-fund 展示字段求和（禁止重算 estimateProfit）。
 * @param {object[]} portfolioFunds
 * @param {Map<number, object>} liveById
 */
function accumulateScopeTotals(portfolioFunds, liveById) {
  let settledAssets = 0;
  let settledProfit = 0;
  let realtimeProfit = 0;
  let holdingProfit = 0;
  let estimateAssetsSum = 0;

  for (const f of portfolioFunds) {
    const live = liveById.get(f.id);
    const amount = f.amount ?? 0;
    settledAssets += amount;
    holdingProfit += f.totalProfit ?? 0;

    if (!live?.dailyPending) {
      const sp = live?.settledProfit;
      if (sp != null && Number.isFinite(sp)) settledProfit += sp;
    }

    const ep =
      live?.estimateProfit != null && Number.isFinite(live.estimateProfit)
        ? live.estimateProfit
        : null;
    if (ep != null) realtimeProfit += ep;

    const ea =
      live?.estimateAssets != null && Number.isFinite(live.estimateAssets)
        ? live.estimateAssets
        : amount;
    estimateAssetsSum += ea;
  }

  return {
    settledAssets: round2(settledAssets),
    settledProfit: round2(settledProfit),
    realtimeProfit: round2(realtimeProfit),
    holdingProfit: round2(holdingProfit),
    estimateAssetsSum: round2(estimateAssetsSum),
    fundCount: portfolioFunds.length,
  };
}

/**
 * 组合合计：仅对 per-fund 展示字段求和，禁止在此重算 estimateProfit。
 * canonical RT1 来源：fund-display.buildDisplayFundRow → live-pipeline。
 * @param {{ funds: object[] }} portfolio
 * @param {object[]} liveFunds
 */
export function computePortfolioTotals(portfolio, liveFunds, now = new Date()) {
  const liveById = new Map(liveFunds.map((f) => [f.id, f]));
  const acc = accumulateScopeTotals(portfolio.funds, liveById);
  const accrualDay = getRt1AccrualDay(now);
  const baseline = getBaselineForDay(accrualDay, 'portfolio');
  const portfolioEst =
    baseline != null && Number.isFinite(acc.realtimeProfit)
      ? round2(baseline + acc.realtimeProfit)
      : acc.estimateAssetsSum;

  return {
    settledAssets: acc.settledAssets,
    realtimeAssets: portfolioEst,
    settledProfit: acc.settledProfit,
    realtimeProfit: acc.realtimeProfit,
    holdingProfit: acc.holdingProfit,
    settledProfitPct: dayProfitPct(acc.settledAssets, acc.settledProfit),
    realtimeProfitPct:
      acc.settledAssets > 0 ? round4((acc.realtimeProfit / acc.settledAssets) * 100) : null,
    fundCount: acc.fundCount,
  };
}

/**
 * 账户 / 子 scope 合计：预估资产 = Σ per-fund estimateAssets（与列表行一致）。
 * @param {{ funds: object[] }} portfolio
 * @param {object[]} liveFunds
 * @param {{ accountId: string }} opts
 */
export function computeAccountTotals(portfolio, liveFunds, accountId, now = new Date()) {
  const liveById = new Map(liveFunds.map((f) => [f.id, f]));
  const scoped = portfolio.funds.filter((f) => f.accountId === accountId);
  const acc = accumulateScopeTotals(scoped, liveById);
  return {
    settledAssets: acc.settledAssets,
    realtimeAssets: acc.estimateAssetsSum,
    settledProfit: acc.settledProfit,
    realtimeProfit: acc.realtimeProfit,
    holdingProfit: acc.holdingProfit,
    settledProfitPct: dayProfitPct(acc.settledAssets, acc.settledProfit),
    realtimeProfitPct:
      acc.settledAssets > 0 ? round4((acc.realtimeProfit / acc.settledAssets) * 100) : null,
    fundCount: acc.fundCount,
  };
}

/** @param {{ funds: object[] }} portfolio @param {object[]} liveFunds @param {object[]} accounts */
export function computeAccountTotalsMap(portfolio, liveFunds, accounts, now = new Date()) {
  /** @type {Record<string, ReturnType<typeof computeAccountTotals>>} */
  const map = {};
  for (const acc of accounts ?? []) {
    if (!acc?.id) continue;
    const scoped = portfolio.funds.filter((f) => f.accountId === acc.id);
    if (!scoped.length) continue;
    map[acc.id] = computeAccountTotals(portfolio, liveFunds, acc.id, now);
  }
  return map;
}

/** @param {'settled'|'realtime'} mode @param {ReturnType<typeof computePortfolioTotals>} totals */
export function pickDisplayTotals(mode, totals) {
  if (mode === 'realtime') {
    return {
      mode: 'realtime',
      assets: totals.realtimeAssets,
      profit: totals.realtimeProfit,
      profitPct: totals.realtimeProfitPct,
      profitLabel: '实时收益',
      assetsLabel: '预估资产',
      assetsHint: '入账资产_{t−1} + 实时收益',
    };
  }
  return {
    mode: 'settled',
    assets: totals.settledAssets,
    profit: totals.settledProfit,
    profitPct: totals.settledProfitPct,
    profitLabel: '当日收益',
    assetsLabel: '账户资产',
    assetsHint: '已入账净值口径',
  };
}

/** @param {object} fund @param {object|null} live */
export function enrichFundDisplayAmount(fund, live, now = new Date()) {
  const amount = fund.amount ?? 0;
  const ea =
    live?.estimateAssets != null && Number.isFinite(live.estimateAssets)
      ? live.estimateAssets
      : live
        ? fundEstimatedAssets(
            amount,
            live.settledProfit ?? fund.yesterdayProfit ?? null,
            liveImpactForEstimate(live, live.market ?? 'cn'),
            live.dailyPending ?? false,
            now,
          )
        : null;
  return {
    bookedAmount: amount,
    estAmount: ea != null ? round2(ea) : round2(amount),
  };
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

function round4(n) {
  return Math.round(n * 10000) / 10000;
}

/**
 * @param {string} beijingDate
 * @param {string} updatedAt
 * @param {object[]} [liveFunds]
 * @param {object} [meta]
 * @param {Date} [now]
 */
export function buildDisplayContext(
  beijingDate,
  updatedAt,
  liveFunds = [],
  meta = {},
  now = new Date(),
  quoteUpdatedAt = updatedAt,
) {
  const chip = marketChipLabel(now);
  const liveText = chip === '休市' ? '全市场休市' : chip;
  const quoteAt = quoteUpdatedAt || updatedAt;
  return {
    beijingDate,
    updatedAt,
    quoteUpdatedAt: quoteAt,
    clockLabel: beijingDate && updatedAt ? `${beijingDate.slice(5)} ${updatedAt}` : updatedAt,
    quoteClockLabel: beijingDate && quoteAt ? `${beijingDate.slice(5)} ${quoteAt}` : quoteAt,
    marketChip: chip,
    realtimeNote: `实时收益=盘中最新估值 · 收市沿用最近收盘 · 盘中标记仅交易时段点亮 · 当前 ${liveText}`,
    dailyNote: '当日收益=净值公布后入账更新（通常晚间）· A股/黄金=当天 · QDII=最新公布净值日',
    holdingNote: '持有收益=累计盈亏，截至各基金已入账净值日',
    tableHead: buildTableHeadLabels(liveFunds, meta, beijingDate, updatedAt),
  };
}
