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
/** @type {Map<number, number>} */
const fundPremarketRegularSnapshot = new Map();
/** @type {string|null} */
let premarketSnapshotBeijingDate = null;
/** @type {string|null} */
let sessionRegularSnapshotPhase = null;

/** @param {number|null|undefined} fundId @param {number|null|undefined} rawRegular @param {string} beijingDate @param {'premarket'|'afterhours'|'overnight'} sessionPhase */
function resolveSessionRegularSnapshot(fundId, rawRegular, beijingDate, sessionPhase) {
  if (
    premarketSnapshotBeijingDate !== beijingDate ||
    sessionRegularSnapshotPhase !== sessionPhase
  ) {
    fundPremarketRegularSnapshot.clear();
    premarketSnapshotBeijingDate = beijingDate;
    sessionRegularSnapshotPhase = sessionPhase;
  }
  if (fundId == null) return rawRegular ?? null;
  if (fundPremarketRegularSnapshot.has(fundId)) {
    return fundPremarketRegularSnapshot.get(fundId);
  }
  const seeded =
    rawRegular != null && Number.isFinite(rawRegular)
      ? rawRegular
      : getFundRegularImpactPct(fundId);
  if (seeded != null && Number.isFinite(seeded)) {
    fundPremarketRegularSnapshot.set(fundId, seeded);
    rememberFundRegular(fundId, seeded);
  }
  return seeded ?? null;
}

function resolvePremarketRegularSnapshot(fundId, rawRegular, beijingDate) {
  return resolveSessionRegularSnapshot(fundId, rawRegular, beijingDate, 'premarket');
}

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
  const isUsExtended =
    usPhase === 'premarket' || usPhase === 'afterhours' || usPhase === 'overnight';

  if (live && hasRaw) {
    if (fundId != null) {
      if (market === 'us' && usPhase === 'regular') {
        fundImpactRegularSnapshot.set(fundId, rawImpactPct);
        fundImpactCloseSnapshot.set(fundId, rawImpactPct);
        rememberFundRegular(fundId, rawImpactPct);
      } else if (isUsExtended) {
        fundImpactCloseSnapshot.set(fundId, rawImpactPct);
        if (!fundImpactRegularSnapshot.has(fundId) && (usPhase === 'afterhours' || usPhase === 'overnight')) {
          const disk = getFundRegular(fundId);
          if (disk != null && Number.isFinite(disk)) {
            fundImpactRegularSnapshot.set(fundId, disk);
          }
        }
      } else {
        fundImpactCloseSnapshot.set(fundId, rawImpactPct);
      }
    }
    return rawImpactPct;
  }

  if (fundId != null && fundImpactCloseSnapshot.has(fundId)) {
    return fundImpactCloseSnapshot.get(fundId);
  }

  if (market === 'us' && (usPhase === 'premarket' || usPhase === 'overnight') && fundId != null) {
    const disk = getFundRegular(fundId);
    if (disk != null && Number.isFinite(disk)) return disk;
  }

  if (hasRaw && fundId != null) {
    if (market === 'us' && (usPhase === 'premarket' || usPhase === 'overnight')) return null;
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

  if (market === 'us' && usPhase === 'premarket') {
    const beijingDate = beijingDateString(now);
    const impactPctRegular = resolvePremarketRegularSnapshot(fundId, rawRegular, beijingDate);
    const impactPctExtended = rawExtended;
    const impactPct = impactPctRegular;
    return {
      impactPct,
      impactPctRegular,
      impactPctExtended,
      impactSession: 'premarket',
      rawImpactPct: rawTotal,
    };
  }

  if (market === 'us' && usPhase === 'afterhours') {
    const beijingDate = beijingDateString(now);
    const impactPctRegular = resolveSessionRegularSnapshot(
      fundId,
      rawRegular,
      beijingDate,
      'afterhours',
    );
    const impactPctExtended = rawExtended;
    const impactPct = impactPctRegular;
    return {
      impactPct,
      impactPctRegular,
      impactPctExtended,
      impactSession: 'afterhours',
      rawImpactPct: rawTotal,
    };
  }

  if (market === 'us' && usPhase === 'overnight') {
    const beijingDate = beijingDateString(now);
    const impactPctRegular = resolveSessionRegularSnapshot(
      fundId,
      rawRegular,
      beijingDate,
      'overnight',
    );
    const impactPctExtended = rawExtended;
    const impactPct = impactPctRegular;
    return {
      impactPct,
      impactPctRegular,
      impactPctExtended,
      impactSession: 'overnight',
      rawImpactPct: rawTotal,
    };
  }

  let impactPct = resolveFundImpactPct(fundId, market, rawTotal, now);
  let impactPctRegular = rawRegular;
  let impactPctExtended = rawExtended;
  let impactSession = impactResult?.impactSession ?? (market === 'us' ? usPhase : 'closed');
  if (impactPctRegular == null && impactPct != null && impactSession === 'regular') {
    impactPctRegular = impactPct;
  }
  if (market !== 'us') {
    if (impactSession === 'premarket' || impactSession === 'afterhours' || impactSession === 'overnight') {
      impactSession = 'closed';
    }
    impactPctExtended = null;
    if (impactPctRegular == null && impactPct != null) {
      impactPctRegular = impactPct;
    }
  }
  return {
    impactPct,
    impactPctRegular,
    impactPctExtended,
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
    fundPremarketRegularSnapshot.clear();
    premarketSnapshotBeijingDate = null;
    sessionRegularSnapshotPhase = null;
    return;
  }
  for (const id of fundIds) {
    fundImpactCloseSnapshot.delete(id);
    fundPremarketRegularSnapshot.delete(id);
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
