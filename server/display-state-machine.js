import { getUsSessionPhase } from './holding-market.js';
import { beijingDateString, beijingMinutesOfDay } from './time.js';
import { readAppState } from './app-state.js';
import {
  ensureDayBaseline,
  getActiveScopeSnap,
  getBaselineForDay,
  getRt1AccrualDay,
  getScopeSnap,
  isRt1SnapPhase,
  round2,
  setCurrentPhase,
  setScopeSnap,
  clearScopeSnap,
} from './day-display-state.js';
import { fundEstimateProfit, liveImpactForEstimate } from './fund-estimate.js';

/** @param {Date} [now] */
function inferTargetPhase(now = new Date()) {
  const usPhase = getUsSessionPhase(now);
  const mins = beijingMinutesOfDay(now);

  if (usPhase === 'afterhours') return 'afterhours_freeze';
  if (usPhase === 'premarket') return 'premarket_freeze';
  if (usPhase === 'regular') return 'us_regular_live';

  if (mins >= 8 * 60 && mins < 16 * 60) return 'asia_live';
  if (usPhase === 'closed' && mins >= 8 * 60) return 'eod_freeze';
  return 'day_open';
}

/**
 * @param {object} fund
 * @param {object} liveRow
 * @param {object} impactRaw
 * @param {string} market
 * @param {Date} now
 */
function buildFundSnapEntry(fund, liveRow, impactRaw, market, now) {
  const amount = fund.amount ?? 0;
  const amountAtSnap = amount;
  const liveForEst = liveImpactForEstimate(impactRaw, market);
  const rt1Live = fundEstimateProfit(amount, liveForEst, now);
  const extPct = impactRaw?.impactPctExtended ?? liveRow?.impactPctExtendedLive ?? null;
  const rt2 =
    extPct != null && Number.isFinite(extPct)
      ? round2((amount * extPct) / 100)
      : liveRow?.realTimeProfitExtended ?? null;
  return {
    rt1: rt1Live != null ? round2(rt1Live) : null,
    rt2: rt2 != null ? round2(rt2) : null,
    amountAtSnap,
    impactPctRegular: liveRow?.impactPctRegular ?? impactRaw?.impactPctRegular ?? null,
  };
}

/**
 * @param {{ funds: object[] }} portfolio
 * @param {object[]} liveFunds
 * @param {object} totalsLive
 * @param {object[]} impactRawList
 * @param {Date} [now]
 */
export function reconcileDisplayState(portfolio, liveFunds, totalsLive, impactRawList = [], now = new Date()) {
  ensureDayBaseline(portfolio, now);
  const accrualDay = getRt1AccrualDay(now);
  const beijingDate = beijingDateString(now);
  const targetPhase = inferTargetPhase(now);
  const usPhase = getUsSessionPhase(now);

  const snapKey =
    usPhase === 'afterhours'
      ? 'afterhoursSnap'
      : usPhase === 'premarket'
        ? 'premarketSnap'
        : null;

  if (snapKey && !getScopeSnap(accrualDay, snapKey, 'portfolio')) {
    /** @type {Record<string, object>} */
    const fundsSnap = {};
    for (let i = 0; i < portfolio.funds.length; i++) {
      const f = portfolio.funds[i];
      const liveRow = liveFunds.find((x) => x.id === f.id) ?? liveFunds[i];
      const raw = impactRawList[i] ?? {};
      const market = liveRow?.market ?? 'cn';
      fundsSnap[f.id] = buildFundSnapEntry(f, liveRow, raw, market, now);
    }
    const baseline = getBaselineForDay(accrualDay, 'portfolio') ?? totalsLive.settledAssets;
    const rt1 = round2(totalsLive.realtimeProfit ?? 0);
    setScopeSnap(accrualDay, snapKey, 'portfolio', {
      at: new Date().toISOString(),
      rt1,
      est: round2(baseline + rt1),
      funds: fundsSnap,
    });
  }

  if (targetPhase === 'eod_freeze' && !getScopeSnap(accrualDay, 'eodSnap', 'portfolio')) {
    const baseline = getBaselineForDay(accrualDay, 'portfolio') ?? totalsLive.settledAssets;
    const rt1 = round2(totalsLive.realtimeProfit ?? 0);
    setScopeSnap(accrualDay, 'eodSnap', 'portfolio', {
      at: new Date().toISOString(),
      rt1,
      est: round2(baseline + rt1),
      funds: {},
    });
  }

  if (usPhase === 'regular') {
    clearScopeSnap(accrualDay, 'premarketSnap', 'portfolio');
    setCurrentPhase('us_regular_live', now);
  } else if (snapKey === 'premarketSnap') {
    setCurrentPhase('premarket_freeze', now);
  } else if (snapKey === 'afterhoursSnap') {
    setCurrentPhase('afterhours_freeze', now);
  } else {
    setCurrentPhase(targetPhase, now);
  }

  return {
    accrualDay,
    beijingDate,
    phase: targetPhase,
    snapKey,
    activeSnap: snapKey ? getScopeSnap(accrualDay, snapKey, 'portfolio') : null,
  };
}

/**
 * Try backfill premarket snap from intraday ticks before first seed.
 * @param {string} accrualDay
 * @param {string} snapKey
 */
export async function tryBackfillSnapFromTicks(accrualDay, snapKey) {
  if (getScopeSnap(accrualDay, snapKey, 'portfolio')) return false;
  const appState = await readAppState();
  const ticks = appState.intradayTicks ?? [];
  const cutoff = snapKey === 'premarketSnap' ? '16:00' : '04:00';
  const candidates = ticks
    .filter((t) => t.beijingDate === accrualDay && t.updatedAt <= cutoff)
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  const hit = candidates[0];
  if (!hit || hit.realtimeProfit == null) return false;

  const baseline = getBaselineForDay(accrualDay, 'portfolio') ?? hit.settledAssets ?? 0;
  setScopeSnap(accrualDay, snapKey, 'portfolio', {
    at: hit.at ?? new Date().toISOString(),
    rt1: round2(hit.realtimeProfit),
    est: round2(hit.realtimeAssets ?? baseline + hit.realtimeProfit),
    funds: {},
    provisional: true,
  });
  return true;
}

/**
 * @param {number} fundId
 * @param {object} liveRow
 * @param {string} accrualDay
 * @param {Date} [now]
 */
export function applyFundRt1Snap(fundId, liveRow, accrualDay, now = new Date()) {
  if (!isRt1SnapPhase(now)) return liveRow;
  const snap = getActiveScopeSnap(accrualDay, now, 'portfolio');
  if (!snap) return liveRow;

  const fundSnap = snap.funds?.[fundId] ?? snap.funds?.[String(fundId)];
  if (fundSnap?.rt1 == null) return liveRow;

  const rt1 = fundSnap.rt1;
  const amount = fundSnap.amountAtSnap ?? liveRow.amount ?? 0;
  const pct = amount > 0 ? round2((rt1 / amount) * 10000) / 100 : null;

  return {
    ...liveRow,
    estimateProfit: rt1,
    estimateImpactPct: pct ?? liveRow.estimateImpactPct,
    impactPctRegular: fundSnap.impactPctRegular ?? liveRow.impactPctRegular,
    estimateAssets: round2(amount + rt1),
    displaySnap: true,
  };
}

/**
 * @param {object} totalsLive
 * @param {string} accrualDay
 * @param {Date} [now]
 */
export function applyPortfolioTotalsSnap(totalsLive, accrualDay, now = new Date()) {
  if (!isRt1SnapPhase(now)) {
    const baseline = getBaselineForDay(accrualDay, 'portfolio');
    if (baseline != null && totalsLive.realtimeProfit != null) {
      return {
        ...totalsLive,
        realtimeAssets: round2(baseline + totalsLive.realtimeProfit),
        baseline,
        liveMode: 'live',
        estimateFrozen: false,
      };
    }
    return { ...totalsLive, liveMode: 'live', estimateFrozen: false };
  }

  const snap = getActiveScopeSnap(accrualDay, now, 'portfolio');
  if (!snap) {
    const baseline = getBaselineForDay(accrualDay, 'portfolio');
    if (baseline != null && totalsLive.realtimeProfit != null) {
      return {
        ...totalsLive,
        realtimeAssets: round2(baseline + totalsLive.realtimeProfit),
        baseline,
        liveMode: 'live',
        estimateFrozen: false,
      };
    }
    return { ...totalsLive, liveMode: 'live', estimateFrozen: false };
  }

  const baseline =
    getBaselineForDay(accrualDay, 'portfolio') ??
    getBaselineForDay(beijingDateString(now), 'portfolio') ??
    totalsLive.settledAssets;
  const rt1 = snap.rt1 ?? totalsLive.realtimeProfit;
  const est = snap.est ?? round2(baseline + rt1);

  return {
    ...totalsLive,
    settledAssets: totalsLive.settledAssets,
    realtimeProfit: rt1,
    realtimeProfitPct:
      baseline > 0 ? round2((rt1 / baseline) * 10000) / 100 : totalsLive.realtimeProfitPct,
    realtimeAssets: est,
    baseline,
    liveMode: 'snap',
    estimateFrozen: true,
    snap,
  };
}

/**
 * @param {object[]} liveFunds
 * @param {Date} [now]
 */
export function sumExtendedProfit(liveFunds, now = new Date()) {
  const usPhase = getUsSessionPhase(now);
  if (usPhase !== 'premarket' && usPhase !== 'afterhours') {
    return { total: 0, pct: null, session: null };
  }
  let total = 0;
  let assets = 0;
  for (const f of liveFunds) {
    const ext = f.realTimeProfitExtended;
    if (ext != null && Number.isFinite(ext)) total += ext;
    if (f.market === 'us') assets += f.amount ?? 0;
  }
  return {
    total: round2(total),
    pct: assets > 0 ? round2((total / assets) * 10000) / 100 : null,
    session: usPhase,
  };
}
