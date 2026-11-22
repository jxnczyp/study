import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeAssessment, assessPhoto, recognizeQuestionImage, visionConfigured, validBbox, expandBbox, unionBbox } from './vision.js';
const question = { content: '1 + 1 = ?', studentAnswer: '3', answer: '2', grade: '小学一年级', subject: '数学', questionType: '计算题', verdict: 'incorrect', confidence: .96, bbox: { x: .1, y: .2, width: .5, height: .2 }, figureDescription: '', figureBbox: null };
test('image transcription requires the configured third-party vision service', async () => {
  const keys = ['VISION_API_KEY', 'OPENAI_API_KEY', 'VISION_MODEL'];
  const saved = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  try {
    for (const key of keys) delete process.env[key];
    assert.equal(visionConfigured(), false);
    await assert.rejects(recognizeQuestionImage(Buffer.from('image')), error => error.code === 'NOT_CONFIGURED');
  } finally { for (const [key, value] of Object.entries(saved)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } }
});
test('visual normalization retains classifications and downgrades unsupported judgments', () => {
  const result = normalizeAssessment({ questions: [question, { ...question, confidence: .6 }, { ...question, studentAnswer: '' }, { ...question, questionType: '作文' }] });
  assert.equal(result[0].verdict, 'incorrect'); assert.equal(result[0].grade, '小学一年级');
  assert.deepEqual(result.slice(1).map(q => q.verdict), ['uncertain', 'uncertain', 'uncertain']);
  assert.equal(normalizeAssessment({ questions: [{ ...question, bbox: { x: -1, y: 0, width: 1, height: 1 } }] })[0].bbox, null);
  assert.throws(() => normalizeAssessment({ questions: [{ answer: '1' }] }));
});
test('figures in the photo are described and appended to the question text', () => {
  const figure = '图a：电源、开关与两个灯泡串联；图b：两个灯泡并联后接电源。';
  const figureBbox = { x: .55, y: .4, width: .4, height: .5 };
  const [q] = normalizeAssessment({ questions: [{ ...question, content: '如图所示的电路图中，属于串联电路的是（  ）', figureDescription: figure, figureBbox }] });
  assert.equal(q.hasFigure, true); assert.equal(q.figureDescription, figure);
  assert.deepEqual(q.figureBbox, figureBbox);
  assert.deepEqual(q.viewBbox, { x: .1, y: .2, width: .85, height: .7 });
  assert.match(q.content, /如图所示的电路图中/); assert.match(q.content, /【题目配图】/); assert.match(q.content, /两个灯泡并联/);
  const [plain] = normalizeAssessment({ questions: [question] });
  assert.equal(plain.hasFigure, false); assert.equal(plain.content, '1 + 1 = ?'); assert.equal(plain.figureBbox, null);
  assert.equal(normalizeAssessment({ questions: [{ ...question, figureBbox: { x: .9, y: .9, width: .5, height: .5 } }] })[0].figureBbox, null);
  // 题干依赖图示却没有配图说明时不得自动判错
  const [missing] = normalizeAssessment({ questions: [{ ...question, content: '如图所示的电路图中，属于串联电路的是（  ）', reason: '缺少可辨认配图', figureDescription: '' }] });
  assert.equal(missing.verdict, 'uncertain');
  assert.equal(validBbox({ x: .1, y: .1, width: .7, height: .5 }).width, .7);
  assert.equal(validBbox({ x: .8, y: .1, width: .7, height: .5 }), null);
  const round = b => Object.fromEntries(Object.entries(b).map(([k, v]) => [k, Math.round(v * 1000) / 1000]));
  assert.deepEqual(round(expandBbox({ x: .1, y: .1, width: .7, height: .5 })), { x: .06, y: .06, width: .78, height: .58 });
  assert.deepEqual(round(expandBbox({ x: 0, y: 0, width: .5, height: .5 })), { x: 0, y: 0, width: .58, height: .58 });
  assert.equal(expandBbox(null), null);
});
test('visual service sends image and schema and validates compatible response without real credentials', async () => {
  const saved = Object.fromEntries(['VISION_API_KEY', 'VISION_MODEL', 'VISION_API_BASE'].map(k => [k, process.env[k]]));
  const realFetch = globalThis.fetch;
  process.env.VISION_API_KEY = 'test-only'; process.env.VISION_MODEL = 'test-vision'; process.env.VISION_API_BASE = 'http://127.0.0.1:3999/v1';
  try {
    globalThis.fetch = async (url, options) => {
      assert.equal(url, 'http://127.0.0.1:3999/v1/chat/completions');
      const body = JSON.parse(options.body); assert.equal(body.response_format.type, 'json_object');
      assert.match(body.messages[0].content, /JSON Schema/);
      assert.match(body.messages[1].content[1].image_url.url, /^data:image\/jpeg;base64,/);
      assert.match(body.messages[0].content, /figureDescription/);
      if (body.messages[1].content[0].text === '请识别并转录这张题目图片中的内容。') return { ok: true, json: async () => ({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ title: '方程', content: '解方程：2x = 8。', figureDescription: '' }) } }] }) };
      return { ok: true, json: async () => ({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ questions: [question] }) } }] }) };
    };
    assert.equal((await assessPhoto(Buffer.from('test')))[0].answer, '2');
    const recognized = await recognizeQuestionImage(Buffer.from('test'));
    assert.equal(recognized.title, '方程'); assert.equal(recognized.text, '解方程：2x = 8。');
    assert.equal(recognized.hasFigure, false); assert.equal(recognized.figureDescription, '');
  } finally { globalThis.fetch = realFetch; for (const [key, value] of Object.entries(saved)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } }
});
test('a text-only model that rejects images produces an actionable configuration error', async () => {
  const saved = Object.fromEntries(['VISION_API_KEY', 'VISION_MODEL', 'VISION_API_BASE'].map(k => [k, process.env[k]]));
  const realFetch = globalThis.fetch;
  process.env.VISION_API_KEY = 'test-only'; process.env.VISION_MODEL = 'text-only'; process.env.VISION_API_BASE = 'http://127.0.0.1:3999/v1';
  try {
    globalThis.fetch = async () => ({ ok: false, json: async () => ({ error: { message: 'This model does not support image_url inputs' } }) });
    await assert.rejects(recognizeQuestionImage(Buffer.from('test')), /模型不支持图片输入/);
  } finally { globalThis.fetch = realFetch; for (const [key, value] of Object.entries(saved)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } }
});
test('figure regions are refined by a second pass over the cropped question area', async () => {
  const saved = Object.fromEntries(['VISION_API_KEY', 'VISION_MODEL', 'VISION_API_BASE'].map(k => [k, process.env[k]]));
  const realFetch = globalThis.fetch;
  const { default: sharp } = await import('sharp');
  process.env.VISION_API_KEY = 'test-only'; process.env.VISION_MODEL = 'test-vision'; process.env.VISION_API_BASE = 'http://127.0.0.1:3999/v1';
  try {
    globalThis.fetch = async (url, options) => {
      const body = JSON.parse(options.body);
      if (body.messages[1].content[0].text === '请定位这张题目区域图中的图示位置。') {
        assert.match(body.messages[1].content[1].image_url.url, /^data:image\/jpeg;base64,/);
        return { ok: true, json: async () => ({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ figureBbox: { x: .2, y: .3, width: .5, height: .4 } }) } }] }) };
      }
      return { ok: true, json: async () => ({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ questions: [{ ...question, content: '如图所示的电路图中，属于串联电路的是（  ）', figureDescription: '图a：电源与两个灯泡串联。', figureBbox: { x: .1, y: .1, width: .3, height: .3 } }] }) } }] }) };
    };
    const page = await sharp({ create: { width: 600, height: 800, channels: 3, background: '#fff' } }).png().toBuffer();
    const [q] = await assessPhoto(page);
    // 局部定位结果 {x:.2,y:.3,w:.5,h:.4} 换算回整页：region=expandBbox(bbox)={x:.06,y:.16,w:.58,h:.28}
    assert.deepEqual(q.figureBbox, { x: .176, y: .244, width: .29, height: .112 });
    assert.deepEqual(q.viewBbox, { x: .1, y: .2, width: .5, height: .2 });
  } finally { globalThis.fetch = realFetch; for (const [key, value] of Object.entries(saved)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } }
});
