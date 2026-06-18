/**
 * 新申购基金 metricsLiveFrom：
 * - 09:30 前：RT1 / 当日 / 持有均为 0
 * - 09:30 后：仅 RT1 live；当日/持有仍 0，直到 lastNavDate ≥ metricsLiveFrom 日（首笔官方净值入账）
 */
import { beijingDateString } from './time.js';
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

/** @param {object} fund @returns {string|null} YYYY-MM-DD */
export function metricsLiveFromDate(fund) {
  const raw = fund?.metricsLiveFrom ?? null;
  if (!raw || typeof raw !== 'string') return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const instant = metricsLiveFromInstant(fund);
  return instant ? beijingDateString(instant) : null;
}

/** RT1 是否可 live（09:30 起） @param {object} fund @param {Date} [now] */
export function isFundMetricsLive(fund, now = new Date()) {
  const from = metricsLiveFromInstant(fund);
  if (!from) return true;
  return now.getTime() >= from.getTime();
}

/**
 * 当日 / 持有是否已入账可展示（需 lastNavDate ≥ metricsLiveFrom 日）
 * @param {object} fund
 */
export function isFundAccrualMetricsLive(fund) {
  const fromDate = metricsLiveFromDate(fund);
  if (!fromDate) return true;
  const lastNav = fund.lastNavDate ?? null;
  return Boolean(lastNav && lastNav >= fromDate);
}

/** settle 是否可接受该 navDate @param {object} fund @param {string} navDate */
export function isFundSettleNavEligible(fund, navDate) {
  const fromDate = metricsLiveFromDate(fund);
  if (!fromDate || !navDate) return true;
  return navDate >= fromDate;
}

function zeroAccrualFields(row, fund) {
  const amount = fund.amount ?? row.amount ?? 0;
  const ep = row.estimateProfit;
  return {
    ...row,
    amount,
    dailyPending: false,
    settledProfit: 0,
    settledPct: 0,
    yesterdayProfit: 0,
    totalProfit: 0,
    totalProfitPct: 0,
    estimateAssets:
      ep != null && Number.isFinite(ep) ? round2(amount + ep) : round2(amount),
  };
}

/**
 * metricsLiveFrom 门控：保留 amount 计入总资产。
 * @param {object} row
 * @param {object|null|undefined} fund
 * @param {Date} [now]
 */
export function applyFundMetricsLiveGate(row, fund, now = new Date()) {
  if (!fund) return row;

  if (!isFundMetricsLive(fund, now)) {
    return finalizeLiveFundDisplayRow(
      {
        ...zeroAccrualFields(row, fund),
        estimateProfit: null,
        estimateImpactPct: null,
        estimateAssets: round2(fund.amount ?? row.amount ?? 0),
        impactPct: null,
        impactPctRegular: null,
        impactPctExtended: null,
        impactPctRegularLive: null,
        impactPctExtendedLive: null,
        realtimeActive: false,
        displaySnap: false,
      },
      now,
    );
  }

  if (!isFundAccrualMetricsLive(fund)) {
    return zeroAccrualFields(row, fund);
  }

  return row;
}
