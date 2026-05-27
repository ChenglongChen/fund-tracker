/**
 * Snap 就绪判定：per-fund 明细齐全且非 provisional 才可用于冻结 row1。
 */
import { getActiveSnapKey, getScopeSnap } from '../day-display-state.js';

/**
 * @param {object|null|undefined} snap
 */
export function isScopeSnapReady(snap) {
  if (!snap || snap.provisional) return false;
  if (!snap.funds || typeof snap.funds !== 'object') return false;
  return Object.keys(snap.funds).length > 0;
}

/** @param {string} day @param {'afterhoursSnap'|'premarketSnap'|'overnightSnap'|'eodSnap'} key @param {string} [scope] */
export function getReadyScopeSnap(day, key, scope = 'portfolio') {
  const snap = getScopeSnap(day, key, scope);
  return isScopeSnapReady(snap) ? snap : null;
}

/** @param {string} day @param {Date} [now] @param {string} [scope] */
export function getReadyActiveScopeSnap(day, now = new Date(), scope = 'portfolio') {
  const key = getActiveSnapKey(now);
  if (!key || key === 'eodSnap') return null;
  return getReadyScopeSnap(day, key, scope);
}
