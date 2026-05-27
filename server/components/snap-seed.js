/**
 * Snap seed / reconcile / tick 回填。
 */
import { readAppState } from '../app-state.js';
import { canBackfillSnap, resolveDisplaySession, toDisplayStatePayload } from '../display-session.js';
import {
  clearScopeSnap,
  ensureDayBaseline,
  getBaselineForDay,
  getCurrentPhase,
  getScopeSnap,
  round2,
  setCurrentPhase,
  setScopeSnap,
} from '../day-display-state.js';
import { buildFundSnapEntry, sessionSnapNeedsReseed } from './snap-entry.js';
import { getReadyScopeSnap, isScopeSnapReady } from './snap-ready.js';

/**
 * @param {string} accrualDay
 * @param {'premarketSnap'|'afterhoursSnap'|'overnightSnap'} snapKey
 * @param {{ funds: object[] }} portfolio
 * @param {object[]} liveFunds
 * @param {object} totalsLive
 * @param {object[]} impactRawList
 * @param {Date} now
 */
function seedSessionSnap(accrualDay, snapKey, portfolio, liveFunds, totalsLive, impactRawList, now) {
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

  if (s.shouldClearPremarketSnap) {
    clearScopeSnap(accrualDay, 'premarketSnap', 'portfolio');
  }
  if (s.shouldClearOvernightSnap) {
    clearScopeSnap(accrualDay, 'overnightSnap', 'portfolio');
  }

  if (snapKey === 'premarketSnap' || snapKey === 'afterhoursSnap' || snapKey === 'overnightSnap') {
    const existing = getScopeSnap(accrualDay, snapKey, 'portfolio');
    if (sessionSnapNeedsReseed(existing, portfolio, liveFunds, now)) {
      if (existing) clearScopeSnap(accrualDay, snapKey, 'portfolio');
      seedSessionSnap(accrualDay, snapKey, portfolio, liveFunds, totalsLive, impactRawList, now);
    }
  }

  if (targetPhase === 'eod_freeze' && !getScopeSnap(accrualDay, 'eodSnap', 'portfolio')) {
    const baseline = getBaselineForDay(accrualDay, 'portfolio') ?? totalsLive.settledAssets;
    const rt1 = round2(totalsLive.realtimeProfit ?? 0);
    setScopeSnap(accrualDay, 'eodSnap', 'portfolio', {
      at: new Date().toISOString(),
      rt1,
      est: round2(baseline + rt1),
      funds: {},
    });
  }

  if (s.shouldDiscardPremarketSnap) {
    clearScopeSnap(accrualDay, 'premarketSnap', 'portfolio');
  }
  if (s.shouldDiscardOvernightSnap) {
    clearScopeSnap(accrualDay, 'overnightSnap', 'portfolio');
  }
  setCurrentPhase(s.phaseToPersist, now);

  return {
    ...toDisplayStatePayload(s),
    phase: targetPhase,
    activeSnap: snapKey ? getReadyScopeSnap(accrualDay, snapKey, 'portfolio') : null,
  };
}

/**
 * @param {string} accrualDay
 * @param {'premarketSnap'|'afterhoursSnap'|'overnightSnap'} snapKey
 * @param {Date} [now]
 */
export async function tryBackfillSnapFromTicks(accrualDay, snapKey, now = new Date()) {
  if (isScopeSnapReady(getScopeSnap(accrualDay, snapKey, 'portfolio'))) return false;

  const session = resolveDisplaySession(now, { persistedPhase: getCurrentPhase() });
  if (!canBackfillSnap(session, snapKey)) return false;

  const appState = await readAppState();
  const ticks = appState.intradayTicks ?? [];
  /** @type {object[]} */
  let candidates = [];
  if (snapKey === 'premarketSnap') {
    candidates = ticks
      .filter((t) => t.beijingDate === accrualDay && t.updatedAt >= '16:00')
      .sort((a, b) => String(a.updatedAt).localeCompare(String(b.updatedAt)));
  } else if (snapKey === 'overnightSnap') {
    candidates = ticks
      .filter(
        (t) =>
          t.beijingDate === accrualDay && t.updatedAt >= '08:00' && t.updatedAt < '16:00',
      )
      .sort((a, b) => String(a.updatedAt).localeCompare(String(b.updatedAt)));
  } else {
    candidates = ticks
      .filter((t) => t.beijingDate === accrualDay && t.updatedAt >= '04:00' && t.updatedAt <= '08:00')
      .sort((a, b) => String(a.updatedAt).localeCompare(String(b.updatedAt)));
  }
  const hit = candidates[0];
  if (!hit || hit.realtimeProfit == null) return false;

  const baseline = getBaselineForDay(accrualDay, 'portfolio') ?? hit.settledAssets ?? 0;
  setScopeSnap(accrualDay, snapKey, 'portfolio', {
    at: hit.at ?? new Date().toISOString(),
    rt1: round2(hit.realtimeProfit),
    est: round2(hit.realtimeAssets ?? baseline + hit.realtimeProfit),
    funds: {},
    provisional: true,
  });
  return true;
}
