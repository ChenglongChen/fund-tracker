/**
 * 列表表头日期：按市场汇总已入账 / 预期净值日（spec §3b 16:00 分界）。
 */
import { fmtMd } from './market-hours.js';
import { expectedNavDateForDailyDisplay } from '../profit-pending.js';
import { beijingMinutesOfDay } from '../time.js';

const BJ_NAV_WINDOW_MIN = 16 * 60;

function maxIsoDate(set) {
  const arr = [...set].sort();
  return arr.length ? arr[arr.length - 1] : null;
}

/** @param {Set<string>} set @returns {string} */
function fmtNavBucketLabel(set) {
  const d = maxIsoDate(set);
  return d ? fmtMd(d) : '';
}

/**
 * @param {object[]} liveFunds
 * @param {(f: object) => string|null|undefined} pickDate
 */
function buildNavBucketHeadLabel(liveFunds, pickDate) {
  const buckets = { cn: new Set(), us: new Set(), gold_cn: new Set() };
  for (const f of liveFunds) {
    const d = pickDate(f);
    if (!d) continue;
    const key = f.market === 'us' ? 'us' : f.market === 'gold_cn' ? 'gold_cn' : 'cn';
    buckets[key].add(d);
  }

  const cnD = fmtNavBucketLabel(buckets.cn);
  const usD = fmtNavBucketLabel(buckets.us);
  const goldD = fmtNavBucketLabel(buckets.gold_cn);

  /** @type {string[]} */
  const parts = [];
  if (cnD) parts.push(cnD);
  if (goldD && goldD !== cnD) parts.push(goldD);
  else if (goldD && !cnD) parts.push(goldD);
  if (usD && usD !== cnD && usD !== goldD) parts.push(usD);
  else if (usD && !cnD && !goldD) parts.push(usD);

  const unique = [...new Set(parts)].sort();
  if (unique.length === 1) return unique[0];
  if (unique.length > 1) return unique.join('/');
  return '—';
}

/** 16:00 前：表头跟上一已入账净值日；16:00 后：跟 expectedNavDateForDailyDisplay。 */
function buildDailyHeadLabel(liveFunds, beijingDate, now = new Date()) {
  const afterNavWindow = beijingMinutesOfDay(now) >= BJ_NAV_WINDOW_MIN;
  if (afterNavWindow) {
    return buildNavBucketHeadLabel(liveFunds, (f) => {
      const market = f.market === 'us' ? 'us' : f.market === 'gold_cn' ? 'gold_cn' : 'cn';
      return expectedNavDateForDailyDisplay(beijingDate, market, now);
    });
  }
  return buildNavBucketHeadLabel(
    liveFunds,
    (f) => f.settledNavDate || f.dailyAsOfDate || f.lastNavDate,
  );
}

/**
 * @param {object[]} liveFunds
 * @param {object} [meta]
 * @param {string} beijingDate
 * @param {string} updatedAt
 * @param {Date} [now]
 */
export function buildTableHeadLabels(liveFunds, meta, beijingDate, updatedAt, now = new Date()) {
  const realtime = beijingDate ? fmtMd(beijingDate) : '—';

  const daily = buildDailyHeadLabel(liveFunds, beijingDate, now);
  let holding = buildNavBucketHeadLabel(liveFunds, (f) => f.settledNavDate || f.lastNavDate);
  const dailyLabel = daily === '—' && meta?.snapshotDate ? fmtMd(meta.snapshotDate) : daily;
  if (holding === '—' && meta?.snapshotDate) {
    holding = fmtMd(meta.snapshotDate);
  }

  return {
    realtime: { label: realtime },
    daily: { label: dailyLabel },
    holding: { label: holding },
  };
}
