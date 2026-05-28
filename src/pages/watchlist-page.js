/**
 * 自选页 — 无真实持仓，实时/当日仅展示收益率（参考 ¥10,000 口径演算）。
 */
import { escapeHtml, fmtPct, pctClass } from '../format.js';
import { app } from '../app/context.js';
import { renderShell, renderLiveBanner, patchLiveBanner, renderEmptyState } from '../components/shell.js';
import { renderBottomChrome, renderIndexSheetMask, showIndexTicker, patchIndexTicker } from '../components/index-dock.js';
import { renderHeadDateBlock, renderHeadSortArrows } from '../pages/list-page.js';
import { hasRealtimeProfit } from '../components/session.js';
import { setTextClass } from '../dom.js';

function watchlistGridClass() {
  return 'portfolio-page--grid-3 watchlist-page';
}

function watchlistRealtimePct(f) {
  if (!hasRealtimeProfit(f)) return null;
  return f.realTimePct ?? f.estimateImpactPct ?? null;
}

function watchlistDailyPct(f) {
  if (f.dailyPending) return null;
  return f.settledPct ?? null;
}

function renderWatchlistPctCol(colClass, dataCol, pct) {
  const cls = pctClass(pct);
  const text = pct != null && Number.isFinite(Number(pct)) ? fmtPct(pct) : '—';
  return `
    <div class="holding-col ${colClass} holding-col--pct-only" data-col="${dataCol}">
      <p class="holding-val ${cls}">${text}</p>
    </div>`;
}

function watchlistMetricCells(f, key) {
  if (key === 'realtime') {
    return renderWatchlistPctCol('holding-col--rt', 'realtime', watchlistRealtimePct(f));
  }
  if (key === 'daily') {
    return renderWatchlistPctCol('holding-col--settled', 'daily', watchlistDailyPct(f));
  }
  return '';
}

function patchWatchlistPctCell(cell, pct) {
  if (!cell) return;
  const valEl = cell.querySelector('.holding-val');
  if (!valEl) return;
  valEl.textContent = pct != null && Number.isFinite(Number(pct)) ? fmtPct(pct) : '—';
  setTextClass(valEl, pctClass(pct));
}


export function renderWatchlistTableHead() {
  const rtDate = renderHeadDateBlock('realtime');
  const dailyDate = renderHeadDateBlock('daily');
  const sk = app().state.watchlistSortKey;
  const sd = app().state.watchlistSortDir;
  const ariaRt = sk === 'realtime' ? (sd === 'asc' ? 'ascending' : 'descending') : 'none';
  const ariaDaily = sk === 'daily' ? (sd === 'asc' ? 'ascending' : 'descending') : 'none';
  return `
    <div class="list-table-head watchlist-table-head">
      <div class="list-table-head-first">
        <span class="list-head-config-spacer" aria-hidden="true"></span>
        <span class="list-table-head-title list-table-head-title--static">基金</span>
      </div>
      <button type="button" class="list-table-head-col list-table-head-sort${sk === 'realtime' ? ' is-active' : ''}" data-watchlist-sort="realtime" aria-sort="${ariaRt}">
        <span class="list-table-head-label">
          <span class="list-table-head-title">实时收益</span>
          ${rtDate ? `<span class="list-table-head-date">${rtDate}</span>` : ''}
        </span>
        ${renderHeadSortArrows('realtime', sk, sd)}
      </button>
      <button type="button" class="list-table-head-col list-table-head-sort${sk === 'daily' ? ' is-active' : ''}" data-watchlist-sort="daily" aria-sort="${ariaDaily}">
        <span class="list-table-head-label">
          <span class="list-table-head-title">当日收益</span>
          ${dailyDate ? `<span class="list-table-head-date">${dailyDate}</span>` : ''}
        </span>
        ${renderHeadSortArrows('daily', sk, sd)}
      </button>
      <span class="list-table-head-action" aria-hidden="true"></span>
    </div>`;
}

function renderWatchlistRow(f) {
  return `
    <div class="holding-row holding-row--watchlist holding-row--clickable" data-watchlist-code="${escapeHtml(f.code)}" role="button" tabindex="0">
      <div class="holding-col holding-col--name">
        <p class="holding-name">${escapeHtml(f.name)}</p>
        <p class="holding-meta"><span class="holding-code">${escapeHtml(f.code)}</span></p>
      </div>
      ${watchlistMetricCells(f, 'realtime')}
      ${watchlistMetricCells(f, 'daily')}
      <div class="holding-col holding-col--action">
        <button type="button" class="watchlist-remove" data-remove-code="${escapeHtml(f.code)}" aria-label="移除自选">
          <svg class="watchlist-remove-icon" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
          </svg>
        </button>
      </div>
    </div>`;
}

export function renderWatchlistSearchBar() {
  const err = app().state.watchlistError;
  return `
    <div class="watchlist-search-bar">
      <form class="watchlist-search-form" id="watchlist-search-form">
        <input type="text" class="watchlist-search-input" id="watchlist-code-input" inputmode="numeric" pattern="[0-9]*" maxlength="6" placeholder="输入 6 位基金代码" autocomplete="off" />
        <button type="submit" class="watchlist-add-btn" id="btn-watchlist-add">添加</button>
      </form>
      ${err ? `<p class="watchlist-search-error" role="alert">${escapeHtml(err)}</p>` : ''}
    </div>`;
}

export function renderWatchlistPage() {
  const dockClass = showIndexTicker() ? ' has-index-dock' : '';
  const sheetClass = app().state.indexDrawerOpen && showIndexTicker() ? ' index-sheet-open' : '';
  const rows = app().state.watchlistRows ?? [];
  const body =
    rows.length > 0
      ? rows.map((f) => renderWatchlistRow(f)).join('')
      : renderEmptyState({
          title: '暂无自选基金',
          hint: '搜索基金代码添加关注',
        });

  return renderShell(
    `
    <section class="portfolio-page has-bottom-nav${dockClass}${sheetClass} ${watchlistGridClass()}">
      <div class="portfolio-sticky">
        ${renderWatchlistSearchBar()}
        ${renderLiveBanner()}
        ${rows.length > 0 ? renderWatchlistTableHead() : ''}
      </div>
      <div class="holding-list-scroll page-scroll" id="watchlist-scroll">
        <section class="holding-list holding-list--watchlist">${body}</section>
      </div>
      ${showIndexTicker() ? renderIndexSheetMask() : ''}
      ${renderBottomChrome()}
    </section>`,
  );
}

function patchWatchlistRow(rowEl, f) {
  const nameEl = rowEl.querySelector('.holding-name');
  if (nameEl && f.name) nameEl.textContent = f.name;
  patchWatchlistPctCell(rowEl.querySelector('[data-col="realtime"]'), watchlistRealtimePct(f));
  patchWatchlistPctCell(rowEl.querySelector('[data-col="daily"]'), watchlistDailyPct(f));
}

export function patchWatchlistDom() {
  if (app().state.view !== 'watchlist') return false;
  patchLiveBanner();
  patchIndexTicker();
  const rows = app().state.watchlistRows ?? [];
  for (const f of rows) {
    const row = document.querySelector(`.holding-row--watchlist[data-watchlist-code="${f.code}"]`);
    if (row) patchWatchlistRow(row, f);
  }
  return true;
}

export function canPatchWatchlistDom() {
  if (app().state.view !== 'watchlist') return false;
  const rows = app().state.watchlistRows ?? [];
  if (!rows.length) return document.querySelector('.watchlist-search-bar') != null;
  return rows.every((f) => {
    const row = document.querySelector(`[data-watchlist-code="${f.code}"]`);
    if (!row) return false;
    const nameEl = row.querySelector('.holding-name');
    const rtCell = row.querySelector('[data-col="realtime"]');
    const dailyCell = row.querySelector('[data-col="daily"]');
    return (
      Boolean(nameEl && f.name && nameEl.textContent === f.name) &&
      rtCell?.classList.contains('holding-col--pct-only') &&
      dailyCell?.classList.contains('holding-col--pct-only')
    );
  });
}
