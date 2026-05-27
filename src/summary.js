/**
 * 前端 scope 合计 — 只读 API 字段，禁止用 pct 重算 row1。
 * SCOPE_ALL：优先 live.totals（与后端 canonical 一致）。
 */
import { dayProfitPct } from './portfolio.js';

export function rowRt1(f) {
  if (f.estimateProfit != null && Number.isFinite(f.estimateProfit)) return f.estimateProfit;
  return 0;
}

export function extendedSummarySession(rows) {
  const usRow = rows.find(
    (f) =>
      f.market === 'us' &&
      (f.impactSession === 'premarket' ||
        f.impactSession === 'afterhours' ||
        f.impactSession === 'overnight'),
  );
  return usRow?.impactSession ?? null;
}

export function sumExtendedForRows(rows) {
  let total = 0;
  let usAssets = 0;
  for (const f of rows) {
    const ext = f.realTimeProfitExtended;
    if (ext != null && Number.isFinite(ext)) total += ext;
    if (f.market === 'us') usAssets += f.amount ?? 0;
  }
  return {
    total: Math.round(total * 100) / 100,
    pct: usAssets > 0 ? (total / usAssets) * 100 : null,
  };
}

/**
 * @param {object[]} rows
 * @param {object|null} [canonicalTotals] API live.totals（portfolio 级）
 * @param {object|null} [displayState] API displayState（extendedSession 兜底）
 */
export function buildSummary(rows, canonicalTotals = null, displayState = null) {
  const settledAssets = rows.reduce((s, f) => s + (f.amount ?? 0), 0);
  const totalSettled = rows.reduce((s, f) => s + (f.settledProfit ?? 0), 0);
  const totalSettledPct = dayProfitPct(settledAssets, totalSettled);
  const totalRealTime =
    canonicalTotals?.realtimeProfit != null && Number.isFinite(canonicalTotals.realtimeProfit)
      ? canonicalTotals.realtimeProfit
      : rows.reduce((s, f) => s + rowRt1(f), 0);
  const ext =
    canonicalTotals?.realtimeProfitExtended != null
      ? {
          total: canonicalTotals.realtimeProfitExtended,
          pct: canonicalTotals.realtimeProfitExtendedPct ?? null,
        }
      : sumExtendedForRows(rows);
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
    totalRealTimeExtended: ext.total,
    totalRealTimeExtendedPct: ext.pct,
    extendedSession:
      canonicalTotals?.extendedSession ??
      displayState?.extendedSession ??
      extendedSummarySession(rows),
  };
}

export function hasExtendedSummaryLayout(summary) {
  if (!summary) return false;
  const session = summary.extendedSession;
  if (session !== 'premarket' && session !== 'afterhours' && session !== 'overnight') return false;
  const extVal = summary.totalRealTimeExtended;
  return extVal != null && Number.isFinite(extVal);
}

export function estimatedAssetsForRow(f) {
  if (f.estimateAssets != null && Number.isFinite(f.estimateAssets)) return f.estimateAssets;
  const ep = rowRt1(f);
  const amount = f.amount ?? 0;
  if (!ep) return amount;
  const settled = f.dailyPending ? 0 : (f.settledProfit ?? 0);
  return amount - settled + ep;
}
