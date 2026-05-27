import {
  classifyHoldingMarket,
  getUsSessionPhase,
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

const usPremarket = new Date('2026-05-27T08:27:00.000Z');
assert('us premarket 16:27', getUsSessionPhase(usPremarket) === 'premarket');
assert('us quote live premarket', isUsQuoteLive(usPremarket));

const usAfterhours = new Date('2026-05-26T21:45:00.000Z');
assert('us afterhours 05:45', getUsSessionPhase(usAfterhours) === 'afterhours');
assert('us quote live afterhours', isUsQuoteLive(usAfterhours));

const usClosedMidday = new Date('2026-05-26T03:00:00.000Z');
assert('us closed 11:00', getUsSessionPhase(usClosedMidday) === 'closed');
assert('us quote not live midday', !isUsQuoteLive(usClosedMidday));

assert('7747 is hk', classifyHoldingMarket({ code: '7747', name: '南方两倍做多三星' }) === 'hk');
assert('005930 is kr', classifyHoldingMarket({ code: '005930', name: '三星电子' }) === 'kr');
assert('NVDA is us', classifyHoldingMarket({ code: 'NVDA', marketId: 105 }) === 'us');
assert('jp name', classifyHoldingMarket({ code: 'X', name: '东京电子' }) === 'jp');

const krH = { code: '005930', name: '三星电子' };
const byKey = { '005930\0三星电子': { changePct: 2.5, price: 100, quoteSource: 'eastmoney' } };

const live = applySessionQuotes([krH], byKey, jpOpen);
assert('kr live when open', live[0].quoteMode === 'live' && live[0].changePct === 2.5);
assert('kr session regular', live[0].quoteSession === 'regular');

const frozen = applySessionQuotes([krH], { '005930\0三星电子': { changePct: 99, quoteSource: 'sina' } }, jpClosed);
assert('kr frozen when closed', frozen[0].quoteMode === 'close' && frozen[0].changePct === 2.5);

const nvda = { code: 'NVDA', name: '英伟达', marketId: 105 };
applySessionQuotes([nvda], { 'NVDA\0英伟达': { changePct: 1.78, price: 215, quoteSource: 'sina' } }, new Date('2026-05-26T14:00:00.000Z'));
const nvdaPre = applySessionQuotes(
  [nvda],
  { 'NVDA\0英伟达': { changePct: 0.44, price: 216, quoteSource: 'sina' } },
  usPremarket,
);
assert('us premarket live', nvdaPre[0].quoteMode === 'live' && nvdaPre[0].quoteSession === 'premarket');
assert('us premarket change', nvdaPre[0].changePct === 0.44);
assert('us premarket regular snap', nvdaPre[0].changePctRegular === 1.78);

const hkPostClose = new Date('2026-05-27T08:00:21.000Z');
assert('16:00:21 hk closed', !isHkMarketOpen(hkPostClose));
assert('16:00:21 us premarket quote live', isHoldingQuoteLive('us', hkPostClose));

console.log(`holding-market tests: ${ok.length} passed, ${fail.length} failed`);
if (fail.length) {
  console.error('FAILED:', fail);
  process.exit(1);
}
