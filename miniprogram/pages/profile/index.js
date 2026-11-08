const { loadState, request, clearSession, toast } = require('../../utils/api');
const { summarize } = require('../../utils/study');
Page({
  data: { user: null, initial: '知', stats: {}, loading: true, error: '', exporting: false, loggingOut: false },
  onShow() { this.refresh(); },
  async onPullDownRefresh() { await this.refresh(); wx.stopPullDownRefresh(); },
  async refresh() {
    try { const state = await loadState(); this.setData({ user: state.user, initial: state.user ? state.user.name.slice(0, 1) : '知', stats: summarize(state), loading: false, error: '' }); }
    catch(e) { this.setData({ loading: false, error: e.message }); }
  },
  login() { if (!this.data.user) wx.navigateTo({ url: '/pages/login/index' }); },
  logout() {
    if (this.data.loggingOut) return;
    wx.showModal({ title: '退出登录？', content: '已保存的错题和学习记录会保留。', confirmColor: '#285440', success: async result => {
      if (!result.confirm) return;
      this.setData({ loggingOut: true });
      try { await request('/logout', {}); clearSession(); await this.refresh(); toast('已退出登录'); }
      catch(e) { toast(e); } finally { this.setData({ loggingOut: false }); }
    } });
  },
  async exportData() {
    if (this.data.exporting) return;
    this.setData({ exporting: true });
    try {
      const state = await loadState();
      const filePath = wx.env.USER_DATA_PATH + '/shizhi-study.json';
      const data = JSON.stringify({ exportedAt: new Date().toISOString(), questions: state.questions, attempts: state.attempts }, null, 2);
      await new Promise((resolve, reject) => wx.getFileSystemManager().writeFile({ filePath, data, encoding: 'utf8', success: resolve, fail: reject }));
      if (wx.shareFileMessage) wx.shareFileMessage({ filePath, fileName: '拾知-学习记录.json', fail: () => toast('文件已生成，可稍后重试分享') });
      else toast('当前微信版本不支持文件分享，请升级微信');
    } catch(e) { toast(e); } finally { this.setData({ exporting: false }); }
  },
  help() { wx.showModal({ title: '拾知 · 使用指南', content: '① 在错题本收录题目和答案。\n② 首页开始复习，理解后标记掌握。\n③ 练习页按学科、难度组题。\n④ 登录后的错题和记录按账号独立保存。\n\n数学、物理采用规则变式，英语、语文使用题库。当前支持邮箱账号登录。', showCancel: false, confirmColor: '#285440' }); }
});
