/**
 * 展示层 display impact：穿透 pct → 列表/详情用的 impact 字段（非 estimateProfit）。
 * suppress / 收口见 components/suppress.js；交易时段见 components/market-hours.js。
 */
import { isJpMarketOpen, isKrMarketOpen, isHkMarketOpen } from './holding-market.js';
import { getFundRegular, rememberFundRegular } from './impact-snapshots.js';
import { resolveDisplaySession } from './display-session.js';
import { shouldSuppressDomesticRealtimeDisplay } from './components/suppress.js';
import {
  classifyFundMarket,
  fmtMd,
  isDomesticRealtimeSession,
  isFundImpactLiveWindow,
  isRealtimeMarketOpen,
} from './components/market-hours.js';
import {
  DAILY_NAV_EXPECT_HOUR,
  expectedNavDateForDailyDisplay,
  isDailyProfitPending,
} from './profit-pending.js';

export { DAILY_NAV_EXPECT_HOUR, expectedNavDateForDailyDisplay, isDailyProfitPending };

/** @typedef {'cn' | 'us' | 'gold_cn'} MarketType */

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
  const cnFrozenWindow =
    (market === 'cn' || market === 'gold_cn') &&
    isDomesticRealtimeSession(now) &&
    !isFundImpactLiveWindow(market, now);
  const session = resolveDisplaySession(now);
  const usPhase = market === 'us' ? session.usPhase : null;

  const rememberDomesticClose = (pct) => {
    if (fundId == null) return;
    fundImpactCloseSnapshot.set(fundId, pct);
    if (market === 'cn' || market === 'gold_cn') rememberFundRegular(fundId, pct);
  };

  if (live && hasRaw) {
    if (fundId != null) {
      if (market === 'us' && usPhase === 'regular') {
        fundImpactRegularSnapshot.set(fundId, rawImpactPct);
        fundImpactCloseSnapshot.set(fundId, rawImpactPct);
        rememberFundRegular(fundId, rawImpactPct);
      } else {
        rememberDomesticClose(rawImpactPct);
      }
    }
    return rawImpactPct;
  }

  // 美股正盘外但 raw composite 已就绪：不得读旧 close 快照。
  // 特别是 day_open 冷启动时，指数/FX 可能晚于 04:00 才就绪；snap seed 必须用最新 raw。
  if (
    (session.clockPhase === 'day_open' ||
      session.clockPhase === 'asia_live' ||
      session.clockPhase === 'eod_freeze') &&
    market === 'us' &&
    hasRaw
  ) {
    if (fundId != null) {
      fundImpactCloseSnapshot.set(fundId, rawImpactPct);
      rememberFundRegular(fundId, rawImpactPct);
    }
    return rawImpactPct;
  }

  if (fundId != null && fundImpactCloseSnapshot.has(fundId)) {
    return fundImpactCloseSnapshot.get(fundId);
  }

  if (cnFrozenWindow && fundId != null && !hasRaw) {
    const persisted = getFundRegularImpactPct(fundId);
    if (typeof persisted === 'number' && Number.isFinite(persisted)) return persisted;
    if (persisted?.impactPctRegular != null && Number.isFinite(persisted.impactPctRegular)) {
      return persisted.impactPctRegular;
    }
  }

  if (hasRaw && fundId != null) {
    if (cnFrozenWindow) {
      const persisted = getFundRegularImpactPct(fundId);
      if (typeof persisted === 'number' && Number.isFinite(persisted)) return persisted;
      if (fundImpactCloseSnapshot.has(fundId)) {
        return fundImpactCloseSnapshot.get(fundId);
      }
    }
    rememberDomesticClose(rawImpactPct);
    return rawImpactPct;
  }
  return null;
}

export function resolveLiveDisplayImpact(fundId, market, impactResult, now = new Date()) {
  const rawTotal =
    impactResult?.impactPct != null && Number.isFinite(impactResult.impactPct)
      ? impactResult.impactPct
      : impactResult?.holdingsImpactPct != null && Number.isFinite(impactResult.holdingsImpactPct)
        ? impactResult.holdingsImpactPct
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

export function getDailyProfitMeta(fund, beijingDate, now = new Date(), navInfo = null) {
  const market = classifyFundMarket(fund);
  const navDate = fund.lastNavDate ?? null;
  const pending = isDailyProfitPending(fund, market, navInfo, beijingDate, now);
  const expected = expectedNavDateForDailyDisplay(beijingDate, market, now);

  if (pending) {
    return {
      market,
      asOfDate: null,
      asOfLabel: '待更新',
      hint: '待更新',
      eveningReady: false,
    };
  }

  const isCurrent = Boolean(navDate && expected && navDate >= expected);
  return {
    market,
    asOfDate: navDate,
    asOfLabel: navDate ? fmtMd(navDate) : '待更新',
    hint: market === 'us' ? (isCurrent ? '当日' : '最新公布') : isCurrent ? '当日' : '最新公布',
    eveningReady: Boolean(navDate && navDate === beijingDate),
  };
}

export function getFundProfitWindows(fund, beijingDate, now = new Date(), navInfo = null) {
  const market = classifyFundMarket(fund);
  const realtimeActive = isRealtimeMarketOpen(market, now);
  const daily = getDailyProfitMeta(fund, beijingDate, now, navInfo);
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
