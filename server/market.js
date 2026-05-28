import { extractQuotedVar } from './quote-utils.js';
import { fetchHoldingQuotes, isValidQuote, quoteForHolding } from './quotes.js';
import { applySessionMarketStrip, applySessionQuotes } from './session-quotes.js';
import { getUsSessionPhase, holdingCacheKey } from './holding-market.js';
import {
  fundHasRegularHolding,
  fundNeedsHoldingQuoteRefresh,
  fundShouldRefreshLiveRt1,
} from './fund-regular-eligibility.js';
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
  maskHoldingsForLiveRt1Display,
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
const FUND_DETAIL_CACHE_TTL_MS = 120_000;

/** @type {Map<string, { at: number, result: object }>} */
const fundDetailImpactCache = new Map();
/** @type {{ at: number, byHoldingKey: Record<string, object> }} */
let sharedHoldingQuotes = { at: 0, byHoldingKey: {} };

/** @param {string} code @param {string} [fundName] */
function fundDetailCacheKey(code, fundName = '') {
  return `${String(code).trim()}|${String(fundName || '').trim()}`;
}

/** @param {string} code @param {string} [fundName] @param {number} [maxAgeMs] */
export function getCachedFundImpactDetail(code, fundName = '', maxAgeMs = FUND_DETAIL_CACHE_TTL_MS) {
  const hit = fundDetailImpactCache.get(fundDetailCacheKey(code, fundName));
  if (!hit || Date.now() - hit.at > maxAgeMs) return null;
  return hit.result;
}

/** @param {object} pack */
function holdingsPackSnapshot(pack) {
  return {
    reportDate: pack.reportDate ?? null,
    recentReportDate: pack.recentReportDate ?? null,
    annualReportDate: pack.annualReportDate ?? null,
    reportMeta: pack.reportMeta ?? null,
    reportFundCount: pack.reportFundCount ?? 0,
    holdings: pack.holdings ?? [],
  };
}

/** @param {string} code @param {string} [fundName] @param {object} result @param {object} [pack] */
function rememberFundImpactDetail(code, fundName, result, pack = null) {
  if (!result) return;
  const snapshot = pack ? holdingsPackSnapshot(pack) : result._holdingsPack ?? null;
  fundDetailImpactCache.set(fundDetailCacheKey(code, fundName), {
    at: Date.now(),
    result: snapshot ? { ...result, _holdingsPack: snapshot } : result,
  });
}

/** @param {Record<string, object>} byHoldingKey */
function rememberSharedHoldingQuotes(byHoldingKey) {
  sharedHoldingQuotes = { at: Date.now(), byHoldingKey: { ...byHoldingKey } };
}

/** @param {number} [maxAgeMs] */
function getSharedHoldingQuotes(maxAgeMs = FUND_DETAIL_CACHE_TTL_MS) {
  if (!sharedHoldingQuotes.at || Date.now() - sharedHoldingQuotes.at > maxAgeMs) return null;
  return sharedHoldingQuotes.byHoldingKey;
}

/** @param {Record<string, object>} partial */
export function mergeSharedHoldingQuotes(partial) {
  if (!partial || !Object.keys(partial).length) return;
  const shared = getSharedHoldingQuotes(10 * 60 * 1000) ?? {};
  rememberSharedHoldingQuotes({ ...shared, ...partial });
}

/**
 * 优先复用组合 refresh 已拉取的行情，避免详情页单独打 96 支穿透行情。
 * @param {object[]} holdings
 * @param {Date} now
 */
async function resolveHoldingQuotesForFund(holdings, now) {
  if (!holdings.length) return {};
  const shared = getSharedHoldingQuotes();
  const missing = shared
    ? holdings.filter((h) => !quoteForHolding(h, shared))
    : holdings;
  if (shared && !missing.length) return shared;
  const fetched = await fetchHoldingQuotes(missing, now);
  const merged = shared ? { ...shared, ...fetched.byHoldingKey } : fetched.byHoldingKey;
  rememberSharedHoldingQuotes(merged);
  return merged;
}

const SINA_ORIGIN = 'https://hq.sinajs.cn';
const FUNDGZ_ORIGIN = 'https://fundgz.1234567.com.cn';
const SINA_HEADERS = { Referer: 'https://finance.sina.com.cn/' };

import {
  MARKET_STRIP_INDICES,
  parseFxChangePct,
  parseIndexQuote,
} from './market-indices.js';
import { parseGbSinaQuote } from './gb-quote-parse.js';

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
    hasRegularHolding: false,
  };
}

/** @param {object[]} holdings @param {Date} now */
export function deriveImpactSessionFromHoldings(holdings, _now) {
  for (const h of holdings) {
    const isUs = h.holdingMarket === 'us' || h.holdingMarket === 'other';
    if (isUs && h.quoteSession === 'regular') return 'regular';
  }
  return 'closed';
}

/** @param {object} pack @param {number|null} fxPct @param {Record<string, object>} byHoldingKey @param {Date} now */
function computeFundImpactFromPack(pack, fxPct, byHoldingKey, now) {
  let holdings = pack.holdings || [];
  if (!holdings.length) return emptyHoldingsImpact(pack);

  holdings = applySessionQuotes(holdings, byHoldingKey, now);
  const hasRegularHolding = holdings.some((h) => h.quoteSession === 'regular');
  const liveRt1Opts = hasRegularHolding ? { liveRt1Only: true } : {};
  const cov = summarizeHoldingsCoverage(holdings, liveRt1Opts);
  const impactSession = deriveImpactSessionFromHoldings(holdings, now);
  const impactPct = estimateFromHoldingsWithFx(holdings, fxPct, liveRt1Opts);
  const impactPctRegular =
    impactSession === 'regular' && impactPct != null ? impactPct : null;
  const displayHoldings = maskHoldingsForLiveRt1Display(holdings, hasRegularHolding);
  return {
    impactPct,
    impactPctRegular,
    impactPctExtended: null,
    impactSession,
    hasRegularHolding,
    reportDate: pack.reportDate,
    recentReportDate: pack.recentReportDate,
    annualReportDate: pack.annualReportDate,
    reportMeta: pack.reportMeta,
    reportFundCount: pack.reportFundCount ?? 0,
    count: displayHoldings.length,
    holdings: sortHoldingsByWeight(displayHoldings),
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

  const byHoldingKey = await resolveHoldingQuotesForFund(holdings, now);
  return computeFundImpactFromPack(pack, fxPct, byHoldingKey, now);
}

export {
  fundHasRegularHolding,
  fundNeedsHoldingQuoteRefresh,
  fundShouldRefreshLiveRt1,
} from './fund-regular-eligibility.js';

const EMPTY_HOLDINGS_PACK = {
  reportDate: null,
  recentReportDate: null,
  annualReportDate: null,
  reportMeta: null,
  reportFundCount: 0,
  holdings: [],
};

/**
 * 组合级批量估值：串行拉全仓穿透持仓，避免并行打爆东财导致卡死。
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
  /** @type {object[]} */
  const packs = [];
  for (let i = 0; i < funds.length; i++) {
    const f = funds[i];
    const cachedSource = f.id != null ? impactSourceById.get(f.id) ?? null : null;
    const cached = getCachedFundImpactDetail(f.code, f.name ?? '');
    if (cached?._holdingsPack && !fundNeedsHoldingQuoteRefresh(f, cached._holdingsPack, cachedSource, now)) {
      packs.push(cached._holdingsPack);
      continue;
    }
    try {
      packs.push(await fetchFundHoldings(f.code, f.name ?? ''));
    } catch {
      packs.push({ ...EMPTY_HOLDINGS_PACK });
    }
  }

  const quoteRefreshFlags = funds.map((f, i) => {
    const cachedSource = f.id != null ? impactSourceById.get(f.id) ?? null : null;
    return fundNeedsHoldingQuoteRefresh(f, packs[i], cachedSource, now);
  });

  /** @type {object[]} */
  const liveHoldings = [];
  const seenKeys = new Set();
  for (let i = 0; i < funds.length; i++) {
    const cached = getCachedFundImpactDetail(funds[i].code, funds[i].name ?? '');
    if (!quoteRefreshFlags[i] && cached) continue;
    for (const h of packs[i].holdings ?? []) {
      const key = holdingCacheKey(h);
      if (seenKeys.has(key)) continue;
      seenKeys.add(key);
      liveHoldings.push(h);
    }
  }

  /** @type {Record<string, object>} */
  let byHoldingKey = getSharedHoldingQuotes() ?? {};

  if (liveHoldings.length) {
    const fetched = await fetchHoldingQuotes(liveHoldings, now, {
      supplementAsia: !skipAsiaSupplement,
    });
    byHoldingKey = { ...byHoldingKey, ...fetched.byHoldingKey };
    rememberSharedHoldingQuotes(byHoldingKey);
  }

  const impacts = await Promise.all(
    funds.map((f, i) => {
      const cachedSource = f.id != null ? impactSourceById.get(f.id) ?? null : null;
      if (!quoteRefreshFlags[i]) {
        const cached = getCachedFundImpactDetail(f.code, f.name ?? '');
        if (cached) {
          return Promise.resolve({
            ...cached,
            shouldRefreshLiveRt1: fundShouldRefreshLiveRt1(f, packs[i], cachedSource, now),
          });
        }
      }
      return resolveFundImpactWithQuotes(
        f,
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
  for (let i = 0; i < funds.length; i++) {
    rememberFundImpactDetail(funds[i].code, funds[i].name ?? '', impacts[i], packs[i]);
  }
  return impacts;
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

/** @param {object} fund @param {object} result @param {object} pack @param {string|null} cachedSource @param {Date} now */
function attachFundEligibility(fund, result, pack, cachedSource, now) {
  const impactSource = result?.impactSource ?? cachedSource ?? null;
  return {
    ...result,
    hasRegularHolding:
      result?.hasRegularHolding ?? fundHasRegularHolding(pack?.holdings ?? [], now),
    shouldRefreshLiveRt1: fundShouldRefreshLiveRt1(fund, pack, impactSource, now),
  };
}

/** @param {object} fund @param {Record<string, object>} byHoldingKey @param {string|null} [cachedSource] */
async function resolveFundImpactWithQuotes(
  fund,
  fxPct,
  fundName,
  strip,
  pack,
  byHoldingKey,
  now,
  cachedSource = null,
) {
  const code = fund.code;
  const profile = getFundValuationProfile(code, fundName);
  const strategy = pickValuationStrategy(code, fundName);

  if (cachedSource?.startsWith('proxy:') || strategy === 'proxy') {
    return attachFundEligibility(
      fund,
      await resolveProxyFundImpact(code, fundName, strip),
      pack,
      cachedSource,
      now,
    );
  }

  const r = computeFundImpactFromPack(pack, fxPct, byHoldingKey, now);

  if (cachedSource === 'holdings') {
    return attachFundEligibility(fund, { ...r, impactSource: 'holdings' }, pack, cachedSource, now);
  }
  if (cachedSource === 'fundgz') {
    const gz = await fetchFundGz(code);
    if (gz?.gszzl != null && Number.isFinite(gz.gszzl)) {
      return attachFundEligibility(
        fund,
        syncFundgzImpact(r, gz.gszzl, { impactSource: 'fundgz', gzTime: gz.gztime ?? null }),
        pack,
        cachedSource,
        now,
      );
    }
    return attachFundEligibility(fund, { ...r, impactSource: 'fundgz' }, pack, cachedSource, now);
  }
  if (cachedSource === 'index') {
    const indexHit = resolveProxyIndexImpact(fundName, strip);
    if (indexHit) {
      return attachFundEligibility(
        fund,
        syncFundgzImpact(r, indexHit.impactPct, indexHit),
        pack,
        cachedSource,
        now,
      );
    }
    const indexPct = pickIndexChangePct(fundName, strip);
    if (indexPct != null && Number.isFinite(indexPct)) {
      const impactPct = estimateWithFx(indexPct, fxPct);
      if (impactPct != null) {
        return attachFundEligibility(
          fund,
          syncFundgzImpact(r, impactPct, { impactSource: 'index' }),
          pack,
          cachedSource,
          now,
        );
      }
    }
    return attachFundEligibility(fund, { ...r, impactSource: 'index' }, pack, cachedSource, now);
  }

  const preferHoldings = shouldPreferHoldingsImpact(r, fundName, profile);

  if (preferHoldings) {
    return attachFundEligibility(fund, { ...r, impactSource: 'holdings' }, pack, cachedSource, now);
  }
  if (strategy === 'holdings' && isHoldingsUsable(r)) {
    return attachFundEligibility(fund, { ...r, impactSource: 'holdings' }, pack, cachedSource, now);
  }

  const gz = await fetchFundGz(code);
  if (gz?.gszzl != null && Number.isFinite(gz.gszzl)) {
    return attachFundEligibility(
      fund,
      syncFundgzImpact(r, gz.gszzl, {
        impactSource: 'fundgz',
        gzTime: gz.gztime ?? null,
      }),
      pack,
      cachedSource,
      now,
    );
  }

  const indexPct = pickIndexChangePct(fundName, strip);
  if (indexPct != null && Number.isFinite(indexPct)) {
    const impactPct = estimateWithFx(indexPct, fxPct);
    if (impactPct != null) {
      return attachFundEligibility(
        fund,
        syncFundgzImpact(r, impactPct, { impactSource: 'index' }),
        pack,
        cachedSource,
        now,
      );
    }
  }

  return attachFundEligibility(fund, { ...r, impactSource: null }, pack, cachedSource, now);
}

const NAV_INFO_TTL_MS = 60_000;
const navInfoCache = new Map();

function navInfoTtlMs(code) {
  const n = parseInt(String(code).replace(/\D/g, ''), 10);
  const jitter = Number.isFinite(n) ? n % 60_000 : 0;
  return NAV_INFO_TTL_MS + jitter;
}

export async function fetchFundNavInfo(code, opts = {}) {
  const key = String(code).trim();
  const ttlMs = opts.maxAgeMs ?? navInfoTtlMs(key);
  const hit = navInfoCache.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.data;

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
  const impactPct = item.changePct;
  return { impactPct, impactSource: 'index', impactPctRegular, impactPctExtended: null, impactSession };
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
  const cached = getCachedFundImpactDetail(code, fundName);
  if (cached) return cached;

  const profile = getFundValuationProfile(code, fundName);
  const strategy = pickValuationStrategy(code, fundName);

  let result;
  if (strategy === 'proxy') {
    result = await resolveProxyFundImpact(code, fundName, strip);
  } else {
    const r = await computeFundImpact(code, fxPct, fundName);
    const preferHoldings = shouldPreferHoldingsImpact(r, fundName, profile);

    if (preferHoldings) {
      result = { ...r, impactSource: 'holdings' };
    } else if (strategy === 'holdings' && isHoldingsUsable(r)) {
      result = { ...r, impactSource: 'holdings' };
    } else {
      const gz = await fetchFundGz(code);
      if (gz?.gszzl != null && Number.isFinite(gz.gszzl)) {
        result = syncFundgzImpact(r, gz.gszzl, {
          impactSource: 'fundgz',
          gzTime: gz.gztime ?? null,
        });
      } else {
        const indexPct = pickIndexChangePct(fundName, strip);
        if (indexPct != null && Number.isFinite(indexPct)) {
          const impactPct = estimateWithFx(indexPct, fxPct);
          if (impactPct != null) {
            result = syncFundgzImpact(r, impactPct, { impactSource: 'index' });
          } else {
            result = { ...r, impactSource: null };
          }
        } else {
          result = { ...r, impactSource: null };
        }
      }
    }
  }

  rememberFundImpactDetail(code, fundName, result);
  return result;
}

/** 详情页读缓存时重算穿透展示字段（quoteMode / 涨跌幅），避免时段变化后仍显示旧 CSOP 或「盘中」标签 */
export async function refreshFundHoldingsDisplay(result, now = new Date()) {
  if (!result?.holdings?.length) return result;
  const holdings = result.holdings;
  const shared = getSharedHoldingQuotes() ?? {};
  let byHoldingKey = { ...shared };

  const needsLive = fundHasRegularHolding(holdings, now);
  const missing = holdings.filter((h) => {
    const q = quoteForHolding(h, byHoldingKey);
    return !q || !isValidQuote(q);
  });
  const toFetch = needsLive ? holdings : missing;
  if (toFetch.length) {
    byHoldingKey = {
      ...byHoldingKey,
      ...(await resolveHoldingQuotesForFund(toFetch, now)),
    };
    rememberSharedHoldingQuotes(byHoldingKey);
  }

  const quoted = sortHoldingsByWeight(applySessionQuotes(holdings, byHoldingKey, now));
  const hasRegularHolding = quoted.some((h) => h.quoteSession === 'regular');
  return {
    ...result,
    holdings: maskHoldingsForLiveRt1Display(quoted, hasRegularHolding),
  };
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
