import filePortfolio from './portfolio.json';

/** @typedef {{ snapshotDate?: string, snapshotLabel?: string, source?: string, note?: string, lastAutoSettleAt?: string }} PortfolioMeta */
/** @typedef {{ id: number, name: string, code: string, amount: number, yesterdayProfit?: number, totalProfit: number, totalProfitPct: number, shares?: number, lastNav?: number, lastNavDate?: string }} FundRow */

/** @param {number} amount @param {number | undefined} profit */
export function dayProfitPct(amount, profit) {
  if (profit == null || !Number.isFinite(profit) || amount <= profit) return null;
  const base = amount - profit;
  if (base <= 0) return null;
  return (profit / base) * 100;
}

/** 离线回退（无后端时） */
export function loadPortfolioFallback() {
  return {
    meta: filePortfolio.meta ?? {},
    funds: filePortfolio.funds,
  };
}
