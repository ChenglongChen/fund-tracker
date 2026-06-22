import assert from 'node:assert/strict';
import { buildTableHeadLabels } from './components/table-head.js';

const after16 = new Date('2026-06-22T12:00:00.000Z'); // 20:00 BJ
const before16 = new Date('2026-06-22T06:00:00.000Z'); // 14:00 BJ

const funds = [
  { market: 'us', amount: 500_000, lastNavDate: '2026-06-17', settledNavDate: '2026-06-17', settledProfit: 8000 },
  { market: 'cn', amount: 100_000, lastNavDate: '2026-06-18', settledNavDate: '2026-06-18', settledProfit: 2000 },
];

const headPm = buildTableHeadLabels(funds, {}, '2026-06-22', '20:00:00', after16);
assert.equal(headPm.daily.label, '06-18/06-22', 'after 16:00 daily head uses expected nav dates');

const headAm = buildTableHeadLabels(funds, {}, '2026-06-22', '14:00:00', before16);
assert.equal(headAm.daily.label, '06-17/06-18', 'before 16:00 daily head uses last credited nav dates');

const thuPm = buildTableHeadLabels(
  [{ market: 'cn', amount: 100_000, lastNavDate: '2026-06-17', settledProfit: 100 }],
  {},
  '2026-06-18',
  '20:00:00',
  new Date('2026-06-18T12:00:00.000Z'),
);
assert.equal(thuPm.daily.label, '06-18', 'cn thursday after 16:00 expects today nav date');

console.log('table-head tests: passed');
