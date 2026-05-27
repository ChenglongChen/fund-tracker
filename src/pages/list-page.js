import { SCOPE_SUMMARY, buildAccountSummaries, isEditableScope } from '../accounts.js';
import { escapeHtml, pctClass } from '../format.js';
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
import { patchStatusStripTimes } from '../components/status.js';
import { showIndexTicker, renderBottomChrome, renderIndexSheetMask, patchIndexTicker } from '../components/index-dock.js';
import {
  combinedImpactTooltip,
  renderHoldingStackedMetricCol,
  renderRealtimeSplitRow,
  setPctSubEl,
} from '../components/metrics.js';
import { extendedSessionLabel, hasExtendedRealtimeLayout, hasRealtimeProfit } from '../components/session.js';

function orderedMetrics() {
  return visibleMetricColumns(app().state.metricColumnOrder, app().state.metricColumnVisible);
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
      if (hasExtendedRealtimeLayout(f)) {
        const regularProfit =
          f.realTimeProfitRegular != null && Number.isFinite(f.realTimeProfitRegular)
            ? f.realTimeProfitRegular
            : 0;
        const regularPct =
          f.realTimePctRegular != null && Number.isFinite(f.realTimePctRegular)
            ? f.realTimePctRegular
            : 0;
        const extProfit = f.realTimeProfitExtended ?? 0;
        const extPct = f.impactPctExtended ?? 0;
        return `
      <div class="holding-col holding-col--rt holding-col--split" data-col="realtime" title="${escapeHtml(combinedImpactTooltip(f))}">
        ${renderRealtimeSplitRow(regularProfit, regularPct)}
        ${renderRealtimeSplitRow(extProfit, extPct, { tag: extendedSessionLabel(f.impactSession) })}
      </div>`;
      }
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
  const label = head?.label ?? head?.line1 ?? '';
  if (!label) return '';
  return `<span class="list-table-head-date-text">${escapeHtml(label)}</span>`;
}

export function sortIndicator(key) {
  if (app().state.sortKey !== key) return '<span class="sort-indicator" aria-hidden="true"></span>';
  return `<span class="sort-indicator sort-indicator--on" aria-hidden="true">${app().state.sortDir === 'asc' ? '↑' : '↓'}</span>`;
}

export function renderHeadSortCol(title, sortKey, dateCol = null) {
  const active = app().state.sortKey === sortKey ? ' is-active' : '';
  const dateHtml = dateCol ? renderHeadDateBlock(dateCol) : '';
  const left = sortKey === 'amount' ? ' list-table-head-sort--left' : '';
  const ariaSort =
    app().state.sortKey === sortKey ? (app().state.sortDir === 'asc' ? 'ascending' : 'descending') : 'none';
  return `
    <button type="button" class="list-table-head-col list-table-head-sort${left}${active}" data-sort-key="${sortKey}" aria-sort="${ariaSort}">
      <span class="list-table-head-title">${title}${sortIndicator(sortKey)}</span>
      ${dateHtml ? `<span class="list-table-head-date">${dateHtml}</span>` : ''}
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

export function renderFundRow(f) {
  const metricCols = orderedMetrics().map((col) => fundMetricCells(f, col.key)).join('');
  const metaLine =
    app().state.nameSubline === 'amount'
      ? `<span class="holding-amount">${fmtHoldAmount(f.displayAmount ?? f.amount)}</span>`
      : '';
  const metaHtml = metaLine ? `<p class="holding-meta">${metaLine}</p>` : '';
  return `
    <button type="button" class="holding-row" data-fund-id="${f.id}">
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
  const wantsSplit = hasExtendedRealtimeLayout(f);
  const hasSplit = cell.classList.contains('holding-col--split');
  if (wantsSplit !== hasSplit) {
    const wrapper = document.createElement('div');
    wrapper.innerHTML = fundMetricCells(f, 'realtime').trim();
    const fresh = wrapper.firstElementChild;
    if (!fresh) return false;
    cell.replaceWith(fresh);
    return true;
  }
  if (wantsSplit) {
    const splitRows = cell.querySelectorAll('.metric-split-row');
    if (splitRows.length < 2) return false;
    const regularProfit =
      f.realTimeProfitRegular != null && Number.isFinite(f.realTimeProfitRegular)
        ? f.realTimeProfitRegular
        : 0;
    const regularPct =
      f.realTimePctRegular != null && Number.isFinite(f.realTimePctRegular) ? f.realTimePctRegular : 0;
    const extProfit = f.realTimeProfitExtended ?? 0;
    const extPct = f.impactPctExtended ?? 0;
    const patchSplitRow = (rowEl, val, pct, signed = true) => {
      const cls = pctClass(signed ? val : pct);
      const valEl = rowEl.querySelector('.holding-val');
      const subEl = rowEl.querySelector('.holding-sub');
      if (valEl) {
        valEl.textContent = fmtMoney(val, signed);
        setTextClass(valEl, cls);
      }
      if (subEl) setPctSubEl(subEl, pct);
    };
    patchSplitRow(splitRows[0], regularProfit, regularPct);
    patchSplitRow(splitRows[1], extProfit, extPct);
    cell.title = combinedImpactTooltip(f);
    return true;
  }

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
      const label = tableHead[headCol]?.label ?? tableHead[headCol]?.line1 ?? '';
      const btn = document.querySelector(`.list-table-head-sort[data-sort-key="${col.key}"] .list-table-head-date`);
      if (btn) {
        btn.innerHTML = label
          ? `<span class="list-table-head-date-text">${escapeHtml(label)}</span>`
          : '';
      }
    }
  }

  reorderListRows();

  patchStatusStripTimes();
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
      <section class="portfolio-page portfolio-page--summary${dockClass}${sheetClass} ${gridClass}">
        <div class="portfolio-sticky">
          ${renderAccountTabs()}
          ${renderLiveBanner()}
          ${renderPortfolioHeader()}
        </div>
        <div class="holding-list-scroll" id="holding-list-scroll" role="tabpanel" aria-labelledby="${scopeTabId}">
          <section class="account-summary-list">${listBody}</section>
        </div>
        ${indexMask}
      </section>
      ${renderBottomChrome()}`,
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
    <section class="portfolio-page${dockClass}${sheetClass} ${gridClass}">
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
    </section>
    ${renderBottomChrome()}`,
  );
}
