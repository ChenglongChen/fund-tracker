import assert from 'node:assert/strict';
import {
  countsTowardLiveRt1,
  estimateFromHoldingsWithFx,
  maskHoldingsForLiveRt1Display,
} from './holdings-pipeline.js';

const mixed = [
  { code: 'NVDA', weight: 10, changePct: -1.0, quoteSession: 'regular', holdingMarket: 'us' },
  { code: '00700', weight: 8, changePct: -2.0, quoteSession: 'closed', holdingMarket: 'hk' },
  { code: '8035', weight: 5, changePct: 3.0, quoteSession: 'closed', holdingMarket: 'jp' },
];

assert.equal(countsTowardLiveRt1(mixed[0]), true);
assert.equal(countsTowardLiveRt1(mixed[1]), false);

const liveOnly = estimateFromHoldingsWithFx(mixed, 0, { liveRt1Only: true });
assert.equal(liveOnly, -0.1);

const all = estimateFromHoldingsWithFx(mixed, 0);
assert.ok(all < -0.1);

const masked = maskHoldingsForLiveRt1Display(mixed, true);
assert.equal(masked[0].changePct, -1.0);
assert.equal(masked[1].changePct, null);
assert.equal(masked[1].liveRt1Excluded, true);
assert.equal(masked[2].changePct, null);
assert.equal(masked[2].liveRt1Excluded, true);

const dayOpenClosed = [
  { code: 'NVDA', weight: 10, changePct: -1.0, quoteSession: 'closed', holdingMarket: 'us' },
  { code: '00700', weight: 8, changePct: -2.0, quoteSession: 'closed', holdingMarket: 'hk' },
];
assert.equal(estimateFromHoldingsWithFx(dayOpenClosed, 0, { liveRt1Only: true }), null);
assert.ok(Math.abs(estimateFromHoldingsWithFx(dayOpenClosed, 0)) > 0.2);

console.log('live-rt1-holdings.test.js OK');
