import { computePortfolioTotals } from './aggregate.js';
import {
  applyFundRt1Snap,
  applyPortfolioTotalsSnap,
} from './components/snap-apply.js';
import { isScopeSnapReady } from './components/snap-ready.js';
import { reconcileDisplayState } from './components/snap-seed.js';
import {
  clearScopeSnap,
  getScopeSnap,
  loadDayDisplayState,
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

await loadDayDisplayState();

const eodWindow = new Date('2026-05-28T08:30:00.000Z');
const accrualDay = '2026-05-28';

const portfolio = {
  funds: [
    { id: 1, amount: 100000, yesterdayProfit: 100, totalProfit: 1000 },
    { id: 2, amount: 200000, yesterdayProfit: 200, totalProfit: 2000 },
  ],
};

const impacts = [
  { impactPct: 1.5, impactPctRegular: 1.5 },
  { impactPct: -0.5, impactPctRegular: -0.5 },
];

const liveFunds = [
  {
    id: 1,
    amount: 100000,
    market: 'us',
    estimateProfit: 1500,
    impactPctRegular: 1.5,
    impactSession: 'closed',
    shouldRefreshLiveRt1: false,
  },
  {
    id: 2,
    amount: 200000,
    market: 'us',
    estimateProfit: -1000,
    impactPctRegular: -0.5,
    impactSession: 'closed',
    shouldRefreshLiveRt1: false,
  },
];

setBaselineForDay(accrualDay, 'portfolio', 300000);
clearScopeSnap(accrualDay, 'eodSnap', 'portfolio');

assert('provisional empty snap not ready', !isScopeSnapReady({
  rt1: -100,
  funds: {},
  provisional: true,
}));

setScopeSnap(accrualDay, 'eodSnap', 'portfolio', {
  rt1: 500,
  est: 300500,
  funds: {
    1: { rt1: 1500, amountAtSnap: 100000, impactPctRegular: 1.5 },
    2: { rt1: -1000, amountAtSnap: 200000, impactPctRegular: -0.5 },
  },
});

const snappedRows = liveFunds.map((row) => applyFundRt1Snap(row.id, row, accrualDay, eodWindow));
const sumSnapped = snappedRows.reduce((s, r) => s + (r.estimateProfit ?? 0), 0);
assert('per-fund eod snap applied', snappedRows.every((r) => r.displaySnap));
assert('sum fund row1 equals snap rt1', Math.abs(sumSnapped - 500) < 0.02);

const totalsLive = computePortfolioTotals(portfolio, snappedRows, eodWindow);
setCurrentPhase('eod_freeze', eodWindow);
const totals = applyPortfolioTotalsSnap(totalsLive, accrualDay, eodWindow);
assert('header rt1 from live sum in eod', totals.realtimeProfit === 500);
assert('header frozen in eod snap mode', totals.liveMode === 'snap' && totals.estimateFrozen === true);

reconcileDisplayState(
  portfolio,
  liveFunds,
  computePortfolioTotals(portfolio, liveFunds, eodWindow),
  impacts,
  eodWindow,
);
const eodSnap = getScopeSnap(accrualDay, 'eodSnap', 'portfolio');
assert('eod snap exists after reconcile', eodSnap != null);

const asiaMidday = new Date('2026-05-28T02:00:00.000Z');
clearScopeSnap(accrualDay, 'eodSnap', 'portfolio');
setScopeSnap(accrualDay, 'eodSnap', 'portfolio', {
  rt1: 500,
  est: 300500,
  funds: {
    1: { rt1: 1500, amountAtSnap: 100000, impactPctRegular: 1.5 },
    2: { rt1: -1000, amountAtSnap: 200000, impactPctRegular: -0.5 },
  },
});
const liveAsia = [
  {
    id: 1,
    amount: 100000,
    market: 'us',
    estimateProfit: 2000,
    shouldRefreshLiveRt1: true,
    impactPctRegular: 2,
  },
  {
    id: 2,
    amount: 200000,
    market: 'us',
    estimateProfit: -500,
    shouldRefreshLiveRt1: false,
    impactPctRegular: -0.25,
  },
];
const mixedSnapped = liveAsia.map((row) => applyFundRt1Snap(row.id, row, accrualDay, asiaMidday));
assert('live fund keeps live rt1 during asia relay', mixedSnapped[0].estimateProfit === 2000 && !mixedSnapped[0].displaySnap);
assert('snap fund reads eod snap', mixedSnapped[1].displaySnap && mixedSnapped[1].estimateProfit === -1000);

console.log(`snap-state tests: ${ok.length} passed, ${fail.length} failed`);
if (fail.length) {
  console.error('FAILED:', fail);
  process.exit(1);
}
