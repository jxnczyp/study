const { loadState, requireLogin, toast, startPractice } = require('../../utils/api');
const { summarize } = require('../../utils/study');
Page({
  data: { loading: true, error: '', user: null, stats: {}, recent: [] },
  onShow() { this.refresh(); },
  async onPullDownRefresh() { await this.refresh(); wx.stopPullDownRefresh(); },
  async refresh() {
    this.setData({ error: '' });
    try { const state = await loadState(); this.setData({ user: state.user, stats: summarize(state), recent: state.questions.slice(0, 4), loading: false }); }
    catch (e) { this.setData({ loading: false, error: e.message }); }
  },
  reviewSheet() { if (requireLogin()) wx.navigateTo({ url: '/pages/review/index' }); },
  add() { if (requireLogin()) wx.navigateTo({ url: '/pages/add/index' }); },
  all() { wx.switchTab({ url: '/pages/mistakes/index' }); },
  generate() { wx.switchTab({ url: '/pages/generate/index' }); },
  detail(e) { wx.navigateTo({ url: '/pages/detail/index?id=' + encodeURIComponent(e.currentTarget.dataset.id) }); },
  review() {
    const state = getApp().globalData.state;
    if (!state) return toast('请先加载学习数据');
    const pending = state.questions.filter(q => !q.mastered).sort(() => Math.random() - .5).slice(0, 10);
    if (!pending.length) return toast('全部错题已掌握，试试新练习吧');
    startPractice(pending, '今日复习');
  }
});
