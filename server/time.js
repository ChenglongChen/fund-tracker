export const BEIJING_TZ = 'Asia/Shanghai';

/** @param {Date} [date] @returns {number} 0=Sun … 6=Sat（北京时间） */
export function beijingWeekday(date = new Date()) {
  const s = new Intl.DateTimeFormat('en-US', {
    timeZone: BEIJING_TZ,
    weekday: 'short',
  }).format(date);
  return { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }[s] ?? 0;
}

/** @param {Date} [date] */
export function beijingParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: BEIJING_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date);

  /** @type {Record<string, string>} */
  const map = {};
  for (const p of parts) {
    if (p.type !== 'literal') map[p.type] = p.value;
  }
  return map;
}

/** @param {Date} [date] @returns {string} YYYY-MM-DD */
export function beijingDateString(date = new Date()) {
  const { year, month, day } = beijingParts(date);
  return `${year}-${month}-${day}`;
}

/** @param {Date} [date] @returns {string} HH:mm */
export function beijingTimeHm(date = new Date()) {
  const { hour, minute } = beijingParts(date);
  return `${hour}:${minute}`;
}

/** @param {Date} [date] @returns {string} HH:mm:ss */
export function beijingTimeHms(date = new Date()) {
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
  return `${map.hour}:${map.minute}:${map.second}`;
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
