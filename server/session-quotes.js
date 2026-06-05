/**
 * 分市场会话行情：开盘用实时价，休市冻结最近收盘涨跌幅。
 */
import { isValidQuote, quoteForHolding } from './quotes.js';
import {
  classifyHoldingMarket,
  holdingCacheKey,
  getHoldingSessionPhase,
  getUsSessionPhase,
  isHoldingQuoteLive,
} from './holding-market.js';
import {
  normalizeJpTicker,
  rememberAsiaPrevClose,
  supplementAsiaQuotes,
  normalizeEuStooqSymbol,
} from './asia-quotes.js';
import {
  getHoldingRegular,
  getIndexRegular,
  rememberHoldingRegular,
  rememberIndexRegular,
  seedHoldingRegularSnapshots,
  seedIndexRegularSnapshots,
} from './impact-snapshots.js';
import { getQqqPremarketPct } from './gb-quote-parse.js';

export { supplementAsiaQuotes };

/** @type {Map<string, { changePct: number, price: number|null, at: number }>} */
const closeSnapshot = new Map();

/** @type {Map<string, { changePct: number, price: number|null, at: number }>} */
const regularCloseSnapshot = new Map();

function ensureRegularSnapFromDisk(cacheKey) {
  if (regularCloseSnapshot.has(cacheKey)) return;
  const disk = getHoldingRegular(cacheKey);
  if (disk && Number.isFinite(disk.changePct)) {
    regularCloseSnapshot.set(cacheKey, {
      changePct: disk.changePct,
      price: disk.price ?? null,
      at: disk.at ?? Date.now(),
      source: 'disk',
    });
  }
}

function resolveUsExtendedFields(q, quoteSession, regularSnap, market) {
  if (market !== 'us' && market !== 'other') {
    return { changePctRegular: q.changePct, changePctPremarket: null };
  }
  if (quoteSession === 'regular') {
    return { changePctRegular: q.changePct, changePctPremarket: null };
  }
  let changePctRegular =
    q.changePctRegular != null && Number.isFinite(q.changePctRegular) ? q.changePctRegular : null;
  if (changePctRegular == null && regularSnap && isValidQuote(regularSnap) && regularSnap.source !== 'live') {
    changePctRegular = regularSnap.changePct;
  }
  const changePctPremarket =
    q.changePctPremarket != null && Number.isFinite(q.changePctPremarket) ? q.changePctPremarket : null;
  return { changePctRegular, changePctPremarket };
}

/**
 * @param {object[]} holdings
 * @param {Record<string, object>} byHoldingKey
 * @param {Date} [now]
 */
export function applySessionQuotes(holdings, byHoldingKey, now = new Date()) {
  return holdings.map((h) => {
    const market = classifyHoldingMarket(h);
    const quoteSession = getHoldingSessionPhase(market, now);
    const closeSession = quoteSession === 'regular' ? 'closed' : quoteSession;
    const open = isHoldingQuoteLive(market, now);
    const cacheKey = `${holdingCacheKey(h)}|${market}`;
    const q = quoteForHolding(h, byHoldingKey);

    if (open && q && isValidQuote(q)) {
      const snap = {
        changePct: q.changePct,
        price: q.price ?? null,
        at: now.getTime(),
        source: 'live',
      };
      if (quoteSession === 'regular') {
        regularCloseSnapshot.set(cacheKey, {
          changePct: q.changePctRegular ?? q.changePct,
          price: q.price ?? null,
          at: now.getTime(),
          source: 'regular',
        });
        closeSnapshot.set(cacheKey, snap);
        rememberHoldingRegular(cacheKey, {
          changePct: q.changePctRegular ?? q.changePct,
          price: q.price ?? null,
          at: now.getTime(),
        });
      } else {
        ensureRegularSnapFromDisk(cacheKey);
        closeSnapshot.set(cacheKey, snap);
      }
      const quoteSource = q.quoteSource || '';
      if (
        (market === 'jp' || market === 'kr' || market === 'eu') &&
        snap.price != null &&
        quoteSource !== 'tencent-us-adr'
      ) {
        const ticker =
          market === 'jp'
            ? normalizeJpTicker(h.code, h.name)
            : market === 'eu'
              ? normalizeEuStooqSymbol(h.code, h.name)?.split('.')[0]?.toUpperCase()
              : String(h.code).padStart(6, '0');
        if (ticker) rememberAsiaPrevClose(ticker, snap.price);
      }
      const regularSnap = regularCloseSnapshot.get(cacheKey);
      const { changePctRegular, changePctPremarket } = resolveUsExtendedFields(
        q,
        quoteSession,
        regularSnap,
        market,
      );
      return {
        ...h,
        name: h.name || q.name,
        changePct: q.changePct,
        changePctRegular,
        changePctPremarket,
        price: q.price ?? h.price,
        quoteSource: q.quoteSource || 'sina',
        quoteMode: 'live',
        quoteSession,
        holdingMarket: market,
      };
    }

    if (open) {
      return {
        ...h,
        holdingMarket: market,
        quoteMode: 'missing',
        quoteSession,
        changePct: null,
        changePctRegular: null,
        changePctPremarket: null,
      };
    }

    const frozen = closeSnapshot.get(cacheKey);
    if (frozen && isValidQuote(frozen)) {
      const regularSnap = regularCloseSnapshot.get(cacheKey);
      let changePctRegular = frozen.changePct;
      let changePctPremarket = null;
      if (market === 'us' || market === 'other') {
        if (regularSnap && isValidQuote(regularSnap) && regularSnap.source !== 'live') {
          changePctRegular = regularSnap.changePct;
        } else if (closeSession === 'premarket' || closeSession === 'afterhours') {
          changePctRegular = null;
        }
      }
      return {
        ...h,
        changePct: frozen.changePct,
        changePctRegular,
        changePctPremarket,
        price: frozen.price ?? h.price,
        quoteSource: 'session-close',
        quoteMode: 'close',
        quoteSession: closeSession,
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
        changePctRegular: q.changePct,
        price: q.price ?? h.price,
        quoteSource: q.quoteSource || 'sina',
        quoteMode: 'close',
        quoteSession: closeSession,
        holdingMarket: market,
      };
    }

    ensureRegularSnapFromDisk(cacheKey);
    const diskRegular = regularCloseSnapshot.get(cacheKey);
    if (diskRegular && isValidQuote(diskRegular)) {
      return {
        ...h,
        changePct: diskRegular.changePct,
        changePctRegular: diskRegular.changePct,
        price: diskRegular.price ?? h.price,
        quoteSource: 'disk-regular',
        quoteMode: 'close',
        quoteSession: closeSession,
        holdingMarket: market,
      };
    }

    return { ...h, holdingMarket: market, quoteMode: 'missing', quoteSession: closeSession };
  });
}

/** @type {Map<string, { changePct: number, price: number|null, change: number|null } | number>} */
const stripCloseSnapshot = new Map();

/** @type {Map<string, { changePct: number, price: number|null, change: number|null }>} */
const stripRegularSnapshot = new Map();

export function seedSessionQuoteSnapshots() {
  seedHoldingRegularSnapshots(regularCloseSnapshot);
  seedIndexRegularSnapshots(stripRegularSnapshot);
}

/** @param {string} [label] @param {Date} [now] */
export function getIndexSessionRegular(label = '纳斯达克100', now = new Date()) {
  const usPhase = getUsSessionPhase(now);
  if (usPhase !== 'regular') {
    const closeSnap = stripCloseSnapshot.get(label);
    const closePct =
      typeof closeSnap === 'number' ? closeSnap : closeSnap?.changePct ?? null;
    if (closePct != null && Number.isFinite(closePct)) return closePct;
  }
  const snap = stripRegularSnapshot.get(label);
  if (snap?.changePct != null && Number.isFinite(snap.changePct)) return snap.changePct;
  const disk = getIndexRegular(label);
  return disk?.changePct ?? null;
}

/** @param {import('./market-indices.js').StripMarket} market @param {Date} now */
function isStripMarketOpen(market, now) {
  if (market === 'fx') return true;
  return isHoldingQuoteLive(market, now);
}

/** @param {import('./market-indices.js').StripMarket} market @param {Date} now */
function stripSessionPhase(market, now) {
  if (market === 'fx') return 'regular';
  return getHoldingSessionPhase(market, now);
}

function stripSnapshotFrom(item) {
  return {
    changePct: item.changePct,
    price: item.price ?? null,
    change: item.change ?? null,
  };
}

/**
 * @param {Array<{ label: string, changePct: number|null, price?: number|null, change?: number|null, market?: string }>} strip
 * @param {Date} [now]
 */
export function applySessionMarketStrip(strip, now = new Date()) {
  return strip.map((item) => {
    const phase = item.market ? stripSessionPhase(item.market, now) : 'regular';
    const open = item.market ? isStripMarketOpen(item.market, now) : true;

    if (
      !open &&
      item.market === 'us' &&
      phase !== 'regular' &&
      item.changePct != null &&
      Number.isFinite(item.changePct)
    ) {
      const regularPct = item.changePctRegular ?? item.changePct;
      const snap = {
        changePct: regularPct,
        price: item.price ?? null,
        change: item.change ?? null,
      };
      stripCloseSnapshot.set(item.label, snap);
      stripRegularSnapshot.set(item.label, snap);
      rememberIndexRegular(item.label, { changePct: regularPct, price: snap.price });
    }

    if (open && item.changePct != null && Number.isFinite(item.changePct)) {
      const snap = stripSnapshotFrom(item);
      const diskRegular = getIndexRegular(item.label);
      if (phase === 'regular') {
        const regularPct = item.changePctRegular ?? item.changePct;
        const regularSnap = { ...snap, changePct: regularPct };
        stripRegularSnapshot.set(item.label, regularSnap);
        stripCloseSnapshot.set(item.label, regularSnap);
        rememberIndexRegular(item.label, { changePct: regularPct, price: item.price ?? null });
      } else {
        const regularPct = item.changePctRegular ?? item.changePct;
        if (
          item.market === 'us' &&
          regularPct != null &&
          Number.isFinite(regularPct)
        ) {
          const regularSnap = { ...snap, changePct: regularPct };
          stripCloseSnapshot.set(item.label, regularSnap);
          stripRegularSnapshot.set(item.label, regularSnap);
          rememberIndexRegular(item.label, { changePct: regularPct, price: item.price ?? null });
        } else if (!stripRegularSnapshot.has(item.label) && diskRegular && Number.isFinite(diskRegular.changePct)) {
          stripRegularSnapshot.set(item.label, {
            changePct: diskRegular.changePct,
            price: diskRegular.price ?? null,
            change: null,
          });
        } else if (
          !stripRegularSnapshot.has(item.label) &&
          item.changePct != null &&
          Number.isFinite(item.changePct)
        ) {
          stripRegularSnapshot.set(item.label, {
            changePct: regularPct,
            price: item.price ?? null,
            change: item.change ?? null,
          });
          rememberIndexRegular(item.label, { changePct: regularPct, price: item.price ?? null });
        }
        if (!stripCloseSnapshot.has(item.label)) {
          stripCloseSnapshot.set(item.label, snap);
        }
      }
      const regularSnap = stripRegularSnapshot.get(item.label);
      const parsedRegular =
        item.changePctRegular != null &&
        Number.isFinite(item.changePctRegular) &&
        item.changePctRegular !== 0
          ? item.changePctRegular
          : null;
      let changePctRegular =
        phase === 'regular'
          ? parsedRegular ?? item.changePct
          : parsedRegular ??
            (regularSnap?.changePct != null && Number.isFinite(regularSnap.changePct)
              ? regularSnap.changePct
              : item.market === 'us'
                ? item.changePct
                : null);
      let changePctPremarket = null;
      if (phase === 'premarket' || phase === 'afterhours') {
        if (item.changePctPremarket != null && Number.isFinite(item.changePctPremarket) && item.changePctPremarket !== 0) {
          changePctPremarket = item.changePctPremarket;
        } else {
          changePctPremarket = getQqqPremarketPct();
        }
      }
      return {
        ...item,
        changePctRegular,
        changePctPremarket,
        quoteSession: phase,
        quoteMode: 'live',
      };
    }
    const frozen = stripCloseSnapshot.get(item.label);
    if (frozen != null) {
      const snap = typeof frozen === 'number' ? { changePct: frozen, price: null, change: null } : frozen;
      const regularSnap = stripRegularSnapshot.get(item.label);
      if (Number.isFinite(snap.changePct)) {
        return {
          ...item,
          changePct: snap.changePct,
          changePctRegular:
            regularSnap?.changePct != null && Number.isFinite(regularSnap.changePct)
              ? regularSnap.changePct
              : snap.changePct,
          price: snap.price ?? item.price ?? null,
          change: snap.change ?? item.change ?? null,
          quoteMode: 'close',
          quoteSession: 'closed',
        };
      }
    }
    return { ...item, quoteMode: item.changePct != null ? 'close' : 'missing', quoteSession: 'closed' };
  });
}
