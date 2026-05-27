import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DATA_DIR } from './store.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const APP_STATE_PATH = path.join(DATA_DIR, 'app-state.json');

const MAX_INTRADAY_TICKS = 480;

/** @returns {Promise<object>} */
export async function readAppState() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  try {
    const raw = await fs.readFile(APP_STATE_PATH, 'utf8');
    return normalizeAppState(JSON.parse(raw));
  } catch {
    return defaultAppState();
  }
}

function defaultAppState() {
  return {
    assetViewMode: 'settled',
    dailyRecords: {},
    intradayTicks: [],
  };
}

/** @param {unknown} data */
function normalizeAppState(data) {
  const base = defaultAppState();
  if (!data || typeof data !== 'object') return base;
  return {
    assetViewMode: data.assetViewMode === 'realtime' ? 'realtime' : 'settled',
    dailyRecords: data.dailyRecords && typeof data.dailyRecords === 'object' ? data.dailyRecords : {},
    intradayTicks: Array.isArray(data.intradayTicks) ? data.intradayTicks.slice(-MAX_INTRADAY_TICKS) : [],
  };
}

/** @param {object} patch */
export async function writeAppState(patch) {
  const current = await readAppState();
  const next = normalizeAppState({ ...current, ...patch });
  await fs.writeFile(APP_STATE_PATH, JSON.stringify(next, null, 2), 'utf8');
  return next;
}

/** @param {'settled'|'realtime'} mode */
export async function setAssetViewMode(mode) {
  return writeAppState({ assetViewMode: mode === 'realtime' ? 'realtime' : 'settled' });
}

/**
 * @param {object} snapshot
 * @param {string} snapshot.beijingDate
 * @param {string} snapshot.updatedAt
 */
export async function recordLiveSnapshot(snapshot) {
  const state = await readAppState();
  const day = snapshot.beijingDate;
  if (!day) return state;

  const dailyRecords = { ...state.dailyRecords };
  dailyRecords[day] = {
    ...dailyRecords[day],
    ...snapshot,
    lastPersistedAt: new Date().toISOString(),
  };

  const ticks = [...state.intradayTicks];
  const last = ticks[ticks.length - 1];
  const bucketKey = `${day} ${snapshot.updatedAt}`;
  if (!last || last.bucketKey !== bucketKey) {
    ticks.push({
      bucketKey,
      beijingDate: day,
      updatedAt: snapshot.updatedAt,
      settledAssets: snapshot.settledAssets,
      realtimeAssets: snapshot.realtimeAssets,
      settledProfit: snapshot.settledProfit,
      realtimeProfit: snapshot.realtimeProfit,
      at: new Date().toISOString(),
    });
  } else {
    ticks[ticks.length - 1] = {
      ...last,
      settledAssets: snapshot.settledAssets,
      realtimeAssets: snapshot.realtimeAssets,
      settledProfit: snapshot.settledProfit,
      realtimeProfit: snapshot.realtimeProfit,
      at: new Date().toISOString(),
    };
  }

  return writeAppState({
    dailyRecords,
    intradayTicks: ticks.slice(-MAX_INTRADAY_TICKS),
  });
}

/** @returns {Promise<object[]>} */
export async function listDailyRecords(limit = 30) {
  const state = await readAppState();
  return Object.values(state.dailyRecords)
    .sort((a, b) => String(b.beijingDate).localeCompare(String(a.beijingDate)))
    .slice(0, limit);
}
