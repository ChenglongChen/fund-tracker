/**
 * 收益日历 API DTO 构建。
 */
import { beijingDateString, beijingIsoAddDays } from './time.js';
import { monthDateRange, monthFromIso } from './profit-attribution.js';
import { readProfitLedger, scopeDayTotals, sumScopeRange, getDayFundDetails } from './profit-ledger.js';
import { isChinaTradingDay } from './profit-attribution.js';
import { isPortfolioCreditDayPending } from './profit-pending.js';
import { dayProfitPct } from './store.js';

/** @param {number} n */
function round2(n) {
  return Math.round(n * 100) / 100;
}

/** 有实际入账数据的 ledger 日（排除回填占位 0 行）。 */
function isRealSettledDay(row, scope) {
  if (!row) return false;
  const t = scopeDayTotals(scope, row);
  if (t?.settledProfit == null || !Number.isFinite(t.settledProfit)) return false;
  if (row.funds && Object.keys(row.funds).length > 0) return true;
  if (t.settledProfit !== 0) return true;
  if (t.settledAssets != null && t.settledAssets > 0) return true;
  return false;
}

/** @returns {{ date: string, profit: number } | null} */
function findLastSettledDay(ledger, scope, today) {
  /** @type {{ date: string, profit: number } | null} */
  let lastAny = null;
  for (const day of Object.keys(ledger.days ?? {}).sort((a, b) => b.localeCompare(a))) {
    if (day > today) continue;
    const row = ledger.days[day];
    const t = scopeDayTotals(scope, row);
    if (t?.settledProfit == null || !Number.isFinite(t.settledProfit)) continue;
    if (!isRealSettledDay(row, scope)) continue;
    if (!lastAny) lastAny = { date: day, profit: t.settledProfit };
    if (t.settledProfit !== 0) return { date: day, profit: t.settledProfit };
  }
  return lastAny;
}

/** 月内累计收益曲线（每个交易日一个点，无入账日记 0 增量）。 */
function buildMonthSparkline(ledger, scope, monthStart, monthEnd, today) {
  const end = monthEnd < today ? monthEnd : today;
  let cumulative = 0;
  /** @type {number[]} */
  const vals = [];
  let d = monthStart;
  while (d <= end) {
    if (isChinaTradingDay(d)) {
      const row = ledger.days?.[d];
      let dayProfit = 0;
      if (isRealSettledDay(row, scope)) {
        const t = scopeDayTotals(scope, row);
        dayProfit = t.settledProfit ?? 0;
      }
      cumulative = round2(cumulative + dayProfit);
      vals.push(cumulative);
    }
    d = isoAddDays(d, 1);
  }
  return vals;
}

/** 区间起始日前的 scope 期末资产（上一入账日 settledAssets）。 */
function assetsAtRangeStart(ledger, scope, from, to) {
  /** @type {number|null} */
  let lastBefore = null;
  for (const day of Object.keys(ledger.days ?? {}).sort()) {
    if (day >= from) break;
    const t = scopeDayTotals(scope, ledger.days[day]);
    if (t?.settledAssets != null && Number.isFinite(t.settledAssets) && t.settledAssets > 0) {
      lastBefore = t.settledAssets;
    }
  }
  if (lastBefore != null) return lastBefore;
  for (const day of Object.keys(ledger.days ?? {}).sort()) {
    if (day < from || day > to) continue;
    const t = scopeDayTotals(scope, ledger.days[day]);
    if (t?.settledProfit == null || !Number.isFinite(t.settledProfit)) continue;
    if (t.settledAssets != null && t.settledAssets > (t.settledProfit ?? 0)) {
      return t.settledAssets - (t.settledProfit ?? 0);
    }
  }
  return null;
}

/** 区间收益率：Σprofit / 期初资产 × 100，与单日 dayProfitPct 同口径。 */
function rangeProfitPct(ledger, scope, from, to) {
  const profit = sumScopeRange(ledger, scope, from, to);
  if (profit == null) return null;
  if (profit === 0) return 0;
  const startAssets = assetsAtRangeStart(ledger, scope, from, to);
  if (startAssets == null || startAssets <= 0) return null;
  return dayProfitPct(startAssets + profit, profit);
}

/** @param {string} iso @param {number} delta */
function isoAddDays(iso, delta) {
  return beijingIsoAddDays(iso, delta);
}

/** @param {string} start @param {string} end */
function formatRangeLabel(start, end) {
  const fmt = (iso) => {
    const [, m, d] = iso.split('-');
    return `${m}.${d}`;
  };
  return `${fmt(start)}-${fmt(end)}`;
}

/** @param {string} scope @param {object[]} accounts */
export function scopeLabel(scope, accounts) {
  if (scope === 'all') return '全部持仓';
  if (scope === 'summary') return '账户概况';
  const acc = accounts?.find((a) => a.id === scope);
  return acc?.name ?? scope;
}

/**
 * @param {string} date
 * @param {string} today
 * @param {object|null} totals
 * @param {{ portfolio?: object, funds?: object[] }} [ctx]
 */
function dayStatus(date, today, totals, ctx = {}) {
  if (date > today) return 'future';
  if (!isChinaTradingDay(date)) return 'off';
  const hasLedger = totals?.settledProfit != null && Number.isFinite(totals.settledProfit);
  if (hasLedger) {
    if (totals.settledProfit === 0) return 'zero';
    return 'settled';
  }
  if (date === today && ctx.pendingToday) return 'pending';
  if (date <= today) return 'zero';
  return 'future';
}

/** @param {object} portfolio @param {string} today @param {Date} now */
function isPendingToday(portfolio, today, now) {
  return isPortfolioCreditDayPending(portfolio, today, now);
}

/**
 * @param {{
 *   scope: string,
 *   month: string,
 *   unit?: string,
 *   portfolio?: object,
 *   accounts?: object[],
 *   selectedDay?: string|null,
 *   now?: Date,
 * }} opts
 */
export async function buildProfitCalendar(opts) {
  const {
    scope,
    month,
    unit = 'amount',
    portfolio = null,
    accounts = [],
    selectedDay = null,
    now = new Date(),
  } = opts;

  if (scope === 'summary') {
    throw new Error('scope=summary 请使用 buildProfitSummary');
  }

  const ledger = await readProfitLedger();
  const today = beijingDateString(now);
  const { days: monthDays } = monthDateRange(month);
  const pendingToday = portfolio ? isPendingToday(portfolio, today, now) : false;

  /** @type {object[]} */
  const days = [];
  let monthProfit = 0;
  let monthHasProfit = false;

  for (const date of monthDays) {
    const row = ledger.days?.[date];
    const totals = scopeDayTotals(scope, row);
    const profit = totals?.settledProfit ?? null;
    let profitPct = totals?.settledProfitPct ?? null;
    if (profitPct == null && profit != null && totals?.settledAssets > 0) {
      profitPct = dayProfitPct(totals.settledAssets, profit);
    }
    const status = dayStatus(date, today, totals, { pendingToday });

    if (profit != null && Number.isFinite(profit)) {
      monthProfit += profit;
      monthHasProfit = true;
    }

    days.push({
      date,
      profit:
        status === 'future' || status === 'off' ? null : profit ?? (status === 'zero' ? 0 : null),
      profitPct:
        status === 'future' || status === 'off' ? null : profitPct ?? (status === 'zero' ? 0 : null),
      status,
    });
  }

  const sel =
    selectedDay && monthDays.includes(selectedDay)
      ? selectedDay
      : monthDays.includes(today)
        ? today
        : monthDays[monthDays.length - 1];

  const selRow = days.find((d) => d.date === sel);

  return {
    scope,
    scopeLabel: scopeLabel(scope, accounts),
    period: 'day',
    month,
    unit,
    monthTotal: {
      profit: monthHasProfit ? Math.round(monthProfit * 100) / 100 : null,
      profitPct: null,
    },
    days,
    selectedDay: sel,
    selectedDayDetail: selRow ?? null,
    updatedAt: ledger.meta?.lastBackfillAt ?? ledger.days?.[today]?.updatedAt ?? null,
  };
}

/**
 * @param {{
 *   month: string,
 *   accounts?: object[],
 *   portfolio?: object,
 *   now?: Date,
 * }} opts
 */
export async function buildProfitSummary(opts) {
  const { month, accounts = [], now = new Date() } = opts;
  const ledger = await readProfitLedger();
  const { start, end } = monthDateRange(month);
  const today = beijingDateString(now);
  const portfolioMonthTotal = sumScopeRange(ledger, 'all', start, end);
  const portfolioMonthPct = rangeProfitPct(ledger, 'all', start, end);
  const portfolioLast = findLastSettledDay(ledger, 'all', today);
  const portfolioSparkline = buildMonthSparkline(ledger, 'all', start, end, today);

  const accountRows = (accounts ?? [])
    .map((acc) => {
      const monthProfit = sumScopeRange(ledger, acc.id, start, end);
      const last = findLastSettledDay(ledger, acc.id, today);
      const monthProfitPct = rangeProfitPct(ledger, acc.id, start, end);
      const sparkline = buildMonthSparkline(ledger, acc.id, start, end, today);
      return {
        accountId: acc.id,
        name: acc.name,
        monthProfit,
        monthProfitPct,
        lastDay: last?.date ?? null,
        lastDayProfit: last?.profit ?? null,
        sparkline,
      };
    })
    .filter((a) => a.monthProfit != null || a.lastDay != null);

  return {
    month,
    portfolio: {
      accountId: 'all',
      name: '全部持仓',
      monthProfit: portfolioMonthTotal,
      monthProfitPct: portfolioMonthPct,
      lastDay: portfolioLast?.date ?? null,
      lastDayProfit: portfolioLast?.profit ?? null,
      sparkline: portfolioSparkline,
    },
    portfolioMonthTotal,
    accounts: accountRows,
  };
}

/**
 * 周视图：月内各自然周（周一至周日）卡片，对标支付宝。
 * @param {{ scope: string, month: string, accounts?: object[], now?: Date, selectedWeekStart?: string|null }} opts
 */
export async function buildProfitWeeksInMonth(opts) {
  const { scope, month, accounts = [], now = new Date(), selectedWeekStart = null } = opts;
  const ledger = await readProfitLedger();
  const today = beijingDateString(now);
  const { start: monthStart, end: monthEnd } = monthDateRange(month);

  const [y, m] = monthStart.split('-').map(Number);
  let cursor = new Date(Date.UTC(y, m - 1, 1, 12));
  const wd0 = cursor.getUTCDay();
  cursor.setUTCDate(cursor.getUTCDate() - (wd0 === 0 ? 6 : wd0 - 1));

  /** @type {object[]} */
  const weeks = [];
  for (let guard = 0; guard < 6; guard++) {
    const weekStart = cursor.toISOString().slice(0, 10);
    const weekEnd = isoAddDays(weekStart, 6);
    if (weekStart > monthEnd) break;
    if (weekEnd >= monthStart) {
      let profit = 0;
      let hasAny = false;
      for (let i = 0; i < 7; i++) {
        const day = isoAddDays(weekStart, i);
        const t = scopeDayTotals(scope, ledger.days?.[day]);
        if (t?.settledProfit != null && Number.isFinite(t.settledProfit)) {
          profit += t.settledProfit;
          hasAny = true;
        }
      }
      const isCurrentWeek = today >= weekStart && today <= weekEnd;
      const profitPct = hasAny ? rangeProfitPct(ledger, scope, weekStart, weekEnd) : null;
      weeks.push({
        start: weekStart,
        end: weekEnd,
        label: formatRangeLabel(weekStart, weekEnd),
        profit: hasAny ? round2(profit) : null,
        profitPct,
        isCurrentWeek,
      });
    }
    cursor.setUTCDate(cursor.getUTCDate() + 7);
  }

  const selected =
    selectedWeekStart && weeks.some((w) => w.start === selectedWeekStart)
      ? selectedWeekStart
      : weeks.find((w) => w.isCurrentWeek)?.start ?? weeks[weeks.length - 1]?.start ?? null;

  const selectedWeek = weeks.find((w) => w.start === selected) ?? null;
  let weekTotal = null;
  if (selectedWeek?.profit != null) weekTotal = selectedWeek.profit;
  else if (weeks.length) {
    const sum = weeks.reduce((s, w) => s + (w.profit ?? 0), 0);
    weekTotal = round2(sum);
  }

  return {
    scope,
    scopeLabel: scopeLabel(scope, accounts),
    period: 'week',
    month,
    weeks,
    selectedWeekStart: selected,
    weekTotal: { profit: weekTotal },
  };
}

/**
 * 年视图：ledger 内各自然年 + 投资以来合计。
 * @param {{ scope: string, accounts?: object[], now?: Date }} opts
 */
export async function buildProfitYearsAll(opts) {
  const { scope, accounts = [], now = new Date(), selectedYear = null } = opts;
  const ledger = await readProfitLedger();
  const today = beijingDateString(now);
  const currentYear = today.slice(0, 4);

  /** @type {Set<string>} */
  const yearSet = new Set([currentYear]);
  for (const day of Object.keys(ledger.days ?? {})) {
    yearSet.add(day.slice(0, 4));
  }

  /** @type {object[]} */
  const years = [...yearSet]
    .sort((a, b) => Number(a) - Number(b))
    .map((year) => {
      const from = `${year}-01-01`;
      const to = `${year}-12-31`;
      const profit = sumScopeRange(ledger, scope, from, to);
      return {
        year,
        profit,
        profitPct: profit != null ? rangeProfitPct(ledger, scope, from, to) : null,
        isCurrentYear: year === currentYear,
      };
    });

  const lifetime = years.reduce((s, y) => s + (y.profit ?? 0), 0);
  const hasAny = years.some((y) => y.profit != null);
  const firstDay = Object.keys(ledger.days ?? {}).sort()[0];
  const lastDay = Object.keys(ledger.days ?? {}).sort().pop();
  const lifetimePct =
    hasAny && firstDay && lastDay ? rangeProfitPct(ledger, scope, firstDay, lastDay) : null;
  const selected =
    selectedYear && years.some((y) => y.year === selectedYear)
      ? selectedYear
      : years.find((y) => y.isCurrentYear)?.year ?? years[years.length - 1]?.year ?? null;
  const selectedRow = years.find((y) => y.year === selected) ?? null;

  return {
    scope,
    scopeLabel: scopeLabel(scope, accounts),
    period: 'year',
    years,
    selectedYear: selected,
    yearTotal: { profit: selectedRow?.profit ?? null },
    lifetimeTotal: { profit: hasAny ? round2(lifetime) : null, profitPct: lifetimePct },
  };
}

/**
 * 区间基金明细（日/周/月）。
 * @param {{ scope: string, from: string, to: string, portfolio?: object }} opts
 */
export async function buildRangeFundDetail(opts) {
  const { scope, from, to, portfolio = null } = opts;
  const ledger = await readProfitLedger();
  const nameByCode = new Map();
  for (const f of portfolio?.funds ?? []) {
    if (scope !== 'all' && f.accountId !== scope) continue;
    nameByCode.set(f.code, f.name ?? f.code);
  }

  /** @type {Map<string, { code: string, name: string, settledProfit: number, accountId?: string }>} */
  const map = new Map();
  for (const [day, row] of Object.entries(ledger.days ?? {})) {
    if (day < from || day > to) continue;
    const funds = getDayFundDetails(ledger, scope, day);
    for (const f of funds) {
      const key = `${f.accountId ?? ''}:${f.code}`;
      const existing = map.get(key);
      if (!existing) {
        map.set(key, {
          code: f.code,
          name: nameByCode.get(f.code) ?? f.code,
          accountId: f.accountId,
          settledProfit: f.settledProfit ?? 0,
        });
      } else {
        existing.settledProfit += f.settledProfit ?? 0;
      }
    }
  }

  const funds = [...map.values()]
    .map((f) => ({ ...f, settledProfit: round2(f.settledProfit) }))
    .filter((f) => f.settledProfit !== 0)
    .sort((a, b) => b.settledProfit - a.settledProfit);

  const profit = round2(funds.reduce((s, f) => s + f.settledProfit, 0));
  return { from, to, scope, profit, funds };
}

/**
 * 周视图：以 anchor 日所在自然周（周一至周日）。
 * @deprecated 使用 buildProfitWeeksInMonth
 */
export async function buildProfitWeek(opts) {
  const { scope, anchor, accounts = [], now = new Date() } = opts;
  const ledger = await readProfitLedger();
  const today = beijingDateString(now);
  const parts = anchor.split('-').map(Number);
  const dt = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2], 12));
  const wd = dt.getUTCDay();
  const monOffset = wd === 0 ? -6 : 1 - wd;
  /** @type {string[]} */
  const weekDays = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(dt);
    d.setUTCDate(d.getUTCDate() + monOffset + i);
    weekDays.push(d.toISOString().slice(0, 10));
  }

  let weekProfit = 0;
  let hasAny = false;
  const days = weekDays.map((date) => {
    const row = ledger.days?.[date];
    const totals = scopeDayTotals(scope, row);
    const profit = totals?.settledProfit ?? null;
    if (profit != null && Number.isFinite(profit)) {
      weekProfit += profit;
      hasAny = true;
    }
    const status = dayStatus(date, today, totals);
    return {
      date,
      profit: status === 'future' ? null : profit ?? (status === 'zero' ? 0 : null),
      profitPct: totals?.settledProfitPct ?? (status === 'zero' ? 0 : null),
      status,
    };
  });

  return {
    scope,
    scopeLabel: scopeLabel(scope, accounts),
    period: 'week',
    anchor,
    weekTotal: { profit: hasAny ? Math.round(weekProfit * 100) / 100 : null },
    days,
  };
}

/**
 * 年视图：12 个月合计（period=month 对标支付宝「月」）。
 * @param {{ scope: string, year: string, accounts?: object[], now?: Date }} opts
 */
export async function buildProfitYear(opts) {
  const { scope, year, accounts = [], now = new Date(), selectedMonth = null } = opts;
  const ledger = await readProfitLedger();
  const today = beijingDateString(now);
  const currentMonth = today.slice(0, 7);
  /** @type {object[]} */
  const months = [];
  let yearProfit = 0;
  let hasAny = false;
  for (let m = 1; m <= 12; m++) {
    const month = `${year}-${String(m).padStart(2, '0')}`;
    const { start, end } = monthDateRange(month);
    const profit = sumScopeRange(ledger, scope, start, end);
    if (profit != null) {
      yearProfit += profit;
      hasAny = true;
    }
    months.push({
      month,
      profit,
      profitPct: profit != null ? rangeProfitPct(ledger, scope, start, end) : null,
      isCurrentMonth: month === currentMonth,
    });
  }
  const selected =
    selectedMonth && months.some((m) => m.month === selectedMonth)
      ? selectedMonth
      : months.find((m) => m.isCurrentMonth)?.month ?? months[months.length - 1]?.month ?? null;
  const selectedRow = months.find((m) => m.month === selected) ?? null;

  return {
    scope,
    scopeLabel: scopeLabel(scope, accounts),
    period: 'month',
    year,
    yearTotal: { profit: hasAny ? round2(yearProfit) : null },
    monthTotal: { profit: selectedRow?.profit ?? null },
    months,
    selectedMonth: selected,
  };
}

/** @param {string} day @param {string} scope */
export async function buildDayDetail(day, scope) {
  const ledger = await readProfitLedger();
  const funds = getDayFundDetails(ledger, scope, day);
  const totals = scopeDayTotals(scope, ledger.days?.[day]);
  return { date: day, scope, totals, funds };
}

export { monthFromIso };
