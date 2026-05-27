/**
 * 盘前口径：第1行 = 5/26 美股正盘 + 5/27 亚太；第2行 = 仅美股盘前
 */
import { estimateFromHoldingsWithFx } from './holdings-pipeline.js';
import { deriveImpactSessionFromHoldings } from './market.js';

function holdingsWithRegularChange(holdings) {
  return holdings.map((h) => {
    const isUs = h.holdingMarket === 'us' || h.holdingMarket === 'other';
    const extended =
      h.quoteSession === 'premarket' ||
      h.quoteSession === 'afterhours' ||
      h.quoteSession === 'overnight';
    if (isUs && extended) {
      const regular = h.changePctRegular;
      return {
        ...h,
        changePct: regular != null && Number.isFinite(regular) ? regular : null,
      };
    }
    return { ...h, changePct: h.changePct };
  });
}

function holdingsWithExtendedChange(holdings) {
  return holdings.map((h) => {
    const isUs = h.holdingMarket === 'us' || h.holdingMarket === 'other';
    const extended =
      h.quoteSession === 'premarket' ||
      h.quoteSession === 'afterhours' ||
      h.quoteSession === 'overnight';
    if (!isUs || !extended) {
      return { ...h, changePct: 0 };
    }
    if (h.changePctPremarket != null && Number.isFinite(h.changePctPremarket)) {
      return { ...h, changePct: h.changePctPremarket };
    }
    if (
      h.changePct != null &&
      Number.isFinite(h.changePct) &&
      h.changePctRegular != null &&
      Number.isFinite(h.changePctRegular)
    ) {
      return { ...h, changePct: h.changePct - h.changePctRegular };
    }
    return { ...h, changePct: null };
  });
}

const holdings = [
  {
    code: 'NVDA',
    weight: 60,
    changePct: -0.22,
    changePctRegular: 1.2,
    changePctPremarket: 0.51,
    quoteSession: 'premarket',
    holdingMarket: 'us',
  },
  {
    code: '0700',
    weight: 40,
    changePct: 0.8,
    changePctRegular: 0.8,
    quoteSession: 'closed',
    holdingMarket: 'hk',
  },
];

const regular = estimateFromHoldingsWithFx(holdingsWithRegularChange(holdings), 0);
const extended = estimateFromHoldingsWithFx(holdingsWithExtendedChange(holdings), 0);

const expectedRegular = (60 * 1.2 + 40 * 0.8) / 100;
const expectedExtended = (60 * 0.51) / 100;

const ok = [];
const fail = [];
function assert(name, cond) {
  (cond ? ok : fail).push(name);
}

assert('regular excludes us premarket', Math.abs(regular - expectedRegular) < 0.001);
assert('extended uses premarket field', Math.abs(extended - expectedExtended) < 0.001);

const missingRegular = [
  {
    code: 'GOOG',
    weight: 80,
    changePct: 1.44,
    changePctRegular: null,
    changePctPremarket: null,
    quoteSession: 'premarket',
    holdingMarket: 'us',
  },
  {
    code: '0700',
    weight: 20,
    changePct: 0.5,
    quoteSession: 'closed',
    holdingMarket: 'hk',
  },
];
const extMissing = estimateFromHoldingsWithFx(holdingsWithExtendedChange(missingRegular), 0);
assert('missing premarket not full quote', extMissing == null || Math.abs(extMissing) < 0.2);

function resolveUsRegularChangePct(h, ndxRegular) {
  const pct = h.changePct;
  const pre = h.changePctPremarket;
  let regular = h.changePctRegular;
  if (regular != null && Number.isFinite(regular) && ndxRegular != null && Number.isFinite(ndxRegular)) {
    const ndxSignificant = Math.abs(ndxRegular) >= 0.3;
    const signMismatch = ndxSignificant && regular * ndxRegular < 0;
    const farFromIndex = Math.abs(regular - ndxRegular) > 5;
    if (signMismatch || farFromIndex) regular = null;
  }
  if (regular != null && Number.isFinite(regular)) return regular;
  if (pct != null && Number.isFinite(pct)) {
    const preAbs = pre != null && Number.isFinite(pre) ? Math.abs(pre) : 0;
    if (Math.abs(pct) > Math.max(2, preAbs * 1.5)) return pct;
  }
  if (ndxRegular != null && Number.isFinite(ndxRegular)) return ndxRegular;
  return null;
}

assert('reject sign-mismatch regular', resolveUsRegularChangePct({ changePctRegular: -1.02, changePct: 1.44, changePctPremarket: -0.27 }, 1.76) === 1.76);
assert('keep valid regular', resolveUsRegularChangePct({ changePctRegular: 1.09, changePct: -0.22, changePctPremarket: 0.51 }, 1.76) === 1.09);
assert('large daily move when regular missing', resolveUsRegularChangePct({ changePctRegular: null, changePct: 19.29, changePctPremarket: 5.95 }, 1.76) === 19.29);

const mixed270023 = [
  { code: 'NVDA', weight: 4.4, changePct: -0.22, changePctRegular: 1.09, changePctPremarket: 0.51, quoteSession: 'premarket', holdingMarket: 'us' },
  { code: 'MU', weight: 3.2, changePct: 19.29, changePctRegular: null, changePctPremarket: 5.95, quoteSession: 'premarket', holdingMarket: 'us' },
  { code: 'GOOG', weight: 4.8, changePct: 1.44, changePctRegular: -1.02, changePctPremarket: -0.27, quoteSession: 'premarket', holdingMarket: 'us' },
  { code: '02513', weight: 5.1, changePct: 5.95, quoteSession: 'closed', holdingMarket: 'hk' },
  { code: '0700', weight: 0.9, changePct: -1.05, quoteSession: 'closed', holdingMarket: 'hk' },
];
const ndx = 1.76;
const mixedRegularHoldings = mixed270023.map((h) => {
  const isUs = h.holdingMarket === 'us';
  const ext = h.quoteSession === 'premarket';
  if (isUs && ext) {
    const regular = resolveUsRegularChangePct(h, ndx);
    return { ...h, changePct: regular };
  }
  return h;
});
const mixedExtendedHoldings = mixed270023.map((h) => {
  const isUs = h.holdingMarket === 'us';
  const ext = h.quoteSession === 'premarket';
  if (!isUs || !ext) return { ...h, changePct: 0 };
  return { ...h, changePct: h.changePctPremarket ?? null };
});
const mixedRegular = estimateFromHoldingsWithFx(mixedRegularHoldings, 0);
const mixedExtended = estimateFromHoldingsWithFx(mixedExtendedHoldings, 0);
assert('270023 mock regular high enough', mixedRegular > 1.0);
assert('270023 mock extended not full regular', mixedExtended < mixedRegular);

const premarket = new Date('2026-05-27T11:00:00.000Z');
assert(
  'gold night regular does not block us premarket split',
  deriveImpactSessionFromHoldings(
    [
      { quoteSession: 'premarket', holdingMarket: 'us' },
      { quoteSession: 'regular', holdingMarket: 'gold_cn' },
      { quoteSession: 'closed', holdingMarket: 'hk' },
    ],
    premarket,
  ) === 'premarket',
);
assert(
  'us regular session still wins when us stock is regular',
  deriveImpactSessionFromHoldings(
    [
      { quoteSession: 'regular', holdingMarket: 'us' },
      { quoteSession: 'premarket', holdingMarket: 'us' },
    ],
    premarket,
  ) === 'regular',
);
assert(
  'a-share only holdings not us premarket',
  deriveImpactSessionFromHoldings(
    [
      { quoteSession: 'closed', holdingMarket: 'cn' },
      { quoteSession: 'closed', holdingMarket: 'hk' },
    ],
    premarket,
  ) === 'closed',
);

console.log(`market-extended-impact tests: ${ok.length} passed, ${fail.length} failed`);
if (fail.length) {
  console.error('FAILED:', fail);
  console.error({ regular, extended, expectedRegular, expectedExtended, extMissing });
  process.exit(1);
}
