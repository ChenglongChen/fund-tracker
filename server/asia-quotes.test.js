import { normalizeJpTicker } from './asia-quotes.js';
import { fetchHoldingQuotes } from './quotes.js';
import { supplementAsiaQuotes, applySessionQuotes } from './session-quotes.js';

const ok = [];
const fail = [];

function assert(name, cond) {
  if (cond) ok.push(name);
  else fail.push(name);
}

assert('6594JP', normalizeJpTicker('6594JP', '日本电产') === '6594');
assert('8035JP', normalizeJpTicker('8035JP', '东京电子') === '8035');
assert('285AJP', normalizeJpTicker('285AJP', '铠侠') === '285A');
assert('name nidec', normalizeJpTicker('X', '日本电产株式会社') === '6594');

const KR_LIVE_SOURCES = new Set(['eastmoney', 'naver', 'kr-csop-proxy']);

const now = new Date('2026-05-26T02:00:00.000Z');
const krHoldings = [
  { code: '005930', name: '三星电子' },
  { code: '000660', name: 'SK海力士' },
];
const { byHoldingKey } = await fetchHoldingQuotes(krHoldings, now);
assert('no soxx during kr session', !byHoldingKey['005930\0三星电子']);

await supplementAsiaQuotes(krHoldings, byHoldingKey, now);
const krApplied = applySessionQuotes(krHoldings, byHoldingKey, now);
const sam = krApplied.find((h) => h.code === '005930');
const sk = krApplied.find((h) => h.code === '000660');
assert('samsung not soxx', sam?.quoteSource !== 'soxx-fallback');
assert(
  'kr hk-open live',
  (sam?.quoteMode === 'live' && KR_LIVE_SOURCES.has(sam?.quoteSource)) || sam?.quoteMode === 'missing',
);
assert(
  'hynix hk-open live',
  (sk?.quoteMode === 'live' && KR_LIVE_SOURCES.has(sk?.quoteSource)) || sk?.quoteMode === 'missing',
);

const krEarly = new Date('2026-05-28T00:37:00.000Z');
const krEarlyHoldings = [{ code: '000660', name: 'SK海力士' }];
const krEarlyKeys = {};
await supplementAsiaQuotes(krEarlyHoldings, krEarlyKeys, krEarly);
const krEarlyApplied = applySessionQuotes(krEarlyHoldings, krEarlyKeys, krEarly);
const krEarlyRow = krEarlyApplied[0];
assert(
  'kr before hk open naver or missing',
  (krEarlyRow?.quoteMode === 'live' && krEarlyRow?.quoteSource === 'naver') ||
    krEarlyRow?.quoteMode === 'missing',
);
assert(
  'kr before hk open not csop',
  krEarlyRow?.quoteSource !== 'kr-csop-proxy',
);
assert(
  'kr before hk open not live csop',
  !(krEarlyRow?.quoteMode === 'live' && krEarlyRow?.quoteSource === 'kr-csop-proxy'),
);

const jpHoldings = [{ code: '6594JP', name: '日本电产' }];
const jpKeys = {};
await supplementAsiaQuotes(jpHoldings, jpKeys, now);
const jpApplied = applySessionQuotes(jpHoldings, jpKeys, now);
assert(
  'jp quote resolved or missing when offline',
  (jpApplied[0]?.quoteMode === 'live' &&
    (jpApplied[0]?.quoteSource === 'stooq' ||
      jpApplied[0]?.quoteSource === 'stooq-intraday' ||
      jpApplied[0]?.quoteSource === 'eastmoney')) ||
    jpApplied[0]?.quoteMode === 'missing',
);

console.log(`asia-quotes tests: ${ok.length} passed, ${fail.length} failed`);
if (fail.length) {
  console.error('FAILED:', fail);
  console.error({ sam, sk, jp: jpApplied[0] });
  process.exit(1);
}
