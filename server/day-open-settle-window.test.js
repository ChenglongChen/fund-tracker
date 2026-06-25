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

// 05:00 窗口外但正盘涨跌幅漂移（如冷启动缺汇率 0.75 → 汇率到位 0.90）：drift-heal 应 re-seed 跟进
const s3 = reconcileAt(t0500, 0.9);
assert.ok(Math.abs(s3.funds[1].rt1 - 900) < 1, `05:00 regular 漂移应 drift-heal 到 ≈900，got ${s3.funds[1].rt1}`);
assert.equal(getBaselineForDay(accrualDay, 'portfolio'), baseline0, 'drift-heal 须保留 B[D]');

// 旧版本可能已写入 impactPctRegular=0.90，但 rt1 仍是旧公式/旧值（例如缺 FX 的 750）。
// 即使 pct 无漂移，也要用 pct 校验 rt1 并修复。
s3.funds[1].rt1 = 750;
const s3b = reconcileAt(t0500, 0.9);
assert.ok(Math.abs(s3b.funds[1].rt1 - 900) < 1, `rt1/pct 不一致应自动修复到 ≈900，got ${s3b.funds[1].rt1}`);

// 05:30 同 0.90（无漂移）但 amount 变化（模拟 settle 入账）：impactPctRegular 不变 → 不 re-seed
portfolio.funds[0].amount = 105000;
const s4 = reconcileAt(t0500, 0.9);
assert.ok(Math.abs(s4.funds[1].rt1 - 900) < 1, `settle(仅 amount 变) 不应触发 re-seed，rt1 仍 ≈900，got ${s4.funds[1].rt1}`);
assert.equal(getBaselineForDay(accrualDay, 'portfolio'), baseline0, 'settle 不得改 B[D]');

console.log('day-open-settle-window tests: passed');
