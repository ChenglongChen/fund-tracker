/**
 * Snap 就绪判定：per-fund 明细齐全且非 provisional 才可用于冻结 row1。
 */
import { getActiveSnapKey, getScopeSnap } from '../day-display-state.js';
import { getUsSessionPhase } from '../holding-market.js';
import { beijingMinutesOfDay } from '../time.js';

/** @param {object|null|undefined} snap */
function isStaleDayOpenSnap(snap) {
  if (!snap?.at) return false;
  if (snap.seedPhase === 'day_open') return true;
  if (snap.seedPhase) return false;
  const at = new Date(snap.at);
  if (!Number.isFinite(at.getTime())) return false;
  const mins = beijingMinutesOfDay(at);
  return mins >= 4 * 60 && mins < 8 * 60 && getUsSessionPhase(at) === 'closed';
}

/** @param {object|null|undefined} snap */
function isStaleAsiaLiveSnap(snap) {
  return snap?.seedPhase === 'asia_live';
}

/** @param {object|null|undefined} snap */
function isStaleUsRegularLiveSnap(snap) {
  return snap?.seedPhase === 'us_regular_live';
}

/**
 * @param {object|null|undefined} snap
 */
export function isScopeSnapReady(snap) {
  if (!snap || snap.provisional) return false;
  if (isStaleDayOpenSnap(snap)) return false;
  if (isStaleAsiaLiveSnap(snap)) return false;
  if (isStaleUsRegularLiveSnap(snap)) return false;
  if (!snap.funds || typeof snap.funds !== 'object') return false;
  return Object.keys(snap.funds).length > 0;
}

/** @param {string} day @param {'eodSnap'} key @param {string} [scope] */
export function getReadyScopeSnap(day, key, scope = 'portfolio') {
  const snap = getScopeSnap(day, key, scope);
  return isScopeSnapReady(snap) ? snap : null;
}

/** @param {string} day @param {Date} [now] @param {string} [scope] */
export function getReadyActiveScopeSnap(day, now = new Date(), scope = 'portfolio') {
  const key = getActiveSnapKey(now);
  if (!key) return null;
  return getReadyScopeSnap(day, key, scope);
}

/** per-fund row1 snap 读回：active scope snap → eodSnap */
export function getReadyFundRt1Snap(day, now = new Date(), scope = 'portfolio') {
  return (
    getReadyActiveScopeSnap(day, now, scope) ??
    getReadyScopeSnap(day, 'eodSnap', scope)
  );
}
