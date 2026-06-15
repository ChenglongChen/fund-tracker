/**
 * 各基金类型 × 时段：持仓 quoteSession/quoteMode 与 fund row 展示字段互证。
 */
import { applyFundRt1Snap, applyPortfolioTotalsSnap } from './components/snap-apply.js';
import { buildDisplayFundRow } from './fund-display.js';
import { finalizeLiveFundDisplayRow } from './components/suppress.js';
import {
  countsTowardLiveRt1,
  maskHoldingsForLiveRt1Display,
} from './holdings-pipeline.js';
import {
  deriveImpactSessionFromHoldings,
  fundHasRegularHolding,
} from './market.js';
import { fundShouldRefreshLiveRt1 } from './fund-regular-eligibility.js';
import { applySessionQuotes } from './session-quotes.js';
import { holdingStatusLabel } from '../src/components/session.js';
import {
  clearScopeSnap,
  loadDayDisplayState,
  round2,
  setBaselineForDay,
  setCurrentPhase,
  setScopeSnap,
} from './day-display-state.js';

const ok = [];
const fail = [];

function assert(name, cond) {
  if (cond) ok.push(name);
  else fail.push(name);
}

/** @param {string} iso */
function at(iso) {
  return new Date(iso);
}

await loadDayDisplayState();

const ACCRUAL = '2026-05-28';
const BASELINE = 625000;
const eodMeta = { at: '2026-05-28T16:00:00+08:00', seedPhase: 'eod_freeze' };

function seedSnap(rt1 = 500) {
  clearScopeSnap(ACCRUAL, 'eodSnap', 'portfolio');
  setScopeSnap(ACCRUAL, 'eodSnap', 'portfolio', {
    ...eodMeta,
    rt1,
    est: round2(BASELINE + rt1),
    funds: {
      1: { rt1: 1500, amountAtSnap: 500000, market: 'us' },
      2: { rt1: -1000, amountAtSnap: 125000, market: 'cn' },
      3: { rt1: 700, amountAtSnap: 200000, market: 'us' },
    },
  });
}

setBaselineForDay(ACCRUAL, 'portfolio', BASELINE);
seedSnap();

/** --- 持仓层：applySessionQuotes × 市场 × 时刻 --- */
{
  const krOpen = at('2026-05-26T01:00:00.000Z');
  const kr = applySessionQuotes(
    [{ code: '005930', name: '三星电子' }],
    { '005930\0三星电子': { changePct: 2.5, price: 100, quoteSource: 'eastmoney' } },
    krOpen,
  )[0];
  assert('kr open live', kr.quoteSession === 'regular' && kr.quoteMode === 'live');
  assert('kr status 盘中', holdingStatusLabel(kr) === '盘中');
}

{
  const cnMid = at('2026-05-28T04:00:00.000Z');
  const cn = applySessionQuotes(
    [{ code: '600519', name: '贵州茅台' }],
    { '600519\0贵州茅台': { changePct: 1.2, price: 100, quoteSource: 'sina' } },
    cnMid,
  )[0];
  assert('cn midday session', cn.quoteSession === 'midday' && cn.quoteMode === 'close');
  assert('cn midday label', holdingStatusLabel(cn) === '午间休市');
}

{
  const usMid = at('2026-05-28T02:52:00.000Z');
  const us = applySessionQuotes(
    [{ code: 'NVDA', name: '英伟达', marketId: 105 }],
    { 'NVDA\0英伟达': { changePct: -1, price: 100, quoteSource: 'sina' } },
    usMid,
  )[0];
  assert('us asia afternoon close', us.quoteSession === 'closed' && us.quoteMode === 'close');
  assert('us close label', holdingStatusLabel(us) === '已收盘');
}

{
  const hkLive = at('2026-05-28T07:30:00.000Z');
  const zhipu = applySessionQuotes(
    [{ code: '02513', name: '智谱', marketId: 116 }],
    { '02513\0智谱': { changePct: 34.18, price: 1472, quoteSource: 'sina' } },
    hkLive,
  )[0];
  assert('hk regular live', zhipu.quoteSession === 'regular' && zhipu.quoteMode === 'live');
  assert('hk live counts rt1', countsTowardLiveRt1(zhipu));
}

{
  const hkMid = at('2026-05-28T04:30:00.000Z'); // BJ 12:30 港股午间
  const hk = applySessionQuotes(
    [{ code: '00700', name: '腾讯', marketId: 116 }],
    { '00700\0腾讯': { changePct: 0.5, price: 400, quoteSource: 'sina' } },
    hkMid,
  )[0];
  assert('hk midday session', hk.quoteSession === 'midday' && hk.quoteMode === 'close');
  assert('hk midday label', holdingStatusLabel(hk) === '午间休市');
}

{
  const maskedRow = {
    code: '8035',
    quoteSession: 'closed',
    quoteMode: 'close',
    changePct: null,
    liveRt1Excluded: true,
  };
  assert('liveRt1Excluded label dash', holdingStatusLabel(maskedRow) === '—');
}

/** --- 穿透层：liveRt1Only vs 全穿透 --- */
{
  const usRegular = at('2026-05-27T14:00:00.000Z'); // BJ 22:00 美股正盘
  const mix = [
    { code: 'NVDA', weight: 40, changePct: 3.29, quoteSession: 'regular', quoteMode: 'live', holdingMarket: 'us' },
    {
      code: '00700',
      weight: 40,
      changePct: -2,
      quoteSession: 'closed',
      quoteMode: 'close',
      holdingMarket: 'hk',
    },
    { code: '8035', weight: 5, changePct: 3, quoteSession: 'closed', holdingMarket: 'jp' },
  ];
  assert('has regular when us open', fundHasRegularHolding(mix, usRegular));
  assert('impact session regular', deriveImpactSessionFromHoldings(mix, usRegular) === 'regular');
  const masked = maskHoldingsForLiveRt1Display(mix, true, usRegular);
  assert('us regular keeps us live', masked[0].changePct === 3.29);
  assert('hk close snapshot visible', masked[1].changePct === -2 && masked[1].liveRt1Excluded === undefined);
  assert('jp closed no snapshot masked', masked[2].changePct == null && masked[2].liveRt1Excluded === true);
}

/** --- 基金层：类型 × phase → row 字段 --- */
const fundUsHoldings = { code: '270023', name: '广发全球精选' };
const fundUsIndex = { code: '270042', name: '广发纳斯达克100' };
const fundCn = { code: '022364', name: '永赢科技智选' };

{
  const now = at('2026-06-12T00:35:00.000Z'); // BJ 08:35 韩股正盘
  const packKr = {
    holdings: [{ code: '005930', name: '三星', holdingMarket: 'kr' }],
  };
  assert(
    'asia kr open shouldRefreshLive',
    fundShouldRefreshLiveRt1(fundUsHoldings, packKr, 'holdings', now),
  );
  const liveRow = {
    id: 1,
    amount: 500000,
    market: 'us',
    estimateProfit: 7500,
    impactSource: 'holdings',
    impactSession: 'regular',
    hasRegularHolding: true,
    shouldRefreshLiveRt1: true,
  };
  const snapped = applyFundRt1Snap(1, liveRow, ACCRUAL, now);
  assert('asia holdings live ep', snapped.estimateProfit === 7500 && !snapped.displaySnap);
}

{
  const now = at('2026-05-29T08:00:00.000Z'); // eod 16:00
  setCurrentPhase('eod_freeze', now);
  const liveRow = {
    id: 1,
    amount: 510000,
    market: 'us',
    estimateProfit: 9999,
    impactSource: 'holdings',
    impactSession: 'regular',
    shouldRefreshLiveRt1: true,
  };
  const snapped = applyFundRt1Snap(1, liveRow, ACCRUAL, now);
  assert('eod holdings snap rt1', snapped.displaySnap && snapped.estimateProfit === 1500);
  assert('eod holdings est frozen', snapped.estimateAssets === round2(500000 + 1500));
  assert(
    'eod est ignores post-settle amount',
    applyFundRt1Snap(1, { ...liveRow, amount: 520000 }, ACCRUAL, now).estimateAssets ===
      round2(500000 + 1500),
  );
}

{
  const now = at('2026-05-29T08:00:00.000Z'); // eod 16:00
  setCurrentPhase('eod_freeze', now);
  const header = applyPortfolioTotalsSnap(
    {
      settledAssets: 630000,
      realtimeProfit: 500,
      estimateAssetsSum: 630500,
    },
    ACCRUAL,
    now,
  );
  assert('header snap B+RT1', header.realtimeAssets === round2(BASELINE + 500));
  assert('header estimateFrozen', header.estimateFrozen === true && header.liveMode === 'snap');
}

{
  const weekend = at('2026-05-30T02:00:00.000Z'); // 周六 10:00 BJ
  const goldRow = finalizeLiveFundDisplayRow(
    {
      market: 'gold_cn',
      amount: 50000,
      estimateProfit: 120,
      estimateAssets: 50120,
      impactPct: 0.24,
    },
    weekend,
  );
  assert('gold_cn weekend suppress ep', goldRow.estimateProfit == null);
  assert('gold_cn weekend est amount only', goldRow.estimateAssets === 50000);
}

{
  const now = at('2026-05-29T13:30:00.000Z'); // us regular 21:30
  const cnRow = buildDisplayFundRow(
    { id: 2, code: '022364', name: '永赢', amount: 125000, yesterdayProfit: 100 },
    { impactPct: 0.8, impactPctRegular: 0.8, impactSession: 'closed', impactSource: 'fundgz' },
    null,
    ACCRUAL,
    now,
  );
  const cnSnapped = applyFundRt1Snap(2, cnRow, ACCRUAL, now);
  assert('cn suppress 21:30 ep null', cnSnapped.estimateProfit == null);
  assert('cn suppress est amount only', cnSnapped.estimateAssets === 125000);
}

{
  const now = at('2026-05-28T08:30:00.000Z'); // eod 16:30 cn not suppress
  const cnRow = buildDisplayFundRow(
    { id: 2, code: '022364', name: '永赢', amount: 125000 },
    { impactPct: 0.8, impactPctRegular: 0.8, impactSession: 'closed', impactSource: 'fundgz' },
    null,
    ACCRUAL,
    now,
  );
  const cnSnapped = applyFundRt1Snap(2, cnRow, ACCRUAL, now);
  assert('eod cn not suppress snap', cnSnapped.displaySnap && cnSnapped.estimateProfit === -1000);
}

{
  const now = at('2026-05-29T00:00:00.000Z'); // asia index style
  const indexLive = {
    id: 3,
    amount: 200000,
    market: 'us',
    estimateProfit: 960,
    impactSource: 'index',
    impactSession: 'closed',
    shouldRefreshLiveRt1: false,
  };
  const snapped = applyFundRt1Snap(3, indexLive, ACCRUAL, now);
  assert('asia index reads snap not live 960', snapped.displaySnap && snapped.estimateProfit === 700);
}

{
  const now = at('2026-05-29T13:30:00.000Z'); // us regular index live
  const indexLive = {
    id: 3,
    amount: 200000,
    market: 'us',
    estimateProfit: 960,
    impactSource: 'index',
    impactSession: 'regular',
    shouldRefreshLiveRt1: false,
  };
  const snapped = applyFundRt1Snap(3, indexLive, ACCRUAL, now);
  assert('us regular index live ep', snapped.estimateProfit === 960 && !snapped.displaySnap);
}

{
  const now = at('2026-05-28T20:00:00.000Z'); // day_open 04:00
  setCurrentPhase('day_open', now);
  const indexLive = { id: 3, amount: 200000, market: 'us', estimateProfit: 960, impactSource: 'index' };
  const snapped = applyFundRt1Snap(3, indexLive, ACCRUAL, now);
  assert('day_open index snap', snapped.displaySnap && snapped.estimateProfit === 700);
}

console.log(`fund-holding-fields tests: ${ok.length} passed, ${fail.length} failed`);
if (fail.length) {
  console.error('FAILED:', fail);
  process.exit(1);
}
