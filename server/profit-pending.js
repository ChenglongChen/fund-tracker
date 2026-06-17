/**
 * 当日收益 / 收益日历 pending 门控（北京 16:00 对齐；跨周末用 lastChinaTradingDay）。
 */
import { beijingDateString, beijingIsoAddDays, beijingParts, beijingWeekday } from './time.js';
import { classifyFundMarket } from './components/market-hours.js';
import { isChinaTradingDay, lastChinaTradingDay } from './profit-attribution.js';

/** 与 EOD snap / 净值更新窗口对齐 */
export const DAILY_NAV_EXPECT_HOUR = 16;

/** @param {{ hour: string, minute: string }} parts */
function minutesOfDay(parts) {
  return Number(parts.hour) * 60 + Number(parts.minute);
}

/**
 * CN / QDII 在 beijingDate 上展示「当日收益」时期望已入账的最新 navDate。
 * @param {string} beijingDate
 * @param {'cn' | 'us' | 'gold_cn'} market
 * @param {Date} now
 */
export function expectedNavDateForDailyDisplay(beijingDate, market, now = new Date()) {
  const yesterday = beijingIsoAddDays(beijingDate, -1);
  const mins = minutesOfDay(beijingParts(now));
  if (mins < DAILY_NAV_EXPECT_HOUR * 60) {
    return lastChinaTradingDay(yesterday);
  }
  if (market === 'us') {
    return lastChinaTradingDay(yesterday);
  }
  return beijingDate;
}

/**
 * 持仓列表「当日收益」是否待更新（true → 显示 —）。
 * @param {object} fund
 * @param {'cn' | 'us' | 'gold_cn'} market
 * @param {{ pdate?: string } | null} navInfo
 * @param {string} beijingDate
 * @param {Date} [now]
 */
export function isDailyProfitPending(fund, market, navInfo, beijingDate, now = new Date()) {
  const wd = beijingWeekday(now);
  if (wd === 0 || wd === 6) return false;

  const lastNavDate = fund.lastNavDate ?? null;
  const officialDate = navInfo?.pdate ?? null;
  const mins = minutesOfDay(beijingParts(now));
  const afterNavWindow = mins >= DAILY_NAV_EXPECT_HOUR * 60;

  // 16:00 前仍展示上一已入账日收益；东财 pdate 跨日超前不应提前置 pending（spec §3b）
  if (afterNavWindow && officialDate && lastNavDate && officialDate > lastNavDate) return true;
  if (!lastNavDate) return true;

  if (market === 'us') {
    if (mins < DAILY_NAV_EXPECT_HOUR * 60) return false;
    const yesterday = beijingIsoAddDays(beijingDate, -1);
    return lastNavDate < lastChinaTradingDay(yesterday);
  }

  const expected = expectedNavDateForDailyDisplay(beijingDate, market, now);
  return lastNavDate < expected;
}

/**
 * 收益日历「今日」格是否应显示「未更新」（仅 creditDay=今天、无 ledger、16:00 后）。
 * @param {object} portfolio
 * @param {string} creditDay
 * @param {Date} [now]
 */
export function isPortfolioCreditDayPending(portfolio, creditDay, now = new Date()) {
  const today = beijingDateString(now);
  if (creditDay !== today) return false;
  if (!isChinaTradingDay(creditDay)) return false;

  const wd = beijingWeekday(now);
  if (wd === 0 || wd === 6) return false;

  const mins = minutesOfDay(beijingParts(now));
  if (mins < DAILY_NAV_EXPECT_HOUR * 60) return false;

  for (const f of portfolio?.funds ?? []) {
    if (!f.shares || !f.lastNavDate) continue;
    const market = classifyFundMarket(f);
    const expected = expectedNavDateForDailyDisplay(creditDay, market, now);
    if (f.lastNavDate < expected) return true;
  }
  return false;
}
