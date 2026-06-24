import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { migratePortfolio } from './accounts.js';
import { DATA_DIR, writeJsonAtomic } from './data-dir.js';
import { isScreenshotMode } from './screenshot-bundle.js';
import { beijingIsoString } from './time.js';

export { DATA_DIR } from './data-dir.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
export const PORTFOLIO_PATH = path.join(DATA_DIR, 'portfolio.json');
const SEED_PATH = path.join(ROOT, 'src', 'portfolio.json');

/** @type {{ mtimeMs: number, data: { meta: object, funds: object[], accounts: object[] } | null }} */
let portfolioCache = { mtimeMs: 0, data: null };

/** 单调递增的 portfolio 写入版本号；refreshLive 用它检测提交期间是否被 settle 改写。 */
let portfolioRevision = 0;
export function getPortfolioRevision() {
  return portfolioRevision;
}

/** @returns {Promise<{ meta: object, funds: object[] }>} */
export async function ensurePortfolio() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  try {
    await fs.access(PORTFOLIO_PATH);
  } catch {
    const seed = await fs.readFile(SEED_PATH, 'utf8');
    await fs.writeFile(PORTFOLIO_PATH, seed, 'utf8');
  }
}

/** @returns {Promise<{ meta: object, funds: object[], accounts: object[] }>} */
export async function readPortfolio() {
  await ensurePortfolio();
  const stat = await fs.stat(PORTFOLIO_PATH);
  if (portfolioCache.data && portfolioCache.mtimeMs === stat.mtimeMs) {
    return portfolioCache.data;
  }
  const raw = await fs.readFile(PORTFOLIO_PATH, 'utf8');
  const data = migratePortfolio(JSON.parse(raw));
  if (!data.funds?.length) throw new Error('portfolio.json 缺少 funds');
  portfolioCache = { mtimeMs: stat.mtimeMs, data };
  return data;
}

/** @param {{ meta?: object, funds: object[], accounts?: object[] }} data */
export async function writePortfolio(data) {
  if (isScreenshotMode()) {
    return migratePortfolio(data);
  }
  await ensurePortfolio();
  const payload = migratePortfolio({
    ...data,
    meta: {
      ...data.meta,
      lastWrittenAt: beijingIsoString(),
    },
  });
  await writeJsonAtomic(PORTFOLIO_PATH, payload);
  const stat = await fs.stat(PORTFOLIO_PATH);
  portfolioCache = { mtimeMs: stat.mtimeMs, data: payload };
  portfolioRevision += 1;
  return payload;
}

export { dayProfitPct } from '@fund-tracker/core/portfolio';

/** @param {object} fund */
export function holdingProfitPct(fund) {
  const principal = fund.amount - fund.totalProfit;
  if (principal <= 0) return fund.totalProfitPct ?? null;
  return (fund.totalProfit / principal) * 100;
}
