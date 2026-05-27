/**
 * 通用持仓权重模型：年报 + Q1 披露 → 估算当前权重。
 * 参数由 calibrate-valuation.js 对官方 JZZZL 历史回测选优，非逐基金 hardcode。
 */

/** @typedef {{
 *   highThreshold: number,
 *   highScale: number,
 *   usMidThreshold: number,
 *   usMidDelta: number,
 *   usLowBandMin: number,
 *   usLowBandMax: number,
 *   usLowBandDelta: number,
 *   usTrim1Min: number,
 *   usTrim1Max: number,
 *   usTrim1Delta: number,
 *   usTrim2Min: number,
 *   usTrim2Max: number,
 *   usTrim2Delta: number,
 *   smallCapPattern: string,
 *   smallCapMinWeight: number,
 *   smallCapScale: number,
 *   smallCapMaxWeight: number,
 *   orphanMinWeight: number,
 *   mergedTarget: number,
 *   annualHighSplit: number,
 *   annualHighDrop: number,
 * }} WeightModelParams */

export const DEFAULT_WEIGHT_PARAMS = {
  highThreshold: 4,
  highScale: 0.38,
  usMidThreshold: 2.75,
  usMidDelta: 1,
  usLowBandMin: 0,
  usLowBandMax: 0,
  usLowBandDelta: 0,
  usTrim1Min: 0,
  usTrim1Max: 0,
  usTrim1Delta: 0,
  usTrim2Min: 0,
  usTrim2Max: 0,
  usTrim2Delta: 0,
  smallCapPattern: '空客|历峰|AIR|CFR',
  smallCapMinWeight: 1.5,
  smallCapScale: 0.08,
  smallCapMaxWeight: 0.2,
  orphanMinWeight: 0.05,
  mergedTarget: 96,
  /** 年报-only 且 weight≥此值：按固定百分点下调（非 highScale） */
  annualHighSplit: 5.15,
  annualHighDrop: 2,
};

/** @param {Partial<WeightModelParams>} overrides */
export function mergeWeightParams(overrides = {}) {
  return { ...DEFAULT_WEIGHT_PARAMS, ...overrides };
}


/**
 * 已披露（Q1/移动端/§5.9）持仓：仅应用增减持提示，不改写季报权重。
 * @param {number} weight
 * @param {{ code: string, name?: string, positionChangeType?: string|null, positionChangePct?: number|null }} h
 * @param {WeightModelParams} params
 */
function adjustDisclosedWeight(weight, h, params) {
  if (
    h.positionChangeType === '减持' &&
    h.positionChangePct != null &&
    Number.isFinite(h.positionChangePct)
  ) {
    return Math.max(weight * (1 + h.positionChangePct / 100), params.orphanMinWeight);
  }
  if (
    h.positionChangeType === '增持' &&
    h.positionChangePct != null &&
    Number.isFinite(h.positionChangePct)
  ) {
    return Math.max(weight * (1 + h.positionChangePct / 100), params.orphanMinWeight);
  }
  return weight;
}

/**
 * 年报-only（未进 Q1/移动端披露）持仓：估算当前权重。
 * 不再对 2.75%+ 美股一律减 1pp（会误伤德州仪器等仍接近满仓的中盘）。
 */
function adjustAnnualOnlyWeight(weight, h, params) {
  if (
    h.positionChangeType === '减持' &&
    h.positionChangePct != null &&
    Number.isFinite(h.positionChangePct)
  ) {
    return Math.max(weight * (1 + h.positionChangePct / 100), params.orphanMinWeight);
  }

  const split = params.annualHighSplit ?? DEFAULT_WEIGHT_PARAMS.annualHighSplit;
  const drop = params.annualHighDrop ?? DEFAULT_WEIGHT_PARAMS.annualHighDrop;
  if (weight >= split) {
    return Math.max(weight - drop, params.orphanMinWeight);
  }
  if (weight > params.highThreshold) {
    return Math.max(weight * params.highScale, params.orphanMinWeight);
  }

  if (params.smallCapPattern && weight > params.smallCapMinWeight) {
    const re = new RegExp(params.smallCapPattern, 'i');
    if (re.test(`${h.name || ''}${h.code || ''}`)) {
      return Math.min(weight * params.smallCapScale, params.smallCapMaxWeight);
    }
  }

  return weight;
}

/**
 * @param {Array<object>} holdings
 * @param {Set<string>} disclosedKeys Q1/移动端/合成仓位 — 不做衰减
 * @param {WeightModelParams} params
 */
export function applyWeightModel(holdings, disclosedKeys, params) {
  return holdings.map((h) => {
    const key = h._mergeKey ?? String(h.code).toUpperCase();
    const annualOnly = !disclosedKeys.has(key);
    const weight = annualOnly
      ? adjustAnnualOnlyWeight(h.weight, h, params)
      : adjustDisclosedWeight(h.weight, h, params);
    if (Math.abs(weight - h.weight) < 0.005) return h;
    return { ...h, weight: Math.round(weight * 100) / 100 };
  });
}

/**
 * @param {Array<{ weight: number, code: string }>} holdings
 * @param {Set<string>} disclosedKeys
 * @param {WeightModelParams} params
 */
export function finalizeHoldings(holdings, disclosedKeys, params) {
  const kept = holdings.filter((h) => {
    const key = h._mergeKey ?? String(h.code).toUpperCase();
    if (disclosedKeys.has(key)) return true;
    return h.weight >= params.orphanMinWeight;
  });
  const sorted = [...kept].sort(
    (a, b) => b.weight - a.weight || String(a.name || a.code).localeCompare(String(b.name || b.code)),
  );
  const cap = params.mergedTarget || DEFAULT_WEIGHT_PARAMS.mergedTarget;
  if (sorted.length <= cap) return sorted;
  return sorted.slice(0, cap);
}
