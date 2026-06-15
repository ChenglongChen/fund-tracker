/**
 * realtime-spec §7 全时段 × 多市场核算审计。
 * 每个北京时间检查点验证：session 门控、RT1/EST 公式、suppress、snap 不变量。
 */
import { computePortfolioTotals } from './aggregate.js';
import {
  applyFundRt1Snap,
  applyPortfolioTotalsSnap,
} from './components/snap-apply.js';
import { reconcileDisplayState } from './components/snap-seed.js';
import { shouldSuppressDomesticRealtimeDisplay } from './components/suppress.js';
import {
  clearScopeSnap,
  getScopeSnap,
  loadDayDisplayState,
  round2,
  setBaselineForDay,
  setCurrentPhase,
  setScopeSnap,
} from './day-display-state.js';
import { resolveDisplaySession } from './display-session.js';
import { applyDisplaySnapAndTotals } from './live-pipeline.js';
import { isCnMiddayBreak } from './components/market-hours.js';

const ok = [];
const fail = [];

function assert(name, cond) {
  if (cond) ok.push(name);
  else fail.push(name);
}

/** @param {Date} now */
function sessionOf(now) {
  return resolveDisplaySession(now);
}

const BASELINE = 625000;
const ACCRUAL = '2026-05-28';
const eodSnapMeta = { at: '2026-05-28T16:00:00+08:00', seedPhase: 'eod_freeze' };

const portfolio = {
  funds: [
    { id: 1, amount: 500000, accountId: 'a', name: '广发纳斯达克100', code: '270042' },
    { id: 2, amount: 125000, accountId: 'a', name: '永赢科技智选', code: '022364' },
  ],
};

const impacts = [
  { impactPct: 1.2, impactPctRegular: 1.2 },
  { impactPct: 0.8, impactPctRegular: 0.8 },
];

/** @param {string} iso */
function at(iso) {
  return new Date(iso);
}

await loadDayDisplayState();
setBaselineForDay(ACCRUAL, 'portfolio', BASELINE);

/** §7 时段门控矩阵（与 phase-transition.test.js 一致） */
const PHASE_CHECKPOINTS = [
  ['00:30 US正盘', '2026-05-28T16:30:00.000Z', 'us_regular_live', false, 'live'],
  ['03:59 US正盘尾', '2026-05-28T19:59:00.000Z', 'us_regular_live', false, 'live'],
  ['04:00 day_open', '2026-05-28T20:00:00.000Z', 'day_open', true, 'snap'],
  ['07:59 day_open', '2026-05-28T23:59:00.000Z', 'day_open', true, 'snap'],
  ['08:00 asia_live', '2026-05-29T00:00:00.000Z', 'asia_live', false, 'live'],
  ['11:45 午间休市', '2026-05-29T03:45:00.000Z', 'asia_live', false, 'live'],
  ['15:59 asia_live', '2026-05-29T07:59:00.000Z', 'asia_live', false, 'live'],
  ['16:00 eod_freeze', '2026-05-29T08:00:00.000Z', 'eod_freeze', true, 'snap'],
  ['19:00 eod_freeze', '2026-05-29T11:00:00.000Z', 'eod_freeze', true, 'snap'],
  ['21:29 eod_freeze', '2026-05-29T13:29:00.000Z', 'eod_freeze', true, 'snap'],
  ['21:30 US正盘', '2026-05-29T13:30:00.000Z', 'us_regular_live', false, 'live'],
];

for (const [label, iso, phase, snapPhase, rt1Src] of PHASE_CHECKPOINTS) {
  const now = at(iso);
  const s = sessionOf(now);
  assert(`${label} clockPhase`, s.clockPhase === phase);
  assert(`${label} isRt1SnapPhase`, s.isRt1SnapPhase === snapPhase);
  assert(`${label} rt1Source`, s.rt1Source === rt1Src);
}

assert('午间休市判定', isCnMiddayBreak(at('2026-05-29T03:45:00.000Z')));

/** suppress 窗口：A 股 21:30–09:30 */
assert(
  'CN suppress 22:00 US正盘',
  shouldSuppressDomesticRealtimeDisplay('cn', at('2026-05-29T14:00:00.000Z')),
);
assert(
  'CN not suppress 19:00 eod',
  !shouldSuppressDomesticRealtimeDisplay('cn', at('2026-05-29T11:00:00.000Z')),
);
assert(
  'CN not suppress 16:30 eod',
  !shouldSuppressDomesticRealtimeDisplay('cn', at('2026-05-28T08:30:00.000Z')),
);
assert(
  'CN suppress 08:00 pre-open',
  shouldSuppressDomesticRealtimeDisplay('cn', at('2026-05-29T00:00:00.000Z')),
);

function seedEodSnap(rt1 = 500) {
  clearScopeSnap(ACCRUAL, 'eodSnap', 'portfolio');
  setScopeSnap(ACCRUAL, 'eodSnap', 'portfolio', {
    ...eodSnapMeta,
    rt1,
    est: round2(BASELINE + rt1),
    funds: {
      1: { rt1: 1500, amountAtSnap: 500000, impactPctRegular: 1.5, market: 'us' },
      2: { rt1: -1000, amountAtSnap: 125000, impactPctRegular: -0.8, market: 'cn' },
    },
  });
}

const liveUs = {
  id: 1,
  amount: 500000,
  market: 'us',
  estimateProfit: 6000,
  impactPctRegular: 1.2,
  shouldRefreshLiveRt1: false,
  impactSource: 'index',
};
const liveCn = {
  id: 2,
  amount: 125000,
  market: 'cn',
  estimateProfit: 1000,
  impactPctRegular: 0.8,
  impactSource: 'fundgz',
};
const liveFunds = [liveUs, liveCn];

/** eod_freeze：RT1/EST 冻结；CN 15:00–21:30 可读 snap */
{
  const now = at('2026-05-28T08:30:00.000Z'); // BJ 16:30
  seedEodSnap();
  setCurrentPhase('eod_freeze', now);
  const snapped = [liveUs, liveCn].map((r) => applyFundRt1Snap(r.id, r, ACCRUAL, now));
  assert('eod US snap rt1', snapped[0].displaySnap && snapped[0].estimateProfit === 1500);
  assert('eod CN snap rt1 not suppressed', snapped[1].displaySnap && snapped[1].estimateProfit === -1000);
  const totalsLive = computePortfolioTotals(portfolio, snapped, now);
  const totals = applyPortfolioTotalsSnap(totalsLive, ACCRUAL, now);
  assert('eod header RT1 sum', totals.realtimeProfit === 500);
  assert('eod header EST baseline+RT1', totals.realtimeAssets === round2(BASELINE + 500));
  assert('eod frozen flag', totals.estimateFrozen && totals.liveMode === 'snap');
}

/** eod_freeze + 净值入账：账户资产变、EST/RT1 不变 */
{
  const now = at('2026-05-29T11:00:00.000Z'); // BJ 19:00
  seedEodSnap(500);
  setCurrentPhase('eod_freeze', now);
  const snappedPre = [liveUs, liveCn].map((r) => applyFundRt1Snap(r.id, r, ACCRUAL, now));
  const totalsPre = applyPortfolioTotalsSnap(
    computePortfolioTotals(portfolio, snappedPre, now),
    ACCRUAL,
    now,
  );
  const credited = {
    funds: [
      { ...portfolio.funds[0], amount: 510000 },
      { ...portfolio.funds[1], amount: 130000 },
    ],
  };
  const snappedPost = snappedPre.map((r) => {
    const amt = credited.funds.find((f) => f.id === r.id)?.amount ?? r.amount;
    return applyFundRt1Snap(r.id, { ...r, amount: amt }, ACCRUAL, now);
  });
  const totalsPost = applyPortfolioTotalsSnap(
    computePortfolioTotals(credited, snappedPost, now),
    ACCRUAL,
    now,
  );
  assert('settle increases settledAssets', totalsPost.settledAssets > totalsPre.settledAssets);
  assert('settle RT1 unchanged', totalsPost.realtimeProfit === totalsPre.realtimeProfit);
  assert('settle EST unchanged', totalsPost.realtimeAssets === totalsPre.realtimeAssets);
  assert(
    'settle per-fund est frozen',
    snappedPost[0].estimateAssets === round2(500000 + 1500),
  );
}

/** day_open：snap 冻结，EST = B[D]+RT1 */
{
  const now = at('2026-05-28T20:00:00.000Z'); // BJ 04:00
  seedEodSnap(800);
  setCurrentPhase('day_open', now);
  const snapped = [liveUs, liveCn].map((r) => applyFundRt1Snap(r.id, r, ACCRUAL, now));
  const totals = applyPortfolioTotalsSnap(
    computePortfolioTotals(portfolio, snapped, now),
    ACCRUAL,
    now,
  );
  assert('day_open EST baseline+RT1', totals.realtimeAssets === round2(BASELINE + totals.realtimeProfit));
  assert('day_open snap mode', totals.liveMode === 'snap');
}

/** us_regular_live：live RT1；CN suppress */
{
  const now = at('2026-05-29T13:30:00.000Z'); // BJ 21:30
  setCurrentPhase('us_regular_live', now);
  const usLive = { ...liveUs, estimateProfit: 8888, displaySnap: false, impactSource: 'holdings' };
  const cnLive = { ...liveCn, estimateProfit: 999, displaySnap: false };
  const snapped = [
    applyFundRt1Snap(1, usLive, ACCRUAL, now),
    applyFundRt1Snap(2, cnLive, ACCRUAL, now),
  ];
  assert('us regular live rt1', snapped[0].estimateProfit === 8888 && !snapped[0].displaySnap);
  assert('cn suppressed 21:30', snapped[1].estimateProfit == null);
  const totals = applyPortfolioTotalsSnap(
    computePortfolioTotals(portfolio, snapped, now),
    ACCRUAL,
    now,
  );
  assert('us regular live mode', totals.liveMode === 'live' && !totals.estimateFrozen);
  assert(
    'us regular EST sum amount+ep',
    totals.realtimeAssets === round2(625000 + 8888),
  );
}

/** asia_live：穿透 live；美指 style 读 4:00 收盘 */
{
  const now = at('2026-05-29T03:00:00.000Z'); // BJ 11:00
  clearScopeSnap(ACCRUAL, 'eodSnap', 'portfolio');
  setCurrentPhase('asia_live', now);
  const holdingsRow = {
    id: 1,
    amount: 500000,
    market: 'us',
    estimateProfit: 7500,
    impactSource: 'holdings',
    shouldRefreshLiveRt1: false,
  };
  const snapped = applyFundRt1Snap(1, holdingsRow, ACCRUAL, now);
  assert('asia holdings live bypass', snapped.estimateProfit === 7500 && !snapped.displaySnap);
  const cnSnapped = applyFundRt1Snap(2, liveCn, ACCRUAL, now);
  const totals = applyPortfolioTotalsSnap(
    computePortfolioTotals(portfolio, [snapped, cnSnapped], now),
    ACCRUAL,
    now,
  );
  assert('asia live EST sum', totals.liveMode === 'live');
  assert(
    'asia live header equals sum ep',
    totals.realtimeAssets === round2(totals.settledAssets + totals.realtimeProfit),
  );
}

/** 16:00 边界 reconcile：写入 eod_freeze snap */
{
  const now = at('2026-05-29T08:00:00.000Z');
  const accrual = sessionOf(now).accrualDay;
  setBaselineForDay(accrual, 'portfolio', BASELINE);
  clearScopeSnap(accrual, 'eodSnap', 'portfolio');
  setCurrentPhase('asia_live', now);
  reconcileDisplayState(
    portfolio,
    liveFunds,
    computePortfolioTotals(portfolio, liveFunds, now),
    impacts,
    now,
  );
  const snap = getScopeSnap(accrual, 'eodSnap', 'portfolio');
  assert('16:00 reconcile seeds snap', snap?.seedPhase === 'eod_freeze');
  assert('16:00 snap est baseline+rt1', snap?.est === round2(BASELINE + (snap?.rt1 ?? 0)));
}

/** 全 pipeline：eod 时 header RT1 = Σ ep；snap 时 Σ ea ≈ B[D]+RT1 */
{
  const now = at('2026-05-28T08:30:00.000Z');
  seedEodSnap(500);
  setCurrentPhase('eod_freeze', now);
  const { funds, totals } = applyDisplaySnapAndTotals(portfolio, liveFunds, now);
  const sumEp = funds.reduce((s, r) => s + (r.estimateProfit ?? 0), 0);
  const sumEa = funds.reduce((s, r) => s + (r.estimateAssets ?? 0), 0);
  assert('pipeline header RT1', totals.realtimeProfit === round2(sumEp));
  assert('pipeline snap EST baseline+RT1', totals.realtimeAssets === round2(BASELINE + 500));
  assert(
    'pipeline snap sumEa matches header when seeded at baseline',
    Math.abs(sumEa - totals.realtimeAssets) < 0.02,
  );
}

console.log(`timeline-audit tests: ${ok.length} passed, ${fail.length} failed`);
if (fail.length) {
  console.error('FAILED:', fail);
  process.exit(1);
}
