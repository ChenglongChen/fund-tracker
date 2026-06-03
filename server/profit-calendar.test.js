import assert from 'node:assert/strict';
import { buildProfitCalendar, buildProfitWeeksInMonth, buildProfitSummary } from './profit-calendar.js';
import { readAppState, writeAppState } from './app-state.js';
import fs from 'node:fs/promises';
import { APP_STATE_PATH } from './app-state.js';

const TEST_LEDGER = {
  days: {
    '2026-05-28': {
      creditDay: '2026-05-28',
      funds: {
        '1': {
          accountId: 'alipay',
          code: '012922',
          settledProfit: 500,
          settledAssetsAfter: 100000,
        },
      },
      accounts: {
        alipay: { settledProfit: 500, settledAssets: 100000, settledProfitPct: 0.5 },
      },
      portfolio: {
        settledProfit: 500,
        settledAssets: 100000,
        settledProfitPct: 4.55,
      },
    },
    '2026-05-29': {
      creditDay: '2026-05-29',
      funds: {
        '1': {
          accountId: 'alipay',
          code: '012922',
          settledProfit: 1200.5,
          settledAssetsAfter: 100000,
        },
      },
      accounts: {
        alipay: { settledProfit: 1200.5, settledAssets: 100000, settledProfitPct: 1.0 },
      },
      portfolio: {
        settledProfit: 1200.5,
        settledAssets: 100000,
        settledProfitPct: 1.0,
      },
    },
  },
  meta: { schemaVersion: 1 },
};

let backup = null;
try {
  backup = await fs.readFile(APP_STATE_PATH, 'utf8');
} catch {
  backup = null;
}

await writeAppState({
  ...(await readAppState()),
  profitLedger: TEST_LEDGER,
});

const cal = await buildProfitCalendar({
  scope: 'alipay',
  month: '2026-05',
  accounts: [{ id: 'alipay', name: '支付宝' }],
  now: new Date('2026-05-29T12:00:00+08:00'),
});

const d29 = cal.days.find((d) => d.date === '2026-05-29');
assert.ok(d29);
assert.equal(d29.status, 'settled');
assert.equal(d29.profit, 1200.5);

const d30 = cal.days.find((d) => d.date === '2026-05-30');
assert.equal(d30.status, 'future');

const d1 = cal.days.find((d) => d.date === '2026-05-01');
assert.equal(d1.status, 'zero');
assert.equal(d1.profit, 0);

const d24 = cal.days.find((d) => d.date === '2026-05-24');
assert.equal(d24.status, 'off');
assert.equal(d24.profit, null);

const weekView = await buildProfitWeeksInMonth({
  scope: 'alipay',
  month: '2026-05',
  accounts: [{ id: 'alipay', name: '支付宝' }],
  now: new Date('2026-05-29T12:00:00+08:00'),
});
const w2529 = weekView.weeks.find((w) => w.start === '2026-05-25');
assert.ok(w2529?.profitPct != null, 'week profitPct');
assert.ok(w2529.profitPct > 0 && w2529.profitPct < 50, `week pct plausible: ${w2529.profitPct}`);

const summary = await buildProfitSummary({
  month: '2026-05',
  accounts: [{ id: 'alipay', name: '支付宝' }],
  now: new Date('2026-05-29T12:00:00+08:00'),
});
assert.equal(summary.portfolio.lastDay, '2026-05-29');
assert.equal(summary.portfolio.lastDayProfit, 1200.5);
assert.ok(summary.portfolio.monthProfitPct != null, 'portfolio monthProfitPct');
assert.equal(summary.portfolio.sparkline.length, 21, 'one point per trading day in May 1–29');
assert.equal(summary.portfolio.sparkline.at(-1), summary.portfolio.monthProfit);

const acct = summary.accounts.find((a) => a.accountId === 'alipay');
assert.equal(acct?.lastDay, '2026-05-29');
assert.ok(acct?.monthProfitPct != null, 'account monthProfitPct');

const mockPortfolio = {
  funds: [{ shares: 100, lastNavDate: '2026-05-29', code: '022364', name: '永赢科技' }],
};
const monAm = await buildProfitCalendar({
  scope: 'alipay',
  month: '2026-06',
  accounts: [{ id: 'alipay', name: '支付宝' }],
  portfolio: mockPortfolio,
  now: new Date('2026-05-31T23:30:00.000Z'),
});
const jun1Am = monAm.days.find((d) => d.date === '2026-06-01');
assert.equal(jun1Am?.status, 'zero', 'monday morning not pending');

const monPm = await buildProfitCalendar({
  scope: 'alipay',
  month: '2026-06',
  accounts: [{ id: 'alipay', name: '支付宝' }],
  portfolio: mockPortfolio,
  now: new Date('2026-06-01T08:30:00.000Z'),
});
const jun1Pm = monPm.days.find((d) => d.date === '2026-06-01');
assert.equal(jun1Pm?.status, 'pending', 'monday after 16 pending');

const satCal = await buildProfitCalendar({
  scope: 'alipay',
  month: '2026-05',
  accounts: [{ id: 'alipay', name: '支付宝' }],
  portfolio: mockPortfolio,
  now: new Date('2026-05-30T04:00:00.000Z'),
});
const sat = satCal.days.find((d) => d.date === '2026-05-30');
assert.equal(sat?.status, 'off', 'saturday is off not pending');

if (backup != null) {
  await fs.writeFile(APP_STATE_PATH, backup, 'utf8');
} else {
  await fs.unlink(APP_STATE_PATH).catch(() => {});
}

console.log('profit-calendar tests: passed');
