import {
  classifyHoldingMarket,
  isHkMarketOpen,
  isJpMarketOpen,
  isKrMarketOpen,
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
assert('kr open 09:00', isKrMarketOpen(jpOpen));
const hkOpen = new Date('2026-05-26T01:30:00.000Z');
assert('hk open 09:30', isHkMarketOpen(hkOpen));

const jpClosed = new Date('2026-05-26T07:00:00.000Z');
assert('jp closed 15:00', !isJpMarketOpen(jpClosed));
assert('kr closed 15:00', !isKrMarketOpen(jpClosed));

assert('7747 is hk', classifyHoldingMarket({ code: '7747', name: '南方两倍做多三星' }) === 'hk');
assert('005930 is kr', classifyHoldingMarket({ code: '005930', name: '三星电子' }) === 'kr');
assert('NVDA is us', classifyHoldingMarket({ code: 'NVDA', marketId: 105 }) === 'us');
assert('jp name', classifyHoldingMarket({ code: 'X', name: '东京电子' }) === 'jp');

const krH = { code: '005930', name: '三星电子' };
const byKey = { '005930\0三星电子': { changePct: 2.5, price: 100, quoteSource: 'eastmoney' } };

const live = applySessionQuotes([krH], byKey, jpOpen);
assert('kr live when open', live[0].quoteMode === 'live' && live[0].changePct === 2.5);

const frozen = applySessionQuotes([krH], { '005930\0三星电子': { changePct: 99, quoteSource: 'sina' } }, jpClosed);
assert('kr frozen when closed', frozen[0].quoteMode === 'close' && frozen[0].changePct === 2.5);

console.log(`holding-market tests: ${ok.length} passed, ${fail.length} failed`);
if (fail.length) {
  console.error('FAILED:', fail);
  process.exit(1);
}
