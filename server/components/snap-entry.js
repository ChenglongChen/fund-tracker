/**
 * 单基金 snap 条目：seed 时从 liveRow 复制 estimateProfit（唯一 writer 的 ep）。
 */
import { round2 } from '../day-display-state.js';
import { getFundRegular } from '../impact-snapshots.js';
import { shouldSuppressDomesticRealtimeDisplay } from './suppress.js';
import { isScopeSnapReady } from './snap-ready.js';
import {
  isUsIndexStyleFund,
  shouldUseLiveUsIndexStyle,
  resolveUsIndexCloseImpactPct,
} from './snap-index-style.js';

/**
 * @param {object} fund
 * @param {object} liveRow
 * @param {object} impactRaw
 * @param {string} market
 * @param {Date} now
 */
export function buildFundSnapEntry(fund, liveRow, impactRaw, market, now) {
  const amount = fund.amount ?? 0;
  const amountAtSnap = amount;
  if (shouldSuppressDomesticRealtimeDisplay(market, now)) {
    return {
      rt1: null,
      rt2: null,
      amountAtSnap,
      impactPctRegular: null,
      market,
    };
  }
  const rowCtx = { ...liveRow, market };
  const isIndexStyle = isUsIndexStyleFund(rowCtx);
  const useLiveIndex = shouldUseLiveUsIndexStyle(rowCtx, now);
  const src = String(liveRow?.impactSource ?? liveRow?.estimateSource ?? '');
  const isHoldingsStyle = src === 'holdings' || src === 'ensemble';
  const preferRegularSnapshot =
    (isIndexStyle && !useLiveIndex) ||
    (!isIndexStyle &&
      !isHoldingsStyle &&
      liveRow?.shouldRefreshLiveRt1 === false &&
      liveRow?.hasRegularHolding !== true);
  let rt1Live =
    liveRow?.estimateProfit != null && Number.isFinite(liveRow.estimateProfit)
      ? round2(liveRow.estimateProfit)
      : null;
  // eod seed：穿透/融合优先用 16:00 liveRow，不得回退 stale regularSnapshot
  if ((preferRegularSnapshot && !isHoldingsStyle) || rt1Live == null) {
    const snapPct = isIndexStyle
      ? resolveUsIndexCloseImpactPct(rowCtx, (id) => getFundRegular(id))
      : getFundRegular(fund.id) ??
        liveRow?.impactPctRegular ??
        impactRaw?.impactPctRegular ??
        null;
    if (snapPct != null && Number.isFinite(snapPct) && amount > 0) {
      rt1Live = round2((amount * snapPct) / 100);
    }
  }
  const rt2 =
    liveRow?.realTimeProfitExtended != null && Number.isFinite(liveRow.realTimeProfitExtended)
      ? round2(liveRow.realTimeProfitExtended)
      : null;
  return {
    rt1: rt1Live != null ? round2(rt1Live) : null,
    rt2: rt2 != null ? round2(rt2) : null,
    amountAtSnap,
    impactPctRegular:
      liveRow?.impactPctRegular ??
      liveRow?.impactPctRegularLive ??
      liveRow?.rawImpactPct ??
      impactRaw?.impactPctRegular ??
      impactRaw?.impactPct ??
      null,
    market,
  };
}

/** @param {object} snap @param {{ funds: object[] }} portfolio @param {object[]} liveFunds @param {Date} now */
export function sessionSnapNeedsReseed(snap, portfolio, liveFunds, now) {
  if (!isScopeSnapReady(snap, now)) return true;
  // eod_freeze(16:00–21:30) 仅 suppress 变化可 reseed；不得因穿透 drift / 重启覆盖 16:00 snap
  for (const f of portfolio.funds) {
    const liveRow = liveFunds.find((x) => x.id === f.id);
    const market = liveRow?.market ?? 'cn';
    const entry = snap.funds?.[f.id] ?? snap.funds?.[String(f.id)];
    const suppressed = shouldSuppressDomesticRealtimeDisplay(market, now);
    if (suppressed && entry?.rt1 != null) return true;
  }
  return false;
}
