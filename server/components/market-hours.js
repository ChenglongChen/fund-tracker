/**
 * 各市场交易时段判定与基金市场分类。
 */
import { beijingMinutesOfDay, beijingParts, beijingWeekday } from '../time.js';
import { getUsSessionPhase, isUsQuoteLive, usSessionPhaseLabel } from '../holding-market.js';
import { isHkMarketOpen, isJpMarketOpen, isKrMarketOpen } from '../holding-market.js';

/** @typedef {'cn' | 'us' | 'gold_cn'} MarketType */

export { beijingWeekday };

/** @param {{ hour: string, minute: string }} parts */
function minutesOfDay(parts) {
  return Number(parts.hour) * 60 + Number(parts.minute);
}

/** @param {object} fund @returns {MarketType} */
export function classifyFundMarket(fund) {
  const name = String(fund.name || '');
  if (
    /纳斯达克|纳指|标普|全球|QDII|科技互联网|科技先锋|全球精选|成长精选|产业升级|新兴市场|博时标普|国富全球|华夏全球|富国全球|广发全球|汇添富纳斯达克|嘉实全球|易方达全球|大成纳斯达克|南方纳斯达克|华安纳斯达克|建信新兴/.test(
      name,
    )
  ) {
    return 'us';
  }
  return 'cn';
}

export function isCnMarketOpen(date = new Date()) {
  const wd = beijingWeekday(date);
  if (wd === 0 || wd === 6) return false;
  const mins = beijingMinutesOfDay(date);
  return (
    (mins >= 9 * 60 + 30 && mins < 11 * 60 + 30) ||
    (mins >= 13 * 60 && mins < 15 * 60)
  );
}

export function isUsMarketOpen(date = new Date()) {
  const wd = beijingWeekday(date);
  const mins = minutesOfDay(beijingParts(date));
  const eveningStart = 21 * 60 + 30;
  const morningEnd = 4 * 60;
  if (mins >= eveningStart) return wd >= 1 && wd <= 5;
  if (mins < morningEnd) return wd >= 2 && wd <= 6;
  return false;
}

export function isGoldCnMarketOpen(date = new Date()) {
  const wd = beijingWeekday(date);
  const mins = minutesOfDay(beijingParts(date));
  const dayStart = 9 * 60;
  const dayEnd = 15 * 60 + 30;
  const nightStart = 20 * 60;
  const nightEnd = 2 * 60 + 30;
  if (wd === 0 || wd === 6) return false;
  if (mins >= dayStart && mins <= dayEnd) return true;
  if (mins >= nightStart) return wd >= 1 && wd <= 5;
  if (mins < nightEnd) return wd >= 2 && wd <= 6;
  return false;
}

/** @param {MarketType} market @param {Date} [date] */
export function isMarketOpen(market, date = new Date()) {
  if (market === 'cn') return isCnMarketOpen(date);
  if (market === 'us') return isUsMarketOpen(date);
  if (market === 'gold_cn') return isGoldCnMarketOpen(date);
  return false;
}

export function isCnMiddayBreak(date = new Date()) {
  const wd = beijingWeekday(date);
  if (wd === 0 || wd === 6) return false;
  const mins = beijingMinutesOfDay(date);
  return mins >= 11 * 60 + 30 && mins < 13 * 60;
}

export function isUsFundImpactLive(now = new Date()) {
  return getUsSessionPhase(now) === 'regular';
}

export function isFundImpactLiveWindow(market, now = new Date()) {
  if (market === 'cn') return isCnMarketOpen(now) || isCnMiddayBreak(now);
  if (market === 'gold_cn') return isGoldCnMarketOpen(now) || isCnMiddayBreak(now);
  if (market === 'us') return isUsFundImpactLive(now);
  return false;
}

/** @param {Date} [now] */
export function isDomesticRealtimeSession(now = new Date()) {
  const wd = beijingWeekday(now);
  if (wd === 0 || wd === 6) return false;
  const mins = minutesOfDay(beijingParts(now));
  return mins >= 9 * 60 + 30;
}

/** @param {MarketType} market @param {Date} [date] */
export function isRealtimeMarketOpen(market, date = new Date()) {
  if (market === 'us') return isUsFundImpactLive(date);
  if (market === 'cn') return isCnMarketOpen(date) || isCnMiddayBreak(date);
  if (market === 'gold_cn') {
    return isGoldCnMarketOpen(date) || isCnMiddayBreak(date);
  }
  return isMarketOpen(market, date);
}

/** @param {Date} [now] */
export function marketChipLabel(now = new Date()) {
  /** @type {Map<string, string[]>} */
  const byPhase = new Map();
  const add = (phase, market) => {
    if (!byPhase.has(phase)) byPhase.set(phase, []);
    byPhase.get(phase).push(market);
  };

  if (isCnMarketOpen(now) || isCnMiddayBreak(now)) add('盘中', 'A股');
  if (isHkMarketOpen(now)) add('盘中', '港股');
  if (isJpMarketOpen(now) || isKrMarketOpen(now)) add('盘中', '亚太');

  const usPhase = getUsSessionPhase(now);
  if (usPhase !== 'closed') add(usSessionPhaseLabel(usPhase), '美股');

  if (!byPhase.size) return '休市';

  const phaseOrder = ['盘中', '盘前', '盘后'];
  /** @type {string[]} */
  const segments = [];
  for (const phase of phaseOrder) {
    const markets = byPhase.get(phase);
    if (markets?.length) segments.push(`${phase} · ${markets.join('/')}`);
  }
  return segments.join(' / ');
}

/** @param {Date} [now] */
export function openMarketLabels(now = new Date()) {
  /** @type {string[]} */
  const out = [];
  if (isCnMarketOpen(now) || isCnMiddayBreak(now)) out.push('A股');
  if (isHkMarketOpen(now)) out.push('港股');
  if (isJpMarketOpen(now) || isKrMarketOpen(now)) out.push('亚太');
  if (isUsQuoteLive(now)) out.push('美股');
  return out;
}

/** @param {string} iso YYYY-MM-DD @returns {string} MM-DD */
export function fmtMd(iso) {
  if (!iso) return '';
  const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[2]}-${m[3]}` : iso;
}
