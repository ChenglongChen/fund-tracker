import { fetchFundGz, fetchFundNavInfo } from './market.js';
import { consensusNavDate, reconcileFundNav } from './nav.js';
import { beijingDateString, beijingTimeHm } from './time.js';
import { holdingProfitPct, readPortfolio, writePortfolio } from './store.js';
import { recordLiveSnapshot, readAppState } from './app-state.js';
import { computePortfolioTotals } from './aggregate.js';
import { getLiveCache } from './live.js';

/**
 * 取 fundgz 与东财移动端 API 中较新的净值快照（fundgz 常滞后半天）
 * @param {object} fund
 */
async function loadNavSnapshot(fund) {
  const [gz, navInfo] = await Promise.all([fetchFundGz(fund.code), fetchFundNavInfo(fund.code)]);

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
    const consensus = consensusNavDate(portfolio.funds);
    if (consensus) {
      portfolio.meta.snapshotDate = consensus;
      portfolio.meta.snapshotLabel = portfolio.meta.snapshotLabel || '东财净值自动入账';
    }
    portfolio.meta.beijingDate = beijingDateString();
    portfolio.meta.lastAutoSettleAt = new Date().toISOString();
    portfolio.meta.autoSettleSource = 'fundgz.1234567.com.cn+eastmoney';
    await writePortfolio(portfolio);

    const live = getLiveCache();
    const totals = computePortfolioTotals(portfolio, live.funds ?? []);
    const appState = await readAppState();
    await recordLiveSnapshot({
      beijingDate: beijingDateString(),
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
  const portfolio = await readPortfolio();
  return runSettlement(portfolio);
}
