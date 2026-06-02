/**
 * WeChat mini program API client.
 */

function getAppConfig() {
  const app = getApp();
  let baseUrl = app?.globalData?.apiBase || '';
  let token = app?.globalData?.apiToken || '';
  try {
    baseUrl = baseUrl || wx.getStorageSync('fund-tracker-api-base') || '';
    token = token || wx.getStorageSync('fund-tracker-api-token') || '';
  } catch {
    /* ignore */
  }
  return { baseUrl: baseUrl.replace(/\/$/, ''), token };
}

function request(path, opts = {}) {
  const { baseUrl, token } = getAppConfig();
  if (!baseUrl) {
    return Promise.reject(new Error('请先在收益页配置 Remote API 地址'));
  }
  return new Promise((resolve, reject) => {
    wx.request({
      url: `${baseUrl}${path}`,
      method: opts.method || 'GET',
      data: opts.data,
      header: {
        Accept: 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(opts.header || {}),
      },
      success(res) {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(res.data);
          return;
        }
        reject(new Error((res.data && res.data.error) || `HTTP ${res.statusCode}`));
      },
      fail(err) {
        reject(new Error(err.errMsg || 'network error'));
      },
    });
  });
}

module.exports = {
  fetchPortfolio() {
    return request('/api/portfolio');
  },
  fetchLive() {
    return request('/api/live');
  },
  fetchDailyHistory(limit = 30) {
    return request(`/api/history/daily?limit=${limit}`);
  },
  saveApiConfig(baseUrl, token) {
    wx.setStorageSync('fund-tracker-api-base', baseUrl.replace(/\/$/, ''));
    wx.setStorageSync('fund-tracker-api-token', token || '');
    const app = getApp();
    if (app) {
      app.globalData.apiBase = baseUrl;
      app.globalData.apiToken = token;
    }
  },
  getApiConfig: getAppConfig,
};
