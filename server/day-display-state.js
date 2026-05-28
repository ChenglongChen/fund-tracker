import fs from 'node:fs/promises';
import path from 'node:path';
import { getRt1AccrualDay, isRt1SnapPhaseAt, resolveDisplaySession } from './display-session.js';
import { beijingDateString } from './time.js';
import { DATA_DIR } from './store.js';

export { getRt1AccrualDay } from './display-session.js';

const PATH = path.join(DATA_DIR, 'day-display-state.json');
const SCOPES = ['portfolio'];

/** @typedef {'day_open'|'us_regular_live'|'eod_freeze'|'asia_live'} DisplayPhase */

/** @type {{
 *   version: number,
 *   currentBeijingDate: string|null,
 *   rt1AccrualDay: string|null,
 *   currentPhase: DisplayPhase,
 *   days: Record<string, object>
 * }} */
let cache = {
  version: 1,
  currentBeijingDate: null,
  rt1AccrualDay: null,
  currentPhase: 'day_open',
  days: {},
};

let saveTimer = null;

function round2(n) {
  return Math.round(n * 100) / 100;
}

export async function loadDayDisplayState() {
  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
    const raw = await fs.readFile(PATH, 'utf8');
    const data = JSON.parse(raw);
    cache = {
      version: 1,
      currentBeijingDate: data?.currentBeijingDate ?? null,
      rt1AccrualDay: data?.rt1AccrualDay ?? null,
      currentPhase: data?.currentPhase ?? 'day_open',
      days: data?.days && typeof data.days === 'object' ? data.days : {},
    };
  } catch {
    cache = {
      version: 1,
      currentBeijingDate: null,
      rt1AccrualDay: null,
      currentPhase: 'day_open',
      days: {},
    };
  }
}

function scheduleSave() {
  if (saveTimer) return;
  saveTimer = setTimeout(async () => {
    saveTimer = null;
    try {
      await fs.mkdir(DATA_DIR, { recursive: true });
      await fs.writeFile(PATH, JSON.stringify(cache, null, 2), 'utf8');
    } catch {
      /* ignore */
    }
  }, 800);
}

export function getDayDisplayStateCache() {
  return cache;
}

/** @param {string} day @param {string} [scope] */
export function getBaselineForDay(day, scope = 'portfolio') {
  const dayRec = cache.days[day];
  const scopeRec = dayRec?.scopes?.[scope];
  return scopeRec?.baseline ?? dayRec?.baseline?.portfolio ?? null;
}

/** @param {string} day @param {string} scope @param {number} baseline */
export function setBaselineForDay(day, scope, baseline) {
  if (!cache.days[day]) {
    cache.days[day] = { scopes: {} };
  }
  if (!cache.days[day].scopes[scope]) {
    cache.days[day].scopes[scope] = {};
  }
  cache.days[day].scopes[scope].baseline = round2(baseline);
  if (scope === 'portfolio') {
    cache.days[day].baseline = { portfolio: round2(baseline), capturedAt: new Date().toISOString() };
  }
  scheduleSave();
}

/** @param {DisplayPhase} phase */
export function setCurrentPhase(phase, now = new Date()) {
  cache.currentPhase = phase;
  cache.currentBeijingDate = beijingDateString(now);
  cache.rt1AccrualDay = getRt1AccrualDay(now);
  scheduleSave();
}

export function getCurrentPhase() {
  return cache.currentPhase;
}

/**
 * @param {string} day
 * @param {'eodSnap'} key
 * @param {string} [scope]
 */
export function getScopeSnap(day, key, scope = 'portfolio') {
  return cache.days[day]?.scopes?.[scope]?.[key] ?? null;
}

/**
 * @param {string} day
 * @param {'eodSnap'} key
 * @param {string} scope
 * @param {object} snap
 */
export function setScopeSnap(day, key, scope, snap) {
  if (!cache.days[day]) cache.days[day] = { scopes: {} };
  if (!cache.days[day].scopes[scope]) cache.days[day].scopes[scope] = {};
  cache.days[day].scopes[scope][key] = snap;
  scheduleSave();
}

/** @param {string} day @param {'afterhoursSnap'|'premarketSnap'|'eodSnap'} key @param {string} [scope] */
export function clearScopeSnap(day, key, scope = 'portfolio') {
  const scopeRec = cache.days[day]?.scopes?.[scope];
  if (!scopeRec?.[key]) return;
  delete scopeRec[key];
  scheduleSave();
}

/** @param {Date} [now] */
export function getActiveSnapKey(now = new Date()) {
  return resolveDisplaySession(now, { persistedPhase: cache.currentPhase }).snapKey;
}

/** @param {string} day @param {Date} [now] */
export function getActiveScopeSnap(day, now = new Date(), scope = 'portfolio') {
  const key = getActiveSnapKey(now);
  if (!key) return null;
  return getScopeSnap(day, key, scope);
}

export function isRt1SnapPhase(now = new Date()) {
  return isRt1SnapPhaseAt(now, cache.currentPhase);
}

/** @param {{ funds: object[] }} portfolio @param {Date} [now] */
export function ensureDayBaseline(portfolio, now = new Date()) {
  const beijingDate = beijingDateString(now);
  const accrualDay = getRt1AccrualDay(now);
  const baseline = portfolio.funds.reduce((s, f) => s + (f.amount ?? 0), 0);

  if (cache.currentBeijingDate !== beijingDate) {
    setBaselineForDay(beijingDate, 'portfolio', baseline);
    cache.currentBeijingDate = beijingDate;
    cache.rt1AccrualDay = accrualDay;
    scheduleSave();
  }

  if (getBaselineForDay(beijingDate, 'portfolio') == null) {
    setBaselineForDay(beijingDate, 'portfolio', baseline);
  }

  if (getBaselineForDay(accrualDay, 'portfolio') == null && accrualDay !== beijingDate) {
    setBaselineForDay(accrualDay, 'portfolio', baseline);
  }
}

export { SCOPES, round2 };
