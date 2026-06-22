import assert from 'node:assert/strict';
import { enrichFundSettled, resolveDisplayedSettledFields } from './nav.js';
import { isDailyProfitPending } from './profit-pending.js';

const after16 = new Date('2026-06-22T12:00:00.000Z'); // 20:00 BJ Mon
const before16 = new Date('2026-06-22T06:00:00.000Z'); // 14:00 BJ Mon

assert.equal(
  isDailyProfitPending({ lastNavDate: '2026-06-18' }, 'us', { pdate: '2026-06-18' }, '2026-06-22', after16),
  false,
  'qdii credited 6/18 not pending after holiday monday 16:00',
);

assert.equal(
  isDailyProfitPending({ lastNavDate: '2026-06-17' }, 'us', { pdate: '2026-06-17' }, '2026-06-22', after16),
  true,
  'qdii still on 6/17 pending after 16:00 when expecting 6/18',
);

assert.equal(
  isDailyProfitPending({ lastNavDate: '2026-06-17' }, 'cn', { pdate: '2026-06-17' }, '2026-06-22', before16),
  false,
  'cn before 16:00 keeps showing last credited day',
);

const credited = resolveDisplayedSettledFields(
  { amount: 18317.41, yesterdayProfit: 930.21, lastNavDate: '2026-06-18' },
  enrichFundSettled(
    { amount: 18317.41, yesterdayProfit: 930.21, lastNavDate: '2026-06-18' },
    { pdate: '2026-06-18', navChgRt: 5.35 },
  ),
  { pdate: '2026-06-18', navChgRt: 5.35 },
  false,
  after16,
);
assert.ok(Math.abs(credited.settledProfit - 930.21) < 0.02);

const staleQdii = resolveDisplayedSettledFields(
  { amount: 500_000, yesterdayProfit: 8857.32, lastNavDate: '2026-06-17' },
  enrichFundSettled({ amount: 500_000, yesterdayProfit: 8857.32, lastNavDate: '2026-06-17' }, null),
  { pdate: '2026-06-17' },
  true,
  after16,
);
assert.equal(staleQdii.settledProfit, null, 'after 16:00 pending qdii shows dash not 6/17');

const morningQdii = resolveDisplayedSettledFields(
  { amount: 500_000, yesterdayProfit: 8857.32, lastNavDate: '2026-06-17' },
  enrichFundSettled({ amount: 500_000, yesterdayProfit: 8857.32, lastNavDate: '2026-06-17' }, null),
  { pdate: '2026-06-17' },
  false,
  before16,
);
assert.equal(morningQdii.settledProfit, 8857.32, 'before 16:00 shows last credited profit');

console.log('nav-display tests: passed');
