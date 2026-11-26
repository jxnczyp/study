const { request, requireLogin, toast } = require('../../utils/api');
const { subjects, questionTypes, difficulties } = require('../../utils/study');
Page({
  data: {
    subjects, questionTypes, typeIndex: 0, customSubject: '', customType: '', difficulties, reasons: ['概念不清', '计算失误', '审题疏忽', '公式用错', '记忆模糊', '思路不对'], subjectIndex: 0, difficultyIndex: 0, reasonIndex: 0, title: '', content: '', answer: '', explanation: '', topic: '', classifying: false, accountGrade: '', touched: {},
    busy: false, error: ''
  },
  onLoad() {
    requireLogin();
    const user = getApp().globalData.user || wx.getStorageSync('shizhi_user');
    this.setData({ accountGrade: user?.grade || '未分类' });
  },
  onUnload() { this.disposed = true; },
  input(e) {
    const field = e.currentTarget.dataset.field;
    const update = { [field]: e.detail.value };
    if (field === 'customSubject') update['touched.subject'] = true;
    if (field === 'customType') update['touched.type'] = true;
    this.setData(update);
  },
  pick(e) {
    const field = e.currentTarget.dataset.field;
    this.setData({ [field]: Number(e.detail.value), [`touched.${field.replace('Index', '')}`]: true });
  },
  autoClassifyTap() { this.autoClassify(false); },
  async autoClassify(silent) {
    if (this.data.classifying || this.data.busy || !requireLogin()) return false;
    const d = this.data;
    if (!d.content.trim()) { if (!silent) this.setData({ error: '请先填写题目内容，再自动识别分类' }); return false; }
    this.setData({ classifying: true, ...(silent ? {} : { error: '' }) });
    try {
      const result = await request('/classify', { title: d.title, content: d.content, answer: d.answer }, 'POST', 60000);
      if (this.disposed) return false;
      const touched = d.touched || {}; const update = {};
      const subject = subjects.indexOf(result.subject);
      if (!touched.subject && subject >= 0) update.subjectIndex = subject;
      else if (!touched.subject && result.subject && result.subject !== '其他' && !d.customSubject.trim()) update.customSubject = result.subject;
      const type = questionTypes.indexOf(result.questionType);
      if (!touched.type && type >= 0) update.typeIndex = type;
      else if (!touched.type && result.questionType && result.questionType !== '未分类' && !d.customType.trim()) update.customType = result.questionType;
      if (!touched.difficulty && difficulties.includes(result.difficulty)) update.difficultyIndex = difficulties.indexOf(result.difficulty);
      if (!touched.topic && result.topic && !d.topic.trim()) update.topic = result.topic;
      if (Object.keys(update).length) this.setData(update);
      return true;
    } catch (e) {
      if (!this.disposed && !silent) this.setData({ error: e.message });
      return false;
    } finally { if (!this.disposed) this.setData({ classifying: false }); }
  },
  async save() {
    if (this.data.busy || !requireLogin()) return;
    const d = this.data;
    if (!d.title.trim() || !d.content.trim() || !d.answer.trim()) return this.setData({ error: '请完整填写标题、题目内容和正确答案' });
    const touched = d.touched || {};
    if (!touched.subject || !touched.type || !touched.difficulty) await this.autoClassify(true);
    const f = this.data;
    this.setData({ busy: true, error: '' });
    try { await request('/questions', { subject: f.customSubject.trim() || subjects[f.subjectIndex], questionType: f.customType.trim() || questionTypes[f.typeIndex], difficulty: difficulties[f.difficultyIndex], reason: f.reasons[f.reasonIndex], title: f.title, content: f.content, answer: f.answer, explanation: f.explanation, topic: f.topic }); toast('错题已收录'); wx.navigateBack(); }
    catch(e) { this.setData({ error: e.message }); } finally { this.setData({ busy: false }); }
  }
});
