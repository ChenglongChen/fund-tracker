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
