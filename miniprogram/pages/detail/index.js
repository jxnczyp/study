const { loadState, request, downloadPhoto, requireLogin, toast, startPractice } = require('../../utils/api');
Page({
  data: { question: null, loading: true, error: '', busy: false, loggedIn: false, imagePath: '', imageLoading: false, imageError: '' },
  onLoad(options) { this.id = options.id; },
  onShow() { this.refresh(); },
  async refresh() {
    try { const state = await loadState(); const question = state.questions.find(q => String(q.id) === this.id); this.setData({ loading: false, question: question || null, loggedIn: !!state.user, error: question ? '' : '这道错题已不存在' }); if (question && question.image_id && !this.data.imagePath) this.loadPhoto(); }
    catch(e) { this.setData({ loading: false, error: e.message }); }
  },
  async loadPhoto() {
    if (!this.data.question || !this.data.question.image_id || this.data.imageLoading) return;
    this.setData({ imageLoading: true, imageError: '' });
    try { this.setData({ imagePath: await downloadPhoto(this.data.question.image_id) }); }
    catch(e) { this.setData({ imageError: '原图加载失败，点击重试' }); }
    finally { this.setData({ imageLoading: false }); }
  },
  async viewFullPage() {
    if (!this.data.question.source_image_id) return;
    try { const file = await downloadPhoto(this.data.question.source_image_id); wx.previewImage({ current: file, urls: [file] }); }
    catch(e) { toast(e); }
  },
  previewPhoto() { if (this.data.imagePath) wx.previewImage({ current: this.data.imagePath, urls: [this.data.imagePath] }); },
  review() { if (this.data.question) startPractice([this.data.question], '专项复习'); },
  async toggleMastered() {
    if (this.data.busy || !requireLogin()) return;
    this.setData({ busy: true });
    try { await request('/questions/' + this.id, { mastered: !this.data.question.mastered }, 'PATCH'); await this.refresh(); toast('掌握状态已更新'); }
    catch(e) { toast(e); } finally { this.setData({ busy: false }); }
  },
  remove() {
    if (!requireLogin()) return;
    wx.showModal({ title: '删除这道错题？', content: '删除后无法恢复，请确认。', confirmColor: '#b67f60', success: async result => {
      if (!result.confirm || this.data.busy) return;
      this.setData({ busy: true });
      try { await request('/questions/' + this.id, {}, 'DELETE'); toast('错题已删除'); wx.navigateBack(); }
      catch(e) { toast(e); } finally { this.setData({ busy: false }); }
    } });
  }
});
