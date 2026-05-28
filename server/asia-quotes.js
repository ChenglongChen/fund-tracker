/**
 * 日韩股实时行情：东财 push2 → Naver KRX → 港开时 CSOP 2x → Stooq（日股）。
 */
import { isValidQuote, quoteForHolding, fetchSinaQuoteKeys } from './quotes.js';
import {
  classifyHoldingMarket,
  isHkMarketOpen,
  isHoldingMarketOpen,
} from './holding-market.js';

const EM_HEADERS = {
  Referer: 'https://finance.eastmoney.com/',
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
};

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

const JP_EASTMONEY_PREFIXES = ['124', '107', '201'];

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
  return null;
}

/** @param {string} secid @param {boolean} [prevCloseOnly] */
async function fetchEastmoneyQuote(secid, prevCloseOnly = false) {
  try {
    const url = `https://push2.eastmoney.com/api/qt/stock/get?secid=${encodeURIComponent(secid)}&fields=f170,f43,f60,f169,f58`;
    const res = await fetch(url, { headers: EM_HEADERS });
    if (!res.ok) return null;
    const j = await res.json();
    const d = j?.data;
    if (!d || j?.rc === 102) return null;

    const price = d.f43 != null && d.f43 !== '' ? Number(d.f43) / 100 : null;
    const prevClose = d.f60 != null && d.f60 !== '' ? Number(d.f60) / 100 : null;
    const code = secid.split('.').pop();
    if (prevClose > 0 && code) prevCloseByTicker.set(code, prevClose);

    if (prevCloseOnly) {
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
    return { changePct, price, quoteSource: 'eastmoney', name: d.f58 || undefined };
  } catch {
    return null;
  }
}

/** @param {string[]} secids */
async function fetchEastmoneyBatch(secids) {
  const unique = [...new Set(secids.filter(Boolean))];
  /** @type {Record<string, object>} */
  const out = {};
  if (!unique.length) return out;

  try {
    const url = `https://push2.eastmoney.com/api/qt/ulist.np/get?fltt=2&secids=${encodeURIComponent(unique.join(','))}&fields=f170,f43,f60,f169,f58,f12`;
    const res = await fetch(url, { headers: EM_HEADERS });
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
          if (prevClose > 0 && code) prevCloseByTicker.set(String(code), prevClose);
          if (!Number.isFinite(changePct) || !code) continue;
          out[String(code)] = { changePct, price, quoteSource: 'eastmoney' };
        }
      }
    }
  } catch {
    /* fall through to per-secid */
  }

  for (const secid of unique) {
    const code = secid.split('.').pop();
    if (out[code]) continue;
    const q = await fetchEastmoneyQuote(secid);
    if (q) out[code] = q;
  }
  return out;
}

/** @param {string} ticker */
async function ensureJpPrevClose(ticker) {
  if (prevCloseByTicker.get(String(ticker).toUpperCase())) return;
  for (const secid of jpEastmoneySecidCandidates(ticker)) {
    const hit = await fetchEastmoneyQuote(secid, true);
    if (hit?.prevClose) return;
  }
}

/** @param {string} ticker */
async function fetchStooqJpQuote(ticker) {
  await ensureJpPrevClose(ticker);
  const sym = `${String(ticker).toLowerCase()}.jp`;
  try {
    const url = `https://stooq.pl/q/l/?s=${encodeURIComponent(sym)}&f=sd2t2ohlcv&h&e=csv`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const text = await res.text();
    const lines = text.trim().split('\n');
    if (lines.length < 2) return null;
    const parts = lines[1].split(',');
    if (parts.length < 7 || parts[1] === 'B/D') return null;
    const price = parseFloat(parts[6]);
    if (!Number.isFinite(price) || price <= 0) return null;

    const prevClose = prevCloseByTicker.get(String(ticker).toUpperCase());
    const open = parseFloat(parts[3]);
    let changePct = null;
    if (prevClose > 0) {
      changePct = ((price - prevClose) / prevClose) * 100;
    } else if (open > 0) {
      changePct = ((price - open) / open) * 100;
    }
    if (!Number.isFinite(changePct)) return null;
    return {
      changePct,
      price,
      quoteSource: prevClose > 0 ? 'stooq' : 'stooq-intraday',
    };
  } catch {
    return null;
  }
}

/** @param {string} ticker */
function jpEastmoneySecidCandidates(ticker) {
  return JP_EASTMONEY_PREFIXES.map((p) => `${p}.${ticker}`);
}

function shouldReplaceQuote(q) {
  if (!q) return true;
  if (q.quoteSource === 'soxx-fallback') return true;
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

/**
 * @param {object[]} holdings
 * @param {Record<string, object>} byHoldingKey
 * @param {Date} [now]
 */
export async function supplementAsiaQuotes(holdings, byHoldingKey, now = new Date()) {
  const krOpen = isHoldingMarketOpen('kr', now);
  const jpOpen = isHoldingMarketOpen('jp', now);

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

  for (const h of holdings) {
    const market = classifyHoldingMarket(h);
    if (market === 'kr' && krOpen) krNeeds.push(h);
    if (market === 'jp' && jpOpen) jpNeeds.push(h);
  }

  if (!krNeeds.length && !jpNeeds.length) return;

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

  const eastmoneyQuotes = await fetchEastmoneyBatch(eastmoneySecids);
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
    const secid = KR_EASTMONEY[code];
    let em = eastmoneyQuotes[code];
    if ((!em || !isValidQuote(em)) && secid) {
      em = await fetchEastmoneyQuote(secid);
    }
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

  for (const h of jpNeeds) {
    const key = holdingKey(h);
    const ticker = jpTickerByHolding.get(key);
    if (!ticker) continue;

    const em = eastmoneyQuotes[ticker];
    if (em && isValidQuote(em)) {
      byHoldingKey[key] = { ...em, name: h.name || em.name };
      continue;
    }

    const stooq = await fetchStooqJpQuote(ticker);
    if (stooq && isValidQuote(stooq)) {
      byHoldingKey[key] = { ...stooq, name: h.name };
    }
  }
}

/** 会话收盘时写入昨收，供次日 Stooq 计算涨跌幅 */
export function rememberAsiaPrevClose(ticker, price) {
  if (ticker && Number.isFinite(price) && price > 0) {
    prevCloseByTicker.set(String(ticker).toUpperCase(), price);
  }
}
