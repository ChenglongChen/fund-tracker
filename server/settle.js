import { fetchFundGz, fetchFundNavInfo } from './market.js';
import { consensusNavDate, reconcileFundNav } from './nav.js';
import { beijingDateString, beijingTimeHm, beijingIsoString } from './time.js';
import { holdingProfitPct, readPortfolio, writePortfolio } from './store.js';
import { recordLiveSnapshot, readAppState } from './app-state.js';
import { recordFundSettle } from './profit-ledger.js';
import { creditDayForSettle } from './profit-attribution.js';
import { computePortfolioTotals } from './aggregate.js';
import { getLiveCache } from './live.js';
import { ensureDayBaseline } from './day-display-state.js';
import { isScreenshotMode } from './screenshot-bundle.js';
import { isFundMetricsLive } from './fund-metrics-live.js';

/**
 * 取 fundgz 与东财移动端 API 中较新的净值快照（fundgz 常滞后半天）
 * @param {object} fund
 */
async function loadNavSnapshot(fund) {
  const [gz, navInfo] = await Promise.all([
    fetchFundGz(fund.code),
    fetchFundNavInfo(fund.code, { maxAgeMs: 0 }),
  ]);

  /** @type {{ nav: number, navDate: string, navChgRt: number|null, source: string } | null} */
  let best = null;

  if (gz && Number.isFinite(gz.dwjz) && gz.jzrq) {
    best = { nav: gz.dwjz, navDate: gz.jzrq, navChgRt: null, source: 'fundgz' };
  }

  if (navInfo?.nav && navInfo?.pdate) {
    const candidate = {
      nav: navInfo.nav,
      navDate: navInfo.pdate,
      navChgRt: navInfo.navChgRt ?? null,
      source: 'eastmoney',
    };
    if (!best || candidate.navDate > best.navDate) best = candidate;
  }

  return best;
}

/**
 * 当公布净值日期推进时，按份额自动入账。
 * @param {{ meta: object, funds: object[] }} portfolio
 * @param {{ dryRun?: boolean }} opts
 */
export async function runSettlement(portfolio, opts = {}) {
  const { dryRun = false } = opts;
  const events = [];
  let changed = false;

  for (const fund of portfolio.funds) {
    if (!isFundMetricsLive(fund, new Date())) {
      events.push({ code: fund.code, status: 'skip', reason: 'before_metrics_live_from' });
      continue;
    }

    const snap = await loadNavSnapshot(fund);
    if (!snap) {
      events.push({ code: fund.code, status: 'skip', reason: '净值不可用' });
      continue;
    }

    const nav = snap.nav;
    const navDate = snap.navDate;
    const lastDate = fund.lastNavDate || null;

    if (!fund.shares || !Number.isFinite(fund.shares)) {
      if (nav > 0 && fund.amount > 0) {
        fund.shares = fund.amount / nav;
        fund.lastNav = nav;
        fund.lastNavDate = navDate;
        events.push({
          code: fund.code,
          status: 'init_shares',
          shares: fund.shares,
          navDate,
        });
        changed = true;
      }
      continue;
    }

    if (lastDate && navDate <= lastDate) {
      events.push({ code: fund.code, status: 'unchanged', navDate, lastDate });
      continue;
    }

    const prevNav = fund.lastNav ?? nav;
    const profit = fund.shares * (nav - prevNav);
    const newAmount = fund.shares * nav;

    events.push({
      code: fund.code,
      fundId: fund.id,
      status: 'settled',
      navDate,
      prevNavDate: lastDate,
      prevNav,
      nav,
      profit,
      oldAmount: fund.amount,
      newAmount,
    });

    if (!dryRun) {
      fund.yesterdayProfit = profit;
      fund.amount = newAmount;
      fund.totalProfit = (fund.totalProfit ?? 0) + profit;
      fund.totalProfitPct = holdingProfitPct(fund);
      fund.lastNav = nav;
      fund.lastNavDate = navDate;
      changed = true;
    }
  }

  for (const fund of portfolio.funds) {
    if (!isFundMetricsLive(fund, new Date())) continue;
    const reconciled = await reconcileFundNav(fund, { dryRun });
    if (reconciled.changed) {
      changed = true;
      events.push({
        code: fund.code,
        status: 'reconciled',
        navDate: reconciled.navDate,
        navChgRt: reconciled.navChgRt,
        oldProfit: reconciled.oldProfit,
        newProfit: reconciled.newProfit,
      });
    }
  }

  if (changed && !dryRun) {
    ensureDayBaseline(portfolio);
    const creditDay = creditDayForSettle();
    /** @type {object[]} */
    const settleRecords = [];
    for (const ev of events) {
      if (ev.status !== 'settled' || ev.fundId == null) continue;
      const fund = portfolio.funds.find((f) => f.id === ev.fundId);
      if (!fund) continue;
      settleRecords.push({
        fundId: fund.id,
        accountId: fund.accountId,
        code: fund.code,
        creditDay,
        navDate: ev.navDate,
        settledProfit: ev.profit,
        settledAssetsAfter: fund.amount,
        source: 'settle',
      });
    }
    const consensus = consensusNavDate(portfolio.funds);
    if (consensus) {
      portfolio.meta.snapshotDate = consensus;
      portfolio.meta.snapshotLabel = portfolio.meta.snapshotLabel || '东财净值自动入账';
    }
    portfolio.meta.beijingDate = beijingDateString();
    portfolio.meta.lastAutoSettleAt = beijingIsoString();
    portfolio.meta.autoSettleSource = 'fundgz.1234567.com.cn+eastmoney';
    await writePortfolio(portfolio);

    for (const rec of settleRecords) {
      await recordFundSettle(rec);
    }

    const live = getLiveCache();
    const totals = computePortfolioTotals(portfolio, live.funds ?? []);
    const appState = await readAppState();
    const calendarDay = consensus ?? beijingDateString();
    await recordLiveSnapshot({
      beijingDate: calendarDay,
      updatedAt: beijingTimeHm(),
      ...totals,
      assetViewMode: appState.assetViewMode,
      settled: true,
    });
  }

  return { changed, events };
}

/** 服务启动或定时任务入口 */
export async function settleIfNeeded() {
  if (isScreenshotMode()) return { changed: false, events: [] };
  const portfolio = await readPortfolio();
  return runSettlement(portfolio);
}
