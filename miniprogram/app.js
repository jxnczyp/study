App({
  globalData: { user: null, state: null, practice: null },
  onLaunch() { this.globalData.user = wx.getStorageSync('shizhi_user') || null; },
  onError(error) { console.error('拾知小程序错误', error); }
});
