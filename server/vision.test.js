import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeAssessment, assessPhoto, recognizeQuestionImage, visionConfigured } from './vision.js';
const question = { content: '1 + 1 = ?', studentAnswer: '3', answer: '2', grade: '小学一年级', subject: '数学', questionType: '计算题', verdict: 'incorrect', confidence: .96, bbox: { x: .1, y: .2, width: .5, height: .2 } };
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
      if (body.messages[1].content[0].text === '请识别并转录这张题目图片中的内容。') return { ok: true, json: async () => ({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ title: '方程', content: '解方程：2x = 8。' }) } }] }) };
      return { ok: true, json: async () => ({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ questions: [question] }) } }] }) };
    };
    assert.equal((await assessPhoto(Buffer.from('test')))[0].answer, '2');
    assert.deepEqual(await recognizeQuestionImage(Buffer.from('test')), { title: '方程', text: '解方程：2x = 8。' });
  } finally { globalThis.fetch = realFetch; for (const [key, value] of Object.entries(saved)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } }
});
