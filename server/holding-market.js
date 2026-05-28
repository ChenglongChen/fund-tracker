/**
 * 单只持仓所属市场及交易时段（北京时间）。
 */
import { beijingMinutesOfDay, beijingParts, beijingWeekday } from './time.js';
import { isLikelyKoreanHolding } from './quotes.js';

/** @typedef {'cn'|'hk'|'us'|'jp'|'kr'|'tw'|'eu'|'gold_cn'|'other'} HoldingMarket */

/** @param {{ hour: string, minute: string }} parts */
function minutesOfDay(parts) {
  return Number(parts.hour) * 60 + Number(parts.minute);
}

function isWeekday(date) {
  const wd = beijingWeekday(date);
  return wd >= 1 && wd <= 5;
}

/** A 股：9:30–11:30、13:00–15:00（收市时刻起不含） */
export function isCnHoldingMarketOpen(date = new Date()) {
  if (!isWeekday(date)) return false;
  const mins = beijingMinutesOfDay(date);
  return (
    (mins >= 9 * 60 + 30 && mins < 11 * 60 + 30) ||
    (mins >= 13 * 60 && mins < 15 * 60)
  );
}

/** 港股：9:30–12:00、13:00–16:00（收市时刻起不含） */
export function isHkMarketOpen(date = new Date()) {
  if (!isWeekday(date)) return false;
  const mins = beijingMinutesOfDay(date);
  return (
    (mins >= 9 * 60 + 30 && mins < 12 * 60) ||
    (mins >= 13 * 60 && mins < 16 * 60)
  );
}

/** 日股：8:00–10:30、11:30–14:00（东京 9:00–11:30 / 12:30–15:00 JST） */
export function isJpMarketOpen(date = new Date()) {
  if (!isWeekday(date)) return false;
  const mins = minutesOfDay(beijingParts(date));
  return (
    (mins >= 8 * 60 && mins < 10 * 60 + 30) ||
    (mins >= 11 * 60 + 30 && mins <= 14 * 60)
  );
}

/** 日股午间休市：10:30–11:30（东京 11:30–12:30 JST） */
export function isJpMiddayBreak(date = new Date()) {
  if (!isWeekday(date)) return false;
  const mins = minutesOfDay(beijingParts(date));
  return mins >= 10 * 60 + 30 && mins < 11 * 60 + 30;
}

/** 韩股：8:30–14:30 北京时间（首尔 9:30–15:30 KST） */
export function isKrMarketOpen(date = new Date()) {
  if (!isWeekday(date)) return false;
  const mins = minutesOfDay(beijingParts(date));
  return mins >= 8 * 60 + 30 && mins <= 14 * 60 + 30;
}

/** 欧股（法/德等）：15:00–23:30 北京时间（夏令时近似 9:00–17:30 CET/CEST） */
export function isEuMarketOpen(date = new Date()) {
  if (!isWeekday(date)) return false;
  const mins = minutesOfDay(beijingParts(date));
  return mins >= 15 * 60 && mins <= 23 * 60 + 30;
}

/** 美股：21:30–次日 04:00 北京时间（正盘） */
export function isUsHoldingMarketOpen(date = new Date()) {
  const wd = beijingWeekday(date);
  const mins = minutesOfDay(beijingParts(date));
  const eveningStart = 21 * 60 + 30;
  const morningEnd = 4 * 60;
  if (mins >= eveningStart) return wd >= 1 && wd <= 5;
  if (mins < morningEnd) return wd >= 2 && wd <= 6;
  return false;
}

/** @typedef {'premarket'|'regular'|'afterhours'|'closed'} UsSessionPhase */

/**
 * 美股交易阶段（北京时间，固定窗口近似美东 DST）
 * 仅正盘 21:30–04:00；其余时段 closed（无盘前/盘后）
 * @param {Date} [date]
 * @returns {UsSessionPhase}
 */
export function getUsSessionPhase(date = new Date()) {
  const wd = beijingWeekday(date);
  const mins = minutesOfDay(beijingParts(date));
  const eveningStart = 21 * 60 + 30;
  const morningEnd = 4 * 60;

  if (mins >= eveningStart && wd >= 1 && wd <= 5) return 'regular';
  if (mins < morningEnd && wd >= 2 && wd <= 6) return 'regular';
  return 'closed';
}

/** @param {Date} [date] */
export function isUsQuoteLive(date = new Date()) {
  return getUsSessionPhase(date) !== 'closed';
}

/** A 股午间休市：11:30–13:00 */
export function isCnMiddayBreak(date = new Date()) {
  if (!isWeekday(date)) return false;
  const mins = beijingMinutesOfDay(date);
  return mins >= 11 * 60 + 30 && mins < 13 * 60;
}

/** 港股午间休市：12:00–13:00 */
export function isHkMiddayBreak(date = new Date()) {
  if (!isWeekday(date)) return false;
  const mins = beijingMinutesOfDay(date);
  return mins >= 12 * 60 && mins < 13 * 60;
}

/** @typedef {'premarket'|'regular'|'afterhours'|'midday'|'closed'} HoldingSessionPhase */

/** @param {HoldingMarket} market @param {Date} [date] */
export function getHoldingSessionPhase(market, date = new Date()) {
  if (market === 'us' || market === 'other') return getUsSessionPhase(date);
  if ((market === 'cn' || market === 'tw') && isCnMiddayBreak(date)) return 'midday';
  if (market === 'hk' && isHkMiddayBreak(date)) return 'midday';
  if (market === 'jp' && isJpMiddayBreak(date)) return 'midday';
  if (isHoldingMarketOpen(market, date)) return 'regular';
  return 'closed';
}

/** @param {HoldingMarket} market @param {Date} [date] */
export function isHoldingQuoteLive(market, date = new Date()) {
  return getHoldingSessionPhase(market, date) === 'regular';
}

/** @param {Date} [date] */
export function usSessionPhaseLabel(phase) {
  if (phase === 'premarket') return '盘前';
  if (phase === 'regular') return '盘中';
  if (phase === 'afterhours') return '盘后';
  return '已收盘';
}

/** 任一海外市场（美/日/韩/港）有可刷新行情 */
export function isOverseasSessionOpen(date = new Date()) {
  return (
    isUsQuoteLive(date) ||
    isJpMarketOpen(date) ||
    isKrMarketOpen(date) ||
    isHkMarketOpen(date) ||
    isEuMarketOpen(date)
  );
}

/** 亚太正盘（日/韩/港），不含 A 股 */
export function isAsiaPacificSessionOpen(date = new Date()) {
  return isJpMarketOpen(date) || isKrMarketOpen(date) || isHkMarketOpen(date);
}

/** 国内黄金：日盘 9:00–15:30；夜盘 20:00–次日 02:30 */
export function isGoldCnHoldingMarketOpen(date = new Date()) {
  if (!isWeekday(date)) return false;
  const wd = beijingWeekday(date);
  const mins = minutesOfDay(beijingParts(date));
  const dayStart = 9 * 60;
  const dayEnd = 15 * 60 + 30;
  const nightStart = 20 * 60;
  const nightEnd = 2 * 60 + 30;
  if (mins >= dayStart && mins <= dayEnd) return true;
  if (mins >= nightStart && wd >= 1 && wd <= 5) return true;
  if (mins < nightEnd && wd >= 2 && wd <= 6) return true;
  return false;
}

/** @param {HoldingMarket} market @param {Date} [date] */
export function isHoldingMarketOpen(market, date = new Date()) {
  switch (market) {
    case 'cn':
      return isCnHoldingMarketOpen(date);
    case 'hk':
      return isHkMarketOpen(date);
    case 'jp':
      return isJpMarketOpen(date);
    case 'kr':
      return isKrMarketOpen(date);
    case 'eu':
      return isEuMarketOpen(date);
    case 'us':
      return isUsHoldingMarketOpen(date);
    case 'gold_cn':
      return isGoldCnHoldingMarketOpen(date);
    case 'tw':
      return isCnHoldingMarketOpen(date);
    default:
      return isUsHoldingMarketOpen(date);
  }
}

/** @param {{ code?: string, name?: string, marketId?: number|null, source?: string }} h */
export function classifyHoldingMarket(h) {
  const code = String(h.code || '').trim();
  const name = String(h.name || '');
  const mid = h.marketId;

  if (/黄金|AU9999|Gold/i.test(name) || code === 'AU9999') return 'gold_cn';
  if (mid === 0 || mid === 1) return 'cn';
  if (mid === 116) return 'hk';
  if (mid === 106) {
    // 东财 106：台股或美股 ADR（如 TSM）；字母 ticker 按美股时段
    if (/^[A-Za-z][A-Za-z0-9.-]*$/i.test(code)) return 'us';
    return 'tw';
  }
  if (/^\d{3,4}[A-Z]?JP$/i.test(code)) return 'jp';
  if (isLikelyKoreanHolding(code, name)) return 'kr';
  if (/日本|东京|东洋|株式会社|铠侠|NITTO|日産|丰田|索尼|软银|Keyence|东京电子|日本电产|揖斐电|藤仓|古河|佑能|三井金属|奥加诺/i.test(name)) {
    return 'jp';
  }
  if (/^JP/i.test(code)) return 'jp';
  if (/^[A-Z]{2,}FP$/i.test(code) || /^[A-Z]{2,}GR$/i.test(code)) return 'eu';
  if (/爱马仕|Herm[eè]s|空客|Airbus|莱茵金属|Rheinmetall/i.test(name)) return 'eu';
  if (mid === 105 || /^[A-Z][A-Z0-9.-]*$/i.test(code)) return 'us';
  if (/^77(09|47)$/.test(code) || /南方两倍做多|CSOP.*2x/i.test(name)) return 'hk';
  if (/^\d{6}$/.test(code)) {
    if (code.startsWith('6') || code.startsWith('0') || code.startsWith('3')) return 'cn';
  }
  return 'other';
}

/** @param {{ code?: string, name?: string }} h */
export function holdingCacheKey(h) {
  return `${String(h.code || '').trim()}\0${String(h.name || '').trim()}`;
}
