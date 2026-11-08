const { request, uploadPhoto, requireLogin, toast } = require('../../utils/api');
const { grades, subjects, questionTypes } = require('../../utils/study');
const VERDICTS = { incorrect: '疑似错题', correct: '可能正确', uncertain: '待确认' };
Page({
  data: { grades: ['自动识别', ...grades], subjects: ['自动识别', ...subjects], questionTypes, gradeIndex: 0, subjectIndex: 0, imagePath: '', imageId: '', assessmentId: '', questions: [], selectedCount: 0, busy: false, checking: true, enabled: false, error: '', filter: '全部', filters: ['全部', '疑似错题', '待确认', '可能正确'], statusText: '', savedCount: 0 },
  onLoad() { requireLogin(); },
  onShow() { if (getApp().globalData.user) this.loadCapabilities(); },
  onUnload() { this.disposed = true; },
  async loadCapabilities() {
    this.setData({ checking: true, error: '' });
    try { const caps = await request('/capabilities'); this.setData({ enabled: caps.visualAssessment }); }
    catch(e) { this.setData({ error: e.message }); } finally { this.setData({ checking: false }); }
  },
  hint(e) { if (!this.data.busy) this.setData({ [e.currentTarget.dataset.field]: Number(e.detail.value) }); },
  choosePhoto(e) {
    if (this.data.busy || !requireLogin()) return;
    wx.chooseMedia({ count: 1, mediaType: ['image'], sourceType: [e.currentTarget.dataset.source], sizeType: ['compressed'], success: result => {
      if (!result.tempFiles[0] || this.disposed) return;
      const apply = () => this.setData({ imagePath: result.tempFiles[0].tempFilePath, imageId: '', assessmentId: '', questions: [], selectedCount: 0, savedCount: 0, error: '' });
      if (this.data.questions.length) wx.showModal({ title: '替换当前作业？', content: '尚未收录的识别结果和修改将丢失。', success: r => { if (r.confirm) apply(); } });
      else apply();
    }, fail: error => {
      if ((error.errMsg || '').includes('cancel')) return;
      if (/auth|deny|permission/i.test(error.errMsg || '')) wx.showModal({ title: '需要相机或相册权限', content: '请在设置中允许拍照或选图。', confirmText: '打开设置', success: r => { if (r.confirm) wx.openSetting({}); } });
      else toast('无法读取图片，请重试');
    } });
  },
  preview() { if (this.data.imagePath) wx.previewImage({ current: this.data.imagePath, urls: [this.data.imagePath] }); },
  async analyze() {
    if (this.data.busy || !this.data.enabled || !this.data.imagePath || !requireLogin()) return;
    const confirmed = await new Promise(resolve => wx.showModal({ title: '识别作业并辅助判题', content: '图片将提交给已配置的视觉模型服务。模型会自行解题，结果仅作参考；不会自动收录，需你逐题确认。', confirmText: '开始检查', success: r => resolve(r.confirm), fail: () => resolve(false) }));
    if (!confirmed || this.disposed || this.data.busy) return;
    this.setData({ busy: true, error: '', statusText: '正在上传并检查作业，通常需要一些时间…' });
    try {
      if (!this.data.imageId) {
        const file = await new Promise(resolve => wx.compressImage({ src: this.data.imagePath, quality: 90, compressedWidth: 2000, success: r => resolve(r.tempFilePath), fail: () => resolve(this.data.imagePath) }));
        const uploaded = await uploadPhoto(file);
        if (this.disposed) return;
        this.setData({ imageId: uploaded.imageId });
      }
      const result = await request('/photos/' + this.data.imageId + '/assess', { grade: this.data.gradeIndex ? this.data.grades[this.data.gradeIndex] : '未分类', subject: this.data.subjectIndex ? this.data.subjects[this.data.subjectIndex] : '其他' }, 'POST', 120000);
      if (this.disposed) return;
      const allGrades = [...new Set([...this.data.grades, ...result.questions.map(q => q.grade)])];
      const allSubjects = [...new Set([...this.data.subjects, ...result.questions.map(q => q.subject)])];
      const allTypes = [...new Set([...questionTypes, ...result.questions.map(q => q.questionType)])];
      const questions = result.questions.map((q, index) => ({ ...q, index, selected: false, saved: false, visible: true, label: VERDICTS[q.verdict], confidenceLabel: Math.round(q.confidence * 100), gradeIndex: allGrades.indexOf(q.grade), subjectIndex: allSubjects.indexOf(q.subject), typeIndex: allTypes.indexOf(q.questionType) }));
      this.setData({ assessmentId: result.id, questions, grades: allGrades, subjects: allSubjects, questionTypes: allTypes, selectedCount: 0, savedCount: 0, filter: '全部', statusText: questions.length ? `识别出 ${questions.length} 道题，请确认哪些是错题。` : '未识别到完整题目，请重拍或手动录入。' });
    } catch(e) { if (!this.disposed) this.setData({ error: e.message }); }
    finally { if (!this.disposed) this.setData({ busy: false }); }
  },
  filter(e) {
    const filter = e.currentTarget.dataset.value;
    this.setData({ filter, questions: this.data.questions.map(q => ({ ...q, visible: filter === '全部' || q.label === filter })) });
  },
  toggle(e) {
    if (this.data.busy) return;
    const index = Number(e.currentTarget.dataset.index);
    const questions = this.data.questions.map(q => q.index === index && !q.saved ? { ...q, selected: !q.selected } : q);
    this.setData({ questions, selectedCount: questions.filter(q => q.selected && !q.saved).length });
  },
  selectMistakes() {
    if (this.data.busy) return;
    const questions = this.data.questions.map(q => ({ ...q, selected: !q.saved && q.verdict === 'incorrect' }));
    this.setData({ questions, selectedCount: questions.filter(q => q.selected).length });
  },
  edit(e) {
    if (this.data.busy) return;
    const { index, field } = e.currentTarget.dataset;
    if (!['title', 'content', 'studentAnswer', 'answer', 'explanation', 'grade', 'subject', 'questionType'].includes(field)) return;
    this.setData({ [`questions[${Number(index)}].${field}`]: e.detail.value });
  },
  classification(e) {
    if (this.data.busy) return;
    const { index, field } = e.currentTarget.dataset; const selected = Number(e.detail.value);
    const config = { grade: ['grades', 'gradeIndex'], subject: ['subjects', 'subjectIndex'], questionType: ['questionTypes', 'typeIndex'] }[field];
    if (!config) return;
    this.setData({ [`questions[${Number(index)}].${field}`]: this.data[config[0]][selected], [`questions[${Number(index)}].${config[1]}`]: selected });
  },
  async saveSelected() {
    if (this.data.busy || !requireLogin()) return;
    const selected = this.data.questions.filter(q => q.selected && !q.saved);
    if (!selected.length) return toast('请勾选需要收录的错题');
    if (selected.some(q => !q.content.trim() || !q.answer.trim())) return toast('请先补充每道选中题目的题干和参考答案');
    if (selected.some(q => ['自动识别', ''].includes(q.grade) || ['自动识别', ''].includes(q.subject))) return toast('请确认每道错题的年级和学科');
    const confirmed = await new Promise(resolve => wx.showModal({ title: `确认收录 ${selected.length} 道错题？`, content: '请确认这些确实是错题，并核对学生作答、模型参考答案和分类。待确认题或可能正确的题仅在你确认有错时收录。', confirmText: '确认收录', success: r => resolve(r.confirm), fail: () => resolve(false) }));
    if (!confirmed || this.data.busy || this.disposed) return;
    this.setData({ busy: true, error: '' });
    try {
      const items = selected.map(({ index, title, content, answer, explanation, studentAnswer, grade, subject, questionType, topic }) => ({ index, title, content, answer, explanation, studentAnswer, grade, subject, questionType, topic }));
      await request('/assessments/' + this.data.assessmentId + '/import', { confirmed: true, items });
      if (this.disposed) return;
      const indexes = new Set(selected.map(q => q.index));
      const questions = this.data.questions.map(q => indexes.has(q.index) ? { ...q, saved: true, selected: false } : q);
      this.setData({ questions, selectedCount: 0, savedCount: questions.filter(q => q.saved).length }); toast(`已收录 ${selected.length} 道错题`);
    } catch(e) { if (!this.disposed) this.setData({ error: e.message }); }
    finally { if (!this.disposed) this.setData({ busy: false }); }
  },
  manual() { wx.navigateTo({ url: '/pages/add/index' }); },
  notebook() { wx.switchTab({ url: '/pages/mistakes/index' }); }
});
