/**
 * 季报 PDF §5.9 基金投资明细 — 官方披露，非推断。
 * Mac App 不打包 pdf-parse（~80MB）；动态 import，缺失时跳过基金明细解析。
 */
import { toSinaFetchCode } from './quotes.js';

const SEC_59 =
  '5.9 报告期末按公允价值占基金资产净值比例大小排序的前十名基金投资明细';
const SEC_510 = '5.10 投资组合报告附注';

/** 官方英文名 → 行情代码 + xyz 常用中文名 */
const FUND_INVESTMENT_CATALOG = [
  {
    match: /sk\s*hynix|7709/i,
    code: '7709',
    name: '南方两倍做多海力士',
    marketId: 116,
  },
  {
    match: /samsung|7747/i,
    code: '7747',
    name: '南方两倍做多三星',
    marketId: 116,
  },
  {
    match: /semiconductor\s*bull\s*3x|semiconduc\s*tor\s*bull|soxl/i,
    code: 'SOXL',
    name: '三倍做多半导体ETF-Direxion',
    marketId: 105,
  },
  {
    match: /spdr s&p biotech|xbi/i,
    code: 'XBI',
    name: 'SPDR S&P Biotech ETF',
    marketId: 105,
  },
  {
    match: /usd money market/i,
    code: 'GFUSDMMF',
    name: 'GF USD Money Market Fund',
    marketId: null,
  },
];

export function mapFundInvestment(rawName) {
  const raw = String(rawName || '').trim();
  const compact = raw.replace(/\s+/g, '').toLowerCase();
  for (const item of FUND_INVESTMENT_CATALOG) {
    if (item.match.test(raw) || item.match.test(compact)) return { ...item, rawName: raw };
  }
  return {
    match: null,
    code: raw.replace(/\s+/g, '').slice(0, 16) || 'FUND',
    name: raw.replace(/\s+/g, ' ').trim(),
    marketId: null,
    rawName: raw,
  };
}

function continuationTail(segment) {
  const cont = [];
  for (const line of segment.split('\n')) {
    const t = line.trim();
    if (!t) continue;
    if (/^\d+$/.test(t)) break;
    if (
      /^[a-z]/.test(t) ||
      /^veraged|^oduct$|^ETF$/i.test(t) ||
      (cont.length && /^[A-Za-z]{1,12}$/.test(t))
    ) {
      cont.push(t);
      continue;
    }
    break;
  }
  return cont.join(' ');
}

/**
 * @param {string} text 季报 PDF 全文
 * @returns {{ name: string, code: string, weight: number, marketId: number|null, fetchCode: string|null, source: 'report-fund' }[]}
 */
export function parseFundInvestmentsFromReport(text) {
  const i59 = text.indexOf(SEC_59);
  if (i59 < 0) return [];
  const i510 = text.indexOf(SEC_510, i59);
  let chunk = text.slice(i59 + SEC_59.length, i510 > 0 ? i510 : undefined).trim();
  if (!chunk || /未持有基金|^无[。.]?$/m.test(chunk.replace(/\s/g, ''))) return [];

  chunk = chunk
    .replace(/\n-- \d+ of \d+ --[\s\S]*?第\s*\d+\s*页\s*\n/g, '\n')
    .replace(/第\s*\d+\s*页/g, '')
    .replace(/(\d)\n(\d)/g, '$1$2');

  const pairs = [...chunk.matchAll(/([\d,]+\.[\d]+)\s+([\d.]+)/g)]
    .map((m) => ({
      value: m[1],
      weight: parseFloat(m[2]),
      index: m.index ?? 0,
      end: (m.index ?? 0) + m[0].length,
    }))
    .filter((p) => Number.isFinite(p.weight) && p.weight > 0 && p.weight <= 20);

  if (!pairs.length) return [];

  const holdings = [];
  for (let i = 0; i < pairs.length; i++) {
    const pair = pairs[i];
    const prevEnd = i > 0 ? pairs[i - 1].end : 0;
    const nextStart = i + 1 < pairs.length ? pairs[i + 1].index : chunk.length;

    const rawBlock = chunk.slice(prevEnd, pair.index);
    const tail = continuationTail(chunk.slice(pair.end, nextStart));
    const combined = `${rawBlock} ${tail}`.replace(/\s+/g, ' ').trim();

    const seqMatch = combined.match(/(?:^|\s)(\d+)\s+([\s\S]+)$/);
    const rawName = (seqMatch ? seqMatch[2] : combined)
      .replace(/^序\s*号\s*基金名称[\s\S]*?%\)\s*/i, '')
      .replace(/开放式基\s*金/g, '')
      .replace(/契约型开\s*放式/g, '')
      .replace(/权益类\s*交易型开放\s*式/g, '')
      .replace(/CSOP Ass\s*et Manage\s*ment Ltd/gi, '')
      .replace(/Rafferty\s*Asset\s*Managemen\s*t LLC/gi, '')
      .replace(/SSgA Funds\s*Management Inc/gi, '')
      .replace(/GF International Investment Management Ltd/gi, '')
      .replace(/Krane Funds Advisors LLC/gi, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (!rawName || rawName.length < 4) continue;

    const mapped = mapFundInvestment(rawName);
    const fetchCode =
      mapped.marketId != null
        ? toSinaFetchCode(mapped.code, mapped.marketId, mapped.name)
        : null;
    holdings.push({
      code: mapped.code,
      name: mapped.name,
      weight: pair.weight,
      marketId: mapped.marketId,
      fetchCode,
      changePct: null,
      price: null,
      source: 'report-fund',
      rawName: mapped.rawName,
    });
  }
  return holdings;
}

/** @param {Buffer} buf */
async function extractPdfText(buf) {
  let PDFParse;
  try {
    ({ PDFParse } = await import('pdf-parse'));
  } catch {
    return null;
  }
  const parser = new PDFParse({ data: buf });
  try {
    return (await parser.getText()).text;
  } finally {
    await parser.destroy();
  }
}

export async function fetchLatestQuarterlyReportText(code, year = 2026) {
  const url = `https://np-anotice-stock.eastmoney.com/api/security/ann?sr=-1&page_size=40&page_index=1&ann_type=Fund&client_source=web&stock_list=${String(code).trim()}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`announcement HTTP ${res.status}`);
  const body = await res.json();
  const list = body?.data?.list || [];
  const hit = list.find(
    (x) =>
      String(x.title || '').includes(String(year)) &&
      /第1季度报告|第一季度报告/.test(x.title),
  );
  if (!hit?.art_code) return null;

  const pdfUrl = `http://pdf.dfcfw.com/pdf/H2_${hit.art_code}_1.pdf`;
  const pdfRes = await fetch(pdfUrl);
  if (!pdfRes.ok) throw new Error(`PDF HTTP ${pdfRes.status}: ${pdfUrl}`);
  const buf = Buffer.from(await pdfRes.arrayBuffer());
  const text = await extractPdfText(buf);
  if (!text) return null;
  return {
    artCode: hit.art_code,
    title: hit.title,
    reportDate: `${year}-03-31`,
    pdfUrl,
    text,
  };
}

export async function fetchReportFundInvestments(code) {
  const report = await fetchLatestQuarterlyReportText(code);
  if (!report) return { report: null, fundInvestments: [] };
  return {
    report: {
      artCode: report.artCode,
      title: report.title,
      reportDate: report.reportDate,
      pdfUrl: report.pdfUrl,
    },
    fundInvestments: parseFundInvestmentsFromReport(report.text),
  };
}
