import { isValidQuote, toSinaFetchCode, resolveTencentUsSymbolFromMap, fetchTencentUsQuotes } from './quotes.js';

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
assert('bse 920808', toSinaFetchCode('920808', 0) === 'bj920808');
assert('jp code skip sina', toSinaFetchCode('8035JP', null) === null);
assert('eu fp skip sina', toSinaFetchCode('AIRFP', null) === null);
assert('tencent AIRFP', resolveTencentUsSymbolFromMap('AIRFP', '空客') === 'EADSY');
assert('tencent 8035JP', resolveTencentUsSymbolFromMap('8035JP', '东京电子') === 'TOELY');

const tq = await fetchTencentUsQuotes(['EADSY', 'TOELY', 'HESAY', 'RNMBF']);
assert('tencent us fetch', tq.EADSY && isValidQuote(tq.EADSY));

console.log(`quotes tests: ${ok.length} passed, ${fail.length} failed`);
if (fail.length) {
  console.error('FAILED:', fail);
  process.exit(1);
}
