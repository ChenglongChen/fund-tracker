/**
 * 收益日历归属日（creditDay）规则 — 对标蚂蚁财富收益明细。
 */
import { beijingDateString, beijingIsoAddDays } from './time.js';
import { classifyFundMarket } from './components/market-hours.js';

/** @param {string} iso YYYY-MM-DD */
function parseIso(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return { y, m, d };
}

/** @param {number} y @param {number} m @param {number} d @returns {string} */
function formatIso(y, m, d) {
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** @param {string} iso @returns {number} 0=Sun … 6=Sat */
export function weekdayFromIso(iso) {
  const { y, m, d } = parseIso(iso);
  return new Date(Date.UTC(y, m - 1, d, 12)).getUTCDay();
}

/** 中国 A 股日历：周一至周五为交易日（节假日暂无历表，无入账周末一律 off）。 */
export function isChinaTradingDay(iso) {
  const wd = weekdayFromIso(iso);
  return wd >= 1 && wd <= 5;
}

/**
 * 下一中国交易日（跳过周六日）。
 * @param {string} iso YYYY-MM-DD
 * @returns {string}
 */
export function nextChinaTradingDay(iso) {
  let cur = iso;
  for (let i = 0; i < 8; i++) {
    cur = beijingIsoAddDays(cur, 1);
    const wd = weekdayFromIso(cur);
    if (wd >= 1 && wd <= 5) return cur;
  }
  return beijingIsoAddDays(iso, 1);
}

/** @param {string} onOrBefore YYYY-MM-DD */
export function lastChinaTradingDay(onOrBefore) {
  let d = onOrBefore;
  for (let i = 0; i < 14; i++) {
    if (isChinaTradingDay(d)) return d;
    d = beijingIsoAddDays(d, -1);
  }
  return onOrBefore;
}

/**
 * 历史回填：A 股/黄金 = navDate；QDII = 下一中国交易日。
 * @param {string} navDate YYYY-MM-DD
 * @param {object} fund
 * @returns {string}
 */
export function creditDayForBackfill(navDate, fund) {
  const market = classifyFundMarket(fund);
  if (market === 'cn' || market === 'gold_cn') return navDate;
  return nextChinaTradingDay(navDate);
}

/**
 * 运行时入账：creditDay = 北京当日（settle 触发日）。
 * @param {Date} [now]
 * @returns {string}
 */
export function creditDayForSettle(now = new Date()) {
  return beijingDateString(now);
}

/** @param {string} month YYYY-MM @returns {{ start: string, end: string, days: string[] }} */
export function monthDateRange(month) {
  const [y, m] = month.split('-').map(Number);
  const lastDay = new Date(Date.UTC(y, m, 0, 12)).getUTCDate();
  const start = formatIso(y, m, 1);
  const end = formatIso(y, m, lastDay);
  /** @type {string[]} */
  const days = [];
  for (let d = 1; d <= lastDay; d++) {
    days.push(formatIso(y, m, d));
  }
  return { start, end, days };
}

/** @param {string} iso @returns {string} YYYY-MM */
export function monthFromIso(iso) {
  return iso.slice(0, 7);
}
