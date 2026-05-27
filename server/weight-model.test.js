import { applyWeightModel, mergeWeightParams } from './weight-model.js';

const ok = [];
const fail = [];
function assert(name, cond) {
  if (cond) ok.push(name);
  else fail.push(name);
}

const params = mergeWeightParams();
const disclosed = new Set(['MU', 'TXN']);

const out = applyWeightModel(
  [
    { code: 'MU', name: '美光', weight: 5.02, _mergeKey: 'MU_OLD' },
    { code: 'SNPS', name: '新思', weight: 5.17, _mergeKey: 'SNPS' },
    { code: 'TXN', name: '德州仪器', weight: 3.29, _mergeKey: 'TXN' },
    { code: 'MU', name: '美光Q1', weight: 4.85, _mergeKey: 'MU' },
  ],
  disclosed,
  params,
);

const muAnnual = out.find((h) => h.name === '美光');
const snps = out.find((h) => h.name === '新思');
const txn = out.find((h) => h.name === '德州仪器');
const muQ1 = out.find((h) => h.name === '美光Q1');

assert('annual-only 美光 ~1.91', Math.abs(muAnnual.weight - 1.91) < 0.05);
assert('annual-only 新思 ~3.17', Math.abs(snps.weight - 3.17) < 0.05);
assert('annual-only 德州仪器 unchanged', Math.abs(txn.weight - 3.29) < 0.01);
assert('disclosed Q1 unchanged', Math.abs(muQ1.weight - 4.85) < 0.01);

console.log(`weight-model tests: ${ok.length} passed, ${fail.length} failed`);
if (fail.length) {
  console.error('FAILED:', fail);
  process.exit(1);
}
