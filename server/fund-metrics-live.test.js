import assert from 'node:assert/strict';
import {
  applyFundMetricsLiveGate,
  isFundAccrualMetricsLive,
  isFundMetricsLive,
  isFundSettleNavEligible,
  metricsLiveFromInstant,
} from './fund-metrics-live.js';

const fund = { metricsLiveFrom: '2026-06-18', amount: 10100, lastNavDate: '2026-06-16' };
const before = new Date('2026-06-18T01:00:00.000Z'); // 09:00 BJ
const after = new Date('2026-06-18T01:30:00.000Z'); // 09:30 BJ
const midday = new Date('2026-06-18T04:30:00.000Z'); // 12:30 BJ

assert.equal(metricsLiveFromInstant(fund)?.toISOString(), '2026-06-18T01:30:00.000Z');
assert.equal(isFundMetricsLive(fund, before), false);
assert.equal(isFundMetricsLive(fund, after), true);
assert.equal(isFundAccrualMetricsLive(fund), false);
assert.equal(isFundAccrualMetricsLive({ ...fund, lastNavDate: '2026-06-18' }), true);
assert.equal(isFundSettleNavEligible(fund, '2026-06-17'), false);
assert.equal(isFundSettleNavEligible(fund, '2026-06-18'), true);

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

const rt1Only = applyFundMetricsLiveGate(
  {
    amount: 10100,
    estimateProfit: 233.87,
    settledProfit: 288.85,
    totalProfit: 288.43,
    dailyPending: false,
    market: 'cn',
  },
  fund,
  midday,
);
assert.equal(rt1Only.estimateProfit, 233.87);
assert.equal(rt1Only.settledProfit, 0);
assert.equal(rt1Only.totalProfit, 0);
assert.equal(rt1Only.estimateAssets, 10333.87);

console.log('fund-metrics-live tests: passed');
