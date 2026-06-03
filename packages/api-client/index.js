
/**
 * HTTP client for fund-tracker API — shared by Web, Capacitor, mini program, Mac Swift shell.
 * @param {{ baseUrl?: string, getToken?: () => string|null|undefined, fetchImpl?: typeof fetch }} [options]
 */
export function createClient(options = {}) {
  let baseUrl = options.baseUrl ?? '';
  const getToken = options.getToken ?? (() => null);
  const fetchImpl = options.fetchImpl ?? fetch;

  /** @param {string} next */
  function setBaseUrl(next) {
    baseUrl = next ?? '';
  }

  /** @param {string} path @param {RequestInit} [opts] */
  async function apiJson(path, opts = {}) {
    const headers = { Accept: 'application/json', ...(opts.headers ?? {}) };
    const token = getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await fetchImpl(`${baseUrl}${path}`, { ...opts, headers });
    if (res.status === 204) return null;
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
    return body;
  }

  async function fetchLiveStatus() {
    return apiJson('/api/live/status');
  }

  /** @param {{ liveRevision?: string } | null} [cached] */
  async function fetchLive(cached = null) {
    const headers = { Accept: 'application/json' };
    const token = getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
    if (cached?.liveRevision) headers['If-None-Match'] = `"${cached.liveRevision}"`;
    const res = await fetchImpl(`${baseUrl}/api/live`, { headers });
    if (res.status === 304) {
      return { unchanged: true, liveRevision: cached?.liveRevision ?? '' };
    }
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
    return body;
  }

  async function fetchSettings() {
    return apiJson('/api/settings');
  }

  /** @param {'settled'|'realtime'} assetViewMode */
  async function saveAssetViewMode(assetViewMode) {
    return apiJson('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ assetViewMode }),
    });
  }

  /** @param {number} [limit] */
  async function fetchDailyHistory(limit = 30) {
    return apiJson(`/api/history/daily?limit=${limit}`);
  }

  async function fetchWatchlist() {
    return apiJson('/api/watchlist');
  }

  async function fetchWatchlistLive() {
    return apiJson('/api/watchlist/live');
  }

  /** @param {{ code: string, name?: string }} data */
  async function addWatchlistApi(data) {
    return apiJson('/api/watchlist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
  }

  /** @param {string} code */
  async function removeWatchlistApi(code) {
    return apiJson(`/api/watchlist/${encodeURIComponent(code)}`, { method: 'DELETE' });
  }

  async function fetchPortfolio() {
    return apiJson('/api/portfolio');
  }

  /** @param {string} code */
  async function fetchFundDetail(code) {
    return apiJson(`/api/fund/${encodeURIComponent(code)}/detail`);
  }

  /** @param {object} data */
  async function addFundApi(data) {
    return apiJson('/api/funds', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
  }

  /** @param {number} id @param {object} patch */
  async function updateFundApi(id, patch) {
    return apiJson(`/api/funds/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
  }

  /** @param {number} id */
  async function deleteFundApi(id) {
    return apiJson(`/api/funds/${id}`, { method: 'DELETE' });
  }

  /** @param {{ meta?: object, funds: object[] }} data */
  async function savePortfolio(data) {
    return apiJson('/api/portfolio', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
  }

  /** @param {boolean} [dryRun] */
  async function triggerSettle(dryRun = false) {
    return apiJson(`/api/settle/run${dryRun ? '?dryRun=1' : ''}`, { method: 'POST' });
  }

  async function fetchHealth() {
    return apiJson('/api/health');
  }

  /**
   * @param {string} scope
   * @param {string} month
   * @param {{ unit?: string, period?: string, anchor?: string, day?: string, weekStart?: string, year?: string, monthKey?: string, yearKey?: string }} [opts]
   */
  async function fetchProfitCalendarApi(scope, month, opts = {}) {
    const q = new URLSearchParams({ scope, month });
    if (opts.unit) q.set('unit', opts.unit);
    if (opts.period) q.set('period', opts.period);
    if (opts.anchor) q.set('anchor', opts.anchor);
    if (opts.day) q.set('day', opts.day);
    if (opts.weekStart) q.set('weekStart', opts.weekStart);
    if (opts.year) q.set('year', opts.year);
    if (opts.monthKey) q.set('monthKey', opts.monthKey);
    if (opts.yearKey) q.set('yearKey', opts.yearKey);
    return apiJson(`/api/profit/calendar?${q}`);
  }

  /** @param {string} scope @param {string} from @param {string} to */
  async function fetchProfitRangeDetailApi(scope, from, to) {
    const q = new URLSearchParams({ scope, from, to });
    return apiJson(`/api/profit/range-detail?${q}`);
  }

  /** @param {string} month */
  async function fetchProfitSummaryApi(month) {
    return apiJson(`/api/profit/summary?month=${encodeURIComponent(month)}`);
  }

  /** @param {string} day @param {string} scope */
  async function fetchProfitDayDetailApi(day, scope) {
    return apiJson(`/api/profit/day/${encodeURIComponent(day)}?scope=${encodeURIComponent(scope)}`);
  }

  return {
    setBaseUrl,
    getBaseUrl: () => baseUrl,
    apiJson,
    fetchLive,
    fetchLiveStatus,
    fetchSettings,
    saveAssetViewMode,
    fetchDailyHistory,
    fetchWatchlist,
    fetchWatchlistLive,
    addWatchlistApi,
    removeWatchlistApi,
    fetchPortfolio,
    fetchFundDetail,
    addFundApi,
    updateFundApi,
    deleteFundApi,
    savePortfolio,
    triggerSettle,
    fetchHealth,
    fetchProfitCalendarApi,
    fetchProfitRangeDetailApi,
    fetchProfitSummaryApi,
    fetchProfitDayDetailApi,
  };
}
