/**
 * 展示层唯一流水线：per-fund 计算 → snap 状态机 → snap 应用 → 组合求和。
 * refreshLive 与测试均应调用本模块，避免 live.js 与 snap 组件各自拼装。
 */
import { computePortfolioTotals } from './aggregate.js';
import {
  applyFundRt1Snap,
  applyPortfolioTotalsSnap,
} from './components/snap-apply.js';
import { reconcileDisplayState } from './components/snap-seed.js';
import { getCurrentPhase } from './day-display-state.js';
import { resolveDisplaySession } from './display-session.js';
import { finalizeLiveFundDisplayRow } from './components/suppress.js';
import { buildDisplayFundRow, buildDisplayFundRowFallback } from './fund-display.js';

/**
 * @param {{ funds: object[] }} portfolio
 * @param {object[]} impactRawList
 * @param {object[]} navInfos
 * @param {string} beijingDate
 * @param {Date} now
 */
export function buildDisplayFundRows(portfolio, impactRawList, navInfos, beijingDate, now) {
  return portfolio.funds.map((f, idx) => {
    try {
      return buildDisplayFundRow(f, impactRawList[idx] ?? {}, navInfos[idx] ?? null, beijingDate, now);
    } catch {
      return buildDisplayFundRowFallback(f, navInfos[idx] ?? null, beijingDate, now);
    }
  });
}

/**
 * snap 应用 + 组合合计（不含 reconcile / backfill）
 * @param {{ funds: object[] }} portfolio
 * @param {object[]} liveRows
 * @param {Date} now
 */
export function applyDisplaySnapAndTotals(portfolio, liveRows, now = new Date(), session = null) {
  const s = session ?? resolveDisplaySession(now, { persistedPhase: getCurrentPhase() });
  const accrualDay = s.accrualDay;
  const funds = liveRows.map((row) =>
    finalizeLiveFundDisplayRow(applyFundRt1Snap(row.id, row, accrualDay, now), now),
  );
  let totals = applyPortfolioTotalsSnap(
    computePortfolioTotals(portfolio, funds, now),
    accrualDay,
    now,
  );
  return { funds, totals, accrualDay, session: s };
}

/**
 * @param {{ funds: object[] }} portfolio
 * @param {object[]} impactRawList
 * @param {object[]} navInfos
 * @param {string} beijingDate
 * @param {Date} now
 */
export async function runLiveDisplayPipeline(portfolio, impactRawList, navInfos, beijingDate, now) {
  const session = resolveDisplaySession(now, { persistedPhase: getCurrentPhase() });
  let funds = buildDisplayFundRows(portfolio, impactRawList, navInfos, beijingDate, now);

  const totalsPre = computePortfolioTotals(portfolio, funds, now);
  const displayState = reconcileDisplayState(
    portfolio,
    funds,
    totalsPre,
    impactRawList,
    now,
    session,
  );

  const snapped = applyDisplaySnapAndTotals(portfolio, funds, now, session);
  return {
    funds: snapped.funds,
    totals: snapped.totals,
    displayState,
    accrualDay: session.accrualDay,
    session,
  };
}

/**
 * 切换资产口径或 cache 重算 totals（不重新拉穿透）
 * @param {{ funds: object[] }} portfolio
 * @param {object[]} cachedFunds
 * @param {Date} [now]
 */
export function reapplyDisplayFromCachedFunds(portfolio, cachedFunds, now = new Date()) {
  return applyDisplaySnapAndTotals(portfolio, cachedFunds, now);
}
