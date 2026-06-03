/**
 * 根据官方 JZZZL 历史自动校准每只基金的估值策略与权重参数。
 * 运行: node scripts/calibrate-valuation.js [--days=25] [--code=270023]
 * 输出: data/valuation-profiles.json
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  fetchFundHoldingsRaw,
  holdingMergeKey,
  usdExposedWeight,
} from '../server/holdings-pipeline.js';
import {
  discoverProxyCandidates,
  RESIDUAL_ETF_CANDIDATES,
  saveValuationProfiles,
  loadValuationProfiles,
  mergeWeightParams,
  isIndexProxyFund,
  defaultProxyCodeForIndex,
} from '../server/valuation-profile.js';
import { applyWeightModel, finalizeHoldings } from '../server/weight-model.js';
import { beijingDateString } from '../server/time.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

const args = process.argv.slice(2);
const DAYS = parseInt(args.find((a) => a.startsWith('--days='))?.split('=')[1] || '25', 10);
const ONLY_CODE = args.find((a) => a.startsWith('--code='))?.split('=')[1]?.trim();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchFundHistory(code, pages = 3) {
  const rows = [];
  for (let page = 1; page <= pages; page++) {
    const url = `http://api.fund.eastmoney.com/f10/lsjz?fundCode=${code}&pageIndex=${page}&pageSize=20&_=${Date.now()}`;
    const res = await fetch(url, { headers: { Referer: 'http://fundf10.eastmoney.com/' } });
    if (!res.ok) break;
    const j = await res.json();
    const list = j?.Data?.LSJZList || [];
    if (!list.length) break;
    rows.push(...list);
    await sleep(100);
  }
  return rows
    .filter((r) => r.FSRQ && r.JZZZL !== '' && r.JZZZL != null)
    .map((r) => ({ date: r.FSRQ, pct: parseFloat(r.JZZZL) }))
    .filter((r) => Number.isFinite(r.pct));
}

async function fetchIndexHistory(secid, limit = 80) {
  try {
    const url = `https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=${secid}&fields1=f1&fields2=f51,f59&klt=101&fqt=0&end=20500101&lmt=${limit}`;
    const res = await fetch(url, { headers: { Referer: 'https://finance.eastmoney.com/' } });
    if (!res.ok) return new Map();
    const j = await res.json();
    const map = new Map();
    for (const k of j?.data?.klines || []) {
      const p = k.split(',');
      const chg = parseFloat(p[8]);
      if (Number.isFinite(chg)) map.set(p[0], chg);
    }
    return map;
  } catch {
    return new Map();
  }
}

function lookupIndex(indexMap, date) {
  if (indexMap.has(date)) return indexMap.get(date);
  const d = new Date(`${date}T12:00:00`);
  for (let i = 1; i <= 5; i++) {
    d.setDate(d.getDate() - 1);
    const key = beijingDateString(d);
    if (indexMap.has(key)) return indexMap.get(key);
  }
  return null;
}

function mae(truth, pred) {
  if (!truth.length) return Infinity;
  let ae = 0;
  for (let i = 0; i < truth.length; i++) ae += Math.abs(pred[i] - truth[i]);
  return ae / truth.length;
}

function indexKeyForFund(name) {
  const n = String(name || '');
  if (/标普500|博时标普|标普/.test(n)) return '100.SPX';
  if (/黄金/.test(n)) return '118.AU9999';
  return '100.NDX';
}

function eastmoneySecid(h) {
  if (h.marketId === 105 || h.marketId === 106) return `${h.marketId}.${h.code}`;
  if (h.marketId === 116) {
    const hk = String(h.code || '').replace(/\D/g, '');
    return hk ? `116.${hk.padStart(5, '0')}` : null;
  }
  const c = String(h.code || '').trim();
  if (/^[A-Z][A-Z0-9.-]*$/i.test(c)) return `105.${c.toUpperCase()}`;
  if (/^6/.test(c)) return `1.${c}`;
  if (/^[03]/.test(c)) return `0.${c}`;
  return null;
}

function reportHasEtfCode(pack, code) {
  const key = holdingMergeKey({ code });
  return (pack.reportFundInvestments || []).some(
    (h) =>
      holdingMergeKey(h) === key ||
      new RegExp(String(code).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i').test(
        `${h.rawName || ''}${h.name || ''}`,
      ),
  );
}

/** @param {import('../server/weight-model.js').WeightModelParams} params */
function buildHoldingsFromPack(pack, params, synthetic = []) {
  const reportFunds = (pack.reportFundInvestments || []).map((h) => ({
    ...h,
    _mergeKey: holdingMergeKey(h),
  }));
  const recentKeys = new Set(pack.recentHoldings.map((h) => holdingMergeKey(h)));
  const mobileKeys = new Set(pack.mobileHoldings.map((h) => holdingMergeKey(h)));
  const reportFundKeys = new Set(reportFunds.map((h) => holdingMergeKey(h)));
  const synth = synthetic.map((h) => ({ ...h, _mergeKey: holdingMergeKey(h) }));
  const synthKeys = new Set(synth.map((h) => holdingMergeKey(h)));

  const byKey = new Map();
  for (const group of [
    pack.annualHoldings,
    pack.recentHoldings,
    pack.mobileHoldings,
    reportFunds,
    synth,
  ]) {
    for (const h of group) {
      byKey.set(holdingMergeKey(h), { ...h, _mergeKey: holdingMergeKey(h) });
    }
  }

  const disclosed = new Set([...recentKeys, ...mobileKeys, ...reportFundKeys, ...synthKeys]);
  const adjusted = applyWeightModel([...byKey.values()], disclosed, params);
  return finalizeHoldings(adjusted, disclosed, params);
}

function holdingsForHistoryBacktest(holdings, limit = 55) {
  const report = holdings.filter((h) => h.source === 'report-fund');
  const rest = holdings.filter((h) => h.source !== 'report-fund');
  const seen = new Set(report.map((h) => holdingMergeKey(h)));
  const picked = [...report];
  for (const h of rest) {
    if (picked.length >= limit) break;
    const k = holdingMergeKey(h);
    if (seen.has(k)) continue;
    seen.add(k);
    picked.push(h);
  }
  return picked;
}

async function buildStockHistoryMaps(holdings, limit = 55) {
  /** @type {Map<string, { weight: number, map: Map<string, number>, holding: object }>} */
  const maps = new Map();
  for (const h of holdingsForHistoryBacktest(holdings, limit)) {
    const secid = eastmoneySecid(h);
    if (!secid) continue;
    const map = await fetchIndexHistory(secid, 80);
    if (map.size) maps.set(holdingMergeKey(h), { weight: h.weight, map, holding: h });
    await sleep(35);
  }
  return maps;
}

async function predictHoldingsSeries(history, holdings, fxMap) {
  const stockMaps = await buildStockHistoryMaps(holdings);
  if (!stockMaps.size) return null;

  const truth = [];
  const pred = [];
  for (const row of history) {
    let sumWC = 0;
    let used = 0;
    let usdWeight = 0;
    for (const { weight, map, holding } of stockMaps.values()) {
      const chg = lookupIndex(map, row.date);
      if (chg == null || !Number.isFinite(chg)) continue;
      sumWC += weight * chg;
      used += weight;
      usdWeight += usdExposedWeight(holding);
    }
    if (used <= 0) continue;
    const holdingsPct = sumWC / 100;
    const fx = lookupIndex(fxMap, row.date) ?? 0;
    truth.push(row.pct);
    pred.push(holdingsPct + fx * (usdWeight / 100));
  }
  return truth.length >= 5 ? { truth, pred } : null;
}

/** 权重参数网格（全局搜索，非逐基金） */
const WEIGHT_PARAM_GRID = [
  mergeWeightParams(),
  mergeWeightParams({ highScale: 0.32 }),
  mergeWeightParams({ highScale: 0.45 }),
  mergeWeightParams({ usMidThreshold: 2.75, usMidDelta: 1 }),
  mergeWeightParams({ usMidThreshold: 3, usMidDelta: 1 }),
  mergeWeightParams({
    highScale: 0.38,
    usMidThreshold: 2.75,
    usMidDelta: 1,
    usLowBandMin: 2,
    usLowBandMax: 2.61,
    usLowBandDelta: 1,
    usTrim1Min: 1.55,
    usTrim1Max: 1.65,
    usTrim1Delta: 0.35,
    usTrim2Min: 1,
    usTrim2Max: 1.55,
    usTrim2Delta: 0.45,
  }),
];

const SYNTH_WEIGHT_GRID = [0, 5, 8, 11, 14, 17];

async function calibrateFund(fund, history, indexMap, fxMap, proxyCache) {
  const results = [];

  const idxSeries = [];
  for (const row of history) {
    const idx = lookupIndex(indexMap, row.date);
    if (idx == null) continue;
    const fx = lookupIndex(fxMap, row.date) ?? 0;
    idxSeries.push({ truth: row.pct, pred: idx + fx });
  }
  if (idxSeries.length >= 5) {
    results.push({
      strategy: 'index',
      proxyCode: null,
      weightParams: mergeWeightParams(),
      syntheticHoldings: [],
      mae: mae(
        idxSeries.map((x) => x.truth),
        idxSeries.map((x) => x.pred),
      ),
      algoLabel: 'index+fx',
    });
  }

  for (const proxyCode of discoverProxyCandidates(fund.name, fund.code)) {
    if (proxyCode === fund.code) continue;
    if (!proxyCache[proxyCode]) {
      proxyCache[proxyCode] = new Map(
        (await fetchFundHistory(proxyCode, 3)).map((r) => [r.date, r.pct]),
      );
    }
    const proxyMap = proxyCache[proxyCode];
    const aligned = history
      .map((row) => {
        const v = proxyMap.get(row.date);
        return v != null && Number.isFinite(v) ? { truth: row.pct, pred: v } : null;
      })
      .filter(Boolean);
    if (aligned.length < 5) continue;
    results.push({
      strategy: 'proxy',
      proxyCode,
      weightParams: mergeWeightParams(),
      syntheticHoldings: [],
      mae: mae(
        aligned.map((x) => x.truth),
        aligned.map((x) => x.pred),
      ),
      algoLabel: `proxy:${proxyCode}`,
    });
  }

  const pack = await fetchFundHoldingsRaw(fund.code);
  if (!pack.annualHoldings.length && !pack.recentHoldings.length && !pack.reportFundInvestments?.length) {
    results.sort((a, b) => a.mae - b.mae);
    return { results, pack };
  }

  for (const params of WEIGHT_PARAM_GRID) {
    const holdings = buildHoldingsFromPack(pack, params, []);
    const series = await predictHoldingsSeries(history, holdings, fxMap);
    if (!series) continue;
    results.push({
      strategy: 'holdings',
      proxyCode: null,
      weightParams: params,
      syntheticHoldings: [],
      mae: mae(series.truth, series.pred),
      algoLabel: 'holdings',
    });

    for (const etf of RESIDUAL_ETF_CANDIDATES) {
      if (reportHasEtfCode(pack, etf.code)) continue;
      for (const w of SYNTH_WEIGHT_GRID) {
        if (w === 0) continue;
        const synth = [{ ...etf, weight: w }];
        const h2 = buildHoldingsFromPack(pack, params, synth);
        const s2 = await predictHoldingsSeries(history, h2, fxMap);
        if (!s2) continue;
        results.push({
          strategy: 'holdings',
          proxyCode: null,
          weightParams: params,
          syntheticHoldings: synth,
          mae: mae(s2.truth, s2.pred),
          algoLabel: `holdings+${etf.code}@${w}%`,
        });
      }
    }
  }

  results.sort((a, b) => a.mae - b.mae);
  return { results, pack };
}

/** 指数联接走 proxy；主动/QDII 有持仓走 holdings */
function pickCalibratedResult(fund, results, pack) {
  if (!results.length) return null;
  const best = results[0];
  const bestHoldings = results.find((r) => r.strategy === 'holdings' && !r.algoLabel.includes('+'));
  const hasReportFunds = (pack?.reportFundInvestments?.length || 0) > 0;

  if (isIndexProxyFund(fund.name)) {
    const bestProxy = results.find((r) => r.strategy === 'proxy') || best;
    return bestProxy;
  }

  if (hasReportFunds) {
    if (bestHoldings) return bestHoldings;
    return {
      strategy: 'holdings',
      proxyCode: best.proxyCode || defaultProxyCodeForIndex(fund.name),
      weightParams: mergeWeightParams(),
      syntheticHoldings: [],
      mae: best.mae,
      algoLabel: 'holdings:report-fund',
    };
  }

  if (bestHoldings) return bestHoldings;

  return {
    strategy: 'holdings',
    proxyCode: best.proxyCode || defaultProxyCodeForIndex(fund.name),
    weightParams: mergeWeightParams(),
    syntheticHoldings: [],
    mae: best.mae,
    algoLabel: 'holdings:default',
  };
}

function cleanSyntheticForProfile(pack, synthetic) {
  if (!synthetic?.length) return undefined;
  const kept = synthetic.filter((s) => !reportHasEtfCode(pack, s.code));
  return kept.length ? kept : undefined;
}

async function main() {
  const portfolio = JSON.parse(readFileSync(join(ROOT, 'data/portfolio.json'), 'utf8'));
  let funds = [...new Map(portfolio.funds.map((f) => [f.code, f])).values()];
  if (ONLY_CODE) funds = funds.filter((f) => f.code === ONLY_CODE);

  console.log(`\n=== 估值校准 (近 ${DAYS} 个公布日, 含 §5.9) ===\n`);

  const fxMap = await fetchIndexHistory('133.USDCNY', 120);
  /** @type {Record<string, Map<string, number>>} */
  const proxyCache = {};
  /** @type {Record<string, object>} */
  const profiles = loadValuationProfiles();

  for (const fund of funds) {
    const history = (await fetchFundHistory(fund.code, 3)).slice(0, DAYS);
    if (history.length < 8) {
      console.log(`[${fund.code}] 历史不足，跳过`);
      continue;
    }

    const indexMap = await fetchIndexHistory(indexKeyForFund(fund.name), 120);
    const { results, pack } = await calibrateFund(fund, history, indexMap, fxMap, proxyCache);
    if (!results.length) {
      console.log(`[${fund.code}] 无有效候选`);
      continue;
    }

    const best = pickCalibratedResult(fund, results, pack);
    const reportFundCount = pack?.reportFundInvestments?.length || 0;
    profiles[fund.code] = {
      strategy: best.strategy,
      proxyCode: best.proxyCode,
      weightParams: best.weightParams,
      syntheticHoldings: cleanSyntheticForProfile(pack, best.syntheticHoldings),
      reportFundCount: reportFundCount || undefined,
      mae: Math.round(best.mae * 1000) / 1000,
      algoLabel: best.algoLabel,
      calibratedAt: beijingDateString(),
    };

    console.log(
      `${fund.code} ${fund.name}` +
        (reportFundCount ? ` [§5.9×${reportFundCount}]` : '') +
        `\n  → ${best.algoLabel} MAE ${best.mae.toFixed(3)}%` +
        (results[1] ? ` (次优 ${results[1].algoLabel} ${results[1].mae.toFixed(3)}%)` : ''),
    );
    await sleep(150);
  }

  saveValuationProfiles(profiles);
  console.log(`\n已写入 ${Object.keys(profiles).length} 支基金 → data/valuation-profiles.json\n`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
