const api = require('../../utils/api');
const { fmtMoney } = require('../../utils/format');

Page({
  data: {
    apiBase: '',
    apiToken: '',
    loading: false,
    error: '',
    summary: null,
    days: [],
  },

  onShow() {
    const { baseUrl, token } = api.getApiConfig();
    this.setData({ apiBase: baseUrl, apiToken: token });
    if (baseUrl) this.loadHistory();
  },

  onApiBaseInput(e) {
    this.setData({ apiBase: e.detail.value });
  },

  onApiTokenInput(e) {
    this.setData({ apiToken: e.detail.value });
  },

  saveApi() {
    api.saveApiConfig(this.data.apiBase, this.data.apiToken);
    wx.showToast({ title: '已保存', icon: 'success' });
    this.loadHistory();
  },

  async loadHistory() {
    this.setData({ loading: true, error: '' });
    try {
      const res = await api.fetchDailyHistory(14);
      const records = res.records || [];
      const days = records.slice(-7).map((r) => ({
        date: String(r.date || '').slice(5),
        profit: fmtMoney(r.profit, true),
        cls: r.profit > 0 ? 'up' : r.profit < 0 ? 'down' : '',
      }));
      const total = records.reduce((s, r) => s + (Number(r.profit) || 0), 0);
      this.setData({
        loading: false,
        days,
        summary: { total: fmtMoney(total, true) },
      });
    } catch (e) {
      this.setData({ loading: false, error: e.message || String(e) });
    }
  },
});
