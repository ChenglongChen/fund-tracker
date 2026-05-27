/**
 * 自选列表持久化（app-state.json）与 live 虚拟持仓口径。
 */
import { fetchFundGz, fetchFundNavInfo, fetchMarketStrip, resolvePortfolioImpacts } from './market.js';
import { readAppState, writeAppState } from './app-state.js';
import { buildDisplayFundRows } from './live-pipeline.js';
import { buildDisplayContext } from './aggregate.js';
import { beijingDateString, beijingTimeHms } from './time.js';
import { getLiveCache } from './live.js';
import { classifyFundMarket } from './components/market-hours.js';
import { profitFromNavChgRt } from './nav.js';

/** 自选展示用参考金额（与持仓列表同公式，仅无真实持仓） */
export const WATCHLIST_NOTIONAL = 10_000;

/** @typedef {{ code: string, name: string, addedAt: string }} WatchlistItem */

/** @returns {Promise<WatchlistItem[]>} */
export async function readWatchlist() {
  const state = await readAppState();
  const raw = state.watchlist;
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((x) => x && /^\d{6}$/.test(String(x.code || '')))
    .map((x) => ({
      code: String(x.code),
      name: String(x.name || x.code),
      addedAt: x.addedAt || new Date().toISOString(),
    }));
}

/** @param {WatchlistItem[]} items */
async function writeWatchlist(items) {
  await writeAppState({ watchlist: items });
  return items;
}

/** @param {string} code @param {string} [name] */
async function resolveName(code, name) {
  const trimmed = String(name || '').trim();
  if (trimmed) return trimmed;
  const gz = await fetchFundGz(code);
  if (gz?.name) return gz.name;
  const nav = await fetchFundNavInfo(code);
  return nav?.name || code;
}

/** @param {string} code @param {string} [name] */
export async function addWatchlistItem(code, name) {
  const c = String(code || '').trim();
  if (!/^\d{6}$/.test(c)) throw new Error('基金代码需为 6 位数字');
  const items = await readWatchlist();
  if (items.some((x) => x.code === c)) throw new Error(`基金 ${c} 已在自选列表中`);
  const resolved = await resolveName(c, name);
  const next = [{ code: c, name: resolved, addedAt: new Date().toISOString() }, ...items];
  return writeWatchlist(next);
}

/** @param {string} code */
export async function removeWatchlistItem(code) {
  const c = String(code || '').trim();
  const items = await readWatchlist();
  const next = items.filter((x) => x.code !== c);
  if (next.length === items.length) throw new Error('自选基金不存在');
  return writeWatchlist(next);
}

/** @param {WatchlistItem[]} items @param {object[]} navInfos */
function buildVirtualFunds(items, navInfos) {
  return items.map((item, i) => {
    const nav = navInfos[i];
    const name = item.name !== item.code ? item.name : nav?.name || item.name;
    return {
      id: -(i + 1),
      code: item.code,
      name,
      accountId: '__watchlist__',
      amount: WATCHLIST_NOTIONAL,
      totalProfit: 0,
      totalProfitPct: 0,
      yesterdayProfit: 0,
      lastNavDate: nav?.pdate ?? null,
      lastNav: nav?.nav ?? null,
    };
  });
}

/** @param {WatchlistItem[]} items @param {object[]} navInfos */
async function backfillWatchlistNames(items, navInfos) {
  let changed = false;
  const next = items.map((item, i) => {
    if (item.name !== item.code) return item;
    const navName = navInfos[i]?.name;
    if (!navName) return item;
    changed = true;
    return { ...item, name: navName };
  });
  if (changed) await writeWatchlist(next);
  return changed ? next : items;
}

/** @param {object} row @param {object|null} nav */
function applyWatchlistDaily(row, nav) {
  if (nav?.navChgRt == null || !Number.isFinite(nav.navChgRt)) return row;
  const profit = profitFromNavChgRt(WATCHLIST_NOTIONAL, nav.navChgRt);
  if (profit == null || !Number.isFinite(profit)) return row;
  return {
    ...row,
    settledProfit: Math.round(profit * 100) / 100,
    settledPct: nav.navChgRt,
    settledNavDate: nav.pdate ?? row.settledNavDate,
    settledSource: 'eastmoney',
    dailyPending: false,
  };
}

/** @param {Date} [now] */
export async function buildWatchlistLive(now = new Date()) {
  const items = await readWatchlist();
  const beijingDate = beijingDateString(now);
  const updatedAt = beijingTimeHms(now);
  if (!items.length) {
    return { funds: [], displayContext: null, updatedAt, quoteUpdatedAt: updatedAt, beijingDate };
  }

  const live = getLiveCache();
  let strip = live.indices?.length ? live.indices : null;
  let fxPct = live.fxPct ?? null;
  if (!strip?.length) {
    strip = await fetchMarketStrip(now);
    fxPct = strip.find((x) => x.label === '汇率')?.changePct ?? null;
  }

  const navInfos = await Promise.all(items.map((item) => fetchFundNavInfo(item.code)));
  const persistedItems = await backfillWatchlistNames(items, navInfos);
  const portfolio = {
    funds: buildVirtualFunds(persistedItems, navInfos),
    meta: { beijingDate },
  };

  const impacts = await resolvePortfolioImpacts(portfolio.funds, strip, fxPct, now);

  const funds = buildDisplayFundRows(portfolio, impacts, navInfos, beijingDate, now).map((row, i) => {
    const item = persistedItems[i];
    const fund = portfolio.funds[i];
    const withDaily = applyWatchlistDaily(row, navInfos[i]);
    return {
      ...withDaily,
      code: item.code,
      name: fund.name,
      watchlist: true,
      market: withDaily.market ?? classifyFundMarket(fund),
    };
  });

  const quoteUpdatedAt = live.quoteUpdatedAt || updatedAt;
  const displayContext = buildDisplayContext(
    beijingDate,
    updatedAt,
    funds,
    portfolio.meta,
    now,
    quoteUpdatedAt,
  );

  return { funds, displayContext, updatedAt, quoteUpdatedAt, beijingDate };
}
