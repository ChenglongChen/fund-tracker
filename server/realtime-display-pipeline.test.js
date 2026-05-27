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
} from './day-display-state.js';
import { finalizeLiveFundDisplayRow } from './components/suppress.js';

const ok = [];
const fail = [];

function assert(name, cond) {
  if (cond) ok.push(name);
  else fail.push(name);
}

await loadDayDisplayState();

const afterhours = new Date('2026-05-27T21:40:00.000Z');
const accrualDay = '2026-05-28';

const portfolio = {
  funds: [
    { id: 1, amount: 500000, yesterdayProfit: 0, totalProfit: 10000 },
    { id: 2, amount: 125000, yesterdayProfit: -998, totalProfit: 19000 },
  ],
};

const impacts = [
  { impactPct: 1.2, impactPctRegular: 1.2, impactPctExtended: 0.3 },
  { impactPct: null, impactPctRegular: null },
];

const liveFunds = [
  {
    id: 1,
    amount: 500000,
    market: 'us',
    estimateProfit: 6000,
    impactPctRegular: 1.2,
    impactSession: 'afterhours',
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
clearScopeSnap(accrualDay, 'afterhoursSnap', 'portfolio');

const totalsPre = computePortfolioTotals(portfolio, liveFunds, afterhours);
reconcileDisplayState(portfolio, liveFunds, totalsPre, impacts, afterhours);

const snapped = portfolio.funds.map((f) => {
  const row = liveFunds.find((x) => x.id === f.id);
  return finalizeLiveFundDisplayRow(
    applyFundRt1Snap(f.id, row, accrualDay, afterhours),
    afterhours,
  );
});

assert('cn suppressed after snap', snapped[1].estimateProfit == null && !snapped[1].displaySnap);
assert('us snapped row1', snapped[0].displaySnap && snapped[0].estimateProfit === 6000);

const totalsLive = computePortfolioTotals(portfolio, snapped, afterhours);
const totals = applyPortfolioTotalsSnap(totalsLive, accrualDay, afterhours);
const sumEp = snapped.reduce((s, r) => s + (r.estimateProfit ?? 0), 0);

assert('header equals sum row1', totals.realtimeProfit === Math.round(sumEp * 100) / 100);
assert('snap mode when ready', totals.liveMode === 'snap' && totals.estimateFrozen === true);

console.log(`realtime-display-pipeline tests: ${ok.length} passed, ${fail.length} failed`);
if (fail.length) {
  console.error('FAILED:', fail);
  process.exit(1);
}
