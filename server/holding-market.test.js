import {
  classifyHoldingMarket,
  getUsSessionPhase,
  isEuMarketOpen,
  isHkMarketOpen,
  isHoldingQuoteLive,
  isJpMarketOpen,
  isKrMarketOpen,
  isUsQuoteLive,
} from './holding-market.js';
import { applySessionQuotes } from './session-quotes.js';

const ok = [];
const fail = [];

function assert(name, cond) {
  if (cond) ok.push(name);
  else fail.push(name);
}

const jpOpen = new Date('2026-05-26T01:00:00.000Z');
assert('jp open 09:00', isJpMarketOpen(jpOpen));
assert('kr closed 08:00', !isKrMarketOpen(new Date('2026-05-26T00:00:00.000Z')));
assert('kr open 09:00', isKrMarketOpen(jpOpen));
const hkOpen = new Date('2026-05-26T01:30:00.000Z');
assert('hk open 09:30', isHkMarketOpen(hkOpen));

const jpClosed = new Date('2026-05-26T07:00:00.000Z');
assert('jp closed 15:00', !isJpMarketOpen(jpClosed));
assert('kr closed 15:00', !isKrMarketOpen(jpClosed));

const formerPremarket = new Date('2026-05-27T08:27:00.000Z');
assert('former premarket 16:27 closed', getUsSessionPhase(formerPremarket) === 'closed');
assert('us quote not live premarket window', !isUsQuoteLive(formerPremarket));

const formerAfterhours = new Date('2026-05-26T21:45:00.000Z');
assert('former afterhours 05:45 closed', getUsSessionPhase(formerAfterhours) === 'closed');
assert('us quote not live afterhours window', !isUsQuoteLive(formerAfterhours));

const usClosedMidday = new Date('2026-05-26T03:00:00.000Z');
assert('us closed midday 11:00', getUsSessionPhase(usClosedMidday) === 'closed');
assert('us quote not live when closed', !isUsQuoteLive(usClosedMidday));

assert('7747 is hk', classifyHoldingMarket({ code: '7747', name: '南方两倍做多三星' }) === 'hk');
assert('005930 is kr', classifyHoldingMarket({ code: '005930', name: '三星电子' }) === 'kr');
assert('NVDA is us', classifyHoldingMarket({ code: 'NVDA', marketId: 105 }) === 'us');
assert('TSM mid106 is us', classifyHoldingMarket({ code: 'TSM', name: '台积电', marketId: 106 }) === 'us');
assert('jp name', classifyHoldingMarket({ code: 'X', name: '东京电子' }) === 'jp');
assert('jp code suffix', classifyHoldingMarket({ code: '4062JP', name: '揖斐电' }) === 'jp');
assert('jp fujikura name', classifyHoldingMarket({ code: '5803JP', name: '藤仓株式会社' }) === 'jp');
assert('eu airfp', classifyHoldingMarket({ code: 'AIRFP', name: '空客' }) === 'eu');
assert('eu rhmgr', classifyHoldingMarket({ code: 'RHMGR', name: '莱茵金属' }) === 'eu');
assert('eu hermes name', classifyHoldingMarket({ code: 'X', name: '爱马仕' }) === 'eu');

const euOpen = new Date('2026-05-26T08:00:00.000Z');
assert('eu open 16:00', isEuMarketOpen(euOpen));
assert('eu closed midday', !isEuMarketOpen(jpOpen));

const krH = { code: '005930', name: '三星电子' };
const byKey = { '005930\0三星电子': { changePct: 2.5, price: 100, quoteSource: 'eastmoney' } };

const live = applySessionQuotes([krH], byKey, jpOpen);
assert('kr live when open', live[0].quoteMode === 'live' && live[0].changePct === 2.5);
assert('kr session regular', live[0].quoteSession === 'regular');

const frozen = applySessionQuotes([krH], { '005930\0三星电子': { changePct: 99, quoteSource: 'sina' } }, jpClosed);
assert('kr frozen when closed', frozen[0].quoteMode === 'close' && frozen[0].changePct === 2.5);

const nvda = { code: 'NVDA', name: '英伟达', marketId: 105 };
const nvdaPre = applySessionQuotes(
  [nvda],
  { 'NVDA\0英伟达': { changePct: 0.44, price: 216, quoteSource: 'sina' } },
  formerPremarket,
);
assert('us premarket window frozen', nvdaPre[0].quoteMode === 'close' || nvdaPre[0].quoteMode === 'missing');
assert('us premarket window closed session', nvdaPre[0].quoteSession === 'closed');

const usMidday = new Date('2026-05-28T02:52:00.000Z');
const adi = { code: 'ADI', name: '亚德诺', marketId: 105 };
const adiMid = applySessionQuotes(
  [adi],
  { 'ADI\0亚德诺': { changePct: -0.73, price: 100, quoteSource: 'sina' } },
  usMidday,
);
assert('us midday closed mode', adiMid[0].quoteMode === 'close');
assert('us midday closed session', adiMid[0].quoteSession === 'closed');

const tsm = { code: 'TSM', name: '台积电', marketId: 106 };
const tsmMid = applySessionQuotes(
  [tsm],
  { 'TSM\0台积电': { changePct: 2.52, price: 422.73, quoteSource: 'sina' } },
  usMidday,
);
assert('TSM mid106 us closed session', tsmMid[0].quoteSession === 'closed');
assert('TSM mid106 frozen when us closed', tsmMid[0].quoteMode === 'close');

const cnMidday = new Date('2026-05-28T04:00:00.000Z');
const cnH = { code: '600519', name: '贵州茅台' };
const cnMid = applySessionQuotes(
  [cnH],
  { '600519\0贵州茅台': { changePct: 1.2, price: 100, quoteSource: 'sina' } },
  cnMidday,
);
assert('cn midday session', cnMid[0].quoteSession === 'midday');
assert('cn midday frozen close mode', cnMid[0].quoteMode === 'close');

const hkMidday = new Date('2026-05-28T04:30:00.000Z');
const hkH = { code: '0700', name: '腾讯控股', marketId: 116 };
const hkMid = applySessionQuotes(
  [hkH],
  { '0700\0腾讯控股': { changePct: -0.5, price: 100, quoteSource: 'sina' } },
  hkMidday,
);
assert('hk midday session', hkMid[0].quoteSession === 'midday');
assert('hk midday frozen close mode', hkMid[0].quoteMode === 'close');

const zhipuH = { code: '02513', name: '智谱', marketId: 116 };
const zhipuLive = applySessionQuotes(
  [zhipuH],
  { '02513\0智谱': { changePct: 34.18, price: 1472, quoteSource: 'sina' } },
  hkOpen,
);
assert(
  'hk large move live not missing',
  zhipuLive[0].quoteMode === 'live' &&
    zhipuLive[0].quoteSession === 'regular' &&
    Math.abs(zhipuLive[0].changePct - 34.18) < 0.01,
);

const jpMidday = new Date('2026-05-28T03:00:00.000Z');
const jpH = { code: '8035', name: '东京电子' };
const jpMid = applySessionQuotes(
  [jpH],
  { '8035\0东京电子': { changePct: 0.8, price: 100, quoteSource: 'eastmoney' } },
  jpMidday,
);
assert('jp midday session', jpMid[0].quoteSession === 'midday');
assert('jp midday frozen close mode', jpMid[0].quoteMode === 'close');

const hkPostClose = new Date('2026-05-27T08:00:21.000Z');
assert('16:00:21 hk closed', !isHkMarketOpen(hkPostClose));
assert('16:00:21 us closed not quote live', !isHoldingQuoteLive('us', hkPostClose));

console.log(`holding-market tests: ${ok.length} passed, ${fail.length} failed`);
if (fail.length) {
  console.error('FAILED:', fail);
  process.exit(1);
}
