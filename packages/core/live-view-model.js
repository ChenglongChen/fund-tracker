/**
 * Live API → 列表行 ViewModel。row1 只读 estimateProfit，禁止 pct×amount 重算。
 */
import { dayProfitPct } from './portfolio.js';

export function roundProfit(amount, impactPct) {
  if (impactPct == null || !Number.isFinite(impactPct)) return null;
  if (amount == null || !Number.isFinite(amount)) return null;
  return Math.round(((amount * impactPct) / 100) * 100) / 100;
}

export function enrichFundRow(f, liveRow = null) {
  const dailyPending = liveRow?.dailyPending ?? false;
  const settledProfit = dailyPending
    ? null
    : (liveRow?.settledProfit ?? f.yesterdayProfit ?? null);
  const settledPct = dailyPending
    ? null
    : (liveRow?.settledPct ??
      (settledProfit != null ? dayProfitPct(f.amount, settledProfit) : null));
  const settledNavDate = liveRow?.settledNavDate ?? f.lastNavDate ?? null;
  const amount = liveRow?.amount ?? f.amount;
  return {
    ...f,
    amount,
    totalProfit: liveRow?.totalProfit ?? f.totalProfit,
    totalProfitPct: liveRow?.totalProfitPct ?? f.totalProfitPct,
    yesterdayProfit: liveRow?.yesterdayProfit ?? f.yesterdayProfit,
    lastNavDate: liveRow?.lastNavDate ?? f.lastNavDate,
    settledProfit,
    settledPct,
    settledNavDate,
    dailyPending,
    settledSource: liveRow?.settledSource ?? 'portfolio',
  };
}

/** @param {object[]} funds @param {object} live */
export function syncPortfolioFromLive(funds, live) {
  if (!live?.funds?.length) return;
  for (const f of funds) {
    const row = live.funds.find((x) => x.id === f.id);
    if (!row) continue;
    if (row.amount != null && Number.isFinite(row.amount)) f.amount = row.amount;
    if (row.totalProfit != null && Number.isFinite(row.totalProfit)) f.totalProfit = row.totalProfit;
    if (row.totalProfitPct != null && Number.isFinite(row.totalProfitPct)) {
      f.totalProfitPct = row.totalProfitPct;
    }
    if (row.yesterdayProfit != null && Number.isFinite(row.yesterdayProfit)) {
      f.yesterdayProfit = row.yesterdayProfit;
    }
    if (row.lastNavDate) f.lastNavDate = row.lastNavDate;
    if (row.lastNav != null && Number.isFinite(row.lastNav)) f.lastNav = row.lastNav;
    if (row.shares != null && Number.isFinite(row.shares)) f.shares = row.shares;
  }
}

/**
 * @param {object} f portfolio fund
 * @param {object|null} liveRow API fund row
 */
export function mapLiveRowToDisplay(f, liveRow) {
  const base = enrichFundRow(f, liveRow);
  const amount = base.amount ?? 0;
  const impactSession = liveRow?.impactSession ?? 'closed';
  const impactPctRegularLive =
    liveRow?.impactPctRegularLive ?? liveRow?.impactPctRegular ?? null;

  const ep =
    liveRow?.estimateProfit != null && Number.isFinite(liveRow.estimateProfit)
      ? liveRow.estimateProfit
      : null;

  const realTimeProfit = ep;
  const realTimePct = ep != null && amount > 0 ? (ep / amount) * 100 : null;

  return {
    ...base,
    impactPct: liveRow?.impactPct ?? null,
    impactPctRegular: liveRow?.impactPctRegular ?? null,
    estimateImpactPct: liveRow?.estimateImpactPct ?? null,
    impactSession,
    realTimeProfit,
    realTimePct,
    estimateProfit: ep,
    estimateAssets:
      liveRow?.estimateAssets != null && Number.isFinite(liveRow.estimateAssets)
        ? liveRow.estimateAssets
        : null,
    realtimeActive: liveRow?.realtimeActive ?? false,
    marketLabel: liveRow?.marketLabel ?? '',
    valuationBasis: liveRow?.valuationBasis ?? null,
    valuationParts: liveRow?.valuationParts ?? null,
    dailyAsOfLabel: liveRow?.dailyAsOfLabel ?? '',
    dailyHint: liveRow?.dailyHint ?? '',
    market: liveRow?.market ?? '',
    displayAmount: base.amount,
  };
}

/** @param {object[]} funds @param {object} live */
export function mergeLiveIntoFunds(funds, live) {
  syncPortfolioFromLive(funds, live);
  const byId = new Map(live.funds.map((x) => [x.id, x]));
  return funds.map((f) => mapLiveRowToDisplay(f, byId.get(f.id) ?? null));
}
