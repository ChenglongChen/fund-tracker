import { extractQuotedVar } from './quote-utils.js';
import { isKrMarketOpen } from './holding-market.js';
import { parseGbSinaQuote } from './gb-quote-parse.js';
import { runWithConcurrency } from './concurrency.js';

const SINA_ORIGIN = 'https://hq.sinajs.cn';
const SINA_HEADERS = { Referer: 'https://finance.sina.com.cn/' };

/** 韩股等新浪无代码时，用语义相关 ETF 涨跌兜底 */
const SEMI_FALLBACK_KEY = 'gb_soxx';
const TENCENT_ORIGIN = 'https://qt.gtimg.cn';

/** 单日涨跌幅合理上界（东财 f170 错位、prev 单位错误等会产出万级 %） */
export const MAX_ABS_CHANGE_PCT = 30;

/** @param {{ changePct?: number|null, price?: number|null }} [q] */
export function isValidQuote(q) {
  if (!q || !Number.isFinite(q.changePct)) return false;
  if (q.price != null && Number.isFinite(q.price) && q.price <= 0) return false;
  // 新浪 A 股开盘前常见 price=0 → changePct=-100
  if (q.changePct <= -99.9) return false;
  if (Math.abs(q.changePct) > MAX_ABS_CHANGE_PCT) return false;
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

/** 北交所 / 新三板 */
function isBseCode(code) {
  return /^\d{6}$/.test(code) && (code.startsWith('92') || code.startsWith('4') || code.startsWith('8'));
}

/** @param {string} code @param {number|null|undefined} marketId */
function cnSinaPrefix(code, marketId) {
  if (isBseCode(code)) return `bj${code}`;
  if (marketId === 1 || code.startsWith('6') || code.startsWith('9')) return `sh${code}`;
  if (marketId === 0) return `sz${code}`;
  return `sz${code}`;
}

/** @param {string} stockCode @param {number|null} marketId @param {string} [name] */
export function toSinaFetchCode(stockCode, marketId, name = '') {
  const raw = String(stockCode).trim();
  const code = raw.replace(/\.$/, '');
  if (/^\d{3,4}[A-Z]?JP$/i.test(code)) return null;
  if (/^[A-Z]{2,}FP$/i.test(code) || /^[A-Z]{2,}GR$/i.test(code)) return null;
  if (code.length > 10 && !/^\d+$/.test(code)) return null;
  if (isLikelyKoreanHolding(code, name)) return null;
  if (marketId != null) {
    if (marketId === 0 || marketId === 1) return cnSinaPrefix(code, marketId);
    if (marketId === 116) return `rt_hk${code.padStart(5, '0')}`;
    if (marketId >= 100) return `gb_${code.toLowerCase()}`;
  }
  if (/^[A-Za-z]/.test(code)) return `gb_${code.toLowerCase()}`;
  if (/^\d{6}$/.test(code)) return cnSinaPrefix(code, marketId);
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
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(15_000) });
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

/** 东财/基金年报代码 → 腾讯美股 OTC/ADR ticker */
const TENCENT_US_BY_CODE = {
  AIRFP: 'EADSY',
  RMSFP: 'HESAY',
  RHMGR: 'RNMBF',
  '8035JP': 'TOELY',
  '6594JP': 'NJDCY',
  '4062JP': 'IBIDF',
};

/** @type {[RegExp, string][]} */
const TENCENT_US_BY_NAME = [
  [/东京电子|Tokyo Electron/i, 'TOELY'],
  [/日本电产|Nidec/i, 'NJDCY'],
  [/揖斐电|Ibiden/i, 'IBIDF'],
  [/空客|Airbus/i, 'EADSY'],
  [/爱马仕|Herm[eè]s/i, 'HESAY'],
  [/莱茵金属|Rheinmetall/i, 'RNMBF'],
];

/** @type {Map<string, string|null>} */
const tencentUsSymbolCache = new Map();

/** @param {string} code @param {string} [name] */
export function resolveTencentUsSymbolFromMap(code, name = '') {
  const raw = String(code || '').trim().toUpperCase();
  if (TENCENT_US_BY_CODE[raw]) return TENCENT_US_BY_CODE[raw];
  const n = String(name || '');
  for (const [re, sym] of TENCENT_US_BY_NAME) {
    if (re.test(n)) return sym;
  }
  return null;
}

/** @param {string} raw */
function parseTencentUsLine(raw) {
  const parts = raw.split('~');
  if (parts[0] !== '200' || parts.length < 10) return null;
  const price = parseFloat(parts[3]);
  const dateIdx = parts.findIndex((x) => /^\d{4}-\d{2}-\d{2}/.test(x));
  if (dateIdx < 0 || dateIdx + 2 >= parts.length) return null;
  const changePct = parseFloat(parts[dateIdx + 2]);
  if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(changePct)) return null;
  return {
    name: parts[1] || undefined,
    price,
    changePct,
    quoteSource: 'tencent-us-adr',
  };
}

/** @param {string} text @param {string[]} symbols uppercase without us prefix */
function parseTencentUsList(text, symbols) {
  /** @type {Record<string, { name?: string, price: number, changePct: number, quoteSource: string }>} */
  const out = {};
  for (const sym of symbols) {
    const m = text.match(new RegExp(`v_us${sym}="([^"]+)"`, 'i'));
    if (!m) continue;
    const q = parseTencentUsLine(m[1]);
    if (q && isValidQuote(q)) out[sym] = q;
  }
  return out;
}

/** @param {string} code @param {string} [name] */
export async function resolveTencentUsSymbol(code, name = '') {
  const mapped = resolveTencentUsSymbolFromMap(code, name);
  if (mapped) return mapped;
  const cacheKey = `${String(code || '').trim().toUpperCase()}\0${String(name || '').trim()}`;
  if (tencentUsSymbolCache.has(cacheKey)) return tencentUsSymbolCache.get(cacheKey);
  const query = String(name || code || '').trim();
  if (!query) return null;
  try {
    const url = `https://smartbox.gtimg.cn/s3/?v=2&q=${encodeURIComponent(query)}&t=all&c=1`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) {
      tencentUsSymbolCache.set(cacheKey, null);
      return null;
    }
    const text = await res.text();
    const m = text.match(/v_hint="([^"]*)"/);
    let sym = null;
    if (m) {
      const parts = m[1].split('^');
      for (let i = 0; i < parts.length; i += 4) {
        if (parts[i] === 'us' && parts[i + 1]) {
          sym = parts[i + 1].replace(/\.ps$/i, '').toUpperCase();
          break;
        }
      }
    }
    tencentUsSymbolCache.set(cacheKey, sym);
    return sym;
  } catch {
    tencentUsSymbolCache.set(cacheKey, null);
    return null;
  }
}

/** @param {string[]} symbols uppercase without us prefix */
export async function fetchTencentUsQuotes(symbols) {
  const unique = [...new Set(symbols.filter(Boolean).map((s) => String(s).toUpperCase()))];
  if (!unique.length) return {};
  const url = `${TENCENT_ORIGIN}/q=${unique.map((s) => `us${s}`).join(',')}`;
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return {};
    const buf = Buffer.from(await res.arrayBuffer());
    const text = new TextDecoder('gbk').decode(buf);
    return parseTencentUsList(text, unique);
  } catch {
    return {};
  }
}

/** 新浪 list= 过长会截断，分批请求 */
const SINA_BATCH_SIZE = 60;
const SINA_BATCH_CONCURRENCY = 3;

/**
 * @param {Array<{ fetchCode?: string|null, code: string, name?: string, marketId?: number|null }>} holdings
 * @param {Date} [now]
 * @param {{ supplementAsia?: boolean, awaitStooq?: boolean }} [opts]
 */
export async function fetchHoldingQuotes(holdings, now = new Date(), opts = {}) {
  const { supplementAsia = true, awaitStooq = false } = opts;
  const krSessionLive = isKrMarketOpen(now);
  const keys = [
    ...new Set(
      holdings
        .map((h) => h.fetchCode || toSinaFetchCode(h.code, h.marketId ?? null, h.name))
        .filter(Boolean),
    ),
  ];
  if (!keys.includes(SEMI_FALLBACK_KEY)) keys.push(SEMI_FALLBACK_KEY);

  /** @type {Record<string, { name: string, price: number, changePct: number, quoteSource?: string }>} */
  const quotes = {};
  /** @type {string[][]} */
  const batches = [];
  for (let i = 0; i < keys.length; i += SINA_BATCH_SIZE) {
    batches.push(keys.slice(i, i + SINA_BATCH_SIZE));
  }
  const parsedBatches = await runWithConcurrency(batches, SINA_BATCH_CONCURRENCY, async (batch) => {
    const url = `${SINA_ORIGIN}/list=${batch.join(',')}`;
    const text = await fetchText(url, SINA_HEADERS);
    return parseSinaList(text, batch);
  });
  for (const parsed of parsedBatches) Object.assign(quotes, parsed);

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

  if (supplementAsia) {
    const { supplementAsiaQuotes } = await import('./asia-quotes.js');
    await supplementAsiaQuotes(holdings, byHoldingKey, now, { awaitStooq });
  }

  return { quotes, byHoldingKey };
}

/** @param {{ code: string, name?: string, marketId?: number|null, fetchCode?: string }} h @param {Record<string, object>} byHoldingKey */
export function quoteForHolding(h, byHoldingKey) {
  return byHoldingKey[`${h.code}\0${h.name}`] ?? null;
}
