import { normalizeJpTicker, normalizeEuStooqSymbol } from './asia-quotes.js';
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
assert('6278JP', normalizeJpTicker('6278JP', '佑能工具') === '6278');

assert('AIRFP', normalizeEuStooqSymbol('AIRFP', '空客') === 'air.fr');
assert('RMSFP', normalizeEuStooqSymbol('RMSFP', '爱马仕') === 'rms.fr');
assert('RHMGR', normalizeEuStooqSymbol('RHMGR', '莱茵金属') === 'rhm.de');
assert('eu name airbus', normalizeEuStooqSymbol('X', 'Airbus SE') === 'air.fr');

const KR_LIVE_SOURCES = new Set(['eastmoney', 'naver', 'kr-csop-proxy']);

const now = new Date('2026-05-26T02:00:00.000Z');
const krHoldings = [
  { code: '005930', name: '三星电子' },
  { code: '000660', name: 'SK海力士' },
];
const { byHoldingKey } = await fetchHoldingQuotes(krHoldings, now);
const samRaw = byHoldingKey['005930\0三星电子'];
assert('no soxx during kr session', !samRaw || samRaw.quoteSource !== 'soxx-fallback');

await supplementAsiaQuotes(krHoldings, byHoldingKey, now, { awaitStooq: true });
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
await supplementAsiaQuotes(krEarlyHoldings, krEarlyKeys, krEarly, { awaitStooq: true });
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

const JP_EU_SOURCES = new Set([
  'stooq',
  'stooq-daily',
  'stooq-intraday',
  'eastmoney',
  'tencent-us-adr',
]);

const jpClosed = new Date('2026-05-26T07:00:00.000Z');
const jpClosedHoldings = [{ code: '6594JP', name: '日本电产' }];
const jpClosedKeys = {};
await supplementAsiaQuotes(jpClosedHoldings, jpClosedKeys, jpClosed, { awaitStooq: false });
const jpClosedApplied = applySessionQuotes(jpClosedHoldings, jpClosedKeys, jpClosed);
assert(
  'jp closed tencent or missing',
  (jpClosedApplied[0]?.quoteMode === 'close' && JP_EU_SOURCES.has(jpClosedApplied[0]?.quoteSource)) ||
    jpClosedApplied[0]?.quoteMode === 'missing',
);

const euHoldings = [{ code: 'AIRFP', name: '空客' }];
const euKeys = {};
await supplementAsiaQuotes(euHoldings, euKeys, now, { awaitStooq: false });
const euApplied = applySessionQuotes(euHoldings, euKeys, now);
assert(
  'eu tencent or missing',
  ((euApplied[0]?.quoteMode === 'live' || euApplied[0]?.quoteMode === 'close') &&
    JP_EU_SOURCES.has(euApplied[0]?.quoteSource)) ||
    euApplied[0]?.quoteMode === 'missing',
);

const jpHoldings = [{ code: '8035JP', name: '东京电子' }];
const jpKeys = {};
await supplementAsiaQuotes(jpHoldings, jpKeys, now, { awaitStooq: false });
const jpApplied = applySessionQuotes(jpHoldings, jpKeys, now);
assert(
  'jp tencent adr',
  (jpApplied[0]?.quoteSource === 'tencent-us-adr' && jpApplied[0]?.changePct != null) ||
    jpApplied[0]?.quoteMode === 'missing',
);

console.log(`asia-quotes tests: ${ok.length} passed, ${fail.length} failed`);
if (fail.length) {
  console.error('FAILED:', fail);
  console.error({ sam, sk, jp: jpApplied[0] });
  process.exit(1);
}
