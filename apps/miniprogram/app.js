
App({
  globalData: {
    apiBase: '',
    apiToken: '',
  },
  onLaunch() {
    try {
      const base = wx.getStorageSync('fund-tracker-api-base');
      const token = wx.getStorageSync('fund-tracker-api-token');
      if (base) this.globalData.apiBase = base;
      if (token) this.globalData.apiToken = token;
    } catch {
      /* ignore */
    }
  },
});
