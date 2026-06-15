/**
 * 展示层流水线不变量：snap 后 header RT1 = Σ estimateProfit；A 股 suppress 不被 snap 覆盖
 */
import { computePortfolioTotals } from './aggregate.js';
import {
  applyFundRt1Snap,
  applyPortfolioTotalsSnap,
} from './components/snap-apply.js';
import { reconcileDisplayState } from './components/snap-seed.js';
import {
  clearScopeSnap,
  loadDayDisplayState,
  setBaselineForDay,
  setCurrentPhase,
} from './day-display-state.js';
import { finalizeLiveFundDisplayRow } from './components/suppress.js';

const ok = [];
const fail = [];

function assert(name, cond) {
  if (cond) ok.push(name);
  else fail.push(name);
}

await loadDayDisplayState();

const eodWindow = new Date('2026-05-28T08:30:00.000Z');
const accrualDay = '2026-05-28';

const portfolio = {
  funds: [
    { id: 1, amount: 500000, yesterdayProfit: 0, totalProfit: 10000 },
    { id: 2, amount: 125000, yesterdayProfit: -998, totalProfit: 19000 },
  ],
};

const impacts = [
  { impactPct: 1.2, impactPctRegular: 1.2 },
  { impactPct: null, impactPctRegular: null },
];

const liveFunds = [
  {
    id: 1,
    amount: 500000,
    market: 'us',
    estimateProfit: 6000,
    impactPctRegular: 1.2,
    impactSession: 'closed',
    shouldRefreshLiveRt1: false,
  },
  {
    id: 2,
    amount: 125000,
    market: 'cn',
    estimateProfit: null,
    impactPctRegular: null,
    impactSession: 'closed',
  },
];

setBaselineForDay(accrualDay, 'portfolio', 625000);
clearScopeSnap(accrualDay, 'eodSnap', 'portfolio');
setCurrentPhase('eod_freeze', eodWindow);

const totalsPre = computePortfolioTotals(portfolio, liveFunds, eodWindow);
reconcileDisplayState(portfolio, liveFunds, totalsPre, impacts, eodWindow);

const snapped = portfolio.funds.map((f) => {
  const row = liveFunds.find((x) => x.id === f.id);
  return finalizeLiveFundDisplayRow(
    applyFundRt1Snap(f.id, row, accrualDay, eodWindow),
    eodWindow,
  );
});

assert(
  'cn eod snap null rt1 frozen not suppressed',
  snapped[1].estimateProfit == null && snapped[1].displaySnap,
);
assert('us snapped row1', snapped[0].displaySnap && snapped[0].estimateProfit === 6000);

const totalsLive = computePortfolioTotals(portfolio, snapped, eodWindow);
const totals = applyPortfolioTotalsSnap(totalsLive, accrualDay, eodWindow);
const sumEp = snapped.reduce((s, r) => s + (r.estimateProfit ?? 0), 0);

assert('header equals sum row1', totals.realtimeProfit === Math.round(sumEp * 100) / 100);
assert('snap mode when ready', totals.liveMode === 'snap' && totals.estimateFrozen === true);

console.log(`realtime-display-pipeline tests: ${ok.length} passed, ${fail.length} failed`);
if (fail.length) {
  console.error('FAILED:', fail);
  process.exit(1);
}
