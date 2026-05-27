const API_BASE = import.meta.env.VITE_API_BASE ?? '';

async function apiJson(path, opts = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { Accept: 'application/json', ...opts.headers },
    ...opts,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
  return body;
}

/** @returns {Promise<{ assetViewMode: string, display?: object, displayContext?: object }>} */
export async function fetchSettings() {
  return apiJson('/api/settings');
}

/** @param {'settled'|'realtime'} assetViewMode */
export async function saveAssetViewMode(assetViewMode) {
  return apiJson('/api/settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ assetViewMode }),
  });
}

/** @returns {Promise<{ records: object[] }>} */
export async function fetchDailyHistory(limit = 30) {
  return apiJson(`/api/history/daily?limit=${limit}`);
}

/** @returns {Promise<{ meta: object, funds: object[] }>} */
export async function fetchPortfolio() {
  return apiJson('/api/portfolio');
}

/** @returns {Promise<{ updatedAt: string, indices: object[], fxPct: number|null, funds: object[] }>} */
export async function fetchLive() {
  return apiJson('/api/live');
}

/**
 * @param {string} code
 * @returns {Promise<{ impactPct: number|null, holdings: object[], note: string }>}
 */
export async function fetchFundDetail(code) {
  return apiJson(`/api/fund/${encodeURIComponent(code)}/detail`);
}

/** @returns {Promise<{ meta: object, funds: object[] }>} */
export async function addFundApi(data) {
  return apiJson('/api/funds', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
}

/** @param {number} id @param {object} patch */
export async function updateFundApi(id, patch) {
  return apiJson(`/api/funds/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
}

/** @param {number} id */
export async function deleteFundApi(id) {
  return apiJson(`/api/funds/${id}`, { method: 'DELETE' });
}

/** @param {{ meta?: object, funds: object[] }} data */
export async function savePortfolio(data) {
  return apiJson('/api/portfolio', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
}

/** @returns {Promise<{ changed: boolean, events: object[] }>} */
export async function triggerSettle(dryRun = false) {
  return apiJson(`/api/settle/run${dryRun ? '?dryRun=1' : ''}`, { method: 'POST' });
}

export function isApiMode() {
  return true;
}
