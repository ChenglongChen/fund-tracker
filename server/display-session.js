/**
 * 展示层会话状态 — 唯一入口。
 * 所有 phase / snapKey / RT1 冻结判断均通过 resolveDisplaySession()。
 */
import { getUsSessionPhase } from './holding-market.js';
import { beijingDateString, beijingIsoAddDays, beijingMinutesOfDay } from './time.js';

/** @typedef {'day_open'|'us_regular_live'|'eod_freeze'|'asia_live'} DisplayPhase */
/** @typedef {'eodSnap'} ScopeSnapKey */
/** @typedef {'premarket'|'regular'|'afterhours'|'closed'} UsSessionPhase */

export const BJ_US_REGULAR_START_MIN = 21 * 60 + 30;
export const BJ_US_REGULAR_END_MIN = 4 * 60;
export const BJ_ASIA_LIVE_START_MIN = 8 * 60;
export const BJ_ASIA_LIVE_END_MIN = 16 * 60;

/** RT1 累计日：00:00–04:00 美股正盘尾仍归属前一 accrual 日 */
export function getRt1AccrualDay(now = new Date()) {
  const beijingDate = beijingDateString(now);
  const usPhase = getUsSessionPhase(now);
  const mins = beijingMinutesOfDay(now);
  if (usPhase === 'regular' && mins < BJ_US_REGULAR_END_MIN) {
    return beijingIsoAddDays(beijingDate, -1);
  }
  return beijingDate;
}

/**
 * @param {UsSessionPhase} usPhase
 * @param {number} mins
 * @returns {DisplayPhase}
 */
export function inferDisplayPhaseFromClock(usPhase, mins) {
  if (usPhase === 'regular') return 'us_regular_live';
  if (mins >= BJ_ASIA_LIVE_START_MIN && mins < BJ_ASIA_LIVE_END_MIN) return 'asia_live';
  if (usPhase === 'closed' && mins >= BJ_ASIA_LIVE_START_MIN) return 'eod_freeze';
  return 'day_open';
}

/**
 * @param {UsSessionPhase} _usPhase
 * @param {DisplayPhase} effectivePhase
 * @returns {ScopeSnapKey|null}
 */
export function resolveSnapKey(_usPhase, effectivePhase) {
  if (effectivePhase === 'eod_freeze') return 'eodSnap';
  return null;
}

/**
 * @param {UsSessionPhase} usPhase
 * @param {ScopeSnapKey|null} _snapKey
 * @param {DisplayPhase} clockPhase
 * @returns {DisplayPhase}
 */
export function resolvePhaseToPersist(usPhase, _snapKey, clockPhase) {
  if (usPhase === 'regular') return 'us_regular_live';
  return clockPhase;
}

/**
 * @param {Date} [now]
 * @param {{ persistedPhase?: DisplayPhase|null }} [opts]
 */
export function resolveDisplaySession(now = new Date(), opts = {}) {
  const persistedPhase = opts.persistedPhase ?? null;
  const beijingDate = beijingDateString(now);
  const accrualDay = getRt1AccrualDay(now);
  const usPhase = getUsSessionPhase(now);
  const mins = beijingMinutesOfDay(now);
  const clockPhase = inferDisplayPhaseFromClock(usPhase, mins);
  const effectivePhase = persistedPhase ?? clockPhase;
  const snapKey = resolveSnapKey(usPhase, effectivePhase);
  const phaseToPersist = resolvePhaseToPersist(usPhase, snapKey, clockPhase);

  const isRt1SnapPhase = effectivePhase === 'eod_freeze';
  const rt1Source = isRt1SnapPhase && snapKey === 'eodSnap' ? 'snap' : 'live';

  return {
    now,
    beijingDate,
    accrualDay,
    usPhase,
    clockPhase,
    effectivePhase,
    phaseToPersist,
    snapKey,
    rt1Source,
    isRt1SnapPhase,
  };
}

/** @param {Date} [now] @param {DisplayPhase|null} [persistedPhase] */
export function isRt1SnapPhaseAt(now = new Date(), persistedPhase = null) {
  return resolveDisplaySession(now, { persistedPhase }).isRt1SnapPhase;
}

/** @deprecated 无盘前/盘后，恒为 false */
export function isUsExtendedEstimateWindow(_now = new Date()) {
  return false;
}

/** @deprecated 无盘前，恒为 false */
export function isUsPremarketEstimateWindow(_now = new Date()) {
  return false;
}

/** @param {ReturnType<typeof resolveDisplaySession>} session */
export function toDisplayStatePayload(session) {
  return {
    accrualDay: session.accrualDay,
    beijingDate: session.beijingDate,
    phase: session.clockPhase,
    phasePersisted: session.phaseToPersist,
    usPhase: session.usPhase,
    snapKey: session.snapKey,
    rt1Source: session.rt1Source,
  };
}
