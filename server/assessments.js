import { randomBytes } from 'node:crypto';
import sharp from 'sharp';
import { assessPhoto, visionConfigured } from './vision.js';
import { classification } from './classification.js';
export function installAssessments(app, db, auth, insertQuestion) {
  db.exec(`CREATE TABLE IF NOT EXISTS assessments(id TEXT PRIMARY KEY,user_id INTEGER,photo_id TEXT,data TEXT,created_at INTEGER);
  CREATE TABLE IF NOT EXISTS assessment_imports(assessment_id TEXT,item_index INTEGER,question_id INTEGER,PRIMARY KEY(assessment_id,item_index));`);
  const active = new Set();
  app.get('/api/capabilities', (req, res) => res.json({ visualAssessment: visionConfigured(), imageRecognition: visionConfigured() }));
  app.post('/api/photos/:id/assess', auth, async (req, res) => {
    const photo = db.prepare('SELECT data FROM photos WHERE id=? AND user_id=?').get(req.params.id, req.user.id);
    if (!photo) return res.status(404).json({ error: '图片不存在' });
    if (!visionConfigured()) return res.status(503).json({ error: '尚未配置第三方视觉模型，请联系管理员完成服务端配置' });
    if (active.size >= 2 || active.has(req.user.id)) return res.status(429).json({ error: '判题服务繁忙，请稍后重试' });
    let hints;
    try { hints = { grade: classification(req.body.grade), subject: classification(req.body.subject, '其他') }; } catch(e) { return res.status(400).json({ error: e.message }); }
    active.add(req.user.id);
    try {
      const questions = await assessPhoto(Buffer.from(photo.data), hints);
      const id = randomBytes(16).toString('hex');
      db.prepare('INSERT INTO assessments VALUES(?,?,?,?,?)').run(id, req.user.id, req.params.id, JSON.stringify(questions), Date.now());
      res.json({ id, questions });
    } catch(e) { res.status(502).json({ error: e.message.startsWith('模型') ? e.message : '辅助判题失败，请检查服务配置或稍后重试' }); }
    finally { active.delete(req.user.id); }
  });
  app.post('/api/assessments/:id/import', auth, async (req, res) => {
    const assessment = db.prepare('SELECT * FROM assessments WHERE id=? AND user_id=?').get(req.params.id, req.user.id);
    if (!assessment) return res.status(404).json({ error: '识别记录不存在' });
    const photo = db.prepare('SELECT data FROM photos WHERE id=? AND user_id=?').get(assessment.photo_id, req.user.id);
    if (!photo) return res.status(410).json({ error: '原图已过期，请重新上传' });
    const items = req.body.items;
    if (!req.body.confirmed || !Array.isArray(items) || !items.length || items.length > 40) return res.status(400).json({ error: '请确认后勾选需要收录的错题' });
    const original = JSON.parse(assessment.data); const seen = new Set();
    let prepared;
    try {
      prepared = items.map(item => {
        if (!Number.isInteger(item.index) || !original[item.index] || seen.has(item.index)) throw new Error('题目索引不正确或重复');
        seen.add(item.index); const source = original[item.index];
        const value = key => typeof item[key] === 'string' ? item[key].trim() : source[key];
        const content = value('content'); const answer = value('answer');
        if (!content || !answer || content.length > 10000 || answer.length > 10000) throw new Error('每道错题都需要完整题干和经确认的参考答案');
        return { index: item.index, source, q: { title: (value('title') || content.slice(0, 24)).slice(0, 100), content, answer, explanation: value('explanation').slice(0, 10000), subject: classification(value('subject'), '其他'), grade: classification(value('grade')), questionType: classification(value('questionType')), studentAnswer: value('studentAnswer').slice(0, 10000), topic: value('topic').slice(0, 100), reason: '作业检查确认错题', difficulty: '中等', assessmentSource: 'vision', judgment: source.verdict, judgmentReason: source.reason, confidence: source.confidence } };
      });
      // 图片处理先完成，再以单个事务写入，避免部分收录。
      for (const entry of prepared) {
        if (db.prepare('SELECT question_id FROM assessment_imports WHERE assessment_id=? AND item_index=?').get(assessment.id, entry.index)) continue;
        if (entry.source.bbox) {
          const { width, height } = await sharp(Buffer.from(photo.data)).metadata(); const b = entry.source.bbox;
          const left = Math.min(width - 1, Math.floor(b.x * width)); const top = Math.min(height - 1, Math.floor(b.y * height));
          entry.cropped = await sharp(Buffer.from(photo.data)).extract({ left, top, width: Math.max(1, Math.min(width - left, Math.ceil(b.width * width))), height: Math.max(1, Math.min(height - top, Math.ceil(b.height * height))) }).jpeg({ quality: 90 }).toBuffer();
        }
      }
    } catch(e) { return res.status(400).json({ error: e.message }); }
    const ids = [];
    db.exec('BEGIN');
    try {
      for (const entry of prepared) {
        const existing = db.prepare('SELECT question_id FROM assessment_imports WHERE assessment_id=? AND item_index=?').get(assessment.id, entry.index);
        if (existing) { ids.push(existing.question_id); continue; }
        const id = Number(insertQuestion(req.user.id, entry.q));
        let imageId = assessment.photo_id;
        if (entry.cropped) { imageId = randomBytes(16).toString('hex'); db.prepare('INSERT INTO photos VALUES(?,?,?,?)').run(imageId, req.user.id, entry.cropped, Date.now()); }
        db.prepare('UPDATE questions SET image_id=?,source_image_id=? WHERE id=?').run(imageId, assessment.photo_id, id);
        db.prepare('INSERT INTO assessment_imports VALUES(?,?,?)').run(assessment.id, entry.index, id); ids.push(id);
      }
      db.exec('COMMIT'); res.json({ ids });
    } catch(e) { db.exec('ROLLBACK'); throw e; }
  });
}
