/**
 * Snap 就绪判定：per-fund 明细齐全且非 provisional 才可用于冻结 row1。
 */
import { getActiveSnapKey, getScopeSnap } from '../day-display-state.js';
import { resolveDisplaySession } from '../display-session.js';
import { getUsSessionPhase } from '../holding-market.js';
import { beijingDateString, beijingMinutesOfDay } from '../time.js';

const BJ_EOD_FREEZE_START_MIN = 16 * 60;

/** @param {string} atIso */
function parseSnapAt(atIso) {
  if (!atIso) return null;
  const normalized = String(atIso).replace('T24:', 'T00:');
  const d = new Date(normalized);
  return Number.isFinite(d.getTime()) ? d : null;
}

/**
 * eod_freeze 读 snap 前：04:00 day_open / 16:00 前写入的 snap 不可用。
 * @param {object|null|undefined} snap
 * @param {Date} now
 * @param {string} accrualDay
 */
export function isStalePreEodSnap(snap, now, accrualDay) {
  if (!snap) return true;
  if (snap.seedPhase === 'day_open') return true;
  const session = resolveDisplaySession(now);
  if (session.clockPhase !== 'eod_freeze') return false;
  const at = parseSnapAt(snap.at);
  if (!at) return snap.seedPhase !== 'eod_freeze';
  if (beijingDateString(at) !== accrualDay) return snap.seedPhase !== 'eod_freeze';
  return beijingMinutesOfDay(at) < BJ_EOD_FREEZE_START_MIN;
}

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

/** @param {string} day @param {'eodSnap'} key @param {string} [scope] @param {Date} [now] */
export function getReadyScopeSnap(day, key, scope = 'portfolio', now = new Date()) {
  const snap = getScopeSnap(day, key, scope);
  if (!isScopeSnapReady(snap, now, day)) return null;
  return snap;
}

/**
 * @param {object|null|undefined} snap
 * @param {Date} [now]
 * @param {string} [accrualDay]
 */
export function isScopeSnapReady(snap, now = new Date(), accrualDay = null) {
  if (!snap || snap.provisional) return false;
  if (isStaleDayOpenSnap(snap)) return false;
  if (isStaleAsiaLiveSnap(snap)) return false;
  if (isStaleUsRegularLiveSnap(snap)) return false;
  const day = accrualDay ?? resolveDisplaySession(now).accrualDay;
  if (isStalePreEodSnap(snap, now, day)) return false;
  if (!snap.funds || typeof snap.funds !== 'object') return false;
  return Object.keys(snap.funds).length > 0;
}

/** @param {string} day @param {Date} [now] @param {string} [scope] */
export function getReadyActiveScopeSnap(day, now = new Date(), scope = 'portfolio') {
  const key = getActiveSnapKey(now);
  if (!key) return null;
  return getReadyScopeSnap(day, key, scope, now);
}

/** per-fund row1 snap 读回：active scope snap → eodSnap */
export function getReadyFundRt1Snap(day, now = new Date(), scope = 'portfolio') {
  return (
    getReadyActiveScopeSnap(day, now, scope) ??
    getReadyScopeSnap(day, 'eodSnap', scope, now)
  );
}
