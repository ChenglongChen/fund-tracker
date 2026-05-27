import { extractQuotedVar } from './quote-utils.js';
import { fetchHoldingQuotes } from './quotes.js';
import { applySessionMarketStrip, applySessionQuotes, supplementAsiaQuotes, getIndexSessionRegular } from './session-quotes.js';
import { getUsSessionPhase } from './holding-market.js';
import {
  fetchFundHoldings,
  sortHoldingsByWeight,
  holdingMergeKey,
  holdingDisplayName,
  holdingMatchName,
  estimateFromHoldings,
  estimateFromHoldingsWithFx,
  estimateWithFx,
  summarizeHoldingsCoverage,
  usdExposedWeight,
} from './holdings-pipeline.js';
import {
  getFundValuationProfile,
  getProxyCandidates,
  indexStripLabelForProxyFund,
  isIndexProxyFund,
  pickValuationStrategy,
  proxyCodeFor,
} from './valuation-profile.js';

const MIN_QUOTED_FOR_HOLDINGS = 3;
const MIN_QUOTE_COVERAGE = 40;

const SINA_ORIGIN = 'https://hq.sinajs.cn';
const FUNDGZ_ORIGIN = 'https://fundgz.1234567.com.cn';
const SINA_HEADERS = { Referer: 'https://finance.sina.com.cn/' };

import {
  MARKET_STRIP_INDICES,
  parseFxChangePct,
  parseIndexQuote,
} from './market-indices.js';
import { getQqqPremarketPct, parseGbSinaQuote } from './gb-quote-parse.js';

export {
  holdingMergeKey,
  holdingDisplayName,
  holdingMatchName,
  sortHoldingsByWeight,
  estimateFromHoldings,
  estimateFromHoldingsWithFx,
  estimateWithFx,
  fetchFundHoldings,
};

/** 非指数联接且有可用持仓 → 走 holdings */
export function shouldPreferHoldingsImpact(r, fundName = '', profile = null) {
  if (isIndexProxyFund(fundName)) return false;
  if (!isHoldingsUsable(r)) return false;
  const quoted = r.quotedCount ?? 0;
  const quoteCov = r.quoteCoverage ?? 0;
  if (quoted >= MIN_QUOTED_FOR_HOLDINGS || quoteCov >= MIN_QUOTE_COVERAGE) return true;
  if ((profile?.reportFundCount ?? r.reportFundCount ?? 0) > 0 && quoteCov >= 30) return true;
  return false;
}

async function fetchText(url, headers = {}) {
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (/sinajs\.cn/i.test(url)) return new TextDecoder('gbk').decode(buf);
  return buf.toString('utf8');
}

function parseSinaList(text, keys) {
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
      out[key] = { name: parts[0], price: cur, changePct: pre > 0 ? ((cur - pre) / pre) * 100 : 0 };
    }
  }
  return out;
}

export async function fetchSinaQuotes(fetchCodes) {
  const unique = [...new Set(fetchCodes.filter(Boolean))];
  if (!unique.length) return {};
  const url = `${SINA_ORIGIN}/list=${unique.join(',')}`;
  const text = await fetchText(url, SINA_HEADERS);
  return parseSinaList(text, unique);
}

export async function fetchMarketStrip(now = new Date()) {
  const keys = [...MARKET_STRIP_INDICES.map((i) => i.key), 'fx_susdcny', 'gb_qqq'];
  const url = `${SINA_ORIGIN}/list=${keys.join(',')}`;
  const text = await fetchText(url, SINA_HEADERS);

  const qqqRaw = extractQuotedVar(text, 'hq_str_gb_qqq');
  parseGbSinaQuote('gb_qqq', qqqRaw);

  const indices = MARKET_STRIP_INDICES.map(({ key, label, market, parse }) => {
    const raw = extractQuotedVar(text, `hq_str_${key}`);
    const quote = parseIndexQuote(raw, parse, key);
    return { label, market, ...quote };
  });

  const fxRaw = extractQuotedVar(text, 'hq_str_fx_susdcny');
  const fx = {
    label: '汇率',
    changePct: parseFxChangePct(fxRaw),
    market: 'fx',
  };
  return applySessionMarketStrip([...indices, fx], now);
}

function emptyHoldingsImpact(pack) {
  return {
    impactPct: null,
    reportDate: pack.reportDate,
    recentReportDate: pack.recentReportDate,
    annualReportDate: pack.annualReportDate,
    count: 0,
    holdings: [],
    weightCoverage: 0,
    quoteCoverage: 0,
    usdWeight: 0,
    quotedCount: 0,
  };
}

const MAX_DAILY_REGULAR_PCT = 12;

function resolveUsRegularChangePct(h, ndxRegular) {
  const pct = h.changePct;
  const pre = h.changePctPremarket;
  let regular = h.changePctRegular;

  if (regular != null && Number.isFinite(regular) && ndxRegular != null && Number.isFinite(ndxRegular)) {
    const ndxSignificant = Math.abs(ndxRegular) >= 0.3;
    const signMismatch = ndxSignificant && regular * ndxRegular < 0;
    const farFromIndex = Math.abs(regular - ndxRegular) > 5;
    if (signMismatch || farFromIndex) regular = null;
  }

  if (regular != null && Number.isFinite(regular)) return regular;

  if (pct != null && Number.isFinite(pct)) {
    const preAbs = pre != null && Number.isFinite(pre) ? Math.abs(pre) : 0;
    if (Math.abs(pct) > Math.max(2, preAbs * 1.5) && Math.abs(pct) <= MAX_DAILY_REGULAR_PCT) {
      return pct;
    }
  }

  if (ndxRegular != null && Number.isFinite(ndxRegular)) return ndxRegular;
  return null;
}

function fillUsRegularFromIndex(holdings) {
  const ndxRegular = getIndexSessionRegular('纳斯达克100');
  return holdings.map((h) => {
    const isUs = h.holdingMarket === 'us' || h.holdingMarket === 'other';
    const extended =
      h.quoteSession === 'premarket' ||
      h.quoteSession === 'afterhours' ||
      h.quoteSession === 'overnight';
    if (!isUs || !extended) return h;
    const resolved = resolveUsRegularChangePct(h, ndxRegular);
    if (resolved == null) return h;
    return { ...h, changePctRegular: resolved };
  });
}

function holdingsWithRegularChange(holdings) {
  const ndxRegular = getIndexSessionRegular('纳斯达克100');
  return holdings.map((h) => {
    const isUs = h.holdingMarket === 'us' || h.holdingMarket === 'other';
    const extended =
      h.quoteSession === 'premarket' ||
      h.quoteSession === 'afterhours' ||
      h.quoteSession === 'overnight';
    if (isUs && extended) {
      const regular = resolveUsRegularChangePct(h, ndxRegular);
      return {
        ...h,
        changePct: regular != null && Number.isFinite(regular) ? regular : null,
      };
    }
    return { ...h, changePct: h.changePct };
  });
}

function holdingsWithExtendedChange(holdings) {
  return holdings.map((h) => {
    const isUs = h.holdingMarket === 'us' || h.holdingMarket === 'other';
    const extended =
      h.quoteSession === 'premarket' ||
      h.quoteSession === 'afterhours' ||
      h.quoteSession === 'overnight';
    if (!isUs || !extended) {
      return { ...h, changePct: 0 };
    }
    if (h.changePctPremarket != null && Number.isFinite(h.changePctPremarket)) {
      return { ...h, changePct: h.changePctPremarket };
    }
    if (
      h.changePct != null &&
      Number.isFinite(h.changePct) &&
      h.changePctRegular != null &&
      Number.isFinite(h.changePctRegular)
    ) {
      return { ...h, changePct: h.changePct - h.changePctRegular };
    }
    return { ...h, changePct: null };
  });
}

function combineImpactPct(impactPctRegular, impactPctExtended, fallbackTotal) {
  const hasRegular = impactPctRegular != null && Number.isFinite(impactPctRegular);
  const hasExtended = impactPctExtended != null && Number.isFinite(impactPctExtended);
  if (hasRegular && hasExtended) {
    return impactPctRegular + impactPctExtended;
  }
  if (hasRegular && !hasExtended) return impactPctRegular;
  if (!hasRegular && hasExtended && fallbackTotal != null) return fallbackTotal;
  return fallbackTotal;
}

/** @param {object[]} holdings @param {Date} now */
export function deriveImpactSessionFromHoldings(holdings, now) {
  let usExtended = false;
  let usRegular = false;
  for (const h of holdings) {
    const isUs = h.holdingMarket === 'us' || h.holdingMarket === 'other';
    if (!isUs) continue;
    const phase = h.quoteSession;
    if (phase === 'regular') usRegular = true;
    if (phase === 'premarket' || phase === 'afterhours' || phase === 'overnight') usExtended = true;
  }
  if (usRegular) return 'regular';
  if (usExtended) {
    const usPhase = getUsSessionPhase(now);
    if (usPhase === 'premarket' || usPhase === 'afterhours' || usPhase === 'overnight') return usPhase;
  }
  return 'closed';
}

function attachExtendedImpactFields(impactPct, impactPctRegular, impactPctExtended, impactSession) {
  if (impactSession !== 'premarket' && impactSession !== 'afterhours' && impactSession !== 'overnight') {
    return { impactPctRegular, impactPctExtended: null, impactSession };
  }
  let extended = impactPctExtended;
  if (extended == null && impactPct != null && impactPctRegular != null && Number.isFinite(impactPct) && Number.isFinite(impactPctRegular)) {
    extended = impactPct - impactPctRegular;
  }
  return { impactPctRegular, impactPctExtended: extended, impactSession };
}

/** @param {object} pack @param {number|null} fxPct @param {Record<string, object>} byHoldingKey @param {Date} now */
function computeFundImpactFromPack(pack, fxPct, byHoldingKey, now) {
  let holdings = pack.holdings || [];
  if (!holdings.length) return emptyHoldingsImpact(pack);

  holdings = applySessionQuotes(holdings, byHoldingKey, now);
  holdings = fillUsRegularFromIndex(holdings);
  const cov = summarizeHoldingsCoverage(holdings);
  const impactSession = deriveImpactSessionFromHoldings(holdings, now);
  const impactPctRegular = estimateFromHoldingsWithFx(holdingsWithRegularChange(holdings), fxPct);
  const impactPctExtendedEstimate =
    impactSession === 'premarket' ||
    impactSession === 'afterhours' ||
    impactSession === 'overnight'
      ? estimateFromHoldingsWithFx(holdingsWithExtendedChange(holdings), fxPct)
      : null;
  const fallbackTotal = estimateFromHoldingsWithFx(holdings, fxPct);
  const impactPct = combineImpactPct(impactPctRegular, impactPctExtendedEstimate, fallbackTotal);
  const extended = attachExtendedImpactFields(
    impactPct,
    impactPctRegular,
    impactPctExtendedEstimate,
    impactSession,
  );
  return {
    impactPct,
    ...extended,
    reportDate: pack.reportDate,
    recentReportDate: pack.recentReportDate,
    annualReportDate: pack.annualReportDate,
    reportMeta: pack.reportMeta,
    reportFundCount: pack.reportFundCount ?? 0,
    count: holdings.length,
    holdings: sortHoldingsByWeight(holdings),
    weightCoverage: cov.weightCoverage,
    quoteCoverage: cov.quoteCoverage,
    usdWeight: cov.usdWeight,
    quotedCount: cov.quotedCount,
  };
}

export async function computeFundImpact(code, fxPct = null, fundName = '', now = new Date()) {
  const pack = await fetchFundHoldings(code, fundName);
  let holdings = pack.holdings || [];
  if (!holdings.length) return emptyHoldingsImpact(pack);

  const { byHoldingKey } = await fetchHoldingQuotes(holdings, now);
  await supplementAsiaQuotes(holdings, byHoldingKey, now);
  return computeFundImpactFromPack(pack, fxPct, byHoldingKey, now);
}

/**
 * 组合级批量估值：一次拉全仓持仓行情，避免逐基金重复请求新浪。
 * @param {Array<{ id?: number, code: string, name?: string }>} funds
 * @param {Map<number|string, string>} [impactSourceById] 已知估值来源时跳过 fundgz 探测
 * @param {{ skipAsiaSupplement?: boolean }} [opts]
 */
export async function resolvePortfolioImpacts(
  funds,
  strip,
  fxPct = null,
  now = new Date(),
  impactSourceById = new Map(),
  opts = {},
) {
  const { skipAsiaSupplement = false } = opts;
  const packs = await Promise.all(funds.map((f) => fetchFundHoldings(f.code, f.name ?? '')));

  /** @type {object[]} */
  const allHoldings = [];
  for (const pack of packs) {
    if (pack.holdings?.length) allHoldings.push(...pack.holdings);
  }

  const { byHoldingKey } = allHoldings.length
    ? await fetchHoldingQuotes(allHoldings, now)
    : { byHoldingKey: {} };
  if (allHoldings.length && !skipAsiaSupplement) {
    await supplementAsiaQuotes(allHoldings, byHoldingKey, now);
  }

  return Promise.all(
    funds.map((f, i) => {
      const cachedSource = f.id != null ? impactSourceById.get(f.id) ?? null : null;
      return resolveFundImpactWithQuotes(
        f.code,
        fxPct,
        f.name ?? '',
        strip,
        packs[i],
        byHoldingKey,
        now,
        cachedSource,
      );
    }),
  );
}

/** fundgz/index 覆写时同步 total 与 regular，避免 estimate/display 分裂 */
function syncFundgzImpact(r, gszzl, extra = {}) {
  const regular =
    r.impactPctRegular != null && Number.isFinite(r.impactPctRegular)
      ? r.impactPctRegular
      : gszzl;
  return {
    ...r,
    ...extra,
    impactPct: gszzl,
    impactPctRegular: regular,
  };
}

/** @param {object} pack @param {Record<string, object>} byHoldingKey @param {string|null} [cachedSource] */
async function resolveFundImpactWithQuotes(
  code,
  fxPct,
  fundName,
  strip,
  pack,
  byHoldingKey,
  now,
  cachedSource = null,
) {
  const profile = getFundValuationProfile(code, fundName);
  const strategy = pickValuationStrategy(code, fundName);

  if (cachedSource?.startsWith('proxy:') || strategy === 'proxy') {
    return resolveProxyFundImpact(code, fundName, strip);
  }

  const r = computeFundImpactFromPack(pack, fxPct, byHoldingKey, now);

  if (cachedSource === 'holdings') return { ...r, impactSource: 'holdings' };
  if (cachedSource === 'fundgz') {
    const gz = await fetchFundGz(code);
    if (gz?.gszzl != null && Number.isFinite(gz.gszzl)) {
      return syncFundgzImpact(r, gz.gszzl, { impactSource: 'fundgz', gzTime: gz.gztime ?? null });
    }
    return { ...r, impactSource: 'fundgz' };
  }
  if (cachedSource === 'index') {
    const indexHit = resolveProxyIndexImpact(fundName, strip);
    if (indexHit) return syncFundgzImpact(r, indexHit.impactPct, indexHit);
    const indexPct = pickIndexChangePct(fundName, strip);
    if (indexPct != null && Number.isFinite(indexPct)) {
      const impactPct = estimateWithFx(indexPct, fxPct);
      if (impactPct != null) {
        return syncFundgzImpact(r, impactPct, { impactSource: 'index' });
      }
    }
    return { ...r, impactSource: 'index' };
  }

  const preferHoldings = shouldPreferHoldingsImpact(r, fundName, profile);

  if (preferHoldings) return { ...r, impactSource: 'holdings' };
  if (strategy === 'holdings' && isHoldingsUsable(r)) return { ...r, impactSource: 'holdings' };

  const gz = await fetchFundGz(code);
  if (gz?.gszzl != null && Number.isFinite(gz.gszzl)) {
    return syncFundgzImpact(r, gz.gszzl, {
      impactSource: 'fundgz',
      gzTime: gz.gztime ?? null,
    });
  }

  const indexPct = pickIndexChangePct(fundName, strip);
  if (indexPct != null && Number.isFinite(indexPct)) {
    const impactPct = estimateWithFx(indexPct, fxPct);
    if (impactPct != null) {
      return syncFundgzImpact(r, impactPct, { impactSource: 'index' });
    }
  }

  return { ...r, impactSource: null };
}

const NAV_INFO_TTL_MS = 5 * 60_000;
const navInfoCache = new Map();

export async function fetchFundNavInfo(code) {
  const key = String(code).trim();
  const hit = navInfoCache.get(key);
  if (hit && Date.now() - hit.at < NAV_INFO_TTL_MS) return hit.data;

  const url = `https://fundmobapi.eastmoney.com/FundMNewApi/FundMNFInfo?pageIndex=1&pageSize=1&plat=Android&appVersion=3.0.0&product=EFund&Version=1&deviceid=1&Fcodes=${key}`;
  let data = null;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = await res.json();
    const row = body?.Datas?.[0];
    if (row?.PDATE && row?.NAV != null) {
      const navChgRt = row.NAVCHGRT != null && row.NAVCHGRT !== '' ? parseFloat(row.NAVCHGRT) : null;
      data = {
        pdate: row.PDATE,
        nav: parseFloat(row.NAV),
        navChgRt: Number.isFinite(navChgRt) ? navChgRt : null,
        displayDate: body?.Expansion?.FSRQ ?? row.PDATE,
        name: row.SHORTNAME ? String(row.SHORTNAME).trim() : null,
      };
    }
  } catch {
    data = null;
  }
  navInfoCache.set(key, { at: Date.now(), data });
  return data;
}

const HOLDINGS_MAX_AGE_DAYS = 365;

export function isHoldingsUsable(r) {
  if (r.impactPct == null || !r.count) return false;
  if (!r.reportDate) return true;
  const t = new Date(r.reportDate).getTime();
  if (!Number.isFinite(t)) return false;
  return (Date.now() - t) / (24 * 60 * 60 * 1000) <= HOLDINGS_MAX_AGE_DAYS;
}

export function isHoldingsFresh(r) {
  return isHoldingsUsable(r);
}

export function pickIndexChangePct(name, strip) {
  const n = String(name || '');
  const find = (label) => strip.find((x) => x.label === label)?.changePct ?? null;
  if (/标普500|博时标普|标普/.test(n)) return find('标普500');
  if (/纳斯达克100|纳指100|纳斯达克|纳指/.test(n)) return find('纳斯达克100') ?? find('纳斯达克');
  return null;
}

/** 养基宝口径：纯指数联接优先用对应大盘指数涨跌幅 */
export function resolveProxyIndexImpact(fundName, strip) {
  const label = indexStripLabelForProxyFund(fundName);
  if (!label) return null;
  const item = strip.find((x) => x.label === label);
  if (item?.changePct == null || !Number.isFinite(item.changePct)) return null;
  const impactSession = item?.quoteSession ?? 'closed';
  const impactPctRegular =
    item?.changePctRegular != null && Number.isFinite(item.changePctRegular)
      ? item.changePctRegular
      : item.changePct;
  let impactPctExtended = null;
  if (impactSession === 'premarket' || impactSession === 'afterhours' || impactSession === 'overnight') {
    if (item?.changePctPremarket != null && Number.isFinite(item.changePctPremarket) && item.changePctPremarket !== 0) {
      impactPctExtended = item.changePctPremarket;
    } else {
      impactPctExtended = getQqqPremarketPct();
    }
    if (impactPctExtended == null && impactPctRegular != null) {
      impactPctExtended = item.changePct - impactPctRegular;
    }
  }
  const impactPct = combineImpactPct(impactPctRegular, impactPctExtended, item.changePct);
  const extended = attachExtendedImpactFields(
    impactPct,
    impactPctRegular,
    impactPctExtended,
    impactSession,
  );
  return { impactPct, impactSource: 'index', ...extended };
}

async function resolveProxyFundImpact(code, fundName, strip) {
  const indexHit = resolveProxyIndexImpact(fundName, strip);
  if (indexHit) {
    return { ...emptyImpactResult(), ...indexHit };
  }
  const gzHit = await fetchBestFundGz(code, fundName);
  if (gzHit) {
    return {
      ...emptyImpactResult(),
      impactPct: gzHit.gszzl,
      impactSource: gzHit.source,
      proxyCode: gzHit.code !== String(code).trim() ? gzHit.code : undefined,
      gzTime: gzHit.gztime,
    };
  }
  return { ...emptyImpactResult(), impactSource: null };
}

function parseFundGzTime(value) {
  if (!value) return 0;
  const t = new Date(String(value).replace(' ', 'T')).getTime();
  return Number.isFinite(t) ? t : 0;
}

function emptyImpactResult() {
  return {
    impactPct: null,
    reportDate: null,
    count: 0,
    holdings: [],
    weightCoverage: 0,
  };
}

/** 联接/黄金等 proxy 基金：并行拉候选 gz，取估值时间最新的一条 */
async function fetchBestFundGz(code, fundName = '') {
  const proxy = proxyCodeFor(code, fundName);
  const candidates = [
    ...new Set([proxy, code, ...getProxyCandidates(code, fundName)].filter(Boolean).map(String)),
  ];
  const hits = await Promise.all(
    candidates.map(async (candidate) => {
      const gz = await fetchFundGz(candidate);
      if (gz?.gszzl == null || !Number.isFinite(gz.gszzl)) return null;
      return {
        code: candidate,
        gszzl: gz.gszzl,
        gztime: gz.gztime ?? null,
        source: candidate === String(code).trim() ? 'fundgz' : `proxy:${candidate}`,
      };
    }),
  );
  return hits
    .filter(Boolean)
    .sort((a, b) => parseFundGzTime(b.gztime) - parseFundGzTime(a.gztime))[0] ?? null;
}

export async function resolveFundImpact(code, fxPct = null, fundName = '', strip = []) {
  const profile = getFundValuationProfile(code, fundName);
  const strategy = pickValuationStrategy(code, fundName);

  if (strategy === 'proxy') {
    return resolveProxyFundImpact(code, fundName, strip);
  }

  const r = await computeFundImpact(code, fxPct, fundName);
  const preferHoldings = shouldPreferHoldingsImpact(r, fundName, profile);

  if (preferHoldings) {
    return { ...r, impactSource: 'holdings' };
  }

  if (strategy === 'holdings' && isHoldingsUsable(r)) {
    return { ...r, impactSource: 'holdings' };
  }

  const gz = await fetchFundGz(code);
  if (gz?.gszzl != null && Number.isFinite(gz.gszzl)) {
    return syncFundgzImpact(r, gz.gszzl, {
      impactSource: 'fundgz',
      gzTime: gz.gztime ?? null,
    });
  }

  const indexPct = pickIndexChangePct(fundName, strip);
  if (indexPct != null && Number.isFinite(indexPct)) {
    const impactPct = estimateWithFx(indexPct, fxPct);
    if (impactPct != null) {
      return syncFundgzImpact(r, impactPct, { impactSource: 'index' });
    }
  }

  return { ...r, impactSource: null };
}

export {
  pickValuationStrategy,
  proxyCodeFor,
  getFundValuationProfile,
  isIndexProxyFund,
} from './valuation-profile.js';

export async function fetchFundGz(code) {
  const url = `${FUNDGZ_ORIGIN}/js/${String(code).trim()}.js?rt=${Date.now()}`;
  const text = await fetchText(url, { Referer: 'https://fund.eastmoney.com/' });
  const m = text.match(/jsonpgz\((\{[\s\S]*\})\)/);
  if (!m) return null;
  try {
    const data = JSON.parse(m[1]);
    return {
      fundcode: data.fundcode,
      name: data.name,
      jzrq: data.jzrq,
      dwjz: parseFloat(data.dwjz),
      gsz: parseFloat(data.gsz),
      gszzl: parseFloat(data.gszzl),
      gztime: data.gztime,
    };
  } catch {
    return null;
  }
}
