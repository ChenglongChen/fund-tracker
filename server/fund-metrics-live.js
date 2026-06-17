/**
 * 新申购基金：metricsLiveFrom 之前 RT1 / 当日 / 持有收益均为 0（默认 09:30 北京）。
 */
import { round2 } from './day-display-state.js';
import { finalizeLiveFundDisplayRow } from './components/suppress.js';

/** A 股 metrics 生效时刻（北京 09:30） */
export const CN_METRICS_LIVE_OPEN = '09:30:00+08:00';

/**
 * @param {object} fund
 * @returns {Date|null}
 */
export function metricsLiveFromInstant(fund) {
  const raw = fund?.metricsLiveFrom ?? null;
  if (!raw || typeof raw !== 'string') return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const d = new Date(`${raw}T${CN_METRICS_LIVE_OPEN}`);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** @param {object} fund @param {Date} [now] */
export function isFundMetricsLive(fund, now = new Date()) {
  const from = metricsLiveFromInstant(fund);
  if (!from) return true;
  return now.getTime() >= from.getTime();
}

/**
 * metricsLiveFrom 之前：清零三类收益展示，保留 amount 计入总资产。
 * @param {object} row
 * @param {object|null|undefined} fund
 * @param {Date} [now]
 */
export function applyFundMetricsLiveGate(row, fund, now = new Date()) {
  if (!fund || isFundMetricsLive(fund, now)) return row;
  const amount = fund.amount ?? row.amount ?? 0;
  return finalizeLiveFundDisplayRow(
    {
      ...row,
      amount,
      estimateProfit: null,
      estimateImpactPct: null,
      estimateAssets: round2(amount),
      impactPct: null,
      impactPctRegular: null,
      impactPctExtended: null,
      impactPctRegularLive: null,
      impactPctExtendedLive: null,
      dailyPending: false,
      settledProfit: 0,
      settledPct: 0,
      yesterdayProfit: 0,
      totalProfit: 0,
      totalProfitPct: 0,
      realtimeActive: false,
      displaySnap: false,
    },
    now,
  );
}
