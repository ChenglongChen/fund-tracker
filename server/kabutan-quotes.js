/**
 * 日股行情：株探 kabutan.jp（东京正股价与涨跌幅，弥补东财 124.x / Stooq 不可用）。
 */
import { isValidHoldingQuote } from './quotes.js';
import { runWithConcurrency } from './concurrency.js';

const KABUTAN_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept-Language': 'ja,en;q=0.9',
};

const FETCH_TIMEOUT_MS = 10_000;
const CACHE_TTL_MS = 5 * 60 * 1000;
const CONCURRENCY = 2;

/** @type {Map<string, { quote: object, at: number }>} */
const quoteCache = new Map();

/** @param {string} text */
function stripTags(text) {
  return String(text || '')
    .replace(/<[^>]+>/g, '')
    .trim();
}

/**
 * @param {string} html
 * @param {string} [ticker]
 * @returns {{ changePct: number, price: number|null, prevClose?: number, quoteSource: 'kabutan' }|null}
 */
export function parseKabutanKabukaHtml(html, ticker = '') {
  if (!html || !html.includes('stock_kabuka0')) return null;

  const table = html.match(/<table class="stock_kabuka0"[\s\S]*?<tbody>([\s\S]*?)<\/tbody>/i);
  if (!table) return null;

  const tds = [...table[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((m) => stripTags(m[1]));
  if (tds.length < 6) return null;

  let price = Number(String(tds[3] || '').replace(/,/g, ''));
  if (!Number.isFinite(price) || price <= 0) {
    const kabuka = html.match(/class="kabuka"[^>]*>([0-9,]+)/i);
    price = kabuka ? Number(kabuka[1].replace(/,/g, '')) : NaN;
  }

  const changePct = Number(String(tds[5] || '').replace(/[+,%\s]/g, ''));
  if (!Number.isFinite(changePct)) return null;

  const row = {
    changePct,
    price: Number.isFinite(price) && price > 0 ? price : null,
    quoteSource: 'kabutan',
  };
  if (!isValidHoldingQuote(row)) return null;

  if (ticker && row.price != null && Number.isFinite(changePct)) {
    const prevClose = row.price / (1 + changePct / 100);
    if (Number.isFinite(prevClose) && prevClose > 0) row.prevClose = prevClose;
  }

  return row;
}

/** @param {string} ticker */
export async function fetchKabutanJpQuote(ticker) {
  const code = String(ticker || '').trim().toUpperCase();
  if (!code) return null;

  const cached = quoteCache.get(code);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return isValidHoldingQuote(cached.quote) ? cached.quote : null;
  }

  try {
    const url = `https://kabutan.jp/stock/kabuka?code=${encodeURIComponent(code)}`;
    const res = await fetch(url, {
      headers: KABUTAN_HEADERS,
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const html = await res.text();
    const quote = parseKabutanKabukaHtml(html, code);
    if (quote) quoteCache.set(code, { quote, at: Date.now() });
    return quote;
  } catch {
    return null;
  }
}

/** Kabutan 东京正股优先于美股 OTC ADR 代理。 */
export function shouldFetchKabutanJp(q) {
  if (!q || !isValidHoldingQuote(q)) return true;
  if (q.quoteSource === 'tencent-us-adr') return true;
  if (q.quoteSource === 'soxx-fallback') return true;
  if (q.quoteSource === 'kabutan') return false;
  return !isValidHoldingQuote(q);
}

/**
 * @param {Array<{ holdingKey: string, ticker: string, name?: string }>} tasks
 * @param {Record<string, object>} byHoldingKey
 */
export async function applyKabutanJpQuotes(tasks, byHoldingKey) {
  if (!tasks.length) return;

  await runWithConcurrency(tasks, CONCURRENCY, async (t) => {
    const quote = await fetchKabutanJpQuote(t.ticker);
    if (!quote) return;
    const { prevClose, ...row } = quote;
    byHoldingKey[t.holdingKey] = { ...row, name: t.name || row.name };
    if (prevClose != null) byHoldingKey[t.holdingKey]._kabutanPrevClose = prevClose;
  });
}
