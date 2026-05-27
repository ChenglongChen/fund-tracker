import { computePortfolioTotals } from './aggregate.js';
import {
  applyFundRt1Snap,
  applyPortfolioTotalsSnap,
} from './components/snap-apply.js';
import { isScopeSnapReady } from './components/snap-ready.js';
import { reconcileDisplayState, tryBackfillSnapFromTicks } from './components/snap-seed.js';
import {
  clearScopeSnap,
  getScopeSnap,
  loadDayDisplayState,
  setBaselineForDay,
  setScopeSnap,
} from './day-display-state.js';

const ok = [];
const fail = [];

function assert(name, cond) {
  if (cond) ok.push(name);
  else fail.push(name);
}

await loadDayDisplayState();

const afterhours = new Date('2026-05-27T21:36:00.000Z');
const premarketOpen = new Date('2026-05-28T08:01:00.000Z');
const accrualDay = '2026-05-28';

const portfolio = {
  funds: [
    { id: 1, amount: 100000, yesterdayProfit: 100, totalProfit: 1000 },
    { id: 2, amount: 200000, yesterdayProfit: 200, totalProfit: 2000 },
  ],
};

const impacts = [
  { impactPct: 1.5, impactPctRegular: 1.5, impactPctExtended: 0.2 },
  { impactPct: -0.5, impactPctRegular: -0.5, impactPctExtended: 0.1 },
];

const liveFunds = [
  {
    id: 1,
    amount: 100000,
    market: 'us',
    estimateProfit: 1500,
    impactPctRegular: 1.5,
    impactSession: 'afterhours',
  },
  {
    id: 2,
    amount: 200000,
    market: 'us',
    estimateProfit: -1000,
    impactPctRegular: -0.5,
    impactSession: 'afterhours',
  },
];

setBaselineForDay(accrualDay, 'portfolio', 300000);
clearScopeSnap(accrualDay, 'afterhoursSnap', 'portfolio');
clearScopeSnap(accrualDay, 'premarketSnap', 'portfolio');

assert('provisional empty snap not ready', !isScopeSnapReady({
  rt1: -100,
  funds: {},
  provisional: true,
}));

setScopeSnap(accrualDay, 'afterhoursSnap', 'portfolio', {
  rt1: -5355,
  est: 1,
  funds: {},
  provisional: true,
});
assert('clears bad snap and re-seeds', (() => {
  const totalsLive = computePortfolioTotals(portfolio, liveFunds, afterhours);
  reconcileDisplayState(portfolio, liveFunds, totalsLive, impacts, afterhours);
  const snap = getScopeSnap(accrualDay, 'afterhoursSnap', 'portfolio');
  return isScopeSnapReady(snap) && snap.rt1 === 500 && Object.keys(snap.funds).length === 2;
})());

const snap = getScopeSnap(accrualDay, 'afterhoursSnap', 'portfolio');
const snappedRows = liveFunds.map((row) => applyFundRt1Snap(row.id, row, accrualDay, afterhours));
const sumSnapped = snappedRows.reduce((s, r) => s + (r.estimateProfit ?? 0), 0);
assert('per-fund snap applied', snappedRows.every((r) => r.displaySnap));
assert('sum fund row1 equals snap rt1', Math.abs(sumSnapped - (snap?.rt1 ?? 0)) < 0.02);

const totalsLive = computePortfolioTotals(portfolio, snappedRows, afterhours);
const totals = applyPortfolioTotalsSnap(totalsLive, accrualDay, afterhours);
assert('header rt1 matches snap', totals.realtimeProfit === snap?.rt1);
assert('header frozen in snap mode', totals.liveMode === 'snap' && totals.estimateFrozen === true);

clearScopeSnap(accrualDay, 'premarketSnap', 'portfolio');
const backfillBeforePremarket = await tryBackfillSnapFromTicks(
  accrualDay,
  'premarketSnap',
  afterhours,
);
assert('no premarket backfill during afterhours', !backfillBeforePremarket);
assert('no premarket snap before 16:00', getScopeSnap(accrualDay, 'premarketSnap', 'portfolio') == null);

setScopeSnap(accrualDay, 'premarketSnap', 'portfolio', {
  rt1: 999,
  est: 1,
  funds: {},
  provisional: true,
});
reconcileDisplayState(
  portfolio,
  liveFunds,
  computePortfolioTotals(portfolio, liveFunds, premarketOpen),
  impacts,
  premarketOpen,
);
const preSnap = getScopeSnap(accrualDay, 'premarketSnap', 'portfolio');
assert('premarket seeds with funds at 16:01', isScopeSnapReady(preSnap) && preSnap?.rt1 === 500);

const cnAfterhours = new Date('2026-05-27T21:36:00.000Z');
const cnLiveFunds = [
  ...liveFunds,
  {
    id: 3,
    amount: 125335,
    market: 'cn',
    estimateProfit: null,
    impactPctRegular: null,
    impactSession: 'closed',
  },
];
clearScopeSnap(accrualDay, 'afterhoursSnap', 'portfolio');
setScopeSnap(accrualDay, 'afterhoursSnap', 'portfolio', {
  rt1: 500,
  est: 300500,
  funds: {
    1: { rt1: 1500, amountAtSnap: 100000, impactPctRegular: 1.5 },
    2: { rt1: -1000, amountAtSnap: 200000, impactPctRegular: -0.5 },
    3: { rt1: -823.14, amountAtSnap: 125335, impactPctRegular: -0.66 },
  },
});
reconcileDisplayState(
  {
    funds: [
      ...portfolio.funds,
      { id: 3, amount: 125335, yesterdayProfit: -998, totalProfit: 19337 },
    ],
  },
  cnLiveFunds,
  computePortfolioTotals(portfolio, cnLiveFunds, cnAfterhours),
  [...impacts, { impactPct: null, impactPctRegular: null }],
  cnAfterhours,
);
const cnRow = applyFundRt1Snap(
  3,
  cnLiveFunds[2],
  accrualDay,
  cnAfterhours,
);
assert('cn row1 suppressed during afterhours snap', cnRow.estimateProfit == null && !cnRow.displaySnap);
const refreshedSnap = getScopeSnap(accrualDay, 'afterhoursSnap', 'portfolio');
assert('cn rt1 cleared in snap reseed', (refreshedSnap?.funds?.[3]?.rt1 ?? refreshedSnap?.funds?.['3']?.rt1) == null);

console.log(`snap-state tests: ${ok.length} passed, ${fail.length} failed`);
if (fail.length) {
  console.error('FAILED:', fail);
  process.exit(1);
}
