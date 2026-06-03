/**
 * 用官方日涨跌幅 (JZZZL) 回测多种估值算法准确度。
 * 运行: node scripts/backtest-valuation.js [--days=40] [--live]
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  computeFundImpact,
  fetchFundGz,
  fetchMarketStrip,
  fetchFundHoldings,
  pickIndexChangePct,
  resolveFundImpact,
  estimateWithFx,
  pickValuationStrategy,
  proxyCodeFor,
  resolveFxStripFromMarket,
} from '../server/market.js';
import { getProxyCandidates } from '../server/valuation-profile.js';
import { blendEnsembleImpact, ensembleAlpha, reportAgeDays } from '../server/qdii-valuation.js';
import { computeHoldingsImpactBreakdown } from '../server/holdings-pipeline.js';
import { beijingDateString } from '../server/time.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

const args = process.argv.slice(2);
const DAYS = parseInt(args.find((a) => a.startsWith('--days='))?.split('=')[1] || '40', 10);
const LIVE = args.includes('--live');
const ONLY_CODE = args.find((a) => a.startsWith('--code='))?.split('=')[1]?.trim();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** @param {() => Promise<T>} fn @param {number} retries */
async function withRetry(fn, retries = 3) {
  let lastErr;
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      await sleep(400 * (i + 1));
    }
  }
  throw lastErr;
}

/** @param {string} url @param {Record<string,string>} [headers] */
async function fetchJson(url, headers = {}) {
  return withRetry(async () => {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        ...headers,
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  });
}

/** @param {string} code @param {number} pages */
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
    await sleep(120);
  }
  return rows
    .filter((r) => r.FSRQ && r.JZZZL !== '' && r.JZZZL != null)
    .map((r) => ({ date: r.FSRQ, pct: parseFloat(r.JZZZL) }))
    .filter((r) => Number.isFinite(r.pct));
}

/** @param {string} secid @param {number} limit */
async function fetchIndexHistory(secid, limit = 80) {
  try {
    const url = `https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=${secid}&fields1=f1&fields2=f51,f59&klt=101&fqt=0&end=20500101&lmt=${limit}`;
    const j = await fetchJson(url, { Referer: 'https://finance.eastmoney.com/' });
    /** @type {Map<string, number>} */
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

/** 指数序列：同日期优先，否则取最近一个更早的交易日 */
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

/** @param {number[]} truth @param {number[]} pred */
function metrics(truth, pred) {
  if (!truth.length) return null;
  let se = 0;
  let ae = 0;
  let dirHit = 0;
  let dirTotal = 0;
  for (let i = 0; i < truth.length; i++) {
    const e = pred[i] - truth[i];
    se += e * e;
    ae += Math.abs(e);
    if (truth[i] !== 0 || pred[i] !== 0) {
      dirTotal++;
      if (Math.sign(truth[i]) === Math.sign(pred[i])) dirHit++;
    }
  }
  const n = truth.length;
  const meanTruth = truth.reduce((a, b) => a + b, 0) / n;
  const meanPred = pred.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let dT = 0;
  let dP = 0;
  for (let i = 0; i < n; i++) {
    num += (truth[i] - meanTruth) * (pred[i] - meanPred);
    dT += (truth[i] - meanTruth) ** 2;
    dP += (pred[i] - meanPred) ** 2;
  }
  const corr = dT > 0 && dP > 0 ? num / Math.sqrt(dT * dP) : null;
  return {
    n,
    mae: ae / n,
    rmse: Math.sqrt(se / n),
    dirAcc: dirTotal ? (dirHit / dirTotal) * 100 : null,
    corr,
  };
}

/** 联接/同类 proxy：见 server/valuation-config.js FEEDER_MAP */

/** @param {string} name */
function indexKeyForFund(name) {
  const n = String(name || '');
  if (/标普500|博时标普|标普/.test(n)) return 'spx';
  if (/纳斯达克100|纳指100|纳斯达克|纳指/.test(n)) return 'ndx';
  if (/黄金/.test(n)) return 'gold';
  if (/科技|成长|精选|全球/.test(n)) return 'ndx';
  return 'ndx';
}

/** @param {Array<{date:string,pct:number}>} history @param {Map<string,number>} proxyMap */
function alignProxy(history, proxyMap) {
  const out = [];
  for (const row of history) {
    const v = proxyMap.get(row.date);
    if (v != null && Number.isFinite(v)) out.push({ date: row.date, truth: row.pct, pred: v });
  }
  return out;
}

/** @param {Array<{date:string,pct:number}>} history @param {Map<string,number>} indexMap @param {Map<string,number>|null} fxMap @param {boolean} withFx */
function alignIndex(history, indexMap, fxMap, withFx) {
  const out = [];
  for (const row of history) {
    const idx = lookupIndex(indexMap, row.date);
    if (idx == null || !Number.isFinite(idx)) continue;
    let pred = idx;
    if (withFx && fxMap) {
      const fx = lookupIndex(fxMap, row.date) ?? 0;
      pred = idx + fx;
    }
    out.push({ date: row.date, truth: row.pct, pred });
  }
  return out;
}

/** @param {{ code: string, marketId?: number|null, fetchCode?: string }} h */
function eastmoneySecid(h) {
  if (h.marketId === 105 || h.marketId === 106) return `${h.marketId}.${h.code}`;
  if (h.marketId === 116) return `116.${h.code}`;
  const c = String(h.code || '').trim();
  if (/^[A-Z][A-Z0-9.-]*$/i.test(c)) return `105.${c.toUpperCase()}`;
  if (/^6/.test(c)) return `1.${c}`;
  if (/^[03]/.test(c)) return `0.${c}`;
  if (h.fetchCode?.startsWith('gb_')) return `105.${c.toUpperCase()}`;
  return null;
}

/** 持仓穿透历史：当前持仓权重 × 东财历史日涨跌 */
async function buildHoldingsHistorical(code, historyDates) {
  const pack = await fetchFundHoldings(code);
  if (!pack.holdings?.length) return null;

  const top = pack.holdings.slice(0, 25);
  const stockMaps = new Map();
  for (const h of top) {
    const secid = eastmoneySecid(h);
    if (!secid) continue;
    const map = await fetchIndexHistory(secid, 80);
    if (map.size) {
      stockMaps.set(holdingMergeKey(h), {
        weight: h.weight,
        map,
        holdingMarket: h.holdingMarket ?? null,
        marketId: h.marketId ?? null,
        code: h.code,
      });
    }
    await sleep(60);
  }

  if (!stockMaps.size) return null;

  const fxUsdMap = await fetchIndexHistory('133.USDCNY', 80);
  const fxHkdMap = await fetchIndexHistory('133.HKDCNY', 80);
  const out = [];
  for (const date of historyDates) {
    const pseudo = [];
    for (const row of stockMaps.values()) {
      const chg = lookupIndex(row.map, date);
      if (chg == null || !Number.isFinite(chg)) continue;
      pseudo.push({
        code: row.code,
        weight: row.weight,
        changePct: chg,
        holdingMarket: row.holdingMarket,
        marketId: row.marketId,
        quoteSession: 'regular',
      });
    }
    if (!pseudo.length) continue;
    const fxStrip = {
      usd: lookupIndex(fxUsdMap, date) ?? 0,
      hkd: lookupIndex(fxHkdMap, date) ?? (lookupIndex(fxUsdMap, date) ?? 0) * 0.85,
    };
    const bd = computeHoldingsImpactBreakdown(pseudo, fxStrip);
    if (!bd) continue;
    const used = pseudo.reduce((s, h) => s + h.weight, 0);
    out.push({
      date,
      predHoldings: bd.holdingsPct,
      predHoldingsFx: bd.totalPct,
      coverage: used,
    });
  }
  return {
    reportDate: pack.reportDate,
    usable: pack.holdings.length > 0,
    out,
  };
}

function holdingMergeKey(h) {
  const c = String(h.code).trim().replace(/\.$/, '');
  if (/^\d+$/.test(c) && c.length <= 5) return c.padStart(5, '0');
  return c.toUpperCase();
}

function fmtMetrics(m) {
  if (!m) return '—';
  return `MAE ${m.mae.toFixed(3)}% | RMSE ${m.rmse.toFixed(3)}% | 方向 ${m.dirAcc?.toFixed(0) ?? '—'}% | r ${m.corr?.toFixed(2) ?? '—'}`;
}

async function main() {
  const portfolio = JSON.parse(readFileSync(join(ROOT, 'data/portfolio.json'), 'utf8'));
  let funds = [...new Map(portfolio.funds.map((f) => [f.code, f])).values()];
  if (ONLY_CODE) funds = funds.filter((f) => f.code === ONLY_CODE);

  console.log(`\n=== 估值算法回测 (近 ${DAYS} 个公布日) ===\n`);
  console.log('真值: 东财 lsjz JZZZL (官方日涨跌幅)\n');

  const indexNdx = await fetchIndexHistory('100.NDX', 120);
  const indexSpx = await fetchIndexHistory('100.SPX', 120);
  const indexGold = await fetchIndexHistory('118.AU9999', 120);
  const fxMap = await fetchIndexHistory('133.USDCNY', 120);

  /** @type {Record<string, Map<string,number>>} */
  const proxyCache = {};

  async function getProxyHistory(proxyCode) {
    if (!proxyCache[proxyCode]) {
      const h = await fetchFundHistory(proxyCode, 3);
      proxyCache[proxyCode] = new Map(h.map((r) => [r.date, r.pct]));
    }
    return proxyCache[proxyCode];
  }

  /** @type {Record<string, { n: number, mae: number, rmse: number, dirHit: number, dirTotal: number }>} */
  const algoTotals = {};

  function addTotal(algo, aligned) {
    if (!aligned.length) return;
    if (!algoTotals[algo]) algoTotals[algo] = { n: 0, ae: 0, se: 0, dirHit: 0, dirTotal: 0 };
    const t = algoTotals[algo];
    for (const { truth, pred } of aligned) {
      t.n++;
      t.ae += Math.abs(pred - truth);
      t.se += (pred - truth) ** 2;
      if (truth !== 0 || pred !== 0) {
        t.dirTotal++;
        if (Math.sign(truth) === Math.sign(pred)) t.dirHit++;
      }
    }
  }

  for (const fund of funds) {
    const history = (await fetchFundHistory(fund.code, 3)).slice(0, DAYS);
    if (history.length < 5) {
      console.log(`[${fund.code}] ${fund.name} — 历史数据不足，跳过`);
      continue;
    }

    console.log(`\n### ${fund.code} ${fund.name}`);
    console.log(`样本 ${history.length} 日 (${history[history.length - 1].date} ~ ${history[0].date})`);

    const results = [];
    const idxKey = indexKeyForFund(fund.name);
    const indexMap = idxKey === 'spx' ? indexSpx : idxKey === 'gold' ? indexGold : indexNdx;
    const indexLabel = idxKey === 'spx' ? '指数·标普500' : idxKey === 'gold' ? '指数·黄金AU9999' : '指数·纳指100';

    const a1 = alignIndex(history, indexMap, null, false);
    if (a1.length) {
      const m = metrics(
        a1.map((x) => x.truth),
        a1.map((x) => x.pred),
      );
      results.push([indexLabel, m]);
      addTotal(indexLabel, a1);
    }

    const a2 = alignIndex(history, indexMap, fxMap, true);
    if (a2.length) {
      const label = `${indexLabel}+汇率`;
      const m = metrics(
        a2.map((x) => x.truth),
        a2.map((x) => x.pred),
      );
      results.push([label, m]);
      addTotal(label, a2);
    }

    const strategy = pickValuationStrategy(fund.code, fund.name);
    const proxyPrimary = proxyCodeFor(fund.code);
    if (proxyPrimary && proxyPrimary !== fund.code) {
      const proxyMap = await getProxyHistory(proxyPrimary);
      const aligned = alignProxy(history, proxyMap);
      if (aligned.length) {
        const label = `策略·proxy·${proxyPrimary}`;
        const m = metrics(
          aligned.map((x) => x.truth),
          aligned.map((x) => x.pred),
        );
        results.push([label, m]);
        addTotal(label, aligned);
      }
    }

    for (const proxyCode of getProxyCandidates(fund.code, fund.name)) {
      const proxyMap = await getProxyHistory(proxyCode);
      const aligned = alignProxy(history, proxyMap);
      if (!aligned.length) continue;
      const label = `联接proxy·${proxyCode}`;
      const m = metrics(
        aligned.map((x) => x.truth),
        aligned.map((x) => x.pred),
      );
      results.push([label, m]);
      addTotal(label, aligned);
    }

    const dates = history.map((h) => h.date);
    const holdHist = await buildHoldingsHistorical(fund.code, dates);
    if (holdHist?.out?.length) {
      const byDate = new Map(holdHist.out.map((r) => [r.date, r]));
      const h2 = [];
      for (const row of history) {
        const h = byDate.get(row.date);
        if (!h) continue;
        h2.push({ date: row.date, truth: row.pct, pred: h.predHoldingsFx });
      }
      const label1 = `持仓穿透+FX(报告${holdHist.reportDate || '?'})`;
      const m1 = metrics(
        h2.map((x) => x.truth),
        h2.map((x) => x.pred),
      );
      results.push([label1, m1]);
      addTotal('持仓穿透+FX', h2);
    }

    results.sort((a, b) => (a[1]?.mae ?? 999) - (b[1]?.mae ?? 999));
    for (const [name, m] of results) {
      console.log(`  ${name.padEnd(28)} ${fmtMetrics(m)}`);
    }
    if (results[0]) {
      const chosen = pickValuationStrategy(fund.code, fund.name);
      const proxy = proxyCodeFor(fund.code);
      console.log(
        `  → 最佳: ${results[0][0]} (MAE ${results[0][1].mae.toFixed(3)}%) | 已配置策略: ${chosen}${proxy ? `→${proxy}` : ''}`,
      );
    }

    await sleep(200);
  }

  console.log('\n=== 全组合汇总 (按算法) ===\n');
  const summary = Object.entries(algoTotals)
    .map(([algo, t]) => ({
      algo,
      n: t.n,
      mae: t.ae / t.n,
      rmse: Math.sqrt(t.se / t.n),
      dirAcc: t.dirTotal ? (t.dirHit / t.dirTotal) * 100 : null,
    }))
    .sort((a, b) => a.mae - b.mae);

  for (const s of summary) {
    console.log(
      `  ${s.algo.padEnd(22)} n=${String(s.n).padStart(4)}  MAE ${s.mae.toFixed(3)}%  RMSE ${s.rmse.toFixed(3)}%  方向 ${s.dirAcc?.toFixed(0) ?? '—'}%`,
    );
  }
  if (summary[0]) console.log(`\n  ★ 全样本 MAE 最低: ${summary[0].algo}`);

  if (LIVE) {
    console.log('\n=== 当日实时快照 vs 最近官方日涨跌 ===');
    console.log('(fundgz 为下一公布日预估，与「昨日官方」对比仅作参考)\n');
    const strip = await fetchMarketStrip();
    const fxStrip = resolveFxStripFromMarket(strip);
    const fxPct = fxStrip?.fxPct ?? strip.find((x) => x.label === '汇率')?.changePct ?? null;

    for (const fund of (ONLY_CODE ? funds : funds.slice(0, 8))) {
      const resolved = await resolveFundImpact(fund.code, fxStrip ?? fxPct, fund.name, strip);
      const gz = await fetchFundGz(fund.code);
      const latest = (await fetchFundHistory(fund.code, 1))[0];
      const indexPct = pickIndexChangePct(fund.name, strip);
      const indexWithFx = estimateWithFx(indexPct, fxStrip ?? fxPct);
      const age = reportAgeDays(resolved.recentReportDate ?? resolved.reportDate);
      const alpha = ensembleAlpha({
        quoteCoverage: resolved.quoteCoverage ?? 0,
        reportAgeDays: age,
        fundgzFresh: Boolean(gz?.gztime),
      });
      const manualBlend =
        resolved.holdingsImpactPct != null && gz?.gszzl != null
          ? blendEnsembleImpact(resolved.holdingsImpactPct, gz.gszzl, alpha)
          : null;

      console.log(`${fund.code} ${fund.name}`);
      console.log(`  官方 ${latest?.date} ${latest?.pct}%`);
      console.log(
        `  管线 [${resolved.impactSource}] ${resolved.impactPct?.toFixed(2) ?? '—'}% | 穿透 ${resolved.holdingsImpactPct?.toFixed(2) ?? '—'}% | fundgz ${gz?.gszzl?.toFixed(2) ?? '—'}% | 融合α ${alpha.toFixed(2)} → ${manualBlend?.toFixed(2) ?? '—'}%`,
      );
      console.log(
        `  指数 ${indexWithFx?.toFixed(2) ?? '—'}% | 置信 ${resolved.valuationConfidence ?? '—'} | 覆盖 ${resolved.quoteCoverage?.toFixed(0) ?? '—'}%`,
      );
      await sleep(150);
    }
  }

  console.log('\n说明:');
  console.log('  · 纳指/标普 QDII 用同类联接基金(006479/050025)历史往往最接近官方');
  console.log('  · fundgz 盘中估值对应「下一净值日」，不宜与「当日已公布 NAV」直接比');
  console.log('  · 345569 站点为前端穿透计算，本脚本用持仓穿透+指数+联接 proxy 近似其思路\n');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
