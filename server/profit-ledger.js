/**
 * profitLedger 读写 — 收益日历 single writer。
 */
import { dayProfitPct } from './store.js';
import { readAppState, writeAppState } from './app-state.js';

/** @returns {{ days: Record<string, object>, meta: object }} */
export function defaultProfitLedger() {
  return {
    days: {},
    meta: { schemaVersion: 1 },
  };
}

/** @param {unknown} raw */
export function normalizeProfitLedger(raw) {
  const base = defaultProfitLedger();
  if (!raw || typeof raw !== 'object') return base;
  const days = raw.days && typeof raw.days === 'object' ? { ...raw.days } : {};
  const meta =
    raw.meta && typeof raw.meta === 'object'
      ? { ...base.meta, ...raw.meta }
      : { ...base.meta };
  return { days, meta };
}

/** @returns {Promise<{ days: Record<string, object>, meta: object }>} */
export async function readProfitLedger() {
  const state = await readAppState();
  return normalizeProfitLedger(state.profitLedger);
}

/** @param {object} ledger */
export async function writeProfitLedger(ledger) {
  const normalized = normalizeProfitLedger(ledger);
  await writeAppState({ profitLedger: normalized });
  return normalized;
}

/** @param {number} n */
function round2(n) {
  return Math.round(n * 100) / 100;
}

/** @param {number} n */
function round4(n) {
  return Math.round(n * 10000) / 10000;
}

/**
 * @param {object} day
 * @returns {object}
 */
export function rebuildDayAggregates(day) {
  const funds = day.funds && typeof day.funds === 'object' ? day.funds : {};
  /** @type {Record<string, { settledProfit: number, settledAssets: number, settledProfitPct: number|null }>} */
  const accounts = {};
  for (const entry of Object.values(funds)) {
    if (!entry || typeof entry !== 'object') continue;
    const aid = entry.accountId;
    if (!aid) continue;
    if (!accounts[aid]) {
      accounts[aid] = { settledProfit: 0, settledAssets: 0, settledProfitPct: null };
    }
    accounts[aid].settledProfit += entry.settledProfit ?? 0;
    if (entry.settledAssetsAfter != null && Number.isFinite(entry.settledAssetsAfter)) {
      accounts[aid].settledAssets += entry.settledAssetsAfter;
    }
  }
  for (const aid of Object.keys(accounts)) {
    const a = accounts[aid];
    a.settledProfit = round2(a.settledProfit);
    a.settledAssets = round2(a.settledAssets);
    a.settledProfitPct =
      a.settledAssets > 0 ? round4(dayProfitPct(a.settledAssets, a.settledProfit)) : null;
  }

  let portfolioProfit = 0;
  let portfolioAssets = 0;
  for (const a of Object.values(accounts)) {
    portfolioProfit += a.settledProfit;
    portfolioAssets += a.settledAssets;
  }
  const portfolio = {
    settledProfit: round2(portfolioProfit),
    settledAssets: round2(portfolioAssets),
    settledProfitPct:
      portfolioAssets > 0 ? round4(dayProfitPct(portfolioAssets, portfolioProfit)) : null,
  };

  return {
    ...day,
    accounts,
    portfolio,
  };
}

/**
 * @param {{
 *   fundId: number,
 *   accountId: string,
 *   code: string,
 *   creditDay: string,
 *   navDate?: string|null,
 *   settledProfit: number,
 *   settledAssetsAfter: number,
 *   source?: string,
 * }} entry
 */
export async function recordFundSettle(entry) {
  const ledger = await readProfitLedger();
  const dayKey = entry.creditDay;
  if (!dayKey) return ledger;

  const prev = ledger.days[dayKey] ?? {
    creditDay: dayKey,
    funds: {},
    source: entry.source ?? 'settle',
  };

  const funds = { ...prev.funds };
  const id = String(entry.fundId);
  const existing = funds[id];
  const profit = round2(entry.settledProfit);
  funds[id] = {
    accountId: entry.accountId,
    code: entry.code,
    navDate: entry.navDate ?? existing?.navDate ?? null,
    settledProfit: round2((existing?.settledProfit ?? 0) + profit),
    settledAssetsAfter: round2(entry.settledAssetsAfter),
  };

  const nextDay = rebuildDayAggregates({
    ...prev,
    funds,
    source: entry.source ?? prev.source ?? 'settle',
    updatedAt: new Date().toISOString(),
  });

  ledger.days[dayKey] = nextDay;
  return writeProfitLedger(ledger);
}

/**
 * 批量写入某日（回填）；覆盖该日 funds 中对应 fund 或整批 merge。
 * @param {string} creditDay
 * @param {object[]} fundEntries
 * @param {string} source
 */
export async function upsertDayFundEntries(creditDay, fundEntries, source = 'backfill') {
  const ledger = await readProfitLedger();
  const prev = ledger.days[creditDay] ?? { creditDay, funds: {}, source };
  const funds = { ...prev.funds };

  for (const entry of fundEntries) {
    const id = String(entry.fundId);
    const existing = funds[id];
    funds[id] = {
      accountId: entry.accountId,
      code: entry.code,
      navDate: entry.navDate ?? existing?.navDate ?? null,
      settledProfit: round2((existing?.settledProfit ?? 0) + (entry.settledProfit ?? 0)),
      settledAssetsAfter: round2(entry.settledAssetsAfter ?? existing?.settledAssetsAfter ?? 0),
    };
  }

  ledger.days[creditDay] = rebuildDayAggregates({
    ...prev,
    funds,
    source,
    updatedAt: new Date().toISOString(),
  });
  return writeProfitLedger(ledger);
}

/** @param {Record<string, object>} dailyRecords */
export async function migratePortfolioFromDailyRecords(dailyRecords) {
  const ledger = await readProfitLedger();
  let changed = false;
  for (const [day, row] of Object.entries(dailyRecords ?? {})) {
    if (!row || typeof row !== 'object') continue;
    const sp = row.settledProfit;
    if (sp == null || !Number.isFinite(sp)) continue;
    const existing = ledger.days[day];
    if (existing?.portfolio?.settledProfit != null && existing?.accounts && Object.keys(existing.accounts).length) {
      continue;
    }
    ledger.days[day] = rebuildDayAggregates({
      creditDay: day,
      funds: existing?.funds ?? {},
      accounts: existing?.accounts ?? {},
      portfolio: {
        settledProfit: round2(sp),
        settledAssets: round2(row.settledAssets ?? 0),
        settledProfitPct: row.settledProfitPct ?? null,
      },
      source: existing?.source ?? 'migrate-dailyRecords',
      updatedAt: new Date().toISOString(),
    });
    changed = true;
  }
  if (changed) return writeProfitLedger(ledger);
  return ledger;
}

/**
 * @param {string} scope all | accountId
 * @param {object} dayRow
 */
export function scopeDayTotals(scope, dayRow) {
  if (!dayRow) return null;
  if (scope === 'all') return dayRow.portfolio ?? null;
  return dayRow.accounts?.[scope] ?? null;
}

/** @param {string} scope @param {string} from @param {string} to */
export function sumScopeRange(ledger, scope, from, to) {
  let profit = 0;
  let hasAny = false;
  for (const [day, row] of Object.entries(ledger.days ?? {})) {
    if (day < from || day > to) continue;
    const t = scopeDayTotals(scope, row);
    if (t?.settledProfit != null && Number.isFinite(t.settledProfit)) {
      profit += t.settledProfit;
      hasAny = true;
    }
  }
  return hasAny ? round2(profit) : null;
}

/** @param {string} scope @param {string} day */
export function getDayFundDetails(ledger, scope, day) {
  const row = ledger.days?.[day];
  if (!row?.funds) return [];
  return Object.entries(row.funds)
    .map(([id, f]) => ({ fundId: Number(id), ...f }))
    .filter((f) => scope === 'all' || f.accountId === scope);
}
