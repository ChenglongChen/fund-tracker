/**
 * 日韩欧股实时行情：东财 push2 → Naver KRX → 港开时 CSOP 2x → Stooq（日股/欧股）。
 */
import { isValidQuote, quoteForHolding, fetchSinaQuoteKeys, fetchTencentUsQuotes, resolveTencentUsSymbol, resolveTencentUsSymbolFromMap } from './quotes.js';
import { runWithConcurrency } from './concurrency.js';
import {
  classifyHoldingMarket,
  isEuMarketOpen,
  isHkMarketOpen,
  isHoldingMarketOpen,
  isJpMarketOpen,
} from './holding-market.js';

const EM_HEADERS = {
  Referer: 'https://finance.eastmoney.com/',
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
};

const FETCH_TIMEOUT_MS = 8_000;
const FETCH_RETRIES = 2;
const STOOQ_TIMEOUT_MS = 2_500;
const STOOQ_RETRIES = 0;
const STOOQ_CACHE_TTL_MS = 10 * 60 * 1000;
const STOOQ_FAIL_COOLDOWN_MS = 3 * 60 * 1000;
const STOOQ_CONCURRENCY = 3;
const MAX_STOOQ_FETCHES_PER_CALL = 6;

/** @type {Map<string, { quote: object, at: number }>} */
const stooqQuoteCache = new Map();
/** @type {Map<string, number>} symbol → retry after timestamp */
const stooqFailUntil = new Map();
/** @type {Map<string, Promise<object|null>>} */
const stooqInflight = new Map();
/** @type {(() => void)|null} */
let onStooqQuotesUpdated = null;

/** @param {(() => void)|null} fn */
export function setStooqQuotesUpdatedHandler(fn) {
  onStooqQuotesUpdated = fn;
}

/** @param {() => Promise<Response>} fn @param {number} [timeoutMs] @param {number} [retries] */
async function fetchWithRetry(fn, timeoutMs = FETCH_TIMEOUT_MS, retries = FETCH_RETRIES) {
  let lastErr;
  const attempts = Math.max(1, retries + 1);
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      if (i < attempts - 1) await new Promise((r) => setTimeout(r, 250 * (i + 1)));
    }
  }
  throw lastErr;
}

/** @param {string} url */
async function fetchStooqText(url) {
  const res = await fetchWithRetry(
    () => fetch(url, { signal: AbortSignal.timeout(STOOQ_TIMEOUT_MS) }),
    STOOQ_TIMEOUT_MS,
    STOOQ_RETRIES,
  );
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

const NAVER_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  Referer: 'https://finance.naver.com/',
};

/** 东财 secid：韩股 100.xxxxxx */
const KR_EASTMONEY = {
  '005930': '100.005930',
  '000660': '100.000660',
  '005380': '100.005380',
  '000270': '100.000270',
};

/** 韩股 → 港交所 CSOP 2x（涨跌幅 ÷ leverage 近似正股；仅港开时可用） */
const KR_CSOP_PROXY = {
  '005930': { hkCode: '7747', leverage: 2 },
  '000660': { hkCode: '7709', leverage: 2 },
};

const JP_EASTMONEY_PREFIXES = ['124'];

/** ISIN / 东财年报代码 → 日股 ticker */
const JP_TICKER_ALIASES = {
  JP3236330001: '285A',
  JP3684400009: '8035',
};

/** @type {Map<string, number>} ticker → 昨收 */
const prevCloseByTicker = new Map();

function holdingKey(h) {
  return `${h.code}\0${h.name}`;
}

/** @param {string} code @param {string} [name] */
export function normalizeJpTicker(code, name = '') {
  const raw = String(code || '').trim().toUpperCase();
  if (JP_TICKER_ALIASES[raw]) return JP_TICKER_ALIASES[raw];
  const m1 = raw.match(/^(\d{4})JP$/);
  if (m1) return m1[1];
  const m2 = raw.match(/^(\d{3}[A-Z])JP$/);
  if (m2) return m2[1];
  if (/^\d{4}$/.test(raw)) return raw;
  if (/^\d{3}[A-Z]$/.test(raw)) return raw;

  const n = String(name || '');
  if (/日本电产|Nidec/i.test(n)) return '6594';
  if (/东京电子|Tokyo Electron/i.test(n)) return '8035';
  if (/铠侠|Kioxia/i.test(n)) return '285A';
  if (/藤仓|Fujikura/i.test(n)) return '5803';
  if (/佑能|Yuki/i.test(n)) return '6278';
  if (/古河|Furukawa/i.test(n)) return '5801';
  if (/三井金属|Mitsui Kinzoku/i.test(n)) return '5706';
  if (/奥加诺|Organo/i.test(n)) return '6368';
  if (/揖斐电|Ibiden/i.test(n)) return '4062';
  return null;
}

/** @param {string} code @param {string} [name] */
export function normalizeEuStooqSymbol(code, name = '') {
  const raw = String(code || '').trim().toUpperCase();
  const fp = raw.match(/^([A-Z]+)FP$/);
  if (fp) return `${fp[1].toLowerCase()}.fr`;
  const gr = raw.match(/^([A-Z]+)GR$/);
  if (gr) return `${gr[1].toLowerCase()}.de`;
  const n = String(name || '');
  if (/空客|Airbus/i.test(n)) return 'air.fr';
  if (/爱马仕|Herm[eè]s/i.test(n)) return 'rms.fr';
  if (/莱茵金属|Rheinmetall/i.test(n)) return 'rhm.de';
  return null;
}

/** @param {string} code */
function euEastmoneySecidCandidates(code) {
  const raw = String(code || '').trim().toUpperCase();
  if (!raw) return [];
  const secids = [`105.${raw}`];
  const fp = raw.match(/^([A-Z]+)FP$/);
  if (fp) secids.push(`105.${fp[1]}`);
  const gr = raw.match(/^([A-Z]+)GR$/);
  if (gr) secids.push(`105.${gr[1]}`);
  return [...new Set(secids)];
}

/** @param {string} secid @param {boolean} [prevCloseOnly] */
async function fetchEastmoneyQuote(secid, prevCloseOnly = false) {
  try {
    const url = `https://push2.eastmoney.com/api/qt/stock/get?secid=${encodeURIComponent(secid)}&fields=f170,f43,f60,f169,f58`;
    const res = await fetchWithRetry(() =>
      fetch(url, { headers: EM_HEADERS, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) }),
    );
    if (!res.ok) return null;
    const j = await res.json();
    const d = j?.data;
    if (!d || j?.rc === 102) return null;

    const price = d.f43 != null && d.f43 !== '' ? Number(d.f43) / 100 : null;
    const prevClose = d.f60 != null && d.f60 !== '' ? Number(d.f60) / 100 : null;
    const code = secid.split('.').pop();

    if (prevCloseOnly) {
      if (prevClose > 0 && code) prevCloseByTicker.set(code, prevClose);
      return prevClose > 0 ? { prevClose, quoteSource: 'eastmoney' } : null;
    }

    let changePct = null;
    if (d.f170 != null && d.f170 !== '') changePct = Number(d.f170) / 100;
    if (!Number.isFinite(changePct) && prevClose > 0 && price > 0) {
      changePct = ((price - prevClose) / prevClose) * 100;
    } else if (!Number.isFinite(changePct) && d.f169 != null && d.f169 !== '' && prevClose > 0) {
      changePct = ((Number(d.f169) - prevClose) / prevClose) * 100;
    }

    if (!Number.isFinite(changePct)) return null;
    const row = { changePct, price, quoteSource: 'eastmoney', name: d.f58 || undefined };
    if (!isValidQuote(row)) return null;
    if (prevClose > 0 && code) prevCloseByTicker.set(code, prevClose);
    return row;
  } catch {
    return null;
  }
}

/** @param {string[]} secids @param {{ batchOnly?: boolean }} [opts] */
async function fetchEastmoneyBatch(secids, opts = {}) {
  const { batchOnly = false } = opts;
  const unique = [...new Set(secids.filter(Boolean))];
  /** @type {Record<string, object>} */
  const out = {};
  if (!unique.length) return out;

  try {
    const url = `https://push2.eastmoney.com/api/qt/ulist.np/get?fltt=2&secids=${encodeURIComponent(unique.join(','))}&fields=f170,f43,f60,f169,f58,f12`;
    const res = await fetchWithRetry(() =>
      fetch(url, { headers: EM_HEADERS, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) }),
    );
    if (res.ok) {
      const j = await res.json();
      const rows = j?.data?.diff;
      if (Array.isArray(rows)) {
        for (const d of rows) {
          let changePct = null;
          if (d.f170 != null && d.f170 !== '') changePct = Number(d.f170) / 100;
          const price = d.f43 != null && d.f43 !== '' ? Number(d.f43) / 100 : null;
          const prevClose = d.f60 != null && d.f60 !== '' ? Number(d.f60) / 100 : null;
          if (!Number.isFinite(changePct) && prevClose > 0 && price > 0) {
            changePct = ((price - prevClose) / prevClose) * 100;
          }
          const code = d.f12;
          if (!Number.isFinite(changePct) || !code) continue;
          const row = { changePct, price, quoteSource: 'eastmoney' };
          if (!isValidQuote(row)) continue;
          if (prevClose > 0) prevCloseByTicker.set(String(code), prevClose);
          out[String(code)] = row;
        }
      }
    }
  } catch {
    /* batch miss */
  }

  if (batchOnly) return out;

  for (const secid of unique) {
    const code = secid.split('.').pop();
    if (out[code]) continue;
    const q = await fetchEastmoneyQuote(secid);
    if (q) out[code] = q;
  }
  return out;
}

function jpEastmoneySecidCandidates(ticker) {
  return JP_EASTMONEY_PREFIXES.map((p) => `${p}.${ticker}`);
}

/** @param {string} stooqSymbol 如 8035.jp / air.fr */
async function fetchStooqIntradayQuote(stooqSymbol) {
  const sym = stooqSymbol.toLowerCase();
  const ticker = sym.split('.')[0].toUpperCase();
  try {
    const url = `https://stooq.pl/q/l/?s=${encodeURIComponent(sym)}&f=sd2t2ohlcv&h&e=csv`;
    const text = await fetchStooqText(url);
    const lines = text.trim().split('\n');
    if (lines.length < 2) return null;
    const parts = lines[1].split(',');
    if (parts.length < 7 || parts[1] === 'B/D') return null;
    const price = parseFloat(parts[6]);
    if (!Number.isFinite(price) || price <= 0) return null;

    const prevClose = prevCloseByTicker.get(ticker);
    const open = parseFloat(parts[3]);
    let changePct = null;
    const prevLooksCompatible =
      prevClose > 0 && price / prevClose >= 0.34 && price / prevClose <= 3;
    if (prevLooksCompatible) {
      changePct = ((price - prevClose) / prevClose) * 100;
    } else if (open > 0) {
      changePct = ((price - open) / open) * 100;
    }
    if (!Number.isFinite(changePct)) return null;
    const row = {
      changePct,
      price,
      quoteSource: prevLooksCompatible ? 'stooq' : 'stooq-intraday',
    };
    return isValidQuote(row) ? row : null;
  } catch {
    return null;
  }
}

/** @param {string} stooqSymbol */
async function fetchStooqDailyQuote(stooqSymbol) {
  const sym = stooqSymbol.toLowerCase();
  const ticker = sym.split('.')[0].toUpperCase();
  try {
    const url = `https://stooq.pl/q/d/l/?s=${encodeURIComponent(sym)}&i=d`;
    const lines = (await fetchStooqText(url))
      .trim()
      .split('\n')
      .filter((line) => line && !/^date,/i.test(line) && !/^symbol,/i.test(line));
    if (lines.length < 1) return null;
    const last = lines[lines.length - 1].split(',');
    const close = parseFloat(last[4] ?? last[last.length - 2]);
    if (!Number.isFinite(close) || close <= 0) return null;

    let changePct = null;
    if (lines.length >= 2) {
      const prev = lines[lines.length - 2].split(',');
      const prevClose = parseFloat(prev[4] ?? prev[prev.length - 2]);
      if (Number.isFinite(prevClose) && prevClose > 0) {
        changePct = ((close - prevClose) / prevClose) * 100;
        prevCloseByTicker.set(ticker, prevClose);
      }
    }
    if (!Number.isFinite(changePct)) return null;
    const row = { changePct, price: close, quoteSource: 'stooq-daily' };
    return isValidQuote(row) ? row : null;
  } catch {
    return null;
  }
}

/** @param {string} stooqSymbol @param {{ preferDaily?: boolean }} [opts] */
async function fetchStooqQuoteOnce(stooqSymbol, opts = {}) {
  const sym = stooqSymbol.toLowerCase();
  const { preferDaily = false } = opts;
  if (preferDaily) return fetchStooqDailyQuote(sym);
  return fetchStooqIntradayQuote(sym);
}

/** @param {string} stooqSymbol @param {{ preferDaily?: boolean }} [opts] */
async function fetchStooqQuote(stooqSymbol, opts = {}) {
  const sym = stooqSymbol.toLowerCase();
  const cached = stooqQuoteCache.get(sym);
  if (cached && Date.now() - cached.at < STOOQ_CACHE_TTL_MS) {
    if (isValidQuote(cached.quote)) return cached.quote;
    stooqQuoteCache.delete(sym);
  }

  const failUntil = stooqFailUntil.get(sym);
  if (failUntil && Date.now() < failUntil) return null;

  if (stooqInflight.has(sym)) return stooqInflight.get(sym);

  const task = (async () => {
    const quote = await fetchStooqQuoteOnce(sym, opts);
    if (quote && isValidQuote(quote)) {
      stooqQuoteCache.set(sym, { quote, at: Date.now() });
      stooqFailUntil.delete(sym);
      return quote;
    }
    stooqFailUntil.set(sym, Date.now() + STOOQ_FAIL_COOLDOWN_MS);
    return null;
  })().finally(() => stooqInflight.delete(sym));

  stooqInflight.set(sym, task);
  return task;
}

/** @param {string} ticker @param {boolean} [preferDaily] */
async function fetchStooqJpQuote(ticker, preferDaily = false) {
  return fetchStooqQuote(`${String(ticker).toLowerCase()}.jp`, { preferDaily });
}

function getCachedStooqQuote(stooqSymbol) {
  const cached = stooqQuoteCache.get(stooqSymbol.toLowerCase());
  if (cached && Date.now() - cached.at < STOOQ_CACHE_TTL_MS && isValidQuote(cached.quote)) {
    return cached.quote;
  }
  return null;
}

/** @param {object[]} holdings @param {Map<string, string>} symbolByHolding @param {Record<string, object>} byHoldingKey */
function applyCachedStooqQuotes(holdings, symbolByHolding, byHoldingKey) {
  for (const h of holdings) {
    const key = holdingKey(h);
    if (!shouldReplaceQuote(byHoldingKey[key])) continue;
    const sym = symbolByHolding.get(key);
    if (!sym) continue;
    const cached = getCachedStooqQuote(sym);
    if (cached) byHoldingKey[key] = { ...cached, name: h.name || cached.name };
  }
}

/** @type {Map<string, { sym: string, preferDaily: boolean, holdingKey: string, name?: string }>} */
const stooqBackgroundQueue = new Map();
let stooqDrainRunning = false;

/**
 * @param {Array<{ sym: string, preferDaily: boolean, holdingKey: string, name?: string }>} tasks
 * @param {Record<string, object>} byHoldingKey
 */
function scheduleStooqBackground(tasks, byHoldingKey) {
  for (const t of tasks) {
    if (!t.sym || (stooqFailUntil.get(t.sym) ?? 0) > Date.now()) continue;
    stooqBackgroundQueue.set(t.sym, t);
  }
  void drainStooqBackground(byHoldingKey);
}

/** @param {Record<string, object>} byHoldingKey */
async function drainStooqBackground(byHoldingKey) {
  if (stooqDrainRunning || !stooqBackgroundQueue.size) return;
  stooqDrainRunning = true;
  let updated = false;
  try {
    while (stooqBackgroundQueue.size) {
      const batch = [...stooqBackgroundQueue.values()].slice(0, MAX_STOOQ_FETCHES_PER_CALL);
      for (const t of batch) stooqBackgroundQueue.delete(t.sym);
      await runWithConcurrency(batch, STOOQ_CONCURRENCY, async (t) => {
        if (!shouldReplaceQuote(byHoldingKey[t.holdingKey])) return;
        const quote = await fetchStooqQuote(t.sym, { preferDaily: t.preferDaily });
        if (quote && isValidQuote(quote)) {
          byHoldingKey[t.holdingKey] = { ...quote, name: t.name || quote.name };
          updated = true;
        }
      });
    }
  } finally {
    stooqDrainRunning = false;
    if (updated && onStooqQuotesUpdated) onStooqQuotesUpdated(byHoldingKey);
    if (stooqBackgroundQueue.size) void drainStooqBackground(byHoldingKey);
  }
}

function sortByWeightDesc(a, b) {
  return (b.weight ?? 0) - (a.weight ?? 0);
}

/** @param {object[]} items @param {number} [limit] */
function topByWeight(items, limit = MAX_STOOQ_FETCHES_PER_CALL) {
  return [...items].sort(sortByWeightDesc).slice(0, limit);
}

function shouldReplaceQuote(q) {
  if (!q) return true;
  if (q.quoteSource === 'soxx-fallback') return true;
  if (q.quoteSource === 'tencent-us-adr' && isValidQuote(q)) return false;
  return !isValidQuote(q);
}

/** @param {string} code */
function normalizeKrCode(code) {
  const digits = String(code || '').replace(/\D/g, '');
  if (!digits) return '';
  return digits.padStart(6, '0').slice(-6);
}

/** @param {object} row */
function quoteFromNaverRow(row) {
  if (!row?.cd) return null;
  const changePct = Number(row.cr);
  const price = Number(row.nv);
  if (!Number.isFinite(changePct)) return null;
  const prevClose = Number(row.sv);
  if (Number.isFinite(prevClose) && prevClose > 0) {
    prevCloseByTicker.set(String(row.cd), prevClose);
  }
  return {
    changePct,
    price: Number.isFinite(price) && price > 0 ? price : null,
    quoteSource: 'naver',
    name: row.nm || undefined,
  };
}

/** @param {string[]} codes */
async function fetchNaverKrQuotes(codes) {
  const unique = [...new Set(codes.map(normalizeKrCode).filter(Boolean))];
  /** @type {Record<string, object>} */
  const out = {};
  if (!unique.length) return out;

  await Promise.all(
    unique.map(async (code) => {
      try {
        const url = `https://polling.finance.naver.com/api/realtime?query=${encodeURIComponent(`SERVICE_ITEM:${code}`)}`;
        const res = await fetch(url, { headers: NAVER_HEADERS, signal: AbortSignal.timeout(10000) });
        if (!res.ok) return;
        const j = await res.json();
        if (j?.resultCode !== 'success') return;
        const rows = j?.result?.areas?.flatMap((a) => a.datas || []) || [];
        const row = rows.find((r) => normalizeKrCode(r.cd) === code) || rows[0];
        const q = quoteFromNaverRow(row);
        if (q && isValidQuote(q)) out[code] = q;
      } catch {
        /* ignore */
      }
    }),
  );
  return out;
}

/** @param {object} h @param {Record<string, object>} proxyQuotes @param {number} leverage @param {Date} now */
function quoteFromCsopProxy(h, proxyQuotes, leverage, now = new Date()) {
  if (!isHkMarketOpen(now)) return null;
  const proxy = KR_CSOP_PROXY[String(h.code).padStart(6, '0')];
  if (!proxy) return null;
  const hkKey = `rt_hk${proxy.hkCode.padStart(5, '0')}`;
  const pq = proxyQuotes[hkKey];
  if (!pq || !isValidQuote(pq)) return null;
  return {
    changePct: pq.changePct / leverage,
    price: pq.price != null ? pq.price / leverage : null,
    quoteSource: 'kr-csop-proxy',
    name: h.name,
  };
}

/** @param {object[]} holdings @param {Record<string, object>} byHoldingKey */
async function supplementTencentUsAdrQuotes(holdings, byHoldingKey) {
  /** @type {Map<string, string>} holdingKey → tencent US symbol */
  const symByHolding = new Map();
  for (const h of holdings) {
    const key = holdingKey(h);
    if (isValidQuote(byHoldingKey[key])) continue;
    const mapped = resolveTencentUsSymbolFromMap(h.code, h.name);
    if (mapped) symByHolding.set(key, mapped);
  }
  const needLookup = holdings.filter((h) => {
    const key = holdingKey(h);
    return !isValidQuote(byHoldingKey[key]) && !symByHolding.has(key);
  });
  for (const h of needLookup) {
    const key = holdingKey(h);
    const sym = await resolveTencentUsSymbol(h.code, h.name);
    if (sym) symByHolding.set(key, sym);
  }
  const symbols = [...new Set(symByHolding.values())];
  if (!symbols.length) return false;
  const quotes = await fetchTencentUsQuotes(symbols);
  let updated = false;
  for (const h of holdings) {
    const key = holdingKey(h);
    if (isValidQuote(byHoldingKey[key])) continue;
    const sym = symByHolding.get(key);
    const q = sym ? quotes[sym] : null;
    if (q && isValidQuote(q)) {
      byHoldingKey[key] = { ...q, name: h.name || q.name };
      updated = true;
    }
  }
  return updated;
}

/**
 * @param {object[]} holdings
 * @param {Record<string, object>} byHoldingKey
 * @param {Date} [now]
 * @param {{ awaitStooq?: boolean }} [opts]
 */
export async function supplementAsiaQuotes(holdings, byHoldingKey, now = new Date(), opts = {}) {
  const { awaitStooq = false } = opts;
  const krOpen = isHoldingMarketOpen('kr', now);

  for (const h of holdings) {
    if (classifyHoldingMarket(h) !== 'kr') continue;
    const key = holdingKey(h);
    if (byHoldingKey[key]?.quoteSource === 'kr-csop-proxy' && !isHkMarketOpen(now)) {
      delete byHoldingKey[key];
    }
  }

  /** @type {object[]} */
  const krNeeds = [];
  /** @type {object[]} */
  const jpNeeds = [];
  /** @type {object[]} */
  const euNeeds = [];

  for (const h of holdings) {
    const market = classifyHoldingMarket(h);
    const key = holdingKey(h);
    if (market === 'kr' && krOpen && !isValidQuote(byHoldingKey[key])) krNeeds.push(h);
    if (market === 'jp' && !isValidQuote(byHoldingKey[key])) jpNeeds.push(h);
    if (market === 'eu' && !isValidQuote(byHoldingKey[key])) euNeeds.push(h);
  }

  if (!krNeeds.length && !jpNeeds.length && !euNeeds.length) return;

  /** @type {string[]} */
  const eastmoneySecids = [];
  for (const h of krNeeds) {
    const secid = KR_EASTMONEY[String(h.code).padStart(6, '0')];
    if (secid) eastmoneySecids.push(secid);
  }

  /** @type {Map<string, string>} ticker → secid tried */
  const jpTickerByHolding = new Map();
  for (const h of jpNeeds) {
    const ticker = normalizeJpTicker(h.code, h.name);
    if (!ticker) continue;
    jpTickerByHolding.set(holdingKey(h), ticker);
    eastmoneySecids.push(...jpEastmoneySecidCandidates(ticker));
  }

  /** @type {Map<string, string>} holdingKey → stooq symbol */
  const euSymbolByHolding = new Map();
  for (const h of euNeeds) {
    const sym = normalizeEuStooqSymbol(h.code, h.name);
    if (sym) euSymbolByHolding.set(holdingKey(h), sym);
    eastmoneySecids.push(...euEastmoneySecidCandidates(h.code));
  }

  const eastmoneyQuotes = await fetchEastmoneyBatch(eastmoneySecids, { batchOnly: true });
  const naverQuotes = krNeeds.length
    ? await fetchNaverKrQuotes(krNeeds.map((h) => h.code))
    : {};

  /** @type {Record<string, object>} */
  let proxyQuotes = {};
  if (krNeeds.length && isHkMarketOpen(now)) {
    const hkCodes = [
      ...new Set(
        krNeeds
          .map((h) => KR_CSOP_PROXY[String(h.code).padStart(6, '0')]?.hkCode)
          .filter(Boolean)
          .map((c) => `rt_hk${c.padStart(5, '0')}`),
      ),
    ];
    if (hkCodes.length) proxyQuotes = await fetchSinaQuoteKeys(hkCodes);
  }

  for (const h of krNeeds) {
    const key = holdingKey(h);
    const code = String(h.code).padStart(6, '0');
    const em = eastmoneyQuotes[code];
    if (em && isValidQuote(em)) {
      byHoldingKey[key] = { ...em, name: h.name || em.name };
      continue;
    }
    const naver = naverQuotes[code];
    if (naver && isValidQuote(naver)) {
      byHoldingKey[key] = { ...naver, name: h.name || naver.name };
      continue;
    }
    const proxy = quoteFromCsopProxy(
      h,
      proxyQuotes,
      KR_CSOP_PROXY[code]?.leverage ?? 2,
      now,
    );
    if (proxy && isValidQuote(proxy)) byHoldingKey[key] = proxy;
  }

  /** @type {Map<string, string>} */
  const jpSymByHolding = new Map();
  for (const h of jpNeeds) {
    const key = holdingKey(h);
    const ticker = jpTickerByHolding.get(key);
    if (!ticker) continue;
    jpSymByHolding.set(key, `${ticker.toLowerCase()}.jp`);
    const em = eastmoneyQuotes[ticker];
    if (em && isValidQuote(em)) {
      byHoldingKey[key] = { ...em, name: h.name || em.name };
    }
  }
  applyCachedStooqQuotes(jpNeeds, jpSymByHolding, byHoldingKey);

  /** @type {Map<string, string>} */
  const euSymByHolding = new Map();
  for (const h of euNeeds) {
    const key = holdingKey(h);
    const sym = euSymbolByHolding.get(key);
    if (sym) euSymByHolding.set(key, sym);
    const code = String(h.code || '').trim().toUpperCase();
    let em = eastmoneyQuotes[code];
    if (!em || !isValidQuote(em)) {
      for (const secid of euEastmoneySecidCandidates(h.code)) {
        const ticker = secid.split('.').pop();
        if (ticker && eastmoneyQuotes[ticker]) {
          em = eastmoneyQuotes[ticker];
          break;
        }
      }
    }
    if (em && isValidQuote(em)) {
      byHoldingKey[key] = { ...em, name: h.name || em.name };
    }
  }
  applyCachedStooqQuotes(euNeeds, euSymByHolding, byHoldingKey);

  const tencentUpdated = await supplementTencentUsAdrQuotes([...jpNeeds, ...euNeeds], byHoldingKey);
  if (tencentUpdated && onStooqQuotesUpdated) onStooqQuotesUpdated(byHoldingKey);

  const jpPreferDaily = !isJpMarketOpen(now);
  const euPreferDaily = !isEuMarketOpen(now);
  /** @type {Array<{ sym: string, preferDaily: boolean, holdingKey: string, name?: string }>} */
  const stooqTasks = [];

  for (const h of topByWeight(jpNeeds.filter((x) => shouldReplaceQuote(byHoldingKey[holdingKey(x)])))) {
    const key = holdingKey(h);
    const sym = jpSymByHolding.get(key);
    if (!sym) continue;
    stooqTasks.push({ sym, preferDaily: jpPreferDaily, holdingKey: key, name: h.name });
  }
  for (const h of topByWeight(euNeeds.filter((x) => shouldReplaceQuote(byHoldingKey[holdingKey(x)])))) {
    const key = holdingKey(h);
    const sym = euSymByHolding.get(key);
    if (!sym) continue;
    stooqTasks.push({ sym, preferDaily: euPreferDaily, holdingKey: key, name: h.name });
  }

  if (!stooqTasks.length) return;

  if (awaitStooq) {
    await runWithConcurrency(stooqTasks, STOOQ_CONCURRENCY, async (t) => {
      if (!shouldReplaceQuote(byHoldingKey[t.holdingKey])) return;
      const quote = await fetchStooqQuote(t.sym, { preferDaily: t.preferDaily });
      if (quote && isValidQuote(quote)) {
        byHoldingKey[t.holdingKey] = { ...quote, name: t.name || quote.name };
      }
    });
    return;
  }

  scheduleStooqBackground(stooqTasks, byHoldingKey);
}

/** 会话收盘时写入昨收，供次日 Stooq 计算涨跌幅 */
export function rememberAsiaPrevClose(ticker, price) {
  if (ticker && Number.isFinite(price) && price > 0) {
    prevCloseByTicker.set(String(ticker).toUpperCase(), price);
  }
}
