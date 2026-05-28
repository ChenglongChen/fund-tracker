/**
 * 前端 scope 合计 — 只读 API 字段，禁止用 pct 重算 row1。
 * SCOPE_ALL：优先 live.totals（与后端 canonical 一致）。
 */
import { dayProfitPct } from './portfolio.js';

export function rowRt1(f) {
  if (f.estimateProfit != null && Number.isFinite(f.estimateProfit)) return f.estimateProfit;
  return 0;
}

/**
 * @param {object[]} rows
 * @param {object|null} [canonicalTotals] API live.totals（portfolio 级）
 * @param {object|null} [_displayState] API displayState
 */
export function buildSummary(rows, canonicalTotals = null, _displayState = null) {
  const settledAssets = rows.reduce((s, f) => s + (f.amount ?? 0), 0);
  const totalSettled = rows.reduce((s, f) => s + (f.settledProfit ?? 0), 0);
  const totalSettledPct = dayProfitPct(settledAssets, totalSettled);
  const totalRealTime =
    canonicalTotals?.realtimeProfit != null && Number.isFinite(canonicalTotals.realtimeProfit)
      ? canonicalTotals.realtimeProfit
      : rows.reduce((s, f) => s + rowRt1(f), 0);
  const realtimeAssets =
    canonicalTotals?.realtimeAssets != null && Number.isFinite(canonicalTotals.realtimeAssets)
      ? canonicalTotals.realtimeAssets
      : Math.round((settledAssets + totalRealTime) * 100) / 100;

  const totalHolding = rows.reduce((s, f) => s + (f.totalProfit ?? 0), 0);
  const totalRealTimePct = settledAssets > 0 ? (totalRealTime / settledAssets) * 100 : null;
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

export function hasExtendedSummaryLayout(_summary) {
  return false;
}

export function estimatedAssetsForRow(f) {
  if (f.estimateAssets != null && Number.isFinite(f.estimateAssets)) return f.estimateAssets;
  const ep = rowRt1(f);
  const amount = f.amount ?? 0;
  if (!ep) return amount;
  const settled = f.dailyPending ? 0 : (f.settledProfit ?? 0);
  return amount - settled + ep;
}
