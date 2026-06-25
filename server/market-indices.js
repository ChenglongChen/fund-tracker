/**
 * 大盘指数：各市场常用指数 + 新浪代码解析（底部 dock / 抽屉展示）。
 */
import { parseGbSinaRaw } from './gb-quote-parse.js';

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
  { key: 'gb_ndx', label: '纳斯达克100', market: 'us', parse: 'gb' },
  { key: 'gb_$ixic', label: '纳斯达克', market: 'us', parse: 'gb' },
];

/**
 * @param {string} raw
 * @param {'gb'|'cn'|'hk'|'znb'} parse
 * @param {string} [key]
 * @returns {{ price: number|null, change: number|null, changePct: number|null, changePctRegular?: number|null, changePctPremarket?: number|null }}
 */
export function parseIndexQuote(raw, parse, key = '') {
  const empty = { price: null, change: null, changePct: null, changePctRegular: null, changePctPremarket: null };
  if (!raw) return empty;
  const parts = raw.split(',');

  switch (parse) {
    case 'gb': {
      const gb = parseGbSinaRaw(raw);
      if (!gb) {
        const changePct = parseFloat(parts[2]);
        return { ...empty, changePct: Number.isFinite(changePct) ? changePct : null };
      }
      const prev = gb.price / (1 + gb.changePct / 100);
      return {
        price: gb.price,
        change: gb.price - prev,
        changePct: gb.changePct,
        changePctRegular:
          gb.changePctRegular != null && gb.changePctRegular !== 0
            ? gb.changePctRegular
            : gb.changePct,
        changePctPremarket: gb.changePctPremarket,
      };
    }
    case 'cn': {
      const prev = parseFloat(parts[2]);
      const cur = parseFloat(parts[3]);
      if (!Number.isFinite(prev) || !Number.isFinite(cur)) return empty;
      const changePct = prev > 0 ? ((cur - prev) / prev) * 100 : null;
      return {
        price: cur,
        change: cur - prev,
        changePct: Number.isFinite(changePct) ? changePct : null,
      };
    }
    case 'hk': {
      const price = parseFloat(parts[6]);
      const change = parseFloat(parts[7]);
      const changePct = parseFloat(parts[8]);
      return {
        price: Number.isFinite(price) ? price : null,
        change: Number.isFinite(change) ? change : null,
        changePct: Number.isFinite(changePct) ? changePct : null,
      };
    }
    case 'znb': {
      const price = parseFloat(parts[1]);
      const change = parseFloat(parts[2]);
      const changePct = parseFloat(parts[3]);
      return {
        price: Number.isFinite(price) ? price : null,
        change: Number.isFinite(change) ? change : null,
        changePct: Number.isFinite(changePct) ? changePct : null,
      };
    }
    default:
      return empty;
  }
}

/**
 * @param {string} raw
 * @param {'gb'|'cn'|'hk'|'znb'} parse
 */
export function parseIndexChangePct(raw, parse) {
  return parseIndexQuote(raw, parse).changePct;
}

/**
 * Sina 人民币外汇（fx_susdcny / fx_hkdcny，"在岸人民币"）行情无现成涨跌幅字段（旧版读 parts[11] 恒为 0），
 * 由 现价 vs 昨收 计算：parts[1]=昨收，parts[3]=最新价（fallback parts[8]）。
 * @param {string} fxRaw
 */
export function parseFxChangePct(fxRaw) {
  if (!fxRaw) return null;
  const parts = fxRaw.split(',');
  const prevClose = parseFloat(parts[1]);
  const current = Number.isFinite(parseFloat(parts[3])) ? parseFloat(parts[3]) : parseFloat(parts[8]);
  if (Number.isFinite(prevClose) && prevClose > 0 && Number.isFinite(current)) {
    const pct = ((current - prevClose) / prevClose) * 100;
    if (Math.abs(pct) <= 5) return Math.round(pct * 10000) / 10000;
  }
  return null;
}
