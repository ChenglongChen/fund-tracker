/**
 * 前端 scope 合计 — 只读 API canonical totals，禁止用 pct 重算 row1。
 */
import { dayProfitPct } from './portfolio.js';

export function rowRt1(f) {
  if (f.estimateProfit != null && Number.isFinite(f.estimateProfit)) return f.estimateProfit;
  return 0;
}

function sumSettledProfit(rows) {
  let sum = 0;
  let hasDaily = false;
  for (const f of rows) {
    if (f.dailyPending) continue;
    if (f.settledProfit == null || !Number.isFinite(f.settledProfit)) continue;
    hasDaily = true;
    sum += f.settledProfit;
  }
  return { sum, hasDaily };
}

/**
 * @param {object[]} rows
 * @param {object|null} [canonicalTotals] API live.totals / totalsByAccount
 * @param {object|null} [_displayState] API displayState
 */
export function buildSummary(rows, canonicalTotals = null, _displayState = null) {
  if (canonicalTotals) {
    const settledAssets = canonicalTotals.settledAssets ?? 0;
    const totalSettled =
      canonicalTotals.settledProfit != null && Number.isFinite(canonicalTotals.settledProfit)
        ? canonicalTotals.settledProfit
        : null;
    const totalRealTime =
      canonicalTotals.realtimeProfit != null && Number.isFinite(canonicalTotals.realtimeProfit)
        ? canonicalTotals.realtimeProfit
        : rows.reduce((s, f) => s + rowRt1(f), 0);
    const realtimeAssets =
      canonicalTotals.realtimeAssets != null && Number.isFinite(canonicalTotals.realtimeAssets)
        ? canonicalTotals.realtimeAssets
        : Math.round((settledAssets + totalRealTime) * 100) / 100;
    const totalHolding =
      canonicalTotals.holdingProfit != null && Number.isFinite(canonicalTotals.holdingProfit)
        ? canonicalTotals.holdingProfit
        : rows.reduce((s, f) => s + (f.totalProfit ?? 0), 0);
    const totalSettledPct =
      totalSettled != null
        ? (canonicalTotals.settledProfitPct ??
          (settledAssets > 0 ? (totalSettled / settledAssets) * 100 : null))
        : null;
    const totalRealTimePct =
      canonicalTotals.realtimeProfitPct ??
      (settledAssets > 0 ? (totalRealTime / settledAssets) * 100 : null);
    const costBasis = settledAssets - totalHolding;
    const totalHoldingPct = costBasis > 0 ? (totalHolding / costBasis) * 100 : null;

    return {
      totalAssets: settledAssets,
      totalSettled,
      totalSettledPct,
      totalRealTime,
      totalHolding,
      totalRealTimePct,
      totalHoldingPct,
      settledAssets,
      realtimeAssets,
    };
  }

  const settledAssets = rows.reduce((s, f) => s + (f.amount ?? 0), 0);
  const { sum: totalSettled, hasDaily } = sumSettledProfit(rows);
  const totalSettledPct = hasDaily ? dayProfitPct(settledAssets, totalSettled) : null;
  const totalRealTime = rows.reduce((s, f) => s + rowRt1(f), 0);
  const realtimeAssets = rows.reduce(
    (s, f) => s + (f.estimateAssets != null && Number.isFinite(f.estimateAssets) ? f.estimateAssets : (f.amount ?? 0)),
    0,
  );
  const totalHolding = rows.reduce((s, f) => s + (f.totalProfit ?? 0), 0);
  const totalRealTimePct = settledAssets > 0 ? (totalRealTime / settledAssets) * 100 : null;
  const costBasis = settledAssets - totalHolding;
  const totalHoldingPct = costBasis > 0 ? (totalHolding / costBasis) * 100 : null;

  return {
    totalAssets: settledAssets,
    totalSettled: hasDaily ? totalSettled : null,
    totalSettledPct,
    totalRealTime,
    totalHolding,
    totalRealTimePct,
    totalHoldingPct,
    settledAssets,
    realtimeAssets: Math.round(realtimeAssets * 100) / 100,
  };
}

export function estimatedAssetsForRow(f) {
  if (f.estimateAssets != null && Number.isFinite(f.estimateAssets)) return f.estimateAssets;
  const ep = rowRt1(f);
  const amount = f.amount ?? 0;
  if (!ep) return amount;
  return amount + ep;
}
