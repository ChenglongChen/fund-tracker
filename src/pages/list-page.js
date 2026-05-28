import { SCOPE_ALL, SCOPE_SUMMARY, buildAccountSummaries, isEditableScope } from '../accounts.js';
import { escapeHtml, fmtHeadDateLabel, pctClass } from '../format.js';
import { fmtEstimatedAssets, fmtHoldAmount, fmtMoney } from '../display-format.js';
import { visibleMetricColumns } from '../column-layout.js';
import { app } from '../app/context.js';
import { setTextClass } from '../dom.js';
import { renderShell, renderEmptyState, renderLiveBanner, patchLiveBanner, announceLiveUpdate } from '../components/shell.js';
import { renderAccountTabs } from '../components/account-tabs.js';
import {
  renderPortfolioHeader,
  patchSummaryCol,
  summaryHeroTone,
  summaryMetricByKey,
  patchAccountSummaryCards,
  renderAccountSummaryCard,
} from '../components/hero.js';
import { showIndexTicker, renderBottomChrome, renderIndexSheetMask, patchIndexTicker } from '../components/index-dock.js';
import {
  renderHoldingStackedMetricCol,
  setPctSubEl,
} from '../components/metrics.js';
import { hasRealtimeProfit } from '../components/session.js';

function orderedMetrics() {
  return visibleMetricColumns(app().state.metricColumnOrder, app().state.metricColumnVisible);
}

function isMultiAccountMergedRow(f) {
  return app().state.activeScope === SCOPE_ALL && (f.isMerged || (f.accountIds?.length ?? 0) > 1);
}

function multiAccountIconMarkup() {
  return `<svg class="holding-account-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <rect x="4" y="5" width="12" height="10" rx="2" stroke="currentColor" stroke-width="1.75"/>
    <rect x="8" y="9" width="12" height="10" rx="2" stroke="currentColor" stroke-width="1.75"/>
  </svg>`;
}

function renderMultiAccountBadge(f) {
  if (!isMultiAccountMergedRow(f)) return '';
  const ids = f.accountIds ?? [];
  if (ids.length <= 1) return '';
  const accounts = app().getAccounts();
  const title = ids.map((id) => accounts.find((a) => a.id === id)?.name ?? id).join('、');
  return `<span class="holding-account-badge" title="${escapeHtml(title)}" aria-label="多账户：${escapeHtml(title)}">${multiAccountIconMarkup()}</span>`;
}

function renderFundMetaLine(f) {
  const parts = [];
  if (app().state.nameSubline === 'amount') {
    parts.push(`<span class="holding-amount">${fmtHoldAmount(f.displayAmount ?? f.amount)}</span>`);
  }
  const badge = renderMultiAccountBadge(f);
  if (badge) parts.push(badge);
  if (!parts.length) return '';
  return `<p class="holding-meta">${parts.join('')}</p>`;
}

function portfolioGridClass() {
  const n = orderedMetrics().length;
  if (n >= 3) return 'portfolio-page--grid-4';
  if (n === 2) return 'portfolio-page--grid-3';
  if (n === 1) return 'portfolio-page--grid-2';
  return 'portfolio-page--grid-1';
}

export function listConfigIconMarkup() {
  return `<svg class="list-head-config-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z" stroke="currentColor" stroke-width="1.75"/>
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`;
}

export function fundMetricCells(f, key) {
  const rtCls = pctClass(hasRealtimeProfit(f) ? f.realTimeProfit : null);
  const stCls = pctClass(f.settledProfit);
  const thCls = pctClass(f.totalProfit);
  switch (key) {
    case 'realtime':
      return renderHoldingStackedMetricCol({
        colClass: 'holding-col--rt',
        dataCol: 'realtime',
        amount: hasRealtimeProfit(f) ? f.realTimeProfit : null,
        pct: hasRealtimeProfit(f) ? f.realTimePct : null,
        amountCls: rtCls,
      });
    case 'daily': {
      const pending = f.dailyPending;
      const stCls = pctClass(pending ? null : f.settledProfit);
      return renderHoldingStackedMetricCol({
        colClass: 'holding-col--settled',
        dataCol: 'daily',
        amount: pending ? null : f.settledProfit,
        pct: pending ? null : f.settledPct,
        amountCls: stCls,
      });
    }
    case 'holding':
      return renderHoldingStackedMetricCol({
        colClass: 'holding-col--total',
        dataCol: 'holding',
        amount: f.totalProfit,
        pct: f.totalProfitPct,
        amountCls: thCls,
      });
    default:
      return '';
  }
}

export function renderHeadDateBlock(col) {
  const head = app().state.displayContext?.tableHead?.[col];
  const label = fmtHeadDateLabel(head?.label ?? head?.line1 ?? '');
  if (!label) return '';
  return `<span class="list-table-head-date-text">${escapeHtml(label)}</span>`;
}

export function renderHeadSortArrows(sortKey, activeKey = app().state.sortKey, sortDir = app().state.sortDir) {
  const isActive = activeKey === sortKey;
  const ascOn = isActive && sortDir === 'asc';
  const descOn = isActive && sortDir === 'desc';
  return `
    <span class="list-table-head-sort-arrows" aria-hidden="true">
      <span class="sort-arrow sort-arrow--up${ascOn ? ' is-on' : ''}"></span>
      <span class="sort-arrow sort-arrow--down${descOn ? ' is-on' : ''}"></span>
    </span>`;
}

export function sortIndicator(key) {
  return renderHeadSortArrows(key);
}

export function renderHeadSortCol(title, sortKey, dateCol = null) {
  const active = app().state.sortKey === sortKey ? ' is-active' : '';
  const dateHtml = dateCol ? renderHeadDateBlock(dateCol) : '';
  const left = sortKey === 'amount' ? ' list-table-head-sort--left' : '';
  const ariaSort =
    app().state.sortKey === sortKey ? (app().state.sortDir === 'asc' ? 'ascending' : 'descending') : 'none';
  return `
    <button type="button" class="list-table-head-col list-table-head-sort${left}${active}" data-sort-key="${sortKey}" aria-sort="${ariaSort}">
      <span class="list-table-head-label">
        <span class="list-table-head-title">${title}</span>
        ${dateHtml ? `<span class="list-table-head-date">${dateHtml}</span>` : ''}
      </span>
      ${renderHeadSortArrows(sortKey)}
    </button>`;
}

export function renderListTableHead() {
  const metricHeads = orderedMetrics()
    .map((col) => renderHeadSortCol(col.title, col.key, col.dateCol))
    .join('');
  const configBtn = isEditableScope(app().state.activeScope)
    ? `<button type="button" class="list-head-config" id="btn-list-config" title="列表配置" aria-label="列表配置">${listConfigIconMarkup()}</button>`
    : `<span class="list-head-config-spacer" aria-hidden="true"></span>`;
  return `
    <div class="list-table-head">
      <div class="list-table-head-first">
        ${configBtn}
        ${renderHeadSortCol('持仓', 'amount')}
      </div>
      ${metricHeads}
    </div>`;
}

function rowDetailScope(f) {
  if (app().state.activeScope === SCOPE_SUMMARY) return SCOPE_SUMMARY;
  if (app().state.activeScope === SCOPE_ALL && isMultiAccountMergedRow(f)) return SCOPE_SUMMARY;
  return f.accountId ?? app().state.activeScope;
}

export function renderFundRow(f) {
  const metricCols = orderedMetrics().map((col) => fundMetricCells(f, col.key)).join('');
  const metaHtml = renderFundMetaLine(f);
  const detailScope = rowDetailScope(f);
  return `
    <button type="button" class="holding-row" data-fund-id="${f.id}" data-fund-code="${escapeHtml(f.code)}" data-fund-scope="${escapeHtml(detailScope)}">
      <div class="holding-col holding-col--name">
        <p class="holding-name">${escapeHtml(f.name)}</p>
        ${metaHtml}
      </div>
      ${metricCols}
      <span class="holding-chevron" aria-hidden="true">›</span>
    </button>`;
}

export function patchRealtimeMetricCell(cell, f) {
  if (!cell) return false;
  const valEl = cell.querySelector('.holding-val');
  const subEl = cell.querySelector('.holding-sub');
  if (!valEl && !subEl) return false;
  const cls = pctClass(hasRealtimeProfit(f) ? f.realTimeProfit : null);
  if (valEl) {
    valEl.textContent = fmtMoney(hasRealtimeProfit(f) ? f.realTimeProfit : null, true);
    setTextClass(valEl, cls);
  }
  if (subEl) setPctSubEl(subEl, hasRealtimeProfit(f) ? f.realTimePct : null);
  return true;
}

export function patchListDom() {
  const s = app().state.summary;
  if (!s) return false;

  if (!document.querySelector('.yj-summary-grid')) return false;

  patchSummaryCol('assets', {
    val: s.settledAssets,
    subText: fmtEstimatedAssets(s.realtimeAssets),
    subMuted: true,
  });
  for (const col of orderedMetrics()) {
    const m = summaryMetricByKey(s, col.key);
    if (!m) continue;
    patchSummaryCol(col.key, {
      val: m.val,
      pct: m.pct,
      signed: m.signed,
      dateCol: col.dateCol,
      summary: col.key === 'realtime' ? s : null,
    });
  }

  const hero = document.querySelector('.yj-summary--hero');
  if (hero) {
    hero.classList.remove('is-up', 'is-down', 'is-flat');
    hero.classList.add(summaryHeroTone(s));
  }

  const tableHead = app().state.displayContext?.tableHead;
  if (tableHead) {
    for (const col of orderedMetrics()) {
      const headCol = col.dateCol || col.key;
      const label = fmtHeadDateLabel(tableHead[headCol]?.label ?? tableHead[headCol]?.line1 ?? '');
      const btn = document.querySelector(`.list-table-head-sort[data-sort-key="${col.key}"] .list-table-head-date`);
      if (btn) {
        btn.innerHTML = label
          ? `<span class="list-table-head-date-text">${escapeHtml(label)}</span>`
          : '';
      }
    }
  }

  reorderListRows();

  patchLiveBanner();
  announceLiveUpdate();

  if (app().state.activeScope === SCOPE_SUMMARY) {
    patchIndexTicker();
    return patchAccountSummaryCards();
  }

  for (const f of app().state.displayRows) {
    const row = document.querySelector(`.holding-row[data-fund-id="${f.id}"]`);
    if (!row) return false;

    const amountEl = row.querySelector('.holding-amount');
    if (amountEl && app().state.nameSubline === 'amount') {
      amountEl.textContent = fmtHoldAmount(f.displayAmount ?? f.amount);
    }

    for (const col of orderedMetrics()) {
      const cell = row.querySelector(`[data-col="${col.key}"]`);
      if (!cell) continue;
      const valEl = cell.querySelector('.holding-val');
      const subEl = cell.querySelector('.holding-sub');
      if (col.key === 'realtime') {
        if (!patchRealtimeMetricCell(cell, f)) return false;
      } else if (col.key === 'daily') {
        const pending = f.dailyPending;
        const cls = pctClass(pending ? null : f.settledProfit);
        if (valEl) {
          valEl.textContent = fmtMoney(pending ? null : f.settledProfit, true);
          setTextClass(valEl, cls);
        }
        if (subEl) setPctSubEl(subEl, pending ? null : f.settledPct);
      } else if (col.key === 'holding') {
        const cls = pctClass(f.totalProfit);
        if (valEl) {
          valEl.textContent = fmtMoney(f.totalProfit, true);
          setTextClass(valEl, cls);
        }
        if (subEl) setPctSubEl(subEl, f.totalProfitPct);
      }
    }
  }

  patchIndexTicker();
  return true;
}

export function reorderListRows() {
  const list = document.querySelector('.holding-list');
  if (!list) return;
  for (const f of app().state.displayRows) {
    const row = list.querySelector(`.holding-row[data-fund-id="${f.id}"]`);
    if (row) list.appendChild(row);
  }
}

export function canPatchListDom() {
  if (app().state.view !== 'list') return false;
  if (app().state.activeScope === SCOPE_SUMMARY) {
    return document.querySelectorAll('.account-summary-card[data-account-id]').length > 0;
  }
  const rows = document.querySelectorAll('.holding-row[data-fund-id]');
  if (rows.length === 0 || rows.length !== app().state.displayRows.length) return false;
  for (const f of app().state.displayRows) {
    const row = document.querySelector(`.holding-row[data-fund-id="${f.id}"]`);
    if (!row) return false;
  }
  return true;
}

export function renderListPage() {
  const gridClass = portfolioGridClass();
  const dockClass = showIndexTicker() ? ' has-index-dock' : '';
  const sheetClass = app().state.indexDrawerOpen && showIndexTicker() ? ' index-sheet-open' : '';
  const indexMask = showIndexTicker() ? renderIndexSheetMask() : '';
  const scopeTabId = `account-tab-${app().state.activeScope}`;

  if (app().state.activeScope === SCOPE_SUMMARY) {
    const cards = buildAccountSummaries(app().state.fundRows, app().getAccounts())
      .map((acc) => renderAccountSummaryCard(acc))
      .join('');
    const listBody =
      cards ||
      renderEmptyState({
        title: '暂无账户持仓',
        hint: '添加基金后可在此查看各账户概况',
      });
    return renderShell(
      `
      <section class="portfolio-page portfolio-page--summary has-bottom-nav${dockClass}${sheetClass} ${gridClass}">
        <div class="portfolio-sticky">
          ${renderAccountTabs()}
          ${renderLiveBanner()}
          ${renderPortfolioHeader()}
        </div>
        <div class="holding-list-scroll" id="holding-list-scroll" role="tabpanel" aria-labelledby="${scopeTabId}">
          <section class="account-summary-list">${listBody}</section>
        </div>
        ${indexMask}
        ${renderBottomChrome()}
      </section>`,
    );
  }

  const rows = app().state.displayRows.map((f) => renderFundRow(f)).join('');
  const listBody =
    rows ||
    renderEmptyState({
      title: '暂无持仓',
      hint: isEditableScope(app().state.activeScope) ? '可在列表配置中添加基金' : '该视图暂无基金数据',
      actionId: isEditableScope(app().state.activeScope) ? 'btn-empty-add-fund' : '',
      actionLabel: isEditableScope(app().state.activeScope) ? '添加基金' : '',
    });
  return renderShell(
    `
    <section class="portfolio-page has-bottom-nav${dockClass}${sheetClass} ${gridClass}">
      <div class="portfolio-sticky">
        ${renderAccountTabs()}
        ${renderLiveBanner()}
        ${renderPortfolioHeader()}
        ${renderListTableHead()}
      </div>
      <div class="holding-list-scroll" id="holding-list-scroll" role="tabpanel" aria-labelledby="${scopeTabId}">
        <section class="holding-list">${listBody}</section>
      </div>
      ${indexMask}
      ${renderBottomChrome()}
    </section>`,
  );
}
