/**
 * README 截图模式：读取 scripts/fixtures/screenshot/ 静态包，避免各页行情漂移。
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getFundRegular, getIndexRegular } from './impact-snapshots.js';
import { MARKET_STRIP_INDICES } from './market-indices.js';
import { applySessionMarketStrip } from './session-quotes.js';
import { serverNow } from './time.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BUNDLE_DIR = path.join(__dirname, '..', 'scripts', 'fixtures', 'screenshot');

/** @type {Record<string, object>|null} */
let detailPacks = null;

export function isScreenshotMode() {
  return process.env.FUND_TRACKER_SCREENSHOT === '1';
}

export function screenshotBundleDir() {
  return BUNDLE_DIR;
}

/** @param {Array<{ id?: number, code: string, name?: string }>} funds */
export function buildScreenshotPortfolioImpacts(funds) {
  return funds.map((f) => {
    const reg = f.id != null ? getFundRegular(f.id) : null;
    const pct = reg?.impactPctRegular ?? null;
    return {
      impactPct: pct,
      impactPctRegular: pct,
      impactSession: 'closed',
      hasRegularHolding: false,
      count: 0,
      holdings: [],
      weightCoverage: 0,
      quoteCoverage: 0,
      usdWeight: 0,
      quotedCount: 0,
      reportDate: null,
      recentReportDate: null,
      annualReportDate: null,
    };
  });
}

/** @param {Date} [now] */
export function buildScreenshotMarketStrip(now = serverNow()) {
  const indices = MARKET_STRIP_INDICES.map(({ label, market }) => {
    const snap = getIndexRegular(label);
    const changePct = snap?.changePct ?? null;
    return {
      label,
      market,
      changePct,
      price: snap?.price ?? null,
      quoteSession: 'closed',
      quoteMode: 'close',
    };
  });
  const fx = {
    label: '汇率',
    changePct: 0,
    usd: 0,
    hkd: 0,
    market: 'fx',
    quoteSession: 'closed',
    quoteMode: 'close',
  };
  return applySessionMarketStrip([...indices, fx], now);
}

/** @returns {Promise<Record<string, object>>} */
async function loadDetailPacks() {
  if (detailPacks) return detailPacks;
  try {
    const raw = await fs.readFile(path.join(BUNDLE_DIR, 'fund-detail-packs.json'), 'utf8');
    detailPacks = JSON.parse(raw);
  } catch {
    detailPacks = {};
  }
  return detailPacks;
}

/**
 * @param {string} code
 * @returns {Promise<object|null>}
 */
export async function getScreenshotFundDetailPack(code) {
  if (!isScreenshotMode()) return null;
  const packs = await loadDetailPacks();
  const hit = packs[String(code).trim()];
  if (!hit) return null;
  const holdings = hit.holdings ?? [];
  return {
    ...hit,
    holdings,
    _holdingsPack: {
      reportDate: hit.reportDate ?? null,
      recentReportDate: hit.recentReportDate ?? null,
      annualReportDate: hit.annualReportDate ?? null,
      reportMeta: hit.reportMeta ?? null,
      reportFundCount: hit.reportFundCount ?? 0,
      holdings,
    },
  };
}
