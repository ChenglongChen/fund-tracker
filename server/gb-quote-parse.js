/**
 * 新浪 gb_ 美股/指数行情扩展字段解析。
 * 样本：NVDA parts[22]=盘前%, parts[23]=正盘%, parts[26]=正盘收盘价
 */

/** @type {number|null} */
let qqqPremarketPctCache = null;

/** @param {number|null} pct */
export function setQqqPremarketPct(pct) {
  qqqPremarketPctCache = pct != null && Number.isFinite(pct) ? pct : null;
}

/** @returns {number|null} */
export function getQqqPremarketPct() {
  return qqqPremarketPctCache;
}

/** 新浪 parts[23] 在部分标的上是振幅/年初至今等，仅在小数值时视作正盘涨幅 */
const MAX_REGULAR_PCT_FROM_FIELD = 12;

/**
 * @param {string[]} parts
 * @returns {{ name: string, price: number, changePct: number, changePctRegular: number|null, changePctPremarket: number|null, regularClosePrice: number|null }|null}
 */
export function parseGbSinaParts(parts) {
  if (!parts?.length || parts.length < 3) return null;
  const price = parseFloat(parts[1]);
  const changePct = parseFloat(parts[2]);
  if (!Number.isFinite(price) || !Number.isFinite(changePct)) return null;

  let changePctRegular = null;
  let changePctPremarket = null;
  let regularClosePrice = null;

  if (parts.length >= 27) {
    const regClose = parseFloat(parts[26]);
    const isStockFormat =
      Number.isFinite(regClose) &&
      regClose > 0 &&
      regClose < price * 15 &&
      !/[A-Za-z]/.test(String(parts[26] ?? ''));
    if (isStockFormat) {
      regularClosePrice = regClose;
      const pre = parseFloat(parts[22]);
      const regCandidate = parseFloat(parts[23]);
      if (Number.isFinite(pre)) changePctPremarket = pre;
      if (
        Number.isFinite(regCandidate) &&
        Math.abs(regCandidate) <= MAX_REGULAR_PCT_FROM_FIELD
      ) {
        changePctRegular = regCandidate;
      }
    }
  }

  return {
    name: parts[0],
    price,
    changePct,
    changePctRegular,
    changePctPremarket,
    regularClosePrice,
  };
}

/**
 * @param {string} raw
 * @returns {ReturnType<typeof parseGbSinaParts>}
 */
export function parseGbSinaRaw(raw) {
  if (!raw) return null;
  return parseGbSinaParts(raw.split(','));
}

/**
 * @param {string} key
 * @param {string} raw
 * @returns {object|null}
 */
export function parseGbSinaQuote(key, raw) {
  const parsed = parseGbSinaRaw(raw);
  if (!parsed) return null;
  if (key === 'gb_qqq' && parsed.changePctPremarket != null) {
    setQqqPremarketPct(parsed.changePctPremarket);
  }
  return {
    ...parsed,
    quoteSource: 'sina',
  };
}
