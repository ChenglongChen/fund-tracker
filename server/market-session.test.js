import {
  classifyFundMarket,
  clearFundImpactSnapshots,
  effectiveImpactPct,
  getFundProfitWindows,
  isCnMarketOpen,
  isDailyProfitPending,
  isDomesticRealtimeSession,
  isGoldCnMarketOpen,
  isUsMarketOpen,
  marketChipLabel,
  openMarketLabels,
  resolveFundImpactPct,
  resolveLiveDisplayImpact,
  shouldDisplayRealtimeProfit,
  isFundImpactLiveWindow,
} from './market-session.js';
import { isHkMarketOpen } from './holding-market.js';

const ok = [];
const fail = [];

function assert(name, cond) {
  if (cond) ok.push(name);
  else fail.push(name);
}

assert('022184 is us', classifyFundMarket({ name: '富国全球科技互联网' }) === 'us');
assert('000216 is cn gold linker', classifyFundMarket({ name: '华安黄金' }) === 'cn');
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
  'gold linker realtime follows cn 11:00',
  getFundProfitWindows({ name: '华安黄金' }, '2026-05-26', goldCnHours).realtimeActive,
);
const goldNight = new Date('2026-05-26T14:00:00.000Z');
assert('gold night 22:00 cn closed', !isCnMarketOpen(goldNight));
assert('gold night 22:00 gold futures open', isGoldCnMarketOpen(goldNight));
assert(
  'gold linker not realtime at cn closed night',
  !getFundProfitWindows({ name: '华安黄金' }, '2026-05-26', goldNight).realtimeActive,
);
assert(
  'gold impact suppressed during us regular night',
  effectiveImpactPct('gold_cn', -0.25, goldNight) == null,
);

const goldPre930 = new Date('2026-05-26T01:00:00.000Z');
assert('gold day pre-open 09:00 impact', effectiveImpactPct('gold_cn', 0.3, goldPre930) === 0.3);
assert(
  'gold day pre-open 09:00 no cn realtime',
  !getFundProfitWindows({ name: '华安黄金' }, '2026-05-26', goldPre930).realtimeActive,
);

const goldPostDay = new Date('2026-05-26T08:00:00.000Z');
assert(
  'gold 16:00 not trading badge',
  !getFundProfitWindows({ name: '华安黄金' }, '2026-05-26', goldPostDay).realtimeActive,
);
resolveFundImpactPct(8, 'gold_cn', 0.4, goldCnHours);
assert(
  'gold post-day frozen not live window',
  !isFundImpactLiveWindow('gold_cn', goldPostDay),
);
assert(
  'gold post-day keeps close snapshot',
  resolveFundImpactPct(8, 'gold_cn', 0.9, goldPostDay) === 0.4,
);
clearFundImpactSnapshots();

const cnMorning = new Date('2026-05-26T02:00:00.000Z');
const cnPreOpen = new Date('2026-05-26T21:45:00.000Z');
assert('cn pre-open 05:45', !isDomesticRealtimeSession(cnPreOpen));
clearFundImpactSnapshots();
assert('cn pre-open no snapshot', resolveFundImpactPct(99, 'cn', null, cnPreOpen) == null);
resolveFundImpactPct(99, 'cn', -1.2, cnMorning);
assert('cn pre-open uses close snapshot', resolveFundImpactPct(99, 'cn', -2.5, cnPreOpen) === -1.2);
clearFundImpactSnapshots();

assert('cn session 10:00', isDomesticRealtimeSession(cnMorning));
assert('cn session keeps impact', effectiveImpactPct('cn', -1.5, cnMorning) === -1.5);

const jpMorning = new Date('2026-05-26T01:00:00.000Z');
assert(
  'us qdii not live before us open (asia only)',
  !getFundProfitWindows({ name: '富国全球科技互联网' }, '2026-05-26', jpMorning).realtimeActive,
);
assert(
  'us qdii asia label',
  getFundProfitWindows({ name: '富国全球科技互联网' }, '2026-05-26', jpMorning).marketLabel === '亚太',
);

const cnLunch = new Date('2026-05-26T04:00:00.000Z');
assert('cn lunch still session', isDomesticRealtimeSession(cnLunch));
assert(
  'cn lunch keeps realtime',
  getFundProfitWindows({ name: '红土创新新兴产业' }, '2026-05-26', cnLunch).realtimeActive,
);
assert(
  'gold lunch keeps realtime',
  getFundProfitWindows({ name: '华安黄金' }, '2026-05-26', cnLunch).realtimeActive,
);

const cnPostClose = new Date('2026-05-26T09:30:00.000Z');
assert('cn post-close same day', isDomesticRealtimeSession(cnPostClose));
assert(
  'cn post-close not live badge',
  !getFundProfitWindows({ name: '红土创新新兴产业' }, '2026-05-26', cnPostClose).realtimeActive,
);
resolveFundImpactPct(7, 'cn', -1.1, cnMorning);
assert(
  'cn post-close frozen snapshot',
  resolveFundImpactPct(7, 'cn', -2.5, cnPostClose) === -1.1,
);
clearFundImpactSnapshots();

const cnUsRegular = new Date('2026-05-26T14:30:00.000Z');
resolveFundImpactPct(7, 'cn', -1.1, cnMorning);
assert(
  'cn post-close still snapshot before us regular',
  resolveFundImpactPct(7, 'cn', -2.5, cnPostClose) === -1.1,
);
assert(
  'cn hides snapshot during us regular',
  resolveFundImpactPct(7, 'cn', -2.5, cnUsRegular) == null,
);
assert(
  'cn display null during us regular',
  resolveLiveDisplayImpact(7, 'cn', { impactPct: -2.5 }, cnUsRegular).impactPct == null,
);
const cnUsPremarket = new Date('2026-05-27T08:27:00.000Z');
assert(
  'cn keeps snapshot during us premarket',
  resolveFundImpactPct(7, 'cn', -2.5, cnUsPremarket) === -1.1,
);
resolveFundImpactPct(6, 'gold_cn', -1.11, cnMorning);
assert(
  'gold hides live during us regular night',
  resolveFundImpactPct(6, 'gold_cn', -1.5, cnUsRegular) == null,
);
clearFundImpactSnapshots();

const usPreCn = new Date('2026-05-26T21:45:00.000Z');
resolveFundImpactPct(1, 'us', 2.75, usOpen);
assert('us afterhours updates impact', resolveFundImpactPct(1, 'us', 3.1, usPreCn) === 3.1);
assert(
  'us afterhours realtime badge',
  getFundProfitWindows({ name: '富国全球科技互联网' }, '2026-05-26', usPreCn).realtimeActive,
);
assert(
  'us still display profit when overseas closed',
  shouldDisplayRealtimeProfit('cn', false, 2.75),
);

const usPremarket = new Date('2026-05-27T08:27:00.000Z');
clearFundImpactSnapshots();
resolveFundImpactPct(2, 'us', 1.78, usOpen);
assert('us premarket not live window', !isFundImpactLiveWindow('us', usPremarket));
assert(
  'us premarket keeps prior close snapshot',
  resolveFundImpactPct(2, 'us', 0.44, usPremarket) === 1.78,
);
assert(
  'us premarket no live badge',
  !getFundProfitWindows({ name: '富国全球科技互联网' }, '2026-05-27', usPremarket).realtimeActive,
);
assert('us premarket chip', marketChipLabel(usPremarket).startsWith('盘前'));
assert('us premarket label', openMarketLabels(usPremarket).includes('美股'));

const premarketImpact = resolveLiveDisplayImpact(
  2,
  'us',
  { impactPct: 2.31, impactPctRegular: 1.76, impactPctExtended: 0.55, impactSession: 'premarket' },
  usPremarket,
);
assert('premarket display uses regular row', premarketImpact.impactPct === 1.76);
assert('premarket display keeps extended', premarketImpact.impactPctExtended === 0.55);
assert('premarket display not total', premarketImpact.impactPct !== 2.31);
assert('premarket display session', premarketImpact.impactSession === 'premarket');

clearFundImpactSnapshots();
const premarketFrozen = resolveLiveDisplayImpact(
  2,
  'us',
  { impactPct: 2.31, impactPctRegular: 1.76, impactPctExtended: 0.55, impactSession: 'premarket' },
  usPremarket,
);
const premarketFrozen2 = resolveLiveDisplayImpact(
  2,
  'us',
  { impactPct: 2.5, impactPctRegular: 1.95, impactPctExtended: 0.62, impactSession: 'premarket' },
  usPremarket,
);
assert('premarket row1 frozen', premarketFrozen2.impactPctRegular === premarketFrozen.impactPctRegular);
assert('premarket row1 first seed', premarketFrozen.impactPctRegular === 1.76);
assert('premarket row2 still live', premarketFrozen2.impactPctExtended === 0.62);
clearFundImpactSnapshots();

const premarketDisk = resolveLiveDisplayImpact(
  2,
  'us',
  { impactPct: 2.31, impactPctRegular: null, impactPctExtended: 0.44, impactSession: 'premarket' },
  usPremarket,
);
assert('premarket disk fallback regular', premarketDisk.impactPct === 1.78);

const sat = new Date('2026-05-30T02:00:00.000Z');
assert('weekend no domestic session', !isDomesticRealtimeSession(sat));

const cnHkGap = new Date('2026-05-27T07:03:00.000Z');
assert('15:03 cn closed', !isCnMarketOpen(cnHkGap));
assert('15:03 hk open', isHkMarketOpen(cnHkGap));
assert(
  '15:03 status excludes a-share',
  !openMarketLabels(cnHkGap).includes('A股'),
);
assert(
  '15:03 status includes hk only',
  openMarketLabels(cnHkGap).join('/') === '港股',
);
assert('15:03 chip', marketChipLabel(cnHkGap) === '盘中 · 港股');

const cnPending = new Date('2026-05-27T10:30:00.000Z');
assert(
  'cn daily pending when nav before today',
  isDailyProfitPending(
    { lastNavDate: '2026-05-26' },
    'cn',
    { pdate: '2026-05-26' },
    '2026-05-27',
    cnHkGap,
  ),
);
assert(
  'cn daily ok when nav is today',
  !isDailyProfitPending(
    { lastNavDate: '2026-05-27' },
    'cn',
    { pdate: '2026-05-27' },
    '2026-05-27',
    cnHkGap,
  ),
);
assert(
  'cn daily pending after 18:30 if nav stale',
  isDailyProfitPending(
    { lastNavDate: '2026-05-26' },
    'cn',
    { pdate: '2026-05-26' },
    '2026-05-27',
    cnPending,
  ),
);
assert(
  'us qdii pending when official ahead',
  isDailyProfitPending(
    { lastNavDate: '2026-05-25' },
    'us',
    { pdate: '2026-05-26' },
    '2026-05-27',
    cnPending,
  ),
);
assert(
  'us qdii pending when nav before yesterday',
  isDailyProfitPending(
    { lastNavDate: '2026-05-25' },
    'us',
    { pdate: '2026-05-25' },
    '2026-05-27',
    cnPending,
  ),
);
assert(
  'us qdii ok when nav is yesterday',
  !isDailyProfitPending(
    { lastNavDate: '2026-05-26' },
    'us',
    { pdate: '2026-05-26' },
    '2026-05-27',
    cnPending,
  ),
);
assert(
  'us qdii not pending before 18:00',
  !isDailyProfitPending(
    { lastNavDate: '2026-05-25' },
    'us',
    { pdate: '2026-05-25' },
    '2026-05-27',
    cnHkGap,
  ),
);

const hkPostClose = new Date('2026-05-27T08:00:21.000Z');
assert('16:00:21 hk closed', !isHkMarketOpen(hkPostClose));
assert('16:00:21 no hk label', !openMarketLabels(hkPostClose).includes('港股'));
assert('16:00:21 us premarket chip', marketChipLabel(hkPostClose) === '盘前 · 美股');

console.log(`market-session tests: ${ok.length} passed, ${fail.length} failed`);
if (fail.length) {
  console.error('FAILED:', fail);
  process.exit(1);
}
