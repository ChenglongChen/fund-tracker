import { computePortfolioTotals } from './aggregate.js';
import {
  fundEstimateProfit,
  fundEstimateImpactPct,
  liveImpactForEstimate,
} from './fund-estimate.js';
import { setBaselineForDay } from './day-display-state.js';
import { applyPortfolioTotalsSnap } from './components/snap-apply.js';

const ok = [];
const fail = [];

function assert(name, cond) {
  if (cond) ok.push(name);
  else fail.push(name);
}

const eodWindow = new Date('2026-05-27T11:00:00.000Z');
const usOpen = new Date('2026-05-26T14:00:00.000Z');

function roundProfit(amount, pct) {
  return Math.round(((amount * pct) / 100) * 100) / 100;
}

const amount = 100000;
const regularLive = 1.42;
const regularFrozen = 1.38;

const liveForEstimate = liveImpactForEstimate(
  { impactPct: 1.97, impactPctRegular: regularLive, impactPctExtended: 0.55 },
  'us',
);

assert(
  'eod estimate uses impactPct',
  fundEstimateProfit(amount, liveForEstimate, eodWindow) === roundProfit(amount, regularLive),
);
assert(
  'live regular differs from frozen display',
  roundProfit(amount, regularLive) !== roundProfit(amount, regularFrozen),
);

const usRegularLive = { market: 'us', impactPct: 2.4, impactPctRegular: 1.76, impactPctExtended: 0.64 };
assert(
  'us regular estimate uses impactPct',
  fundEstimateProfit(100000, usRegularLive, usOpen) === roundProfit(100000, 2.4),
);
assert(
  'estimateImpactPct matches profit pct on regular',
  fundEstimateImpactPct(usRegularLive, usOpen) === 2.4,
);

const portfolio = {
  funds: [
    { id: 1, amount: 100000, yesterdayProfit: 120.5, totalProfit: 8000 },
    { id: 2, amount: 100000, yesterdayProfit: 500, totalProfit: 2000 },
    { id: 3, amount: 50000, yesterdayProfit: null, totalProfit: 1000 },
  ],
};

const liveFunds = [
  {
    id: 1,
    estimateProfit: roundProfit(100000, regularLive),
    estimateAssets: 100000 + roundProfit(100000, regularLive),
    dailyPending: false,
    market: 'us',
    impactPctRegularLive: regularLive,
  },
  {
    id: 2,
    estimateProfit: 1760,
    estimateAssets: 101760,
    settledProfit: 500,
    dailyPending: false,
    market: 'us',
    impactPctRegularLive: 1.76,
  },
  {
    id: 3,
    estimateProfit: 320,
    estimateAssets: 50320,
    settledProfit: null,
    dailyPending: true,
    market: 'cn',
    impactPctRegularLive: 0.64,
  },
];

setBaselineForDay('2026-05-27', 'portfolio', 250000);
const totalsLive = computePortfolioTotals(portfolio, liveFunds, eodWindow);
const totals = applyPortfolioTotalsSnap(totalsLive, '2026-05-27', eodWindow);
const sumEp = liveFunds.reduce((s, f) => s + (f.estimateProfit ?? 0), 0);
assert('portfolio totals match sum estimateProfit', totals.realtimeProfit === Math.round(sumEp * 100) / 100);
const sumEa = liveFunds.reduce((s, f) => s + (f.estimateAssets ?? 0), 0);
assert(
  'portfolio estimate assets',
  totals.realtimeAssets === Math.round(sumEa * 100) / 100,
);

console.log(`realtime-profit-consistency tests: ${ok.length} passed, ${fail.length} failed`);
if (fail.length) {
  console.error('FAILED:', fail);
  process.exit(1);
}
