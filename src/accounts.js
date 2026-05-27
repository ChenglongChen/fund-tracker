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
      const totalSettled = funds.reduce((s, f) => s + (f.settledProfit ?? f.yesterdayProfit ?? 0), 0);
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

      let totalRealTimeExtended = 0;
      let usAssets = 0;
      let extendedSession = null;
      for (const f of funds) {
        const ext = f.realTimeProfitExtended;
        if (ext != null && Number.isFinite(ext)) totalRealTimeExtended += ext;
        if (f.market === 'us') {
          usAssets += f.amount ?? 0;
          if (
            f.impactSession === 'premarket' ||
            f.impactSession === 'afterhours' ||
            f.impactSession === 'overnight'
          ) {
            extendedSession = f.impactSession;
          }
        }
      }
      totalRealTimeExtended = Math.round(totalRealTimeExtended * 100) / 100;
      const totalRealTimeExtendedPct =
        usAssets > 0 ? (totalRealTimeExtended / usAssets) * 100 : null;
      const hasExtendedRealtime =
        extendedSession != null &&
        totalRealTimeExtended != null &&
        Math.abs(totalRealTimeExtended) >= 0.001;

      return {
        ...acc,
        totalAssets,
        totalSettled,
        totalSettledPct: dayProfitPct(totalAssets, totalSettled),
        totalRealTime,
        totalRealTimePct,
        hasRealtime,
        totalRealTimeExtended,
        totalRealTimeExtendedPct,
        hasExtendedRealtime,
        extendedSession,
        totalHolding,
        totalHoldingPct,
        fundCount: funds.length,
      };
    })
    .filter((a) => a.fundCount > 0);
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
