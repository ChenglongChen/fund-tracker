import { beijingDateString, beijingIsoAddDays, beijingMinutesOfDay, beijingParts, beijingWeekday } from './time.js';
import {
  isHkMarketOpen,
  isJpMarketOpen,
  isKrMarketOpen,
  isOverseasSessionOpen,
  getUsSessionPhase,
  isUsQuoteLive,
} from './holding-market.js';
import { getFundRegular, rememberFundRegular } from './impact-snapshots.js';

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

/** A 股：周一至周五 9:30–11:30、13:00–15:00（收市时刻起不含） */
export function isCnMarketOpen(date = new Date()) {
  const wd = beijingWeekday(date);
  if (wd === 0 || wd === 6) return false;
  const mins = beijingMinutesOfDay(date);
  return (
    (mins >= 9 * 60 + 30 && mins < 11 * 60 + 30) ||
    (mins >= 13 * 60 && mins < 15 * 60)
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

/** A 股午间休市 11:30–13:00（仍展示上午收盘估值） */
export function isCnMiddayBreak(date = new Date()) {
  const wd = beijingWeekday(date);
  if (wd === 0 || wd === 6) return false;
  const mins = beijingMinutesOfDay(date);
  return mins >= 11 * 60 + 30 && mins < 13 * 60;
}

/** 美股 QDII：仅正盘/盘后刷新；盘前沿用上一正盘收盘预估值 */
export function isUsFundImpactLive(now = new Date()) {
  const phase = getUsSessionPhase(now);
  return phase === 'regular' || phase === 'afterhours';
}

/**
 * A 股/黄金联接：美股正盘期间不展示实时收益（含收盘 snapshot 与黄金夜盘 live），前端显示 —。
 * @param {MarketType} market
 * @param {Date} [now]
 */
export function shouldSuppressDomesticRealtimeDuringUsRegular(market, now = new Date()) {
  if (market !== 'cn' && market !== 'gold_cn') return false;
  return getUsSessionPhase(now) === 'regular';
}

/** @deprecated use shouldSuppressDomesticRealtimeDuringUsRegular */
export function shouldHideDomesticCloseSnapshotDuringUsRegular(market, now = new Date()) {
  return shouldSuppressDomesticRealtimeDuringUsRegular(market, now);
}

/** 是否处于可刷新实时估值的交易时段（收市后不再写入新值） */
export function isFundImpactLiveWindow(market, now = new Date()) {
  if (market === 'cn') return isCnMarketOpen(now);
  if (market === 'gold_cn') return isGoldCnMarketOpen(now);
  if (market === 'us') return isUsFundImpactLive(now);
  return false;
}

/**
 * 当前处于交易时段的大盘标签（顶栏「盘中 · …」与说明文案）。
 * 按交易所日历，不按基金类型或持仓口径聚合。
 * @param {Date} [now]
 * @returns {string[]}
 */
export function openMarketLabels(now = new Date()) {
  /** @type {string[]} */
  const out = [];
  if (isCnMarketOpen(now) || isCnMiddayBreak(now)) out.push('A股');
  if (isHkMarketOpen(now)) out.push('港股');
  if (isJpMarketOpen(now) || isKrMarketOpen(now)) out.push('亚太');
  if (isUsQuoteLive(now)) out.push('美股');
  return out;
}

/** @param {Date} [now] */
function displayPhasePrefix(now = new Date()) {
  if (isCnMarketOpen(now) || isHkMarketOpen(now) || isJpMarketOpen(now) || isKrMarketOpen(now)) {
    return '盘中';
  }
  if (isUsMarketOpen(now)) return '盘中';
  const usPhase = getUsSessionPhase(now);
  if (usPhase === 'premarket') return '盘前';
  if (usPhase === 'afterhours') return '盘后';
  if (isCnMiddayBreak(now)) return '盘中';
  return '盘中';
}

/** @param {Date} [now] */
export function marketChipLabel(now = new Date()) {
  const labels = openMarketLabels(now);
  return labels.length ? `${displayPhasePrefix(now)} · ${labels.join('/')}` : '休市';
}

/** 实时收益列「盘中」标记：仅在交易时段点亮 */
export function isRealtimeMarketOpen(market, date = new Date()) {
  if (market === 'us') return isUsFundImpactLive(date);
  if (market === 'cn') return isCnMarketOpen(date) || isCnMiddayBreak(date);
  if (market === 'gold_cn') {
    return isGoldCnMarketOpen(date) || isCnMiddayBreak(date);
  }
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

/** @type {Map<number, number>} 收市后沿用最近有效穿透/估值涨跌幅 */
const fundImpactCloseSnapshot = new Map();

/** @type {Map<number, number>} 美股正盘收盘穿透（盘前/盘后基准） */
const fundImpactRegularSnapshot = new Map();

/** @type {Map<number, number>} 美股盘前/盘后第 1 行（正盘+亚太）冻结快照 */
const fundPremarketRegularSnapshot = new Map();

/** @type {string|null} 盘前/盘后快照所属北京时间日期 */
let premarketSnapshotBeijingDate = null;

/** @type {string|null} */
let sessionRegularSnapshotPhase = null;

/** @param {number|null|undefined} fundId @param {number|null|undefined} rawRegular @param {string} beijingDate @param {'premarket'|'afterhours'} sessionPhase */
function resolveSessionRegularSnapshot(fundId, rawRegular, beijingDate, sessionPhase) {
  if (
    premarketSnapshotBeijingDate !== beijingDate ||
    sessionRegularSnapshotPhase !== sessionPhase
  ) {
    fundPremarketRegularSnapshot.clear();
    premarketSnapshotBeijingDate = beijingDate;
    sessionRegularSnapshotPhase = sessionPhase;
  }
  if (fundId == null) {
    return rawRegular ?? null;
  }
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

/** @param {number|null|undefined} fundId @param {number|null|undefined} rawRegular @param {string} beijingDate */
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

/**
 * 实时收益涨跌幅：盘中用最新估值；收市或暂无行情时沿用最近收盘快照。
 * @param {number|null|undefined} fundId
 * @param {MarketType} market
 * @param {number|null|undefined} rawImpactPct
 * @param {Date} [now]
 */
export function resolveFundImpactPct(fundId, market, rawImpactPct, now = new Date()) {
  if (shouldSuppressDomesticRealtimeDuringUsRegular(market, now)) return null;

  const hasRaw = rawImpactPct != null && Number.isFinite(rawImpactPct);
  const live = isFundImpactLiveWindow(market, now);
  const usPhase = market === 'us' ? getUsSessionPhase(now) : null;
  const isUsExtended = usPhase === 'premarket' || usPhase === 'afterhours';

  if (live && hasRaw) {
    if (fundId != null) {
      if (market === 'us' && usPhase === 'regular') {
        fundImpactRegularSnapshot.set(fundId, rawImpactPct);
        fundImpactCloseSnapshot.set(fundId, rawImpactPct);
        rememberFundRegular(fundId, rawImpactPct);
      } else if (isUsExtended) {
        fundImpactCloseSnapshot.set(fundId, rawImpactPct);
        if (!fundImpactRegularSnapshot.has(fundId) && usPhase === 'afterhours') {
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

  if (market === 'us' && usPhase === 'premarket' && fundId != null) {
    const disk = getFundRegular(fundId);
    if (disk != null && Number.isFinite(disk)) return disk;
  }

  // 冷启动且已收市：用当前穿透值初始化一次快照（盘前不采纳新穿透）
  if (hasRaw && fundId != null) {
    if (market === 'us' && usPhase === 'premarket') return null;
    fundImpactCloseSnapshot.set(fundId, rawImpactPct);
    return rawImpactPct;
  }
  return null;
}

/**
 * 组装列表/详情展示用实时 impact。
 * 美股盘前：第 1 行 = 正盘 + 亚太（impactPctRegular），第 2 行 = 盘前增量；不复用官方净值涨跌幅。
 * @param {number|null|undefined} fundId
 * @param {MarketType} market
 * @param {{ impactPct?: number|null, impactPctRegular?: number|null, impactPctExtended?: number|null, impactSession?: string } | null} impactResult
 * @param {Date} [now]
 */
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
  const usPhase = market === 'us' ? getUsSessionPhase(now) : null;

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

  let impactPct = resolveFundImpactPct(fundId, market, rawTotal, now);
  let impactPctRegular = rawRegular;
  let impactPctExtended = rawExtended;
  let impactSession =
    impactResult?.impactSession ?? (market === 'us' ? usPhase : 'closed');
  if (impactPctRegular == null && impactPct != null && impactSession === 'regular') {
    impactPctRegular = impactPct;
  }
  if (market !== 'us') {
    if (impactSession === 'premarket' || impactSession === 'afterhours') {
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

/** 有 impactPct 即展示实时收益（收市时为最近收盘估值） */
export function shouldDisplayRealtimeProfit(_market, _realtimeActive, impactPct) {
  return impactPct != null && Number.isFinite(impactPct);
}

/** 净值入账后清除收盘快照，下一轮 refresh 重算 */
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

/** @param {string} iso YYYY-MM-DD @returns {string} MM-DD */
export function fmtMd(iso) {
  if (!iso) return '';
  const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[2]}-${m[3]}` : iso;
}

/** 北京时间 18:00 后若净值未更新到期望日 → 当日收益展示 — */
export const DAILY_NAV_EXPECT_HOUR = 18;

/**
 * 当日收益是否尚未更新（按市场区分期望净值日）
 * - A 股 / 黄金：18:00 前展示最新已入账净值（含日切后昨日）；18:00 后期望今日净值
 * - QDII：18:00 后期望至少已有「北京时间昨天」的公布净值；否则 —
 * @param {object} fund
 * @param {MarketType} market
 * @param {{ pdate?: string } | null} navInfo
 * @param {string} beijingDate YYYY-MM-DD
 * @param {Date} [now]
 */
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
