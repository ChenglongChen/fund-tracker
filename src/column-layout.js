export const METRIC_COLUMNS = [
  { key: 'realtime', title: '实时收益', dateCol: 'realtime' },
  { key: 'daily', title: '当日收益', dateCol: 'daily' },
  { key: 'holding', title: '持有收益', dateCol: 'holding' },
];

const ORDER_KEY = 'fund-tracker-metric-column-order';
const VISIBILITY_KEY = 'fund-tracker-metric-column-visible';
const SUBLINE_KEY = 'fund-tracker-name-subline';
const FUND_ORDER_KEY = 'fund-tracker-fund-order';

/** @returns {string[]} */
export function loadMetricColumnOrder() {
  try {
    const raw = localStorage.getItem(ORDER_KEY);
    if (!raw) return METRIC_COLUMNS.map((c) => c.key);
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return METRIC_COLUMNS.map((c) => c.key);
    const valid = METRIC_COLUMNS.map((c) => c.key);
    const order = parsed.filter((k) => valid.includes(k));
    for (const k of valid) {
      if (!order.includes(k)) order.push(k);
    }
    return order;
  } catch {
    return METRIC_COLUMNS.map((c) => c.key);
  }
}

/** @param {string[]} order */
export function saveMetricColumnOrder(order) {
  const valid = METRIC_COLUMNS.map((c) => c.key);
  const next = order.filter((k) => valid.includes(k));
  for (const k of valid) {
    if (!next.includes(k)) next.push(k);
  }
  localStorage.setItem(ORDER_KEY, JSON.stringify(next));
  return next;
}

/** @returns {Record<string, boolean>} */
export function loadMetricColumnVisible() {
  try {
    const raw = localStorage.getItem(VISIBILITY_KEY);
    if (!raw) return Object.fromEntries(METRIC_COLUMNS.map((c) => [c.key, true]));
    const parsed = JSON.parse(raw);
    const out = Object.fromEntries(METRIC_COLUMNS.map((c) => [c.key, parsed[c.key] !== false]));
    return out;
  } catch {
    return Object.fromEntries(METRIC_COLUMNS.map((c) => [c.key, true]));
  }
}

/** @param {Record<string, boolean>} visible */
export function saveMetricColumnVisible(visible) {
  localStorage.setItem(VISIBILITY_KEY, JSON.stringify(visible));
  return visible;
}

/** @returns {'amount'} */
export function loadNameSubline() {
  try {
    const v = localStorage.getItem(SUBLINE_KEY);
    if (v === 'code') {
      localStorage.setItem(SUBLINE_KEY, 'amount');
    }
    return 'amount';
  } catch {
    return 'amount';
  }
}

/** @param {'amount'|'code'} mode */
export function saveNameSubline(mode) {
  localStorage.setItem(SUBLINE_KEY, 'amount');
  return 'amount';
}

/** @param {string} [scope] @returns {number[]} */
export function loadFundOrder(scope = 'all') {
  try {
    const raw = localStorage.getItem(`${FUND_ORDER_KEY}:${scope}`);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map((n) => Number(n)).filter(Number.isFinite) : [];
  } catch {
    return [];
  }
}

/** @param {number[]} ids @param {string} [scope] */
export function saveFundOrder(ids, scope = 'all') {
  localStorage.setItem(`${FUND_ORDER_KEY}:${scope}`, JSON.stringify(ids));
  return ids;
}

/** @param {string} key */
export function metricColumnDef(key) {
  return METRIC_COLUMNS.find((c) => c.key === key) ?? METRIC_COLUMNS[0];
}

/** @param {string[]} order */
export function orderedMetricColumns(order) {
  return order.map((key) => metricColumnDef(key));
}

/** @param {string[]} order @param {Record<string, boolean>} visible */
export function visibleMetricColumns(order, visible) {
  return orderedMetricColumns(order).filter((c) => visible[c.key] !== false);
}
