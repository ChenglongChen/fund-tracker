/** 北京时间（Asia/Shanghai）工具 */

export const BEIJING_TZ = 'Asia/Shanghai';

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
  if (map.hour === '24') map.hour = '00';
  return `${map.hour}:${map.minute}:${map.second}`;
}

/** @param {Date} [date] @returns {string} ISO 8601，如 2026-06-03T07:39:17+08:00 */
export function beijingIsoString(date = new Date()) {
  const { year, month, day } = beijingParts(date);
  return `${year}-${month}-${day}T${beijingTimeHms(date)}+08:00`;
}

/** @param {Date} [date] @returns {string} 日志用，如 2026-06-03 07:39:17 */
export function beijingDateTimeString(date = new Date()) {
  const { year, month, day } = beijingParts(date);
  return `${year}-${month}-${day} ${beijingTimeHms(date)}`;
}
