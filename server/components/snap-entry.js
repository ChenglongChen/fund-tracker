/**
 * 单基金 snap 条目：seed 时从 liveRow 复制 estimateProfit（唯一 writer 的 ep）。
 */
import { round2 } from '../day-display-state.js';
import { shouldSuppressDomesticRealtimeDisplay } from './suppress.js';
import { isScopeSnapReady } from './snap-ready.js';

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
  const rt1Live =
    liveRow?.estimateProfit != null && Number.isFinite(liveRow.estimateProfit)
      ? round2(liveRow.estimateProfit)
      : null;
  const rt2 =
    liveRow?.realTimeProfitExtended != null && Number.isFinite(liveRow.realTimeProfitExtended)
      ? round2(liveRow.realTimeProfitExtended)
      : null;
  return {
    rt1: rt1Live != null ? round2(rt1Live) : null,
    rt2: rt2 != null ? round2(rt2) : null,
    amountAtSnap,
    impactPctRegular: liveRow?.impactPctRegular ?? impactRaw?.impactPctRegular ?? null,
    market,
  };
}

/** @param {object} snap @param {{ funds: object[] }} portfolio @param {object[]} liveFunds @param {Date} now */
export function sessionSnapNeedsReseed(snap, portfolio, liveFunds, now) {
  if (!isScopeSnapReady(snap)) return true;
  for (const f of portfolio.funds) {
    const liveRow = liveFunds.find((x) => x.id === f.id);
    const market = liveRow?.market ?? 'cn';
    const entry = snap.funds?.[f.id] ?? snap.funds?.[String(f.id)];
    const suppressed = shouldSuppressDomesticRealtimeDisplay(market, now);
    if (suppressed && entry?.rt1 != null) return true;
    if (!suppressed && entry?.rt1 == null && liveRow?.estimateProfit != null) return true;
  }
  return false;
}
