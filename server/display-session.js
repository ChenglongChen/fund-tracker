/**
 * 展示层会话状态 — 唯一入口。
 * 所有 phase / snapKey / RT1 冻结 / row2 窗口判断均通过 resolveDisplaySession()。
 */
import { getUsSessionPhase } from './holding-market.js';
import { beijingDateString, beijingIsoAddDays, beijingMinutesOfDay } from './time.js';

/** @typedef {'day_open'|'afterhours_freeze'|'overnight_freeze'|'premarket_freeze'|'us_regular_live'|'eod_freeze'|'asia_live'} DisplayPhase */
/** @typedef {'premarketSnap'|'afterhoursSnap'|'overnightSnap'|'eodSnap'} ScopeSnapKey */
/** @typedef {'premarket'|'regular'|'afterhours'|'overnight'|'closed'} UsSessionPhase */

export const BJ_PREMARKET_START_MIN = 16 * 60;
export const BJ_US_REGULAR_START_MIN = 21 * 60 + 30;
export const BJ_US_REGULAR_END_MIN = 4 * 60;
export const BJ_AFTERHOURS_END_MIN = 8 * 60;
export const BJ_OVERNIGHT_END_MIN = 16 * 60;
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
  if (usPhase === 'afterhours') return 'afterhours_freeze';
  if (usPhase === 'overnight') return 'overnight_freeze';
  if (usPhase === 'premarket') return 'premarket_freeze';
  if (usPhase === 'regular') return 'us_regular_live';
  if (mins >= BJ_ASIA_LIVE_START_MIN && mins < BJ_ASIA_LIVE_END_MIN) return 'asia_live';
  if (usPhase === 'closed' && mins >= BJ_ASIA_LIVE_START_MIN) return 'eod_freeze';
  return 'day_open';
}

/**
 * 活跃 snap 键：时钟 usPhase 优先于 persisted phase（避免 21:30 后仍读 premarketSnap）。
 * @param {UsSessionPhase} usPhase
 * @param {DisplayPhase} effectivePhase
 * @returns {ScopeSnapKey|null}
 */
export function resolveSnapKey(usPhase, effectivePhase) {
  if (usPhase === 'premarket') return 'premarketSnap';
  if (usPhase === 'afterhours') return 'afterhoursSnap';
  if (usPhase === 'overnight') return 'overnightSnap';
  if (effectivePhase === 'eod_freeze') return 'eodSnap';
  if (effectivePhase === 'premarket_freeze') return 'premarketSnap';
  if (effectivePhase === 'afterhours_freeze') return 'afterhoursSnap';
  if (effectivePhase === 'overnight_freeze') return 'overnightSnap';
  return null;
}

/**
 * @param {UsSessionPhase} usPhase
 * @param {ScopeSnapKey|null} snapKey
 * @param {DisplayPhase} clockPhase
 * @returns {DisplayPhase}
 */
export function resolvePhaseToPersist(usPhase, snapKey, clockPhase) {
  if (usPhase === 'regular') return 'us_regular_live';
  if (snapKey === 'premarketSnap') return 'premarket_freeze';
  if (snapKey === 'afterhoursSnap') return 'afterhours_freeze';
  if (snapKey === 'overnightSnap') return 'overnight_freeze';
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

  const isUsExtendedWindow =
    usPhase === 'premarket' || usPhase === 'afterhours' || usPhase === 'overnight';
  const isRt1SnapPhase =
    isUsExtendedWindow ||
    effectivePhase === 'premarket_freeze' ||
    effectivePhase === 'afterhours_freeze' ||
    effectivePhase === 'overnight_freeze' ||
    effectivePhase === 'eod_freeze';

  const rt1Source =
    isRt1SnapPhase && snapKey != null && snapKey !== 'eodSnap' ? 'snap' : 'live';

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
    row2Source: isUsExtendedWindow ? 'live' : 'none',
    isUsExtendedWindow,
    isRt1SnapPhase,
    showRow2Extended: isUsExtendedWindow,
    extendedSession: isUsExtendedWindow ? usPhase : null,
    shouldClearPremarketSnap: mins < BJ_PREMARKET_START_MIN,
    shouldClearOvernightSnap: mins < BJ_AFTERHOURS_END_MIN,
    shouldDiscardPremarketSnap: usPhase === 'regular',
    shouldDiscardOvernightSnap: usPhase === 'premarket',
    canSeedPremarketSnap: usPhase === 'premarket' && snapKey === 'premarketSnap',
    canSeedAfterhoursSnap: usPhase === 'afterhours' && snapKey === 'afterhoursSnap',
    canSeedOvernightSnap: usPhase === 'overnight' && snapKey === 'overnightSnap',
    canBackfillPremarketSnap:
      usPhase === 'premarket' && accrualDay === beijingDate && mins >= BJ_PREMARKET_START_MIN,
    canBackfillAfterhoursSnap: usPhase === 'afterhours' && accrualDay === beijingDate,
    canBackfillOvernightSnap:
      usPhase === 'overnight' && accrualDay === beijingDate && mins >= BJ_AFTERHOURS_END_MIN,
  };
}

/** @param {ReturnType<typeof resolveDisplaySession>} session @param {'premarketSnap'|'afterhoursSnap'|'overnightSnap'} snapKey */
export function canBackfillSnap(session, snapKey) {
  if (snapKey === 'premarketSnap') return session.canBackfillPremarketSnap;
  if (snapKey === 'afterhoursSnap') return session.canBackfillAfterhoursSnap;
  if (snapKey === 'overnightSnap') return session.canBackfillOvernightSnap;
  return false;
}

/** @param {Date} [now] @param {DisplayPhase|null} [persistedPhase] */
export function isRt1SnapPhaseAt(now = new Date(), persistedPhase = null) {
  return resolveDisplaySession(now, { persistedPhase }).isRt1SnapPhase;
}

/** @param {Date} [now] */
export function isUsExtendedEstimateWindow(now = new Date()) {
  return resolveDisplaySession(now).isUsExtendedWindow;
}

/** @param {Date} [now] */
export function isUsPremarketEstimateWindow(now = new Date()) {
  return resolveDisplaySession(now).usPhase === 'premarket';
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
    row2Source: session.row2Source,
    extendedSession: session.extendedSession,
  };
}
