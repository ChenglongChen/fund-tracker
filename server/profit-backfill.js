/**
 * 历史收益回填 — 东财 lsjz + creditDay 规则。
 */
import { creditDayForBackfill } from './profit-attribution.js';
import { readProfitLedger, writeProfitLedger, rebuildDayAggregates } from './profit-ledger.js';

/** @param {string} code @param {number} [pages] */
export async function fetchLsjz(code, pages = 5) {
  /** @type {Map<string, { date: string, pct: number, dwjz: number }>} */
  const byDate = new Map();
  for (let page = 1; page <= pages; page++) {
    const url = `http://api.fund.eastmoney.com/f10/lsjz?fundCode=${encodeURIComponent(code)}&pageIndex=${page}&pageSize=20&_=${Date.now()}`;
    let body;
    try {
      const res = await fetch(url, { headers: { Referer: 'http://fundf10.eastmoney.com/' } });
      if (!res.ok) break;
      body = await res.json();
    } catch {
      break;
    }
    const list = body?.Data?.LSJZList;
    if (!Array.isArray(list) || !list.length) break;
    for (const item of list) {
      if (!item?.FSRQ || item.JZZZL === '' || item.JZZZL == null) continue;
      const pct = parseFloat(item.JZZZL);
      const dwjz = parseFloat(item.DWJZ);
      if (!Number.isFinite(pct) || !Number.isFinite(dwjz)) continue;
      byDate.set(item.FSRQ, { date: item.FSRQ, pct, dwjz });
    }
    await sleep(100);
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * @param {object} fund
 * @param {{ date: string, pct: number, dwjz: number }[]} hist
 */
function profitStepsFromHist(fund, hist) {
  const shares = fund.shares;
  if (!shares || !Number.isFinite(shares) || shares <= 0 || hist.length < 2) return [];
  /** @type {{ navDate: string, profit: number, settledAssetsAfter: number }[]} */
  const out = [];
  for (let i = 1; i < hist.length; i++) {
    const h = hist[i];
    const prev = hist[i - 1];
    const profit = shares * prev.dwjz * (h.pct / 100);
    out.push({
      navDate: h.date,
      profit: Math.round(profit * 100) / 100,
      settledAssetsAfter: Math.round(shares * h.dwjz * 100) / 100,
    });
  }
  return out;
}

/**
 * @param {{ funds: object[] }} portfolio
 * @param {{ from: string, to: string, accountId?: string|null }} opts
 */
export async function backfillProfitLedger(portfolio, opts) {
  const { from, to, accountId = null, pages = 12 } = opts;
  let funds = portfolio.funds ?? [];
  if (accountId) funds = funds.filter((f) => f.accountId === accountId);

  /** @type {Record<string, Record<string, object>>} */
  const byCreditDay = {};

  for (const fund of funds) {
    const hist = await fetchLsjz(fund.code, pages);
    const steps = profitStepsFromHist(fund, hist.filter((h) => h.date <= to));
    for (const step of steps) {
      const creditDay = creditDayForBackfill(step.navDate, fund);
      if (creditDay < from || creditDay > to) continue;
      if (!byCreditDay[creditDay]) byCreditDay[creditDay] = {};
      const id = String(fund.id);
      const bucket = byCreditDay[creditDay];
      if (!bucket[id]) {
        bucket[id] = {
          fundId: fund.id,
          accountId: fund.accountId,
          code: fund.code,
          navDate: step.navDate,
          settledProfit: 0,
          settledAssetsAfter: step.settledAssetsAfter,
        };
      }
      bucket[id].settledProfit += step.profit;
      bucket[id].settledAssetsAfter = step.settledAssetsAfter;
      bucket[id].settledProfit = Math.round(bucket[id].settledProfit * 100) / 100;
    }
    await sleep(100);
  }

  const ledger = await readProfitLedger();

  for (const [creditDay, fundMap] of Object.entries(byCreditDay)) {
    /** @type {Record<string, object>} */
    const fundsObj = { ...(ledger.days[creditDay]?.funds ?? {}) };
    for (const [id, entry] of Object.entries(fundMap)) {
      fundsObj[id] = {
        accountId: entry.accountId,
        code: entry.code,
        navDate: entry.navDate,
        settledProfit: entry.settledProfit,
        settledAssetsAfter: entry.settledAssetsAfter,
      };
    }
    ledger.days[creditDay] = rebuildDayAggregates({
      creditDay,
      funds: fundsObj,
      source: ledger.days[creditDay]?.source ?? 'backfill',
      updatedAt: new Date().toISOString(),
    });
  }

  ledger.meta = {
    ...ledger.meta,
    lastBackfillAt: new Date().toISOString(),
    backfillThrough: to,
  };
  await writeProfitLedger(ledger);

  return { daysWritten: Object.keys(byCreditDay).length, creditDays: Object.keys(byCreditDay).sort() };
}

/**
 * @param {string} scope
 * @param {string} month YYYY-MM
 * @param {Record<string, number>} reference day -> profit
 */
export async function diffAgainstReference(scope, month, reference) {
  const { buildProfitCalendar } = await import('./profit-calendar.js');
  const cal = await buildProfitCalendar({ scope, month });
  /** @type {object[]} */
  const diffs = [];
  for (const [day, ref] of Object.entries(reference)) {
    if (!day.startsWith(month)) continue;
    const row = cal.days.find((d) => d.date === day);
    const est = row?.profit ?? 0;
    diffs.push({ day, reference: ref, estimate: est, diff: est - ref });
  }
  return diffs;
}
