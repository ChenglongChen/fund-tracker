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
  saveMetricColumnOrder,
  saveMetricColumnVisible,
  saveNameSubline,
  saveFundOrder,
} from './column-layout.js';
import { initTheme, toggleTheme } from './theme.js';
import {
  SCOPE_ALL,
  SCOPE_SUMMARY,
  isEditableScope,
  loadActiveScope,
  rowsForScope,
  saveActiveScope,
} from './accounts.js';
import { loadHideAssets } from './privacy.js';
import { fmtTime } from './format.js';
import { bindHideAssets } from './display-format.js';
import { buildSummary } from './summary.js';
import { mergeLiveIntoFunds, roundProfit } from './live-view-model.js';
import { bindApp } from './app/context.js';
import { renderShell, renderLoading, renderError, patchLiveBanner } from './components/shell.js';
import { patchThemeToggle } from './components/theme-chrome.js';
import { setupPrivacyClick } from './components/privacy-ui.js';
import {
  showIndexTicker,
  openIndexDrawer,
  closeIndexDrawer,
  syncIndexDrawerUi,
  patchIndexDrawerTab,
  startIndexDockCarousel,
  stopIndexDockCarousel,
  initIndexDrawerGlobalListeners,
} from './components/index-dock.js';
import { setupAccountTabsLayout, onAccountTabsBarClick, activateAccountScope } from './components/account-tabs.js';
import { renderListPage, patchListDom, canPatchListDom } from './pages/list-page.js';
import {
  renderDetailPage,
  renderDetailLoading,
  patchDetailDom,
  canPatchDetailDom,
  patchDetailMetricsDom,
  toggleHoldingsSort,
} from './pages/detail-page.js';
import {
  renderManagePage,
  renderManageAddPage,
  renderFundEditPage,
  patchManageSelection,
  defaultConfigDraft,
} from './pages/manage-page.js';

const REFRESH_MS = 1_000;
const DETAIL_HOLDINGS_REFRESH_MS = 3_000;

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
  /** API /api/live totals — portfolio 级 canonical RT1/EST（SCOPE_ALL 顶栏使用） */
  liveTotals: null,
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

bindHideAssets(() => state.hideAssets);

let refreshTimer = null;
let refreshPending = false;
let lastDetailHoldingsFetchAt = 0;

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
  const canonicalTotals =
    state.activeScope === SCOPE_ALL && state.liveTotals ? state.liveTotals : null;
  const displayState =
    state.activeScope === SCOPE_ALL ? state.lastLive?.displayState ?? null : null;
  state.summary = buildSummary(summaryRows, canonicalTotals, displayState);
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
  state.liveTotals = live.totals ?? null;
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
  state.fundRows = mergeLiveIntoFunds(FUNDS, live);
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
  bindApp({
    state,
    getFunds: () => FUNDS,
    getAccounts: () => ACCOUNTS,
    fundById,
    accountById,
    canEditFund,
    setActiveScope,
    navigateTo,
    paint,
    scheduleRefresh,
    canPatchDetailDom,
    patchDetailDom,
    canPatchListDom,
    patchListDom,
  });

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
