import assert from 'node:assert/strict';
import {
  computeAccountTotals,
  computeAccountTotalsMap,
  computePortfolioTotals,
  resolvePortfolioRealtimeAssets,
} from './aggregate.js';

const portfolio = {
  accounts: [{ id: 'alipay' }, { id: 'other' }],
  funds: [
    {
      id: 1,
      code: 'A',
      accountId: 'alipay',
      amount: 1000,
      totalProfit: 100,
      yesterdayProfit: 50,
    },
    {
      id: 2,
      code: 'B',
      accountId: 'alipay',
      amount: 2000,
      totalProfit: 200,
      yesterdayProfit: 80,
    },
    {
      id: 3,
      code: 'C',
      accountId: 'other',
      amount: 500,
      totalProfit: 50,
      yesterdayProfit: 10,
    },
  ],
};

const liveFunds = [
  {
    id: 1,
    estimateProfit: -10,
    estimateAssets: 990,
    settledProfit: 20,
    dailyPending: false,
  },
  {
    id: 2,
    estimateProfit: 5,
    estimateAssets: 2005,
    settledProfit: null,
    dailyPending: true,
  },
  {
    id: 3,
    estimateProfit: 2,
    estimateAssets: 502,
    settledProfit: 10,
    dailyPending: false,
  },
];

const alipay = computeAccountTotals(portfolio, liveFunds, 'alipay');
assert.equal(alipay.settledAssets, 3000);
assert.equal(alipay.settledProfit, 20);
assert.equal(alipay.realtimeProfit, -5);
assert.equal(alipay.realtimeAssets, 990 + 2005);

const map = computeAccountTotalsMap(portfolio, liveFunds, portfolio.accounts);
assert.equal(map.alipay.settledProfit, 20);
assert.equal(map.other.settledProfit, 10);

const portfolioTotals = computePortfolioTotals(portfolio, liveFunds);
assert.equal(portfolioTotals.settledProfit, 30);
assert.equal(portfolioTotals.realtimeProfit, -3);

assert.equal(
  resolvePortfolioRealtimeAssets(
    { settledAssets: 3000, realtimeProfit: -5, estimateAssetsSum: 2985 },
    5000,
  ),
  2985,
  'outflow uses sum estimateAssets',
);
assert.equal(
  resolvePortfolioRealtimeAssets(
    { settledAssets: 5100, realtimeProfit: 100, estimateAssetsSum: 5200 },
    5000,
  ),
  5200,
  'settled scope uses sum estimateAssets',
);

console.log('scope-totals.test.js OK');
