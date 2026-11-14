const { request, uploadPhoto, requireLogin, toast } = require('../../utils/api');
const { subjects, grades, questionTypes, difficulties } = require('../../utils/study');
const VERDICTS = { incorrect: '疑似错题', correct: '可能正确', uncertain: '待确认' };
Page({
  data: {
    // 手动录入表单
    subjects, questionTypes, typeIndex: 0, customSubject: '', customType: '', difficulties, reasons: ['概念不清', '计算失误', '审题疏忽', '公式用错', '记忆模糊', '思路不对'], subjectIndex: 0, difficultyIndex: 0, reasonIndex: 0, title: '', content: '', answer: '', explanation: '', topic: '', classifying: false, accountGrade: '', touched: {},
    // 整页识别
    sheetGrades: ['自动识别', ...grades], sheetSubjects: ['自动识别', ...subjects], hintGradeIndex: 0, hintSubjectIndex: 0, imagePath: '', imageId: '', assessmentId: '', questions: [], selectedCount: 0, savedCount: 0, checking: true, enabled: false, filter: '全部', filters: ['全部', '疑似错题', '待确认', '可能正确'], statusText: '',
    busy: false, error: ''
  },
  onLoad() {
    requireLogin();
    const user = getApp().globalData.user || wx.getStorageSync('shizhi_user');
    this.setData({ accountGrade: user?.grade || '未分类' });
  },
  onShow() { if (getApp().globalData.user) this.loadCapabilities(); },
  onUnload() { this.disposed = true; },
  async loadCapabilities() {
    this.setData({ checking: true, error: '' });
    try { const caps = await request('/capabilities'); this.setData({ enabled: caps.visualAssessment }); }
    catch(e) { this.setData({ error: e.message }); } finally { this.setData({ checking: false }); }
  },
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
  previewPhoto() { if (this.data.imagePath) wx.previewImage({ current: this.data.imagePath, urls: [this.data.imagePath] }); },
  async analyze() {
    if (this.data.busy || !this.data.enabled || !this.data.imagePath || !requireLogin()) return;
    this.setData({ busy: true, error: '', statusText: '正在上传并检查作业，通常需要一些时间…' });
    try {
      if (!this.data.imageId) {
        const file = await new Promise(resolve => wx.compressImage({ src: this.data.imagePath, quality: 90, compressedWidth: 2000, success: r => resolve(r.tempFilePath), fail: () => resolve(this.data.imagePath) }));
        const uploaded = await uploadPhoto(file);
        if (this.disposed) return;
        this.setData({ imageId: uploaded.imageId });
      }
      const result = await request('/photos/' + this.data.imageId + '/assess', { grade: this.data.hintGradeIndex ? this.data.sheetGrades[this.data.hintGradeIndex] : '未分类', subject: this.data.hintSubjectIndex ? this.data.sheetSubjects[this.data.hintSubjectIndex] : '其他' }, 'POST', 120000);
      if (this.disposed) return;
      const allGrades = [...new Set([...this.data.sheetGrades, ...result.questions.map(q => q.grade)])];
      const allSubjects = [...new Set([...this.data.sheetSubjects, ...result.questions.map(q => q.subject)])];
      const allTypes = [...new Set([...questionTypes, ...result.questions.map(q => q.questionType)])];
      const questions = result.questions.map((q, index) => ({ ...q, index, selected: false, saved: false, visible: true, label: VERDICTS[q.verdict], confidenceLabel: Math.round(q.confidence * 100), gradeIndex: allGrades.indexOf(q.grade), subjectIndex: allSubjects.indexOf(q.subject), typeIndex: allTypes.indexOf(q.questionType) }));
      this.setData({ assessmentId: result.id, questions, sheetGrades: allGrades, sheetSubjects: allSubjects, questionTypes: allTypes, selectedCount: 0, savedCount: 0, filter: '全部', statusText: questions.length ? `识别出 ${questions.length} 道题，请确认哪些是错题。` : '未识别到完整题目，请重拍或手动录入。' });
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
    const config = { grade: ['sheetGrades', 'gradeIndex'], subject: ['sheetSubjects', 'subjectIndex'], questionType: ['questionTypes', 'typeIndex'] }[field];
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
  notebook() { wx.switchTab({ url: '/pages/mistakes/index' }); },
  hint(e) { if (!this.data.busy) this.setData({ [e.currentTarget.dataset.field]: Number(e.detail.value) }); },
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
