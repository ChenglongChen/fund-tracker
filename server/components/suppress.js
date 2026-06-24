/**
 * A 股/黄金联接 suppress：21:30–09:30 与周末 row1 强制为 —。
 */
import { beijingParts, beijingWeekday } from '../time.js';

/** @typedef {'cn' | 'us' | 'gold_cn'} MarketType */

const CN_RT_OPEN_MIN = 9 * 60 + 30;
const CN_RT_EVENING_CUTOFF_MIN = 21 * 60 + 30;

/** @param {{ hour: string, minute: string }} parts */
function minutesOfDay(parts) {
  return Number(parts.hour) * 60 + Number(parts.minute);
}

/**
 * @param {MarketType} market
 * @param {Date} [now]
 */
export function shouldSuppressDomesticRealtimeDisplay(market, now = new Date()) {
  if (market !== 'cn' && market !== 'gold_cn') return false;

  const wd = beijingWeekday(now);
  if (wd === 0 || wd === 6) return true;

  const mins = minutesOfDay(beijingParts(now));
  if (mins < CN_RT_OPEN_MIN) return true;
  if (mins >= CN_RT_EVENING_CUTOFF_MIN) return true;
  return false;
}


/**
 * 展示层收口：suppress 窗口内强制清空 row1（snap / live 均须经过此函数）。
 * @param {object} row
 * @param {Date} [now]
 */
export function finalizeLiveFundDisplayRow(row, now = new Date()) {
  const market = row?.market ?? 'cn';
  if (!shouldSuppressDomesticRealtimeDisplay(market, now)) return row;
  const amount = row?.amount;
  return {
    ...row,
    impactPct: null,
    impactPctRegular: null,
    impactPctExtended: null,
    impactPctRegularLive: null,
    impactPctExtendedLive: null,
    estimateImpactPct: null,
    estimateProfit: null,
    realTimeProfitExtended: null,
    estimateAssets: amount != null && Number.isFinite(amount) ? Math.round(amount * 100) / 100 : null,
    displaySnap: false,
    realtimeActive: false,
  };
}
