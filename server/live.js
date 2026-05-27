import { fetchFundNavInfo, fetchMarketStrip, resolveFundImpact } from './market.js';
import { getFundProfitWindows, effectiveImpactPct } from './market-session.js';
import { enrichFundSettled } from './nav.js';
import { readPortfolio } from './store.js';
import { beijingDateString, beijingTimeHm } from './time.js';
import { readAppState, recordLiveSnapshot } from './app-state.js';
import { buildDisplayContext, computePortfolioTotals, pickDisplayTotals } from './aggregate.js';

const LIVE_REFRESH_MS = 1_000;
const SETTLE_CHECK_MS = 30 * 60_000;

/** @type {{ updatedAt: string, beijingDate: string, indices: object[], fxPct: number|null, funds: object[], totals: object|null, display: object|null, displayContext: object|null, assetViewMode: string, error: string|null }} */
let cache = {
  updatedAt: '',
  beijingDate: '',
  indices: [],
  fxPct: null,
  funds: [],
  totals: null,
  display: null,
  displayContext: null,
  assetViewMode: 'settled',
  error: null,
};

let liveBusy = false;
let livePending = false;
let settleBusy = false;

export function getLiveCache() {
  return cache;
}

/** 切换资产口径后重算展示字段（无需重新拉行情） */
export async function refreshLiveDisplay() {
  if (!cache.funds.length) return cache;
  const portfolio = await readPortfolio();
  const appState = await readAppState();
  const totals = computePortfolioTotals(portfolio, cache.funds);
  cache.totals = totals;
  cache.display = pickDisplayTotals(appState.assetViewMode, totals);
  cache.assetViewMode = appState.assetViewMode;
  cache.displayContext = buildDisplayContext(
    cache.beijingDate,
    cache.updatedAt,
    totals.openMarkets,
    cache.funds,
    portfolio.meta,
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
    const portfolio = await readPortfolio();
    const strip = await fetchMarketStrip();
    const fxPct = strip.find((x) => x.label === '汇率')?.changePct ?? null;
    const now = new Date();
    const updatedAt = beijingTimeHm(now);
    const beijingDate = beijingDateString(now);

    const concurrency = 4;
    const funds = portfolio.funds;
    const results = [];
    let i = 0;

    async function worker() {
      while (i < funds.length) {
        const idx = i++;
        const f = funds[idx];
        try {
          const [r, navInfo] = await Promise.all([
            resolveFundImpact(f.code, fxPct, f.name, strip),
            fetchFundNavInfo(f.code),
          ]);
          const settled = enrichFundSettled(f, navInfo);
          const windows = getFundProfitWindows(
            { ...f, lastNavDate: settled.settledNavDate ?? f.lastNavDate },
            beijingDate,
            now,
          );
          const rawImpactPct =
            r.impactPct != null && Number.isFinite(r.impactPct) ? r.impactPct : null;
          const impactPct = effectiveImpactPct(windows.market, rawImpactPct, now);
          results[idx] = {
            id: f.id,
            code: f.code,
            name: f.name,
            impactPct,
            weightCoverage: r.weightCoverage,
            quoteCoverage: r.quoteCoverage,
            reportFundCount: r.reportFundCount ?? 0,
            holdingsCount: r.count,
            lastNavDate: settled.settledNavDate ?? f.lastNavDate ?? null,
            ...settled,
            ...windows,
            rawImpactPct,
            impactSource: r.impactSource ?? null,
            officialNavDate: navInfo?.pdate ?? null,
            officialDisplayDate: navInfo?.displayDate ?? null,
          };
        } catch {
          const settled = enrichFundSettled(f, null);
          const windows = getFundProfitWindows(
            { ...f, lastNavDate: settled.settledNavDate ?? f.lastNavDate },
            beijingDate,
            now,
          );
          results[idx] = {
            id: f.id,
            code: f.code,
            name: f.name,
            impactPct: null,
            weightCoverage: null,
            holdingsCount: 0,
            lastNavDate: settled.settledNavDate ?? f.lastNavDate ?? null,
            ...settled,
            ...windows,
            rawImpactPct: null,
            officialNavDate: null,
            officialDisplayDate: null,
          };
        }
      }
    }

    await Promise.all(Array.from({ length: concurrency }, () => worker()));

    const appState = await readAppState();
    const totals = computePortfolioTotals(portfolio, results.filter(Boolean));
    const display = pickDisplayTotals(appState.assetViewMode, totals);
    const displayContext = buildDisplayContext(
      beijingDate,
      updatedAt,
      totals.openMarkets,
      results.filter(Boolean),
      portfolio.meta,
    );

    await recordLiveSnapshot({
      beijingDate,
      updatedAt,
      ...totals,
      assetViewMode: appState.assetViewMode,
    });

    cache = {
      updatedAt,
      beijingDate,
      indices: strip,
      fxPct,
      funds: results.filter(Boolean),
      totals,
      display,
      displayContext,
      assetViewMode: appState.assetViewMode,
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

export { LIVE_REFRESH_MS, SETTLE_CHECK_MS };
