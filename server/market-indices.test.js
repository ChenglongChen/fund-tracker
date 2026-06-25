import { parseIndexChangePct, parseIndexQuote, parseFxChangePct } from './market-indices.js';

const ok = [];
const fail = [];

function assert(name, cond) {
  if (cond) ok.push(name);
  else fail.push(name);
}

const cnRaw = '上证指数,4138.8053,4145.3730,4144.6694,4153.5614,4137.9156';
const hkRaw = 'HSI,恒生指数,25608.780,25599.449,25626.460,25493.080,25595.900,-3.550,-0.010';
const znbRaw = '日经225,65856.4200,860.33,1.32,2:12 AM';
const gbRaw = '标普500指数,7519.1201,0.61,2026-05-27';

assert('cn parse', Math.abs(parseIndexChangePct(cnRaw, 'cn') - -0.017) < 0.05);
assert('hk parse', parseIndexChangePct(hkRaw, 'hk') === -0.01);
assert('znb parse', parseIndexChangePct(znbRaw, 'znb') === 1.32);
assert('gb parse', parseIndexChangePct(gbRaw, 'gb') === 0.61);

const cnQuote = parseIndexQuote(cnRaw, 'cn');
assert('cn quote price', Math.abs(cnQuote.price - 4144.6694) < 0.001);
assert('cn quote change', Math.abs(cnQuote.change + 0.7036) < 0.01);

const hkQuote = parseIndexQuote(hkRaw, 'hk');
assert('hk quote price', hkQuote.price === 25595.9);
assert('hk quote change', hkQuote.change === -3.55);

// Sina 在岸人民币：无现成涨跌幅字段，由 现价(parts[3]) vs 昨收(parts[1]) 计算
const fxRaw =
  '02:52:26,6.7892000000,6.8177000000,6.8034000000,277.0000000000,6.8101000000,6.8122000000,6.7845000000,6.8034000000,在岸人民币,0.0000,0.0000,0.0277,此行情由新浪财经计算得出,0.0000,0.0000,,2026-06-26';
assert('fx parse non-zero', Math.abs(parseFxChangePct(fxRaw) - 0.2092) < 0.01);
assert('fx empty -> null', parseFxChangePct('') === null);
assert('fx insane -> null', parseFxChangePct('t,1.0,x,9.9,...') === null);

console.log(`market-indices tests: ${ok.length} passed, ${fail.length} failed`);
if (fail.length) {
  console.error('FAILED:', fail);
  process.exit(1);
}
