import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { migratePortfolio } from './accounts.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
export const DATA_DIR = path.join(ROOT, 'data');
export const PORTFOLIO_PATH = path.join(DATA_DIR, 'portfolio.json');
const SEED_PATH = path.join(ROOT, 'src', 'portfolio.json');

/** @type {{ mtimeMs: number, data: { meta: object, funds: object[], accounts: object[] } | null }} */
let portfolioCache = { mtimeMs: 0, data: null };

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
  await ensurePortfolio();
  const payload = migratePortfolio({
    ...data,
    meta: {
      ...data.meta,
      lastWrittenAt: new Date().toISOString(),
    },
  });
  await fs.writeFile(PORTFOLIO_PATH, JSON.stringify(payload, null, 2), 'utf8');
  const stat = await fs.stat(PORTFOLIO_PATH);
  portfolioCache = { mtimeMs: stat.mtimeMs, data: payload };
  return payload;
}

/** @param {number} amount @param {number} profit */
export function dayProfitPct(amount, profit) {
  if (profit == null || !Number.isFinite(profit) || amount <= profit) return null;
  const base = amount - profit;
  if (base <= 0) return null;
  return (profit / base) * 100;
}

/** @param {object} fund */
export function holdingProfitPct(fund) {
  const principal = fund.amount - fund.totalProfit;
  if (principal <= 0) return fund.totalProfitPct ?? null;
  return (fund.totalProfit / principal) * 100;
}
