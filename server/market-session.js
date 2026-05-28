/**
 * 展示层 display impact：穿透 pct → 列表/详情用的 impact 字段（非 estimateProfit）。
 * suppress / 收口见 components/suppress.js；交易时段见 components/market-hours.js。
 */
import { beijingDateString, beijingIsoAddDays, beijingParts, beijingWeekday } from './time.js';
import { isJpMarketOpen, isKrMarketOpen, isHkMarketOpen } from './holding-market.js';
import { getFundRegular, rememberFundRegular } from './impact-snapshots.js';
import { resolveDisplaySession } from './display-session.js';
import { shouldSuppressDomesticRealtimeDisplay } from './components/suppress.js';
import {
  classifyFundMarket,
  fmtMd,
  isFundImpactLiveWindow,
  isRealtimeMarketOpen,
} from './components/market-hours.js';

/** @typedef {'cn' | 'us' | 'gold_cn'} MarketType */

/** @param {{ hour: string, minute: string }} parts */
function minutesOfDay(parts) {
  return Number(parts.hour) * 60 + Number(parts.minute);
}

/** @type {Map<number, number>} */
const fundImpactCloseSnapshot = new Map();
/** @type {Map<number, number>} */
const fundImpactRegularSnapshot = new Map();

/** @param {number} fundId */
export function getFundRegularImpactPct(fundId) {
  if (fundId != null && fundImpactRegularSnapshot.has(fundId)) {
    return fundImpactRegularSnapshot.get(fundId);
  }
  return fundId != null ? getFundRegular(fundId) : null;
}

/** @param {Record<string, { impactPctRegular?: number }>} [fundSnaps] */
export function seedFundRegularSnapshots(fundSnaps = {}) {
  for (const [id, snap] of Object.entries(fundSnaps)) {
    if (snap?.impactPctRegular != null && Number.isFinite(snap.impactPctRegular)) {
      fundImpactRegularSnapshot.set(Number(id), snap.impactPctRegular);
    }
  }
}

export function resolveFundImpactPct(fundId, market, rawImpactPct, now = new Date()) {
  if (shouldSuppressDomesticRealtimeDisplay(market, now)) return null;

  const hasRaw = rawImpactPct != null && Number.isFinite(rawImpactPct);
  const live = isFundImpactLiveWindow(market, now);
  const session = resolveDisplaySession(now);
  const usPhase = market === 'us' ? session.usPhase : null;

  if (live && hasRaw) {
    if (fundId != null) {
      if (market === 'us' && usPhase === 'regular') {
        fundImpactRegularSnapshot.set(fundId, rawImpactPct);
        fundImpactCloseSnapshot.set(fundId, rawImpactPct);
        rememberFundRegular(fundId, rawImpactPct);
      } else {
        fundImpactCloseSnapshot.set(fundId, rawImpactPct);
      }
    }
    return rawImpactPct;
  }

  if (fundId != null && fundImpactCloseSnapshot.has(fundId)) {
    return fundImpactCloseSnapshot.get(fundId);
  }

  if (hasRaw && fundId != null) {
    fundImpactCloseSnapshot.set(fundId, rawImpactPct);
    return rawImpactPct;
  }
  return null;
}

export function resolveLiveDisplayImpact(fundId, market, impactResult, now = new Date()) {
  const rawTotal =
    impactResult?.impactPct != null && Number.isFinite(impactResult.impactPct)
      ? impactResult.impactPct
      : null;
  const rawRegular =
    impactResult?.impactPctRegular != null && Number.isFinite(impactResult.impactPctRegular)
      ? impactResult.impactPctRegular
      : null;
  const rawExtended =
    impactResult?.impactPctExtended != null && Number.isFinite(impactResult.impactPctExtended)
      ? impactResult.impactPctExtended
      : null;
  const session = resolveDisplaySession(now);
  const usPhase = market === 'us' ? session.usPhase : null;

  let impactPct = resolveFundImpactPct(fundId, market, rawTotal, now);
  let impactPctRegular = rawRegular;
  let impactSession = impactResult?.impactSession ?? (market === 'us' ? usPhase : 'closed');
  if (impactPctRegular == null && impactPct != null && impactSession === 'regular') {
    impactPctRegular = impactPct;
  }
  if (market !== 'us') {
    if (impactSession === 'premarket' || impactSession === 'afterhours') {
      impactSession = 'closed';
    }
    if (impactPctRegular == null && impactPct != null) {
      impactPctRegular = impactPct;
    }
  }
  return {
    impactPct,
    impactPctRegular,
    impactPctExtended: null,
    impactSession,
    rawImpactPct: rawTotal,
  };
}

/** @deprecated 使用 resolveFundImpactPct */
export function effectiveImpactPct(market, rawImpactPct, now = new Date()) {
  return resolveFundImpactPct(null, market, rawImpactPct, now);
}

export function shouldDisplayRealtimeProfit(_market, _realtimeActive, impactPct) {
  return impactPct != null && Number.isFinite(impactPct);
}

export function clearFundImpactSnapshots(fundIds = null) {
  if (fundIds == null) {
    fundImpactCloseSnapshot.clear();
    return;
  }
  for (const id of fundIds) {
    fundImpactCloseSnapshot.delete(id);
  }
}

export const DAILY_NAV_EXPECT_HOUR = 18;

export function isDailyProfitPending(fund, market, navInfo, beijingDate, now = new Date()) {
  const wd = beijingWeekday(now);
  if (wd === 0 || wd === 6) return false;

  const lastNavDate = fund.lastNavDate ?? null;
  const officialDate = navInfo?.pdate ?? null;
  const mins = minutesOfDay(beijingParts(now));
  const yesterday = beijingIsoAddDays(beijingDate, -1);

  if (officialDate && lastNavDate && officialDate > lastNavDate) return true;
  if (!lastNavDate) return true;

  if (market === 'us') {
    if (mins < DAILY_NAV_EXPECT_HOUR * 60) return false;
    return lastNavDate < yesterday;
  }

  if (mins < DAILY_NAV_EXPECT_HOUR * 60) {
    return lastNavDate < yesterday;
  }
  return lastNavDate < beijingDate;
}

export function getDailyProfitMeta(fund, beijingDate, now = new Date()) {
  const market = classifyFundMarket(fund);
  const navDate = fund.lastNavDate ?? fund.settledNavDate ?? null;
  const mins = minutesOfDay(beijingParts(now));
  const evening = mins >= 15 * 60;

  if (market === 'us') {
    return {
      market,
      asOfDate: navDate,
      asOfLabel: navDate ? fmtMd(navDate) : '待更新',
      hint: '最新公布',
      eveningReady: Boolean(navDate),
    };
  }

  const asOfDate = navDate || (evening ? beijingDate : null);
  return {
    market,
    asOfDate,
    asOfLabel: asOfDate ? fmtMd(asOfDate) : evening ? fmtMd(beijingDate) : '待更新',
    hint: market === 'gold_cn' ? '当日' : '当日',
    eveningReady: evening && (navDate === beijingDate || !navDate),
  };
}

export function getFundProfitWindows(fund, beijingDate, now = new Date()) {
  const market = classifyFundMarket(fund);
  const realtimeActive = isRealtimeMarketOpen(market, now);
  const daily = getDailyProfitMeta(fund, beijingDate, now);
  let marketLabel = 'A股';
  if (market === 'gold_cn') marketLabel = '黄金';
  else if (market === 'us') {
    if (isJpMarketOpen(now) || isKrMarketOpen(now)) marketLabel = '亚太';
    else if (isHkMarketOpen(now)) marketLabel = '港股';
    else marketLabel = '美股';
  }
  return {
    market,
    realtimeActive,
    marketLabel,
    dailyAsOfDate: daily.asOfDate,
    dailyAsOfLabel: daily.asOfLabel,
    dailyHint: daily.hint,
  };
}
