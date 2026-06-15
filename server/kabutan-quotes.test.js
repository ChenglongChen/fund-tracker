import {
  parseKabutanKabukaHtml,
  fetchKabutanJpQuote,
  shouldFetchKabutanJp,
} from './kabutan-quotes.js';

const ok = [];
const fail = [];
function assert(name, cond) {
  if (cond) ok.push(name);
  else fail.push(name);
}

const fixture = `
<div id="stockinfo_i1"><span class="kabuka">90,910</span></div>
<table class="stock_kabuka0"><tbody>
<tr><td>85,700</td><td>90,990</td><td>85,200</td><td>90,910</td><td>+9,710</td><td>+11.96</td><td>33,746,100</td></tr>
</tbody></table>`;

const parsed = parseKabutanKabukaHtml(fixture, '285A');
assert('parse changePct', parsed?.changePct === 11.96);
assert('parse price', parsed?.price === 90910);
assert('parse source', parsed?.quoteSource === 'kabutan');
assert('parse prevClose', parsed?.prevClose != null && Math.abs(parsed.prevClose - 90910 / 1.1196) < 0.05);

assert('should fetch over adr', shouldFetchKabutanJp({ changePct: 3.1, price: 52, quoteSource: 'tencent-us-adr' }));
assert('should skip kabutan', !shouldFetchKabutanJp({ changePct: 11.96, price: 90910, quoteSource: 'kabutan' }));

const live = await fetchKabutanJpQuote('285A');
assert('live 285A', live?.changePct != null && live?.quoteSource === 'kabutan');

console.log(`kabutan-quotes tests: ${ok.length} passed, ${fail.length} failed`);
if (fail.length) {
  console.error('FAILED:', fail);
  process.exit(1);
}
