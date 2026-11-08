const { loadState, request, startPractice, toast } = require('../../utils/api');
const { subjects, grades, questionTypes, difficulties } = require('../../utils/study');
Page({
  data: { subjects, grades: ['全部年级', ...grades], questionTypes: ['全部题型', ...questionTypes], gradeFilter: '全部年级', typeFilter: '全部题型', difficulties, subject: '数学', difficulty: '中等', source: 'generated', count: 5, busy: false },
  async onShow() { try { const state = await loadState(); this.setData({ subjects: [...new Set([...subjects, ...state.questions.map(q => q.subject)])], grades: [...new Set(['全部年级', ...grades, ...state.questions.map(q => q.grade || '未分类')])], questionTypes: [...new Set(['全部题型', ...questionTypes, ...state.questions.map(q => q.question_type || '未分类')])] }); } catch(e) { toast(e); } },
  choose(e) { this.setData({ [e.currentTarget.dataset.field]: e.currentTarget.dataset.value }); },
  classify(e) { this.setData({ [e.currentTarget.dataset.field]: this.data[e.currentTarget.dataset.range][Number(e.detail.value)] }); },
  count(e) { this.setData({ count: Number(e.detail.value) }); },
  async generate() {
    if (this.data.busy) return;
    this.setData({ busy: true });
    const { subject, difficulty, source, count, gradeFilter, typeFilter } = this.data;
    try {
      let questions;
      if (source === 'generated' && (!['数学', '英语', '物理', '语文'].includes(subject) || gradeFilter !== '全部年级' || typeFilter !== '全部题型')) return toast('该条件暂不支持规则出题，请使用错题重练');
      if (source === 'generated') questions = (await request('/generate', { subject, difficulty, count })).questions;
      else { const state = await loadState(); questions = state.questions.filter(q => q.subject === subject && q.difficulty === difficulty && (gradeFilter === '全部年级' || q.grade === gradeFilter) && (typeFilter === '全部题型' || q.question_type === typeFilter)).sort(() => Math.random() - .5).slice(0, count); }
      if (!questions.length) return toast('该学科与难度下暂无错题，换个条件试试');
      startPractice(questions, source === 'generated' ? '知识变式' : '错题重练');
    } catch(e) { toast(e); } finally { this.setData({ busy: false }); }
  }
});
