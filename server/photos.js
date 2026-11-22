import multer from 'multer';
import sharp from 'sharp';
import { randomBytes } from 'node:crypto';
import { recognizeQuestionImage, visionConfigured, validBbox, expandBbox } from './vision.js';

export function installPhotos(app, db, auth) {
  db.exec(`CREATE TABLE IF NOT EXISTS photos (id TEXT PRIMARY KEY, user_id INTEGER REFERENCES users(id), data BLOB NOT NULL, created_at INTEGER NOT NULL);`);
  if (!db.prepare('PRAGMA table_info(questions)').all().some(c => c.name === 'image_id')) db.exec('ALTER TABLE questions ADD COLUMN image_id TEXT');
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024, files: 1, fields: 0 } }).single('image');
  const rateLimit = Math.max(1, Number(process.env.PHOTO_RATE_LIMIT || 40));
  const rates = new Map();
  function rate(req, res, next) {
    const now = Date.now();
    for (const [key, value] of rates) if (value.until < now) rates.delete(key);
    const value = rates.get(req.user.id) || { count: 0, until: now + 60000 };
    value.count++; rates.set(req.user.id, value);
    if (value.count > rateLimit) return res.status(429).json({ error: `图片操作过于频繁，请 1 分钟后重试（限 ${rateLimit} 次/分钟）` });
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
      // 电路图、几何图等细线图对分辨率和色度抽样敏感，保留更高上限并使用 4:4:4。
      data = await source.rotate().resize({ width: 2560, height: 3200, fit: 'inside', withoutEnlargement: true }).flatten({ background: '#fff' }).jpeg({ quality: 92, chromaSubsampling: '4:4:4' }).toBuffer();
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
  // 识别结果页按题目 bbox 即时取配图，供用户收录前核对；只读，不写入 photos。
  app.get('/api/photos/:id/crop', auth, rate, async (req, res) => {
    const bbox = expandBbox(validBbox({ x: Number(req.query.x), y: Number(req.query.y), width: Number(req.query.w), height: Number(req.query.h) }));
    if (!bbox) return res.status(400).json({ error: '裁图区域无效' });
    const photo = db.prepare('SELECT data FROM photos WHERE id=? AND user_id=?').get(req.params.id, req.user.id);
    if (!photo) return res.status(404).json({ error: '图片不存在' });
    try {
      const buffer = Buffer.from(photo.data);
      const { width, height } = await sharp(buffer).metadata();
      const left = Math.min(width - 1, Math.floor(bbox.x * width));
      const top = Math.min(height - 1, Math.floor(bbox.y * height));
      const cropped = await sharp(buffer).extract({ left, top, width: Math.max(1, Math.min(width - left, Math.ceil(bbox.width * width))), height: Math.max(1, Math.min(height - top, Math.ceil(bbox.height * height))) }).jpeg({ quality: 92, chromaSubsampling: '4:4:4' }).toBuffer();
      res.set('Cache-Control', 'private, no-store').type('jpeg').send(cropped);
    } catch { res.status(400).json({ error: '题目配图裁切失败，请查看整页原图' }); }
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
