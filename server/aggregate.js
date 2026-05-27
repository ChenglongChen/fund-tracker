import { dayProfitPct } from './store.js';
import { fmtMd } from './market-session.js';

function maxIsoDate(set) {
  const arr = [...set].sort();
  return arr.length ? arr[arr.length - 1] : null;
}

/** @param {Set<string>} set @returns {string} */
function fmtNavBucketLabel(set) {
  const d = maxIsoDate(set);
  return d ? fmtMd(d) : '';
}

/**
 * 当日/持有列表头：按市场汇总已入账净值日（A股、黄金、QDII 可能不同日）
 * @param {object[]} liveFunds
 * @param {(f: object) => string|null|undefined} pickDate
 */
function buildNavBucketHeadLabel(liveFunds, pickDate) {
  const buckets = { cn: new Set(), us: new Set(), gold_cn: new Set() };
  for (const f of liveFunds) {
    const d = pickDate(f);
    if (!d) continue;
    const key = f.market === 'us' ? 'us' : f.market === 'gold_cn' ? 'gold_cn' : 'cn';
    buckets[key].add(d);
  }

  const cnD = fmtNavBucketLabel(buckets.cn);
  const usD = fmtNavBucketLabel(buckets.us);
  const goldD = fmtNavBucketLabel(buckets.gold_cn);

  /** @type {string[]} */
  const parts = [];
  if (cnD) parts.push(cnD);
  if (goldD && goldD !== cnD) parts.push(goldD);
  else if (goldD && !cnD) parts.push(goldD);
  if (usD && usD !== cnD && usD !== goldD) parts.push(usD);
  else if (usD && !cnD && !goldD) parts.push(usD);

  const unique = [...new Set(parts)];
  if (unique.length === 1) return unique[0];
  if (unique.length > 1) return unique.join('/');
  return '—';
}

/**
 * 三列表头时间：实时=北京时间刷新 · 当日/持有=各市场已入账净值日
 * @param {object[]} liveFunds
 * @param {object} [meta]
 * @param {string} beijingDate
 * @param {string} updatedAt
 */
export function buildTableHeadLabels(liveFunds, meta, beijingDate, updatedAt) {
  const realtime = beijingDate ? `${fmtMd(beijingDate)} ${updatedAt}` : updatedAt;

  const daily = buildNavBucketHeadLabel(
    liveFunds,
    (f) => f.settledNavDate || f.dailyAsOfDate,
  );
  let holding = buildNavBucketHeadLabel(
    liveFunds,
    (f) => f.settledNavDate || f.lastNavDate,
  );
  const dailyLabel =
    daily === '—' && meta?.snapshotDate ? fmtMd(meta.snapshotDate) : daily;
  if (holding === '—' && meta?.snapshotDate) {
    holding = fmtMd(meta.snapshotDate);
  }

  return {
    realtime: { label: realtime },
    daily: { label: dailyLabel },
    holding: { label: holding },
  };
}

/**
 * @param {{ funds: object[] }} portfolio
 * @param {object[]} liveFunds
 */
export function computePortfolioTotals(portfolio, liveFunds) {
  const byId = new Map(liveFunds.map((f) => [f.id, f]));
  let settledAssets = 0;
  let realtimeAssets = 0;
  let settledProfit = 0;
  let realtimeProfit = 0;
  let holdingProfit = 0;
  const openMarkets = new Set();

  for (const f of portfolio.funds) {
    const live = byId.get(f.id);
    const amount = f.amount ?? 0;
    settledAssets += amount;
    holdingProfit += f.totalProfit ?? 0;

    const sp = live?.settledProfit ?? f.yesterdayProfit ?? 0;
    if (Number.isFinite(sp)) settledProfit += sp;

    let rt = 0;
    if (live?.impactPct != null && Number.isFinite(live.impactPct)) {
      rt = (amount * live.impactPct) / 100;
      realtimeProfit += rt;
      if (live.realtimeActive && live.marketLabel) openMarkets.add(live.marketLabel);
    }
    realtimeAssets += amount + rt;
  }

  return {
    settledAssets: round2(settledAssets),
    realtimeAssets: round2(realtimeAssets),
    settledProfit: round2(settledProfit),
    realtimeProfit: round2(realtimeProfit),
    holdingProfit: round2(holdingProfit),
    settledProfitPct: dayProfitPct(settledAssets, settledProfit),
    realtimeProfitPct: settledAssets > 0 ? round4((realtimeProfit / settledAssets) * 100) : null,
    openMarkets: [...openMarkets],
    fundCount: portfolio.funds.length,
  };
}

/** @param {'settled'|'realtime'} mode @param {ReturnType<typeof computePortfolioTotals>} totals */
export function pickDisplayTotals(mode, totals) {
  if (mode === 'realtime') {
    return {
      mode: 'realtime',
      assets: totals.realtimeAssets,
      profit: totals.realtimeProfit,
      profitPct: totals.realtimeProfitPct,
      profitLabel: '实时收益',
      assetsLabel: '预估资产',
      assetsHint: '入账资产 + 各市场最新估值',
    };
  }
  return {
    mode: 'settled',
    assets: totals.settledAssets,
    profit: totals.settledProfit,
    profitPct: totals.settledProfitPct,
    profitLabel: '当日收益',
    assetsLabel: '账户资产',
    assetsHint: '已入账净值口径',
  };
}

/** @param {object} fund @param {object|null} live */
export function enrichFundDisplayAmount(fund, live) {
  const amount = fund.amount ?? 0;
  let estAmount = amount;
  if (live?.impactPct != null && Number.isFinite(live.impactPct)) {
    estAmount = amount + (amount * live.impactPct) / 100;
  }
  return {
    bookedAmount: amount,
    estAmount: round2(estAmount),
  };
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

function round4(n) {
  return Math.round(n * 10000) / 10000;
}

/**
 * @param {string} beijingDate
 * @param {string} updatedAt
 * @param {string[]} openMarkets
 * @param {object[]} [liveFunds]
 * @param {object} [meta]
 */
export function buildDisplayContext(beijingDate, updatedAt, openMarkets, liveFunds = [], meta = {}) {
  const liveText = openMarkets.length ? `${openMarkets.join(' / ')} 盘中` : '全市场休市';
  return {
    beijingDate,
    updatedAt,
    clockLabel: beijingDate && updatedAt ? `${beijingDate.slice(5)} ${updatedAt}` : updatedAt,
    realtimeNote: `实时收益=各市场最新估值 · 美股休市沿用收盘 · A股/黄金仅当日9:30后 · 当前 ${liveText}`,
    dailyNote: '当日列入账后更新 · A股/黄金=当天 · QDII=最新公布净值日',
    holdingNote: '持有收益=累计盈亏，截至各基金已入账净值日',
    tableHead: buildTableHeadLabels(liveFunds, meta, beijingDate, updatedAt),
  };
}
