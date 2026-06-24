/**
 * 基金估值配置：由 calibrate-valuation.js 根据历史 JZZZL 自动写入。
 * 运行时只读 profile，新增基金跑校准即可，无需改代码。
 */
import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mergeWeightParams } from './weight-model.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const DATA_ROOT = process.env.FUND_TRACKER_DATA_DIR?.trim()
  ? resolve(process.env.FUND_TRACKER_DATA_DIR)
  : join(ROOT, 'data');
/** 本地校准结果（gitignore）；`npm run calibrate:valuation` 写入 */
export const PROFILES_PATH = join(DATA_ROOT, 'valuation-profiles.json');
/** 仓库示例，与 `src/portfolio.json` 种子基金一致 */
export const PROFILES_EXAMPLE_PATH = join(ROOT, 'data', 'valuation-profiles.example.json');

/** @typedef {'proxy'|'holdings'|'index'|'fundgz'} ValuationStrategy */

/**
 * @typedef {object} SyntheticHolding
 * @property {string} code
 * @property {string} [name]
 * @property {number} weight
 * @property {number} [marketId]
 * @property {string} [fetchCode]
 * @property {string} [source] calibrated | residual
 */

/**
 * @typedef {object} FundValuationProfile
 * @property {ValuationStrategy} strategy
 * @property {string|null} [proxyCode]
 * @property {import('./weight-model.js').WeightModelParams} [weightParams]
 * @property {SyntheticHolding[]} [syntheticHoldings]
 * @property {number} [mae]
 * @property {string} [algoLabel]
 * @property {number} [reportFundCount]
 * @property {string} [calibratedAt]
 */

/** @type {Record<string, FundValuationProfile>|null} */
let cache = null;

function resolveProfilesPath() {
  if (existsSync(PROFILES_PATH)) return PROFILES_PATH;
  if (existsSync(PROFILES_EXAMPLE_PATH)) return PROFILES_EXAMPLE_PATH;
  return null;
}

export function loadValuationProfiles() {
  if (cache) return cache;
  const pathToLoad = resolveProfilesPath();
  if (!pathToLoad) {
    cache = {};
    return cache;
  }
  try {
    cache = JSON.parse(readFileSync(pathToLoad, 'utf8'));
  } catch {
    cache = {};
  }
  return cache;
}

export function invalidateProfileCache() {
  cache = null;
}

/** @param {Record<string, FundValuationProfile>} profiles */
export function saveValuationProfiles(profiles) {
  mkdirSync(dirname(PROFILES_PATH), { recursive: true });
  writeFileSync(PROFILES_PATH, `${JSON.stringify(profiles, null, 2)}\n`, 'utf8');
  cache = profiles;
}

/** 主动/QDII 等名称特征 — 即使含「纳指」也不走 proxy */
const ACTIVE_NAME_MARKERS =
  /全球|科技|成长|精选|先锋|新兴|互联|互联网|高端制造|智选|产业|混合|优选|配置|价值|制造|升级|先锋|互联/i;

/** 纯指数联接 proxy 对应的指数条 label（养基宝口径：直接用指数涨跌幅） */
export function indexStripLabelForProxyFund(fundName) {
  const n = String(fundName || '').trim();
  if (!n) return null;
  if (/黄金/.test(n)) return null;
  if (/标普.*信息科技|信息科技.*指数/.test(n)) return '标普500';
  if (/纳斯达克.*科技.*ETF联接|ETF联接.*纳斯达克.*科技/i.test(n)) return '纳斯达克100';
  if (/标普500|博时标普|标普指数/.test(n) && !ACTIVE_NAME_MARKERS.test(n)) return '标普500';
  if (/纳斯达克100|纳指100|NASDAQ100/i.test(n) && !ACTIVE_NAME_MARKERS.test(n)) return '纳斯达克100';
  if (/纳指/.test(n) && !/全球|科技|精选|成长|互联|高端|先锋|新兴|互联网|智选|产业/.test(n)) {
    return '纳斯达克100';
  }
  if (/159915|创业板ETF/.test(n)) return '创业板';
  return null;
}

/**
 * 纯指数联接/ETF 联接：仅这类走 proxy（如 xxx纳斯达克100、xxx标普500、黄金）。
 * @param {string} fundName
 */
export function isIndexProxyFund(fundName) {
  const n = String(fundName || '').trim();
  if (!n) return false;
  if (/黄金/.test(n)) return true;
  if (/159915|创业板ETF/.test(n)) return true;
  if (/标普.*信息科技|信息科技.*指数/.test(n)) return true;
  if (/纳斯达克.*科技.*ETF联接|ETF联接.*纳斯达克.*科技/i.test(n)) return true;
  if (/标普500|博时标普|标普500指数|标普指数/.test(n) && !ACTIVE_NAME_MARKERS.test(n)) return true;
  if (/纳斯达克100|纳指100|NASDAQ100/i.test(n) && !ACTIVE_NAME_MARKERS.test(n)) return true;
  if (/纳指/.test(n) && !/全球|科技|精选|成长|互联|高端|先锋|新兴|互联网|智选|产业/.test(n)) return true;
  return false;
}

/** @param {string} fundName */
export function defaultProxyCodeForIndex(fundName) {
  const n = String(fundName || '');
  if (/黄金/.test(n)) return '000217';
  if (/标普500|博时标普|标普/.test(n)) return '050025';
  if (/159915|创业板/.test(n)) return '159915';
  if (/纳斯达克100|纳指100|纳指/.test(n)) return '006479';
  return null;
}

/** profile 与基金名称综合后的运行时策略 */
export function resolveValuationStrategy(code, fundName = '', profileStrategy = null) {
  if (isIndexProxyFund(fundName)) return 'proxy';
  return 'holdings';
}

/** @param {string} fundName */
export function discoverProxyCandidates(fundName, fundCode) {
  const n = String(fundName || '');
  const c = String(fundCode || '').trim();
  /** @type {string[]} */
  const out = [];

  if (/黄金/.test(n)) out.push('000217', '518880', '000216');
  if (/纳斯达克100|纳指100|纳指/.test(n) && !/全球|科技|精选|成长|互联/.test(n)) {
    out.push('006479', '013499', '040046');
  }
  if (/标普500|博时标普|标普/.test(n)) out.push('050025', '513500', '006075');
  if (/创业板|159915/.test(n)) out.push('159915', '000001');
  if (/全球|科技|成长|精选|QDII/i.test(n)) out.push('006479', '050025');

  return [...new Set(out.filter(Boolean))];
}

/** 穿透估值未覆盖时，尝试用行业 ETF 解释残差 */
export const RESIDUAL_ETF_CANDIDATES = [
  { code: 'SOXL', name: '三倍做多半导体ETF-Direxion', marketId: 105, fetchCode: 'gb_soxl' },
  { code: 'SOXX', name: '半导体ETF-iShares', marketId: 105, fetchCode: 'gb_soxx' },
  { code: 'SMH', name: '半导体ETF-VanEck', marketId: 105, fetchCode: 'gb_smh' },
  { code: 'QQQ', name: '纳指100 ETF', marketId: 105, fetchCode: 'gb_qqq' },
  { code: 'TQQQ', name: '三倍做多纳指ETF', marketId: 105, fetchCode: 'gb_tqqq' },
];

/** @param {string} code @param {string} [fundName] @returns {FundValuationProfile} */
export function getFundValuationProfile(code, fundName = '') {
  const profiles = loadValuationProfiles();
  const hit = profiles[String(code).trim()];
  const base = hit
    ? {
        ...hit,
        weightParams: mergeWeightParams(hit.weightParams),
        syntheticHoldings: hit.syntheticHoldings || [],
      }
    : inferDefaultProfile(code, fundName);

  const strategy = resolveValuationStrategy(code, fundName, base.strategy);
  const proxyCode =
    strategy === 'proxy'
      ? base.proxyCode || defaultProxyCodeForIndex(fundName)
      : base.proxyCode || defaultProxyCodeForIndex(fundName);

  return { ...base, strategy, proxyCode };
}

/** @param {string} code @param {string} fundName */
function inferDefaultProfile(code, fundName) {
  const strategy = resolveValuationStrategy(code, fundName);
  return {
    strategy,
    proxyCode: defaultProxyCodeForIndex(fundName),
    weightParams: mergeWeightParams(),
    syntheticHoldings: [],
  };
}

/** @param {string} code @param {string} [fundName] @returns {ValuationStrategy} */
export function pickValuationStrategy(code, fundName = '') {
  return resolveValuationStrategy(code, fundName);
}

/** @param {string} code @param {string} [fundName] */
export function proxyCodeFor(code, fundName = '') {
  const p = getFundValuationProfile(code, fundName);
  return p.proxyCode || defaultProxyCodeForIndex(fundName) || null;
}

/** @param {string} code @param {string} [fundName] */
export function getWeightParams(code, fundName = '') {
  return getFundValuationProfile(code, fundName).weightParams;
}

/** @param {string} code @param {string} [fundName] */
export function getSyntheticHoldings(code, fundName = '') {
  return getFundValuationProfile(code, fundName).syntheticHoldings || [];
}

/** @param {string} code @param {string} [fundName] */
export function getProxyCandidates(code, fundName = '') {
  const p = getFundValuationProfile(code, fundName);
  const discovered = discoverProxyCandidates(fundName, code);
  if (p.proxyCode && !discovered.includes(p.proxyCode)) discovered.unshift(p.proxyCode);
  return discovered;
}

export { mergeWeightParams, DEFAULT_WEIGHT_PARAMS } from './weight-model.js';
