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
const DETAIL_REFRESH_MS = 3_000;

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
  displayContext: null,
  metricColumnOrder: loadMetricColumnOrder(),
  metricColumnVisible: loadMetricColumnVisible(),
  nameSubline: loadNameSubline(),
  hideAssets: loadHideAssets(),
  sortKey: 'amount',
  sortDir: 'desc',
  accountTabsMenuOpen: false,
};

let refreshTimer = null;
let refreshPending = false;

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
  if (state.view === 'list' && state.activeScope === SCOPE_SUMMARY) {
    paint();
    return;
  }
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
    profit: (amount * impactPct) / 100,
    pct: impactPct,
  };
}

function enrichFundRow(f, liveRow = null) {
  const settledProfit = liveRow?.settledProfit ?? f.yesterdayProfit ?? null;
  const settledPct = liveRow?.settledPct ?? dayProfitPct(f.amount, f.yesterdayProfit);
  const settledNavDate = liveRow?.settledNavDate ?? f.lastNavDate ?? null;
  return {
    ...f,
    settledProfit,
    settledPct,
    settledNavDate,
    settledSource: liveRow?.settledSource ?? 'portfolio',
  };
}

function buildSummary(rows) {
  const settledAssets = rows.reduce((s, f) => s + (f.amount ?? 0), 0);
  const realtimeAssets = rows.reduce((s, f) => {
    const rt =
      f.realTimeProfit != null && Number.isFinite(f.realTimeProfit) ? f.realTimeProfit : 0;
    return s + (f.amount ?? 0) + rt;
  }, 0);
  const totalSettled = rows.reduce((s, f) => s + (f.settledProfit ?? 0), 0);
  const totalSettledPct = dayProfitPct(settledAssets, totalSettled);
  const totalRealTime = rows.reduce(
    (s, f) => s + (f.realTimeProfit != null && Number.isFinite(f.realTimeProfit) ? f.realTimeProfit : 0),
    0,
  );
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
  };
}

function mergeLiveIntoFunds(live) {
  const byId = new Map(live.funds.map((x) => [x.id, x]));
  const rows = FUNDS.map((f) => {
    const liveRow = byId.get(f.id);
    const base = enrichFundRow(f, liveRow);
    const impactPct = liveRow?.impactPct ?? null;
    const rt = calcRealTime(f.amount, impactPct);
    return {
      ...base,
      impactPct,
      realTimeProfit: rt.profit,
      realTimePct: rt.pct,
      realtimeActive: liveRow?.realtimeActive ?? false,
      marketLabel: liveRow?.marketLabel ?? '',
      dailyAsOfLabel: liveRow?.dailyAsOfLabel ?? '',
      dailyHint: liveRow?.dailyHint ?? '',
      market: liveRow?.market ?? '',
      displayAmount: f.amount,
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
    <button type="button" class="theme-toggle" id="btn-theme" aria-label="切换深色/浅色模式" title="切换${label}模式">
      ${themeToggleIconMarkup()}
      <span class="theme-toggle-label">${label}</span>
    </button>`;
}

function renderPhoneChrome() {
  return `<div class="phone-chrome">${renderThemeToggle()}</div>`;
}

function renderShell(inner) {
  return `<div class="app-shell"><main class="phone-page">${inner}</main></div>`;
}

function renderLoading() {
  return renderShell(`${renderPhoneChrome()}
    <section class="state-card">
      <p class="state-title">加载中...</p>
      <p class="state-text">正在连接服务端并拉取估值</p>
    </section>`);
}

function renderError(msg) {
  return renderShell(`${renderPhoneChrome()}
    <section class="state-card">
      <p class="state-title">加载失败</p>
      <p class="state-text">${escapeHtml(msg)}</p>
      <p class="state-text state-text--hint">请确认已运行 <code>npm run dev</code> 或 <code>npm start</code>（需先 build）</p>
      <button type="button" class="retry-button" id="btn-retry">重试</button>
    </section>`);
}

function showIndexTicker() {
  return state.view === 'list' && state.activeScope === SCOPE_SUMMARY && state.indices.length > 0;
}

function renderIndexTicker() {
  if (!showIndexTicker()) return '';
  const items = state.indices
    .map(
      (it) => `
      <span class="index-ticker-item">
        <span class="index-ticker-name">${escapeHtml(it.label)}</span>
        <span class="index-ticker-val ${pctClass(it.changePct)}">${fmtPct(it.changePct)}</span>
      </span>`,
    )
    .join('');
  return `<footer class="index-ticker">${items}</footer>`;
}

function patchIndexTicker() {
  if (!showIndexTicker()) return true;
  const ticker = document.querySelector('.index-ticker');
  if (!ticker) return false;
  const items = ticker.querySelectorAll('.index-ticker-item');
  if (items.length !== state.indices.length) return false;
  state.indices.forEach((it, i) => {
    const item = items[i];
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
  const impactPct = state.detail?.impactPct ?? row?.impactPct ?? null;
  const rt = calcRealTime(fund.amount, impactPct);
  const settledProfit = row?.settledProfit ?? fund.yesterdayProfit ?? null;
  const settledPct = row?.settledPct ?? dayProfitPct(fund.amount, settledProfit);
  return {
    impactPct,
    realTimeProfit: rt.profit,
    realTimePct: rt.pct,
    settledProfit,
    settledPct,
    totalProfit: fund.totalProfit,
    totalProfitPct: fund.totalProfitPct,
  };
}

function marketStatusHint() {
  const openMarkets = [...new Set(state.fundRows.filter((f) => f.realtimeActive).map((f) => f.marketLabel))];
  return openMarkets.length ? `盘中 · ${openMarkets.join('/')}` : '休市';
}

function visibleMetrics() {
  return visibleMetricColumns(state.metricColumnOrder, state.metricColumnVisible);
}

function orderedMetrics() {
  return visibleMetrics();
}

function listGridTemplate() {
  const n = visibleMetrics().length;
  if (n >= 3) return 'minmax(0, 1.48fr) minmax(76px, 0.78fr) minmax(76px, 0.78fr) minmax(76px, 0.78fr)';
  if (n === 2) return 'minmax(0, 1.52fr) minmax(82px, 0.84fr) minmax(82px, 0.84fr)';
  if (n === 1) return 'minmax(0, 1.58fr) minmax(88px, 0.9fr)';
  return 'minmax(0, 1fr)';
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
  return (
    f.realtimeActive &&
    f.realTimeProfit != null &&
    Number.isFinite(f.realTimeProfit)
  );
}

function fundMetricCells(f, key) {
  const rtCls = pctClass(hasRealtimeProfit(f) ? f.realTimeProfit : null);
  const stCls = pctClass(f.settledProfit);
  const thCls = pctClass(f.totalProfit);
  switch (key) {
    case 'realtime':
      return `
      <div class="holding-col holding-col--rt" data-col="realtime">
        <p class="holding-val ${rtCls}">${fmtMoney(hasRealtimeProfit(f) ? f.realTimeProfit : null, true)}</p>
        <p class="holding-sub ${rtCls}">${hasRealtimeProfit(f) ? fmtPct(f.realTimePct) : '—'}</p>
      </div>`;
    case 'daily':
      return `
      <div class="holding-col holding-col--settled" data-col="daily">
        <p class="holding-val ${stCls}">${fmtMoney(f.settledProfit, true)}</p>
        <p class="holding-sub ${stCls}">${fmtPct(f.settledPct)}</p>
      </div>`;
    case 'holding':
      return `
      <div class="holding-col holding-col--total" data-col="holding">
        <p class="holding-val ${thCls}">${fmtMoney(f.totalProfit, true)}</p>
        <p class="holding-sub ${thCls}">${fmtPct(f.totalProfitPct)}</p>
      </div>`;
    default:
      return '';
  }
}

function renderAccountTabButton(t) {
  return `
    <button type="button" class="account-tab ${state.activeScope === t.scope ? 'is-active' : ''}" data-account-scope="${t.scope}">
      ${escapeHtml(t.label)}
    </button>`;
}

function accountTabsAll() {
  return [
    { scope: SCOPE_SUMMARY, label: '账户概况' },
    { scope: SCOPE_ALL, label: '全部持仓' },
    ...ACCOUNTS.map((a) => ({ scope: a.id, label: a.name })),
  ];
}

function sumTabWidths(widths, indices) {
  return indices.reduce((sum, i) => sum + widths[i], 0);
}

/** @param {number[]} widths @param {number} budget @param {number} activeIdx */
function computeVisibleTabIndices(widths, budget, activeIdx) {
  const n = widths.length;
  /** @type {number[]} */
  let visible = [];
  let used = 0;
  for (let i = 0; i < n; i++) {
    if (used + widths[i] <= budget) {
      visible.push(i);
      used += widths[i];
    } else break;
  }
  if (visible.includes(activeIdx)) return visible;

  visible.push(activeIdx);
  visible = [...new Set(visible)].sort((a, b) => a - b);
  while (sumTabWidths(widths, visible) > budget && visible.length > 1) {
    let removed = false;
    for (let j = visible.length - 1; j >= 0; j--) {
      if (visible[j] !== activeIdx) {
        visible.splice(j, 1);
        removed = true;
        break;
      }
    }
    if (!removed) break;
  }
  return visible;
}

function layoutAccountTabs() {
  const bar = document.querySelector('.account-tabs-bar');
  const track = document.getElementById('account-tabs-track');
  const moreBtn = document.getElementById('btn-account-tabs-more');
  const menu = document.getElementById('account-tabs-menu');
  const countEl = document.getElementById('account-tabs-more-count');
  if (!bar || !track || !moreBtn || !menu) return;

  const tabs = [...track.querySelectorAll('.account-tab')];
  const activeIdx = tabs.findIndex((t) => t.getAttribute('data-account-scope') === state.activeScope);
  const activeIndex = activeIdx >= 0 ? activeIdx : 0;

  tabs.forEach((tab) => {
    tab.hidden = false;
  });
  moreBtn.hidden = true;
  menu.innerHTML = '';

  const widths = tabs.map((tab) => tab.offsetWidth);
  const totalWidth = widths.reduce((sum, w) => sum + w, 0);
  let trackWidth = track.clientWidth;

  if (totalWidth <= trackWidth) {
    state.accountTabsMenuOpen = false;
    menu.hidden = true;
    moreBtn.setAttribute('aria-expanded', 'false');
    return;
  }

  moreBtn.hidden = false;
  trackWidth = track.clientWidth;

  const visibleIndices = new Set(computeVisibleTabIndices(widths, trackWidth, activeIndex));
  const overflow = [];

  tabs.forEach((tab, index) => {
    if (visibleIndices.has(index)) {
      tab.hidden = false;
      return;
    }
    tab.hidden = true;
    const scope = tab.getAttribute('data-account-scope');
    if (!scope) return;
    overflow.push({
      scope,
      label: tab.textContent?.trim() || scope,
      active: scope === state.activeScope,
    });
  });

  if (countEl) countEl.textContent = overflow.length > 0 ? String(overflow.length) : '';

  menu.innerHTML = overflow
    .map(
      (item) => `
      <button type="button" class="account-tabs-menu-item ${item.active ? 'is-active' : ''}" data-account-scope="${item.scope}" role="menuitem">
        ${escapeHtml(item.label)}
      </button>`,
    )
    .join('');
  menu.hidden = !state.accountTabsMenuOpen || overflow.length === 0;
  moreBtn.setAttribute('aria-expanded', String(state.accountTabsMenuOpen && overflow.length > 0));
  if (overflow.length === 0) {
    moreBtn.hidden = true;
    state.accountTabsMenuOpen = false;
  }
}

function setupAccountTabsLayout() {
  const bar = document.querySelector('.account-tabs-bar');
  if (!bar) return;
  requestAnimationFrame(() => layoutAccountTabs());
  accountTabsResizeObserver?.disconnect();
  accountTabsResizeObserver = new ResizeObserver(() => layoutAccountTabs());
  accountTabsResizeObserver.observe(bar);
}

function activateAccountScope(scope) {
  state.accountTabsMenuOpen = false;
  setActiveScope(scope);
  navigateTo({ type: 'list', scope });
  state.view = 'list';
  paint();
  scheduleRefresh();
}

function onAccountTabsBarClick(ev) {
  if (ev.target.closest('#btn-account-tabs-more')) {
    ev.stopPropagation();
    state.accountTabsMenuOpen = !state.accountTabsMenuOpen;
    layoutAccountTabs();
    return;
  }
  const tab = ev.target.closest('[data-account-scope]');
  if (!tab || !tab.closest('.account-tabs-bar')) return;
  const scope = tab.getAttribute('data-account-scope');
  if (!scope) return;
  activateAccountScope(scope);
}

function initAccountTabsGlobalListeners() {
  if (window.__accountTabsGlobalListeners) return;
  window.__accountTabsGlobalListeners = true;
  document.addEventListener('click', (ev) => {
    if (!state.accountTabsMenuOpen) return;
    if (ev.target.closest('.account-tabs-bar')) return;
    state.accountTabsMenuOpen = false;
    layoutAccountTabs();
  });
}

function renderAccountTabs() {
  const allTabs = accountTabsAll();
  return `
    <div class="account-tabs-bar">
      <div class="account-tabs" role="tablist" id="account-tabs-track">
        ${allTabs.map((t) => renderAccountTabButton(t)).join('')}
      </div>
      <button type="button" class="account-tab account-tab--more" id="btn-account-tabs-more" hidden aria-expanded="false" aria-haspopup="menu">
        更多<span class="account-tab-fold-count" id="account-tabs-more-count"></span>
      </button>
      ${renderThemeToggle()}
      <div class="account-tabs-menu" id="account-tabs-menu" hidden role="menu"></div>
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
  const rtCls = pctClass(acc.hasRealtime ? acc.totalRealTime : null);
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
          <p class="account-summary-sub ${holdingCls}">${fmtMoney(acc.totalHolding, true)} · ${fmtPct(acc.totalHoldingPct)}</p>
        </div>
        <div class="account-summary-col account-summary-col--center">
          <div class="account-summary-label-row account-summary-label-row--center">
            <span class="account-summary-label">实时收益</span>
            ${renderSummaryTrendCounts(acc.rtUp, acc.rtDown)}
          </div>
          <p class="account-summary-val ${rtCls}" data-account-rt-val>${acc.hasRealtime ? fmtMoney(acc.totalRealTime, true) : '—'}</p>
          <p class="account-summary-sub ${rtCls}" data-account-rt-pct>${acc.hasRealtime ? fmtPct(acc.totalRealTimePct) : '—'}</p>
        </div>
        <div class="account-summary-col account-summary-col--right">
          <div class="account-summary-label-row account-summary-label-row--end">
            <span class="account-summary-label">当日收益</span>
            ${renderSummaryTrendCounts(acc.up, acc.down)}
          </div>
          <p class="account-summary-val ${dailyCls}">${fmtMoney(acc.totalSettled, true)}</p>
          <p class="account-summary-sub ${dailyCls}">${fmtPct(acc.totalSettledPct)}</p>
        </div>
      </div>
    </button>`;
}

function renderStatusStrip() {
  const ctx = state.displayContext;
  const clock = ctx?.clockLabel || state.updatedAt || fmtTime();
  const note = ctx?.realtimeNote || ctx?.dailyNote || '';
  return `
    <div class="status-strip">
      <span class="status-strip-chip">${escapeHtml(marketStatusHint())}</span>
      <span class="status-strip-time">${escapeHtml(clock)}</span>
      ${note ? `<span class="status-strip-note">${escapeHtml(note)}</span>` : ''}
    </div>`;
}

function summaryHeadDate(col) {
  const head = state.displayContext?.tableHead?.[col];
  const label = head?.label ?? head?.line1 ?? '';
  return label ? `<span class="yj-summary-date">${escapeHtml(label)}</span>` : '';
}

function renderSummaryMetricCol(title, colKey, val, pct, { signed = false, amount = false } = {}) {
  const dateHtml = colKey ? summaryHeadDate(colKey) : '';
  const valCls = pctClass(signed ? val : pct);
  return `
    <div class="yj-summary-col ${amount ? 'yj-summary-col--amount' : ''}" data-summary-col="${colKey || 'assets'}">
      <p class="yj-summary-label">${escapeHtml(title)}${dateHtml}</p>
      <p class="yj-summary-val ${valCls}">${fmtMoney(val, signed)}</p>
      <p class="yj-summary-sub ${valCls}">${pct != null ? fmtPct(pct) : amount ? '' : '—'}</p>
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
            return renderSummaryMetricCol(col.title, col.key, m.val, m.pct, { signed: m.signed });
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
  return `
    <button type="button" class="list-table-head-col list-table-head-sort${left}${active}" data-sort-key="${sortKey}">
      <span class="list-table-head-title">${title}${sortIndicator(sortKey)}</span>
      ${dateHtml ? `<span class="list-table-head-date">${dateHtml}</span>` : ''}
    </button>`;
}

function renderListTableHead() {
  const metricHeads = orderedMetrics()
    .map((col) => renderHeadSortCol(col.title, col.key, col.dateCol))
    .join('');
  const configBtn = isEditableScope(state.activeScope)
    ? `<button type="button" class="list-head-config" id="btn-list-config" title="列表配置" aria-label="列表配置">⚙</button>`
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
  state.configDraft = readConfigDraftFromDom();
  const { code, name, amount, totalProfit, yesterdayProfit } = state.configDraft;
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
  }
}

async function submitSaveFund() {
  const fund = fundById(state.detailId);
  if (!fund) return;
  state.fundEditError = null;
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
  }
}

async function submitDeleteFund() {
  const fund = fundById(state.detailId);
  if (!fund) return;
  if (!window.confirm(`确定删除「${fund.name}」？此操作不可撤销。`)) return;
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
  const mergeTag = f.isMerged
    ? `<span class="holding-merge-tag">${f.mergedIds?.length ?? 2}个账户</span>`
    : '';
  const metaLine =
    state.nameSubline === 'amount'
      ? `<span class="holding-code">${escapeHtml(f.code)}</span><span class="holding-amount">${fmtHoldAmount(f.displayAmount ?? f.amount)}</span>${mergeTag}`
      : `<span class="holding-amount">${escapeHtml(f.code)}</span>${mergeTag}`;
  return `
    <button type="button" class="holding-row" data-fund-id="${f.id}">
      <div class="holding-col holding-col--name">
        <p class="holding-name">${escapeHtml(f.name)}</p>
        <p class="holding-meta">${metaLine}</p>
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

function patchSummaryCol(col, { val, pct, signed = false, subText, subMuted = false, dateCol = null }) {
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
    subEl.textContent = pct != null ? fmtPct(pct) : '—';
    subEl.classList.remove('yj-summary-sub--muted');
    setTextClass(subEl, valCls);
  }
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

  const ctx = state.displayContext;
  const statusTime = document.querySelector('.status-strip-time');
  const statusNote = document.querySelector('.status-strip-note');
  const statusChip = document.querySelector('.status-strip-chip');
  if (statusChip) statusChip.textContent = marketStatusHint();
  if (statusTime) statusTime.textContent = ctx?.clockLabel || state.updatedAt || fmtTime();
  if (statusNote) {
    const note = ctx?.realtimeNote || ctx?.dailyNote || '';
    statusNote.textContent = note;
    statusNote.hidden = !note;
  }

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
        const cls = pctClass(hasRealtimeProfit(f) ? f.realTimeProfit : null);
        if (valEl) {
          valEl.textContent = fmtMoney(hasRealtimeProfit(f) ? f.realTimeProfit : null, true);
          setTextClass(valEl, cls);
        }
        if (subEl) {
          subEl.textContent = hasRealtimeProfit(f) ? fmtPct(f.realTimePct) : '—';
          setTextClass(subEl, cls);
        }
      } else if (col.key === 'daily') {
        const cls = pctClass(f.settledProfit);
        if (valEl) {
          valEl.textContent = fmtMoney(f.settledProfit, true);
          setTextClass(valEl, cls);
        }
        if (subEl) {
          subEl.textContent = fmtPct(f.settledPct);
          setTextClass(subEl, cls);
        }
      } else if (col.key === 'holding') {
        const cls = pctClass(f.totalProfit);
        if (valEl) {
          valEl.textContent = fmtMoney(f.totalProfit, true);
          setTextClass(valEl, cls);
        }
        if (subEl) {
          subEl.textContent = fmtPct(f.totalProfitPct);
          setTextClass(subEl, cls);
        }
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
  return rows.length > 0 && rows.length === state.displayRows.length;
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
        sub.textContent = `${fmtMoney(acc.totalHolding, true)} · ${fmtPct(acc.totalHoldingPct)}`;
        setTextClass(sub, holdingCls);
      }
    }

    if (rtCol) {
      patchSummaryTrendCounts(rtCol.querySelector('.account-summary-label-row'), acc.rtUp, acc.rtDown);
      const rtVal = rtCol.querySelector('.account-summary-val');
      const rtPct = rtCol.querySelector('.account-summary-sub');
      if (rtVal) {
        rtVal.textContent = acc.hasRealtime ? fmtMoney(acc.totalRealTime, true) : '—';
        setTextClass(rtVal, rtCls);
      }
      if (rtPct) {
        rtPct.textContent = acc.hasRealtime ? fmtPct(acc.totalRealTimePct) : '—';
        setTextClass(rtPct, rtCls);
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
      if (sub) {
        sub.textContent = fmtPct(acc.totalSettledPct);
        setTextClass(sub, dailyCls);
      }
    }
  }
  return true;
}

function renderListPage() {
  const grid = listGridTemplate();

  if (state.activeScope === SCOPE_SUMMARY) {
    const cards = buildAccountSummaries(state.fundRows, ACCOUNTS)
      .map((acc) => renderAccountSummaryCard(acc))
      .join('');
    return renderShell(
      `
      <section class="portfolio-page portfolio-page--summary" style="--list-grid: ${grid}">
        <div class="portfolio-sticky">
          ${renderAccountTabs()}
          ${renderPortfolioHeader()}
        </div>
        <div class="holding-list-scroll" id="holding-list-scroll">
          <section class="account-summary-list">${cards}</section>
        </div>
        ${renderIndexTicker()}
      </section>`,
    );
  }

  const rows = state.displayRows.map((f) => renderFundRow(f)).join('');
  return renderShell(
    `
    <section class="portfolio-page" style="--list-grid: ${grid}">
      <div class="portfolio-sticky">
        ${renderAccountTabs()}
        ${renderPortfolioHeader()}
        ${renderListTableHead()}
      </div>
      <div class="holding-list-scroll" id="holding-list-scroll">
        <section class="holding-list">${rows}</section>
      </div>
    </section>`,
  );
}

function renderSubpageNav(title, { backId = 'btn-back', rightHtml = '' } = {}) {
  return `
    <nav class="subpage-nav">
      <button type="button" class="subpage-nav-back" id="${backId}" aria-label="返回">
        <span aria-hidden="true">‹</span>
      </button>
      <h1 class="subpage-nav-title">${escapeHtml(title)}</h1>
      <div class="subpage-nav-right">${rightHtml}${renderThemeToggle()}</div>
    </nav>`;
}

function renderManageTabs(active) {
  return `
    <div class="manage-tabs" role="tablist">
      <button type="button" class="manage-tab ${active === 'holdings' ? 'is-active' : ''}" data-manage-tab="holdings" role="tab">持有管理</button>
      <button type="button" class="manage-tab ${active === 'headers' ? 'is-active' : ''}" data-manage-tab="headers" role="tab">表头设置</button>
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
  const codeOn = state.nameSubline === 'code';
  const colRows = state.metricColumnOrder
    .map((key, idx) => {
      const col = metricColumnDef(key);
      const visible = state.metricColumnVisible[key] !== false;
      return `
      <li class="manage-header-item" data-col-key="${key}">
        <span class="manage-header-name">${escapeHtml(col.title)}</span>
        <button type="button" class="manage-icon-btn ${visible ? 'is-on' : ''}" data-col-visible="${key}" title="显示" aria-label="显示">${visible ? '👁' : '—'}</button>
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
      <label class="manage-switch-row">
        <span>显示 基金名称 + 基金代码</span>
        <input type="radio" name="name-subline" value="code" ${codeOn ? 'checked' : ''} />
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
        <button type="button" class="sheet-btn sheet-btn--primary" id="btn-add-fund-submit">确认添加</button>
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
      <div class="manage-body">
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
          <button type="button" class="sheet-btn sheet-btn--primary" id="btn-save-fund">保存</button>
          <button type="button" class="sheet-btn sheet-btn--danger" id="btn-delete-fund">删除基金</button>
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

function renderDetailMetric(label, val, pct, { signed = false } = {}) {
  const cls = pctClass(signed ? val : pct);
  return `
    <div class="detail-metric">
      <p class="detail-metric-label">${escapeHtml(label)}</p>
      <p class="detail-metric-val ${cls}">${fmtMoney(val, signed)}</p>
      <p class="detail-metric-sub ${cls}">${pct != null ? fmtPct(pct) : '—'}</p>
    </div>`;
}

function renderDetailHero(fund, metrics) {
  const cls = pctClass(metrics.impactPct);
  return `
    <section class="detail-hero ${cls}">
      <p class="detail-hero-code">${escapeHtml(fund.code)}</p>
      <p class="detail-hero-label">估值涨跌</p>
      <p class="detail-hero-pct ${cls}">${fmtPct(metrics.impactPct)}</p>
      <p class="detail-hero-amount">持仓 ${fmtHoldAmount(fund.amount)}</p>
    </section>`;
}

function renderDetailStats(metrics) {
  return `
    <section class="detail-stats">
      ${orderedMetrics()
        .map((col) => {
          if (col.key === 'realtime') {
            return renderDetailMetric(col.title, metrics.realTimeProfit, metrics.realTimePct, { signed: true });
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

  const { impactPct, holdings, note } = state.detail;
  const metrics = { ...detailFundMetrics(fund), impactPct };
  const rows = holdings
    .map(
      (h) => `
      <div class="table-row">
        <span class="stock-name">${escapeHtml(h.name || h.code)}</span>
        <span class="stock-weight">${h.weight.toFixed(2)}%</span>
        <span class="stock-change ${pctClass(h.changePct)}">${fmtPct(h.changePct)}</span>
      </div>`,
    )
    .join('');

  return renderShell(
    `
    <section class="detail-page">
      ${renderDetailNav(fund.name, { showEdit: canEditFund(fund) })}
      ${renderDetailHero(fund, metrics)}
      ${renderDetailStats(metrics)}
      <div class="detail-section-head">
        <h2 class="detail-section-title">持仓穿透</h2>
        <span class="detail-section-meta">${holdings.length} 只 · ${escapeHtml(state.updatedAt || fmtTime())}</span>
      </div>
      <section class="holdings-card">
        <div class="table-head">
          <span>名称</span><span>占比</span><span>涨跌幅</span>
        </div>
        <div class="holdings-list-scroll" id="holdings-list-scroll">
          ${rows || '<div class="table-row"><span class="stock-name">暂无持仓</span><span></span><span></span></div>'}
        </div>
      </section>
      <p class="detail-note">${escapeHtml(note)}</p>
    </section>`,
  );
}

function paint() {
  const root = document.getElementById('app');
  if (!root) return;

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
  if (isLiveView()) scheduleRefresh();
}

function bindEvents() {
  document.getElementById('btn-theme')?.addEventListener('click', () => {
    toggleTheme();
    paint();
  });

  document.getElementById('btn-retry')?.addEventListener('click', () => bootstrap());

  document.getElementById('btn-back')?.addEventListener('click', () => handleBack());

  document.querySelectorAll('.list-table-head-sort[data-sort-key]').forEach((btn) => {
    btn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      const key = btn.getAttribute('data-sort-key');
      if (key) toggleSort(key);
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
      : FUNDS.map((f) => f.id);
    state.manageSelected = ev.target.checked ? [...order] : [];
    paint();
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
      paint();
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
}

function applyLive(live) {
  state.lastLive = live;
  state.indices = live.indices ?? [];
  state.fxPct = live.fxPct;
  state.updatedAt = live.updatedAt || fmtTime();
  state.displayContext = live.displayContext ?? state.displayContext;
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
    applyLive(live);
    if (state.view === 'loading') state.view = 'list';
    if (canPatchListDom() && patchListDom()) return;
    paint();
  } catch (e) {
    state.error = e instanceof Error ? e.message : String(e);
    state.view = 'error';
    paint();
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
  state.fundEditError = null;
  state.view = 'detail-loading';
  paint();
  scheduleRefresh();

  try {
    await loadDetail(id);
    state.view = 'detail';
  } catch (e) {
    state.error = e instanceof Error ? e.message : String(e);
    state.view = 'error';
  }
  paint();
}

function canPatchDetailDom() {
  return state.view === 'detail' && !!document.getElementById('holdings-list-scroll');
}

function patchDetailDom() {
  const fund = fundById(state.detailId);
  if (!fund || !state.detail) return false;

  const metrics = { ...detailFundMetrics(fund), impactPct: state.detail.impactPct };
  const heroCls = pctClass(metrics.impactPct);
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
      if (subEl) {
        subEl.textContent = pct != null ? fmtPct(pct) : '—';
        setTextClass(subEl, cls);
      }
    });
  }

  const metaEl = document.querySelector('.detail-section-meta');
  if (metaEl) {
    metaEl.textContent = `${state.detail.holdings.length} 只 · ${state.updatedAt || fmtTime()}`;
  }

  const rows = document.querySelectorAll('#holdings-list-scroll .table-row');
  const { holdings } = state.detail;
  if (rows.length !== holdings.length) return false;

  holdings.forEach((h, i) => {
    const row = rows[i];
    if (!row) return;
    const changeEl = row.querySelector('.stock-change');
    if (changeEl) {
      changeEl.textContent = fmtPct(h.changePct);
      setTextClass(changeEl, pctClass(h.changePct));
    }
  });

  return true;
}

async function refreshDetailView() {
  if (!state.detailId || state.busy) return;
  state.busy = true;
  try {
    const live = await fetchLive();
    state.indices = live.indices;
    state.updatedAt = live.updatedAt;
    await loadDetail(state.detailId);
    if (state.view === 'detail-loading') state.view = 'detail';
    if (canPatchDetailDom() && patchDetailDom()) return;
    const scrollTop = document.getElementById('holdings-list-scroll')?.scrollTop ?? 0;
    paint();
    const scrollEl = document.getElementById('holdings-list-scroll');
    if (scrollEl) scrollEl.scrollTop = scrollTop;
  } catch {
    /* keep */
  } finally {
    state.busy = false;
  }
}

function scheduleRefresh() {
  if (refreshTimer) clearInterval(refreshTimer);
  refreshTimer = null;
  if (!isLiveView()) return;
  const ms = state.detailId && state.view === 'detail' ? DETAIL_REFRESH_MS : REFRESH_MS;
  refreshTimer = setInterval(() => {
    if (state.detailId && state.view === 'detail') refreshDetailView();
    else if (state.view === 'list') refreshListView();
  }, ms);
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
initAccountTabsGlobalListeners();
bootstrap();
