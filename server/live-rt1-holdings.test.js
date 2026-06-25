import assert from 'node:assert/strict';
import {
  countsTowardLiveRt1,
  estimateFromHoldingsWithFx,
  maskHoldingsForLiveRt1Display,
  shouldMaskHoldingForLiveRt1Display,
} from './holdings-pipeline.js';

const mixed = [
  { code: 'NVDA', weight: 10, changePct: -1.0, quoteSession: 'regular', holdingMarket: 'us' },
  { code: '00700', weight: 8, changePct: -2.0, quoteSession: 'closed', holdingMarket: 'hk' },
  { code: '8035', weight: 5, changePct: 3.0, quoteSession: 'closed', holdingMarket: 'jp' },
];

assert.equal(countsTowardLiveRt1(mixed[0]), true);
assert.equal(countsTowardLiveRt1(mixed[1]), false);

const liveOnly = estimateFromHoldingsWithFx(mixed, 0, { liveRt1Only: true });
assert.ok(Math.abs(liveOnly - -0.1) < 1e-9);

const all = estimateFromHoldingsWithFx(mixed, 0);
assert.ok(all < -0.1);

const usRegular = new Date('2026-05-27T22:00:00.000Z');
const masked = maskHoldingsForLiveRt1Display(mixed, true, usRegular);
assert.equal(masked[0].changePct, -1.0);
assert.equal(masked[1].changePct, null);
assert.equal(masked[1].liveRt1Excluded, true);
assert.equal(masked[2].changePct, null);
assert.equal(masked[2].liveRt1Excluded, true);

const hkLiveCnClosed = new Date('2026-05-28T07:30:00.000Z');
const cnClosedRow = {
  code: '600519',
  name: '贵州茅台',
  weight: 2,
  changePct: 1.2,
  quoteSession: 'closed',
  quoteMode: 'close',
  holdingMarket: 'cn',
};
const hkLiveRow = {
  code: '00700',
  name: '腾讯控股',
  weight: 3,
  changePct: -0.5,
  quoteSession: 'regular',
  quoteMode: 'live',
  holdingMarket: 'hk',
  marketId: 116,
};
assert.equal(
  shouldMaskHoldingForLiveRt1Display(cnClosedRow, true, hkLiveCnClosed),
  false,
  'cn close visible when hk regular',
);
const maskedCn = maskHoldingsForLiveRt1Display([hkLiveRow, cnClosedRow], true, hkLiveCnClosed);
assert.equal(maskedCn[1].changePct, 1.2);
assert.equal(maskedCn[1].liveRt1Excluded, undefined);
assert.equal(maskedCn[0].changePct, -0.5);

const euAfternoon = new Date('2026-06-02T09:00:00.000Z');
const usCloseEuLive = [
  {
    code: 'AAPL',
    weight: 4,
    changePct: 0.31,
    quoteSession: 'closed',
    quoteMode: 'close',
    holdingMarket: 'us',
  },
  {
    code: 'AIRFP',
    weight: 0.1,
    changePct: 4.92,
    quoteSession: 'regular',
    quoteMode: 'live',
    holdingMarket: 'eu',
  },
];
const maskedUsClose = maskHoldingsForLiveRt1Display(usCloseEuLive, true, euAfternoon);
assert.equal(
  maskedUsClose[0].changePct,
  0.31,
  'us close visible when eu regular',
);
assert.equal(maskedUsClose[0].liveRt1Excluded, undefined);
assert.equal(maskedUsClose[1].changePct, 4.92);

const dayOpenClosed = [
  { code: 'NVDA', weight: 10, changePct: -1.0, quoteSession: 'closed', holdingMarket: 'us' },
  { code: '00700', weight: 8, changePct: -2.0, quoteSession: 'closed', holdingMarket: 'hk' },
];
assert.equal(estimateFromHoldingsWithFx(dayOpenClosed, 0, { liveRt1Only: true }), null);
assert.ok(Math.abs(estimateFromHoldingsWithFx(dayOpenClosed, 0)) > 0.2);

const asiaKrOpen = new Date('2026-06-12T00:35:00.000Z'); // BJ 08:35
const usCloseKrLive = [
  {
    code: 'NVDA',
    weight: 40,
    changePct: 3.29,
    quoteSession: 'closed',
    quoteMode: 'close',
    holdingMarket: 'us',
  },
  {
    code: '000660',
    weight: 5,
    changePct: 8.2,
    quoteSession: 'regular',
    quoteMode: 'live',
    holdingMarket: 'kr',
  },
];
const asiaBlend = estimateFromHoldingsWithFx(usCloseKrLive, 0);
assert.ok(
  asiaBlend > 1.5,
  'asia kr open keeps us close in rt1 weight',
);
const usRegularOnly = estimateFromHoldingsWithFx(usCloseKrLive, 0, { liveRt1Only: true });
assert.ok(
  usRegularOnly < 0.5,
  'liveRt1Only excludes us close',
);

console.log('live-rt1-holdings.test.js OK');
