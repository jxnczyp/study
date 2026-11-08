import catalog from '../miniprogram/data/catalog.json' with { type: 'json' };
export { catalog };
export function classification(value, fallback = '未分类') {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 40) throw new Error('分类名称须为 1–40 字');
  return value.trim();
}
export function migrateClassification(db) {
  const columns = new Set(db.prepare('PRAGMA table_info(questions)').all().map(c => c.name));
  for (const [name, definition] of Object.entries({ grade: "TEXT DEFAULT '未分类'", question_type: "TEXT DEFAULT '未分类'", student_answer: "TEXT DEFAULT ''", judgment: "TEXT DEFAULT ''", judgment_reason: "TEXT DEFAULT ''", assessment_source: "TEXT DEFAULT 'manual'", confidence: 'REAL', source_image_id: 'TEXT' })) {
    if (!columns.has(name)) db.exec(`ALTER TABLE questions ADD COLUMN ${name} ${definition}`);
  }
}
