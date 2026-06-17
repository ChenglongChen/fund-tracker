import assert from 'node:assert/strict';
import {
  applyFundMetricsLiveGate,
  isFundMetricsLive,
  metricsLiveFromInstant,
} from './fund-metrics-live.js';

const fund = { metricsLiveFrom: '2026-06-18', amount: 10100 };
const before = new Date('2026-06-18T01:00:00.000Z'); // 09:00 BJ
const after = new Date('2026-06-18T01:30:00.000Z'); // 09:30 BJ

assert.equal(metricsLiveFromInstant(fund)?.toISOString(), '2026-06-18T01:30:00.000Z');
assert.equal(isFundMetricsLive(fund, before), false);
assert.equal(isFundMetricsLive(fund, after), true);

const gated = applyFundMetricsLiveGate(
  {
    amount: 10100,
    estimateProfit: 120,
    settledProfit: 50,
    totalProfit: 50,
    dailyPending: false,
    market: 'cn',
  },
  fund,
  before,
);
assert.equal(gated.estimateProfit, null);
assert.equal(gated.settledProfit, 0);
assert.equal(gated.totalProfit, 0);
assert.equal(gated.estimateAssets, 10100);

const live = applyFundMetricsLiveGate(gated, fund, after);
assert.equal(live.estimateProfit, null);

console.log('fund-metrics-live tests: passed');
