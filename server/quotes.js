import { extractQuotedVar } from './quote-utils.js';
import { isKrMarketOpen } from './holding-market.js';
import { parseGbSinaQuote } from './gb-quote-parse.js';

const SINA_ORIGIN = 'https://hq.sinajs.cn';
const SINA_HEADERS = { Referer: 'https://finance.sina.com.cn/' };

/** 韩股等新浪无代码时，用语义相关 ETF 涨跌兜底 */
const SEMI_FALLBACK_KEY = 'gb_soxx';
const TENCENT_ORIGIN = 'https://qt.gtimg.cn';

/** @param {{ changePct?: number|null, price?: number|null }} [q] */
export function isValidQuote(q) {
  if (!q || !Number.isFinite(q.changePct)) return false;
  if (q.price != null && Number.isFinite(q.price) && q.price <= 0) return false;
  // 新浪 A 股开盘前常见 price=0 → changePct=-100
  if (q.changePct <= -99.9) return false;
  return true;
}

/** @param {string} stockCode @param {number|null} marketId */
export function toTencentSymbol(stockCode, marketId) {
  const sina = toSinaFetchCode(stockCode, marketId);
  if (!sina || sina.startsWith('gb_') || sina.startsWith('rt_hk')) return null;
  if (sina.startsWith('sz') || sina.startsWith('sh') || sina.startsWith('bj')) return sina;
  return null;
}

/** @param {string} code @param {string} [name] */
export function isLikelyKoreanHolding(code, name) {
  const c = String(code || '').trim();
  const n = String(name || '');
  if (!/^\d{6}$/.test(c)) return false;
  if (/SK|三星|海力士|韩国|LG电子|现代|起亚/.test(n)) return true;
  if (c === '000660' || c === '005930' || c === '005380' || c === '000270') return true;
  return false;
}

/** @param {string} stockCode @param {number|null} marketId @param {string} [name] */
export function toSinaFetchCode(stockCode, marketId, name = '') {
  const raw = String(stockCode).trim();
  const code = raw.replace(/\.$/, '');
  if (isLikelyKoreanHolding(code, name)) return null;
  if (marketId != null) {
    if (marketId === 0) return `sz${code}`;
    if (marketId === 1) return `sh${code}`;
    if (marketId === 116) return `rt_hk${code.padStart(5, '0')}`;
    if (marketId >= 100) return `gb_${code.toLowerCase()}`;
  }
  if (/^[A-Za-z]/.test(code)) return `gb_${code.toLowerCase()}`;
  if (/^\d{6}$/.test(code)) {
    if (code.startsWith('6') || code.startsWith('9')) return `sh${code}`;
    if (code.startsWith('4') || code.startsWith('8')) return `bj${code}`;
    return `sz${code}`;
  }
  if (code.length <= 5 && /^\d+$/.test(code)) return `rt_hk${code.padStart(5, '0')}`;
  return `gb_${code.toLowerCase()}`;
}

/** @param {string} text @param {string[]} keys */
function parseSinaList(text, keys) {
  /** @type {Record<string, { name: string, price: number, changePct: number }>} */
  const out = {};
  for (const key of keys) {
    const raw = extractQuotedVar(text, `hq_str_${key}`);
    if (!raw) continue;
    const parts = raw.split(',');
    if (key.startsWith('rt_hk') && parts.length >= 9) {
      out[key] = { name: parts[1], price: parseFloat(parts[6]), changePct: parseFloat(parts[8]) };
    } else if (key.startsWith('gb_') && parts.length >= 3) {
      const gb = parseGbSinaQuote(key, raw);
      if (gb) out[key] = gb;
    } else if (parts.length >= 4) {
      const pre = parseFloat(parts[2]);
      const cur = parseFloat(parts[3]);
      if (!(pre > 0 && cur > 0)) continue;
      const changePct = ((cur - pre) / pre) * 100;
      if (!Number.isFinite(changePct)) continue;
      out[key] = { name: parts[0], price: cur, changePct };
    }
  }
  return out;
}

/** @param {string[]} fetchCodes */
export async function fetchSinaQuoteKeys(fetchCodes) {
  const unique = [...new Set(fetchCodes.filter(Boolean))];
  if (!unique.length) return {};
  const url = `${SINA_ORIGIN}/list=${unique.join(',')}`;
  const text = await fetchText(url, SINA_HEADERS);
  return parseSinaList(text, unique);
}

/** @param {string} url @param {Record<string,string>} [headers] */
async function fetchText(url, headers = {}) {
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (/sinajs\.cn/i.test(url)) return new TextDecoder('gbk').decode(buf);
  return buf.toString('utf8');
}

/** @param {string} text @param {string[]} symbols */
function parseTencentList(text, symbols) {
  /** @type {Record<string, { name: string, price: number, changePct: number }>} */
  const out = {};
  for (const sym of symbols) {
    const m = text.match(new RegExp(`v_${sym}="([^"]+)"`));
    if (!m) continue;
    const parts = m[1].split('~');
    if (parts.length < 33) continue;
    const price = parseFloat(parts[3]);
    const prev = parseFloat(parts[4]);
    let changePct = parseFloat(parts[32]);
    if (!Number.isFinite(changePct) && prev > 0 && price > 0) {
      changePct = ((price - prev) / prev) * 100;
    }
    if (!(prev > 0 && price > 0) || !Number.isFinite(changePct)) continue;
    out[sym] = { name: parts[1] || sym, price, changePct };
  }
  return out;
}

/** @param {string[]} symbols */
async function fetchTencentQuotes(symbols) {
  const unique = [...new Set(symbols.filter(Boolean))];
  if (!unique.length) return {};
  const url = `${TENCENT_ORIGIN}/q=${unique.join(',')}`;
  const res = await fetch(url);
  if (!res.ok) return {};
  const buf = Buffer.from(await res.arrayBuffer());
  const text = new TextDecoder('gbk').decode(buf);
  return parseTencentList(text, unique);
}

/**
 * @param {Array<{ fetchCode?: string|null, code: string, name?: string, marketId?: number|null }>} holdings
 * @param {Date} [now]
 */
export async function fetchHoldingQuotes(holdings, now = new Date()) {
  const krSessionLive = isKrMarketOpen(now);
  const keys = [
    ...new Set(
      holdings
        .map((h) => h.fetchCode || toSinaFetchCode(h.code, h.marketId ?? null, h.name))
        .filter(Boolean),
    ),
  ];
  if (!keys.includes(SEMI_FALLBACK_KEY)) keys.push(SEMI_FALLBACK_KEY);

  const url = `${SINA_ORIGIN}/list=${keys.join(',')}`;
  const text = await fetchText(url, SINA_HEADERS);
  const quotes = parseSinaList(text, keys);

  /** @type {Record<string, { name: string, price: number, changePct: number, quoteSource?: string }>} */
  const byHoldingKey = {};
  for (const h of holdings) {
    const fetchKey = h.fetchCode || toSinaFetchCode(h.code, h.marketId ?? null, h.name);
    let q = fetchKey ? quotes[fetchKey] : null;
    let quoteSource = fetchKey ? 'sina' : null;
    if (
      (!q || !isValidQuote(q)) &&
      isLikelyKoreanHolding(h.code, h.name) &&
      !krSessionLive
    ) {
      const fb = quotes[SEMI_FALLBACK_KEY];
      if (fb && isValidQuote(fb)) {
        q = { ...fb, name: h.name || fb.name };
        quoteSource = 'soxx-fallback';
      }
    }
    if (q && isValidQuote(q)) byHoldingKey[`${h.code}\0${h.name}`] = { ...q, quoteSource };
  }

  const needTencent = holdings.filter((h) => {
    if (byHoldingKey[`${h.code}\0${h.name}`]) return false;
    return Boolean(toTencentSymbol(h.code, h.marketId ?? null));
  });
  if (needTencent.length) {
    const tencentQuotes = await fetchTencentQuotes(
      needTencent.map((h) => toTencentSymbol(h.code, h.marketId ?? null)),
    );
    for (const h of needTencent) {
      const sym = toTencentSymbol(h.code, h.marketId ?? null);
      const q = sym ? tencentQuotes[sym] : null;
      if (q && isValidQuote(q)) {
        byHoldingKey[`${h.code}\0${h.name}`] = { ...q, quoteSource: 'tencent' };
      }
    }
  }

  return { quotes, byHoldingKey };
}

/** @param {{ code: string, name?: string, marketId?: number|null, fetchCode?: string }} h @param {Record<string, object>} byHoldingKey */
export function quoteForHolding(h, byHoldingKey) {
  return byHoldingKey[`${h.code}\0${h.name}`] ?? null;
}
