/**
 * live-pipeline 为展示层唯一编排入口
 */
import { computePortfolioTotals } from './aggregate.js';
import { applyDisplaySnapAndTotals, buildDisplayFundRows } from './live-pipeline.js';
import {
  clearScopeSnap,
  loadDayDisplayState,
  setBaselineForDay,
} from './day-display-state.js';
import { reconcileDisplayState } from './components/snap-seed.js';

const ok = [];
const fail = [];

function assert(name, cond) {
  if (cond) ok.push(name);
  else fail.push(name);
}

await loadDayDisplayState();

const afterhours = new Date('2026-05-27T21:40:00.000Z');
const accrualDay = '2026-05-28';
const beijingDate = '2026-05-28';

const portfolio = {
  funds: [
    { id: 1, code: '270042', name: '广发纳斯达克100', amount: 500000, yesterdayProfit: 0, totalProfit: 10000 },
    { id: 2, code: '022364', name: '永赢科技智选', amount: 125000, yesterdayProfit: -998, totalProfit: 19000 },
  ],
};

const impacts = [
  { impactPct: 1.2, impactPctRegular: 1.2, impactPctExtended: 0.3 },
  { impactPct: null, impactPctRegular: null },
];

const liveFunds = buildDisplayFundRows(
  portfolio,
  impacts,
  [null, null],
  beijingDate,
  afterhours,
);

setBaselineForDay(accrualDay, 'portfolio', 625000);
clearScopeSnap(accrualDay, 'afterhoursSnap', 'portfolio');

const totalsPre = computePortfolioTotals(portfolio, liveFunds, afterhours);
reconcileDisplayState(portfolio, liveFunds, totalsPre, impacts, afterhours);

const { funds: snapped, totals } = applyDisplaySnapAndTotals(portfolio, liveFunds, afterhours);
const sumEp = snapped.reduce((s, r) => s + (r.estimateProfit ?? 0), 0);

assert('cn suppressed after snap', snapped[1].estimateProfit == null);
assert('us has row1', snapped[0].estimateProfit === 6000);
assert('header equals sum row1', totals.realtimeProfit === Math.round(sumEp * 100) / 100);
assert('est uses portfolio resolver', totals.realtimeAssets === Math.round((625000 + totals.realtimeProfit) * 100) / 100);
const sumEa = snapped.reduce((s, r) => s + (r.estimateAssets ?? r.amount ?? 0), 0);
assert('estimateAssetsSum matches snapped funds', totals.estimateAssetsSum === Math.round(sumEa * 100) / 100);

console.log(`live-pipeline tests: ${ok.length} passed, ${fail.length} failed`);
if (fail.length) {
  console.error('FAILED:', fail);
  process.exit(1);
}
