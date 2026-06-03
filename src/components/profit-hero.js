import { escapeHtml, pctClass } from '../format.js';
import { fmtMoney } from '../display-format.js';
import { scopeLabel } from '../accounts.js';
import { app } from '../app/context.js';

export function renderProfitHero(state) {
  const pc = state.profitCalendar;
  const data = pc.data;
  const scope = state.activeScope;
  const accounts = app().getAccounts();

  if (scope === 'summary') {
    const total = pc.summary?.portfolioMonthTotal;
    return `
      <header class="profit-hero">
        <p class="profit-hero-label">全账户本月收益</p>
        <p class="profit-hero-val ${pctClass(total)}">${total != null ? fmtMoney(total) : '—'}</p>
      </header>`;
  }

  let total = null;
  let label = scopeLabel(accounts, scope);
  if (data) {
    if (pc.period === 'year') total = data.yearTotal?.profit;
    else if (pc.period === 'week') total = data.weekTotal?.profit;
    else total = data.monthTotal?.profit;
  }

  return `
    <header class="profit-hero">
      <p class="profit-hero-label">${escapeHtml(label)} · ${pc.period === 'year' ? '本年' : pc.period === 'week' ? '本周' : '本月'}收益</p>
      <p class="profit-hero-val ${pctClass(total)}">${total != null ? fmtMoney(total) : pc.loading ? '…' : '—'}</p>
    </header>`;
}

export function patchProfitHero(state) {
  const el = document.querySelector('.profit-hero-val');
  if (!el) return;
  const pc = state.profitCalendar;
  const data = pc.data;
  let total = null;
  if (state.activeScope === 'summary') total = pc.summary?.portfolioMonthTotal;
  else if (data) {
    if (pc.period === 'year') total = data.yearTotal?.profit;
    else if (pc.period === 'week') total = data.weekTotal?.profit;
    else total = data.monthTotal?.profit;
  }
  el.textContent = total != null ? fmtMoney(total) : '—';
  el.classList.remove('is-up', 'is-down', 'is-flat');
  const cls = pctClass(total);
  if (cls) el.classList.add(cls);
}
