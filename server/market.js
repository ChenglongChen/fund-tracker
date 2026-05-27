import { extractQuotedVar } from './quote-utils.js';
import { fetchHoldingQuotes } from './quotes.js';
import { applySessionMarketStrip, applySessionQuotes, supplementAsiaQuotes } from './session-quotes.js';
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
  parseIndexChangePct,
} from './market-indices.js';

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
      out[key] = { name: parts[0], price: parseFloat(parts[1]), changePct: parseFloat(parts[2]) };
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
  const keys = [...MARKET_STRIP_INDICES.map((i) => i.key), 'fx_susdcny'];
  const url = `${SINA_ORIGIN}/list=${keys.join(',')}`;
  const text = await fetchText(url, SINA_HEADERS);

  const indices = MARKET_STRIP_INDICES.map(({ key, label, market, parse }) => {
    const raw = extractQuotedVar(text, `hq_str_${key}`);
    const changePct = parseIndexChangePct(raw, parse);
    return { label, changePct, market };
  });

  const fxRaw = extractQuotedVar(text, 'hq_str_fx_susdcny');
  const fx = {
    label: '汇率',
    changePct: parseFxChangePct(fxRaw),
    market: 'fx',
  };
  return applySessionMarketStrip([...indices, fx], now);
}

export async function computeFundImpact(code, fxPct = null, fundName = '', now = new Date()) {
  const pack = await fetchFundHoldings(code, fundName);
  let holdings = pack.holdings || [];
  if (!holdings.length) {
    return {
      impactPct: null,
      reportDate: pack.reportDate,
      recentReportDate: pack.recentReportDate,
      annualReportDate: pack.annualReportDate,
      count: 0,
      holdings: [],
      weightCoverage: 0,
    };
  }

  const { byHoldingKey } = await fetchHoldingQuotes(holdings, now);
  await supplementAsiaQuotes(holdings, byHoldingKey, now);
  holdings = applySessionQuotes(holdings, byHoldingKey, now);

  const cov = summarizeHoldingsCoverage(holdings);
  const impactPct = estimateFromHoldingsWithFx(holdings, fxPct);
  return {
    impactPct,
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
    return {
      ...r,
      impactPct: gz.gszzl,
      impactSource: 'fundgz',
      gzTime: gz.gztime ?? null,
    };
  }

  const indexPct = pickIndexChangePct(fundName, strip);
  if (indexPct != null && Number.isFinite(indexPct)) {
    const impactPct = estimateWithFx(indexPct, fxPct);
    if (impactPct != null) return { ...r, impactPct, impactSource: 'index' };
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
