const DEFAULT_CODE = '012922';

const SINA_ORIGIN =
  typeof import.meta !== 'undefined' && import.meta.env?.DEV
    ? '/proxy/sina'
    : 'https://hq.sinajs.cn';
const F10_ORIGIN =
  typeof import.meta !== 'undefined' && import.meta.env?.DEV
    ? '/proxy/f10'
    : 'https://fundf10.eastmoney.com';

/** @param {string} url */
export function loadScript(url) {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = url;
    script.async = true;
    const cleanup = () => {
      if (script.parentNode) script.parentNode.removeChild(script);
    };
    script.onload = () => {
      cleanup();
      resolve();
    };
    script.onerror = () => {
      cleanup();
      reject(new Error(`脚本加载失败: ${url}`));
    };
    document.head.appendChild(script);
  });
}

/**
 * @param {string} html
 */
function parseHoldingsHtml(html) {
  const holdings = [];
  const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let rowMatch;

  while ((rowMatch = rowRe.exec(html)) !== null) {
    const rowHtml = rowMatch[1];
    if (/<th/i.test(rowHtml)) continue;

    const linkMatch = rowHtml.match(/unify\/r\/(\d+)\.([a-zA-Z0-9]+)/);
    if (!linkMatch) continue;

    const cells = [...rowHtml.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((m) =>
      m[1].replace(/<[^>]+>/g, '').trim(),
    );
    if (cells.length < 5) continue;

    let weightIdx = null;
    for (let i = 0; i < cells.length; i++) {
      const c = cells[i];
      if (c.endsWith('%') && /^[\d.]+\s*%$/.test(c.replace(/\s/g, ''))) {
        weightIdx = i;
        break;
      }
    }
    if (weightIdx == null) continue;

    const weight = parseFloat(cells[weightIdx].replace('%', '').replace(/,/g, ''));
    if (!Number.isFinite(weight) || weight <= 0 || weight > 20) continue;

    const marketId = parseInt(linkMatch[1], 10);
    const stockCode = linkMatch[2];
    const stockName = cells[2] || stockCode;

    holdings.push({
      code: stockCode,
      name: stockName,
      weight,
      marketId,
      fetchCode: toSinaCode(stockCode, marketId),
      changePct: null,
      price: null,
    });
  }

  return holdings;
}

/**
 * @param {string} code
 * @param {{ year?: string, month?: string, topline?: number }} opts
 */
async function fetchHoldingsPeriod(code, opts = {}) {
  const c = String(code).trim();
  const { year = '', month = '', topline = 100 } = opts;
  const url = `${F10_ORIGIN}/FundArchivesDatas.aspx?type=jjcc&code=${c}&topline=${topline}&year=${year}&month=${month}&_=${Date.now()}`;
  await loadScript(url);

  const html = window.apidata?.content || '';
  if (!html || html.includes('暂无数据')) {
    return { reportDate: null, holdings: [] };
  }

  const dateMatch =
    html.match(/截止至：[^<]*<[^>]*>([\d-]+)/) || html.match(/截止至：\s*([\d-]+)/);
  const reportDate = dateMatch ? dateMatch[1] : null;

  return { reportDate, holdings: parseHoldingsHtml(html) };
}

/**
 * 年报 + 最新重仓合并（对齐纳指估值：Q1/季报覆盖 + 年报底仓）
 * @param {Array} annual
 * @param {Array} recent
 */
export function mergeHoldingsReports(annual, recent) {
  const byCode = new Map();
  for (const h of annual) {
    byCode.set(h.code, { ...h });
  }
  for (const h of recent) {
    byCode.set(h.code, { ...h });
  }
  return sortHoldingsByWeight([...byCode.values()]);
}

function sortHoldingsByWeight(holdings) {
  return [...holdings].sort(
    (a, b) => b.weight - a.weight || String(a.name || a.code).localeCompare(String(b.name || b.code)),
  );
}

/**
 * 东财重仓：最新披露 + 年报明细合并
 * @param {string} code
 */
export async function fetchFundHoldings(code = DEFAULT_CODE) {
  const recentPack = await fetchHoldingsPeriod(code, { topline: 50 });
  const year = new Date().getFullYear();
  let annualPack = await fetchHoldingsPeriod(code, {
    year: String(year),
    month: '3',
    topline: 100,
  });
  if (annualPack.holdings.length < 30) {
    annualPack = await fetchHoldingsPeriod(code, {
      year: String(year - 1),
      month: '12',
      topline: 100,
    });
  }

  const holdings = mergeHoldingsReports(annualPack.holdings, recentPack.holdings);
  const reportDate = annualPack.reportDate || recentPack.reportDate;

  return {
    reportDate,
    recentReportDate: recentPack.reportDate,
    annualReportDate: annualPack.reportDate,
    holdings,
  };
}

/**
 * @param {string} stockCode
 * @param {number|null} marketId
 */
function toSinaCode(stockCode, marketId) {
  const code = String(stockCode).trim();
  if (marketId != null) {
    if (marketId === 0) return `sz${code}`;
    if (marketId === 1) return `sh${code}`;
    if (marketId === 116) return `rt_hk${code.padStart(5, '0')}`;
    if (marketId >= 100) return `gb_${code.toLowerCase()}`;
  }
  if (/^[a-zA-Z]/.test(code)) return `gb_${code.toLowerCase()}`;
  if (code.length <= 5 && /^\d+$/.test(code)) return `rt_hk${code.padStart(5, '0')}`;
  if (code.startsWith('6') || code.startsWith('9')) return `sh${code}`;
  if (code.startsWith('4') || code.startsWith('8')) return `bj${code}`;
  return `sz${code}`;
}

/**
 * 新浪批量行情
 * @param {string[]} fetchCodes
 */
export async function fetchSinaQuotes(fetchCodes) {
  const unique = [...new Set(fetchCodes.filter(Boolean))];
  if (unique.length === 0) return {};

  const url = `${SINA_ORIGIN}/list=${unique.join(',')}`;
  await loadScript(url);

  /** @type {Record<string, { name: string, price: number, changePct: number }>} */
  const out = {};
  for (const key of unique) {
    const raw = window[`hq_str_${key}`];
    if (!raw) continue;
    const parts = raw.split(',');
    if (key.startsWith('rt_hk') && parts.length >= 9) {
      out[key] = { name: parts[1], price: parseFloat(parts[6]), changePct: parseFloat(parts[8]) };
    } else if (key.startsWith('gb_') && parts.length >= 3) {
      out[key] = { name: parts[0], price: parseFloat(parts[1]), changePct: parseFloat(parts[2]) };
    } else if (parts.length >= 4) {
      const pre = parseFloat(parts[2]);
      const cur = parseFloat(parts[3]);
      const changePct = pre > 0 ? ((cur - pre) / pre) * 100 : 0;
      out[key] = { name: parts[0], price: cur, changePct };
    }
  }
  return out;
}

/** 美元人民币即期 — 新浪 */
export async function fetchUsdCny() {
  const url = `${SINA_ORIGIN}/list=fx_susdcny`;
  await loadScript(url);
  const raw = window.hq_str_fx_susdcny;
  if (!raw) throw new Error('汇率数据不可用');
  const parts = raw.split(',');
  const rate = parseFloat(parts[8] || parts[1]);
  let changePct = parseFloat(parts[11]);
  if (!Number.isFinite(changePct)) {
    const prev = parseFloat(parts[3]);
    if (Number.isFinite(rate) && Number.isFinite(prev) && prev > 0) {
      changePct = ((rate - prev) / prev) * 100;
    } else {
      changePct = null;
    }
  }
  return {
    pair: 'USD/CNY',
    rate: Number.isFinite(rate) ? rate : null,
    changePct: Number.isFinite(changePct) ? changePct : null,
    time: parts[0] || '',
    source: 'sina',
  };
}

const INDEX_SYMBOLS = [
  { key: 'sh000001', label: '上证', parse: 'cn' },
  { key: 'sh000300', label: '沪深300', parse: 'cn' },
  { key: 'sz399006', label: '创业板', parse: 'cn' },
  { key: 'rt_hkHSI', label: '恒生', parse: 'hk' },
  { key: 'rt_hkHSTECH', label: '恒生科技', parse: 'hk' },
  { key: 'znb_NKY', label: '日经225', parse: 'znb' },
  { key: 'znb_KOSPI', label: 'KOSPI', parse: 'znb' },
  { key: 'gb_inx', label: '标普500', parse: 'gb' },
  { key: 'gb_$ixic', label: '纳斯达克', parse: 'gb' },
];

function parseClientIndexChangePct(raw, parse) {
  if (!raw) return null;
  const parts = raw.split(',');
  let changePct = null;
  if (parse === 'gb') changePct = parseFloat(parts[2]);
  else if (parse === 'cn') {
    const prev = parseFloat(parts[2]);
    const cur = parseFloat(parts[3]);
    if (prev > 0 && cur > 0) changePct = ((cur - prev) / prev) * 100;
  } else if (parse === 'hk') changePct = parseFloat(parts[8]);
  else if (parse === 'znb') changePct = parseFloat(parts[3]);
  return Number.isFinite(changePct) ? changePct : null;
}

/** 顶部指数条 + 汇率（新浪） */
export async function fetchMarketStrip() {
  const url = `${SINA_ORIGIN}/list=${[...INDEX_SYMBOLS.map((i) => i.key), 'fx_susdcny'].join(',')}`;
  await loadScript(url);

  const indices = INDEX_SYMBOLS.map(({ key, label, parse }) => {
    const raw = window[`hq_str_${key}`];
    return {
      label,
      changePct: parseClientIndexChangePct(raw, parse),
    };
  });

  const fxRaw = window.hq_str_fx_susdcny;
  let fx = { label: '汇率', changePct: null };
  if (fxRaw) {
    const parts = fxRaw.split(',');
    let changePct = parseFloat(parts[11]);
    if (!Number.isFinite(changePct)) changePct = null;
    fx = { label: '汇率', changePct };
  }

  return [...indices, fx];
}

/**
 * 穿透估值（对齐纳指估值）：Σ(权重×涨跌)/100 + 汇率，不按披露仓位归一化
 * @param {Array<{ weight: number, changePct: number|null }>} holdings
 * @param {number|null} fxPct
 */
export function estimateWithFx(holdingsPct, fxPct) {
  if (holdingsPct == null || !Number.isFinite(holdingsPct)) return null;
  const fx = fxPct != null && Number.isFinite(fxPct) ? fxPct : 0;
  return holdingsPct + fx;
}

/**
 * 占净值权重加权（%），权重为占基金净值百分比，未披露部分视为现金不动
 * @param {Array<{ weight: number, changePct: number|null }>} holdings
 */
export function estimateFromHoldings(holdings) {
  let sumWC = 0;
  let used = 0;
  for (const h of holdings) {
    if (h.changePct == null || !Number.isFinite(h.changePct)) continue;
    sumWC += h.weight * h.changePct;
    used += h.weight;
  }
  if (used <= 0) return null;
  return sumWC / 100;
}

/**
 * @param {number|null} baseNav
 * @param {number|null} changePct
 */
export function estimatedNavFromChange(baseNav, changePct) {
  const nav = Number(baseNav);
  const chg = Number(changePct);
  if (!Number.isFinite(nav) || !Number.isFinite(chg)) return null;
  return nav * (1 + chg / 100);
}

/**
 * 单只基金穿透估值（%）
 * @param {string} code
 * @param {number|null} fxPct
 */
export async function computeFundImpact(code, fxPct = null) {
  const pack = await fetchFundHoldings(code);
  let holdings = pack.holdings || [];
  if (!holdings.length) {
    return {
      impactPct: null,
      reportDate: pack.reportDate,
      recentReportDate: pack.recentReportDate,
      annualReportDate: pack.annualReportDate,
      count: 0,
      holdings: [],
      weightCoverage: 0,
    };
  }

  const quotes = await fetchSinaQuotes(holdings.map((h) => h.fetchCode));
  holdings = holdings.map((h) => {
    const q = quotes[h.fetchCode];
    if (!q) return h;
    return { ...h, name: h.name || q.name, changePct: q.changePct };
  });

  const holdingsPct = estimateFromHoldings(holdings);
  const impactPct = estimateWithFx(holdingsPct, fxPct);
  const weightCoverage = holdings.reduce((s, h) => s + h.weight, 0);

  return {
    impactPct,
    reportDate: pack.reportDate,
    recentReportDate: pack.recentReportDate,
    annualReportDate: pack.annualReportDate,
    count: holdings.length,
    holdings,
    weightCoverage,
  };
}

export { DEFAULT_CODE };
