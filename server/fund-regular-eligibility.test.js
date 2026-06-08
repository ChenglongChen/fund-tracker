import {
  fundHasRegularHolding,
  fundNeedsHoldingQuoteRefresh,
  fundShouldRefreshLiveRt1,
} from './fund-regular-eligibility.js';
import { getUsSessionPhase } from './holding-market.js';

const ok = [];
const fail = [];

function assert(name, cond) {
  if (cond) ok.push(name);
  else fail.push(name);
}

const krMorning = new Date('2026-05-28T00:30:00.000Z'); // 08:30 BJ
const usOvernightNoAsia = new Date('2026-05-28T06:31:00.000Z'); // 14:31 BJ, KR closed
const usPremarket = new Date('2026-05-28T08:01:00.000Z'); // 16:01 BJ
const cnMarket = new Date('2026-05-27T02:00:00.000Z'); // 10:00 BJ
const weekendClosed = new Date('2026-05-30T02:00:00.000Z'); // 周六 10:00 BJ

const krHoldings = [
  { code: '000660', name: 'SK海力士', marketId: null },
  { code: '005930', name: '三星电子', marketId: null },
];
const usHoldings = [{ code: 'NVDA', name: 'NVIDIA', marketId: 105 }];

assert('kr morning has regular holding', fundHasRegularHolding(krHoldings, krMorning));
assert('us overnight afternoon no kr regular', !fundHasRegularHolding(krHoldings, usOvernightNoAsia));
assert('us holdings premarket not regular', !fundHasRegularHolding(usHoldings, usPremarket));

const qdiiFund = { code: '270023', name: '示例 全球精选' };
const cnFund = { code: '022364', name: '示例 A 股混合' };

assert(
  'qdii live when kr regular',
  fundShouldRefreshLiveRt1(qdiiFund, { holdings: krHoldings }, 'holdings', krMorning),
);
assert(
  'qdii snap when no regular holdings',
  !fundShouldRefreshLiveRt1(qdiiFund, { holdings: krHoldings }, 'holdings', usOvernightNoAsia),
);
assert(
  'cn fundgz live during cn market',
  fundShouldRefreshLiveRt1(cnFund, { holdings: [] }, 'fundgz', cnMarket),
);
assert(
  'cn fundgz snap after close',
  !fundShouldRefreshLiveRt1(cnFund, { holdings: [] }, 'fundgz', weekendClosed),
);
assert(
  'us holdings no quote refresh in closed premarket window',
  !fundNeedsHoldingQuoteRefresh(
    qdiiFund,
    { holdings: usHoldings },
    'holdings',
    usPremarket,
  ),
);
assert(
  'no quote refresh when all markets closed',
  !fundNeedsHoldingQuoteRefresh(
    qdiiFund,
    { holdings: krHoldings },
    'holdings',
    weekendClosed,
  ),
);

assert('us closed midday 08:30', getUsSessionPhase(krMorning) === 'closed');

const cnLunch = new Date('2026-05-26T04:00:00.000Z'); // 12:00 BJ
const cnHoldings = [{ code: '300308', name: '中际旭创', marketId: null }];
assert(
  'cn lunch refreshes holding quotes',
  fundNeedsHoldingQuoteRefresh(cnFund, { holdings: cnHoldings }, 'holdings', cnLunch),
);
assert(
  'cn lunch no live rt1 refresh',
  !fundShouldRefreshLiveRt1(cnFund, { holdings: cnHoldings }, 'holdings', cnLunch),
);

console.log(`fund-regular-eligibility tests: ${ok.length} passed, ${fail.length} failed`);
if (fail.length) {
  console.error('FAILED:', fail);
  process.exit(1);
}
