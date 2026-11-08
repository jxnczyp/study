import express from 'express';
import { DatabaseSync } from 'node:sqlite';
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { seedQuestions, generateQuestions } from './questions.js';
import { installPhotos } from './photos.js';
import { catalog, classification, migrateClassification } from './classification.js';
import { installAssessments } from './assessments.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
mkdirSync(process.env.DATA_DIR || path.join(root, 'data'), { recursive: true });
const db = new DatabaseSync(path.join(process.env.DATA_DIR || path.join(root, 'data'), 'study.sqlite'));
db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, name TEXT NOT NULL, email TEXT UNIQUE NOT NULL, password TEXT NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, user_id INTEGER REFERENCES users(id), expires INTEGER);
CREATE TABLE IF NOT EXISTS questions (id INTEGER PRIMARY KEY, user_id INTEGER REFERENCES users(id), subject TEXT, title TEXT, content TEXT, answer TEXT, options TEXT DEFAULT '[]', explanation TEXT, topic TEXT, difficulty TEXT, reason TEXT, mastered INTEGER DEFAULT 0, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS attempts (id INTEGER PRIMARY KEY, user_id INTEGER REFERENCES users(id), question_id INTEGER, correct INTEGER, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS generated_questions (id TEXT PRIMARY KEY, data TEXT, expires INTEGER);`);
const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '1mb' }));
function sessionToken(req) {
  const bearer = /^Bearer ([a-f0-9]{64})$/.exec(req.headers.authorization || '');
  return bearer?.[1] || req.headers.cookie?.split(';').map(x => x.trim()).find(x => x.startsWith('study_session='))?.slice(14);
}
app.use((req, res, next) => {
  if (req.method !== 'GET' && req.headers.origin && req.headers.origin !== `${req.protocol}://${req.headers.host}` && !/^http:\/\/(localhost|127\.0\.0\.1):5173$/.test(req.headers.origin)) return res.status(403).json({ error: '不允许的请求来源' });
  const token = sessionToken(req);
  if (token) req.user = db.prepare('SELECT u.id, u.name, u.email FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=? AND s.expires>?').get(token, Date.now());
  next();
});
const auth = (req, res, next) => req.user ? next() : res.status(401).json({ error: '请先登录，保存你的学习进度' });
installPhotos(app, db, auth);
migrateClassification(db);
installAssessments(app, db, auth, insertQuestion);
app.get('/api/catalog', (req, res) => res.json(catalog));
function insertQuestion(userId, q) {
  const result = db.prepare('INSERT INTO questions(user_id,subject,title,content,answer,options,explanation,topic,difficulty,reason,mastered) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(userId, q.subject, q.title, q.content, q.answer, JSON.stringify(q.options || []), q.explanation || '', q.topic || '未分类', q.difficulty || '中等', q.reason || '概念不清', q.mastered ? 1 : 0).lastInsertRowid;
  db.prepare('UPDATE questions SET grade=?,question_type=?,student_answer=?,judgment=?,judgment_reason=?,assessment_source=?,confidence=? WHERE id=?').run(classification(q.grade), classification(q.questionType), String(q.studentAnswer || '').slice(0,10000), q.judgment || '', q.judgmentReason || '', q.assessmentSource || 'manual', q.confidence ?? null, result);
  return result;
}
const loginAttempts = new Map();
app.post('/api/auth/:action', (req, res) => {
  const { action } = req.params;
  if (!['login', 'register'].includes(action)) return res.sendStatus(404);
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  const key = req.ip;
  const rate = loginAttempts.get(key);
  if (rate && rate.until > Date.now() && rate.count >= 20) return res.status(429).json({ error: '尝试过于频繁，请 15 分钟后重试' });
  loginAttempts.set(key, { count: rate?.until > Date.now() ? rate.count + 1 : 1, until: rate?.until > Date.now() ? rate.until : Date.now() + 900000 });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || password.length < 8 || password.length > 128) return res.status(400).json({ error: '请输入有效邮箱和 8–128 位密码' });
  let user;
  if (action === 'register') {
    const name = String(req.body.name || '').trim().slice(0, 30);
    if (!name) return res.status(400).json({ error: '请输入昵称' });
    const salt = randomBytes(16).toString('hex');
    const hash = scryptSync(password, salt, 64).toString('hex');
    try {
      const result = db.prepare('INSERT INTO users(name,email,password) VALUES(?,?,?)').run(name, email, `${salt}:${hash}`);
      user = { id: Number(result.lastInsertRowid), name, email };
      seedQuestions.forEach(q => insertQuestion(user.id, q));
    } catch (e) {
      if (e.message.includes('UNIQUE')) return res.status(409).json({ error: '该邮箱已注册，请直接登录' });
      throw e;
    }
  } else {
    const found = db.prepare('SELECT * FROM users WHERE email=?').get(email);
    const [salt, hash] = (found?.password || 'none:' + '0'.repeat(128)).split(':');
    const actual = scryptSync(password, salt, 64);
    if (!found || !timingSafeEqual(Buffer.from(hash, 'hex'), actual)) return res.status(401).json({ error: '邮箱或密码不正确' });
    user = { id: found.id, name: found.name, email: found.email };
  }
  const token = randomBytes(32).toString('hex');
  db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(token, user.id, Date.now() + 30 * 86400000);
  res.cookie('study_session', token, { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', maxAge: 30 * 86400000 });
  res.json({ user, ...(req.headers['x-client-type'] === 'miniprogram' ? { token } : {}) });
});
app.post('/api/logout', (req, res) => {
  const token = sessionToken(req);
  if (token) db.prepare('DELETE FROM sessions WHERE token=?').run(token);
  res.clearCookie('study_session'); res.json({ ok: true });
});
app.get('/api/state', (req, res) => {
  const questions = req.user ? db.prepare('SELECT * FROM questions WHERE user_id=? ORDER BY id DESC').all(req.user.id).map(q => ({ ...q, options: JSON.parse(q.options) })) : seedQuestions.map((q, i) => ({ ...q, id: `demo-${i}`, created_at: new Date(Date.now() - i * 86400000).toISOString() }));
  const attempts = req.user ? db.prepare('SELECT * FROM attempts WHERE user_id=? ORDER BY created_at DESC').all(req.user.id) : [];
  res.json({ user: req.user || null, questions, attempts });
});
app.post('/api/questions', auth, (req, res) => {
  const q = req.body;
  try { q.subject = classification(q.subject, '其他'); q.grade = classification(q.grade); q.questionType = classification(q.questionType); } catch(e) { return res.status(400).json({ error: e.message }); }
  if (!q.subject || !String(q.content || '').trim() || !String(q.answer || '').trim()) return res.status(400).json({ error: '请填写学科、题目和正确答案' });
  if ([q.content, q.answer, q.explanation, q.title].some(v => String(v || '').length > 10000)) return res.status(400).json({ error: '单个字段不能超过 10000 字' });
  q.title = String(q.title || q.content.slice(0, 24)).trim();
  if (q.imageId && !db.prepare('SELECT id FROM photos WHERE id=? AND user_id=?').get(String(q.imageId), req.user.id)) return res.status(400).json({ error: '原图不存在或无权使用，请重新上传' });
  const id = insertQuestion(req.user.id, q);
  if (q.imageId) db.prepare('UPDATE questions SET image_id=? WHERE id=?').run(q.imageId, id);
  res.json({ id: Number(id) });
});
app.patch('/api/questions/:id', auth, (req, res) => {
  const result = db.prepare('UPDATE questions SET mastered=? WHERE id=? AND user_id=?').run(req.body.mastered ? 1 : 0, req.params.id, req.user.id);
  if (!result.changes) return res.status(404).json({ error: '错题不存在' });
  res.json({ ok: true });
});
app.delete('/api/questions/:id', auth, (req, res) => {
  const question = db.prepare('SELECT image_id,source_image_id FROM questions WHERE id=? AND user_id=?').get(req.params.id, req.user.id);
  const result = db.prepare('DELETE FROM questions WHERE id=? AND user_id=?').run(req.params.id, req.user.id);
  if (!result.changes) return res.status(404).json({ error: '错题不存在' });
  db.prepare('DELETE FROM assessment_imports WHERE question_id=?').run(req.params.id);
  for (const imageId of new Set([question?.image_id, question?.source_image_id].filter(Boolean))) db.prepare('DELETE FROM photos WHERE id=? AND user_id=? AND NOT EXISTS(SELECT 1 FROM questions WHERE image_id=? OR source_image_id=?)').run(imageId, req.user.id, imageId, imageId);
  res.json({ ok: true });
});
app.post('/api/generate', (req, res) => {
  const { subject = '数学', count = 5, difficulty = '中等' } = req.body;
  if (!['数学', '英语', '物理', '语文'].includes(subject) || !Number.isInteger(count) || count < 1 || count > 20 || !['基础', '中等', '挑战'].includes(difficulty)) return res.status(400).json({ error: '请检查组卷设置（1–20 题）' });
  db.prepare('DELETE FROM generated_questions WHERE expires<?').run(Date.now());
  const questions = generateQuestions(subject, count, difficulty).map(q => {
    q.id = `generated-${randomBytes(16).toString('hex')}`;
    db.prepare('INSERT INTO generated_questions VALUES(?,?,?)').run(q.id, JSON.stringify(q), Date.now() + 86400000);
    return q;
  });
  res.json({ questions });
});
app.post('/api/attempts', auth, (req, res) => {
  const { questionId, answer, selfAssessment } = req.body;
  let q;
  if (questionId && !String(questionId).startsWith('generated-')) q = db.prepare('SELECT * FROM questions WHERE id=? AND user_id=?').get(questionId, req.user.id);
  else {
    const generated = db.prepare('SELECT data FROM generated_questions WHERE id=? AND expires>?').get(questionId || '', Date.now());
    if (generated) q = JSON.parse(generated.data);
  }
  if (!q) return res.status(404).json({ error: '题目不存在' });
  if (q.assessment_source === 'vision' && typeof selfAssessment !== 'boolean') return res.status(400).json({ error: '此题使用参考解析自评，请查看解析后确认是否答对' });
  const correct = q.assessment_source === 'vision' ? selfAssessment : String(answer).trim().replace(/−/g, '-') === String(q.answer).trim().replace(/−/g, '-');
  if (!correct && q.generated) insertQuestion(req.user.id, { ...q, reason: '练习出错', mastered: 0 });
  db.prepare('INSERT INTO attempts(user_id,question_id,correct) VALUES(?,?,?)').run(req.user.id, q.generated ? null : q.id, correct ? 1 : 0);
  res.json({ correct, answer: q.answer, explanation: q.explanation });
});
app.use(express.static(path.join(root, 'dist')));
app.get('/{*path}', (req, res) => res.sendFile(path.join(root, 'dist/index.html')));
app.use((err, req, res, next) => { console.error(err); res.status(500).json({ error: '服务暂时异常，请稍后重试' }); });
const port = process.env.PORT || 3001;
app.listen(port, '0.0.0.0', () => console.log(`拾知 API http://localhost:${port}`));
