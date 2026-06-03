import {
  applyPremarketPortfolioEstimateSnap,
  clearPremarketPortfolioEstimateSnap,
  fundEstimateImpactPct,
  fundEstimateProfit,
  fundEstimatedAssets,
} from './fund-estimate.js';
import { setBaselineForDay, setScopeSnap, setCurrentPhase } from './day-display-state.js';
import { beijingIsoString } from './time.js';

const ok = [];
const fail = [];

function assert(name, cond) {
  if (cond) ok.push(name);
  else fail.push(name);
}

const eodWindow = new Date('2026-05-27T11:00:00.000Z');
const asiaMidday = new Date('2026-05-28T02:00:00.000Z');
const usOpen = new Date('2026-05-26T14:00:00.000Z');

assert(
  'eod window uses impactPct',
  fundEstimateImpactPct(
    { market: 'us', impactPct: 1.76, impactPctRegular: 1.76, impactPctExtended: 0.64 },
    eodWindow,
  ) === 1.76,
);
assert(
  'eod window profit from impactPct',
  fundEstimateProfit(100000, { market: 'us', impactPct: 1.76, impactPctRegular: 1.76, impactPctExtended: 0.64 }, eodWindow) === 1760,
);
assert(
  'us closed midday uses total impactPct',
  fundEstimateImpactPct(
    { market: 'us', impactPct: 2.4, impactPctRegular: 1.76, impactPctExtended: 0.64 },
    asiaMidday,
  ) === 2.4,
);
assert(
  'eod estimated assets = amount + RT1',
  Math.abs(
    fundEstimatedAssets(
      100000,
      1000,
      { market: 'us', impactPct: 1.16525, impactPctRegular: 1.16525 },
      false,
      eodWindow,
    ) - 101165.25,
  ) < 0.02,
);
assert(
  'us regular estimated assets = amount + RT1',
  Math.abs(
    fundEstimatedAssets(
      100000,
      1000,
      { market: 'us', impactPct: 1.16525, impactPctRegular: 1.16525 },
      false,
      usOpen,
    ) - 101165.25,
  ) < 0.02,
);
assert(
  'us regular uses impactPct only',
  fundEstimateImpactPct(
    { market: 'us', impactPct: 2.3, impactPctRegular: 1.76, impactPctExtended: 0.64 },
    usOpen,
  ) === 2.3,
);
assert(
  'cn fund unchanged',
  fundEstimateImpactPct({ market: 'cn', impactPct: -0.65 }, eodWindow) === -0.65,
);

clearPremarketPortfolioEstimateSnap();
setBaselineForDay('2026-05-27', 'portfolio', 98000);
setCurrentPhase('eod_freeze', eodWindow);
setScopeSnap('2026-05-27', 'eodSnap', 'portfolio', {
  at: beijingIsoString(eodWindow),
  rt1: 1200,
  est: 99200,
  funds: { 1: { rt1: 1200, amountAtSnap: 98000 } },
});
const snap1 = applyPremarketPortfolioEstimateSnap(
  { settledAssets: 100000, realtimeAssets: 99200, realtimeProfit: 1200 },
  eodWindow,
);
const snap2 = applyPremarketPortfolioEstimateSnap(
  { settledAssets: 100000, realtimeAssets: 101500, realtimeProfit: 1500 },
  eodWindow,
);
assert('portfolio eod snap seed assets', snap1.realtimeAssets === 99200);
assert('portfolio eod snap frozen assets', snap2.realtimeAssets === 99200);
assert('portfolio eod snap frozen profit', snap2.realtimeProfit === 1200);
clearPremarketPortfolioEstimateSnap();

console.log(`fund-estimate tests: ${ok.length} passed, ${fail.length} failed`);
if (fail.length) {
  console.error('FAILED:', fail);
  process.exit(1);
}
