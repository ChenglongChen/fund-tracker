import { SCOPE_SUMMARY } from '../accounts.js';
import { app } from '../app/context.js';
import { renderShell, renderEmptyState } from '../components/shell.js';
import { renderAccountTabs } from '../components/account-tabs.js';
import { renderBottomChrome } from '../components/index-dock.js';
import {
  renderProfitCard,
  renderProfitFundList,
  renderProfitSummaryCards,
  patchProfitCalendarCells,
} from '../components/profit-calendar.js';

export function renderProfitPage() {
  const state = app().state;
  const pc = state.profitCalendar;
  const isSummary = state.activeScope === SCOPE_SUMMARY;
  const scopeTabId = `account-tab-${state.activeScope}`;

  let inner = '';
  if (pc.error) {
    inner = `<p class="profit-error" role="alert">${pc.error}</p>`;
  } else if (pc.loading && !pc.data && !pc.summary) {
    inner = '<div class="profit-skeleton"><p class="profit-loading">加载收益日历…</p></div>';
  } else if (isSummary) {
    inner = `<div class="profit-summary-wrap"><div class="profit-summary-list">${renderProfitSummaryCards(pc.summary)}</div></div>`;
  } else if (pc.data) {
    inner = `
      ${renderProfitCard(pc.data, state)}
      ${renderProfitFundList(state)}`;
  } else {
    inner = renderEmptyState({
      title: '暂无收益数据',
      hint: '净值入账后将自动记录；首次启动会自动回填近 90 天。',
    });
  }

  return renderShell(
    `
    <section class="portfolio-page profit-page has-bottom-nav">
      <div class="portfolio-sticky">
        ${renderAccountTabs()}
      </div>
      <div class="holding-list-scroll tab-scroll profit-page-scroll" id="profit-page-scroll" role="tabpanel" aria-labelledby="${scopeTabId}">
        <div class="profit-page-content">${inner}</div>
      </div>
      ${renderBottomChrome()}
    </section>`,
  );
}

export function canPatchProfitDom() {
  return !!document.querySelector('.profit-page');
}

export function patchProfitDom() {
  const state = app().state;
  if (state.profitCalendar.data) {
    patchProfitCalendarCells(state.profitCalendar.data, state);
  }
}
