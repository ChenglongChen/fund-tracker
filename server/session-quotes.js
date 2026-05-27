/**
 * 分市场会话行情：开盘用实时价，休市冻结最近收盘涨跌幅。
 */
import { isValidQuote, quoteForHolding } from './quotes.js';
import {
  classifyHoldingMarket,
  holdingCacheKey,
  isHoldingMarketOpen,
} from './holding-market.js';
import {
  normalizeJpTicker,
  rememberAsiaPrevClose,
  supplementAsiaQuotes,
} from './asia-quotes.js';

export { supplementAsiaQuotes };

/** @type {Map<string, { changePct: number, price: number|null, at: number }>} */
const closeSnapshot = new Map();

/**
 * @param {object[]} holdings
 * @param {Record<string, object>} byHoldingKey
 * @param {Date} [now]
 */
export function applySessionQuotes(holdings, byHoldingKey, now = new Date()) {
  return holdings.map((h) => {
    const market = classifyHoldingMarket(h);
    const open = isHoldingMarketOpen(market, now);
    const cacheKey = `${holdingCacheKey(h)}|${market}`;
    const q = quoteForHolding(h, byHoldingKey);

    if (open && q && isValidQuote(q)) {
      const snap = {
        changePct: q.changePct,
        price: q.price ?? null,
        at: now.getTime(),
      };
      closeSnapshot.set(cacheKey, snap);
      if ((market === 'jp' || market === 'kr') && snap.price != null) {
        const ticker =
          market === 'jp'
            ? normalizeJpTicker(h.code, h.name)
            : String(h.code).padStart(6, '0');
        if (ticker) rememberAsiaPrevClose(ticker, snap.price);
      }
      return {
        ...h,
        name: h.name || q.name,
        changePct: q.changePct,
        price: q.price ?? h.price,
        quoteSource: q.quoteSource || 'sina',
        quoteMode: 'live',
        holdingMarket: market,
      };
    }

    const frozen = closeSnapshot.get(cacheKey);
    if (frozen && isValidQuote(frozen)) {
      return {
        ...h,
        changePct: frozen.changePct,
        price: frozen.price ?? h.price,
        quoteSource: 'session-close',
        quoteMode: 'close',
        holdingMarket: market,
      };
    }

    if (q && isValidQuote(q)) {
      closeSnapshot.set(cacheKey, {
        changePct: q.changePct,
        price: q.price ?? null,
        at: now.getTime(),
      });
      return {
        ...h,
        name: h.name || q.name,
        changePct: q.changePct,
        price: q.price ?? h.price,
        quoteSource: q.quoteSource || 'sina',
        quoteMode: 'close',
        holdingMarket: market,
      };
    }

    return { ...h, holdingMarket: market, quoteMode: 'missing' };
  });
}

/** 指数/汇率条：休市时用上次收盘快照 */
const stripCloseSnapshot = new Map();

/** @param {import('./market-indices.js').StripMarket} market @param {Date} now */
function isStripMarketOpen(market, now) {
  if (market === 'fx') return true;
  return isHoldingMarketOpen(market, now);
}

/**
 * @param {Array<{ label: string, changePct: number|null, market?: string }>} strip
 * @param {Date} [now]
 */
export function applySessionMarketStrip(strip, now = new Date()) {
  return strip.map((item) => {
    const open = item.market ? isStripMarketOpen(item.market, now) : true;

    if (open && item.changePct != null && Number.isFinite(item.changePct)) {
      stripCloseSnapshot.set(item.label, item.changePct);
      return { ...item, quoteMode: 'live' };
    }
    const frozen = stripCloseSnapshot.get(item.label);
    if (frozen != null && Number.isFinite(frozen)) {
      return { ...item, changePct: frozen, quoteMode: 'close' };
    }
    return { ...item, quoteMode: item.changePct != null ? 'close' : 'missing' };
  });
}
