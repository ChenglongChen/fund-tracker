import { dayProfitPct } from './portfolio.js';
import {
  fetchFundDetail,
  fetchLive,
  fetchPortfolio,
  addFundApi,
  updateFundApi,
  deleteFundApi,
  fetchWatchlist,
  fetchWatchlistLive,
  addWatchlistApi,
  removeWatchlistApi,
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
import { loadHideAssets, saveHideAssets } from './privacy.js';
import { fmtTime } from './format.js';
import { bindHideAssets } from './display-format.js';
import { buildSummary } from './summary.js';
import { mergeLiveIntoFunds, roundProfit, mapLiveRowToDisplay } from './live-view-model.js';
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
import { patchBottomTabs } from './components/bottom-tabs.js';
import { renderWatchlistPage, patchWatchlistDom, canPatchWatchlistDom } from './pages/watchlist-page.js';
import { renderMarketPage, patchMarketDom } from './pages/market-page.js';
import { renderProfilePage } from './pages/profile-page.js';
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
import {
  detailMetricsFor,
  detailProfile,
  resolvePortfolioFund,
} from './fund-live-display.js';

const REFRESH_MS = 1_000;
const DETAIL_HOLDINGS_REFRESH_MS = REFRESH_MS;

/** @type {import('./portfolio.js').PortfolioMeta} */
let PORTFOLIO_META = {};
/** @type {import('./portfolio.js').FundRow[]} */
let FUNDS = [];
/** @type {{ id: string, name: string, order: number }[]} */
let ACCOUNTS = [];

const state = {
  view: 'loading',
  mainTab: 'holdings',
  activeScope: loadActiveScope(),
  detailSource: null,
  detailScope: null,
  detailCode: null,
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
  watchlistItems: [],
  watchlistRows: [],
  watchlistError: null,
  watchlistSortKey: 'realtime',
  watchlistSortDir: 'desc',
  marketTab: 'us',
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
  if (!raw) return { type: 'list', scope: loadActiveScope(), mainTab: 'holdings' };
  if (raw === 'holdings') return { type: 'list', scope: loadActiveScope(), mainTab: 'holdings' };
  if (raw === 'watchlist') return { type: 'watchlist', mainTab: 'watchlist' };
  if (raw === 'market') return { type: 'market', mainTab: 'market' };
  if (raw === 'profile') return { type: 'profile', mainTab: 'profile' };
  if (raw === 'summary') return { type: 'list', scope: SCOPE_SUMMARY, mainTab: 'holdings' };
  if (raw === 'all') return { type: 'list', scope: SCOPE_ALL, mainTab: 'holdings' };
  const accountM = raw.match(/^account\/([a-z0-9_-]+)$/);
  if (accountM) return { type: 'list', scope: accountM[1], mainTab: 'holdings' };
  const accountEditM = raw.match(/^account\/([a-z0-9_-]+)\/(\d{6})\/edit$/);
  if (accountEditM) {
    return { type: 'fund-edit', scope: accountEditM[1], code: accountEditM[2], mainTab: 'holdings' };
  }
  const accountDetailM = raw.match(/^account\/([a-z0-9_-]+)\/(\d{6})$/);
  if (accountDetailM) {
    return {
      type: 'holdings-detail',
      scope: accountDetailM[1],
      code: accountDetailM[2],
      mainTab: 'holdings',
    };
  }
  const summaryDetailM = raw.match(/^summary\/(\d{6})$/);
  if (summaryDetailM) {
    return { type: 'holdings-detail', scope: SCOPE_SUMMARY, code: summaryDetailM[1], mainTab: 'holdings' };
  }
  const watchlistDetailM = raw.match(/^watchlist\/(\d{6})$/);
  if (watchlistDetailM) {
    return { type: 'watchlist-detail', code: watchlistDetailM[1], mainTab: 'watchlist' };
  }
  if (raw === 'manage') return { type: 'manage', tab: 'holdings' };
  if (raw === 'manage/headers') return { type: 'manage', tab: 'headers' };
  if (raw === 'manage/add') return { type: 'manage', tab: 'add' };
  return { type: 'list', scope: loadActiveScope(), mainTab: 'holdings' };
}

function setMainTab(tab) {
  state.mainTab = tab;
}

/** @param {{ type: string, id?: number, tab?: string, scope?: string, mainTab?: string }} route */
function navigateTo(route) {
  switch (route.type) {
    case 'watchlist':
      location.hash = '#watchlist';
      break;
    case 'market':
      location.hash = '#market';
      break;
    case 'profile':
      location.hash = '#profile';
      break;
    case 'list':
      if (route.mainTab === 'holdings' && route.scope === SCOPE_SUMMARY) location.hash = '#summary';
      else if (route.mainTab === 'holdings' && route.scope === SCOPE_ALL) location.hash = '#all';
      else if (route.scope) location.hash = `#account/${route.scope}`;
      else location.hash = '#holdings';
      break;
    case 'manage':
      if (route.tab === 'headers') location.hash = '#manage/headers';
      else if (route.tab === 'add') location.hash = '#manage/add';
      else location.hash = '#manage';
      break;
    case 'holdings-detail':
      if (route.scope === SCOPE_SUMMARY) location.hash = `#summary/${route.code}`;
      else location.hash = `#account/${route.scope}/${route.code}`;
      break;
    case 'watchlist-detail':
      location.hash = `#watchlist/${route.code}`;
      break;
    case 'fund-edit':
      location.hash = `#account/${route.scope}/${route.code}/edit`;
      break;
    default:
      location.hash = '';
  }
}

function detailCtx() {
  return {
    source: state.detailSource,
    scope: state.detailScope,
    code: state.detailCode,
  };
}

function clearDetailState() {
  state.detailSource = null;
  state.detailScope = null;
  state.detailCode = null;
  state.detail = null;
}

function portfolioFundForDetail() {
  if (state.detailSource !== 'holdings' || !state.detailCode) return null;
  return resolvePortfolioFund(() => FUNDS, { scope: state.detailScope, code: state.detailCode });
}

function canEditDetailFund() {
  if (state.detailSource !== 'holdings' || state.detailScope === SCOPE_SUMMARY) return false;
  const fund = portfolioFundForDetail();
  if (!fund || fund.isMerged) return false;
  return isEditableScope(state.detailScope) && fund.accountId === state.detailScope;
}

function detailMetrics() {
  return detailMetricsFor(state, detailCtx(), () => FUNDS);
}

function sameDetailRoute(route) {
  if (!state.detailCode) return false;
  if (route.type === 'watchlist-detail') {
    return state.detailSource === 'watchlist' && state.detailCode === route.code;
  }
  if (route.type === 'holdings-detail') {
    return (
      state.detailSource === 'holdings' &&
      state.detailScope === route.scope &&
      state.detailCode === route.code
    );
  }
  return false;
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
  const fund = portfolioFundForDetail();
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
    navigateTo({ type: 'holdings-detail', scope: state.detailScope, code: state.detailCode });
    state.view = 'detail';
    await refreshFundLive();
    await loadDetailPenetration(state.detailCode);
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
  const fund = portfolioFundForDetail();
  if (!fund || state.formBusy) return;
  if (!window.confirm(`确定删除「${fund.name}」？此操作不可撤销。`)) return;
  const scope = fund.accountId || state.detailScope || state.activeScope;
  setFormBusy(true);
  try {
    await deleteFundApi(fund.id);
    clearDetailState();
    await reloadPortfolioAndLive();
    navigateTo({ type: 'list', scope });
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
  return (
    state.view === 'list' ||
    state.view === 'watchlist' ||
    state.view === 'market' ||
    state.view === 'detail' ||
    state.view === 'detail-loading'
  );
}

function watchlistSortValue(f, key) {
  if (key === 'realtime') {
    const pct = f.realTimePct ?? f.estimateImpactPct ?? null;
    return pct != null && Number.isFinite(pct) ? pct : null;
  }
  if (key === 'daily') {
    if (f.dailyPending) return null;
    return f.settledPct != null && Number.isFinite(f.settledPct) ? f.settledPct : null;
  }
  return null;
}

function applyWatchlistSort(rows) {
  const { watchlistSortKey: key, watchlistSortDir: dir } = state;
  const mul = dir === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    const va = watchlistSortValue(a, key);
    const vb = watchlistSortValue(b, key);
    if (va == null && vb == null) return String(a.code).localeCompare(String(b.code));
    if (va == null) return 1;
    if (vb == null) return -1;
    if (va === vb) return String(a.code).localeCompare(String(b.code));
    return (va - vb) * mul;
  });
}

function mapWatchlistLiveRows(funds) {
  return funds.map((row) => {
    const virtual = {
      id: row.id,
      code: row.code,
      name: row.name,
      amount: row.amount ?? 10_000,
    };
    return { ...mapLiveRowToDisplay(virtual, row), code: row.code, name: row.name || row.code };
  });
}

function applyWatchlistLive(wl) {
  if (wl.displayContext) state.displayContext = wl.displayContext;
  state.watchlistRows = applyWatchlistSort(mapWatchlistLiveRows(wl.funds ?? []));
}

async function loadWatchlistItems() {
  const data = await fetchWatchlist();
  state.watchlistItems = data.items ?? [];
}

function activateMainTab(tab) {
  state.indexDrawerOpen = false;
  setMainTab(tab);
  if (tab === 'holdings') {
    navigateTo({ type: 'list', scope: state.activeScope, mainTab: 'holdings' });
    state.view = 'list';
  } else if (tab === 'watchlist') {
    navigateTo({ type: 'watchlist' });
    state.view = 'watchlist';
  } else if (tab === 'market') {
    navigateTo({ type: 'market' });
    state.view = 'market';
  } else if (tab === 'profile') {
    navigateTo({ type: 'profile' });
    state.view = 'profile';
  }
  paint();
  scheduleRefresh();
  if (tab === 'holdings') void refreshListView();
  else if (tab === 'watchlist') void refreshWatchlistView();
  else if (tab === 'market') void refreshMarketView();
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
    navigateTo({ type: 'holdings-detail', scope: route.scope, code: route.code });
    state.detailSource = 'holdings';
    state.detailScope = route.scope;
    state.detailCode = route.code;
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
  if (
    route.type === 'holdings-detail' ||
    route.type === 'watchlist-detail' ||
    state.view === 'detail' ||
    state.view === 'detail-loading'
  ) {
    const src = state.detailSource;
    const scope = state.detailScope;
    clearDetailState();
    if (src === 'watchlist') {
      navigateTo({ type: 'watchlist' });
      state.view = 'watchlist';
    } else if (scope === SCOPE_SUMMARY) {
      state.activeScope = SCOPE_SUMMARY;
      saveActiveScope(SCOPE_SUMMARY);
      navigateTo({ type: 'list', scope: SCOPE_SUMMARY, mainTab: 'holdings' });
      state.view = 'list';
      applyDisplayScope();
    } else {
      const listScope = scope || state.activeScope;
      if (scope) {
        state.activeScope = scope;
        saveActiveScope(scope);
        applyDisplayScope();
      }
      navigateTo({ type: 'list', scope: listScope, mainTab: 'holdings' });
      state.view = 'list';
    }
    paint();
    scheduleRefresh();
    if (state.view === 'list') refreshListView();
    else if (state.view === 'watchlist') void refreshWatchlistView();
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
  state.watchlistError = null;
  if (route.mainTab) setMainTab(route.mainTab);

  if (route.type === 'watchlist') {
    clearDetailState();
    state.view = 'watchlist';
    try {
      await loadWatchlistItems();
    } catch {
      /* optional */
    }
    paint();
    return;
  }

  if (route.type === 'market') {
    clearDetailState();
    state.view = 'market';
    paint();
    return;
  }

  if (route.type === 'profile') {
    clearDetailState();
    state.view = 'profile';
    paint();
    return;
  }

  if (route.type === 'list') {
    state.activeScope = route.scope || loadActiveScope();
    saveActiveScope(state.activeScope);
    clearDetailState();
    state.view = 'list';
    setMainTab('holdings');
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
    const fund = resolvePortfolioFund(() => FUNDS, { scope: route.scope, code: route.code });
    if (!fund || !isEditableScope(route.scope) || fund.accountId !== route.scope) {
      if (fund) navigateTo({ type: 'holdings-detail', scope: route.scope, code: route.code });
      else navigateTo({ type: 'list', scope: route.scope || state.activeScope });
      state.view = fund ? 'detail' : 'list';
      paint();
      return;
    }
    state.detailSource = 'holdings';
    state.detailScope = route.scope;
    state.detailCode = route.code;
    state.view = 'fund-edit';
    paint();
    return;
  }

  if (route.type === 'holdings-detail') {
    setMainTab('holdings');
    if (sameDetailRoute(route) && (state.view === 'detail' || state.view === 'detail-loading')) return;
    await openHoldingsDetail(route.scope, route.code);
    return;
  }

  if (route.type === 'watchlist-detail') {
    setMainTab('watchlist');
    if (sameDetailRoute(route) && (state.view === 'detail' || state.view === 'detail-loading')) return;
    await openWatchlistDetail(route.code);
    return;
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

  if (state.view !== 'list' && state.view !== 'watchlist' && state.view !== 'market') {
    state.indexDrawerOpen = false;
  }

  if (state.view === 'loading') root.innerHTML = renderLoading();
  else if (state.view === 'error') root.innerHTML = renderError(state.error || '未知错误');
  else if (state.view === 'list') root.innerHTML = renderListPage();
  else if (state.view === 'watchlist') root.innerHTML = renderWatchlistPage();
  else if (state.view === 'market') root.innerHTML = renderMarketPage();
  else if (state.view === 'profile') root.innerHTML = renderProfilePage();
  else if (state.view === 'manage') root.innerHTML = renderManagePage();
  else if (state.view === 'manage-add') root.innerHTML = renderManageAddPage();
  else if (state.view === 'fund-edit') root.innerHTML = renderFundEditPage();
  else if (state.view === 'detail-loading') {
    const { fund } = detailMetrics();
    const profile = detailProfile(state.detailSource ?? 'holdings');
    root.innerHTML = fund ? renderDetailLoading(fund, profile) : renderLoading();
  } else if (state.view === 'detail') root.innerHTML = renderDetailPage();
  else root.innerHTML = renderLoading();

  bindEvents();
  patchBottomTabs();
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
    else if (state.view === 'watchlist') void refreshWatchlistView();
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

  document.querySelectorAll('.holding-row[data-fund-code]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const code = btn.getAttribute('data-fund-code');
      const scope = btn.getAttribute('data-fund-scope');
      if (!code || !scope) return;
      navigateTo({ type: 'holdings-detail', scope, code });
      void openHoldingsDetail(scope, code);
    });
  });

  document.querySelectorAll('.holding-row--watchlist[data-watchlist-code]').forEach((row) => {
    row.addEventListener('click', (ev) => {
      if (ev.target.closest('[data-remove-code]')) return;
      const code = row.getAttribute('data-watchlist-code');
      if (!code) return;
      navigateTo({ type: 'watchlist-detail', code });
      void openWatchlistDetail(code);
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
    if (!canEditDetailFund()) return;
    navigateTo({ type: 'fund-edit', scope: state.detailScope, code: state.detailCode });
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

  document.querySelectorAll('.bottom-tab[data-main-tab]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const tab = btn.getAttribute('data-main-tab');
      if (!tab || tab === state.mainTab) return;
      activateMainTab(tab);
    });
  });

  document.querySelectorAll('[data-market-tab]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const tab = btn.getAttribute('data-market-tab');
      if (!tab || tab === state.marketTab) return;
      state.marketTab = tab;
      paint();
    });
  });

  document.getElementById('watchlist-search-form')?.addEventListener('submit', (ev) => {
    ev.preventDefault();
    void submitWatchlistAdd();
  });

  document.querySelectorAll('[data-watchlist-sort]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const key = btn.getAttribute('data-watchlist-sort');
      if (!key) return;
      if (state.watchlistSortKey === key) {
        state.watchlistSortDir = state.watchlistSortDir === 'desc' ? 'asc' : 'desc';
      } else {
        state.watchlistSortKey = key;
        state.watchlistSortDir = 'desc';
      }
      state.watchlistRows = applyWatchlistSort(state.watchlistRows);
      paint();
    });
  });

  document.querySelectorAll('[data-remove-code]').forEach((btn) => {
    btn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      const code = btn.getAttribute('data-remove-code');
      if (code) void removeWatchlistCode(code);
    });
  });

  document.getElementById('btn-profile-manage')?.addEventListener('click', () => {
    state.activeScope = state.activeScope && isEditableScope(state.activeScope) ? state.activeScope : 'alipay';
    saveActiveScope(state.activeScope);
    openManagePage('holdings');
  });

  document.getElementById('btn-profile-manage-headers')?.addEventListener('click', () => {
    state.activeScope = state.activeScope && isEditableScope(state.activeScope) ? state.activeScope : 'alipay';
    saveActiveScope(state.activeScope);
    openManagePage('headers');
  });

  document.getElementById('btn-profile-privacy')?.addEventListener('click', () => {
    state.hideAssets = !state.hideAssets;
    saveHideAssets(state.hideAssets);
    paint();
  });
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
    if (canPatchListDom() && patchListDom()) {
      patchBottomTabs();
      return;
    }
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

async function refreshWatchlistView() {
  if (state.busy) {
    refreshPending = true;
    return;
  }
  state.busy = true;
  try {
    const [live, wl] = await Promise.all([fetchLive(), fetchWatchlistLive()]);
    state.indices = live.indices ?? state.indices;
    state.fundRows = mergeLiveIntoFunds(FUNDS, live);
    state.updatedAt = wl.updatedAt || live.updatedAt || state.updatedAt;
    state.quoteUpdatedAt = wl.quoteUpdatedAt || live.quoteUpdatedAt || state.quoteUpdatedAt;
    applyWatchlistLive(wl);
    if (canPatchWatchlistDom() && patchWatchlistDom()) {
      patchBottomTabs();
      return;
    }
    paint();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    state.liveBanner =
      msg === 'HTTP 404'
        ? '自选接口不可用，请重启 API（npm run dev 或 npm run dev:api）'
        : msg;
    state.liveBannerDismissed = false;
    if (!patchLiveBanner()) paint();
  } finally {
    state.busy = false;
    if (refreshPending) {
      refreshPending = false;
      void refreshWatchlistView();
    }
  }
}

async function refreshMarketView() {
  if (state.busy) return;
  state.busy = true;
  try {
    const live = await fetchLive();
    applyLive(live);
    if (patchMarketDom()) {
      patchBottomTabs();
      return;
    }
    paint();
  } catch {
    /* ignore */
  } finally {
    state.busy = false;
  }
}

async function submitWatchlistAdd() {
  const input = document.getElementById('watchlist-code-input');
  const code = input?.value?.trim() ?? '';
  state.watchlistError = null;
  if (!/^\d{6}$/.test(code)) {
    state.watchlistError = '请输入 6 位基金代码';
    paint();
    return;
  }
  try {
    const res = await addWatchlistApi({ code });
    state.watchlistItems = res.items ?? [];
    if (input) input.value = '';
    await refreshWatchlistView();
  } catch (e) {
    state.watchlistError = e instanceof Error ? e.message : String(e);
    paint();
  }
}

async function removeWatchlistCode(code) {
  try {
    const res = await removeWatchlistApi(code);
    state.watchlistItems = res.items ?? [];
    await refreshWatchlistView();
  } catch (e) {
    state.watchlistError = e instanceof Error ? e.message : String(e);
    paint();
  }
}

async function refreshFundLive() {
  if (state.detailSource === 'watchlist') {
    const wl = await fetchWatchlistLive();
    applyWatchlistLive(wl);
    state.updatedAt = wl.updatedAt || state.updatedAt;
    state.quoteUpdatedAt = wl.quoteUpdatedAt || state.quoteUpdatedAt || state.updatedAt;
  } else {
    const live = await fetchLive();
    applyLive(live);
  }
}

async function loadDetailPenetration(code) {
  const { row } = detailMetrics();
  const detail = await fetchFundDetail(code);
  state.detail = {
    impactPct: detail.impactPct ?? row?.impactPct ?? null,
    holdings: detail.holdings ?? [],
    note: detail.note ?? '',
  };
}

async function openHoldingsDetail(scope, code) {
  state.detailSource = 'holdings';
  state.detailScope = scope;
  state.detailCode = code;
  state.holdingsSortKey = 'weight';
  state.holdingsSortDir = 'desc';
  state.fundEditError = null;
  state.detailHoldingsAt = '';
  lastDetailHoldingsFetchAt = 0;
  state.view = 'detail-loading';
  paint();
  scheduleRefresh();

  try {
    if (scope === SCOPE_SUMMARY) {
      state.activeScope = SCOPE_SUMMARY;
      saveActiveScope(SCOPE_SUMMARY);
    } else if (scope && scope !== state.activeScope) {
      state.activeScope = scope;
      saveActiveScope(scope);
    }
    applyDisplayScope();
    await refreshFundLive();
    const { fund } = detailMetrics();
    if (!fund) throw new Error('基金不存在');
    await loadDetailPenetration(code);
    lastDetailHoldingsFetchAt = Date.now();
    state.detailHoldingsAt = state.updatedAt || fmtTime();
    state.view = 'detail';
  } catch (e) {
    state.error = e instanceof Error ? e.message : String(e);
    state.view = 'error';
  }
  paint();
}

async function openWatchlistDetail(code) {
  state.detailSource = 'watchlist';
  state.detailScope = null;
  state.detailCode = code;
  state.mainTab = 'watchlist';
  state.holdingsSortKey = 'weight';
  state.holdingsSortDir = 'desc';
  state.fundEditError = null;
  state.detailHoldingsAt = '';
  lastDetailHoldingsFetchAt = 0;
  state.view = 'detail-loading';
  paint();
  scheduleRefresh();

  try {
    await refreshFundLive();
    const { fund } = detailMetrics();
    if (!fund) throw new Error('自选基金不存在');
    await loadDetailPenetration(code);
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
  if (!state.detailCode) return;
  if (state.busy) {
    refreshPending = true;
    return;
  }
  state.busy = true;
  try {
    await refreshFundLive();
    const holdingsDue =
      !state.detail || Date.now() - lastDetailHoldingsFetchAt >= DETAIL_HOLDINGS_REFRESH_MS;
    if (holdingsDue) {
      await loadDetailPenetration(state.detailCode);
      lastDetailHoldingsFetchAt = Date.now();
      state.detailHoldingsAt = state.updatedAt || fmtTime();
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
    if (state.detailCode && (state.view === 'detail' || state.view === 'detail-loading')) {
      refreshDetailView();
    } else if (state.view === 'list') {
      refreshListView();
    } else if (state.view === 'watchlist') {
      refreshWatchlistView();
    } else if (state.view === 'market') {
      refreshMarketView();
    }
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
    canEditDetailFund,
    detailCtx,
    detailMetrics,
    portfolioFundForDetail,
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
    await loadWatchlistItems().catch(() => {});
    const live = await fetchLive();
    applyLive(live);
    await syncRouteFromHash();
    if (state.view === 'watchlist') void refreshWatchlistView();
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
