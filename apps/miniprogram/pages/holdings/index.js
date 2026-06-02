
const api = require('../../utils/api');
const { fmtMoney, fmtPct } = require('../../utils/format');

Page({
  data: {
    loading: true,
    error: '',
    totals: null,
    funds: [],
  },

  onShow() {
    this.loadData();
  },

  async loadData() {
    this.setData({ loading: true, error: '' });
    try {
      const [portfolio, live] = await Promise.all([api.fetchPortfolio(), api.fetchLive()]);
      const liveById = new Map((live.funds || []).map((f) => [f.id, f]));
      const funds = (portfolio.funds || []).map((f) => {
        const row = liveById.get(f.id) || {};
        const ep = row.estimateProfit;
        const amount = f.amount ?? 0;
        const pct = ep != null && amount > 0 ? (ep / amount) * 100 : null;
        return {
          id: f.id,
          name: f.name,
          code: f.code,
          amount: fmtMoney(amount),
          ep: ep != null ? fmtMoney(ep, true) : '—',
          pct: fmtPct(pct),
          epClass: ep > 0 ? 'up' : ep < 0 ? 'down' : '',
        };
      });
      const totals = live.totals || {};
      this.setData({
        loading: false,
        funds,
        totals: {
          assets: fmtMoney(totals.settledAssets ?? 0),
          rt1: fmtMoney(totals.realtimeProfit ?? 0, true),
          est: fmtMoney(totals.realtimeAssets ?? 0),
          rt1Pct: fmtPct(totals.realtimeProfitPct),
        },
      });
    } catch (e) {
      this.setData({
        loading: false,
        error: e.message || String(e),
      });
    }
  },

  onPullDownRefresh() {
    this.loadData().finally(() => wx.stopPullDownRefresh());
  },
});
