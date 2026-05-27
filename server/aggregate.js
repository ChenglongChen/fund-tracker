import { dayProfitPct } from './store.js';
import { fmtMd, marketChipLabel, openMarketLabels } from './market-session.js';
import {
  fundEstimateProfit,
  fundEstimatedAssets,
  liveImpactForEstimate,
} from './fund-estimate.js';
import { getBaselineForDay, getRt1AccrualDay } from './day-display-state.js';

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
export function computePortfolioTotals(portfolio, liveFunds, now = new Date()) {
  const byId = new Map(liveFunds.map((f) => [f.id, f]));
  let settledAssets = 0;
  let settledProfit = 0;
  let realtimeProfit = 0;
  let holdingProfit = 0;

  for (const f of portfolio.funds) {
    const live = byId.get(f.id);
    const amount = f.amount ?? 0;
    settledAssets += amount;
    holdingProfit += f.totalProfit ?? 0;

    if (!live?.dailyPending) {
      const sp = live?.settledProfit ?? f.yesterdayProfit ?? 0;
      if (Number.isFinite(sp)) settledProfit += sp;
    }

    const ep =
      live?.estimateProfit != null && Number.isFinite(live.estimateProfit)
        ? live.estimateProfit
        : live
          ? fundEstimateProfit(
              amount,
              {
                ...liveImpactForEstimate(live, live.market ?? 'cn'),
                impactPctRegular: live.impactPctRegularLive ?? live.impactPctRegular,
                impactPctExtended: live.impactPctExtendedLive ?? live.impactPctExtended,
              },
              now,
            )
          : null;
    if (ep != null && Number.isFinite(ep)) {
      realtimeProfit += ep;
    }
  }

  const accrualDay = getRt1AccrualDay(now);
  const baseline = getBaselineForDay(accrualDay, 'portfolio');
  const portfolioEst =
    baseline != null && Number.isFinite(realtimeProfit)
      ? round2(baseline + realtimeProfit)
      : round2(settledAssets + realtimeProfit);

  return {
    settledAssets: round2(settledAssets),
    realtimeAssets: portfolioEst,
    settledProfit: round2(settledProfit),
    realtimeProfit: round2(realtimeProfit),
    holdingProfit: round2(holdingProfit),
    settledProfitPct: dayProfitPct(settledAssets, settledProfit),
    realtimeProfitPct: settledAssets > 0 ? round4((realtimeProfit / settledAssets) * 100) : null,
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
      assetsHint: '入账资产_{t−1} + 实时收益',
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
export function enrichFundDisplayAmount(fund, live, now = new Date()) {
  const amount = fund.amount ?? 0;
  const ea =
    live?.estimateAssets != null && Number.isFinite(live.estimateAssets)
      ? live.estimateAssets
      : live
        ? fundEstimatedAssets(
            amount,
            live.settledProfit ?? fund.yesterdayProfit ?? null,
            liveImpactForEstimate(live, live.market ?? 'cn'),
            live.dailyPending ?? false,
            now,
          )
        : null;
  return {
    bookedAmount: amount,
    estAmount: ea != null ? round2(ea) : round2(amount),
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
 * @param {object[]} [liveFunds]
 * @param {object} [meta]
 * @param {Date} [now]
 */
export function buildDisplayContext(beijingDate, updatedAt, liveFunds = [], meta = {}, now = new Date()) {
  const labels = openMarketLabels(now);
  const liveText = labels.length ? `${labels.join(' / ')} 盘中` : '全市场休市';
  return {
    beijingDate,
    updatedAt,
    clockLabel: beijingDate && updatedAt ? `${beijingDate.slice(5)} ${updatedAt}` : updatedAt,
    marketChip: marketChipLabel(now),
    realtimeNote: `实时收益=盘中最新估值 · 收市沿用最近收盘 · 盘中标记仅交易时段点亮 · 当前 ${liveText}`,
    dailyNote: '当日收益=净值公布后入账更新（通常晚间）· A股/黄金=当天 · QDII=最新公布净值日',
    holdingNote: '持有收益=累计盈亏，截至各基金已入账净值日',
    tableHead: buildTableHeadLabels(liveFunds, meta, beijingDate, updatedAt),
  };
}
