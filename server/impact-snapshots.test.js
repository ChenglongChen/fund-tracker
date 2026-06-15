import { rememberHoldingRegular, getHoldingRegular, loadImpactSnapshots } from './impact-snapshots.js';
import { isValidHoldingQuote } from './quotes.js';

const ok = [];
const fail = [];
function assert(name, cond) {
  if (cond) ok.push(name);
  else fail.push(name);
}

await loadImpactSnapshots();

rememberHoldingRegular('02513|hk|test', { changePct: 34.18, price: 1472, at: Date.now() });
const snap = getHoldingRegular('02513|hk|test');
assert('persist large hk move', snap?.changePct === 34.18);
assert('valid holding snap', isValidHoldingQuote(snap));

console.log(`impact-snapshots tests: ${ok.length} passed, ${fail.length} failed`);
if (fail.length) {
  console.error('FAILED:', fail);
  process.exit(1);
}
