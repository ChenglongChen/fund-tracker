import {
  BEIJING_TZ,
  beijingParts,
  beijingDateString,
  beijingTimeHm,
  beijingTimeHms,
  beijingIsoString,
  beijingDateTimeString,
} from '@fund-tracker/core/time';

export {
  BEIJING_TZ,
  beijingParts,
  beijingDateString,
  beijingTimeHm,
  beijingTimeHms,
  beijingIsoString,
  beijingDateTimeString,
};

/** README 截图：固定「当前时刻」，避免各页随真实时钟漂移 */
let _frozenNow = null;

/** @returns {Date} */
export function serverNow() {
  if (_frozenNow) return _frozenNow;
  const raw = process.env.FUND_TRACKER_NOW;
  if (raw) {
    const d = new Date(raw);
    if (!Number.isNaN(d.getTime())) _frozenNow = d;
  }
  return _frozenNow ?? new Date();
}

/** @param {Date} [date] @returns {number} 0=Sun … 6=Sat（北京时间） */
export function beijingWeekday(date = new Date()) {
  const s = new Intl.DateTimeFormat('en-US', {
    timeZone: BEIJING_TZ,
    weekday: 'short',
  }).format(date);
  return { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }[s] ?? 0;
}

/** @param {string} iso YYYY-MM-DD @param {number} deltaDays @returns {string} */
export function beijingIsoAddDays(iso, deltaDays) {
  const [y, m, d] = iso.split('-').map(Number);
  const utc = Date.UTC(y, m - 1, d + deltaDays, 12);
  const parts = beijingParts(new Date(utc));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

/** @param {Date} [date] 北京时间当日经过的分钟数（含秒，用于精确判断收市时刻） */
export function beijingMinutesOfDay(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: BEIJING_TZ,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(date);
  /** @type {Record<string, string>} */
  const map = {};
  for (const p of parts) {
    if (p.type !== 'literal') map[p.type] = p.value;
  }
  const h = Number(map.hour);
  const m = Number(map.minute);
  const s = Number(map.second);
  return h * 60 + m + s / 60;
}
