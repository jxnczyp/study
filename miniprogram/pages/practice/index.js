const { request, loadState, downloadPhoto, toast } = require('../../utils/api');
Page({
  data: { mode: '', question: null, options: [], index: 0, total: 0, progress: 0, answer: '', submitted: false, result: null, busy: false, finished: false, correctCount: 0, accuracy: 0, loggedIn: false, imageLoading: false },
  onLoad() {
    const practice = getApp().globalData.practice;
    if (!practice || !practice.questions.length) { wx.redirectTo({ url: '/pages/generate/index', fail: () => wx.switchTab({ url: '/pages/generate/index' }) }); return; }
    this.questions = practice.questions; this.results = [];
    this.userId = getApp().globalData.user && getApp().globalData.user.id;
    this.setData({ mode: practice.mode, total: this.questions.length, loggedIn: !!this.userId });
    this.showQuestion(0);
    if (wx.enableAlertBeforeUnload) wx.enableAlertBeforeUnload({ message: '确定结束练习吗？已提交的学习记录会保留。' });
  },
  onUnload() { getApp().globalData.practice = null; },
  showQuestion(index) {
    this.pendingSelfAssessment = undefined;
    const question = this.questions[index];
    this.setData({ index, question, progress: Math.round((index + 1) / this.questions.length * 100), answer: '', submitted: false, result: null, referenceVisible: false, options: (question.options || []).map((value, i) => ({ value, letter: String.fromCharCode(65 + i), selected: false, correct: false, incorrect: false })) });
  },
  choose(e) {
    if (this.data.submitted || this.data.busy) return;
    const answer = this.data.options[Number(e.currentTarget.dataset.index)].value;
    this.setData({ answer, options: this.data.options.map(o => ({ ...o, selected: o.value === answer })) });
  },
  input(e) { if (!this.data.submitted && !this.data.busy) this.setData({ answer: e.detail.value }); },
  async viewPhoto() {
    if (this.data.imageLoading || !this.data.question.image_id) return;
    this.setData({ imageLoading: true });
    try { const file = await downloadPhoto(this.data.question.image_id); wx.previewImage({ current: file, urls: [file] }); }
    catch(e) { toast(e); } finally { this.setData({ imageLoading: false }); }
  },
  revealReference() {
    if (this.data.busy || !this.data.answer.trim()) return toast('请先填写自己的答案');
    this.setData({ referenceVisible: true });
  },
  selfGrade(e) { this.pendingSelfAssessment = e.currentTarget.dataset.correct === 'yes'; this.submit(); },
  async submit() {
    if (this.data.busy || this.data.submitted || !this.data.answer.trim()) return;
    if (this.data.question.assessment_source === 'vision' && typeof this.pendingSelfAssessment !== 'boolean') return this.revealReference();
    this.setData({ busy: true });
    const { question: q, answer } = this.data;
    try {
      const user = getApp().globalData.user;
      if ((user && user.id) !== this.userId) throw new Error('账号状态已改变，请重新开始练习');
      const result = this.userId ? await request('/attempts', { questionId: q.id, answer, selfAssessment: this.pendingSelfAssessment }) : { correct: answer.trim().replace(/−/g, '-') === q.answer.trim().replace(/−/g, '-'), answer: q.answer, explanation: q.explanation };
      this.results.push(result);
      this.setData({ result, submitted: true, options: this.data.options.map(o => ({ ...o, correct: o.value === result.answer, incorrect: o.value === answer && !result.correct })) });
    } catch(e) { toast(e); } finally { this.setData({ busy: false }); }
  },
  next() {
    if (!this.data.submitted) return;
    if (this.data.index + 1 < this.questions.length) this.showQuestion(this.data.index + 1);
    else {
      const correctCount = this.results.filter(r => r.correct).length;
      this.setData({ finished: true, correctCount, accuracy: Math.round(correctCount / this.results.length * 100) });
      if (wx.disableAlertBeforeUnload) wx.disableAlertBeforeUnload();
      getApp().globalData.practice = null;
      if (this.userId) loadState().catch(toast);
    }
  },
  close() {
    if (wx.disableAlertBeforeUnload) wx.disableAlertBeforeUnload();
    wx.navigateBack({ fail: () => wx.switchTab({ url: '/pages/home/index' }) });
  },
  login() { wx.redirectTo({ url: '/pages/login/index' }); }
});
