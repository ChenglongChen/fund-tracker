import assert from 'node:assert/strict';
import {
  nextChinaTradingDay,
  lastChinaTradingDay,
  creditDayForBackfill,
  monthDateRange,
  isChinaTradingDay,
} from './profit-attribution.js';
import {
  rebuildDayAggregates,
  scopeDayTotals,
  normalizeProfitLedger,
} from './profit-ledger.js';

assert.equal(nextChinaTradingDay('2026-05-15'), '2026-05-18', 'Fri nav -> Mon credit');
assert.equal(nextChinaTradingDay('2026-05-16'), '2026-05-18', 'Sat nav -> Mon credit');
assert.equal(creditDayForBackfill('2026-05-15', { name: '纳斯达克100', code: '012922' }), '2026-05-18');
assert.equal(creditDayForBackfill('2026-05-15', { name: '永赢科技', code: '022364' }), '2026-05-15');
assert.equal(isChinaTradingDay('2026-05-15'), true);
assert.equal(isChinaTradingDay('2026-05-16'), false);
assert.equal(isChinaTradingDay('2026-05-17'), false);
assert.equal(lastChinaTradingDay('2026-05-31'), '2026-05-29', 'Sun -> Fri');
assert.equal(lastChinaTradingDay('2026-06-01'), '2026-06-01', 'Mon stays Mon');

const may = monthDateRange('2026-05');
assert.equal(may.days.length, 31);
assert.equal(may.start, '2026-05-01');

const day = rebuildDayAggregates({
  creditDay: '2026-05-29',
  funds: {
    '1': { accountId: 'alipay', code: 'A', settledProfit: 100, settledAssetsAfter: 1000 },
    '2': { accountId: 'alipay', code: 'B', settledProfit: 50, settledAssetsAfter: 2000 },
    '3': { accountId: 'other', code: 'C', settledProfit: 10, settledAssetsAfter: 500 },
  },
});
assert.equal(day.accounts.alipay.settledProfit, 150);
assert.equal(day.portfolio.settledProfit, 160);
assert.equal(scopeDayTotals('alipay', day).settledProfit, 150);
assert.equal(scopeDayTotals('all', day).settledProfit, 160);

const empty = normalizeProfitLedger(null);
assert.ok(empty.days);
assert.equal(empty.meta.schemaVersion, 1);

console.log('profit-attribution + profit-ledger tests: passed');
