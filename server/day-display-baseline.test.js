import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  ensureDayBaseline,
  getBaselineForDay,
  getDayDisplayStateCache,
  loadDayDisplayState,
  setBaselineForDay,
} from './day-display-state.js';

const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'ft-baseline-'));
process.env.FUND_TRACKER_DATA_DIR = tmp;
await loadDayDisplayState();

const day = '2026-06-18';
const now = new Date('2026-06-18T08:00:00.000Z'); // 16:00 BJ eod_freeze

const basePortfolio = {
  funds: [
    { id: 1, amount: 1000000 },
    { id: 2, amount: 500000 },
  ],
};

ensureDayBaseline(basePortfolio, now);
assert.equal(getBaselineForDay(day, 'portfolio'), 1500000);

const afterSettle = {
  funds: [
    { id: 1, amount: 1005000 },
    { id: 2, amount: 502000 },
  ],
};
ensureDayBaseline(afterSettle, now);
assert.equal(
  getBaselineForDay(day, 'portfolio'),
  1500000,
  'nav credit must not raise baseline during snap day',
);

const withNewFund = {
  funds: [
    { id: 1, amount: 1005000 },
    { id: 2, amount: 502000 },
    { id: 29, amount: 10100 },
  ],
};
ensureDayBaseline(withNewFund, now);
assert.equal(
  getBaselineForDay(day, 'portfolio'),
  1510100,
  'new fund amount only should bump baseline',
);

const cache = getDayDisplayStateCache();
assert.deepEqual(cache.days[day]?.scopes?.portfolio?.fundIdsAtBaseline, [1, 2, 29]);

setBaselineForDay(day, 'portfolio', 2000000);
delete cache.days[day].scopes.portfolio.fundIdsAtBaseline;
ensureDayBaseline(basePortfolio, now);
assert.equal(
  getBaselineForDay(day, 'portfolio'),
  2000000,
  'legacy baseline must not double-count existing funds',
);

console.log('day-display-baseline tests: passed');
