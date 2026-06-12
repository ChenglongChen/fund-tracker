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
  round2,
  setBaselineForDay,
  setCurrentPhase,
  setScopeSnap,
} from './day-display-state.js';
import { rememberFundRegular, rememberIndexRegular } from './impact-snapshots.js';
import { seedSessionQuoteSnapshots } from './session-quotes.js';

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
assert(
  'header est equals sum estimateAssets',
  totals.realtimeAssets === totalsLive.estimateAssetsSum,
);
assert(
  'header rt1 est reconcile settled plus sum ep',
  totals.realtimeAssets === round2(totals.settledAssets + totals.realtimeProfit),
);
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
assert('eod reconcile seeds per-fund entries', Object.keys(eodSnap?.funds ?? {}).length === 2);

const asiaMidday = new Date('2026-05-28T02:00:00.000Z');
setCurrentPhase('asia_live', asiaMidday);
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
assert(
  'asia relay reads eod snap not live rt1',
  mixedSnapped[0].displaySnap && mixedSnapped[0].estimateProfit === 1500,
);
assert('snap fund reads eod snap', mixedSnapped[1].displaySnap && mixedSnapped[1].estimateProfit === -1000);

const amountDriftRow = { id: 1, amount: 95000, market: 'us', estimateProfit: 999 };
const amountDriftSnapped = applyFundRt1Snap(1, amountDriftRow, accrualDay, eodWindow);
assert(
  'snap est uses current amount plus frozen rt1 after settle drift',
  amountDriftSnapped.estimateProfit === 1500 &&
    amountDriftSnapped.estimateAssets === round2(95000 + 1500),
);

const settledDriftPortfolio = {
  funds: [
    { id: 1, amount: 105000, accountId: 'a' },
    { id: 2, amount: 200000, accountId: 'a' },
  ],
};
const settledDriftSnapped = snappedRows.map((row) =>
  applyFundRt1Snap(row.id, { ...row, amount: settledDriftPortfolio.funds.find((f) => f.id === row.id)?.amount ?? row.amount }, accrualDay, eodWindow),
);
const settledDriftTotalsLive = computePortfolioTotals(settledDriftPortfolio, settledDriftSnapped, eodWindow);
const settledDriftTotals = applyPortfolioTotalsSnap(settledDriftTotalsLive, accrualDay, eodWindow);
assert(
  'header est tracks settled assets after nav credit',
  settledDriftTotals.realtimeAssets === round2(settledDriftTotals.settledAssets + settledDriftTotals.realtimeProfit),
);

setScopeSnap(accrualDay, 'eodSnap', 'portfolio', {
  rt1: 52000,
  est: 300000,
  seedPhase: 'eod_freeze',
  funds: { 1: { rt1: 52000, amountAtSnap: 100000 } },
});
setCurrentPhase('eod_freeze', eodWindow);
const driftLive = [{ id: 1, amount: 100000, market: 'us', estimateProfit: 9000, impactSource: 'holdings' }];
reconcileDisplayState(
  { funds: [{ id: 1, amount: 100000 }] },
  driftLive,
  { settledAssets: 100000, realtimeProfit: 9000 },
  [],
  eodWindow,
);
const frozenSnap = getScopeSnap(accrualDay, 'eodSnap', 'portfolio');
assert(
  'eod_freeze snap not reseeded on holdings drift',
  frozenSnap?.rt1 === 52000,
);
clearScopeSnap(accrualDay, 'eodSnap', 'portfolio');

const eodEuBypass = new Date('2026-05-28T09:00:00.000Z'); // 17:00 BJ eod_freeze + EU regular
setScopeSnap(accrualDay, 'eodSnap', 'portfolio', {
  rt1: 1500,
  funds: { 1: { rt1: 1500, amountAtSnap: 100000, impactPctRegular: 1.5 } },
});
setCurrentPhase('eod_freeze', eodEuBypass);
const euLiveRow = {
  id: 1,
  amount: 100000,
  market: 'us',
  estimateProfit: 999,
  shouldRefreshLiveRt1: true,
  hasRegularHolding: true,
};
const euSnapped = applyFundRt1Snap(1, euLiveRow, accrualDay, eodEuBypass);
assert('eod freeze ignores regular bypass', euSnapped.displaySnap && euSnapped.estimateProfit === 1500);

const asiaNoSnap = new Date('2026-05-28T02:00:00.000Z');
setCurrentPhase('asia_live', asiaNoSnap);
clearScopeSnap(accrualDay, 'eodSnap', 'portfolio');
const indexRelayRow = {
  id: 3,
  name: '广发纳斯达克100',
  amount: 200000,
  market: 'us',
  estimateProfit: 960,
  impactPct: 0.48,
  impactPctRegular: null,
  impactSession: 'closed',
  shouldRefreshLiveRt1: false,
  impactSource: 'index',
};
rememberIndexRegular('纳斯达克100', { changePct: 0.46 });
seedSessionQuoteSnapshots();
rememberFundRegular(3, 0.35);
const relaySnapped = applyFundRt1Snap(3, indexRelayRow, accrualDay, asiaNoSnap);
assert(
  'asia afternoon index uses close snapshot when no eod snap',
  relaySnapped.displaySnap &&
    relaySnapped.rt1SnapSource === 'regularSnapshot' &&
    relaySnapped.estimateProfit === round2((200000 * 0.46) / 100) &&
    relaySnapped.impactPct === 0.46,
);

setScopeSnap(accrualDay, 'eodSnap', 'portfolio', {
  rt1: 700,
  est: 300700,
  seedPhase: 'asia_live',
  funds: {
    3: { rt1: 700, amountAtSnap: 200000, impactPctRegular: 0.35 },
  },
});
const indexWithStaleSnap = applyFundRt1Snap(3, indexRelayRow, accrualDay, asiaNoSnap);
assert(
  'asia afternoon index prefers index close over stale snap',
  indexWithStaleSnap.displaySnap &&
    indexWithStaleSnap.rt1SnapSource === 'regularSnapshot' &&
    indexWithStaleSnap.estimateProfit === round2((200000 * 0.46) / 100),
);

setScopeSnap(accrualDay, 'eodSnap', 'portfolio', {
  rt1: 700,
  est: 300700,
  seedPhase: 'eod_freeze',
  funds: {
    3: { rt1: 700, amountAtSnap: 200000, impactPctRegular: 0.35 },
  },
});
setCurrentPhase('eod_freeze', new Date('2026-05-28T08:30:00.000Z'));
const indexEodFreeze = applyFundRt1Snap(
  3,
  indexRelayRow,
  accrualDay,
  new Date('2026-05-28T08:30:00.000Z'),
);
assert(
  'eod freeze index fund reads portfolio eod snap',
  indexEodFreeze.displaySnap && indexEodFreeze.estimateProfit === 700,
);

setCurrentPhase('asia_live', asiaNoSnap);
const usRegularWindow = new Date('2026-05-28T13:45:00.000Z'); // BJ 21:45
setCurrentPhase('us_regular_live', usRegularWindow);
const indexLive = applyFundRt1Snap(3, indexRelayRow, accrualDay, usRegularWindow);
assert(
  'us regular window keeps style index live',
  indexLive.estimateProfit === 960 && !indexLive.displaySnap,
);

const holdingsRelayRow = {
  id: 4,
  amount: 100000,
  market: 'us',
  estimateProfit: 500,
  impactPct: 0.5,
  shouldRefreshLiveRt1: false,
  hasRegularHolding: false,
  impactSource: 'holdings',
};
rememberFundRegular(4, 0.25);
const holdingsSnapped = applyFundRt1Snap(4, holdingsRelayRow, accrualDay, asiaNoSnap);
assert(
  'asia relay holdings fund keeps computed live row',
  holdingsSnapped.estimateProfit === 500 && !holdingsSnapped.displaySnap,
);

console.log(`snap-state tests: ${ok.length} passed, ${fail.length} failed`);
if (fail.length) {
  console.error('FAILED:', fail);
  process.exit(1);
}
