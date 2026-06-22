import assert from 'node:assert/strict';
import { enrichFundRow } from './live-view-model.js';

const fund = {
  id: 1,
  amount: 500_000,
  yesterdayProfit: 8857.32,
  lastNavDate: '2026-06-17',
};

const pending = enrichFundRow(fund, {
  dailyPending: true,
  settledProfit: null,
  settledPct: null,
  settledNavDate: '2026-06-17',
});

assert.equal(pending.settledProfit, null, 'pending must not fall back to yesterdayProfit');
assert.equal(pending.settledPct, null);

const credited = enrichFundRow(fund, {
  dailyPending: false,
  settledProfit: 930.21,
  settledPct: 5.35,
  settledNavDate: '2026-06-18',
});

assert.equal(credited.settledProfit, 930.21);

const offline = enrichFundRow(fund, null);
assert.equal(offline.settledProfit, 8857.32, 'no live row keeps portfolio yesterdayProfit');

console.log('live-view-model tests: passed');
