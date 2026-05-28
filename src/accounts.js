import { dayProfitPct } from './portfolio.js';

export const SCOPE_SUMMARY = 'summary';
export const SCOPE_ALL = 'all';

const SCOPE_KEY = 'fund-tracker-active-scope';

/** @param {object[]} rows @param {object[]} accounts */
export function buildAccountSummaries(rows, accounts) {
  return accounts
    .map((acc) => {
      const funds = rows.filter((f) => f.accountId === acc.id);
      const totalAssets = funds.reduce((s, f) => s + f.amount, 0);
      let totalSettled = 0;
      let hasDaily = false;
      for (const f of funds) {
        if (f.dailyPending) continue;
        if (f.settledProfit == null || !Number.isFinite(f.settledProfit)) continue;
        hasDaily = true;
        totalSettled += f.settledProfit;
      }
      const totalHolding = funds.reduce((s, f) => s + f.totalProfit, 0);
      const costBasis = totalAssets - totalHolding;
      const totalHoldingPct = costBasis > 0 ? (totalHolding / costBasis) * 100 : null;
      const rtFunds = funds.filter(
        (f) => f.realTimeProfit != null && Number.isFinite(f.realTimeProfit),
      );
      const totalRealTime = rtFunds.reduce((s, f) => s + f.realTimeProfit, 0);
      const hasRealtime = rtFunds.length > 0;
      const totalRealTimePct =
        hasRealtime && totalAssets > 0 ? (totalRealTime / totalAssets) * 100 : null;

      return {
        ...acc,
        totalAssets,
        totalSettled: hasDaily ? totalSettled : null,
        totalSettledPct: hasDaily ? dayProfitPct(totalAssets, totalSettled) : null,
        totalRealTime,
        totalRealTimePct,
        hasRealtime,
        totalHolding,
        totalHoldingPct,
        fundCount: funds.length,
      };
    })
    .filter((a) => a.fundCount > 0);
}

/** @param {object[]} rows */
export function attachAssetSharePct(rows) {
  const total = rows.reduce((s, r) => s + (r.displayAmount ?? r.amount ?? 0), 0);
  return rows.map((r) => ({
    ...r,
    assetSharePct:
      total > 0 ? ((r.displayAmount ?? r.amount ?? 0) / total) * 100 : null,
  }));
}

/** 账户概况列表行（字段与基金行对齐，供排序 / 列表渲染） */
export function buildAccountDisplayRows(rows, accounts, totalsByAccount = null) {
  const summaries = buildAccountSummaries(rows, accounts);
  return attachAssetSharePct(
    summaries.map((acc) => {
      const canonical = totalsByAccount?.[acc.id];
      const settledProfit =
        canonical?.settledProfit != null && Number.isFinite(canonical.settledProfit)
          ? canonical.settledProfit
          : acc.totalSettled;
      const settledPct =
        settledProfit != null
          ? (canonical?.settledProfitPct ?? acc.totalSettledPct)
          : null;
      const realTimeProfit =
        canonical?.realtimeProfit != null && Number.isFinite(canonical.realtimeProfit)
          ? canonical.realtimeProfit
          : acc.hasRealtime
            ? acc.totalRealTime
            : null;
      const realTimePct =
        realTimeProfit != null
          ? (canonical?.realtimeProfitPct ??
            (acc.totalAssets > 0 ? (realTimeProfit / acc.totalAssets) * 100 : null))
          : null;
      return {
        id: acc.id,
        name: acc.name,
        amount: canonical?.settledAssets ?? acc.totalAssets,
        displayAmount: canonical?.settledAssets ?? acc.totalAssets,
        realTimeProfit,
        realTimePct,
        hasRealtime: realTimeProfit != null && Number.isFinite(realTimeProfit),
        settledProfit,
        settledPct,
        totalProfit: canonical?.holdingProfit ?? acc.totalHolding,
        totalProfitPct: acc.totalHoldingPct,
        accountId: acc.id,
        isAccountRow: true,
        fundCount: acc.fundCount,
      };
    }),
  );
}

/** @param {object} target @param {string} field @param {number|null|undefined} value */
function sumNullableField(target, field, value) {
  if (value == null || !Number.isFinite(value)) return;
  target[field] = (target[field] ?? 0) + value;
}

/** @param {object[]} rows */
export function mergeFundsByCode(rows) {
  /** @type {Map<string, object>} */
  const map = new Map();

  for (const f of rows) {
    const existing = map.get(f.code);
    if (!existing) {
      map.set(f.code, {
        ...f,
        mergedIds: [f.id],
        accountIds: [f.accountId],
        isMerged: false,
      });
      continue;
    }

    existing.amount += f.amount;
    existing.totalProfit += f.totalProfit;
    existing.yesterdayProfit = (existing.yesterdayProfit ?? 0) + (f.yesterdayProfit ?? 0);
    existing.settledProfit = (existing.settledProfit ?? 0) + (f.settledProfit ?? 0);
    sumNullableField(existing, 'realTimeProfit', f.realTimeProfit);
    sumNullableField(existing, 'estimateProfit', f.estimateProfit);
    sumNullableField(existing, 'realTimeProfitRegular', f.realTimeProfitRegular);
    sumNullableField(existing, 'realTimeProfitExtended', f.realTimeProfitExtended);
    existing.mergedIds.push(f.id);
    if (!existing.accountIds.includes(f.accountId)) existing.accountIds.push(f.accountId);
    existing.isMerged = existing.mergedIds.length > 1;

    const principal = existing.amount - existing.totalProfit;
    existing.totalProfitPct = principal > 0 ? (existing.totalProfit / principal) * 100 : null;
    existing.settledPct = dayProfitPct(existing.amount, existing.settledProfit);
    if (existing.realTimeProfit != null && existing.amount > 0) {
      existing.realTimePct = (existing.realTimeProfit / existing.amount) * 100;
    }
    if (existing.realTimeProfitRegular != null && existing.amount > 0) {
      existing.realTimePctRegular = (existing.realTimeProfitRegular / existing.amount) * 100;
    }
    existing.realtimeActive = existing.realtimeActive || f.realtimeActive;
  }

  return Array.from(map.values());
}

/** @param {string} scope */
export function isEditableScope(scope) {
  return scope !== SCOPE_SUMMARY && scope !== SCOPE_ALL;
}

/** @returns {string} */
export function loadActiveScope() {
  try {
    const v = localStorage.getItem(SCOPE_KEY);
    return v || SCOPE_ALL;
  } catch {
    return SCOPE_ALL;
  }
}

/** @param {string} scope */
export function saveActiveScope(scope) {
  localStorage.setItem(SCOPE_KEY, scope);
  return scope;
}

/** @param {object[]} rows @param {string} scope */
export function rowsForScope(rows, scope) {
  if (scope === SCOPE_SUMMARY) return [];
  if (scope === SCOPE_ALL) return mergeFundsByCode(rows);
  return rows.filter((f) => f.accountId === scope);
}

/** @param {object[]} accounts @param {string} scope */
export function scopeLabel(accounts, scope) {
  if (scope === SCOPE_SUMMARY) return '账户概况';
  if (scope === SCOPE_ALL) return '全部持仓';
  return accounts.find((a) => a.id === scope)?.name ?? scope;
}
