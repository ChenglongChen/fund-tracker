import { isValidQuote } from './quotes.js';

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

console.log(`quotes tests: ${ok.length} passed, ${fail.length} failed`);
if (fail.length) {
  console.error('FAILED:', fail);
  process.exit(1);
}
