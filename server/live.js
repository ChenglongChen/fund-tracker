import { fetchFundNavInfo, fetchMarketStrip, resolvePortfolioImpacts } from './market.js';
import { readPortfolio } from './store.js';
import { beijingDateString, beijingTimeHms } from './time.js';
import { readAppState, recordLiveSnapshot } from './app-state.js';
import { buildDisplayContext, pickDisplayTotals } from './aggregate.js';
import {
  reapplyDisplayFromCachedFunds,
  runLiveDisplayPipeline,
} from './live-pipeline.js';

const LIVE_REFRESH_MS = 1_000;
const LIVE_FULL_REFRESH_MS = 5 * 60_000;
const SETTLE_CHECK_MS = 30 * 60_000;

/** @type {{ updatedAt: string, quoteUpdatedAt: string, beijingDate: string, indices: object[], fxPct: number|null, funds: object[], totals: object|null, display: object|null, displayContext: object|null, assetViewMode: string, displayState: object|null, error: string|null }} */
let cache = {
  updatedAt: '',
  quoteUpdatedAt: '',
  beijingDate: '',
  indices: [],
  fxPct: null,
  funds: [],
  totals: null,
  display: null,
  displayContext: null,
  assetViewMode: 'settled',
  displayState: null,
  error: null,
};

let liveBusy = false;
let livePending = false;
let settleBusy = false;
let lastFullRefreshAt = 0;
let lastQuoteFingerprint = '';

/** @type {Map<number, string>} */
const fundImpactSourceCache = new Map();

function rememberImpactSources(funds, impacts) {
  for (let i = 0; i < funds.length; i++) {
    const f = funds[i];
    const src = impacts[i]?.impactSource;
    if (f?.id != null && src) fundImpactSourceCache.set(f.id, src);
  }
}

function shouldRunFullImpactRefresh(now = Date.now()) {
  return fundImpactSourceCache.size === 0 || now - lastFullRefreshAt >= LIVE_FULL_REFRESH_MS;
}

function roundQuote(n, digits = 4) {
  if (n == null || !Number.isFinite(Number(n))) return '';
  const f = 10 ** digits;
  return String(Math.round(Number(n) * f) / f);
}

/** @param {object[]} indices @param {object[]} funds @param {number|null} fxPct */
function buildQuoteFingerprint(indices, funds, fxPct) {
  const idx = indices
    .map((i) => `${i.label}:${roundQuote(i.changePct)}:${i.quoteMode ?? ''}:${roundQuote(i.price, 2)}`)
    .join('|');
  const fd = funds
    .map((f) => `${f.id}:${roundQuote(f.impactPct)}:${roundQuote(f.estimateProfit, 2)}`)
    .join('|');
  return `${idx};;${fd};;${roundQuote(fxPct)}`;
}

/** @param {string} updatedAt @param {object[]} indices @param {object[]} funds @param {number|null} fxPct */
function resolveQuoteUpdatedAt(updatedAt, indices, funds, fxPct) {
  const fp = buildQuoteFingerprint(indices, funds, fxPct);
  if (!cache.quoteUpdatedAt || fp !== lastQuoteFingerprint) {
    lastQuoteFingerprint = fp;
    return updatedAt;
  }
  return cache.quoteUpdatedAt;
}

export function getLiveCache() {
  return cache;
}

/** 切换资产口径后重算展示字段（无需重新拉行情） */
export async function refreshLiveDisplay() {
  if (!cache.funds.length) return cache;
  const portfolio = await readPortfolio();
  const appState = await readAppState();
  const now = new Date();
  const { funds, totals } = reapplyDisplayFromCachedFunds(portfolio, cache.funds, now);
  cache.funds = funds;
  cache.totals = totals;
  cache.display = pickDisplayTotals(appState.assetViewMode, totals);
  cache.assetViewMode = appState.assetViewMode;
  cache.displayContext = buildDisplayContext(
    cache.beijingDate,
    cache.updatedAt,
    cache.funds,
    portfolio.meta,
    now,
    cache.quoteUpdatedAt || cache.updatedAt,
  );
  return cache;
}

async function refreshLive() {
  if (liveBusy) {
    livePending = true;
    return;
  }
  liveBusy = true;
  try {
    const now = new Date();
    const updatedAt = beijingTimeHms(now);
    const beijingDate = beijingDateString(now);

    const [portfolio, strip, appState] = await Promise.all([
      readPortfolio(),
      fetchMarketStrip(now),
      readAppState(),
    ]);
    const fxPct = strip.find((x) => x.label === '汇率')?.changePct ?? null;

    const useSourceCache = !shouldRunFullImpactRefresh();
    const [impacts, navInfos] = await Promise.all([
      resolvePortfolioImpacts(
        portfolio.funds,
        strip,
        fxPct,
        now,
        useSourceCache ? fundImpactSourceCache : new Map(),
        { skipAsiaSupplement: false },
      ),
      Promise.all(portfolio.funds.map((f) => fetchFundNavInfo(f.code))),
    ]);
    rememberImpactSources(portfolio.funds, impacts);
    if (!useSourceCache) lastFullRefreshAt = Date.now();

    const { funds: results, totals, displayState } = await runLiveDisplayPipeline(
      portfolio,
      impacts,
      navInfos,
      beijingDate,
      now,
    );

    const display = pickDisplayTotals(appState.assetViewMode, totals);
    const quoteUpdatedAt = resolveQuoteUpdatedAt(updatedAt, strip, results, fxPct);
    const displayContext = buildDisplayContext(
      beijingDate,
      updatedAt,
      results,
      portfolio.meta,
      now,
      quoteUpdatedAt,
    );

    if (!useSourceCache) {
      await recordLiveSnapshot({
        beijingDate,
        updatedAt,
        ...totals,
        assetViewMode: appState.assetViewMode,
      });
    }

    cache = {
      updatedAt,
      quoteUpdatedAt,
      beijingDate,
      indices: strip,
      fxPct,
      funds: results,
      totals,
      display,
      displayContext,
      assetViewMode: appState.assetViewMode,
      displayState,
      portfolioUpdatedAt:
        portfolio.meta?.lastAutoSettleAt ?? portfolio.meta?.importedAt ?? null,
      error: null,
    };
  } catch (e) {
    cache.error = e instanceof Error ? e.message : String(e);
  } finally {
    liveBusy = false;
    if (livePending) {
      livePending = false;
      void refreshLive();
    }
  }
}

/** @param {() => Promise<unknown>} settleFn */
export function startSchedulers(settleFn) {
  refreshLive();
  setInterval(refreshLive, LIVE_REFRESH_MS);

  const runSettle = async () => {
    if (settleBusy) return;
    settleBusy = true;
    try {
      const result = await settleFn();
      if (result.changed) await refreshLive();
    } catch {
      /* next tick */
    } finally {
      settleBusy = false;
    }
  };

  runSettle();
  setInterval(runSettle, SETTLE_CHECK_MS);
}

export { LIVE_REFRESH_MS, LIVE_FULL_REFRESH_MS, SETTLE_CHECK_MS };
export { buildDisplayFundRow as buildLiveFundRow } from './fund-display.js';
