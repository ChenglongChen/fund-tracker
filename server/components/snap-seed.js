import { beijingIsoString } from '../time.js';
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

/** 16:00 eod_freeze snap 已就绪（非 day_open / 非 provisional）。 */
function hasReadyEodFreezeSnap(existing, now, accrualDay) {
  return (
    existing?.seedPhase === 'eod_freeze' &&
    isScopeSnapReady(existing, now, accrualDay)
  );
}

/**
 * @param {string} accrualDay
 * @param {'eodSnap'} snapKey
 * @param {{ funds: object[] }} portfolio
 * @param {object[]} liveFunds
 * @param {object} totalsLive
 * @param {object[]} impactRawList
 * @param {Date} now
 * @param {DisplayPhase} seedPhase
 */
function seedEodSnap(
  accrualDay,
  snapKey,
  portfolio,
  liveFunds,
  totalsLive,
  impactRawList,
  now,
  seedPhase,
) {
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
  const baseline =
    getBaselineForDay(accrualDay, 'portfolio') ?? totalsLive.settledAssets ?? 0;
  setScopeSnap(accrualDay, snapKey, 'portfolio', {
    at: beijingIsoString(now),
    seedPhase,
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

  if (targetPhase === 'day_open') {
    const existing = getScopeSnap(accrualDay, 'eodSnap', 'portfolio');
    // 04:00 首次写入；已有 day_open snap 不重复 seed（isScopeSnapReady 对 day_open 恒 false）
    const needsDayOpenSnap =
      !existing ||
      existing.seedPhase === 'us_regular_live' ||
      (existing.seedPhase !== 'day_open' && !isScopeSnapReady(existing));
    if (needsDayOpenSnap) {
      if (existing) clearScopeSnap(accrualDay, 'eodSnap', 'portfolio');
      seedEodSnap(
        accrualDay,
        'eodSnap',
        portfolio,
        liveFunds,
        totalsLive,
        impactRawList,
        now,
        targetPhase,
      );
    }
  } else if (snapKey === 'eodSnap' && targetPhase === 'eod_freeze') {
    const existing = getScopeSnap(accrualDay, snapKey, 'portfolio');

    if (hasReadyEodFreezeSnap(existing, now, accrualDay)) {
      if (sessionSnapNeedsReseed(existing, portfolio, liveFunds, now)) {
        clearScopeSnap(accrualDay, snapKey, 'portfolio');
        seedEodSnap(
          accrualDay,
          snapKey,
          portfolio,
          liveFunds,
          totalsLive,
          impactRawList,
          now,
          targetPhase,
        );
      }
    } else {
      // 16:00 首次或仅有 day_open：用当前 live 写入 eod snap（capture ~39k），禁止 promote day_open
      if (existing) clearScopeSnap(accrualDay, snapKey, 'portfolio');
      seedEodSnap(
        accrualDay,
        snapKey,
        portfolio,
        liveFunds,
        totalsLive,
        impactRawList,
        now,
        targetPhase,
      );
    }
  } else if (
    !getScopeSnap(accrualDay, 'eodSnap', 'portfolio') &&
    (targetPhase === 'eod_freeze' || targetPhase === 'day_open')
  ) {
    seedEodSnap(
      accrualDay,
      'eodSnap',
      portfolio,
      liveFunds,
      totalsLive,
      impactRawList,
      now,
      targetPhase,
    );
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
