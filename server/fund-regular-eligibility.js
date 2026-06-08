/**
 * 逐基金正盘门控：仅 regular 持仓（或无穿透时基金自身市场 regular）才 live 更新 row1。
 */
import {
  classifyFundMarket,
  isCnMiddayBreak,
  isRealtimeMarketOpen,
} from './components/market-hours.js';
import {
  classifyHoldingMarket,
  getHoldingSessionPhase,
  getUsSessionPhase,
} from './holding-market.js';

/**
 * 穿透持仓：任一 holding 处于 regular 正盘。
 * @param {object[]} holdings
 * @param {Date} [now]
 */
export function fundHasRegularHolding(holdings, now = new Date()) {
  if (!holdings?.length) return false;
  for (const h of holdings) {
    const market = h.holdingMarket ?? classifyHoldingMarket(h);
    if (getHoldingSessionPhase(market, now) === 'regular') return true;
  }
  return false;
}

/**
 * row1 / 穿透是否应 live 刷新（snap 门控）。
 * @param {{ code?: string, name?: string }} fund
 * @param {{ holdings?: object[] }} pack
 * @param {string|null} [impactSource]
 * @param {Date} [now]
 */
export function fundShouldRefreshLiveRt1(fund, pack, impactSource = null, now = new Date()) {
  const holdings = pack?.holdings ?? [];
  if (holdings.length) return fundHasRegularHolding(holdings, now);

  if (impactSource === 'holdings' || impactSource === 'ensemble') return false;

  const market = classifyFundMarket(fund);
  if (market === 'us') return getUsSessionPhase(now) === 'regular';
  if (market === 'cn' || market === 'gold_cn') return isRealtimeMarketOpen(market, now);
  return false;
}

/**
 * 是否需拉持仓行情：row1 regular 或美股 extended row2。
 * @param {{ code?: string, name?: string }} fund
 * @param {{ holdings?: object[] }} pack
 * @param {string|null} [impactSource]
 * @param {Date} [now]
 */
export function fundNeedsHoldingQuoteRefresh(fund, pack, impactSource = null, now = new Date()) {
  if (fundShouldRefreshLiveRt1(fund, pack, impactSource, now)) return true;
  const market = classifyFundMarket(fund);
  if (
    (market === 'cn' || market === 'gold_cn') &&
    isCnMiddayBreak(now) &&
    (pack?.holdings?.length ?? 0) > 0
  ) {
    return true;
  }
  if (market === 'us' && pack?.holdings?.length) return true;
  if (market !== 'us' || !pack?.holdings?.length) return false;
  return false;
}
