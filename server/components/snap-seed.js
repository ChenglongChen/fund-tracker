/**
 * Snap seed / reconcile / tick 回填。
 */
import { resolveDisplaySession, toDisplayStatePayload } from '../display-session.js';
import {
  ensureDayBaseline,
  getBaselineForDay,
  getCurrentPhase,
  getScopeSnap,
  round2,
  setCurrentPhase,
  setScopeSnap,
  clearScopeSnap,
} from '../day-display-state.js';
import { buildFundSnapEntry, sessionSnapNeedsReseed } from './snap-entry.js';
import { getReadyScopeSnap, isScopeSnapReady } from './snap-ready.js';

/**
 * @param {string} accrualDay
 * @param {'eodSnap'} snapKey
 * @param {{ funds: object[] }} portfolio
 * @param {object[]} liveFunds
 * @param {object} totalsLive
 * @param {object[]} impactRawList
 * @param {Date} now
 */
function seedEodSnap(accrualDay, snapKey, portfolio, liveFunds, totalsLive, impactRawList, now) {
  /** @type {Record<string, object>} */
  const fundsSnap = {};
  for (let i = 0; i < portfolio.funds.length; i++) {
    const f = portfolio.funds[i];
    const liveRow = liveFunds.find((x) => x.id === f.id) ?? liveFunds[i];
    const raw = impactRawList[i] ?? {};
    const market = liveRow?.market ?? 'cn';
    fundsSnap[f.id] = buildFundSnapEntry(f, liveRow, raw, market, now);
  }
  const rt1 = round2(Object.values(fundsSnap).reduce((s, entry) => s + (entry.rt1 ?? 0), 0));
  const baseline = getBaselineForDay(accrualDay, 'portfolio') ?? totalsLive.settledAssets;
  setScopeSnap(accrualDay, snapKey, 'portfolio', {
    at: new Date().toISOString(),
    rt1,
    est: round2(baseline + rt1),
    funds: fundsSnap,
  });
}

/**
 * @param {{ funds: object[] }} portfolio
 * @param {object[]} liveFunds
 * @param {object} totalsLive
 * @param {object[]} impactRawList
 * @param {Date} [now]
 */
export function reconcileDisplayState(
  portfolio,
  liveFunds,
  totalsLive,
  impactRawList = [],
  now = new Date(),
  session = null,
) {
  ensureDayBaseline(portfolio, now);
  const s = session ?? resolveDisplaySession(now, { persistedPhase: getCurrentPhase() });
  const { accrualDay, clockPhase: targetPhase, snapKey } = s;

  if (snapKey === 'eodSnap') {
    const existing = getScopeSnap(accrualDay, snapKey, 'portfolio');
    if (sessionSnapNeedsReseed(existing, portfolio, liveFunds, now)) {
      if (existing) clearScopeSnap(accrualDay, snapKey, 'portfolio');
      seedEodSnap(accrualDay, snapKey, portfolio, liveFunds, totalsLive, impactRawList, now);
    }
  } else if (targetPhase === 'eod_freeze' && !getScopeSnap(accrualDay, 'eodSnap', 'portfolio')) {
    const baseline = getBaselineForDay(accrualDay, 'portfolio') ?? totalsLive.settledAssets;
    const rt1 = round2(totalsLive.realtimeProfit ?? 0);
    setScopeSnap(accrualDay, 'eodSnap', 'portfolio', {
      at: new Date().toISOString(),
      rt1,
      est: round2(baseline + rt1),
      funds: {},
    });
  }

  setCurrentPhase(s.phaseToPersist, now);

  return {
    ...toDisplayStatePayload(s),
    phase: targetPhase,
    activeSnap: snapKey ? getReadyScopeSnap(accrualDay, snapKey, 'portfolio') : null,
  };
}

/** @deprecated 无盘前/盘后 snap，恒为 false */
export async function tryBackfillSnapFromTicks(_accrualDay, _snapKey, _now = new Date()) {
  return false;
}
