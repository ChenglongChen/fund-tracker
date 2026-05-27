import {
  classifyFundMarket,
  effectiveImpactPct,
  getFundProfitWindows,
  isCnMarketOpen,
  isDomesticRealtimeSession,
  isGoldCnMarketOpen,
  isUsMarketOpen,
} from './market-session.js';

const ok = [];
const fail = [];

function assert(name, cond) {
  if (cond) ok.push(name);
  else fail.push(name);
}

assert('022184 is us', classifyFundMarket({ name: '富国全球科技互联网' }) === 'us');
assert('000216 is gold', classifyFundMarket({ name: '华安黄金' }) === 'gold_cn');
assert('001753 is cn', classifyFundMarket({ name: '红土创新新兴产业' }) === 'cn');

const cnOpen = new Date('2026-05-26T02:00:00.000Z');
assert('cn open 10:00', isCnMarketOpen(cnOpen));
assert('us closed 10:00', !isUsMarketOpen(cnOpen));

const usOpen = new Date('2026-05-26T14:00:00.000Z');
assert('us open 22:00', isUsMarketOpen(usOpen));
assert('cn closed 22:00', !isCnMarketOpen(usOpen));

const usLate = new Date('2026-05-26T17:00:00.000Z');
assert('us open 01:00', isUsMarketOpen(usLate));

const goldCnHours = new Date('2026-05-26T03:00:00.000Z');
assert('gold open 11:00', isGoldCnMarketOpen(goldCnHours));
assert(
  'gold realtime follows cn 11:00',
  getFundProfitWindows({ name: '华安黄金' }, '2026-05-26', goldCnHours).realtimeActive,
);
const goldNight = new Date('2026-05-26T14:00:00.000Z');
assert('gold night 22:00 cn closed', !isCnMarketOpen(goldNight));
assert(
  'gold no realtime at night',
  !getFundProfitWindows({ name: '华安黄金' }, '2026-05-26', goldNight).realtimeActive,
);

const cnPreOpen = new Date('2026-05-26T21:45:00.000Z');
assert('cn pre-open 05:45', !isDomesticRealtimeSession(cnPreOpen));
assert('cn pre-open no impact', effectiveImpactPct('cn', -1.5, cnPreOpen) == null);
assert('gold pre-open no impact', effectiveImpactPct('gold_cn', -0.25, cnPreOpen) == null);

const cnMorning = new Date('2026-05-26T02:00:00.000Z');
assert('cn session 10:00', isDomesticRealtimeSession(cnMorning));
assert('cn session keeps impact', effectiveImpactPct('cn', -1.5, cnMorning) === -1.5);

const jpMorning = new Date('2026-05-26T01:00:00.000Z');
assert(
  'us qdii realtime when jp open',
  getFundProfitWindows({ name: '富国全球科技互联网' }, '2026-05-26', jpMorning).realtimeActive,
);
assert(
  'us qdii asia label',
  getFundProfitWindows({ name: '富国全球科技互联网' }, '2026-05-26', jpMorning).marketLabel === '亚太',
);

const cnLunch = new Date('2026-05-26T04:00:00.000Z');
assert('cn lunch still session', isDomesticRealtimeSession(cnLunch));

const cnPostClose = new Date('2026-05-26T09:30:00.000Z');
assert('cn post-close same day', isDomesticRealtimeSession(cnPostClose));

const usPreCn = new Date('2026-05-26T21:45:00.000Z');
assert('us keeps impact when cn pre-open', effectiveImpactPct('us', 2.75, usPreCn) === 2.75);

const sat = new Date('2026-05-30T02:00:00.000Z');
assert('weekend no domestic session', !isDomesticRealtimeSession(sat));

console.log(`market-session tests: ${ok.length} passed, ${fail.length} failed`);
if (fail.length) {
  console.error('FAILED:', fail);
  process.exit(1);
}
