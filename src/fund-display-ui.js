import { dayProfitPct } from './portfolio.js';

/**
 * 详情页指标：只读 merge 后的 row 字段，不重算 row1。
 * @param {object|null} row fundRows 条目
 * @param {object} fund portfolio fund
 */
export function pickFundDisplayMetrics(row, fund) {
  const amount = row?.amount ?? fund.amount;
  const dailyPending = row?.dailyPending ?? false;
  const settledProfit = dailyPending
    ? null
    : row?.settledProfit ?? fund.yesterdayProfit ?? null;
  const settledPct = dailyPending
    ? null
    : row?.settledPct ?? dayProfitPct(amount, settledProfit);

  return {
    impactPct: row?.impactPct ?? null,
    impactPctRegular: row?.impactPctRegular ?? row?.impactPct ?? null,
    impactPctExtended: row?.impactPctExtended ?? null,
    impactPctRegularLive: row?.impactPctRegularLive ?? row?.impactPctRegular ?? null,
    impactPctExtendedLive: row?.impactPctExtendedLive ?? row?.impactPctExtended ?? null,
    estimateImpactPct: row?.estimateImpactPct ?? null,
    impactSession: row?.impactSession ?? 'closed',
    realTimeProfit: row?.realTimeProfit ?? row?.estimateProfit ?? null,
    realTimePct: row?.realTimePct ?? null,
    realTimeProfitRegular: row?.realTimeProfitRegular ?? null,
    realTimePctRegular: row?.realTimePctRegular ?? null,
    realTimeProfitExtended: row?.realTimeProfitExtended ?? null,
    settledProfit,
    settledPct,
    dailyPending,
    totalProfit: row?.totalProfit ?? fund.totalProfit,
    totalProfitPct: row?.totalProfitPct ?? fund.totalProfitPct,
  };
}
