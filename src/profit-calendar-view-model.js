/** 收益日历 ViewModel — 只读 API，禁止前端重算 settledProfit。 */
import {
  fetchProfitCalendarApi,
  fetchProfitSummaryApi,
  fetchProfitDayDetailApi,
} from './client-api.js';

export { fetchProfitCalendarApi as fetchProfitCalendar, fetchProfitSummaryApi as fetchProfitSummary, fetchProfitDayDetailApi as fetchProfitDayDetail };

/** @param {string} month YYYY-MM @param {number} delta -1 | 1 */
export function shiftMonth(month, delta) {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1, 12));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** @param {string} iso @returns {number} Sun=0 */
export function weekdayFromIso(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12)).getUTCDay();
}

/** @param {string} month @returns {{ month: string, year: number, monthNum: number, label: string }} */
export function monthMeta(month) {
  const [y, m] = month.split('-').map(Number);
  return { month, year: y, monthNum: m, label: `${y}年${m}月` };
}

/** @param {number[]} vals @param {number} w @param {number} h */
export function sparklinePath(vals, w = 64, h = 24) {
  if (!vals?.length) return '';
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const range = max - min || 1;
  const step = vals.length > 1 ? w / (vals.length - 1) : 0;
  return vals
    .map((v, i) => {
      const x = i * step;
      const y = h - ((v - min) / range) * (h - 4) - 2;
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
}
