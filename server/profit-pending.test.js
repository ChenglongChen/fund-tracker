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

const wed2am = new Date('2026-06-16T18:00:00.000Z'); // Wed 02:00 BJ
assert.equal(
  isDailyProfitPending(
    { lastNavDate: '2026-06-16' },
    'cn',
    { pdate: '2026-06-17' },
    '2026-06-17',
    wed2am,
  ),
  false,
  'cn 00:00-16:00 keeps yesterday profit when eastmoney pdate rolls',
);
assert.equal(
  isDailyProfitPending(
    { lastNavDate: '2026-06-15' },
    'us',
    { pdate: '2026-06-16' },
    '2026-06-17',
    wed2am,
  ),
  false,
  'qdii 00:00-16:00 keeps credited profit when official pdate ahead',
);
assert.equal(
  isDailyProfitPending(
    { lastNavDate: '2026-06-16' },
    'cn',
    { pdate: '2026-06-17' },
    '2026-06-17',
    new Date('2026-06-17T08:30:00.000Z'),
  ),
  true,
  'cn after 16:00 pending when official ahead and not credited',
);

assert.equal(
  isDailyProfitPending(
    { lastNavDate: '2026-06-17' },
    'cn',
    { pdate: '2026-06-17' },
    '2026-06-22',
    new Date('2026-06-22T06:00:00.000Z'),
  ),
  false,
  'cn before 16:00 not pending for last credited nav',
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
