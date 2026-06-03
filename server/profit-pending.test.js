import assert from 'node:assert/strict';
import {
  DAILY_NAV_EXPECT_HOUR,
  expectedNavDateForDailyDisplay,
  isDailyProfitPending,
  isPortfolioCreditDayPending,
} from './profit-pending.js';

assert.equal(DAILY_NAV_EXPECT_HOUR, 16);

const cnPending = new Date('2026-05-27T10:30:00.000Z'); // Tue 18:30 BJ
const cnMorning = new Date('2026-05-27T06:30:00.000Z'); // Tue 14:30 BJ
const mondayMorning = new Date('2026-05-31T23:30:00.000Z'); // Mon 07:30 BJ
const mondayAfterNav = new Date('2026-06-01T08:30:00.000Z'); // Mon 16:30 BJ

assert.equal(
  expectedNavDateForDailyDisplay('2026-06-01', 'cn', mondayMorning),
  '2026-05-29',
  'cn monday am expects friday nav',
);
assert.equal(
  expectedNavDateForDailyDisplay('2026-06-01', 'cn', mondayAfterNav),
  '2026-06-01',
  'cn monday pm expects monday nav',
);
assert.equal(
  expectedNavDateForDailyDisplay('2026-05-27', 'us', cnPending),
  '2026-05-26',
  'us tuesday pm expects monday nav',
);

assert.equal(
  isDailyProfitPending(
    { lastNavDate: '2026-05-29' },
    'cn',
    { pdate: '2026-05-29' },
    '2026-06-01',
    mondayMorning,
  ),
  false,
);
assert.equal(
  isDailyProfitPending(
    { lastNavDate: '2026-05-29' },
    'cn',
    { pdate: '2026-05-29' },
    '2026-06-01',
    mondayAfterNav,
  ),
  true,
);
assert.equal(
  isDailyProfitPending(
    { lastNavDate: '2026-05-29' },
    'us',
    { pdate: '2026-05-29' },
    '2026-06-01',
    mondayAfterNav,
  ),
  false,
  'qdii monday pm still ok on friday nav',
);

const portfolio = {
  funds: [
    { shares: 100, lastNavDate: '2026-05-29', code: '022364', name: '永赢科技' },
    { shares: 50, lastNavDate: '2026-05-29', code: '012922', name: 'QDII' },
  ],
};
assert.equal(isPortfolioCreditDayPending(portfolio, '2026-06-01', mondayMorning), false);
assert.equal(isPortfolioCreditDayPending(portfolio, '2026-06-01', mondayAfterNav), true);
assert.equal(
  isPortfolioCreditDayPending(portfolio, '2026-05-31', new Date('2026-05-31T04:00:00.000Z')),
  false,
  'saturday never pending',
);

console.log('profit-pending tests: passed');
