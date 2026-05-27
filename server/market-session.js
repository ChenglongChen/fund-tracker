import { beijingParts, beijingWeekday } from './time.js';
import {
  isHkMarketOpen,
  isJpMarketOpen,
  isKrMarketOpen,
  isOverseasSessionOpen,
} from './holding-market.js';

/** @typedef {'cn' | 'us' | 'gold_cn'} MarketType */

export { beijingWeekday };

/** @param {{ hour: string, minute: string }} parts */
function minutesOfDay(parts) {
  return Number(parts.hour) * 60 + Number(parts.minute);
}

/**
 * @param {object} fund
 * @returns {MarketType}
 */
export function classifyFundMarket(fund) {
  const name = String(fund.name || '');
  if (/黄金/.test(name)) return 'gold_cn';
  if (/红土创新|永赢科技智选/.test(name)) return 'cn';
  if (
    /纳斯达克|纳指|标普|全球|QDII|科技互联网|科技先锋|全球精选|成长精选|产业升级|新兴市场|博时标普|国富全球|华夏全球|富国全球|广发全球|汇添富纳斯达克|嘉实全球|易方达全球|大成纳斯达克|南方纳斯达克|华安纳斯达克|建信新兴/.test(
      name,
    )
  ) {
    return 'us';
  }
  return 'cn';
}

/** A 股：周一至周五 9:30–11:30、13:00–15:00 */
export function isCnMarketOpen(date = new Date()) {
  const wd = beijingWeekday(date);
  if (wd === 0 || wd === 6) return false;
  const mins = minutesOfDay(beijingParts(date));
  return (
    (mins >= 9 * 60 + 30 && mins <= 11 * 60 + 30) ||
    (mins >= 13 * 60 && mins <= 15 * 60)
  );
}

/**
 * 美股（北京时间）：周一至周五 21:30–次日 04:00
 * 对应周二至周六 00:00–04:00 仍属前一美股交易日夜盘段
 */
export function isUsMarketOpen(date = new Date()) {
  const wd = beijingWeekday(date);
  const mins = minutesOfDay(beijingParts(date));
  const eveningStart = 21 * 60 + 30;
  const morningEnd = 4 * 60;
  if (mins >= eveningStart) return wd >= 1 && wd <= 5;
  if (mins < morningEnd) return wd >= 2 && wd <= 6;
  return false;
}

/** 国内黄金：日盘 9:00–15:30；夜盘 20:00–次日 02:30 */
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

/** 实时收益列：黄金联接按 A 股时段；全球 QDII 在日/韩/港/美任一交易时段内刷新 */
export function isRealtimeMarketOpen(market, date = new Date()) {
  if (market === 'gold_cn') return isCnMarketOpen(date);
  if (market === 'us') return isOverseasSessionOpen(date);
  return isMarketOpen(market, date);
}

/**
 * A股/黄金联接：是否允许展示「实时收益」估值。
 * 本交易日 9:30 起（含午间休市、15:00 后当日收盘估值）为 true；
 * 新开交易日 9:30 前、周末为 false，避免沿用上一交易日穿透/ fundgz 结果。
 * @param {Date} [now]
 */
export function isDomesticRealtimeSession(now = new Date()) {
  const wd = beijingWeekday(now);
  if (wd === 0 || wd === 6) return false;
  const mins = minutesOfDay(beijingParts(now));
  return mins >= 9 * 60 + 30;
}

/**
 * 按市场决定是否对外暴露 impactPct。
 * - 美股 QDII：休市仍沿用最近收盘/穿透估值
 * - A股/黄金：仅在本交易日 9:30 后暴露
 * @param {MarketType} market
 * @param {number|null|undefined} rawImpactPct
 * @param {Date} [now]
 */
export function effectiveImpactPct(market, rawImpactPct, now = new Date()) {
  if (rawImpactPct == null || !Number.isFinite(rawImpactPct)) return null;
  if (market === 'us') return rawImpactPct;
  if (market === 'cn' || market === 'gold_cn') {
    return isDomesticRealtimeSession(now) ? rawImpactPct : null;
  }
  return rawImpactPct;
}

/** @param {string} iso YYYY-MM-DD @returns {string} MM-DD */
export function fmtMd(iso) {
  if (!iso) return '';
  const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[2]}-${m[3]}` : iso;
}

/**
 * 当日收益归属日期与说明
 * - A 股 / 国内黄金：晚间入账对应当天（北京时间）
 * - 美股 QDII：晚间展示最新公布净值日（通常比北京时间晚一个交易日）
 *
 * @param {object} fund
 * @param {string} beijingDate YYYY-MM-DD
 * @param {Date} [now]
 */
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

/**
 * @param {object} fund
 * @param {string} beijingDate
 * @param {Date} [now]
 */
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
