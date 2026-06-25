import { resolveProxyIndexImpact } from './market.js';
import { indexStripLabelForProxyFund } from './valuation-profile.js';

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
  { label: '汇率', changePct: 0.2, usd: 0.2, hkd: 0.17, market: 'fx' },
];

assert('nasdaq100 label', indexStripLabelForProxyFund('广发纳斯达克100') === '纳斯达克100');
assert('sp500 label', indexStripLabelForProxyFund('博时标普500') === '标普500');
assert('gold no index', indexStripLabelForProxyFund('华安黄金') === null);

const ndx = resolveProxyIndexImpact('汇添富纳斯达克100', strip);
assert('nasdaq100 impact includes usd/cny fx', Math.abs((ndx?.impactPct ?? 0) - 1.96352) < 0.0001);
assert('nasdaq100 source', ndx?.impactSource === 'index');
assert('not composite ixic', ndx?.impactPct !== 1.19);

const sp = resolveProxyIndexImpact('博时标普500', strip);
assert('sp500 impact includes usd/cny fx', Math.abs((sp?.impactPct ?? 0) - 0.81122) < 0.0001);

console.log(`market-proxy-index tests: ${ok.length} passed, ${fail.length} failed`);
if (fail.length) {
  console.error('FAILED:', fail);
  process.exit(1);
}
