import { fetchFundNavInfo } from './market.js';
import { DAILY_NAV_EXPECT_HOUR } from './profit-pending.js';
import { dayProfitPct } from './store.js';
import { beijingParts } from './time.js';

/** @param {{ hour: string, minute: string }} parts */
function minutesOfDay(parts) {
  return Number(parts.hour) * 60 + Number(parts.minute);
}

/** 东财 NAVCHGRT 为 (新净值 − 旧净值) / 旧净值；amount 已含当日收益 */
export function profitFromNavChgRt(amount, navChgRt) {
  if (!Number.isFinite(amount) || !Number.isFinite(navChgRt)) return null;
  return (amount * navChgRt) / (100 + navChgRt);
}

/**
 * 按东财公布净值日计算单日收益。
 * - pdate === lastNavDate：amount 已含该日涨跌
 * - pdate > lastNavDate：amount 为上一公布日收盘资产，按份额或金额 × 涨跌幅
 * @param {object} fund
 * @param {{ pdate: string, navChgRt: number, nav?: number } | null} info
 */
export function profitForPublishedNavDay(fund, info) {
  if (!info?.pdate || !Number.isFinite(info.navChgRt) || !Number.isFinite(fund.amount)) {
    return null;
  }

  const lastDate = fund.lastNavDate ?? null;

  if (lastDate && info.pdate === lastDate) {
    return profitFromNavChgRt(fund.amount, info.navChgRt);
  }

  if (lastDate && info.pdate > lastDate) {
    if (
      fund.shares &&
      fund.lastNav &&
      Number.isFinite(fund.shares) &&
      Number.isFinite(fund.lastNav) &&
      Number.isFinite(info.nav)
    ) {
      return fund.shares * (info.nav - fund.lastNav);
    }
    if (fund.shares && fund.lastNav && Number.isFinite(fund.shares) && Number.isFinite(fund.lastNav)) {
      return fund.shares * fund.lastNav * (info.navChgRt / 100);
    }
    return (fund.amount * info.navChgRt) / 100;
  }

  if (!lastDate) {
    return profitFromNavChgRt(fund.amount, info.navChgRt);
  }

  return null;
}

/**
 * @param {object} fund
 * @param {{ pdate: string, navChgRt: number, nav?: number } | null} info
 */
export function enrichFundSettled(fund, info) {
  const profit = profitForPublishedNavDay(fund, info);

  if (info?.pdate && profit != null && Number.isFinite(info.navChgRt)) {
    return {
      settledNavDate: info.pdate,
      settledProfit: profit,
      settledPct: info.navChgRt,
      settledSource: 'eastmoney',
    };
  }

  const navDate = fund.lastNavDate ?? info?.pdate ?? null;
  return {
    settledNavDate: navDate,
    settledProfit: fund.yesterdayProfit ?? null,
    settledPct: dayProfitPct(fund.amount, fund.yesterdayProfit),
    settledSource: 'portfolio',
  };
}

/**
 * pending 时：若只是在等更晚预期净值日，仍展示上一已入账日收益；东财超前公布未 settle 则 —。
 * @param {object} fund
 * @param {ReturnType<typeof enrichFundSettled>} settled
 * @param {{ pdate?: string } | null} navInfo
 * @param {boolean} dailyPending
 * @param {Date} [now]
 */
export function resolveDisplayedSettledFields(fund, settled, navInfo, dailyPending, now = new Date()) {
  if (!dailyPending) return settled;

  const mins = minutesOfDay(beijingParts(now));
  if (mins < DAILY_NAV_EXPECT_HOUR * 60) {
    const profit = fund.yesterdayProfit ?? settled.settledProfit ?? null;
    if (profit != null && Number.isFinite(profit)) {
      return {
        settledNavDate: fund.lastNavDate ?? settled.settledNavDate ?? null,
        settledProfit: profit,
        settledPct: dayProfitPct(fund.amount, profit),
        settledSource: 'portfolio',
      };
    }
  }

  return {
    settledNavDate: fund.lastNavDate ?? settled.settledNavDate ?? null,
    settledProfit: null,
    settledPct: null,
    settledSource: settled.settledSource ?? 'portfolio',
  };
}

/**
 * 用东财公布 NAVCHGRT 校正 yesterdayProfit（常见：手动导入与公布净值不一致）
 * @param {object} fund
 * @param {{ dryRun?: boolean }} opts
 */
export async function reconcileFundNav(fund, opts = {}) {
  const { dryRun = false } = opts;
  const info = await fetchFundNavInfo(fund.code);
  if (!info || !fund.lastNavDate || info.pdate !== fund.lastNavDate) {
    return { changed: false, code: fund.code, reason: 'nav_date_mismatch' };
  }
  if (!Number.isFinite(info.navChgRt) || !Number.isFinite(fund.amount)) {
    return { changed: false, code: fund.code, reason: 'no_nav_chgrt' };
  }

  const correct = profitFromNavChgRt(fund.amount, info.navChgRt);
  if (correct == null) return { changed: false, code: fund.code, reason: 'calc_failed' };

  const prev = fund.yesterdayProfit ?? 0;
  if (Math.abs(prev - correct) < 0.02) {
    return { changed: false, code: fund.code, reason: 'already_ok', navChgRt: info.navChgRt };
  }

  if (!dryRun) {
    fund.yesterdayProfit = Math.round(correct * 100) / 100;
    // totalProfit 是累计持有收益，与单日 yesterdayProfit 校正无关，不可联动修改
  }

  return {
    changed: true,
    code: fund.code,
    navDate: info.pdate,
    navChgRt: info.navChgRt,
    oldProfit: prev,
    newProfit: correct,
  };
}

/** @param {object[]} funds */
export function consensusNavDate(funds) {
  /** @type {Map<string, number>} */
  const counts = new Map();
  for (const f of funds) {
    if (!f.lastNavDate) continue;
    counts.set(f.lastNavDate, (counts.get(f.lastNavDate) ?? 0) + 1);
  }
  let best = null;
  let bestN = 0;
  for (const [date, n] of counts) {
    if (n > bestN) {
      best = date;
      bestN = n;
    }
  }
  return best;
}
