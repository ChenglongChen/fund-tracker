import { resolveProxyIndexImpact } from './market.js';
import { indexStripLabelForProxyFund } from './valuation-profile.js';
import { setQqqPremarketPct } from './gb-quote-parse.js';

const ok = [];
const fail = [];

function assert(name, cond) {
  if (cond) ok.push(name);
  else fail.push(name);
}

const strip = [
  { label: '纳斯达克100', changePct: 1.76, market: 'us' },
  { label: '纳斯达克', changePct: 1.19, market: 'us' },
  { label: '标普500', changePct: 0.61, market: 'us' },
];

assert('nasdaq100 label', indexStripLabelForProxyFund('广发纳斯达克100') === '纳斯达克100');
assert('sp500 label', indexStripLabelForProxyFund('博时标普500') === '标普500');
assert('gold no index', indexStripLabelForProxyFund('华安黄金') === null);

const ndx = resolveProxyIndexImpact('汇添富纳斯达克100', strip);
assert('nasdaq100 impact', ndx?.impactPct === 1.76);
assert('nasdaq100 source', ndx?.impactSource === 'index');
assert('not composite ixic', ndx?.impactPct !== 1.19);

const premarketStrip = [
  {
    label: '纳斯达克100',
    changePct: 1.76,
    changePctRegular: 1.76,
    changePctPremarket: null,
    quoteSession: 'premarket',
    market: 'us',
  },
];
setQqqPremarketPct(0.55);
const ndxPre = resolveProxyIndexImpact('广发纳斯达克100', premarketStrip);
assert('premarket regular', Math.abs((ndxPre?.impactPctRegular ?? 0) - 1.76) < 0.01);
assert('premarket extended', Math.abs((ndxPre?.impactPctExtended ?? 0) - 0.55) < 0.01);
assert('premarket total', Math.abs((ndxPre?.impactPct ?? 0) - 2.31) < 0.02);

const sp = resolveProxyIndexImpact('博时标普500', strip);
assert('sp500 impact', sp?.impactPct === 0.61);

console.log(`market-proxy-index tests: ${ok.length} passed, ${fail.length} failed`);
if (fail.length) {
  console.error('FAILED:', fail);
  process.exit(1);
}
