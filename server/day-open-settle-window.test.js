/**
 * day_open（美股收盘后 04:00–08:00）snap 在结算窗口内 re-seed，收敛到最终收盘；窗口外冻结。
 * 复现并防回归：NDX 04:00 未结算值 0.61 → 04:20 结算 0.75，snap 应跟到 0.75；05:00 再变不再跟。
 */
import assert from 'node:assert/strict';
import { computePortfolioTotals } from './aggregate.js';
import { buildDisplayFundRows } from './live-pipeline.js';
import {
  clearScopeSnap,
  getBaselineForDay,
  getScopeSnap,
  loadDayDisplayState,
  setBaselineForDay,
  setCurrentPhase,
} from './day-display-state.js';
import { reconcileDisplayState } from './components/snap-seed.js';

await loadDayDisplayState();

const accrualDay = '2026-06-26';
const beijingDate = '2026-06-26';
const t0400 = new Date('2026-06-25T20:00:00.000Z'); // 04:00 BJ day_open seed
const t0420 = new Date('2026-06-25T20:20:00.000Z'); // 04:20 BJ 结算窗口内
const t0500 = new Date('2026-06-25T21:00:00.000Z'); // 05:00 BJ 窗口外（冻结）

const portfolio = {
  funds: [{ id: 1, code: '006479', name: '广发纳斯达克100', amount: 100000, yesterdayProfit: 0, totalProfit: 5000 }],
};

function reconcileAt(now, regularPct) {
  const impacts = [{ impactPct: regularPct, impactPctRegular: regularPct }];
  const liveFunds = buildDisplayFundRows(portfolio, impacts, [null], beijingDate, now);
  const totalsPre = computePortfolioTotals(portfolio, liveFunds, now);
  setCurrentPhase('day_open', now);
  reconcileDisplayState(portfolio, liveFunds, totalsPre, impacts, now);
  return getScopeSnap(accrualDay, 'eodSnap', 'portfolio');
}

clearScopeSnap(accrualDay, 'eodSnap', 'portfolio');
setBaselineForDay(accrualDay, 'portfolio', 100000);

// 04:00 seed 捕获未结算 0.61%
const s1 = reconcileAt(t0400, 0.61);
assert.equal(s1.seedPhase, 'day_open');
assert.ok(Math.abs(s1.funds[1].rt1 - 610) < 1, `04:00 rt1 ≈ 610, got ${s1.funds[1].rt1}`);
const baseline0 = getBaselineForDay(accrualDay, 'portfolio');

// 04:20 结算窗口内：收盘结算为 0.75% → snap 应 re-seed 跟进
const s2 = reconcileAt(t0420, 0.75);
assert.ok(Math.abs(s2.funds[1].rt1 - 750) < 1, `04:20 rt1 应收敛到 ≈750, got ${s2.funds[1].rt1}`);
assert.equal(getBaselineForDay(accrualDay, 'portfolio'), baseline0, '结算窗口 re-seed 须保留 B[D]');

// 05:00 窗口外：即便指数再变（0.90），snap 冻结不跟
const s3 = reconcileAt(t0500, 0.9);
assert.ok(Math.abs(s3.funds[1].rt1 - 750) < 1, `05:00 应冻结在 750，got ${s3.funds[1].rt1}`);

console.log('day-open-settle-window tests: passed');
