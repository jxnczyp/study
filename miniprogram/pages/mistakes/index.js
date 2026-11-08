const { loadState, requireLogin, toast } = require('../../utils/api');
const { subjects, grades, questionTypes } = require('../../utils/study');
Page({
  data: { loading: true, error: '', subjects: ['全部', ...subjects], grades: ['全部年级', ...grades], questionTypes: ['全部题型', ...questionTypes], gradeFilter: '全部年级', typeFilter: '全部题型', subject: '全部', statuses: ['全部状态', '待巩固', '已掌握'], status: 0, search: '', visible: [], total: 0 },
  onShow() { this.refresh(); },
  async onPullDownRefresh() { await this.refresh(); wx.stopPullDownRefresh(); },
  async refresh() {
    try { const state = await loadState(); this.questions = state.questions; this.setData({ subjects: [...new Set(['全部', ...subjects, ...state.questions.map(q => q.subject)])], grades: [...new Set(['全部年级', ...grades, ...state.questions.map(q => q.grade || '未分类')])], questionTypes: [...new Set(['全部题型', ...questionTypes, ...state.questions.map(q => q.question_type || '未分类')])], loading: false, error: '', total: state.questions.length }); this.filter(); }
    catch(e) { this.setData({ loading: false, error: e.message }); }
  },
  filter() { const { subject, status, search, gradeFilter, typeFilter } = this.data; this.setData({ visible: (this.questions || []).filter(q => (subject === '全部' || q.subject === subject) && (!gradeFilter || gradeFilter === '全部年级' || (q.grade || '未分类') === gradeFilter) && (!typeFilter || typeFilter === '全部题型' || (q.question_type || '未分类') === typeFilter) && (status === 0 || !!q.mastered === (status === 2)) && `${q.title} ${q.content} ${q.topic}`.toLowerCase().includes(search.toLowerCase())) }); },
  classify(e) { const { field, range } = e.currentTarget.dataset; this.setData({ [field]: this.data[range][Number(e.detail.value)] }); this.filter(); },
  changeSubject(e) { this.setData({ subject: e.currentTarget.dataset.subject }); this.filter(); },
  changeStatus(e) { this.setData({ status: Number(e.detail.value) }); this.filter(); },
  search(e) { this.setData({ search: e.detail.value }); this.filter(); },
  add() { if (requireLogin()) wx.navigateTo({ url: '/pages/add/index' }); },
  detail(e) { wx.navigateTo({ url: '/pages/detail/index?id=' + encodeURIComponent(e.currentTarget.dataset.id) }); }
});
