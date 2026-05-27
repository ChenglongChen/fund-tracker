import { escapeHtml, fmtPct, pctClass } from '../format.js';
import { fmtHoldAmount, fmtMoney } from '../display-format.js';
import { visibleMetricColumns } from '../column-layout.js';
import { app } from '../app/context.js';
import { setTextClass } from '../dom.js';
import { renderShell, renderLoading, renderLiveBanner } from '../components/shell.js';
import { renderThemeToggle } from '../components/theme-chrome.js';
import { detailHoldingsMetaHtml, patchStatusStripTimes } from '../components/status.js';
import {
  combinedImpactTooltip,
  renderMetricDualLine,
  renderPctSub,
  setPctSubEl,
} from '../components/metrics.js';
import {
  extendedSessionLabel,
  holdingShowsDualChange,
  holdingStatusClass,
  holdingStatusLabel,
  shouldShowExtendedMetric,
} from '../components/session.js';
import { detailProfile } from '../fund-live-display.js';

function orderedMetrics() {
  return visibleMetricColumns(app().state.metricColumnOrder, app().state.metricColumnVisible);
}

function detailBundle() {
  return app().detailMetrics?.() ?? { fund: null, metrics: null, row: null };
}

function isWatchlistDetail() {
  return app().state.detailSource === 'watchlist';
}

export function holdingSortValue(h, key) {
  switch (key) {
    case 'name':
      return (h.name || h.code || '').trim();
    case 'change':
      return h.changePct != null && Number.isFinite(Number(h.changePct)) ? Number(h.changePct) : null;
    case 'status': {
      const session = h?.quoteSession;
      if (session === 'regular' && h?.quoteMode === 'live') return 0;
      if (session === 'premarket') return 1;
      if (session === 'afterhours') return 2;
      if (session === 'closed' || h?.quoteMode === 'close') return 3;
      return 4;
    }
    case 'weight':
    default:
      return h.weight != null && Number.isFinite(Number(h.weight)) ? Number(h.weight) : null;
  }
}

/** @param {object[]} holdings */
export function sortDetailHoldings(holdings) {
  const { holdingsSortKey, holdingsSortDir } = app().state;
  const mul = holdingsSortDir === 'asc' ? 1 : -1;
  return [...holdings].sort((a, b) => {
    const va = holdingSortValue(a, holdingsSortKey);
    const vb = holdingSortValue(b, holdingsSortKey);
    if (typeof va === 'string' && typeof vb === 'string') {
      const cmp = va.localeCompare(vb, 'zh-CN');
      if (cmp === 0) return String(a.code || '').localeCompare(String(b.code || ''), 'zh-CN');
      return cmp * mul;
    }
    if (va == null && vb == null) {
      return String(a.code || a.name || '').localeCompare(String(b.code || b.name || ''), 'zh-CN');
    }
    if (va == null) return 1;
    if (vb == null) return -1;
    if (va === vb) {
      return String(a.code || a.name || '').localeCompare(String(b.code || b.name || ''), 'zh-CN');
    }
    return (va - vb) * mul;
  });
}

export function getSortedDetailHoldings() {
  return sortDetailHoldings(app().state.detail?.holdings ?? []);
}

export function holdingsSortIndicator(key) {
  if (app().state.holdingsSortKey !== key) return '<span class="sort-indicator" aria-hidden="true"></span>';
  return `<span class="sort-indicator sort-indicator--on" aria-hidden="true">${app().state.holdingsSortDir === 'asc' ? '↑' : '↓'}</span>`;
}

export function renderHoldingsSortCol(title, key, align = 'right') {
  const active = app().state.holdingsSortKey === key ? ' is-active' : '';
  const alignCls = align === 'left' ? ' table-head-sort--left' : ' table-head-sort--right';
  const ariaSort =
    app().state.holdingsSortKey === key
      ? app().state.holdingsSortDir === 'asc'
        ? 'ascending'
        : 'descending'
      : 'none';
  return `
    <button type="button" class="table-head-sort${alignCls}${active}" data-holdings-sort-key="${key}" aria-sort="${ariaSort}">
      <span>${title}${holdingsSortIndicator(key)}</span>
    </button>`;
}

export function renderHoldingsTableHead() {
  return `
    <div class="table-head">
      ${renderHoldingsSortCol('名称', 'name', 'left')}
      ${renderHoldingsSortCol('占比', 'weight', 'right')}
      ${renderHoldingsSortCol('涨跌幅', 'change', 'right')}
      ${renderHoldingsSortCol('状态', 'status', 'right')}
    </div>`;
}

export function renderStockChangeCell(h) {
  if (!holdingShowsDualChange(h)) {
    const cls = pctClass(h.changePct);
    return `<span class="stock-change ${cls}">${fmtPct(h.changePct)}</span>`;
  }
  const extLabel = h.quoteSession === 'afterhours' ? '盘后' : '盘前';
  const mainCls = pctClass(h.changePctRegular);
  const extCls = pctClass(h.changePct);
  return `
    <div class="metric-dual-line metric-dual-line--holdings">
      <span class="stock-change ${mainCls}">${fmtPct(h.changePctRegular)}</span>
      <div class="metric-dual-line__ext">
        <span class="metric-dual-line__ext-pct ${extCls}">${fmtPct(h.changePct)}</span>
        <span class="metric-dual-line__tag">${extLabel}</span>
      </div>
    </div>`;
}

export function renderStockStatusCell(h) {
  const label = holdingStatusLabel(h);
  const cls = holdingStatusClass(h);
  return `<span class="stock-status ${cls}">${label}</span>`;
}

export function patchStockChangeCell(row, h) {
  if (holdingShowsDualChange(h)) {
    const wrap = row.querySelector('.metric-dual-line--holdings');
    if (!wrap) return false;
    const mainEl = wrap.querySelector('.stock-change');
    const extPctEl = wrap.querySelector('.metric-dual-line__ext-pct');
    const tagEl = wrap.querySelector('.metric-dual-line__tag');
    if (!mainEl || !extPctEl || !tagEl) return false;
    setPctSubEl(mainEl, h.changePctRegular);
    setPctSubEl(extPctEl, h.changePct);
    tagEl.textContent = h.quoteSession === 'afterhours' ? '盘后' : '盘前';
    return true;
  }
  const changeEl = row.querySelector('.stock-change');
  if (!changeEl) return false;
  if (row.querySelector('.metric-dual-line--holdings')) return false;
  setPctSubEl(changeEl, h.changePct);
  return true;
}

export function patchStockStatusCell(row, h) {
  const statusEl = row.querySelector('.stock-status');
  if (!statusEl) return false;
  statusEl.textContent = holdingStatusLabel(h);
  statusEl.className = `stock-status ${holdingStatusClass(h)}`;
  return true;
}

export function toggleHoldingsSort(key) {
  if (app().state.holdingsSortKey === key) {
    app().state.holdingsSortDir = app().state.holdingsSortDir === 'desc' ? 'asc' : 'desc';
  } else {
    app().state.holdingsSortKey = key;
    app().state.holdingsSortDir = key === 'name' ? 'asc' : 'desc';
  }
  app().paint();
}

export function renderDetailNav(title, { showEdit = false } = {}) {
  const editBtn = showEdit
    ? `<button type="button" class="detail-nav-action" id="btn-detail-edit">编辑</button>`
    : '';
  return `
    <nav class="detail-nav">
      <button type="button" class="detail-nav-back" id="btn-back" aria-label="返回">
        <span class="detail-nav-back-icon" aria-hidden="true">‹</span>
      </button>
      <h1 class="detail-nav-title">${escapeHtml(title)}</h1>
      <div class="detail-nav-actions">
        ${renderThemeToggle()}
        ${editBtn}
      </div>
    </nav>`;
}

export function renderDetailMetric(label, val, pct, { signed = false, metrics = null, dual = false } = {}) {
  if (dual && metrics && shouldShowExtendedMetric(metrics)) {
    return `
    <div class="detail-metric detail-metric--dual">
      <p class="detail-metric-label">${escapeHtml(label)}</p>
      ${renderMetricDualLine({
        mainVal: metrics.realTimeProfitRegular,
        mainPct: metrics.realTimePctRegular,
        extVal: metrics.realTimeProfitExtended,
        extPct: metrics.impactPctExtended,
        extLabel: extendedSessionLabel(metrics.impactSession),
        tooltip: combinedImpactTooltip(metrics),
        valSigned: signed,
      })}
    </div>`;
  }
  const cls = pctClass(signed ? val : pct);
  return `
    <div class="detail-metric">
      <p class="detail-metric-label">${escapeHtml(label)}</p>
      <p class="detail-metric-val ${cls}">${fmtMoney(val, signed)}</p>
      ${renderPctSub(pct, { extraClass: 'detail-metric-sub' })}
    </div>`;
}

function renderDetailPctMetric(label, pct) {
  const cls = pctClass(pct);
  const text = pct != null && Number.isFinite(Number(pct)) ? fmtPct(pct) : '—';
  return `
    <div class="detail-metric detail-metric--pct-only">
      <p class="detail-metric-label">${escapeHtml(label)}</p>
      <p class="detail-metric-val ${cls}">${text}</p>
    </div>`;
}

export function renderDetailHero(fund, metrics, profile) {
  const showExt = shouldShowExtendedMetric(metrics);
  const mainPct = showExt ? metrics.impactPctRegular : metrics.impactPct;
  const cls = pctClass(mainPct);
  const pctBlock = showExt
    ? `<div class="detail-hero-pct-wrap">${renderMetricDualLine({
        mainPct: metrics.impactPctRegular,
        extPct: metrics.impactPctExtended,
        extLabel: extendedSessionLabel(metrics.impactSession),
        tooltip: combinedImpactTooltip({ ...metrics, realTimePct: metrics.realTimePct ?? metrics.impactPct }),
        compact: true,
      })}</div>`
    : `<p class="detail-hero-pct ${cls}">${fmtPct(metrics.impactPct)}</p>`;
  const amountLine = profile.showAmount
    ? `<p class="detail-hero-amount">持仓 ${fmtHoldAmount(fund.amount)}</p>`
    : '';
  return `
    <section class="detail-hero ${cls}">
      <p class="detail-hero-code">${escapeHtml(fund.code)}</p>
      <p class="detail-hero-label">估值涨跌</p>
      ${pctBlock}
      ${amountLine}
    </section>`;
}

export function renderDetailStats(metrics, profile) {
  if (profile.pctOnly) {
    return `
    <section class="detail-stats detail-stats--pct-only">
      ${renderDetailPctMetric('实时收益', metrics.realTimePct)}
      ${renderDetailPctMetric('当日收益', metrics.dailyPending ? null : metrics.settledPct)}
    </section>`;
  }
  return `
    <section class="detail-stats">
      ${orderedMetrics()
        .map((col) => {
          if (col.key === 'realtime') {
            return renderDetailMetric(col.title, metrics.realTimeProfit, metrics.realTimePct, {
              signed: true,
              metrics,
              dual: true,
            });
          }
          if (col.key === 'daily') {
            return renderDetailMetric(col.title, metrics.settledProfit, metrics.settledPct, { signed: true });
          }
          if (!profile.showHoldingMetric) return '';
          return renderDetailMetric(col.title, metrics.totalProfit, metrics.totalProfitPct, { signed: true });
        })
        .join('')}
    </section>`;
}

export function renderDetailLoading(fund, profile) {
  const amountLine = profile.showAmount
    ? `<p class="detail-hero-amount">持仓 ${fmtHoldAmount(fund.amount)}</p>`
    : '';
  const pageClass = profile.pctOnly ? 'detail-page detail-page--watchlist' : 'detail-page';
  return renderShell(
    `
    <section class="${pageClass}">
      ${renderDetailNav(fund.name)}
      <section class="detail-hero is-flat">
        <p class="detail-hero-code">${escapeHtml(fund.code)}</p>
        <p class="detail-hero-label">估值涨跌</p>
        <p class="detail-hero-pct is-flat">—</p>
        ${amountLine}
      </section>
      <section class="state-card state-card--inline">
        <p class="state-text">正在拉取持仓穿透…</p>
      </section>
    </section>`,
  );
}

export function renderDetailPage() {
  const { fund, metrics } = detailBundle();
  if (!fund || !metrics || !app().state.detail) return renderLoading();

  const profile = detailProfile(app().state.detailSource);
  const { note } = app().state.detail;
  const holdings = getSortedDetailHoldings();
  const showEdit = app().canEditDetailFund?.() ?? false;
  const pageClass = profile.pctOnly ? 'detail-page detail-page--watchlist' : 'detail-page';
  const rows = holdings
    .map(
      (h) => `
      <div class="table-row">
        <span class="stock-name">${escapeHtml(h.name || h.code)}</span>
        <span class="stock-weight">${h.weight.toFixed(2)}%</span>
        ${renderStockChangeCell(h)}
        ${renderStockStatusCell(h)}
      </div>`,
    )
    .join('');

  return renderShell(
    `
    <section class="${pageClass}">
      ${renderDetailNav(fund.name, { showEdit })}
      ${renderLiveBanner()}
      ${renderDetailHero(fund, metrics, profile)}
      ${renderDetailStats(metrics, profile)}
      <div class="detail-section-head">
        <h2 class="detail-section-title">持仓穿透</h2>
        <span class="detail-section-meta">${detailHoldingsMetaHtml(holdings.length)}</span>
      </div>
      <section class="holdings-card">
        ${renderHoldingsTableHead()}
        <div class="holdings-list-scroll" id="holdings-list-scroll">
          ${rows || '<div class="table-row"><span class="stock-name">暂无持仓</span><span></span><span></span><span></span></div>'}
        </div>
      </section>
      <p class="detail-note">${escapeHtml(note)}</p>
    </section>`,
  );
}

export function canPatchDetailDom() {
  if (app().state.view !== 'detail' || !document.getElementById('holdings-list-scroll')) return false;
  const { row } = detailBundle();
  if (shouldShowExtendedMetric(row)) return false;
  if (getSortedDetailHoldings().some(holdingShowsDualChange)) return false;
  return true;
}

export function patchDetailMetricsDom() {
  const { fund, metrics } = detailBundle();
  if (!fund || !metrics || !app().state.detail) return false;

  const profile = detailProfile(app().state.detailSource);
  const heroCls = pctClass(metrics.impactPctRegular ?? metrics.impactPct);
  const hero = document.querySelector('.detail-hero');
  if (hero) {
    hero.className = `detail-hero ${heroCls}`;
    const pctEl = hero.querySelector('.detail-hero-pct');
    if (pctEl) {
      pctEl.textContent = fmtPct(metrics.impactPct);
      setTextClass(pctEl, heroCls);
    }
    const amountEl = hero.querySelector('.detail-hero-amount');
    if (amountEl && profile.showAmount) {
      amountEl.textContent = `持仓 ${fmtHoldAmount(fund.amount)}`;
    }
  }

  const statsEl = document.querySelector('.detail-stats');
  if (statsEl && profile.pctOnly) {
    const vals = statsEl.querySelectorAll('.detail-metric-val');
    if (vals[0]) {
      vals[0].textContent =
        metrics.realTimePct != null && Number.isFinite(metrics.realTimePct)
          ? fmtPct(metrics.realTimePct)
          : '—';
      setTextClass(vals[0], pctClass(metrics.realTimePct));
    }
    if (vals[1]) {
      const daily = metrics.dailyPending ? null : metrics.settledPct;
      vals[1].textContent = daily != null ? fmtPct(daily) : '—';
      setTextClass(vals[1], pctClass(daily));
    }
  } else if (statsEl) {
    orderedMetrics().forEach((col, i) => {
      const el = statsEl.children[i];
      if (!el) return;
      let val;
      let pct;
      if (col.key === 'realtime') {
        val = metrics.realTimeProfit;
        pct = metrics.realTimePct;
      } else if (col.key === 'daily') {
        val = metrics.settledProfit;
        pct = metrics.settledPct;
      } else {
        val = metrics.totalProfit;
        pct = metrics.totalProfitPct;
      }
      const cls = pctClass(val);
      const valEl = el.querySelector('.detail-metric-val');
      const subEl = el.querySelector('.detail-metric-sub');
      if (valEl) {
        valEl.textContent = fmtMoney(val, true);
        setTextClass(valEl, cls);
      }
      if (subEl) setPctSubEl(subEl, pct);
    });
  }

  const metaEl = document.querySelector('.detail-section-meta');
  if (metaEl) {
    metaEl.innerHTML = detailHoldingsMetaHtml(app().state.detail.holdings.length);
  }

  patchStatusStripTimes();
  return true;
}

export function patchDetailDom() {
  const { fund } = detailBundle();
  if (!fund || !app().state.detail) return false;
  if (!patchDetailMetricsDom()) return false;

  const rows = document.querySelectorAll('#holdings-list-scroll .table-row');
  const holdings = getSortedDetailHoldings();
  if (rows.length !== holdings.length) return false;

  for (let i = 0; i < holdings.length; i += 1) {
    const row = rows[i];
    if (!row || !patchStockChangeCell(row, holdings[i]) || !patchStockStatusCell(row, holdings[i])) {
      return false;
    }
  }

  return true;
}
