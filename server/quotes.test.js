import { isValidQuote, toSinaFetchCode, resolveTencentUsSymbolFromMap, fetchTencentUsQuotes } from './quotes.js';
import { supplementAsiaQuotes, rememberAsiaPrevClose } from './asia-quotes.js';

const ok = [];
const fail = [];
function assert(name, cond) {
  if (cond) ok.push(name);
  else fail.push(name);
}

assert('reject -100', !isValidQuote({ changePct: -100, price: 0 }));
assert('reject price 0', !isValidQuote({ changePct: 5, price: 0 }));
assert('accept normal', isValidQuote({ changePct: 6.22, price: 688 }));
assert('accept leveraged etf', isValidQuote({ changePct: 18.49, price: 45.2 }));
assert('reject eastmoney garbage', !isValidQuote({ changePct: 30274.06, price: 34190 }));
assert('bse 920808', toSinaFetchCode('920808', 0) === 'bj920808');
assert('jp code skip sina', toSinaFetchCode('8035JP', null) === null);
assert('eu fp skip sina', toSinaFetchCode('AIRFP', null) === null);
assert('tencent AIRFP', resolveTencentUsSymbolFromMap('AIRFP', '空客') === 'EADSY');
assert('tencent 8035JP', resolveTencentUsSymbolFromMap('8035JP', '东京电子') === 'TOELY');

const tq = await fetchTencentUsQuotes(['EADSY', 'TOELY', 'HESAY', 'RNMBF']);
assert('tencent us fetch', tq.EADSY && isValidQuote(tq.EADSY));

const jpKey = '8035JP\u0000东京电子';
const jpBy = { [jpKey]: { changePct: 30274.06, price: 34190, quoteSource: 'eastmoney' } };
await supplementAsiaQuotes([{ code: '8035JP', name: '东京电子' }], jpBy, new Date(), { awaitStooq: false });
assert(
  'bad eastmoney falls back to tencent adr',
  isValidQuote(jpBy[jpKey]) && jpBy[jpKey].quoteSource === 'tencent-us-adr',
);

rememberAsiaPrevClose('8035', 200.5);
const stooqBy = {};
await supplementAsiaQuotes(
  [{ code: '8035JP', name: '东京电子' }],
  stooqBy,
  new Date('2026-06-04T04:00:00.000Z'),
  { awaitStooq: true },
);
assert(
  'stooq ignores adr-poisoned prev close',
  isValidQuote(stooqBy[jpKey]) &&
    stooqBy[jpKey].quoteSource === 'tencent-us-adr' &&
    Math.abs(stooqBy[jpKey].changePct) < 30,
);

console.log(`quotes tests: ${ok.length} passed, ${fail.length} failed`);
if (fail.length) {
  console.error('FAILED:', fail);
  process.exit(1);
}
