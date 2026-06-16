import { escapeHtml, fmtPct, pctClass, fmtMoneyRaw } from '../format.js';
import { fmtMoney } from '../display-format.js';
import { app } from '../app/context.js';
import { monthMeta, weekdayFromIso, sparklinePath } from '../profit-calendar-view-model.js';
import { scopeLabel } from '../accounts.js';

const WEEK_LABELS = ['日', '一', '二', '三', '四', '五', '六'];
const PERIOD_TABS = [
  { id: 'day', label: '日' },
  { id: 'week', label: '周' },
  { id: 'month', label: '月' },
  { id: 'year', label: '年' },
];

function fmtProfitVal(v, unit = 'amount') {
  if (v == null || !Number.isFinite(Number(v))) return '—';
  if (app().state.hideAssets) return '****';
  if (unit === 'pct') return fmtPct(v);
  return fmtMoneyRaw(v, true);
}

function fmtProfitCompact(v) {
  if (v == null || !Number.isFinite(Number(v))) return '0.00';
  if (app().state.hideAssets) return '****';
  const n = Number(v);
  const abs = Math.abs(n);
  const sign = n > 0 ? '+' : n < 0 ? '' : '';
  if (abs >= 10000) return `${sign}${(n / 10000).toFixed(2)}万`;
  return fmtMoneyRaw(n, true);
}

function dayToneValue(day, unit = 'amount') {
  if (unit === 'pct' && day.profitPct != null && Number.isFinite(day.profitPct)) return day.profitPct;
  return day.profit;
}

function formatRangeValue(profit, profitPct, unit) {
  if (unit === 'pct') {
    if (profitPct != null && Number.isFinite(profitPct)) return fmtPct(profitPct);
    if (profit === 0) return '0.00%';
    return '—';
  }
  if (profit != null && profit !== 0) return fmtProfitCompact(profit);
  if (profit === 0) return '0.00';
  return '—';
}

/** 日视图格子：选中态按涨跌着色；非交易日 / 未来置灰。 */
function dayCellToneClass(day, { selected = false, unit = 'amount' } = {}) {
  const toneVal = dayToneValue(day, unit);
  if (selected) {
    if (toneVal != null && toneVal < 0) return 'is-selected is-down';
    if (toneVal != null && toneVal > 0) return 'is-selected is-up';
    return 'is-selected is-flat';
  }
  if (day.status === 'future' || day.status === 'off') return 'is-muted';
  if (day.status === 'pending') return 'is-pending';
  if (toneVal == null || toneVal === 0) return 'is-zero';
  return pctClass(toneVal);
}

function navTitle(state, data) {
  const pc = state.profitCalendar;
  const period = pc.period ?? 'day';
  if (period === 'year') return '投资以来';
  if (period === 'month') return `${data?.year ?? pc.month.slice(0, 4)}年`;
  return monthMeta(pc.month).label;
}

function rangeCardToneClass(v, profitPct, unit, { selected = false } = {}) {
  const toneVal = unit === 'pct' ? profitPct : v;
  if (selected) {
    if (toneVal != null && toneVal < 0) return 'is-selected is-down';
    if (toneVal != null && toneVal > 0) return 'is-selected is-up';
    return 'is-selected is-flat';
  }
  if (toneVal == null) return v == null && profitPct == null ? 'is-muted' : 'is-zero';
  if (toneVal === 0) return 'is-zero';
  return pctClass(toneVal);
}

function renderToolbar(state) {
  const pc = state.profitCalendar;
  const period = pc.period ?? 'day';
  const tabs = PERIOD_TABS.map(
    (t) =>
      `<button type="button" class="profit-tab${period === t.id ? ' is-active' : ''}" data-profit-period="${t.id}">${t.label}</button>`,
  ).join('');

  return `
    <div class="profit-card-toolbar">
      <div class="profit-card-tabs" role="tablist">${tabs}</div>
    </div>
    <div class="profit-card-nav">
      <button type="button" class="profit-nav profit-nav--prev" data-profit-nav="prev" aria-label="上一页">‹</button>
      <span class="profit-card-nav-title">${escapeHtml(navTitle(state, pc.data))}</span>
      <button type="button" class="profit-nav profit-nav--next" data-profit-nav="next" aria-label="下一页">›</button>
      <div class="profit-card-units">
        <button type="button" class="profit-unit${pc.unit === 'amount' ? ' is-active' : ''}" data-profit-unit="amount">¥</button>
        <button type="button" class="profit-unit${pc.unit === 'pct' ? ' is-active' : ''}" data-profit-unit="pct">%</button>
      </div>
    </div>`;
}

function dayCellText(day, unit) {
  if (day.status === 'future' || day.status === 'off') return '';
  if (day.status === 'pending') return '未更新';
  if (unit === 'pct') {
    if (day.profitPct != null && Number.isFinite(day.profitPct)) return fmtPct(day.profitPct);
    return day.status === 'zero' ? '0.00%' : '—';
  }
  if (day.profit == null) return day.status === 'zero' ? '0.00' : '';
  return fmtProfitCompact(day.profit);
}

function renderDayGrid(data, state) {
  const pc = state.profitCalendar;
  const unit = pc.unit ?? 'amount';
  const selectedDay = pc.selectedDay ?? data.selectedDay;
  const { month } = data;
  const monthDays = data.days ?? [];
  const first = `${month}-01`;
  const pad = weekdayFromIso(first);
  const dayMap = new Map(monthDays.map((d) => [d.date, d]));
  const lastDay = monthDays.filter((d) => d.date.startsWith(month)).length;
  const today = data.days.find((d) => d.status === 'pending')?.date?.slice(8);

  /** @type {string[]} */
  const cells = [];
  for (let i = 0; i < pad; i++) {
    cells.push('<div class="profit-day-cell profit-day-cell--pad" aria-hidden="true"></div>');
  }
  for (let d = 1; d <= lastDay; d++) {
    const iso = `${month}-${String(d).padStart(2, '0')}`;
    const day = dayMap.get(iso) ?? { date: iso, status: 'zero', profit: 0 };
    const selected = iso === selectedDay;
    const isToday = day.status === 'pending';
    const cls = dayCellToneClass(day, { selected, unit });
    const label = dayCellText(day, unit);
    const sub = isToday ? '<span class="profit-day-tag">今</span>' : '';
    cells.push(`
      <button type="button" class="profit-day-cell ${cls}" data-profit-day="${iso}" aria-pressed="${selected ? 'true' : 'false'}">
        <span class="profit-day-num">${d}${sub}</span>
        <span class="profit-day-amt">${escapeHtml(label)}</span>
      </button>`);
  }

  const head = WEEK_LABELS.map((l) => `<span class="profit-weekhead">${l}</span>`).join('');
  return `
    <div class="profit-weekhead-row">${head}</div>
    <div class="profit-day-grid">${cells.join('')}</div>`;
}

function renderWeekCards(data, state) {
  const pc = state.profitCalendar;
  const unit = pc.unit ?? 'amount';
  const selected = pc.selectedWeekStart ?? data.selectedWeekStart;
  return (data.weeks ?? [])
    .map((w) => {
      const isSel = w.start === selected;
      const isCurrent = w.isCurrentWeek;
      const cls = rangeCardToneClass(w.profit, w.profitPct, unit, { selected: isSel });
      const currentCls = isCurrent && !isSel ? ' is-current' : '';
      const badge = isCurrent ? '<span class="profit-range-badge">本周</span>' : '';
      const val = formatRangeValue(w.profit, w.profitPct, unit);
      return `
      <button type="button" class="profit-range-card ${cls}${currentCls}" data-profit-week="${w.start}" data-profit-week-end="${w.end}" aria-pressed="${isSel ? 'true' : 'false'}">
        ${badge}
        <span class="profit-range-label">${escapeHtml(w.label)}</span>
        <span class="profit-range-val">${escapeHtml(val)}</span>
      </button>`;
    })
    .join('');
}

function renderMonthCards(data, state) {
  const pc = state.profitCalendar;
  const unit = pc.unit ?? 'amount';
  const selected =
    pc.selectedMonth ?? data.selectedMonth ?? data.months?.find((m) => m.isCurrentMonth)?.month ?? null;
  return (data.months ?? [])
    .map((m) => {
      const num = parseInt(m.month.slice(5), 10);
      const isCurrent = m.isCurrentMonth;
      const isSel = m.month === selected;
      const cls = rangeCardToneClass(m.profit, m.profitPct, unit, { selected: isSel });
      const currentCls = isCurrent && !isSel ? ' is-current' : '';
      const badge = isCurrent ? '<span class="profit-range-badge">本月</span>' : '';
      const val = formatRangeValue(m.profit, m.profitPct, unit);
      return `
      <button type="button" class="profit-range-card profit-range-card--month ${cls}${currentCls}" data-profit-month="${m.month}" aria-pressed="${isSel ? 'true' : 'false'}">
        ${badge}
        <span class="profit-range-label">${num}月</span>
        <span class="profit-range-val">${escapeHtml(val)}</span>
      </button>`;
    })
    .join('');
}

function renderYearCards(data, state) {
  const pc = state.profitCalendar;
  const unit = pc.unit ?? 'amount';
  const selected =
    pc.selectedYear ?? data.selectedYear ?? data.years?.find((y) => y.isCurrentYear)?.year ?? null;
  const cards = (data.years ?? [])
    .map((y) => {
      const isCurrent = y.isCurrentYear;
      const isSel = y.year === selected;
      const cls = rangeCardToneClass(y.profit, y.profitPct, unit, { selected: isSel });
      const currentCls = isCurrent && !isSel ? ' is-current' : '';
      const badge = isCurrent ? '<span class="profit-range-badge">本年</span>' : '';
      const val = formatRangeValue(y.profit, y.profitPct, unit);
      return `
      <button type="button" class="profit-range-card profit-range-card--year ${cls}${currentCls}" data-profit-year="${y.year}" aria-pressed="${isSel ? 'true' : 'false'}">
        ${badge}
        <span class="profit-range-label">${y.year}</span>
        <span class="profit-range-val">${escapeHtml(val)}</span>
      </button>`;
    })
    .join('');

  const lifetime = data.lifetimeTotal?.profit;
  const lifePct = data.lifetimeTotal?.profitPct;
  const lifeVal = formatRangeValue(lifetime, lifePct, unit);
  const lifeTone = unit === 'pct' ? lifePct : lifetime;
  return `
    <div class="profit-lifetime">
      <span class="profit-lifetime-label">投资以来</span>
      <span class="profit-lifetime-val ${pctClass(lifeTone)}">${escapeHtml(lifeVal)}</span>
    </div>
    <div class="profit-year-grid">${cards}</div>
    <p class="profit-year-note">数据展示范围以入账记录为准，合计可能与账户总收益存在口径差异</p>`;
}

export function renderProfitCalendarBody(data, state) {
  const period = state.profitCalendar.period ?? 'day';
  const dataPeriod = data?.period ?? 'day';
  if (dataPeriod !== period) {
    return '<p class="profit-loading">加载收益日历…</p>';
  }
  if (period === 'week') {
    return `<div class="profit-range-grid profit-range-grid--week">${renderWeekCards(data, state)}</div>`;
  }
  if (period === 'month') {
    return `<div class="profit-range-grid profit-range-grid--month">${renderMonthCards(data, state)}</div>`;
  }
  if (period === 'year') {
    return renderYearCards(data, state);
  }
  return renderDayGrid(data, state);
}

export function renderProfitCard(data, state) {
  const accounts = app().getAccounts();
  const scopeName = scopeLabel(accounts, state.activeScope);

  return `
    <article class="profit-card">
      <header class="profit-card-header">
        <h2 class="profit-card-title">收益日历</h2>
        <p class="profit-card-scope">${escapeHtml(scopeName)}</p>
      </header>
      ${renderToolbar(state)}
      <div class="profit-card-body">
        ${renderProfitCalendarBody(data, state)}
      </div>
    </article>`;
}

function detailTitle(state) {
  const pc = state.profitCalendar;
  const period = pc.period ?? 'day';
  const detail = pc.rangeDetail;
  if (period === 'day' && pc.selectedDay) {
    return `当日收益明细（${pc.selectedDay.replace(/-/g, '.')}）`;
  }
  if (period === 'week' && detail?.from) {
    return `当周收益明细（${detail.from.slice(5).replace('-', '.')}-${detail.to.slice(5).replace('-', '.')}）`;
  }
  if (period === 'month') {
    const m = pc.selectedMonth ?? pc.data?.selectedMonth ?? pc.month;
    return `当月收益明细（${m.replace('-', '.')}）`;
  }
  if (period === 'year') {
    const y = pc.selectedYear ?? pc.data?.selectedYear;
    return y ? `当年收益明细（${y}）` : '收益明细（投资以来）';
  }
  return '收益明细';
}

export function renderProfitFundList(state) {
  const detail = state.profitCalendar.rangeDetail;
  const funds = detail?.funds ?? [];
  if (!funds.length) {
    return `
      <section class="profit-detail-section">
        <header class="profit-detail-head">
          <h3 class="profit-detail-title">${escapeHtml(detailTitle(state))}</h3>
        </header>
        <p class="profit-detail-empty">该时段暂无入账记录</p>
      </section>`;
  }

  const sortAsc = state.profitCalendar.fundSortAsc;
  const sorted = [...funds].sort((a, b) =>
    sortAsc ? a.settledProfit - b.settledProfit : b.settledProfit - a.settledProfit,
  );

  const rows = sorted
    .map(
      (f) => `
    <div class="profit-fund-row">
      <div class="profit-fund-meta">
        <p class="profit-fund-name">基金｜${escapeHtml(f.name ?? f.code)}</p>
        <p class="profit-fund-sub">${escapeHtml(f.code)}</p>
      </div>
      <p class="profit-fund-val ${pctClass(f.settledProfit)}">${fmtMoney(f.settledProfit)}</p>
    </div>`,
    )
    .join('');

  return `
    <section class="profit-detail-section">
      <header class="profit-detail-head">
        <h3 class="profit-detail-title">${escapeHtml(detailTitle(state))}</h3>
        <button type="button" class="profit-detail-sort" data-profit-sort-toggle aria-label="盈亏排序">
          盈亏排序 ${sortAsc ? '↑' : '↓'}
        </button>
      </header>
      <div class="profit-fund-list">${rows}</div>
    </section>`;
}

function resolvePortfolioSummary(summary) {
  if (summary?.portfolio?.accountId) return summary.portfolio;
  const accounts = summary?.accounts ?? [];
  const monthFromAccounts = accounts.reduce((s, a) => s + (a.monthProfit ?? 0), 0);
  const monthProfit =
    summary?.portfolioMonthTotal ??
    (accounts.length ? Math.round(monthFromAccounts * 100) / 100 : null);
  /** @type {{ date: string, profit: number } | null} */
  let last = null;
  for (const acc of accounts) {
    if (!acc.lastDay) continue;
    if (!last || acc.lastDay > last.date) {
      last = { date: acc.lastDay, profit: acc.lastDayProfit ?? 0 };
    }
  }
  if (monthProfit == null && !last) return null;
  return {
    accountId: 'all',
    name: '全部持仓',
    monthProfit,
    monthProfitPct: summary?.portfolio?.monthProfitPct ?? null,
    lastDay: summary?.portfolio?.lastDay ?? last?.date ?? null,
    lastDayProfit: summary?.portfolio?.lastDayProfit ?? last?.profit ?? null,
    sparkline: summary?.portfolio?.sparkline ?? [],
  };
}

function renderProfitAccountCard(acc) {
  const sparkW = 160;
  const sparkH = 40;
  const path = sparklinePath(acc.sparkline ?? [], sparkW, sparkH);
  const sparkTone = pctClass(acc.monthProfit);
  const spark =
    path &&
    `<div class="profit-account-spark-wrap"><svg class="profit-spark ${sparkTone}" viewBox="0 0 ${sparkW} ${sparkH}" preserveAspectRatio="none" aria-hidden="true"><path d="${path}" fill="none" stroke="currentColor" stroke-width="1.5" vector-effect="non-scaling-stroke"/></svg></div>`;
  const monthPct =
    acc.monthProfitPct != null && Number.isFinite(acc.monthProfitPct)
      ? `<span class="profit-account-pct ${pctClass(acc.monthProfitPct)}">${fmtPct(acc.monthProfitPct)}</span>`
      : '';
  const lastProfit =
    acc.lastDayProfit != null && Number.isFinite(acc.lastDayProfit)
      ? ` ${fmtMoney(acc.lastDayProfit)}`
      : '';
  return `
    <button type="button" class="profit-account-card" data-profit-account="${escapeHtml(acc.accountId)}">
      <div class="profit-account-card-body">
        <p class="profit-account-name">${escapeHtml(acc.name)}</p>
        <p class="profit-account-month-row">
          <span class="profit-account-month ${pctClass(acc.monthProfit)}">${acc.monthProfit != null ? fmtMoney(acc.monthProfit) : '—'}</span>
          ${monthPct}
        </p>
        <p class="profit-account-sub">本月 · 最近 ${acc.lastDay?.slice(5) ?? '—'}${lastProfit}</p>
      </div>
      ${spark || ''}
    </button>`;
}

export function renderProfitSummaryCards(summary) {
  const portfolio = resolvePortfolioSummary(summary);
  const accounts = summary?.accounts ?? [];
  const cards = [];
  if (portfolio) cards.push(renderProfitAccountCard(portfolio));
  for (const acc of accounts) {
    cards.push(renderProfitAccountCard(acc));
  }
  if (!cards.length) {
    return '<p class="profit-empty">暂无收益记录，入账或运行回填后将显示日历。</p>';
  }
  return cards.join('');
}

export function patchProfitToolbar(state) {
  const pc = state.profitCalendar;
  const unit = pc.unit ?? 'amount';
  document.querySelectorAll('[data-profit-unit]').forEach((btn) => {
    const u = btn.getAttribute('data-profit-unit');
    btn.classList.toggle('is-active', u === unit);
  });
}

export function patchProfitCalendarCells(data, state) {
  const pc = state.profitCalendar;
  const unit = pc.unit ?? 'amount';
  const selectedDay = pc.selectedDay ?? data?.selectedDay;
  patchProfitToolbar(state);
  document.querySelectorAll('[data-profit-day]').forEach((btn) => {
    const iso = btn.getAttribute('data-profit-day');
    const day = data?.days?.find((d) => d.date === iso);
    if (!day) return;
    btn.classList.toggle('is-selected', iso === selectedDay);
    btn.setAttribute('aria-pressed', iso === selectedDay ? 'true' : 'false');
    const valEl = btn.querySelector('.profit-day-amt');
    if (valEl) valEl.textContent = dayCellText(day, unit);
    btn.classList.remove('is-up', 'is-down', 'is-flat', 'is-zero', 'is-selected', 'is-muted', 'is-pending');
    btn.classList.add(dayCellToneClass(day, { selected: iso === selectedDay, unit }));
  });
}
