import fs from 'node:fs/promises';
import path from 'node:path';
import { DATA_DIR } from './data-dir.js';
import { isValidHoldingQuote } from './quotes.js';

const PATH = path.join(DATA_DIR, 'impact-snapshots.json');

/** @type {{ holdings: Record<string, { changePct: number, price: number|null, at: number }>, indices: Record<string, { changePct: number, price: number|null, at: number }>, funds: Record<string, { impactPctRegular: number, at: number }> }} */
let cache = { holdings: {}, indices: {}, funds: {} };

let saveTimer = null;

export async function loadImpactSnapshots() {
  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
    const raw = await fs.readFile(PATH, 'utf8');
    const data = JSON.parse(raw);
    const holdings = data?.holdings && typeof data.holdings === 'object' ? data.holdings : {};
    const cleanedHoldings = {};
    for (const [key, snap] of Object.entries(holdings)) {
      if (snap && isValidHoldingQuote(snap)) cleanedHoldings[key] = snap;
    }
    cache = {
      holdings: cleanedHoldings,
      indices: data?.indices && typeof data.indices === 'object' ? data.indices : {},
      funds: data?.funds && typeof data.funds === 'object' ? data.funds : {},
    };
    if (Object.keys(cleanedHoldings).length !== Object.keys(holdings).length) {
      scheduleSave();
    }
  } catch {
    cache = { holdings: {}, indices: {}, funds: {} };
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
      /* ignore persist errors */
    }
  }, 1500);
}

/** @param {string} key @param {{ changePct: number, price?: number|null, at?: number }} snap */
export function rememberHoldingRegular(key, snap) {
  if (!isValidHoldingQuote(snap)) return;
  cache.holdings[key] = {
    changePct: snap.changePct,
    price: snap.price ?? null,
    at: snap.at ?? Date.now(),
  };
  scheduleSave();
}

/** @param {string} key */
export function getHoldingRegular(key) {
  return cache.holdings[key] ?? null;
}

/** @param {string} label @param {{ changePct: number, price?: number|null, at?: number }} snap */
export function rememberIndexRegular(label, snap) {
  if (!label || !Number.isFinite(snap.changePct)) return;
  cache.indices[label] = {
    changePct: snap.changePct,
    price: snap.price ?? null,
    at: snap.at ?? Date.now(),
  };
  scheduleSave();
}

/** @param {string} label */
export function getIndexRegular(label) {
  return cache.indices[label] ?? null;
}

/** @param {number} fundId @param {number} impactPctRegular */
export function rememberFundRegular(fundId, impactPctRegular) {
  if (fundId == null || !Number.isFinite(impactPctRegular)) return;
  cache.funds[String(fundId)] = { impactPctRegular, at: Date.now() };
  scheduleSave();
}

/** @param {number} fundId */
export function getFundRegular(fundId) {
  return cache.funds[String(fundId)]?.impactPctRegular ?? null;
}

/** @returns {Record<string, { impactPctRegular: number, at: number }>} */
export function getFundSnapshotRecords() {
  return cache.funds;
}

/** 启动时灌入内存快照 */
export function seedHoldingRegularSnapshots(targetMap) {
  for (const [key, snap] of Object.entries(cache.holdings)) {
    if (snap && isValidHoldingQuote(snap) && !targetMap.has(key)) {
      targetMap.set(key, { ...snap, source: 'disk' });
    }
  }
}

/** @param {Map<string, object>} targetMap */
export function seedIndexRegularSnapshots(targetMap) {
  for (const [label, snap] of Object.entries(cache.indices)) {
    if (snap && Number.isFinite(snap.changePct) && !targetMap.has(label)) {
      targetMap.set(label, {
        changePct: snap.changePct,
        price: snap.price ?? null,
        change: null,
      });
    }
  }
}
