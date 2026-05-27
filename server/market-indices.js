/**
 * 大盘指数：各市场常用指数 + 新浪代码解析（底部 dock / 抽屉展示）。
 */

/** @typedef {'cn'|'hk'|'jp'|'kr'|'us'|'fx'} StripMarket */

/**
 * @typedef {object} MarketIndexDef
 * @property {string} key 新浪 list 代码
 * @property {string} label 展示名
 * @property {StripMarket} market 所属市场（休市冻结用）
 * @property {'gb'|'cn'|'hk'|'znb'} parse 解析格式
 */

/** @type {MarketIndexDef[]} */
export const MARKET_STRIP_INDICES = [
  { key: 'sh000001', label: '上证', market: 'cn', parse: 'cn' },
  { key: 'sh000300', label: '沪深300', market: 'cn', parse: 'cn' },
  { key: 'sz399006', label: '创业板', market: 'cn', parse: 'cn' },
  { key: 'rt_hkHSI', label: '恒生', market: 'hk', parse: 'hk' },
  { key: 'rt_hkHSTECH', label: '恒生科技', market: 'hk', parse: 'hk' },
  { key: 'znb_NKY', label: '日经225', market: 'jp', parse: 'znb' },
  { key: 'znb_KOSPI', label: 'KOSPI', market: 'kr', parse: 'znb' },
  { key: 'gb_inx', label: '标普500', market: 'us', parse: 'gb' },
  { key: 'gb_$ixic', label: '纳斯达克', market: 'us', parse: 'gb' },
];

/**
 * @param {string} raw
 * @param {'gb'|'cn'|'hk'|'znb'} parse
 */
export function parseIndexChangePct(raw, parse) {
  if (!raw) return null;
  const parts = raw.split(',');
  let changePct = null;

  switch (parse) {
    case 'gb':
      changePct = parseFloat(parts[2]);
      break;
    case 'cn': {
      const prev = parseFloat(parts[2]);
      const cur = parseFloat(parts[3]);
      if (prev > 0 && cur > 0) changePct = ((cur - prev) / prev) * 100;
      break;
    }
    case 'hk':
      changePct = parseFloat(parts[8]);
      break;
    case 'znb':
      changePct = parseFloat(parts[3]);
      break;
    default:
      break;
  }

  return Number.isFinite(changePct) ? changePct : null;
}

/** @param {string} fxRaw */
export function parseFxChangePct(fxRaw) {
  if (!fxRaw) return null;
  const parts = fxRaw.split(',');
  const changePct = parseFloat(parts[11]);
  return Number.isFinite(changePct) ? changePct : null;
}
