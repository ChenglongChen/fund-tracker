import { dayProfitPct } from './portfolio.js';
import {
  fetchFundDetail,
  fetchLive,
  fetchPortfolio,
  addFundApi,
  updateFundApi,
  deleteFundApi,
} from './client-api.js';
import {
  loadMetricColumnOrder,
  loadMetricColumnVisible,
  loadNameSubline,
  loadFundOrder,
  orderedMetricColumns,
  saveMetricColumnOrder,
  saveMetricColumnVisible,
  saveNameSubline,
  saveFundOrder,
  metricColumnDef,
  visibleMetricColumns,
  METRIC_COLUMNS,
} from './column-layout.js';
import { initTheme, themeToggleLabel, toggleTheme } from './theme.js';
import {
  SCOPE_ALL,
  SCOPE_SUMMARY,
  buildAccountSummaries,
  isEditableScope,
  loadActiveScope,
  rowsForScope,
  saveActiveScope,
} from './accounts.js';
import { HIDDEN_AMOUNT_TEXT, loadHideAssets, saveHideAssets } from './privacy.js';

const REFRESH_MS = 1_000;
const DETAIL_HOLDINGS_REFRESH_MS = 3_000;

/** @type {ResizeObserver | null} */
let accountTabsResizeObserver = null;

/** @type {import('./portfolio.js').PortfolioMeta} */
let PORTFOLIO_META = {};
/** @type {import('./portfolio.js').FundRow[]} */
let FUNDS = [];
/** @type {{ id: string, name: string, order: number }[]} */
let ACCOUNTS = [];

const state = {
  view: 'loading',
  activeScope: loadActiveScope(),
  detailId: null,
  indices: [],
  updatedAt: '',
  quoteUpdatedAt: '',
  detailHoldingsAt: '',
  fxPct: null,
  fundRows: [],
  displayRows: [],
  summary: null,
  detail: null,
  error: null,
  busy: false,
  manageTab: 'holdings',
  manageSelected: [],
  manageFundOrderDraft: [],
  manageError: null,
  configDraft: null,
  fundEditError: null,
  useColumnSort: false,
  serverStatus: null,
  portfolioUpdatedAt: null,
  displayContext: null,
  metricColumnOrder: loadMetricColumnOrder(),
  metricColumnVisible: loadMetricColumnVisible(),
  nameSubline: loadNameSubline(),
  hideAssets: loadHideAssets(),
  sortKey: 'amount',
  sortDir: 'desc',
  holdingsSortKey: 'weight',
  holdingsSortDir: 'desc',
  indexDrawerOpen: false,
  indexDrawerTab: 'cn',
  indexDockSlide: 0,
  liveBanner: null,
  liveBannerDismissed: false,
  formBusy: false,
  indexDrawerReturnFocus: null,
};

let refreshTimer = null;
let refreshPending = false;
let lastDetailHoldingsFetchAt = 0;
let indexDockCarouselTimer = null;
const INDEX_DOCK_CAROUSEL_MS = 4000;

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function pctClass(v) {
  if (v == null || !Number.isFinite(Number(v))) return 'is-flat';
  const n = Number(v);
  if (n > 0) return 'is-up';
  if (n < 0) return 'is-down';
  return 'is-flat';
}

function fmtPct(v) {
  if (v == null || !Number.isFinite(Number(v))) return '—';
  const n = Number(v);
  return `${n > 0 ? '+' : ''}${n.toFixed(2)}%`;
}

function renderPctPill(v, { tag = 'span', extraClass = '', attrs = '' } = {}) {
  const cls = pctClass(v);
  const text = v != null && Number.isFinite(Number(v)) ? fmtPct(v) : '—';
  const classes = ['pct-pill', cls, extraClass].filter(Boolean).join(' ');
  const attrStr = attrs ? ` ${attrs}` : '';
  return `<${tag} class="${classes}"${attrStr}>${text}</${tag}>`;
}

function setPctPillEl(el, v) {
  if (!el) return;
  const layout = [...el.classList].filter((c) => !['is-up', 'is-down', 'is-flat', 'pct-pill'].includes(c));
  el.className = [...layout, 'pct-pill', pctClass(v)].filter(Boolean).join(' ');
  el.textContent = v != null && Number.isFinite(Number(v)) ? fmtPct(v) : '—';
}

function renderPctSub(v, { tag = 'p', extraClass = 'holding-sub', attrs = '' } = {}) {
  const cls = pctClass(v);
  const text = v != null && Number.isFinite(Number(v)) ? fmtPct(v) : '—';
  const classes = [extraClass, cls].filter(Boolean).join(' ');
  const attrStr = attrs ? ` ${attrs}` : '';
  return `<${tag} class="${classes}"${attrStr}>${text}</${tag}>`;
}

function setPctSubEl(el, v) {
  if (!el) return;
  const layout = [...el.classList].filter((c) => !['is-up', 'is-down', 'is-flat'].includes(c));
  el.className = [...layout, pctClass(v)].filter(Boolean).join(' ');
  el.textContent = v != null && Number.isFinite(Number(v)) ? fmtPct(v) : '—';
}

function extendedSessionLabel(session) {
  if (session === 'premarket') return '盘前';
  if (session === 'afterhours') return '盘后';
  return '';
}

function hasExtendedRealtimeLayout(f) {
  if (f.market === 'cn' || f.market === 'gold_cn') return false;
  if (!hasRealtimeProfit(f)) return false;
  if (f.impactSession !== 'premarket' && f.impactSession !== 'afterhours') return false;
  if (f.impactPctExtended == null || !Number.isFinite(f.impactPctExtended)) return false;
  if (f.impactSession === 'premarket') return true;
  return f.realtimeActive;
}

function shouldShowExtendedMetric(f) {
  return hasExtendedRealtimeLayout(f);
}

function renderRealtimeSplitRow(val, pct, { valSigned = true, tag = '', pill = false } = {}) {
  const cls = pctClass(valSigned ? val : pct);
  const tagHtml = tag ? `<span class="metric-dual-line__tag">${escapeHtml(tag)}</span>` : '';
  const pctHtml = pill
    ? renderPctPill(pct, { extraClass: 'holding-sub' })
    : `<span class="holding-sub ${cls}">${fmtPct(pct)}</span>`;
  return `
    <p class="metric-split-row${tag ? ' metric-split-row--ext' : ''}">
      <span class="holding-val ${cls}">${fmtMoney(val, valSigned)}</span>
      ${pctHtml}
      ${tagHtml}
    </p>`;
}

function combinedImpactTooltip(row) {
  if (!hasExtendedRealtimeLayout(row)) return '';
  const total = row.realTimePct ?? row.estimateImpactPct ?? row.impactPct;
  const regular = row.realTimePctRegular ?? row.impactPctRegularLive ?? row.impactPctRegular;
  const ext = row.impactPctExtendedLive ?? row.impactPctExtended;
  const label = extendedSessionLabel(row.impactSession);
  if (total == null || ext == null) return '';
  if (row.impactSession === 'premarket') {
    return `实时 ${fmtPct(total)}（不含${label} ${fmtPct(ext)}）`;
  }
  if (regular == null) return '';
  return `合计 ${fmtPct(total)} = 正盘 ${fmtPct(regular)} + ${label} ${fmtPct(ext)}`;
}

function renderMetricDualLine({
  mainVal,
  mainPct,
  extVal,
  extPct,
  extLabel,
  tooltip = '',
  valSigned = false,
  mainCls,
  compact = false,
  listMode = false,
}) {
  const cls = mainCls ?? pctClass(valSigned ? mainVal : mainPct);
  const extCls = pctClass(valSigned ? extVal : extPct);
  const tip = tooltip ? ` title="${escapeHtml(tooltip)}"` : '';
  const compactCls = compact ? ' metric-dual-line--compact' : '';
  const listCls = listMode ? ' metric-dual-line--list' : '';
  const showExtVal = extVal != null && Number.isFinite(Number(extVal)) && Math.abs(Number(extVal)) >= 0.01;

  if (listMode) {
    return `
    <div class="metric-dual-line${listCls}"${tip} aria-label="${escapeHtml(tooltip || `${extLabel} ${fmtPct(extPct)}`)}">
      <p class="holding-val ${cls}">${fmtMoney(mainVal, valSigned)}</p>
      ${renderPctSub(mainPct, { extraClass: 'holding-sub' })}
      <div class="metric-dual-line__ext metric-dual-line__ext--inline">
        ${showExtVal ? `<span class="metric-dual-line__ext-val ${extCls}">${fmtMoney(extVal, valSigned)}</span>` : ''}
        ${extPct != null ? `<span class="metric-dual-line__ext-pct ${extCls}">${fmtPct(extPct)}</span>` : ''}
        ${extLabel ? `<span class="metric-dual-line__tag">${escapeHtml(extLabel)}</span>` : ''}
      </div>
    </div>`;
  }

  return `
    <div class="metric-dual-line${compactCls}${listCls}"${tip}>
      <div class="metric-dual-line__main">
        ${mainVal != null ? `<p class="holding-val ${cls}">${fmtMoney(mainVal, valSigned)}</p>` : ''}
        ${mainPct != null ? renderPctSub(mainPct, { extraClass: 'holding-sub' }) : ''}
        ${mainVal == null && mainPct != null ? `<p class="detail-hero-pct ${cls}">${fmtPct(mainPct)}</p>` : ''}
      </div>
      <div class="metric-dual-line__ext">
        ${showExtVal ? `<span class="metric-dual-line__ext-val ${extCls}">${fmtMoney(extVal, valSigned)}</span>` : ''}
        ${extPct != null ? `<span class="metric-dual-line__ext-pct ${extCls}">${fmtPct(extPct)}</span>` : ''}
        ${extLabel ? `<span class="metric-dual-line__tag">${escapeHtml(extLabel)}</span>` : ''}
      </div>
    </div>`;
}

function holdingStatusLabel(h) {
  const session = h?.quoteSession;
  if (session === 'premarket') return '盘前';
  if (session === 'afterhours') return '盘后';
  if (session === 'regular' && h?.quoteMode === 'live') return '盘中';
  if (session === 'closed' || h?.quoteMode === 'close') return '已收盘';
  if (h?.quoteMode === 'live') return '盘中';
  return '—';
}

function holdingStatusClass(h) {
  const session = h?.quoteSession;
  if (session === 'premarket') return 'is-premarket';
  if (session === 'afterhours') return 'is-afterhours';
  if (session === 'regular' && h?.quoteMode === 'live') return 'is-live';
  if (session === 'closed' || h?.quoteMode === 'close') return 'is-close';
  if (h?.quoteMode === 'live') return 'is-live';
  return 'is-flat';
}

function holdingShowsDualChange(h) {
  return (
    (h?.quoteSession === 'premarket' || h?.quoteSession === 'afterhours') &&
    h.changePctRegular != null &&
    Number.isFinite(Number(h.changePctRegular)) &&
    h.changePct != null &&
    Number.isFinite(Number(h.changePct))
  );
}

/** @param {object} h @param {string} key */
function holdingSortValue(h, key) {
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
function sortDetailHoldings(holdings) {
  const { holdingsSortKey, holdingsSortDir } = state;
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

function getSortedDetailHoldings() {
  return sortDetailHoldings(state.detail?.holdings ?? []);
}

function holdingsSortIndicator(key) {
  if (state.holdingsSortKey !== key) return '<span class="sort-indicator" aria-hidden="true"></span>';
  return `<span class="sort-indicator sort-indicator--on" aria-hidden="true">${state.holdingsSortDir === 'asc' ? '↑' : '↓'}</span>`;
}

function renderHoldingsSortCol(title, key, align = 'right') {
  const active = state.holdingsSortKey === key ? ' is-active' : '';
  const alignCls = align === 'left' ? ' table-head-sort--left' : ' table-head-sort--right';
  const ariaSort =
    state.holdingsSortKey === key
      ? state.holdingsSortDir === 'asc'
        ? 'ascending'
        : 'descending'
      : 'none';
  return `
    <button type="button" class="table-head-sort${alignCls}${active}" data-holdings-sort-key="${key}" aria-sort="${ariaSort}">
      <span>${title}${holdingsSortIndicator(key)}</span>
    </button>`;
}

function renderHoldingsTableHead() {
  return `
    <div class="table-head">
      ${renderHoldingsSortCol('名称', 'name', 'left')}
      ${renderHoldingsSortCol('占比', 'weight', 'right')}
      ${renderHoldingsSortCol('涨跌幅', 'change', 'right')}
      ${renderHoldingsSortCol('状态', 'status', 'right')}
    </div>`;
}

function renderStockChangeCell(h) {
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

function renderStockStatusCell(h) {
  const label = holdingStatusLabel(h);
  const cls = holdingStatusClass(h);
  return `<span class="stock-status ${cls}">${label}</span>`;
}

function patchStockChangeCell(row, h) {
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

function patchStockStatusCell(row, h) {
  const statusEl = row.querySelector('.stock-status');
  if (!statusEl) return false;
  statusEl.textContent = holdingStatusLabel(h);
  statusEl.className = `stock-status ${holdingStatusClass(h)}`;
  return true;
}

function toggleHoldingsSort(key) {
  if (state.holdingsSortKey === key) {
    state.holdingsSortDir = state.holdingsSortDir === 'desc' ? 'asc' : 'desc';
  } else {
    state.holdingsSortKey = key;
    state.holdingsSortDir = key === 'name' ? 'asc' : 'desc';
  }
  paint();
}

function fmtIndexPrice(v) {
  if (v == null || !Number.isFinite(Number(v))) return '—';
  return Number(v).toLocaleString('zh-CN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function fmtIndexChange(v) {
  if (v == null || !Number.isFinite(Number(v))) return '—';
  const n = Number(v);
  const abs = Math.abs(n).toLocaleString('zh-CN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  if (n > 0) return `+${abs}`;
  if (n < 0) return `-${abs}`;
  return abs;
}

function fmtMoneyRaw(v, signed = false) {
  if (v == null || !Number.isFinite(Number(v))) return '—';
  const n = Number(v);
  const abs = Math.abs(n).toLocaleString('zh-CN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  if (!signed) return abs;
  if (n > 0) return `+${abs}`;
  if (n < 0) return `-${abs}`;
  return abs;
}

/** 展示用金额：隐藏模式下全部脱敏，仅保留 fmtPct 涨跌幅 */
function fmtMoney(v, signed = false) {
  if (v == null || !Number.isFinite(Number(v))) return '—';
  if (state.hideAssets) return HIDDEN_AMOUNT_TEXT;
  return fmtMoneyRaw(v, signed);
}

function fmtHoldAmount(v) {
  if (v == null || !Number.isFinite(Number(v))) return '—';
  if (state.hideAssets) return HIDDEN_AMOUNT_TEXT;
  return `¥ ${fmtMoneyRaw(v)}`;
}

function fmtEstimatedAssets(v) {
  if (state.hideAssets) return HIDDEN_AMOUNT_TEXT;
  return `预估 ${fmtMoneyRaw(v)}`;
}

function renderPrivacyToggle() {
  const hidden = state.hideAssets;
  return `
    <button
      type="button"
      class="privacy-toggle"
      id="btn-privacy-toggle"
      aria-pressed="${hidden ? 'true' : 'false'}"
      aria-label="${hidden ? '显示资产' : '隐藏资产'}"
      title="${hidden ? '显示资产' : '隐藏资产'}"
    >
      <svg class="privacy-icon privacy-icon--show" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
        <path fill="currentColor" d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"/>
      </svg>
      <svg class="privacy-icon privacy-icon--hide" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
        <path fill="currentColor" d="M12 7c2.76 0 5 2.24 5 5 0 .65-.13 1.26-.36 1.83l2.92 2.92c1.51-1.26 2.7-2.89 3.43-4.75-1.73-4.39-6-7.5-11-7.5-1.4 0-2.74.25-3.98.7l2.16 2.16C10.74 7.13 11.35 7 12 7zM2 4.27l2.28 2.28.46.46C3.08 8.3 1.78 10.02 1 12c1.73 4.39 6 7.5 11 7.5 1.55 0 3.03-.3 4.38-.84l.42.42L19.73 22 21 20.73 3.27 3 2 4.27zM7.53 9.8l1.55 1.55c-.05.21-.08.43-.08.65 0 2.76 2.24 5 5 5 .22 0 .44-.03.65-.08l1.55 1.55c-.67.33-1.41.53-2.2.53-2.76 0-5-2.24-5-5 0-.79.2-1.53.53-2.2zm4.31-.78l3.15 3.15.02-.16c0-2.76-2.24-5-5-5l-.17.01z"/>
      </svg>
    </button>`;
}

function toggleHideAssets() {
  state.hideAssets = saveHideAssets(!state.hideAssets);
  patchPrivacyToggle();
  if (state.view === 'detail' && canPatchDetailDom() && patchDetailDom()) return;
  if (state.view === 'list' && canPatchListDom() && patchListDom()) return;
  paint();
}

function patchPrivacyToggle() {
  const btn = document.getElementById('btn-privacy-toggle');
  if (!btn) return;
  const hidden = state.hideAssets;
  btn.setAttribute('aria-pressed', hidden ? 'true' : 'false');
  btn.setAttribute('aria-label', hidden ? '显示资产' : '隐藏资产');
  btn.title = hidden ? '显示资产' : '隐藏资产';
}

let privacyClickBound = false;
function setupPrivacyClick() {
  if (privacyClickBound) return;
  privacyClickBound = true;
  document.getElementById('app')?.addEventListener('click', (ev) => {
    if (!ev.target.closest('.privacy-toggle')) return;
    ev.stopPropagation();
    ev.preventDefault();
    toggleHideAssets();
  });
}

function fmtTime() {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function fmtTableDate(dateStr) {
  const d = dateStr || state.serverStatus?.live?.beijingDate || PORTFOLIO_META.beijingDate;
  if (!d) return '';
  const m = String(d).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return d;
  return `${m[2]}-${m[3]}`;
}

function parseRoute() {
  const raw = location.hash.replace(/^#/, '').trim();
  if (!raw) return { type: 'list', scope: loadActiveScope() };
  if (raw === 'summary') return { type: 'list', scope: SCOPE_SUMMARY };
  if (raw === 'all') return { type: 'list', scope: SCOPE_ALL };
  const accountM = raw.match(/^account\/([a-z0-9_-]+)$/);
  if (accountM) return { type: 'list', scope: accountM[1] };
  if (raw === 'manage') return { type: 'manage', tab: 'holdings' };
  if (raw === 'manage/headers') return { type: 'manage', tab: 'headers' };
  if (raw === 'manage/add') return { type: 'manage', tab: 'add' };
  const editM = raw.match(/^detail-(\d+)\/edit$/);
  if (editM) return { type: 'fund-edit', id: parseInt(editM[1], 10) };
  const detailM = raw.match(/^detail-(\d+)$/);
  if (detailM) return { type: 'detail', id: parseInt(detailM[1], 10) };
  return { type: 'list', scope: loadActiveScope() };
}

/** @param {{ type: string, id?: number, tab?: string, scope?: string }} route */
function navigateTo(route) {
  switch (route.type) {
    case 'list':
      if (route.scope === SCOPE_SUMMARY) location.hash = '#summary';
      else if (route.scope === SCOPE_ALL) location.hash = '#all';
      else if (route.scope) location.hash = `#account/${route.scope}`;
      else location.hash = '#all';
      break;
    case 'manage':
      if (route.tab === 'headers') location.hash = '#manage/headers';
      else if (route.tab === 'add') location.hash = '#manage/add';
      else location.hash = '#manage';
      break;
    case 'detail':
      location.hash = `#detail-${route.id}`;
      break;
    case 'fund-edit':
      location.hash = `#detail-${route.id}/edit`;
      break;
    default:
      location.hash = '';
  }
}

function setHash(detailId) {
  if (detailId) navigateTo({ type: 'detail', id: detailId });
  else navigateTo({ type: 'list', scope: state.activeScope });
}

function accountById(id) {
  return ACCOUNTS.find((a) => a.id === id) ?? null;
}

function canEditFund(fund) {
  if (!fund || !isEditableScope(state.activeScope)) return false;
  if (fund.isMerged) return false;
  return fund.accountId === state.activeScope;
}

function setActiveScope(scope) {
  state.activeScope = scope;
  saveActiveScope(scope);
  applyDisplayScope();
}

function applyDisplayScope() {
  state.displayRows = rowsForScope(state.fundRows, state.activeScope);
  const summaryRows =
    state.activeScope === SCOPE_SUMMARY ? state.fundRows : state.displayRows;
  state.summary = buildSummary(summaryRows);
  state.displayRows = finalizeFundRows(state.displayRows);
}

function fundById(id) {
  return FUNDS.find((f) => f.id === id) ?? null;
}

function calcRealTime(amount, impactPct) {
  if (impactPct == null || !Number.isFinite(impactPct)) {
    return { profit: null, pct: null };
  }
  return {
    profit: roundProfit(amount, impactPct),
    pct: impactPct,
  };
}

function roundProfit(amount, impactPct) {
  if (impactPct == null || !Number.isFinite(impactPct)) return null;
  if (amount == null || !Number.isFinite(amount)) return null;
  return Math.round(((amount * impactPct) / 100) * 100) / 100;
}

function enrichFundRow(f, liveRow = null) {
  const dailyPending = liveRow?.dailyPending ?? false;
  const settledProfit = dailyPending
    ? null
    : liveRow?.settledProfit ?? f.yesterdayProfit ?? null;
  const settledPct = dailyPending
    ? null
    : liveRow?.settledPct ?? dayProfitPct(f.amount, f.yesterdayProfit);
  const settledNavDate = liveRow?.settledNavDate ?? f.lastNavDate ?? null;
  const amount = liveRow?.amount ?? f.amount;
  const totalProfit = liveRow?.totalProfit ?? f.totalProfit;
  const totalProfitPct = liveRow?.totalProfitPct ?? f.totalProfitPct;
  return {
    ...f,
    amount,
    totalProfit,
    totalProfitPct,
    yesterdayProfit: liveRow?.yesterdayProfit ?? f.yesterdayProfit,
    lastNavDate: liveRow?.lastNavDate ?? f.lastNavDate,
    settledProfit,
    settledPct,
    settledNavDate,
    dailyPending,
    settledSource: liveRow?.settledSource ?? 'portfolio',
  };
}

/** 用 /api/live 中的最新入账字段同步本地 FUNDS（持仓/持有收益与当日一并更新） */
function syncPortfolioFromLive(live) {
  if (!live?.funds?.length) return;
  for (const f of FUNDS) {
    const row = live.funds.find((x) => x.id === f.id);
    if (!row) continue;
    if (row.amount != null && Number.isFinite(row.amount)) f.amount = row.amount;
    if (row.totalProfit != null && Number.isFinite(row.totalProfit)) f.totalProfit = row.totalProfit;
    if (row.totalProfitPct != null && Number.isFinite(row.totalProfitPct)) {
      f.totalProfitPct = row.totalProfitPct;
    }
    if (row.yesterdayProfit != null && Number.isFinite(row.yesterdayProfit)) {
      f.yesterdayProfit = row.yesterdayProfit;
    }
    if (row.lastNavDate) f.lastNavDate = row.lastNavDate;
    if (row.lastNav != null && Number.isFinite(row.lastNav)) f.lastNav = row.lastNav;
    if (row.shares != null && Number.isFinite(row.shares)) f.shares = row.shares;
  }
}

function estimateProfitForRow(f) {
  if (f.estimateProfit != null && Number.isFinite(f.estimateProfit)) return f.estimateProfit;
  if (f.realTimeProfit != null && Number.isFinite(f.realTimeProfit)) return f.realTimeProfit;
  return 0;
}

function hasExtendedSummaryLayout(summary) {
  if (!summary) return false;
  const session = summary.extendedSession;
  if (session !== 'premarket' && session !== 'afterhours') return false;
  const ext = summary.totalRealTimeExtended;
  return ext != null && Number.isFinite(ext);
}

function extendedSummarySession(rows) {
  const usRow = rows.find(
    (f) =>
      f.market === 'us' &&
      (f.impactSession === 'premarket' || f.impactSession === 'afterhours'),
  );
  return usRow?.impactSession ?? null;
}

function sumExtendedForRows(rows) {
  let total = 0;
  let usAssets = 0;
  for (const f of rows) {
    const ext = f.realTimeProfitExtended;
    if (ext != null && Number.isFinite(ext)) total += ext;
    if (f.market === 'us') usAssets += f.amount ?? 0;
  }
  return {
    total: Math.round(total * 100) / 100,
    pct: usAssets > 0 ? (total / usAssets) * 100 : null,
  };
}

function estimatedAssetsForRow(f) {
  if (f.estimateAssets != null && Number.isFinite(f.estimateAssets)) return f.estimateAssets;
  const ep = estimateProfitForRow(f);
  const amount = f.amount ?? 0;
  if (ep == null || !Number.isFinite(ep)) return amount;
  const settled = f.dailyPending ? 0 : (f.settledProfit ?? 0);
  return amount - settled + ep;
}

function buildSummary(rows) {
  const settledAssets = rows.reduce((s, f) => s + (f.amount ?? 0), 0);
  const totalSettled = rows.reduce((s, f) => s + (f.settledProfit ?? 0), 0);
  const totalSettledPct = dayProfitPct(settledAssets, totalSettled);
  const totalRealTime = rows.reduce((s, f) => s + estimateProfitForRow(f), 0);
  const ext = sumExtendedForRows(rows);
  const realtimeAssets = Math.round((settledAssets + totalRealTime) * 100) / 100;

  const totalHolding = rows.reduce((s, f) => s + (f.totalProfit ?? 0), 0);
  const totalRealTimePct = settledAssets > 0 ? (totalRealTime / settledAssets) * 100 : null;
  const costBasis = settledAssets - totalHolding;
  const totalHoldingPct = costBasis > 0 ? (totalHolding / costBasis) * 100 : null;

  return {
    totalAssets: settledAssets,
    totalSettled,
    totalSettledPct,
    totalRealTime,
    totalHolding,
    totalRealTimePct,
    totalHoldingPct,
    settledAssets,
    realtimeAssets,
    totalRealTimeExtended: ext.total,
    totalRealTimeExtendedPct: ext.pct,
    extendedSession: extendedSummarySession(rows),
  };
}

function mergeLiveIntoFunds(live) {
  syncPortfolioFromLive(live);
  const byId = new Map(live.funds.map((x) => [x.id, x]));
  const rows = FUNDS.map((f) => {
    const liveRow = byId.get(f.id);
    const base = enrichFundRow(f, liveRow);
    const amount = base.amount ?? 0;
    const impactPct = liveRow?.impactPct ?? null;
    const impactPctRegular = liveRow?.impactPctRegular ?? null;
    const impactPctExtended = liveRow?.impactPctExtended ?? null;
    const impactPctRegularLive =
      liveRow?.impactPctRegularLive ?? liveRow?.impactPctRegular ?? null;
    const impactPctExtendedLive =
      liveRow?.impactPctExtendedLive ?? liveRow?.impactPctExtended ?? null;
    const impactSession = liveRow?.impactSession ?? 'closed';
    const active = liveRow?.realtimeActive ?? false;

    const ep =
      liveRow?.estimateProfit != null && Number.isFinite(liveRow.estimateProfit)
        ? liveRow.estimateProfit
        : null;

    let realTimeProfit = ep;
    let realTimePct = ep != null && amount > 0 ? (ep / amount) * 100 : null;

    let realTimeProfitRegular = roundProfit(amount, impactPctRegularLive);
    let realTimePctRegular =
      impactPctRegularLive != null && Number.isFinite(impactPctRegularLive)
        ? impactPctRegularLive
        : null;

    const realTimeProfitExtended =
      liveRow?.realTimeProfitExtended ?? roundProfit(amount, impactPctExtendedLive);

    if ((impactSession === 'premarket' || impactSession === 'afterhours') && ep != null) {
      realTimeProfitRegular = ep;
      realTimePctRegular = realTimePct;
    }

    return {
      ...base,
      impactPct,
      impactPctRegular,
      impactPctExtended,
      impactPctRegularLive,
      impactPctExtendedLive,
      estimateImpactPct: liveRow?.estimateImpactPct ?? null,
      impactSession,
      realTimeProfit,
      realTimePct,
      realTimeProfitRegular,
      realTimePctRegular,
      realTimeProfitExtended,
      estimateProfit: ep,
      estimateAssets:
        liveRow?.estimateAssets != null && Number.isFinite(liveRow.estimateAssets)
          ? liveRow.estimateAssets
          : null,
      realtimeActive: active,
      marketLabel: liveRow?.marketLabel ?? '',
      dailyAsOfLabel: liveRow?.dailyAsOfLabel ?? '',
      dailyHint: liveRow?.dailyHint ?? '',
      market: liveRow?.market ?? '',
      displayAmount: base.amount,
    };
  });
  return rows;
}

/** @param {object} f @param {string} key */
function sortValue(f, key) {
  switch (key) {
    case 'realtime':
      return f.realTimeProfit != null && Number.isFinite(f.realTimeProfit) ? f.realTimeProfit : null;
    case 'daily':
      return f.settledProfit != null && Number.isFinite(f.settledProfit) ? f.settledProfit : null;
    case 'holding':
      return f.totalProfit != null && Number.isFinite(f.totalProfit) ? f.totalProfit : null;
    case 'amount':
    default:
      return f.displayAmount ?? f.amount ?? 0;
  }
}

/** @param {object[]} rows */
function applySort(rows) {
  const { sortKey, sortDir } = state;
  const mul = sortDir === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    const va = sortValue(a, sortKey);
    const vb = sortValue(b, sortKey);
    if (va == null && vb == null) return a.id - b.id;
    if (va == null) return 1;
    if (vb == null) return -1;
    if (va === vb) return a.id - b.id;
    return (va - vb) * mul;
  });
}

function listConfigIconMarkup() {
  return `<svg class="list-head-config-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z" stroke="currentColor" stroke-width="1.75"/>
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`;
}

function themeToggleIconMarkup() {
  const dark = document.documentElement.dataset.theme === 'dark';
  if (dark) {
    return `<svg class="theme-toggle-icon" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <circle cx="10" cy="10" r="3.75" stroke="currentColor" stroke-width="1.5"/>
      <path d="M10 2.5v2M10 15.5v2M2.5 10h2M15.5 10h2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
      <path d="M4.7 4.7l1.4 1.4M13.9 13.9l1.4 1.4M4.7 15.3l1.4-1.4M13.9 6.1l1.4-1.4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
    </svg>`;
  }
  return `<svg class="theme-toggle-icon" viewBox="0 0 20 20" fill="none" aria-hidden="true">
    <path d="M13.6 3.3a6.5 6.5 0 1 0 7.2 10.2A7.8 7.8 0 0 1 13.6 3.3z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>
  </svg>`;
}

function renderThemeToggle() {
  const label = themeToggleLabel();
  return `
    <button type="button" class="theme-toggle" id="btn-theme" aria-label="切换${label}模式" title="切换${label}模式">
      ${themeToggleIconMarkup()}
    </button>`;
}

function renderPhoneChrome() {
  return `<div class="phone-chrome">${renderThemeToggle()}</div>`;
}

function renderShell(inner) {
  return `<div class="app-shell"><main class="phone-page">${inner}</main><div class="sr-live" id="live-region" aria-live="polite" aria-atomic="true"></div></div>`;
}

function renderLoading() {
  return renderShell(`
    <section class="state-card">
      <p class="state-title">加载中...</p>
      <p class="state-text">正在连接服务端并拉取估值</p>
    </section>`);
}

function renderError(msg) {
  return renderShell(`
    <section class="state-card">
      <p class="state-title">加载失败</p>
      <p class="state-text" id="error-message">${escapeHtml(msg)}</p>
      <p class="state-text state-text--hint">请确认已运行 <code>npm run dev</code> 或 <code>npm start</code>（需先 build）</p>
      <button type="button" class="retry-button" id="btn-retry" aria-describedby="error-message">重试</button>
    </section>`);
}

const INDEX_DRAWER_TABS = [
  { id: 'cn', label: '沪深', markets: ['cn'] },
  { id: 'hk', label: '港股', markets: ['hk'] },
  { id: 'asia', label: '亚太', markets: ['jp', 'kr'] },
  { id: 'us', label: '美股', markets: ['us'] },
  { id: 'fx', label: '外汇', markets: ['fx'] },
];

const INDEX_DOCK_CAROUSEL = [
  { market: 'cn', label: '上证' },
  { market: 'cn', label: '沪深300' },
  { market: 'cn', label: '创业板' },
  { market: 'hk', label: '恒生' },
  { market: 'us', label: '纳斯达克100' },
];

function showIndexTicker() {
  return state.view === 'list' && state.indices.length > 0;
}

function dockCarouselIndices() {
  return INDEX_DOCK_CAROUSEL.map(({ market, label }) => {
    const exact = state.indices.find((it) => it.label === label);
    if (exact) return exact;
    return state.indices.find((it) => it.market === market) || null;
  }).filter(Boolean);
}

function dockIndexShortLabel(label) {
  if (label === '纳斯达克100') return '纳指100';
  if (label === '纳斯达克') return '纳指';
  if (label === '沪深300') return '沪深300';
  return label;
}

function indicesForDrawerTab(tabId) {
  const tab = INDEX_DRAWER_TABS.find((t) => t.id === tabId);
  if (!tab) return [];
  return state.indices.filter((it) => tab.markets.includes(it.market));
}

function renderIndexTickerItem(it) {
  return `
    <span class="index-ticker-item">
      <span class="index-ticker-name">${escapeHtml(it.label)}</span>
      <span class="index-ticker-val ${pctClass(it.changePct)}">${fmtPct(it.changePct)}</span>
    </span>`;
}

function renderIndexTickerItems(indices = state.indices) {
  return indices.map((it) => renderIndexTickerItem(it)).join('');
}

function resolveIndexQuote(it) {
  const price = it?.price != null && Number.isFinite(Number(it.price)) ? Number(it.price) : null;
  let change = it?.change != null && Number.isFinite(Number(it.change)) ? Number(it.change) : null;
  const changePct =
    it?.changePct != null && Number.isFinite(Number(it.changePct)) ? Number(it.changePct) : null;
  if (change == null && price != null && changePct != null) {
    change = price - price / (1 + changePct / 100);
  }
  return { price, change, changePct };
}

function indexShowsDual(it) {
  return (
    it?.market === 'us' &&
    (it?.quoteSession === 'premarket' || it?.quoteSession === 'afterhours') &&
    it?.changePctRegular != null &&
    Number.isFinite(Number(it.changePctRegular))
  );
}

function renderIndexDockSlide(it) {
  const { price, change, changePct } = resolveIndexQuote(it);
  const cls = pctClass(changePct);
  const extLabel = extendedSessionLabel(it?.quoteSession);
  const quoteInner = indexShowsDual(it)
    ? `
        <span class="index-dock-price ${pctClass(it.changePctRegular)}">${fmtIndexPrice(price)}</span>
        <span class="index-dock-pct ${pctClass(it.changePctRegular)}">${fmtPct(it.changePctRegular)}</span>
        <span class="index-dock-ext">
          <span class="index-dock-ext-pct ${cls}">${fmtPct(changePct)}</span>
          <span class="metric-dual-line__tag">${extLabel}</span>
        </span>`
    : `
        <span class="index-dock-price ${cls}">${fmtIndexPrice(price)}</span>
        <span class="index-dock-change ${cls}">${fmtIndexChange(change)}</span>
        <span class="index-dock-pct ${cls}">${fmtPct(changePct)}</span>`;
  return `
    <div class="index-dock-slide ${cls}" data-dock-label="${escapeHtml(it.label)}">
      <span class="index-dock-name">${escapeHtml(dockIndexShortLabel(it.label))}</span>
      <span class="index-dock-quote">${quoteInner}</span>
    </div>`;
}

function renderIndexDockBar() {
  const slides = dockCarouselIndices();
  if (!slides.length) return '';
  const slideIdx = state.indexDockSlide % slides.length;
  const active = slides[slideIdx] ?? slides[0];
  const tone = pctClass(active?.changePct);
  return `
    <div class="index-dock" id="index-dock">
      <button type="button" class="index-dock-bar ${tone}" id="btn-index-dock" aria-expanded="${state.indexDrawerOpen}" aria-controls="index-drawer">
        <span class="index-dock-carousel" aria-live="polite" aria-atomic="true">
          ${renderIndexDockSlide(active)}
        </span>
        <span class="index-dock-chevron" aria-hidden="true">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="18 15 12 9 6 15"/></svg>
        </span>
      </button>
    </div>`;
}

function renderIndexDrawerPanel() {
  const open = state.indexDrawerOpen;
  const tabId = state.indexDrawerTab;
  const tabIndices = indicesForDrawerTab(tabId);
  const tabs = INDEX_DRAWER_TABS.map(
    (tab) => `
    <button type="button" role="tab" class="index-drawer-tab${tab.id === tabId ? ' is-active' : ''}" data-index-tab="${tab.id}" id="index-tab-${tab.id}" aria-selected="${tab.id === tabId ? 'true' : 'false'}" aria-controls="index-drawer-panel">
      ${escapeHtml(tab.label)}
    </button>`,
  ).join('');
  return `
    <div class="index-drawer${open ? ' is-open' : ''}" id="index-drawer" role="dialog" aria-modal="true" aria-label="大盘指数" aria-hidden="${open ? 'false' : 'true'}">
      <div class="index-drawer-handle" aria-hidden="true"></div>
      <div class="index-drawer-tabs-row">
        <div class="index-drawer-tabs" role="tablist">${tabs}</div>
        <button type="button" class="index-drawer-close" id="btn-index-drawer-close" aria-label="收起">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
        </button>
      </div>
      <div class="index-drawer-grid" id="index-drawer-panel" role="tabpanel" aria-labelledby="index-tab-${tabId}">${renderIndexTickerItems(tabIndices)}</div>
    </div>`;
}

function renderIndexSheetMask() {
  if (!showIndexTicker()) return '';
  const open = state.indexDrawerOpen;
  return `<button type="button" class="index-sheet-mask${open ? ' is-open' : ''}" id="index-sheet-mask" aria-label="关闭大盘指数"${open ? '' : ' hidden'} tabindex="-1"></button>`;
}

function renderIndexBottom() {
  if (!showIndexTicker()) return '';
  return `
    <div class="index-bottom${state.indexDrawerOpen ? ' index-bottom--drawer-open' : ''}" id="index-bottom">
      ${renderIndexDrawerPanel()}
      ${renderIndexDockBar()}
    </div>`;
}

function renderBottomChrome() {
  if (!showIndexTicker()) return '';
  return `<div class="bottom-chrome" id="bottom-chrome">${renderIndexBottom()}</div>`;
}

function openIndexDrawer() {
  state.indexDrawerReturnFocus = document.activeElement;
  state.indexDrawerOpen = true;
  stopIndexDockCarousel();
  syncIndexDrawerUi();
  requestAnimationFrame(() => {
    document.getElementById('btn-index-drawer-close')?.focus({ preventScroll: true });
  });
}

function closeIndexDrawer() {
  state.indexDrawerOpen = false;
  syncIndexDrawerUi();
  const returnEl = state.indexDrawerReturnFocus;
  state.indexDrawerReturnFocus = null;
  if (returnEl instanceof HTMLElement) returnEl.focus({ preventScroll: true });
}

function syncIndexDrawerUi() {
  const open = state.indexDrawerOpen && showIndexTicker();
  const drawer = document.getElementById('index-drawer');
  const bottom = document.getElementById('index-bottom');
  const mask = document.getElementById('index-sheet-mask');
  const scrollEl = document.getElementById('holding-list-scroll');
  const scrollTop = scrollEl?.scrollTop ?? 0;

  document.querySelector('.portfolio-page')?.classList.toggle('index-sheet-open', open);
  bottom?.classList.toggle('index-bottom--drawer-open', open);

  if (drawer) {
    drawer.classList.toggle('is-open', open);
    drawer.setAttribute('aria-hidden', open ? 'false' : 'true');
  }
  if (mask) {
    mask.classList.toggle('is-open', open);
    mask.toggleAttribute('hidden', !open);
    mask.tabIndex = open ? 0 : -1;
  }
  document.getElementById('btn-index-dock')?.setAttribute('aria-expanded', open ? 'true' : 'false');
  if (open) stopIndexDockCarousel();
  else startIndexDockCarousel();

  if (scrollEl) {
    scrollEl.scrollTop = scrollTop;
    requestAnimationFrame(() => {
      scrollEl.scrollTop = scrollTop;
    });
  }
}

function patchIndexDockSlideEl(slideEl, it) {
  if (!slideEl || !it) return;
  const { price, change, changePct } = resolveIndexQuote(it);
  const cls = pctClass(changePct);
  slideEl.classList.remove('is-up', 'is-down', 'is-flat');
  slideEl.classList.add(cls);
  slideEl.setAttribute('data-dock-label', it.label);
  const nameEl = slideEl.querySelector('.index-dock-name');
  const priceEl = slideEl.querySelector('.index-dock-price');
  const changeEl = slideEl.querySelector('.index-dock-change');
  const pctEl = slideEl.querySelector('.index-dock-pct');
  if (nameEl) nameEl.textContent = dockIndexShortLabel(it.label);
  if (priceEl) {
    priceEl.textContent = fmtIndexPrice(price);
    setTextClass(priceEl, cls);
  }
  if (changeEl) {
    changeEl.textContent = fmtIndexChange(change);
    setTextClass(changeEl, cls);
  }
  if (pctEl) {
    pctEl.textContent = fmtPct(changePct);
    setTextClass(pctEl, cls);
  }
}

function patchIndexDockCarousel(animate = true) {
  const slides = dockCarouselIndices();
  if (!slides.length) return false;
  if (state.indexDockSlide >= slides.length) state.indexDockSlide = 0;
  const carousel = document.querySelector('.index-dock-carousel');
  if (!carousel) return false;
  const it = slides[state.indexDockSlide];
  const apply = () => {
    const slideEl = carousel.querySelector('.index-dock-slide');
    if (slideEl) patchIndexDockSlideEl(slideEl, it);
    else carousel.innerHTML = renderIndexDockSlide(it);
    const bar = document.getElementById('btn-index-dock');
    if (bar && it) {
      const tone = pctClass(it.changePct);
      bar.classList.remove('is-up', 'is-down', 'is-flat');
      bar.classList.add(tone);
    }
  };
  if (animate && carousel.querySelector('.index-dock-slide')) {
    carousel.classList.add('is-fading');
    window.setTimeout(() => {
      apply();
      carousel.classList.remove('is-fading');
    }, 160);
  } else {
    apply();
  }
  return true;
}

function startIndexDockCarousel() {
  stopIndexDockCarousel();
  if (!showIndexTicker() || state.indexDrawerOpen) return;
  const slides = dockCarouselIndices();
  if (slides.length <= 1) return;
  indexDockCarouselTimer = setInterval(() => {
    state.indexDockSlide = (state.indexDockSlide + 1) % slides.length;
    patchIndexDockCarousel(true);
  }, INDEX_DOCK_CAROUSEL_MS);
}

function stopIndexDockCarousel() {
  if (indexDockCarouselTimer) clearInterval(indexDockCarouselTimer);
  indexDockCarouselTimer = null;
}

function patchIndexDrawerTab() {
  const tabId = state.indexDrawerTab;
  document.querySelectorAll('.index-drawer-tab').forEach((btn) => {
    const active = btn.getAttribute('data-index-tab') === tabId;
    btn.classList.toggle('is-active', active);
    btn.setAttribute('aria-selected', active ? 'true' : 'false');
  });
  const panel = document.getElementById('index-drawer-panel');
  if (panel) panel.setAttribute('aria-labelledby', `index-tab-${tabId}`);
  const grid = document.querySelector('.index-drawer-grid');
  if (!grid) return false;
  const tabIndices = indicesForDrawerTab(tabId);
  grid.innerHTML = renderIndexTickerItems(tabIndices);
  return true;
}

function patchIndexTicker() {
  if (!showIndexTicker()) return true;
  if (!patchIndexDockCarousel(false)) return false;
  const drawerItems = document.querySelectorAll('.index-drawer-grid .index-ticker-item');
  const tabIndices = indicesForDrawerTab(state.indexDrawerTab);
  if (drawerItems.length !== tabIndices.length) return patchIndexDrawerTab();
  tabIndices.forEach((it, i) => {
    const item = drawerItems[i];
    if (!item) return;
    const nameEl = item.querySelector('.index-ticker-name');
    const valEl = item.querySelector('.index-ticker-val');
    if (nameEl) nameEl.textContent = it.label;
    if (valEl) {
      valEl.textContent = fmtPct(it.changePct);
      setTextClass(valEl, pctClass(it.changePct));
    }
  });
  return true;
}

function summaryHeroTone(summary) {
  if (!summary) return 'is-flat';
  return pctClass(summary.totalRealTime);
}

function detailFundMetrics(fund) {
  const row = state.fundRows.find((f) => f.id === fund.id);
  const amount = row?.amount ?? fund.amount;
  const impactPct = row?.impactPct ?? state.detail?.impactPct ?? null;
  const impactPctRegular = row?.impactPctRegular ?? impactPct;
  const impactPctExtended = row?.impactPctExtended ?? null;
  const impactPctRegularLive = row?.impactPctRegularLive ?? impactPctRegular;
  const impactPctExtendedLive = row?.impactPctExtendedLive ?? impactPctExtended;
  const estimateImpactPct = row?.estimateImpactPct ?? null;
  const impactSession = row?.impactSession ?? 'closed';
  const dailyPending = row?.dailyPending ?? false;
  const settledProfit = dailyPending
    ? null
    : row?.settledProfit ?? fund.yesterdayProfit ?? null;
  const settledPct = dailyPending
    ? null
    : row?.settledPct ?? dayProfitPct(amount, settledProfit);

  const realTimeProfit = row?.realTimeProfit ?? row?.estimateProfit ?? null;
  const realTimePct =
    row?.realTimePct ??
    (realTimeProfit != null && amount > 0 ? (realTimeProfit / amount) * 100 : null);

  let realTimeProfitRegular =
    row?.realTimeProfitRegular ?? roundProfit(amount, impactPctRegularLive);
  let realTimePctRegular =
    row?.realTimePctRegular ??
    (impactPctRegularLive != null && Number.isFinite(impactPctRegularLive)
      ? impactPctRegularLive
      : null);

  if (impactSession === 'premarket' && realTimeProfit != null) {
    realTimeProfitRegular = realTimeProfit;
    realTimePctRegular = realTimePct;
  }

  const realTimeProfitExtended =
    row?.realTimeProfitExtended ?? roundProfit(amount, impactPctExtendedLive);

  return {
    impactPct,
    impactPctRegular,
    impactPctExtended,
    impactPctRegularLive,
    impactPctExtendedLive,
    estimateImpactPct,
    impactSession,
    realTimeProfit,
    realTimePct,
    realTimeProfitRegular,
    realTimePctRegular,
    realTimeProfitExtended,
    settledProfit,
    settledPct,
    dailyPending,
    totalProfit: row?.totalProfit ?? fund.totalProfit,
    totalProfitPct: row?.totalProfitPct ?? fund.totalProfitPct,
  };
}

function formatClockLabel(timeStr) {
  const date = state.displayContext?.beijingDate ?? state.lastLive?.beijingDate ?? '';
  if (date && timeStr) return `${date.slice(5)} ${timeStr}`;
  return timeStr || fmtTime();
}

function statusTimesHtml() {
  const refresh = formatClockLabel(state.updatedAt);
  const quote = formatClockLabel(state.quoteUpdatedAt || state.updatedAt);
  return `<span class="status-strip-times"><span>刷新 ${escapeHtml(refresh)}</span><span class="status-strip-time-sep" aria-hidden="true">·</span><span>行情 ${escapeHtml(quote)}</span></span>`;
}

function detailHoldingsMetaHtml(holdingsCount) {
  const refresh = formatClockLabel(state.updatedAt);
  const holdings = state.detailHoldingsAt ? formatClockLabel(state.detailHoldingsAt) : '—';
  return `${holdingsCount} 只 · 刷新 ${escapeHtml(refresh)} · 持仓 ${escapeHtml(holdings)}`;
}

function patchStatusStripTimes() {
  const statusChip = document.querySelector('.status-strip-chip');
  const statusTime = document.querySelector('.status-strip-time');
  if (statusChip) statusChip.textContent = marketStatusHint();
  if (statusTime) statusTime.innerHTML = statusTimesHtml();
  return Boolean(statusTime);
}

function marketStatusHint() {
  return state.displayContext?.marketChip ?? '休市';
}

function visibleMetrics() {
  return visibleMetricColumns(state.metricColumnOrder, state.metricColumnVisible);
}

function orderedMetrics() {
  return visibleMetrics();
}

function portfolioGridClass() {
  const n = visibleMetrics().length;
  if (n >= 3) return 'portfolio-page--grid-4';
  if (n === 2) return 'portfolio-page--grid-3';
  if (n === 1) return 'portfolio-page--grid-2';
  return 'portfolio-page--grid-1';
}

function renderLiveBanner() {
  const hidden = !state.liveBanner || state.liveBannerDismissed;
  return `
    <div class="live-banner${hidden ? ' is-hidden' : ''}" id="live-banner" role="alert"${hidden ? ' hidden' : ''}>
      <span class="live-banner-text">${escapeHtml(state.liveBanner || '')}</span>
      <button type="button" class="live-banner-action" id="btn-live-retry">重试</button>
      <button type="button" class="live-banner-dismiss" id="btn-live-dismiss" aria-label="关闭">×</button>
    </div>`;
}

function patchLiveBanner() {
  const el = document.getElementById('live-banner');
  if (!el) return false;
  const hidden = !state.liveBanner || state.liveBannerDismissed;
  el.classList.toggle('is-hidden', hidden);
  el.hidden = hidden;
  const textEl = el.querySelector('.live-banner-text');
  if (textEl) textEl.textContent = state.liveBanner || '';
  return true;
}

function announceLiveUpdate() {
  const el = document.getElementById('live-region');
  if (!el || state.view === 'loading' || state.view === 'error') return;
  const refresh = formatClockLabel(state.updatedAt);
  const quote = formatClockLabel(state.quoteUpdatedAt || state.updatedAt);
  el.textContent = `已刷新 ${refresh} · 行情 ${quote}`;
}

function renderEmptyState({ title, hint, actionId, actionLabel } = {}) {
  return `
    <div class="empty-state">
      <p class="empty-state-title">${escapeHtml(title || '暂无数据')}</p>
      ${hint ? `<p class="empty-state-hint">${escapeHtml(hint)}</p>` : ''}
      ${actionId && actionLabel ? `<button type="button" class="empty-state-action" id="${actionId}">${escapeHtml(actionLabel)}</button>` : ''}
    </div>`;
}

function applyFundOrder(rows) {
  if (state.activeScope === SCOPE_SUMMARY) return rows;
  const order = loadFundOrder(state.activeScope);
  if (!order.length) return rows;
  const idx = new Map(order.map((id, i) => [id, i]));
  return [...rows].sort((a, b) => {
    const ia = idx.has(a.id) ? idx.get(a.id) : 10_000 + a.id;
    const ib = idx.has(b.id) ? idx.get(b.id) : 10_000 + b.id;
    if (ia !== ib) return ia - ib;
    return a.id - b.id;
  });
}

function finalizeFundRows(rows) {
  const sorted = applySort(rows);
  if (state.useColumnSort || state.sortKey !== 'amount' || state.sortDir !== 'desc') return sorted;
  return applyFundOrder(sorted);
}

function summaryMetricByKey(s, key) {
  if (!s) return null;
  switch (key) {
    case 'realtime':
      return { val: s.totalRealTime, pct: s.totalRealTimePct, signed: true };
    case 'daily':
      return { val: s.totalSettled, pct: s.totalSettledPct, signed: true };
    case 'holding':
      return { val: s.totalHolding, pct: s.totalHoldingPct, signed: true };
    default:
      return null;
  }
}

function hasRealtimeProfit(f) {
  return f.realTimeProfit != null && Number.isFinite(f.realTimeProfit);
}

function fundMetricCells(f, key) {
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
      return `
      <div class="holding-col holding-col--rt" data-col="realtime">
        <p class="holding-val ${rtCls}">${fmtMoney(hasRealtimeProfit(f) ? f.realTimeProfit : null, true)}</p>
        ${renderPctSub(hasRealtimeProfit(f) ? f.realTimePct : null, { extraClass: 'holding-sub' })}
      </div>`;
    case 'daily': {
      const pending = f.dailyPending;
      const stCls = pctClass(pending ? null : f.settledProfit);
      return `
      <div class="holding-col holding-col--settled" data-col="daily">
        <p class="holding-val ${stCls}">${fmtMoney(pending ? null : f.settledProfit, true)}</p>
        ${renderPctSub(pending ? null : f.settledPct, { extraClass: 'holding-sub' })}
      </div>`;
    }
    case 'holding':
      return `
      <div class="holding-col holding-col--total" data-col="holding">
        <p class="holding-val ${thCls}">${fmtMoney(f.totalProfit, true)}</p>
        ${renderPctSub(f.totalProfitPct, { extraClass: 'holding-sub' })}
      </div>`;
    default:
      return '';
  }
}

function renderAccountTabButton(t) {
  const selected = state.activeScope === t.scope;
  return `
    <button type="button" role="tab" class="account-tab${selected ? ' is-active' : ''}" data-account-scope="${t.scope}" id="account-tab-${t.scope}" aria-selected="${selected ? 'true' : 'false'}" aria-controls="holding-list-scroll">
      ${escapeHtml(t.label)}
    </button>`;
}

function accountTabsPinned() {
  return [
    { scope: SCOPE_SUMMARY, label: '账户概况' },
    { scope: SCOPE_ALL, label: '全部持仓' },
  ];
}

function accountTabsScrollable() {
  return ACCOUNTS.map((a) => ({ scope: a.id, label: a.name }));
}

function accountTabsAll() {
  return [...accountTabsPinned(), ...accountTabsScrollable()];
}

function layoutAccountTabs() {
  const scroll = document.getElementById('account-tabs-track');
  if (!scroll) return;
  const active = scroll.querySelector('.account-tab.is-active');
  if (!active) return;
  const pad = 8;
  const left = active.offsetLeft;
  const right = left + active.offsetWidth;
  const viewLeft = scroll.scrollLeft;
  const viewRight = viewLeft + scroll.clientWidth;
  if (left < viewLeft + pad) {
    scroll.scrollLeft = Math.max(0, left - pad);
  } else if (right > viewRight - pad) {
    scroll.scrollLeft = right - scroll.clientWidth + pad;
  }
}

function setupAccountTabsLayout() {
  const scroll = document.getElementById('account-tabs-track');
  if (!scroll) return;
  requestAnimationFrame(() => layoutAccountTabs());
  accountTabsResizeObserver?.disconnect();
  accountTabsResizeObserver = new ResizeObserver(() => layoutAccountTabs());
  accountTabsResizeObserver.observe(scroll);
}

function activateAccountScope(scope) {
  state.indexDrawerOpen = false;
  setActiveScope(scope);
  navigateTo({ type: 'list', scope });
  state.view = 'list';
  paint();
  scheduleRefresh();
}

function onAccountTabsBarClick(ev) {
  const tab = ev.target.closest('[data-account-scope]');
  if (!tab || !tab.closest('.account-tabs-bar')) return;
  const scope = tab.getAttribute('data-account-scope');
  if (!scope) return;
  activateAccountScope(scope);
}

function initIndexDrawerGlobalListeners() {
  if (window.__indexDrawerGlobalListeners) return;
  window.__indexDrawerGlobalListeners = true;
  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape') {
      if (state.indexDrawerOpen) closeIndexDrawer();
      return;
    }
    if (ev.key !== 'Tab' || !state.indexDrawerOpen) return;
    const drawer = document.getElementById('index-drawer');
    if (!drawer?.classList.contains('is-open')) return;
    const focusables = [
      ...drawer.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'),
    ].filter((el) => !el.disabled && el.offsetParent !== null);
    if (!focusables.length) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (ev.shiftKey && document.activeElement === first) {
      ev.preventDefault();
      last.focus();
    } else if (!ev.shiftKey && document.activeElement === last) {
      ev.preventDefault();
      first.focus();
    }
  });
  document.addEventListener(
    'wheel',
    (ev) => {
      if (!state.indexDrawerOpen || !showIndexTicker()) return;
      if (ev.target instanceof Element && ev.target.closest('#index-drawer')) return;
      const page = document.querySelector('.portfolio-page.index-sheet-open');
      if (page?.contains(ev.target)) ev.preventDefault();
    },
    { passive: false, capture: true },
  );
  document.addEventListener(
    'touchmove',
    (ev) => {
      if (!state.indexDrawerOpen || !showIndexTicker()) return;
      if (ev.target instanceof Element && ev.target.closest('#index-drawer')) return;
      const page = document.querySelector('.portfolio-page.index-sheet-open');
      if (page?.contains(ev.target)) ev.preventDefault();
    },
    { passive: false, capture: true },
  );
}

function renderAccountTabs() {
  return `
    <div class="account-tabs-bar">
      <div class="account-tabs" role="tablist" id="account-tabs-track">
        ${accountTabsAll().map((t) => renderAccountTabButton(t)).join('')}
      </div>
      ${renderThemeToggle()}
    </div>`;
}

function renderSummaryTrendCounts(up, down) {
  return `<span class="account-summary-trends" data-summary-trends>
    <span class="account-summary-trend account-summary-trend--up">↑ ${up}</span>
    <span class="account-summary-trend account-summary-trend--down">↓ ${down}</span>
  </span>`;
}

function patchSummaryTrendCounts(container, up, down) {
  if (!container) return;
  const trends = container.querySelector('[data-summary-trends]');
  if (!trends) return;
  const upEl = trends.querySelector('.account-summary-trend--up');
  const downEl = trends.querySelector('.account-summary-trend--down');
  if (upEl) upEl.textContent = `↑ ${up}`;
  if (downEl) downEl.textContent = `↓ ${down}`;
}

function renderAccountSummaryCard(acc) {
  const dailyCls = pctClass(acc.totalSettled);
  const holdingCls = pctClass(acc.totalHolding);
  return `
    <button type="button" class="account-summary-card" data-account-scope="${acc.id}" data-account-id="${acc.id}">
      <div class="account-summary-head">
        <span class="account-summary-name">${escapeHtml(acc.name)}</span>
      </div>
      <div class="account-summary-body">
        <div class="account-summary-col">
          <div class="account-summary-label-row">
            <span class="account-summary-label">账户资产</span>
          </div>
          <p class="account-summary-val">${fmtMoney(acc.totalAssets)}</p>
          <p class="account-summary-sub account-summary-sub--combo">${fmtMoney(acc.totalHolding, true)} · ${renderPctPill(acc.totalHoldingPct)}</p>
        </div>
        <div class="account-summary-col account-summary-col--center${acc.hasExtendedRealtime ? ' account-summary-col--rt-split' : ''}">
          <div class="account-summary-label-row account-summary-label-row--center">
            <span class="account-summary-label">实时收益</span>
            ${renderSummaryTrendCounts(acc.rtUp, acc.rtDown)}
          </div>
          ${renderAccountRealtimeBody(acc)}
        </div>
        <div class="account-summary-col account-summary-col--right">
          <div class="account-summary-label-row account-summary-label-row--end">
            <span class="account-summary-label">当日收益</span>
            ${renderSummaryTrendCounts(acc.up, acc.down)}
          </div>
          <p class="account-summary-val ${dailyCls}">${fmtMoney(acc.totalSettled, true)}</p>
          ${renderPctPill(acc.totalSettledPct, { tag: 'p', extraClass: 'account-summary-sub' })}
        </div>
      </div>
    </button>`;
}

function renderStatusStrip() {
  return `
    <div class="status-strip">
      <div class="status-strip-meta">
        <span class="status-strip-chip">${escapeHtml(marketStatusHint())}</span>
        <span class="status-strip-time">${statusTimesHtml()}</span>
      </div>
    </div>`;
}

function summaryHeadDate(col) {
  const head = state.displayContext?.tableHead?.[col];
  const label = head?.label ?? head?.line1 ?? '';
  return label ? `<span class="yj-summary-date">${escapeHtml(label)}</span>` : '';
}

function renderSummaryRealtimeBody(s) {
  if (!hasExtendedSummaryLayout(s)) {
    const rtCls = pctClass(s.totalRealTime);
    return `
      <p class="yj-summary-val ${rtCls}">${fmtMoney(s.totalRealTime, true)}</p>
      ${renderPctSub(s.totalRealTimePct, { extraClass: 'yj-summary-sub' })}`;
  }
  const rtCls = pctClass(s.totalRealTime);
  const tag = extendedSessionLabel(s.extendedSession);
  return `
    <div class="yj-summary-rt-split">
      <p class="metric-split-row">
        <span class="holding-val ${rtCls}">${fmtMoney(s.totalRealTime, true)}</span>
        <span class="holding-sub ${rtCls}">${fmtPct(s.totalRealTimePct)}</span>
      </p>
      ${renderRealtimeSplitRow(s.totalRealTimeExtended ?? 0, s.totalRealTimeExtendedPct ?? 0, { tag })}
    </div>`;
}

function renderSummaryMetricCol(title, colKey, val, pct, { signed = false, amount = false, summary = null } = {}) {
  const dateHtml = colKey ? summaryHeadDate(colKey) : '';
  const valCls = pctClass(signed ? val : pct);
  if (colKey === 'realtime' && summary && hasExtendedSummaryLayout(summary)) {
    return `
    <div class="yj-summary-col yj-summary-col--rt-split" data-summary-col="${colKey}">
      <p class="yj-summary-label">${escapeHtml(title)}${dateHtml}</p>
      ${renderSummaryRealtimeBody(summary)}
    </div>`;
  }
  return `
    <div class="yj-summary-col ${amount ? 'yj-summary-col--amount' : ''}" data-summary-col="${colKey || 'assets'}">
      <p class="yj-summary-label">${escapeHtml(title)}${dateHtml}</p>
      <p class="yj-summary-val ${valCls}">${fmtMoney(val, signed)}</p>
      ${pct != null || !amount ? renderPctSub(pct, { extraClass: 'yj-summary-sub' }) : ''}
    </div>`;
}

function renderAccountRealtimeBody(acc) {
  const rtCls = pctClass(acc.hasRealtime ? acc.totalRealTime : null);
  if (!acc.hasExtendedRealtime) {
    return `
          <p class="account-summary-val ${rtCls}" data-account-rt-val>${acc.hasRealtime ? fmtMoney(acc.totalRealTime, true) : '—'}</p>
          ${renderPctPill(acc.hasRealtime ? acc.totalRealTimePct : null, {
            tag: 'p',
            extraClass: 'account-summary-sub',
            attrs: 'data-account-rt-pct',
          })}`;
  }
  const tag = extendedSessionLabel(acc.extendedSession);
  return `
          <div class="account-summary-rt-split" data-account-rt-split>
            <p class="metric-split-row">
              <span class="holding-val ${rtCls}" data-account-rt-val>${acc.hasRealtime ? fmtMoney(acc.totalRealTime, true) : '—'}</span>
              ${renderPctPill(acc.hasRealtime ? acc.totalRealTimePct : null, {
                extraClass: 'holding-sub',
                attrs: 'data-account-rt-pct',
              })}
            </p>
            ${renderRealtimeSplitRow(acc.totalRealTimeExtended ?? 0, acc.totalRealTimeExtendedPct ?? 0, { tag, pill: true })}
          </div>`;
}

function renderPortfolioHeader() {
  const s = state.summary;
  if (!s) return '';
  const heroTone = summaryHeroTone(s);
  return `
    <header class="yj-summary yj-summary--hero ${heroTone}">
      <div class="yj-summary-grid">
        <div class="yj-summary-col yj-summary-col--amount" data-summary-col="assets">
          <p class="yj-summary-label">
            <span class="yj-summary-label-text">${summaryAssetsLabel()}</span>
            ${renderPrivacyToggle()}
          </p>
          <p class="yj-summary-val">${fmtMoney(s.settledAssets)}</p>
          <p class="yj-summary-sub yj-summary-sub--muted">${fmtEstimatedAssets(s.realtimeAssets)}</p>
        </div>
        ${orderedMetrics()
          .map((col) => {
            const m = summaryMetricByKey(s, col.key);
            return renderSummaryMetricCol(col.title, col.key, m.val, m.pct, {
              signed: m.signed,
              summary: col.key === 'realtime' ? s : null,
            });
          })
          .join('')}
      </div>
    </header>
    ${renderStatusStrip()}`;
}

function renderHeadDateBlock(col) {
  const head = state.displayContext?.tableHead?.[col];
  const label = head?.label ?? head?.line1 ?? '';
  if (!label) return '';
  return `<span class="list-table-head-date-text">${escapeHtml(label)}</span>`;
}

function sortIndicator(key) {
  if (state.sortKey !== key) return '<span class="sort-indicator" aria-hidden="true"></span>';
  return `<span class="sort-indicator sort-indicator--on" aria-hidden="true">${state.sortDir === 'asc' ? '↑' : '↓'}</span>`;
}

function renderHeadSortCol(title, sortKey, dateCol = null) {
  const active = state.sortKey === sortKey ? ' is-active' : '';
  const dateHtml = dateCol ? renderHeadDateBlock(dateCol) : '';
  const left = sortKey === 'amount' ? ' list-table-head-sort--left' : '';
  const ariaSort =
    state.sortKey === sortKey ? (state.sortDir === 'asc' ? 'ascending' : 'descending') : 'none';
  return `
    <button type="button" class="list-table-head-col list-table-head-sort${left}${active}" data-sort-key="${sortKey}" aria-sort="${ariaSort}">
      <span class="list-table-head-title">${title}${sortIndicator(sortKey)}</span>
      ${dateHtml ? `<span class="list-table-head-date">${dateHtml}</span>` : ''}
    </button>`;
}

function renderListTableHead() {
  const metricHeads = orderedMetrics()
    .map((col) => renderHeadSortCol(col.title, col.key, col.dateCol))
    .join('');
  const configBtn = isEditableScope(state.activeScope)
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

function readConfigDraftFromDom() {
  return {
    code: document.getElementById('add-fund-code')?.value?.trim() ?? '',
    name: document.getElementById('add-fund-name')?.value?.trim() ?? '',
    amount: document.getElementById('add-fund-amount')?.value?.trim() ?? '',
    totalProfit: document.getElementById('add-fund-total-profit')?.value?.trim() ?? '',
    yesterdayProfit: document.getElementById('add-fund-daily-profit')?.value?.trim() ?? '',
  };
}

async function submitAddFund() {
  if (state.formBusy) return;
  state.configDraft = readConfigDraftFromDom();
  const { code, name, amount, totalProfit, yesterdayProfit } = state.configDraft;
  setFormBusy(true);
  try {
    await addFundApi({
      code,
      name: name || undefined,
      accountId: state.activeScope,
      amount: parseFloat(amount),
      totalProfit: parseFloat(totalProfit),
      yesterdayProfit: yesterdayProfit ? parseFloat(yesterdayProfit) : 0,
    });
    state.manageError = null;
    state.configDraft = defaultConfigDraft();
    await reloadPortfolioAndLive();
    state.manageFundOrderDraft = FUNDS.filter((f) => f.accountId === state.activeScope).map((f) => f.id);
    navigateTo({ type: 'manage', tab: 'holdings' });
    state.view = 'manage';
    state.manageTab = 'holdings';
    paint();
  } catch (e) {
    state.manageError = e instanceof Error ? e.message : String(e);
    paint();
  } finally {
    setFormBusy(false);
  }
}

async function submitSaveFund() {
  const fund = fundById(state.detailId);
  if (!fund || state.formBusy) return;
  state.fundEditError = null;
  setFormBusy(true);
  try {
    await updateFundApi(fund.id, {
      name: document.getElementById('edit-fund-name')?.value?.trim(),
      amount: parseFloat(document.getElementById('edit-fund-amount')?.value ?? ''),
      totalProfit: parseFloat(document.getElementById('edit-fund-total-profit')?.value ?? ''),
      yesterdayProfit: parseFloat(document.getElementById('edit-fund-daily-profit')?.value ?? '0'),
    });
    await reloadPortfolioAndLive();
    navigateTo({ type: 'detail', id: fund.id });
    state.view = 'detail';
    await loadDetail(fund.id);
    paint();
    scheduleRefresh();
  } catch (e) {
    state.fundEditError = e instanceof Error ? e.message : String(e);
    paint();
  } finally {
    setFormBusy(false);
  }
}

async function submitDeleteFund() {
  const fund = fundById(state.detailId);
  if (!fund || state.formBusy) return;
  if (!window.confirm(`确定删除「${fund.name}」？此操作不可撤销。`)) return;
  setFormBusy(true);
  try {
    await deleteFundApi(fund.id);
    state.detailId = null;
    await reloadPortfolioAndLive();
    navigateTo({ type: 'list', scope: fund.accountId || state.activeScope });
    state.view = 'list';
    paint();
    scheduleRefresh();
  } catch (e) {
    state.fundEditError = e instanceof Error ? e.message : String(e);
    paint();
  } finally {
    setFormBusy(false);
  }
}

function finishManagePage() {
  saveMetricColumnOrder(state.metricColumnOrder);
  saveMetricColumnVisible(state.metricColumnVisible);
  saveNameSubline(state.nameSubline);
  if (state.manageFundOrderDraft.length && isEditableScope(state.activeScope)) {
    saveFundOrder(state.manageFundOrderDraft, state.activeScope);
    state.useColumnSort = false;
    state.sortKey = 'amount';
    state.sortDir = 'desc';
  }
  state.manageError = null;
  state.manageSelected = [];
  navigateTo({ type: 'list', scope: state.activeScope });
  state.view = 'list';
  applyDisplayScope();
  paint();
  scheduleRefresh();
  refreshListView();
}

function openManagePage(tab = 'holdings') {
  if (!isEditableScope(state.activeScope)) return;
  state.manageTab = tab;
  state.manageError = null;
  state.manageSelected = [];
  const accountFunds = FUNDS.filter((f) => f.accountId === state.activeScope);
  const saved = loadFundOrder(state.activeScope);
  state.manageFundOrderDraft = saved.length
    ? [...saved, ...accountFunds.map((f) => f.id).filter((id) => !saved.includes(id))]
    : accountFunds.map((f) => f.id);
  state.view = tab === 'add' ? 'manage-add' : 'manage';
  navigateTo({ type: 'manage', tab });
  if (refreshTimer) {
    clearInterval(refreshTimer);
    refreshTimer = null;
  }
  paint();
}

function pinManageFund(id) {
  const order = [...state.manageFundOrderDraft];
  const idx = order.indexOf(id);
  if (idx <= 0) return;
  order.splice(idx, 1);
  order.unshift(id);
  state.manageFundOrderDraft = order;
  paint();
}

function moveManageFund(id, dir) {
  const order = [...state.manageFundOrderDraft];
  const idx = order.indexOf(id);
  if (idx < 0) return;
  const next = dir === 'up' ? idx - 1 : idx + 1;
  if (next < 0 || next >= order.length) return;
  [order[idx], order[next]] = [order[next], order[idx]];
  state.manageFundOrderDraft = order;
  paint();
}

function pinMetricColumn(key) {
  const order = [...state.metricColumnOrder];
  const idx = order.indexOf(key);
  if (idx <= 0) return;
  order.splice(idx, 1);
  order.unshift(key);
  state.metricColumnOrder = order;
  paint();
}

function moveMetricColumn(key, dir) {
  const order = [...state.metricColumnOrder];
  const idx = order.indexOf(key);
  if (idx < 0) return;
  const next = dir === 'up' ? idx - 1 : idx + 1;
  if (next < 0 || next >= order.length) return;
  [order[idx], order[next]] = [order[next], order[idx]];
  state.metricColumnOrder = order;
  paint();
}

function isLiveView() {
  return state.view === 'list' || state.view === 'detail' || state.view === 'detail-loading';
}

async function deleteManageSelected() {
  const ids = [...state.manageSelected];
  if (!ids.length) return;
  if (!window.confirm(`确定删除选中的 ${ids.length} 只基金？`)) return;
  try {
    for (const id of ids) {
      await deleteFundApi(id);
    }
    state.manageSelected = [];
    state.manageError = null;
    await reloadPortfolioAndLive();
    state.manageFundOrderDraft = FUNDS.filter((f) => f.accountId === state.activeScope).map((f) => f.id);
    paint();
  } catch (e) {
    state.manageError = e instanceof Error ? e.message : String(e);
    paint();
  }
}

function handleBack() {
  const route = parseRoute();
  if (route.type === 'fund-edit') {
    navigateTo({ type: 'detail', id: route.id });
    state.view = 'detail';
    paint();
    scheduleRefresh();
    return;
  }
  if (location.hash === '#manage/add') {
    navigateTo({ type: 'manage', tab: 'holdings' });
    state.view = 'manage';
    state.manageTab = 'holdings';
    paint();
    return;
  }
  if (route.type === 'manage') {
    navigateTo({ type: 'list', scope: state.activeScope });
    state.view = 'list';
    paint();
    scheduleRefresh();
    refreshListView();
    return;
  }
  if (route.type === 'detail' || state.view === 'detail' || state.view === 'detail-loading') {
    const fund = fundById(state.detailId);
    state.detailId = null;
    const scope = fund?.accountId && !fund.isMerged ? fund.accountId : state.activeScope;
    navigateTo({ type: 'list', scope });
    state.view = 'list';
    paint();
    scheduleRefresh();
    refreshListView();
    return;
  }
  navigateTo({ type: 'list', scope: state.activeScope });
  state.view = 'list';
  paint();
  scheduleRefresh();
}

async function syncRouteFromHash() {
  const route = parseRoute();
  state.manageError = null;
  state.fundEditError = null;

  if (route.type === 'list') {
    state.activeScope = route.scope || loadActiveScope();
    saveActiveScope(state.activeScope);
    state.detailId = null;
    state.view = 'list';
    applyDisplayScope();
    paint();
    return;
  }

  if (route.type === 'manage') {
    if (!isEditableScope(state.activeScope)) {
      navigateTo({ type: 'list', scope: SCOPE_ALL });
      state.view = 'list';
      paint();
      return;
    }
    state.view = route.tab === 'add' ? 'manage-add' : 'manage';
    state.manageTab = route.tab === 'headers' ? 'headers' : 'holdings';
    if (route.tab !== 'add') {
      const accountFunds = FUNDS.filter((f) => f.accountId === state.activeScope);
      const saved = loadFundOrder(state.activeScope);
      state.manageFundOrderDraft = saved.length
        ? [...saved, ...accountFunds.map((f) => f.id).filter((id) => !saved.includes(id))]
        : accountFunds.map((f) => f.id);
      state.manageSelected = [];
    }
    if (route.tab === 'add') state.configDraft = state.configDraft ?? defaultConfigDraft();
    paint();
    return;
  }

  if (route.type === 'fund-edit') {
    const fund = fundById(route.id);
    if (!fund || !canEditFund(fund)) {
      if (fund) navigateTo({ type: 'detail', id: route.id });
      else navigateTo({ type: 'list', scope: state.activeScope });
      state.view = fund ? 'detail' : 'list';
      paint();
      return;
    }
    state.detailId = route.id;
    state.view = 'fund-edit';
    paint();
    return;
  }

  if (route.type === 'detail') {
    if (!fundById(route.id)) {
      navigateTo({ type: 'list' });
      state.view = 'list';
      paint();
      return;
    }
    if (state.detailId === route.id && (state.view === 'detail' || state.view === 'detail-loading')) return;
    await openDetail(route.id);
  }
}

function renderFundRow(f) {
  const metricCols = orderedMetrics().map((col) => fundMetricCells(f, col.key)).join('');
  const metaLine =
    state.nameSubline === 'amount'
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

function defaultConfigDraft() {
  return { code: '', name: '', amount: '', totalProfit: '', yesterdayProfit: '' };
}

function setTextClass(el, cls) {
  if (!el) return;
  el.classList.remove('is-up', 'is-down', 'is-flat');
  if (cls) el.classList.add(cls);
}

function summaryAssetsLabel() {
  return '账户资产';
}

function patchSummaryRealtimeCol(colEl, s) {
  if (!colEl || !s) return;
  if (hasExtendedSummaryLayout(s)) {
    let split = colEl.querySelector('.yj-summary-rt-split');
    if (!split) {
      colEl.classList.add('yj-summary-col--rt-split');
      const label = colEl.querySelector('.yj-summary-label');
      colEl.innerHTML = `${label?.outerHTML ?? ''}${renderSummaryRealtimeBody(s)}`;
      return;
    }
    const rows = split.querySelectorAll('.metric-split-row');
    if (rows.length < 2) return;
    const rtCls = pctClass(s.totalRealTime);
    const patchRow = (rowEl, val, pct, signed = true) => {
      const cls = pctClass(signed ? val : pct);
      const valEl = rowEl.querySelector('.holding-val');
      const subEl = rowEl.querySelector('.holding-sub');
      if (valEl) {
        valEl.textContent = fmtMoney(val, signed);
        setTextClass(valEl, cls);
      }
      if (subEl) setPctSubEl(subEl, pct);
    };
    patchRow(rows[0], s.totalRealTime, s.totalRealTimePct);
    patchRow(rows[1], s.totalRealTimeExtended ?? 0, s.totalRealTimeExtendedPct ?? 0);
    return;
  }

  colEl.classList.remove('yj-summary-col--rt-split');
  const valEl = colEl.querySelector('.yj-summary-val');
  const subEl = colEl.querySelector('.yj-summary-sub');
  const rtCls = pctClass(s.totalRealTime);
  if (valEl) {
    valEl.textContent = fmtMoney(s.totalRealTime, true);
    setTextClass(valEl, rtCls);
  }
  if (subEl) setPctSubEl(subEl, s.totalRealTimePct);
}

function patchSummaryCol(col, { val, pct, signed = false, subText, subMuted = false, dateCol = null, summary = null }) {
  const colEl = document.querySelector(`[data-summary-col="${col}"]`);
  if (!colEl) return;

  const titles = {
    assets: summaryAssetsLabel(),
    realtime: '实时收益',
    daily: '当日收益',
    holding: '持有收益',
  };
  const labelEl = colEl.querySelector('.yj-summary-label');
  if (labelEl) {
    if (col === 'assets') {
      const textEl = labelEl.querySelector('.yj-summary-label-text');
      if (textEl) textEl.textContent = titles.assets;
      else if (!labelEl.querySelector('.privacy-toggle')) {
        labelEl.innerHTML = `<span class="yj-summary-label-text">${escapeHtml(titles.assets)}</span>${renderPrivacyToggle()}`;
      }
      patchPrivacyToggle();
    } else if (dateCol) {
      const dateLabel =
        state.displayContext?.tableHead?.[dateCol]?.label ??
        state.displayContext?.tableHead?.[dateCol]?.line1 ??
        '';
      labelEl.innerHTML = `${escapeHtml(titles[col] || '')}${dateLabel ? `<span class="yj-summary-date">${escapeHtml(dateLabel)}</span>` : ''}`;
    }
  }

  const valEl = colEl.querySelector('.yj-summary-val');
  const subEl = colEl.querySelector('.yj-summary-sub');

  if (col === 'realtime' && summary) {
    patchSummaryRealtimeCol(colEl, summary);
    return;
  }

  const valCls = pctClass(signed ? val : pct);

  if (valEl) {
    valEl.textContent = fmtMoney(val, signed);
    setTextClass(valEl, valCls);
  }
  if (!subEl) return;

  if (subText != null) {
    subEl.textContent = subText;
    subEl.classList.toggle('yj-summary-sub--muted', subMuted);
    if (!subMuted) setTextClass(subEl, valCls);
    else subEl.classList.remove('is-up', 'is-down', 'is-flat');
  } else {
    setPctSubEl(subEl, pct);
    subEl.classList.remove('yj-summary-sub--muted');
  }
}

function patchRealtimeMetricCell(cell, f) {
  if (!cell) return false;
  if (hasExtendedRealtimeLayout(f)) {
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

function rowHasSplitRealtime(row) {
  return Boolean(row?.querySelector('[data-col="realtime"].holding-col--split'));
}

function patchListDom() {
  const s = state.summary;
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

  const tableHead = state.displayContext?.tableHead;
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

  if (state.activeScope === SCOPE_SUMMARY) {
    patchIndexTicker();
    return patchAccountSummaryCards();
  }

  for (const f of state.displayRows) {
    const row = document.querySelector(`.holding-row[data-fund-id="${f.id}"]`);
    if (!row) return false;

    const amountEl = row.querySelector('.holding-amount');
    if (amountEl && state.nameSubline === 'amount') {
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

function reorderListRows() {
  const list = document.querySelector('.holding-list');
  if (!list) return;
  for (const f of state.displayRows) {
    const row = list.querySelector(`.holding-row[data-fund-id="${f.id}"]`);
    if (row) list.appendChild(row);
  }
}

function toggleSort(key) {
  state.useColumnSort = true;
  if (state.sortKey === key) {
    state.sortDir = state.sortDir === 'desc' ? 'asc' : 'desc';
  } else {
    state.sortKey = key;
    state.sortDir = 'desc';
  }
  applyDisplayScope();
  paint();
}

function canPatchListDom() {
  if (state.view !== 'list') return false;
  if (state.activeScope === SCOPE_SUMMARY) {
    return document.querySelectorAll('.account-summary-card[data-account-id]').length > 0;
  }
  const rows = document.querySelectorAll('.holding-row[data-fund-id]');
  if (rows.length === 0 || rows.length !== state.displayRows.length) return false;
  for (const f of state.displayRows) {
    const row = document.querySelector(`.holding-row[data-fund-id="${f.id}"]`);
    if (!row) return false;
    if (hasExtendedRealtimeLayout(f) !== rowHasSplitRealtime(row)) return false;
  }
  return true;
}

function patchAccountSummaryCards() {
  const cards = buildAccountSummaries(state.fundRows, ACCOUNTS);
  for (const acc of cards) {
    const card = document.querySelector(`.account-summary-card[data-account-id="${acc.id}"]`);
    if (!card) return false;

    const cols = card.querySelectorAll('.account-summary-col');
    const assetsCol = cols[0];
    const rtCol = cols[1];
    const dailyCol = cols[2];

    const holdingCls = pctClass(acc.totalHolding);
    const dailyCls = pctClass(acc.totalSettled);
    const rtCls = pctClass(acc.hasRealtime ? acc.totalRealTime : null);

    if (assetsCol) {
      const val = assetsCol.querySelector('.account-summary-val');
      const sub = assetsCol.querySelector('.account-summary-sub');
      if (val) val.textContent = fmtMoney(acc.totalAssets);
      if (sub) {
        sub.className = 'account-summary-sub account-summary-sub--combo';
        sub.innerHTML = `${fmtMoney(acc.totalHolding, true)} · ${renderPctPill(acc.totalHoldingPct)}`;
      }
    }

    if (rtCol) {
      patchSummaryTrendCounts(rtCol.querySelector('.account-summary-label-row'), acc.rtUp, acc.rtDown);
      if (acc.hasExtendedRealtime) {
        const split = rtCol.querySelector('[data-account-rt-split]');
        if (!split) return false;
        const rows = split.querySelectorAll('.metric-split-row');
        if (rows.length < 2) return false;
        const rtCls = pctClass(acc.hasRealtime ? acc.totalRealTime : null);
        const patchRow = (rowEl, val, pct, signed = true) => {
          const cls = pctClass(signed ? val : pct);
          const valEl = rowEl.querySelector('.holding-val');
          const subEl = rowEl.querySelector('.holding-sub');
          if (valEl) {
            valEl.textContent = fmtMoney(val, signed);
            setTextClass(valEl, cls);
          }
          if (subEl) setPctPillEl(subEl, pct);
        };
        patchRow(rows[0], acc.totalRealTime, acc.totalRealTimePct);
        patchRow(rows[1], acc.totalRealTimeExtended ?? 0, acc.totalRealTimeExtendedPct ?? 0);
      } else {
        const rtVal = rtCol.querySelector('.account-summary-val');
        const rtPct = rtCol.querySelector('[data-account-rt-pct], .account-summary-sub');
        const rtCls = pctClass(acc.hasRealtime ? acc.totalRealTime : null);
        if (rtVal) {
          rtVal.textContent = acc.hasRealtime ? fmtMoney(acc.totalRealTime, true) : '—';
          setTextClass(rtVal, rtCls);
        }
        if (rtPct) setPctPillEl(rtPct, acc.hasRealtime ? acc.totalRealTimePct : null);
      }
    }

    if (dailyCol) {
      patchSummaryTrendCounts(dailyCol.querySelector('.account-summary-label-row'), acc.up, acc.down);
      const val = dailyCol.querySelector('.account-summary-val');
      const sub = dailyCol.querySelector('.account-summary-sub');
      if (val) {
        val.textContent = fmtMoney(acc.totalSettled, true);
        setTextClass(val, dailyCls);
      }
      if (sub) setPctPillEl(sub, acc.totalSettledPct);
    }
  }
  return true;
}

function renderListPage() {
  const gridClass = portfolioGridClass();
  const dockClass = showIndexTicker() ? ' has-index-dock' : '';
  const sheetClass = state.indexDrawerOpen && showIndexTicker() ? ' index-sheet-open' : '';
  const indexMask = showIndexTicker() ? renderIndexSheetMask() : '';
  const scopeTabId = `account-tab-${state.activeScope}`;

  if (state.activeScope === SCOPE_SUMMARY) {
    const cards = buildAccountSummaries(state.fundRows, ACCOUNTS)
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

  const rows = state.displayRows.map((f) => renderFundRow(f)).join('');
  const listBody =
    rows ||
    renderEmptyState({
      title: '暂无持仓',
      hint: isEditableScope(state.activeScope) ? '可在列表配置中添加基金' : '该视图暂无基金数据',
      actionId: isEditableScope(state.activeScope) ? 'btn-empty-add-fund' : '',
      actionLabel: isEditableScope(state.activeScope) ? '添加基金' : '',
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

function renderSubpageNav(title, { backId = 'btn-back', rightHtml = '' } = {}) {
  return `
    <nav class="subpage-nav">
      <div class="subpage-nav-side subpage-nav-side--start">
        <button type="button" class="subpage-nav-back" id="${backId}" aria-label="返回">
          <span class="subpage-nav-back-icon" aria-hidden="true">‹</span>
        </button>
      </div>
      <h1 class="subpage-nav-title">${escapeHtml(title)}</h1>
      <div class="subpage-nav-side subpage-nav-side--end">
        ${rightHtml}${renderThemeToggle()}
      </div>
    </nav>`;
}

function renderManageTabs(active) {
  return `
    <div class="manage-tabs" role="tablist">
      <button type="button" class="manage-tab ${active === 'holdings' ? 'is-active' : ''}" data-manage-tab="holdings" role="tab" id="manage-tab-holdings" aria-selected="${active === 'holdings' ? 'true' : 'false'}" aria-controls="manage-panel">持有管理</button>
      <button type="button" class="manage-tab ${active === 'headers' ? 'is-active' : ''}" data-manage-tab="headers" role="tab" id="manage-tab-headers" aria-selected="${active === 'headers' ? 'true' : 'false'}" aria-controls="manage-panel">表头设置</button>
    </div>`;
}

function renderManageHoldingsTab() {
  const accountFunds = FUNDS.filter((f) => f.accountId === state.activeScope);
  const order = state.manageFundOrderDraft.length
    ? state.manageFundOrderDraft
    : accountFunds.map((f) => f.id);
  const byId = new Map(accountFunds.map((f) => [f.id, f]));
  const items = order
    .map((id) => byId.get(id))
    .filter(Boolean)
    .map((f, idx) => {
      const checked = state.manageSelected.includes(f.id);
      return `
      <li class="manage-fund-item" data-fund-id="${f.id}">
        <label class="manage-check">
          <input type="checkbox" class="manage-fund-check" data-fund-id="${f.id}" ${checked ? 'checked' : ''} />
          <span class="manage-check-ui"></span>
        </label>
        <div class="manage-fund-main">
          <p class="manage-fund-name">${escapeHtml(f.name)}</p>
          <p class="manage-fund-code">${escapeHtml(f.code)}</p>
        </div>
        <div class="manage-fund-actions">
          <button type="button" class="manage-icon-btn" data-fund-pin="${f.id}" title="置顶" aria-label="置顶">↑</button>
          <button type="button" class="manage-icon-btn" data-fund-up="${f.id}" ${idx === 0 ? 'disabled' : ''} aria-label="上移">≡</button>
        </div>
      </li>`;
    })
    .join('');

  const allSelected = order.length > 0 && state.manageSelected.length === order.length;

  return `
    <div class="manage-toolbar">
      <label class="manage-select-all">
        <input type="checkbox" id="manage-select-all" ${allSelected ? 'checked' : ''} />
        <span>全选</span>
      </label>
      <span class="manage-toolbar-hint">置顶 · 排序</span>
    </div>
    <ul class="manage-fund-list">${items}</ul>
    <footer class="manage-footer">
      <button type="button" class="manage-footer-btn" id="btn-manage-delete" ${state.manageSelected.length ? '' : 'disabled'}>删除</button>
      <button type="button" class="manage-footer-btn manage-footer-btn--primary" id="btn-manage-done">完成</button>
    </footer>`;
}

function renderManageHeadersTab() {
  const amountOn = state.nameSubline === 'amount';
  const colRows = state.metricColumnOrder
    .map((key, idx) => {
      const col = metricColumnDef(key);
      const visible = state.metricColumnVisible[key] !== false;
      return `
      <li class="manage-header-item" data-col-key="${key}">
        <span class="manage-header-name">${escapeHtml(col.title)}</span>
        <button type="button" class="manage-icon-btn ${visible ? 'is-on' : ''}" data-col-visible="${key}" title="显示" aria-label="${visible ? '隐藏列' : '显示列'}">${visible ? '<svg class="manage-eye-icon" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"/></svg>' : '—'}</button>
        <button type="button" class="manage-icon-btn" data-col-pin="${key}" ${idx === 0 ? 'disabled' : ''} aria-label="置顶">↑</button>
        <button type="button" class="manage-icon-btn" data-col-up="${key}" ${idx === 0 ? 'disabled' : ''} aria-label="上移">≡</button>
      </li>`;
    })
    .join('');

  return `
    <div class="manage-prefs">
      <label class="manage-switch-row">
        <span>显示 基金名称 + 持有金额</span>
        <input type="radio" name="name-subline" value="amount" ${amountOn ? 'checked' : ''} />
      </label>
    </div>
    <div class="manage-header-table-head">
      <span>表头名称</span><span>显示</span><span>置顶</span><span>排序</span>
    </div>
    <ul class="manage-header-list">${colRows}</ul>
    <footer class="manage-footer manage-footer--single">
      <button type="button" class="manage-footer-btn manage-footer-btn--primary" id="btn-manage-done">完成</button>
    </footer>`;
}

function renderManageAddPage() {
  const draft = state.configDraft ?? defaultConfigDraft();
  return renderShell(
    `
    <section class="subpage manage-page">
      ${renderSubpageNav('添加基金')}
      <div class="subpage-body">
        ${state.manageError ? `<p class="sheet-error">${escapeHtml(state.manageError)}</p>` : ''}
        <div class="form-grid form-grid--page">
          <label class="form-field form-field--full">
            <span class="form-label">基金代码</span>
            <input class="form-input" id="add-fund-code" inputmode="numeric" maxlength="6" placeholder="6位，如 022184" value="${escapeHtml(draft.code)}" />
          </label>
          <label class="form-field form-field--full">
            <span class="form-label">名称（可选）</span>
            <input class="form-input" id="add-fund-name" placeholder="留空自动识别" value="${escapeHtml(draft.name)}" />
          </label>
          <label class="form-field">
            <span class="form-label">持仓金额</span>
            <input class="form-input" id="add-fund-amount" inputmode="decimal" value="${escapeHtml(draft.amount)}" />
          </label>
          <label class="form-field">
            <span class="form-label">持有收益</span>
            <input class="form-input" id="add-fund-total-profit" inputmode="decimal" value="${escapeHtml(draft.totalProfit)}" />
          </label>
          <label class="form-field form-field--full">
            <span class="form-label">当日收益（可选）</span>
            <input class="form-input" id="add-fund-daily-profit" inputmode="decimal" value="${escapeHtml(draft.yesterdayProfit)}" />
          </label>
        </div>
        <div class="fund-edit-page-actions">
          <button type="button" class="sheet-btn sheet-btn--primary" id="btn-add-fund-submit"${state.formBusy ? ' disabled' : ''}>${state.formBusy ? '提交中…' : '确认添加'}</button>
        </div>
      </div>
    </section>`,
  );
}

function renderManagePage() {
  const tab = state.manageTab === 'headers' ? 'headers' : 'holdings';
  const body = tab === 'headers' ? renderManageHeadersTab() : renderManageHoldingsTab();
  const accountName = accountById(state.activeScope)?.name ?? '账户';

  return renderShell(
    `
    <section class="subpage manage-page">
      ${renderSubpageNav(`${accountName} · 持有配置`, {
        rightHtml: `<button type="button" class="subpage-nav-link" id="btn-manage-add">添加基金</button>`,
      })}
      ${renderManageTabs(tab)}
      <div class="manage-body" id="manage-panel" role="tabpanel" aria-labelledby="manage-tab-${tab}">
        ${state.manageError ? `<p class="sheet-error">${escapeHtml(state.manageError)}</p>` : ''}
        ${body}
      </div>
    </section>`,
  );
}

function renderFundEditPage() {
  const fund = fundById(state.detailId);
  if (!fund) return renderLoading();

  return renderShell(
    `
    <section class="subpage fund-edit-page">
      ${renderSubpageNav('编辑持仓')}
      <div class="subpage-body">
        ${state.fundEditError ? `<p class="sheet-error">${escapeHtml(state.fundEditError)}</p>` : ''}
        <p class="fund-edit-hint">${escapeHtml(fund.name)} · ${escapeHtml(fund.code)}</p>
        <div class="form-grid form-grid--page">
          <label class="form-field form-field--full">
            <span class="form-label">基金名称</span>
            <input class="form-input" id="edit-fund-name" value="${escapeHtml(fund.name)}" />
          </label>
          <label class="form-field">
            <span class="form-label">持仓金额</span>
            <input class="form-input" id="edit-fund-amount" inputmode="decimal" value="${fund.amount}" />
          </label>
          <label class="form-field">
            <span class="form-label">持有收益</span>
            <input class="form-input" id="edit-fund-total-profit" inputmode="decimal" value="${fund.totalProfit}" />
          </label>
          <label class="form-field form-field--full">
            <span class="form-label">当日收益</span>
            <input class="form-input" id="edit-fund-daily-profit" inputmode="decimal" value="${fund.yesterdayProfit ?? 0}" />
          </label>
        </div>
        <div class="fund-edit-page-actions">
          <button type="button" class="sheet-btn sheet-btn--primary" id="btn-save-fund"${state.formBusy ? ' disabled' : ''}>${state.formBusy ? '保存中…' : '保存'}</button>
          <button type="button" class="sheet-btn sheet-btn--danger" id="btn-delete-fund"${state.formBusy ? ' disabled' : ''}>删除基金</button>
        </div>
      </div>
    </section>`,
  );
}

function renderDetailNav(title, { showEdit = false } = {}) {
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

function renderDetailMetric(label, val, pct, { signed = false, metrics = null, dual = false } = {}) {
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

function renderDetailHero(fund, metrics) {
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
  return `
    <section class="detail-hero ${cls}">
      <p class="detail-hero-code">${escapeHtml(fund.code)}</p>
      <p class="detail-hero-label">估值涨跌</p>
      ${pctBlock}
      <p class="detail-hero-amount">持仓 ${fmtHoldAmount(fund.amount)}</p>
    </section>`;
}

function renderDetailStats(metrics) {
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
          return renderDetailMetric(col.title, metrics.totalProfit, metrics.totalProfitPct, { signed: true });
        })
        .join('')}
    </section>`;
}

function renderDetailLoading(fund) {
  return renderShell(
    `
    <section class="detail-page">
      ${renderDetailNav(fund.name)}
      <section class="detail-hero is-flat">
        <p class="detail-hero-code">${escapeHtml(fund.code)}</p>
        <p class="detail-hero-label">估值涨跌</p>
        <p class="detail-hero-pct is-flat">—</p>
        <p class="detail-hero-amount">持仓 ${fmtHoldAmount(fund.amount)}</p>
      </section>
      <section class="state-card state-card--inline">
        <p class="state-text">正在拉取持仓穿透…</p>
      </section>
    </section>`,
  );
}

function renderDetailPage() {
  const fund = fundById(state.detailId);
  if (!fund || !state.detail) return renderLoading();

  const { note } = state.detail;
  const holdings = getSortedDetailHoldings();
  const metrics = detailFundMetrics(fund);
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
    <section class="detail-page">
      ${renderDetailNav(fund.name, { showEdit: canEditFund(fund) })}
      ${renderLiveBanner()}
      ${renderDetailHero(fund, metrics)}
      ${renderDetailStats(metrics)}
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

function paint() {
  const root = document.getElementById('app');
  if (!root) return;

  const preserveListScroll = state.view === 'list';
  const listScrollTop = preserveListScroll
    ? document.getElementById('holding-list-scroll')?.scrollTop ?? 0
    : 0;

  if (state.view !== 'list') {
    state.indexDrawerOpen = false;
  }

  if (state.view === 'loading') root.innerHTML = renderLoading();
  else if (state.view === 'error') root.innerHTML = renderError(state.error || '未知错误');
  else if (state.view === 'list') root.innerHTML = renderListPage();
  else if (state.view === 'manage') root.innerHTML = renderManagePage();
  else if (state.view === 'manage-add') root.innerHTML = renderManageAddPage();
  else if (state.view === 'fund-edit') root.innerHTML = renderFundEditPage();
  else if (state.view === 'detail-loading') {
    const fund = fundById(state.detailId);
    root.innerHTML = fund ? renderDetailLoading(fund) : renderLoading();
  } else if (state.view === 'detail') root.innerHTML = renderDetailPage();
  else root.innerHTML = renderLoading();

  bindEvents();
  if (showIndexTicker()) startIndexDockCarousel();
  else stopIndexDockCarousel();
  if (isLiveView()) scheduleRefresh();

  if (preserveListScroll) {
    const scrollEl = document.getElementById('holding-list-scroll');
    if (scrollEl) {
      scrollEl.scrollTop = listScrollTop;
      requestAnimationFrame(() => {
        scrollEl.scrollTop = listScrollTop;
      });
    }
  }
}

function patchThemeToggle() {
  const label = themeToggleLabel();
  document.querySelectorAll('.theme-toggle').forEach((btn) => {
    btn.setAttribute('title', `切换${label}模式`);
    btn.setAttribute('aria-label', `切换${label}模式`);
    btn.querySelector('.theme-toggle-label')?.remove();
    const iconEl = btn.querySelector('.theme-toggle-icon');
    if (iconEl) {
      const wrap = document.createElement('span');
      wrap.innerHTML = themeToggleIconMarkup();
      const next = wrap.firstElementChild;
      if (next) iconEl.replaceWith(next);
    }
  });
}

function patchManageSelection() {
  const order = state.manageFundOrderDraft.length
    ? state.manageFundOrderDraft
    : FUNDS.filter((f) => f.accountId === state.activeScope).map((f) => f.id);
  const allSelected = order.length > 0 && state.manageSelected.length === order.length;
  const selectAll = document.getElementById('manage-select-all');
  if (selectAll) selectAll.checked = allSelected;
  const deleteBtn = document.getElementById('btn-manage-delete');
  if (deleteBtn) deleteBtn.disabled = state.manageSelected.length === 0;
  document.querySelectorAll('.manage-fund-check').forEach((input) => {
    const id = parseInt(input.getAttribute('data-fund-id') || '', 10);
    if (id) input.checked = state.manageSelected.includes(id);
  });
}

function setFormBusy(busy) {
  state.formBusy = busy;
  document.querySelectorAll('#btn-add-fund-submit, #btn-save-fund, #btn-delete-fund').forEach((btn) => {
    if (btn) btn.disabled = busy;
  });
}

function bindEvents() {
  document.getElementById('btn-index-dock')?.addEventListener('click', () => openIndexDrawer());
  document.getElementById('btn-index-drawer-close')?.addEventListener('click', () => closeIndexDrawer());
  document.getElementById('index-sheet-mask')?.addEventListener('click', () => closeIndexDrawer());
  document.querySelectorAll('.index-drawer-tab').forEach((btn) => {
    btn.addEventListener('click', () => {
      const tab = btn.getAttribute('data-index-tab');
      if (!tab || tab === state.indexDrawerTab) return;
      state.indexDrawerTab = tab;
      patchIndexDrawerTab();
    });
  });
  syncIndexDrawerUi();

  document.getElementById('btn-theme')?.addEventListener('click', () => {
    toggleTheme();
    patchThemeToggle();
  });

  document.getElementById('btn-live-retry')?.addEventListener('click', () => {
    state.liveBannerDismissed = false;
    if (state.view === 'list') void refreshListView();
    else if (state.view === 'detail' || state.view === 'detail-loading') void refreshDetailView();
  });

  document.getElementById('btn-live-dismiss')?.addEventListener('click', () => {
    state.liveBannerDismissed = true;
    patchLiveBanner();
  });

  document.getElementById('btn-empty-add-fund')?.addEventListener('click', () => openManagePage('holdings'));

  document.getElementById('btn-retry')?.addEventListener('click', () => bootstrap());

  document.getElementById('btn-back')?.addEventListener('click', () => handleBack());

  document.querySelectorAll('.list-table-head-sort[data-sort-key]').forEach((btn) => {
    btn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      const key = btn.getAttribute('data-sort-key');
      if (key) toggleSort(key);
    });
  });

  document.querySelectorAll('.table-head-sort[data-holdings-sort-key]').forEach((btn) => {
    btn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      const key = btn.getAttribute('data-holdings-sort-key');
      if (key) toggleHoldingsSort(key);
    });
  });

  document.querySelectorAll('.holding-row[data-fund-id]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = parseInt(btn.getAttribute('data-fund-id') || '', 10);
      if (!id) return;
      navigateTo({ type: 'detail', id });
      openDetail(id);
    });
  });

  document.querySelectorAll('.account-summary-card[data-account-scope]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const scope = btn.getAttribute('data-account-scope');
      if (!scope) return;
      activateAccountScope(scope);
    });
  });

  document.querySelector('.account-tabs-bar')?.addEventListener('click', onAccountTabsBarClick);
  setupAccountTabsLayout();

  document.getElementById('btn-list-config')?.addEventListener('click', (ev) => {
    ev.stopPropagation();
    openManagePage('holdings');
  });

  document.getElementById('btn-detail-edit')?.addEventListener('click', () => {
    const fund = fundById(state.detailId);
    if (!fund || !canEditFund(fund)) return;
    navigateTo({ type: 'fund-edit', id: state.detailId });
    state.view = 'fund-edit';
    state.fundEditError = null;
    paint();
    if (refreshTimer) clearInterval(refreshTimer);
    refreshTimer = null;
  });

  document.querySelectorAll('[data-manage-tab]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const tab = btn.getAttribute('data-manage-tab');
      state.manageTab = tab;
      state.view = 'manage';
      navigateTo({ type: 'manage', tab });
      paint();
    });
  });

  document.getElementById('btn-manage-add')?.addEventListener('click', () => {
    state.configDraft = state.configDraft ?? defaultConfigDraft();
    state.manageError = null;
    navigateTo({ type: 'manage', tab: 'add' });
    state.view = 'manage-add';
    paint();
  });

  document.getElementById('btn-manage-done')?.addEventListener('click', () => finishManagePage());

  document.getElementById('manage-select-all')?.addEventListener('change', (ev) => {
    const order = state.manageFundOrderDraft.length
      ? state.manageFundOrderDraft
      : FUNDS.filter((f) => f.accountId === state.activeScope).map((f) => f.id);
    state.manageSelected = ev.target.checked ? [...order] : [];
    patchManageSelection();
  });

  document.querySelectorAll('.manage-fund-check').forEach((input) => {
    input.addEventListener('change', () => {
      const id = parseInt(input.getAttribute('data-fund-id') || '', 10);
      if (!id) return;
      if (input.checked) {
        if (!state.manageSelected.includes(id)) state.manageSelected.push(id);
      } else {
        state.manageSelected = state.manageSelected.filter((x) => x !== id);
      }
      patchManageSelection();
    });
  });

  document.querySelectorAll('[data-fund-pin]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = parseInt(btn.getAttribute('data-fund-pin') || '', 10);
      if (id) pinManageFund(id);
    });
  });

  document.querySelectorAll('[data-fund-up]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = parseInt(btn.getAttribute('data-fund-up') || '', 10);
      if (id) moveManageFund(id, 'up');
    });
  });

  document.getElementById('btn-manage-delete')?.addEventListener('click', () => deleteManageSelected());

  document.querySelectorAll('[data-col-visible]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const key = btn.getAttribute('data-col-visible');
      if (!key) return;
      state.metricColumnVisible[key] = state.metricColumnVisible[key] === false;
      paint();
    });
  });

  document.querySelectorAll('[data-col-pin]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const key = btn.getAttribute('data-col-pin');
      if (key) pinMetricColumn(key);
    });
  });

  document.querySelectorAll('[data-col-up]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const key = btn.getAttribute('data-col-up');
      if (key) moveMetricColumn(key, 'up');
    });
  });

  document.querySelectorAll('input[name="name-subline"]').forEach((input) => {
    input.addEventListener('change', () => {
      if (input.checked) state.nameSubline = input.value;
    });
  });

  document.getElementById('btn-add-fund-submit')?.addEventListener('click', () => submitAddFund());

  document.getElementById('btn-save-fund')?.addEventListener('click', () => submitSaveFund());
  document.getElementById('btn-delete-fund')?.addEventListener('click', () => submitDeleteFund());
}

async function loadPortfolioState() {
  const [data, status] = await Promise.all([
    fetchPortfolio(),
    fetch('/api/status').then((r) => r.json()).catch(() => null),
  ]);
  PORTFOLIO_META = data.meta ?? {};
  FUNDS = data.funds;
  ACCOUNTS = (data.accounts ?? []).slice().sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  state.serverStatus = status;
  state.portfolioUpdatedAt =
    PORTFOLIO_META.lastAutoSettleAt ?? PORTFOLIO_META.importedAt ?? null;
}

function applyLive(live) {
  state.lastLive = live;
  state.indices = live.indices ?? [];
  state.fxPct = live.fxPct;
  state.updatedAt = live.updatedAt || fmtTime();
  state.quoteUpdatedAt = live.quoteUpdatedAt || live.updatedAt || state.updatedAt;
  state.displayContext = live.displayContext ?? state.displayContext;
  if (live.error) {
    state.liveBanner = live.error;
    state.liveBannerDismissed = false;
  } else if (state.view !== 'loading') {
    state.liveBanner = null;
  }
  state.fundRows = mergeLiveIntoFunds(live);
  applyDisplayScope();
  if (state.serverStatus?.live) {
    state.serverStatus.live.beijingDate = live.beijingDate ?? state.serverStatus.live.beijingDate;
  }
}

async function reloadPortfolioAndLive() {
  await loadPortfolioState();
  const live = await fetchLive();
  applyLive(live);
}

async function refreshListView() {
  if (state.busy) {
    refreshPending = true;
    return;
  }
  state.busy = true;
  try {
    const live = await fetchLive();
    if (
      live.portfolioUpdatedAt &&
      live.portfolioUpdatedAt !== state.portfolioUpdatedAt
    ) {
      state.portfolioUpdatedAt = live.portfolioUpdatedAt;
      await loadPortfolioState();
    }
    applyLive(live);
    if (state.view === 'loading') state.view = 'list';
    if (canPatchListDom() && patchListDom()) return;
    paint();
  } catch (e) {
    state.liveBanner = e instanceof Error ? e.message : String(e);
    state.liveBannerDismissed = false;
    if (state.view === 'loading') {
      state.error = state.liveBanner;
      state.view = 'error';
      paint();
    } else if (!patchLiveBanner()) {
      paint();
    }
  } finally {
    state.busy = false;
    if (refreshPending) {
      refreshPending = false;
      void refreshListView();
    }
  }
}

async function loadDetail(id) {
  const fund = fundById(id);
  if (!fund) throw new Error('基金不存在');

  const live = await fetchLive();
  const liveRow = live.funds.find((x) => x.id === id);
  const detail = await fetchFundDetail(fund.code);

  state.detail = {
    impactPct: detail.impactPct ?? liveRow?.impactPct ?? null,
    holdings: detail.holdings ?? [],
    note: detail.note ?? '',
  };
}

async function openDetail(id) {
  state.detailId = id;
  state.holdingsSortKey = 'weight';
  state.holdingsSortDir = 'desc';
  state.fundEditError = null;
  state.detailHoldingsAt = '';
  lastDetailHoldingsFetchAt = 0;
  state.view = 'detail-loading';
  paint();
  scheduleRefresh();

  try {
    await loadDetail(id);
    lastDetailHoldingsFetchAt = Date.now();
    state.detailHoldingsAt = state.updatedAt || fmtTime();
    state.view = 'detail';
  } catch (e) {
    state.error = e instanceof Error ? e.message : String(e);
    state.view = 'error';
  }
  paint();
}

function canPatchDetailDom() {
  if (state.view !== 'detail' || !document.getElementById('holdings-list-scroll')) return false;
  const row = state.fundRows.find((f) => f.id === state.detailId);
  if (shouldShowExtendedMetric(row)) return false;
  if (getSortedDetailHoldings().some(holdingShowsDualChange)) return false;
  return true;
}

function patchDetailMetricsDom() {
  const fund = fundById(state.detailId);
  if (!fund || !state.detail) return false;

  const metrics = detailFundMetrics(fund);
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
    if (amountEl) amountEl.textContent = `持仓 ${fmtHoldAmount(fund.amount)}`;
  }

  const statsEl = document.querySelector('.detail-stats');
  if (statsEl) {
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
    metaEl.innerHTML = detailHoldingsMetaHtml(state.detail.holdings.length);
  }

  patchStatusStripTimes();
  return true;
}

function patchDetailDom() {
  const fund = fundById(state.detailId);
  if (!fund || !state.detail) return false;
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

async function refreshDetailView() {
  if (!state.detailId) return;
  if (state.busy) {
    refreshPending = true;
    return;
  }
  state.busy = true;
  try {
    const live = await fetchLive();
    applyLive(live);
    const holdingsDue =
      !state.detail || Date.now() - lastDetailHoldingsFetchAt >= DETAIL_HOLDINGS_REFRESH_MS;
    if (holdingsDue) {
      await loadDetail(state.detailId);
      lastDetailHoldingsFetchAt = Date.now();
      state.detailHoldingsAt = live.updatedAt || fmtTime();
    }
    if (state.view === 'detail-loading') state.view = 'detail';
    if (!holdingsDue && patchDetailMetricsDom()) return;
    if (canPatchDetailDom() && patchDetailDom()) return;
    const scrollTop = document.getElementById('holdings-list-scroll')?.scrollTop ?? 0;
    paint();
    const scrollEl = document.getElementById('holdings-list-scroll');
    if (scrollEl) scrollEl.scrollTop = scrollTop;
  } catch (e) {
    state.liveBanner = e instanceof Error ? e.message : String(e);
    state.liveBannerDismissed = false;
    if (!patchLiveBanner()) paint();
  } finally {
    state.busy = false;
    if (refreshPending) {
      refreshPending = false;
      void refreshDetailView();
    }
  }
}

function scheduleRefresh() {
  if (refreshTimer) clearInterval(refreshTimer);
  refreshTimer = null;
  if (!isLiveView()) {
    stopIndexDockCarousel();
    return;
  }
  refreshTimer = setInterval(() => {
    if (state.detailId && (state.view === 'detail' || state.view === 'detail-loading')) refreshDetailView();
    else if (state.view === 'list') refreshListView();
  }, REFRESH_MS);
}

async function bootstrap() {
  setupPrivacyClick();
  state.view = 'loading';
  state.error = null;
  paint();

  try {
    await loadPortfolioState();
    const live = await fetchLive();
    applyLive(live);
    await syncRouteFromHash();
    if (isLiveView()) scheduleRefresh();
  } catch (e) {
    state.error = e instanceof Error ? e.message : String(e);
    state.view = 'error';
    paint();
  }
}

window.addEventListener('hashchange', () => {
  syncRouteFromHash().then(() => {
    if (isLiveView()) scheduleRefresh();
    else if (refreshTimer) {
      clearInterval(refreshTimer);
      refreshTimer = null;
    }
  });
});

initTheme();
initIndexDrawerGlobalListeners();
bootstrap();
