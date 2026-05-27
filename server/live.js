import { fetchFundNavInfo, fetchMarketStrip, resolvePortfolioImpacts } from './market.js';
import {
  getFundProfitWindows,
  isDailyProfitPending,
  resolveLiveDisplayImpact,
  shouldSuppressDomesticRealtimeDuringUsRegular,
} from './market-session.js';
import { enrichFundSettled } from './nav.js';
import { readPortfolio } from './store.js';
import { beijingDateString, beijingTimeHms } from './time.js';
import { readAppState, recordLiveSnapshot } from './app-state.js';
import { buildDisplayContext, computePortfolioTotals, pickDisplayTotals } from './aggregate.js';
import {
  fundEstimateImpactPct,
  fundEstimateProfit,
  fundEstimatedAssets,
} from './fund-estimate.js';
import {
  applyFundRt1Snap,
  applyPortfolioTotalsSnap,
  reconcileDisplayState,
  sumExtendedProfit,
  tryBackfillSnapFromTicks,
} from './display-state-machine.js';
import { getRt1AccrualDay } from './day-display-state.js';

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
  const totals = computePortfolioTotals(portfolio, cache.funds);
  cache.totals = totals;
  cache.display = pickDisplayTotals(appState.assetViewMode, totals);
  cache.assetViewMode = appState.assetViewMode;
  cache.displayContext = buildDisplayContext(
    cache.beijingDate,
    cache.updatedAt,
    cache.funds,
    portfolio.meta,
    new Date(),
    cache.quoteUpdatedAt || cache.updatedAt,
  );
  return cache;
}

/**
 * @param {object} f
 * @param {object} r
 * @param {object|null} navInfo
 * @param {string} beijingDate
 * @param {Date} now
 */
function buildLiveFundRow(f, r, navInfo, beijingDate, now) {
  const settled = enrichFundSettled(f, navInfo);
  const windows = getFundProfitWindows(
    { ...f, lastNavDate: settled.settledNavDate ?? f.lastNavDate },
    beijingDate,
    now,
  );
  const displayImpact = resolveLiveDisplayImpact(f.id, windows.market, r, now);
  const {
    impactPct,
    impactPctRegular,
    impactPctExtended,
    impactSession,
    rawImpactPct,
  } = displayImpact;
  const amount = f.amount ?? 0;
  const displayLive =
    impactPct != null && Number.isFinite(impactPct)
      ? {
          market: windows.market,
          impactPct: impactPctRegular ?? impactPct,
          impactPctRegular: impactPctRegular ?? null,
          impactPctExtended: impactPctExtended ?? null,
        }
      : null;
  const impactPctRegularLive =
    r?.impactPctRegular != null && Number.isFinite(r.impactPctRegular)
      ? r.impactPctRegular
      : r?.impactPct != null && Number.isFinite(r.impactPct)
        ? r.impactPct
        : null;
  const impactPctExtendedLive =
    r?.impactPctExtended != null && Number.isFinite(r.impactPctExtended)
      ? r.impactPctExtended
      : null;
  const estimateImpactPct = displayLive ? fundEstimateImpactPct(displayLive, now) : null;
  const estimateProfit = displayLive ? fundEstimateProfit(amount, displayLive, now) : null;
  const realTimeProfitExtended =
    displayLive && impactPctExtendedLive != null
      ? Math.round(((amount * impactPctExtendedLive) / 100) * 100) / 100
      : null;
  const dailyPending = isDailyProfitPending(
    f,
    windows.market,
    navInfo,
    beijingDate,
    now,
  );
  const settledFields = dailyPending
    ? {
        settledNavDate: settled.settledNavDate ?? f.lastNavDate ?? null,
        settledProfit: null,
        settledPct: null,
        settledSource: settled.settledSource ?? 'portfolio',
      }
    : settled;
  const estimateAssets = fundEstimatedAssets(
    amount,
    settledFields.settledProfit ?? f.yesterdayProfit ?? null,
    displayLive,
    dailyPending,
    now,
    null,
    estimateProfit,
  );
  const suppressDomestic = shouldSuppressDomesticRealtimeDuringUsRegular(windows.market, now);
  return {
    id: f.id,
    code: f.code,
    name: f.name,
    amount,
    totalProfit: f.totalProfit ?? null,
    totalProfitPct: f.totalProfitPct ?? null,
    yesterdayProfit: f.yesterdayProfit ?? null,
    shares: f.shares ?? null,
    lastNav: f.lastNav ?? null,
    impactPct,
    impactPctRegular,
    impactPctExtended,
    impactPctRegularLive,
    impactPctExtendedLive,
    estimateImpactPct,
    impactSession,
    estimateProfit,
    estimateAssets,
    realTimeProfitExtended,
    dailyPending,
    weightCoverage: r.weightCoverage ?? null,
    quoteCoverage: r.quoteCoverage ?? null,
    reportFundCount: r.reportFundCount ?? 0,
    holdingsCount: r.count ?? 0,
    lastNavDate: settled.settledNavDate ?? f.lastNavDate ?? null,
    ...settledFields,
    ...windows,
    realtimeActive: suppressDomestic ? false : windows.realtimeActive,
    rawImpactPct,
    impactSource: r.impactSource ?? null,
    estimateSource: r.impactSource ?? null,
    officialNavDate: navInfo?.pdate ?? null,
    officialDisplayDate: navInfo?.displayDate ?? null,
  };
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
    const accrualDay = getRt1AccrualDay(now);

    const [portfolio, strip, appState] = await Promise.all([
      readPortfolio(),
      fetchMarketStrip(now),
      readAppState(),
    ]);
    const fxPct = strip.find((x) => x.label === '汇率')?.changePct ?? null;

    cache = {
      ...cache,
      updatedAt,
      beijingDate,
      indices: strip,
      fxPct,
      error: null,
    };

    const useSourceCache = !shouldRunFullImpactRefresh();
    const [impacts, navInfos] = await Promise.all([
      resolvePortfolioImpacts(
        portfolio.funds,
        strip,
        fxPct,
        now,
        useSourceCache ? fundImpactSourceCache : new Map(),
        { skipAsiaSupplement: useSourceCache },
      ),
      Promise.all(portfolio.funds.map((f) => fetchFundNavInfo(f.code))),
    ]);
    rememberImpactSources(portfolio.funds, impacts);
    if (!useSourceCache) lastFullRefreshAt = Date.now();

    let results = portfolio.funds.map((f, idx) => {
      try {
        return buildLiveFundRow(f, impacts[idx] ?? {}, navInfos[idx] ?? null, beijingDate, now);
      } catch {
        const settled = enrichFundSettled(f, navInfos[idx] ?? null);
        const windows = getFundProfitWindows(
          { ...f, lastNavDate: settled.settledNavDate ?? f.lastNavDate },
          beijingDate,
          now,
        );
        return {
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
          officialNavDate: navInfos[idx]?.pdate ?? null,
          officialDisplayDate: navInfos[idx]?.displayDate ?? null,
        };
      }
    });

    const totalsLive = computePortfolioTotals(portfolio, results, now);
    await tryBackfillSnapFromTicks(accrualDay, 'premarketSnap');
    await tryBackfillSnapFromTicks(accrualDay, 'afterhoursSnap');

    const displayState = reconcileDisplayState(portfolio, results, totalsLive, impacts, now);

    results = results.map((row) => applyFundRt1Snap(row.id, row, accrualDay, now));
    const totals = applyPortfolioTotalsSnap(
      computePortfolioTotals(portfolio, results, now),
      accrualDay,
      now,
    );
    const extended = sumExtendedProfit(results, now);
    totals.realtimeProfitExtended = extended.total;
    totals.realtimeProfitExtendedPct = extended.pct;
    totals.extendedSession = extended.session;

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
