import { beijingIsoString } from '../time.js';
import { resolveDisplaySession, toDisplayStatePayload } from '../display-session.js';
import {
  ensureDayBaseline,
  getBaselineForDay,
  getCurrentPhase,
  getScopeSnap,
  round2,
  setBaselineForDay,
  setCurrentPhase,
  setScopeSnap,
  clearScopeSnap,
} from '../day-display-state.js';
import { buildFundSnapEntry, sessionSnapNeedsReseed } from './snap-entry.js';
import { getReadyScopeSnap, isScopeSnapReady } from './snap-ready.js';

/** snap 就绪时把 B[D] 拉回 Σ amountAtSnap，修复 NAV 入账误抬 baseline。 */
function healBaselineFromReadySnap(accrualDay, now) {
  const snap = getReadyScopeSnap(accrualDay, 'eodSnap', 'portfolio', now);
  if (snap?.est == null) return;
  const frozen = round2(snap.est - (snap.rt1 ?? 0));
  const stored = getBaselineForDay(accrualDay, 'portfolio');
  if (stored == null || Math.abs(stored - frozen) > 0.005) {
    setBaselineForDay(accrualDay, 'portfolio', frozen);
  }
}

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
  const frozenBaseline = round2(
    Object.values(fundsSnap).reduce((s, entry) => s + (entry.amountAtSnap ?? 0), 0),
  );
  // snap seed 冻结 B[D]=Σ amountAtSnap；入账后 baseline 不得再随 NAV 漂移
  setBaselineForDay(accrualDay, 'portfolio', frozenBaseline);
  setScopeSnap(accrualDay, snapKey, 'portfolio', {
    at: beijingIsoString(now),
    seedPhase,
    rt1,
    est: round2(frozenBaseline + rt1),
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
  healBaselineFromReadySnap(accrualDay, now);

  return {
    ...toDisplayStatePayload(s),
    phase: targetPhase,
    activeSnap: snapKey ? getReadyScopeSnap(accrualDay, snapKey, 'portfolio') : null,
  };
}
