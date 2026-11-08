import multer from 'multer';
import sharp from 'sharp';
import { randomBytes } from 'node:crypto';
import { recognizeQuestionImage, visionConfigured } from './vision.js';

export function installPhotos(app, db, auth) {
  db.exec(`CREATE TABLE IF NOT EXISTS photos (id TEXT PRIMARY KEY, user_id INTEGER REFERENCES users(id), data BLOB NOT NULL, created_at INTEGER NOT NULL);`);
  if (!db.prepare('PRAGMA table_info(questions)').all().some(c => c.name === 'image_id')) db.exec('ALTER TABLE questions ADD COLUMN image_id TEXT');
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024, files: 1, fields: 0 } }).single('image');
  const rates = new Map();
  function rate(req, res, next) {
    const now = Date.now();
    for (const [key, value] of rates) if (value.until < now) rates.delete(key);
    const value = rates.get(req.user.id) || { count: 0, until: now + 60000 };
    value.count++; rates.set(req.user.id, value);
    if (value.count > 15) return res.status(429).json({ error: '图片操作过于频繁，请稍后重试' });
    next();
  }
  app.post('/api/photos', auth, rate, (req, res, next) => upload(req, res, error => {
    if (error) return res.status(400).json({ error: error.code === 'LIMIT_FILE_SIZE' ? '图片不能超过 8 MB，请压缩后再试' : '请上传一张图片' });
    next();
  }), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: '请选择需要录入的图片' });
    let data;
    try {
      const source = sharp(req.file.buffer, { limitInputPixels: 40000000, animated: false });
      const metadata = await source.metadata();
      if (!['jpeg', 'png', 'webp'].includes(metadata.format)) throw new Error('format');
      data = await source.rotate().resize({ width: 2000, height: 2400, fit: 'inside', withoutEnlargement: true }).flatten({ background: '#fff' }).jpeg({ quality: 88 }).toBuffer();
    } catch { return res.status(400).json({ error: '图片无法读取，请选择清晰的 JPG、PNG 或 WebP 图片' }); }
    // 清理一天前未关联错题的草稿图片；已收录的图片始终保留。
    db.prepare('DELETE FROM photos WHERE created_at<? AND id NOT IN (SELECT image_id FROM questions WHERE image_id IS NOT NULL UNION SELECT source_image_id FROM questions WHERE source_image_id IS NOT NULL)').run(Date.now() - 86400000);
    const id = randomBytes(16).toString('hex');
    db.prepare('INSERT INTO photos VALUES(?,?,?,?)').run(id, req.user.id, data, Date.now());
    res.json({ imageId: id });
  });
  app.get('/api/photos/:id', auth, (req, res) => {
    const photo = db.prepare('SELECT data FROM photos WHERE id=? AND user_id=?').get(req.params.id, req.user.id);
    if (!photo) return res.status(404).json({ error: '图片不存在' });
    res.set('Cache-Control', 'private, no-store').type('jpeg').send(Buffer.from(photo.data));
  });
  app.post('/api/photos/:id/recognize', auth, rate, async (req, res) => {
    const photo = db.prepare('SELECT data FROM photos WHERE id=? AND user_id=?').get(req.params.id, req.user.id);
    if (!photo) return res.status(404).json({ error: '图片不存在' });
    if (!visionConfigured()) return res.status(503).json({ error: '尚未配置第三方视觉模型，请联系管理员完成服务端配置' });
    try {
      res.json(await recognizeQuestionImage(Buffer.from(photo.data)));
    } catch (error) {
      res.status(error.code === 'NOT_CONFIGURED' ? 503 : 502).json({ error: error.message || '第三方视觉模型识别失败，原图已保留，可重试或手动填写题目' });
    }
  });
}
