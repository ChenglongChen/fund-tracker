import assert from 'node:assert/strict';
import { reapplyDisplayFromCachedFunds } from './live-pipeline.js';

const after16 = new Date('2026-06-22T12:00:00.000Z');
const portfolio = {
  funds: [
    {
      id: 4,
      code: '022364',
      name: '永赢科技智选',
      amount: 153_133.16,
      yesterdayProfit: 792.17,
      totalProfit: 31_166.74,
      lastNavDate: '2026-06-22',
      shares: 24_219.2,
      lastNav: 6.3228,
      accountId: 'alipay',
    },
  ],
  accounts: [{ id: 'alipay', name: '支付宝' }],
};

const staleCache = [
  {
    id: 4,
    code: '022364',
    market: 'cn',
    amount: 153_133.16,
    dailyPending: true,
    settledProfit: null,
    settledPct: null,
    lastNavDate: '2026-06-18',
    officialNavDate: '2026-06-18',
    impactPct: 1.5,
    impactPctRegularLive: 1.5,
    rawImpactPct: 1.5,
    holdingsCount: 10,
  },
];

const { funds } = reapplyDisplayFromCachedFunds(portfolio, staleCache, after16);
assert.equal(funds[0].dailyPending, false, 'reapply picks up portfolio lastNavDate after settle');
assert.ok(Math.abs(funds[0].settledProfit - 792.17) < 0.02);

console.log('live-pipeline-reapply tests: passed');
