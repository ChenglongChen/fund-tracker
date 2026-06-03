/**
 * 持仓抓取与合并管线（东财年报 + Q1 + 移动端）。
 * 权重估算参数来自 valuation-profile，不在此 hardcode。
 */
import { toSinaFetchCode } from './quotes.js';
import { applyWeightModel, finalizeHoldings } from './weight-model.js';
import { getSyntheticHoldings, getWeightParams } from './valuation-profile.js';
import { fetchReportFundInvestments } from './report-holdings.js';

const F10_ORIGIN = 'https://fundf10.eastmoney.com';
const FUNDMOB_ORIGIN = 'https://fundmobapi.eastmoney.com';
const FUNDMOB_HEADERS = { Referer: 'https://fund.eastmoney.com/' };

const ANNUAL_TOPLINE = 10000;
const ANNUAL_TOP_N = 92;
const HOLDINGS_PACK_TTL_MS = 5 * 60_000;

/** @type {Map<string, { at: number, pack: object }>} */
const holdingsPackCache = new Map();

const HOLDING_DISPLAY_ALIASES = {
  空中客车有限公司: '空客',
  日本电产株式会社: '日本电产',
  德国莱茵金属股份有限公司: '莱茵金属',
  爱马仕国际股份有限合伙企业: '爱马仕',
  铠侠控股株式会社: '铠侠',
  长芯博创: '博创科技',
  斯菱智驱: '斯菱股份',
  杰克科技: '杰克股份',
  乐舒适: '魏桥纺织',
  'MKS Inc': 'MKS仪器',
  揖斐电株式会社: '揖斐电',
  摩尔线程: '摩尔线程-U',
  'Adyen NV': 'Adyen公众有限公司',
  '腾讯控股ADR': '腾讯控股(ADR)',
  '通用电气(US)': 'GE航空航天',
  劲方医药: '劲方医药-B',
  '创新ETF-ARK': 'ARK Innovation ETF',
  'ARK Genomic Revolution ETF': 'ARK Genomic Revolution ETF',
  'ARK Autonomous Technology & Robotics ETF': 'ARK Autonomous Technology & Robotics ETF',
  'ARK Next Generation Internet ETF': 'ARK Next Generation Internet ETF',
  'Liberty Media Corp Liberty Form': 'Liberty Media Corp Liberty Formula One-C',
  南方两倍做多三星电子: '南方两倍做多三星',
  日东纺: 'Nitto Boseki Co Ltd',
  富士电机: '芝浦机电集团',
  '盛科通信-U': '盛科通信',
  'Meta Platforms Inc-A': 'Meta Platforms Inc-A',
  'Meta Platforms Inc-C': 'Meta Platforms Inc-A',
};

async function fetchText(url, headers = {}) {
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${url}`);
  return Buffer.from(await res.arrayBuffer()).toString('utf8');
}

function parseHoldingsRow(rowHtml) {
  if (/<th/i.test(rowHtml)) return null;
  let marketId = null;
  let stockCode = null;
  const linkMatch = rowHtml.match(/unify\/r\/(\d+)\.([a-zA-Z0-9]+)/);
  if (linkMatch) {
    marketId = parseInt(linkMatch[1], 10);
    stockCode = linkMatch[2];
  } else {
    const spanCode = rowHtml.match(/<span data-texch[^>]*>([^<]+)<\/span>/);
    if (!spanCode?.[1]?.trim()) return null;
    stockCode = spanCode[1].trim();
  }
  const cells = [...rowHtml.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((m) =>
    m[1].replace(/<[^>]+>/g, '').trim(),
  );
  if (cells.length < 4) return null;
  let weightIdx = null;
  for (let i = 0; i < cells.length; i++) {
    const c = cells[i];
    if (c.endsWith('%') && /^[\d.]+\s*%$/.test(c.replace(/\s/g, ''))) {
      weightIdx = i;
      break;
    }
  }
  if (weightIdx == null) return null;
  const weight = parseFloat(cells[weightIdx].replace('%', '').replace(/,/g, ''));
  if (!Number.isFinite(weight) || weight <= 0 || weight > 20) return null;
  const stockName = cells[2] || stockCode;
  return {
    code: stockCode,
    name: stockName,
    weight,
    marketId,
    fetchCode: toSinaFetchCode(stockCode, Number.isFinite(marketId) ? marketId : null, stockName),
    changePct: null,
    price: null,
  };
}

export function holdingMergeKey(h) {
  const c = String(h.code).trim().replace(/\.$/, '');
  if (/^\d+$/.test(c) && c.length <= 5) return c.padStart(5, '0');
  return c.toUpperCase();
}

export function holdingDisplayName(name) {
  const n = String(name || '').trim();
  if (HOLDING_DISPLAY_ALIASES[n]) return HOLDING_DISPLAY_ALIASES[n];
  if (/rocket\s*lab/i.test(n)) return 'Rocket Lab USA Inc-A';
  return n;
}

export function holdingMatchName(name) {
  const raw = holdingDisplayName(name);
  if (/ark innovation/i.test(raw)) return 'arkinnovation';
  if (/ark genomic/i.test(raw)) return 'arkgenomicrevolution';
  if (/ark autonomous/i.test(raw)) return 'arkautonomous';
  if (/ark next generation internet/i.test(raw)) return 'arknextgenerationinternet';
  return raw
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/inc\.?/g, '')
    .replace(/corp\.?/g, '')
    .replace(/ltd\.?/g, '')
    .replace(/-a/g, '')
    .replace(/-c/g, '')
    .replace(/-w/g, '')
    .replace(/etf/g, '')
    .replace(/交易型开.*$/g, '')
    .replace(/指数基金/g, '')
    .replace(/arkinvestmentmanagementllc/g, '')
    .replace(/statestreetglobaladvisorsinc/g, '')
    .replace(/控股株式会社/g, '')
    .replace(/股份有限合伙企业/g, '')
    .replace(/股份有限公司/g, '')
    .replace(/有限公司/g, '')
    .replace(/集团/g, '')
    .replace(/公众/g, '');
}

function parseHoldingsHtml(html) {
  const holdings = [];
  const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let rowMatch;
  while ((rowMatch = rowRe.exec(html)) !== null) {
    const row = parseHoldingsRow(rowMatch[1]);
    if (row) holdings.push(row);
  }
  return holdings;
}

function parseHoldingsSection(sectionHtml) {
  const tableMatch = sectionHtml.match(
    /<table class='w782 comm tzxq(?: t2)?'>[\s\S]*?<tbody>([\s\S]*?)<\/tbody>/,
  );
  if (!tableMatch) return [];
  return parseHoldingsHtml(tableMatch[1]);
}

function splitHoldingsSections(html) {
  return html.split("<h4 class='t'>").slice(1).map((sectionHtml) => {
    const reportDate =
      sectionHtml.match(/截止至：<font class='px12'>([\d-]+)/)?.[1] ||
      sectionHtml.match(/截止至：[^<]*<[^>]*>([\d-]+)/)?.[1] ||
      sectionHtml.match(/截止至：\s*([\d-]+)/)?.[1] ||
      null;
    return { reportDate, holdings: parseHoldingsSection(sectionHtml) };
  });
}

function normalizeAnnualHoldings(holdings) {
  const sorted = sortHoldingsByWeight(holdings);
  if (sorted.length <= ANNUAL_TOP_N) return sorted;
  return sorted.slice(0, ANNUAL_TOP_N);
}

async function fetchMobileQuarterHoldings(code) {
  const url = `${FUNDMOB_ORIGIN}/FundMNewApi/FundMNInverstPosition?FCODE=${String(code).trim()}&deviceid=Wap&plat=Wap&product=EFund&version=2.0.0`;
  try {
    const res = await fetch(url, { headers: FUNDMOB_HEADERS });
    if (!res.ok) return [];
    const body = await res.json();
    const stocks = body?.Datas?.fundStocks;
    if (!Array.isArray(stocks) || body.ErrCode !== 0) return [];
    return stocks
      .map((s) => {
        const marketId = s.NEWTEXCH != null && s.NEWTEXCH !== '' ? parseInt(s.NEWTEXCH, 10) : null;
        const stockCode = String(s.GPDM || '').trim();
        const weight = parseFloat(s.JZBL);
        if (!stockCode || !Number.isFinite(weight) || weight <= 0) return null;
        return {
          code: stockCode,
          name: s.GPJC || stockCode,
          weight,
          marketId: Number.isFinite(marketId) ? marketId : null,
          fetchCode: toSinaFetchCode(stockCode, marketId, s.GPJC || stockCode),
          changePct: null,
          price: null,
          positionChangeType: s.PCTNVCHGTYPE ?? null,
          positionChangePct:
            s.PCTNVCHG != null && s.PCTNVCHG !== '' ? parseFloat(s.PCTNVCHG) : null,
        };
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

async function fetchHoldingsPeriod(code, opts = {}) {
  const c = String(code).trim();
  const { year = '', month = '', topline = 100, sectionDate = '' } = opts;
  const url = `${F10_ORIGIN}/FundArchivesDatas.aspx?type=jjcc&code=${c}&topline=${topline}&year=${year}&month=${month}&_=${Date.now()}`;
  const text = await fetchText(url);
  const contentMatch = text.match(/content:\s*"((?:\\.|[^"\\])*)"/);
  const html = contentMatch
    ? contentMatch[1].replace(/\\"/g, '"').replace(/\\n/g, '\n').replace(/\\\//g, '/')
    : '';
  if (!html || html.includes('暂无数据')) return { reportDate: null, holdings: [] };

  if (year) {
    const sections = splitHoldingsSections(html);
    if (sectionDate) {
      const hit = sections.find((s) => s.reportDate === sectionDate);
      if (hit) return { reportDate: hit.reportDate, holdings: hit.holdings };
    }
    if (month) {
      const targetDate =
        sectionDate ||
        `${year}-${String(parseInt(month, 10) * 3).padStart(2, '0')}-` +
          (month === '3' ? '31' : month === '6' ? '30' : month === '9' ? '30' : '31');
      const hit =
        sections.find((s) => s.reportDate === targetDate) ||
        sections.find((s) => s.reportDate?.startsWith(`${year}-`)) ||
        sections[0];
      if (!hit) return { reportDate: null, holdings: [] };
      return { reportDate: hit.reportDate, holdings: hit.holdings };
    }
    if (sections.length) return { reportDate: sections[0].reportDate, holdings: sections[0].holdings };
  }

  const sections = splitHoldingsSections(html);
  if (sections.length) return { reportDate: sections[0].reportDate, holdings: sections[0].holdings };

  const dateMatch =
    html.match(/截止至：[^<]*<[^>]*>([\d-]+)/) || html.match(/截止至：\s*([\d-]+)/);
  return { reportDate: dateMatch ? dateMatch[1] : null, holdings: parseHoldingsHtml(html) };
}

/** §5.9 货币基金/债券等：不计入穿透估值（xyz 亦不在明细中展示） */
export function isNonEquityReportFund(h) {
  const t = `${h.rawName || ''}${h.name || ''}${h.code || ''}`;
  if (/Money Market|Bond Fund|债券|货币|Income Bond|Unit Trust Series/i.test(t)) return true;
  if (/^GFUSD|^GFIUnit|^KraneSharesArtif/i.test(String(h.code || ''))) return true;
  if (h?.source !== 'report-fund') return false;
  return /Money Market|Bond Fund|债券|货币|Income Bond/i.test(t);
}

/** 是否参与穿透估值加总 */
export function countsTowardValuation(h) {
  return !isNonEquityReportFund(h);
}

/** row1 live 穿透：仅正盘持仓计入；休市/未开盘不参与 RT1 */
export function countsTowardLiveRt1(h) {
  return countsTowardValuation(h) && h.quoteSession === 'regular';
}

/** live RT1 展示：非正盘持仓涨跌幅置空（UI 显示 —） */
export function maskHoldingsForLiveRt1Display(holdings, shouldLive) {
  if (!shouldLive) return holdings;
  return holdings.map((h) => {
    if (h.quoteSession === 'regular') return h;
    return {
      ...h,
      changePct: null,
      changePctRegular: null,
      changePctPremarket: null,
      liveRt1Excluded: true,
    };
  });
}

export function sortHoldingsByWeight(holdings) {
  return [...holdings].sort(
    (a, b) => b.weight - a.weight || String(a.name || a.code).localeCompare(String(b.name || b.code)),
  );
}

export function mergeHoldingsReports(...groups) {
  const byCode = new Map();
  for (const group of groups) {
    if (!group?.length) continue;
    for (const h of group) {
      const key = holdingMergeKey(h);
      byCode.set(key, {
        ...h,
        name: holdingDisplayName(h.name),
        code: String(h.code).trim().replace(/\.$/, '') || h.code,
        _mergeKey: key,
      });
    }
  }
  return sortHoldingsByWeight([...byCode.values()]);
}

/** 原始抓取结果，供校准脚本使用 */
export async function fetchFundHoldingsRaw(code) {
  const recentPack = await fetchHoldingsPeriod(code, { topline: 50 });
  const recentYear = recentPack.reportDate
    ? parseInt(recentPack.reportDate.slice(0, 4), 10)
    : new Date().getFullYear();
  const annualYear = String(recentYear - 1);

  let annualPack = await fetchHoldingsPeriod(code, {
    year: annualYear,
    topline: ANNUAL_TOPLINE,
    sectionDate: `${annualYear}-12-31`,
  });

  if (annualPack.holdings.length < 5) {
    annualPack = await fetchHoldingsPeriod(code, {
      year: annualYear,
      month: '6',
      topline: ANNUAL_TOPLINE,
      sectionDate: `${annualYear}-06-30`,
    });
  }

  let reportFundPack = { report: null, fundInvestments: [] };
  try {
    reportFundPack = await fetchReportFundInvestments(code);
  } catch {
    /* 季报 PDF 解析失败时不阻塞股票持仓 */
  }

  return {
    reportDate: recentPack.reportDate || annualPack.reportDate,
    recentReportDate: recentPack.reportDate,
    annualReportDate: annualPack.reportDate,
    annualHoldings: normalizeAnnualHoldings(annualPack.holdings),
    recentHoldings: recentPack.holdings,
    mobileHoldings: await fetchMobileQuarterHoldings(code),
    reportFundInvestments: reportFundPack.fundInvestments,
    reportMeta: reportFundPack.report,
  };
}

/**
 * @param {string} code
 * @param {string} [fundName]
 * @param {import('./weight-model.js').WeightModelParams} [weightParams]
 * @param {object[]} [syntheticHoldings]
 */
export function assembleHoldings(pack, weightParams, syntheticHoldings = []) {
  const reportFunds = (pack.reportFundInvestments || []).map((h) => ({
    ...h,
    name: holdingDisplayName(h.name),
  }));
  const recentKeys = new Set(pack.recentHoldings.map((h) => holdingMergeKey(h)));
  const mobileKeys = new Set(pack.mobileHoldings.map((h) => holdingMergeKey(h)));
  const reportFundKeys = new Set(reportFunds.map((h) => holdingMergeKey(h)));
  const synth = syntheticHoldings.map((h) => ({
    ...h,
    name: holdingDisplayName(h.name || h.code),
    fetchCode: h.fetchCode || toSinaFetchCode(h.code, h.marketId ?? null, h.name),
    changePct: null,
    price: null,
  }));
  const synthKeys = new Set(synth.map((h) => holdingMergeKey(h)));
  const disclosed = new Set([...recentKeys, ...mobileKeys, ...reportFundKeys, ...synthKeys]);

  const merged = mergeHoldingsReports(
    pack.annualHoldings,
    pack.recentHoldings,
    pack.mobileHoldings,
    reportFunds,
    synth,
  );
  const adjusted = applyWeightModel(merged, disclosed, weightParams);
  return finalizeHoldings(adjusted, disclosed, weightParams);
}

/** @param {string} code @param {string} [fundName] */
export async function fetchFundHoldings(code, fundName = '') {
  const key = `${String(code).trim()}|${String(fundName || '')}`;
  const hit = holdingsPackCache.get(key);
  if (hit && Date.now() - hit.at < HOLDINGS_PACK_TTL_MS) {
    return hit.pack;
  }

  const pack = await fetchFundHoldingsRaw(code);
  const weightParams = getWeightParams(code, fundName);
  const syntheticHoldings = getSyntheticHoldings(code, fundName);
  const holdings = assembleHoldings(pack, weightParams, syntheticHoldings);
  const result = {
    reportDate: pack.reportDate,
    recentReportDate: pack.recentReportDate,
    annualReportDate: pack.annualReportDate,
    reportMeta: pack.reportMeta,
    reportFundCount: (pack.reportFundInvestments || []).length,
    holdings,
  };
  holdingsPackCache.set(key, { at: Date.now(), pack: result });
  return result;
}

/** 该持仓权重中需叠加 USD/CNY 变动的比例（A 股/港股本体不加美元汇率项） */
export function usdExposedWeight(h) {
  const mid = h.marketId;
  const code = String(h.code || '').trim();
  if (h.source === 'report-fund') {
    if (mid === 105 || mid === 106) return h.weight;
    if (/^(SOXL|SOXX|SMH|QQQ|TQQQ|XBI|SPY|IVV)$/i.test(code)) return h.weight;
    return 0;
  }
  if (mid === 105 || mid === 106) return h.weight;
  if (/^[A-Za-z][A-Za-z0-9.-]*$/i.test(code) && !/^\d+$/.test(code)) return h.weight;
  return 0;
}

/** @param {number|null|{ usd?: number|null, hkd?: number|null, fxPct?: number|null }} fxStrip @param {'usd'|'hkd'} [kind] */
function pickFxStripPct(fxStrip, kind = 'usd') {
  if (fxStrip == null) return 0;
  if (typeof fxStrip === 'number') return kind === 'usd' ? fxStrip : fxStrip * 0.85;
  const usd = fxStrip.usd ?? fxStrip.fxPct ?? 0;
  if (kind === 'usd') return Number.isFinite(usd) ? usd : 0;
  const hkd = fxStrip.hkd;
  if (hkd != null && Number.isFinite(hkd)) return hkd;
  return (Number.isFinite(usd) ? usd : 0) * 0.85;
}

/** @param {object[]} holdings @param {{ liveRt1Only?: boolean }} [opts] */
export function summarizeFxExposure(holdings, opts = {}) {
  const counts = opts.liveRt1Only ? countsTowardLiveRt1 : countsTowardValuation;
  let usdWeight = 0;
  let hkdWeight = 0;
  for (const h of holdings) {
    if (!counts(h)) continue;
    if (h.holdingMarket === 'hk') hkdWeight += h.weight;
    else usdWeight += usdExposedWeight(h);
  }
  return { usdWeight, hkdWeight };
}

/** @param {object[]} holdings @param {number|null|object} fxStrip @param {{ liveRt1Only?: boolean }} [opts] */
export function computeHoldingsImpactBreakdown(holdings, fxStrip, opts = {}) {
  const holdingsPct = estimateFromHoldings(holdings, opts);
  if (holdingsPct == null) return null;
  const { usdWeight, hkdWeight } = summarizeFxExposure(holdings, opts);
  const fxUsdPct = pickFxStripPct(fxStrip, 'usd');
  const fxHkdPct = pickFxStripPct(fxStrip, 'hkd');
  const fxUsdContribution = (usdWeight / 100) * fxUsdPct;
  const fxHkdContribution = (hkdWeight / 100) * fxHkdPct;
  const fxContribution = fxUsdContribution + fxHkdContribution;
  return {
    holdingsPct,
    fxUsdPct,
    fxHkdPct,
    fxUsdContribution,
    fxHkdContribution,
    fxContribution,
    usdWeight,
    hkdWeight,
    totalPct: holdingsPct + fxContribution,
  };
}

export function summarizeHoldingsCoverage(holdings, { liveRt1Only = false } = {}) {
  let weightCoverage = 0;
  let quoteCoverage = 0;
  let usdWeight = 0;
  let quotedCount = 0;
  const counts = liveRt1Only ? countsTowardLiveRt1 : countsTowardValuation;
  for (const h of holdings) {
    if (!counts(h)) continue;
    weightCoverage += h.weight;
    usdWeight += usdExposedWeight(h);
    if (h.changePct != null && Number.isFinite(h.changePct)) {
      quoteCoverage += h.weight;
      quotedCount += 1;
    }
  }
  return { weightCoverage, quoteCoverage, usdWeight, quotedCount };
}

export function estimateFromHoldings(holdings, { liveRt1Only = false } = {}) {
  let sumWC = 0;
  let used = 0;
  const counts = liveRt1Only ? countsTowardLiveRt1 : countsTowardValuation;
  for (const h of holdings) {
    if (!counts(h)) continue;
    if (h.changePct == null || !Number.isFinite(h.changePct)) continue;
    sumWC += h.weight * h.changePct;
    used += h.weight;
  }
  if (used <= 0) return null;
  return sumWC / 100;
}

/** 穿透收益 + FX 分项（USD/HKD 暴露） */
export function estimateFromHoldingsWithFx(holdings, fxStrip, opts = {}) {
  const bd = computeHoldingsImpactBreakdown(holdings, fxStrip, opts);
  return bd?.totalPct ?? null;
}

/** @deprecated 整包加 FX；新代码请用 estimateFromHoldingsWithFx */
export function estimateWithFx(holdingsPct, fxPct, usdWeightPct = 100) {
  if (holdingsPct == null || !Number.isFinite(holdingsPct)) return null;
  const fx = fxPct != null && Number.isFinite(fxPct) ? fxPct : 0;
  const ratio = Number.isFinite(usdWeightPct) ? usdWeightPct / 100 : 1;
  return holdingsPct + fx * ratio;
}
