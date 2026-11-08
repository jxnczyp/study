const { subjects, grades, questionTypes } = require('../data/catalog.js');
const difficulties = ['基础', '中等', '挑战'];
function dateKey(date) { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`; }
function parseDate(text) { return new Date(text.includes('T') ? text : text.replace(' ', 'T') + 'Z'); }
function summarize(state) {
  const { questions, attempts } = state;
  const today = dateKey(new Date());
  const mastered = questions.filter(q => q.mastered).length;
  const active = new Set(attempts.map(a => dateKey(parseDate(a.created_at))));
  let streak = 0; const cursor = new Date();
  if (!active.has(today)) cursor.setDate(cursor.getDate() - 1);
  while (active.has(dateKey(cursor))) { streak++; cursor.setDate(cursor.getDate() - 1); }
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(); d.setDate(d.getDate() - 6 + i);
    return { label: `${d.getMonth() + 1}/${d.getDate()}`, count: attempts.filter(a => dateKey(parseDate(a.created_at)) === dateKey(d)).length };
  });
  const max = Math.max(5, ...days.map(d => d.count));
  return {
    total: questions.length, mastered, pending: questions.length - mastered,
    percent: questions.length ? Math.round(mastered / questions.length * 100) : 0,
    todayCount: attempts.filter(a => dateKey(parseDate(a.created_at)) === today).length,
    attemptsCount: attempts.length,
    accuracy: attempts.length ? Math.round(attempts.filter(a => a.correct).length / attempts.length * 100) : 0,
    streak, days: days.map(d => ({ ...d, height: Math.max(3, d.count / max * 100) })),
    distribution: [...new Set([...subjects, ...questions.map(q => q.subject)])].filter(name => questions.some(q => q.subject === name)).map((name, i) => {
      const qs = questions.filter(q => q.subject === name); const done = qs.filter(q => q.mastered).length;
      return { name, color: ['green', 'orange', 'purple', 'blue'][i % 4], count: qs.length, mastered: done, width: qs.length ? Math.round(done / qs.length * 100) : 0 };
    })
  };
}
module.exports = { subjects, grades, questionTypes, difficulties, summarize, dateKey };
