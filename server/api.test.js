import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

let server, dir, visionServer, transcriptionCalls;
const base = 'http://127.0.0.1:3198/api';
async function request(route, data, cookie, method, headers = {}) {
  const res = await fetch(base + route, { method: method || (data ? 'POST' : 'GET'), headers: { 'Content-Type': 'application/json', ...(cookie ? { cookie } : {}), ...headers }, ...(data ? { body: JSON.stringify(data) } : {}) });
  return { status: res.status, data: await res.json(), cookie: res.headers.get('set-cookie')?.split(';')[0] };
}
before(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'shizhi-test-'));
  transcriptionCalls = 0;
  visionServer = createServer(async (req, res) => {
    let raw = ''; for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw);
    if (body.messages?.[1]?.content?.[0]?.text === '请识别并转录这张题目图片中的内容。') {
      transcriptionCalls++;
      res.setHeader('Content-Type', 'application/json');
      return res.end(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ title: '方程练习', content: '解方程：3x + 7 = 22。\nFind the value of x.' }) } }] }));
    }
    const q = { number: '1', title: '加法练习', content: '1 + 1 = ?', studentAnswer: '3', answer: '2', explanation: '一加一等于二。', grade: '小学一年级', subject: '数学', questionType: '计算题', topic: '加法', verdict: 'incorrect', reason: '计算错误', confidence: .96, bbox: { x: .1, y: .1, width: .7, height: .5 } };
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ questions: [q, { ...q, number: '2', verdict: 'correct', studentAnswer: '2' }, { ...q, number: '3', verdict: 'incorrect', confidence: .5, bbox: null }] }) } }] }));
  });
  await new Promise(resolve => visionServer.listen(0, '127.0.0.1', resolve));
  server = spawn(process.execPath, ['server/index.js'], { env: { ...process.env, DATA_DIR: dir, PORT: '3198', VISION_API_KEY: 'test-only-no-real-provider', VISION_MODEL: 'mock-model', VISION_API_BASE: `http://127.0.0.1:${visionServer.address().port}/v1` }, stdio: ['ignore', 'pipe', 'pipe'] });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('API startup timed out')), 10000);
    server.stdout.on('data', text => { if (text.toString().includes('拾知 API')) { clearTimeout(timer); resolve(); } });
    server.once('error', reject);
  });
});
after(async () => { if (server) { server.kill(); await new Promise(resolve => server.once('exit', resolve)); } if (visionServer) await new Promise(resolve => visionServer.close(resolve)); if (dir) await rm(dir, { recursive: true, force: true }); });

test('registration, persistence, account isolation and review lifecycle', async () => {
  const guest = await request('/state');
  assert.equal(guest.data.user, null);
  assert.equal(guest.data.questions.length, 6);
  assert.equal((await request('/questions', { subject: '数学', content: 'test', answer: '1' })).status, 401);
  const a = await request('/auth/register', { name: '小知', email: 'learner@example.com', password: 'study12345' });
  assert.equal(a.status, 200); assert.ok(a.cookie);
  assert.equal((await request('/auth/register', { name: '重复', email: 'learner@example.com', password: 'study12345' })).status, 409);
  const inserted = await request('/questions', { subject: '数学', title: '测试错题', content: '2 + 2 = ?', answer: '4', explanation: '两个 2 相加。', difficulty: '基础' }, a.cookie);
  assert.equal(inserted.status, 200);
  const id = inserted.data.id;
  const saved = await request('/state', undefined, a.cookie);
  assert.equal(saved.data.questions.length, 7);
  assert.equal(saved.data.questions[0].title, '测试错题');
  const b = await request('/auth/register', { name: '另一位同学', email: 'other@example.com', password: 'study12345' });
  assert.equal((await request('/state', undefined, b.cookie)).data.questions.length, 6);
  assert.equal((await request(`/questions/${id}`, { mastered: true }, b.cookie, 'PATCH')).status, 404);
  assert.equal((await request('/attempts', { questionId: id, answer: '4' }, b.cookie)).status, 404);
  assert.equal((await request('/attempts', { questionId: id, answer: '4' }, a.cookie)).data.correct, true);
  assert.equal((await request(`/questions/${id}`, { mastered: true }, a.cookie, 'PATCH')).status, 200);
  assert.equal((await request('/state', undefined, a.cookie)).data.questions.find(q => q.id === id).mastered, 1);
  await request('/logout', {}, a.cookie);
  assert.equal((await request('/state', undefined, a.cookie)).data.user, null);
  assert.equal((await request('/auth/login', { email: 'learner@example.com', password: 'wrongpassword' })).status, 401);
  const again = await request('/auth/login', { email: 'learner@example.com', password: 'study12345' });
  assert.equal((await request('/state', undefined, again.cookie)).data.questions.length, 7);
  await request(`/questions/${id}`, {}, again.cookie, 'DELETE');
  assert.equal((await request('/state', undefined, again.cookie)).data.questions.length, 6);
});

test('generated exercises use server answers and incorrect exercises enter notebook', async () => {
  const user = await request('/auth/register', { name: '练习者', email: 'practice@example.com', password: 'study12345' });
  assert.equal((await request('/generate', { subject: '化学', count: 5 })).status, 400);
  assert.equal((await request('/generate', { subject: '数学', count: 21 })).status, 400);
  const generated = await request('/generate', { subject: '数学', count: 3, difficulty: '挑战' });
  assert.equal(generated.data.questions.length, 3);
  const [q1, q2] = generated.data.questions;
  assert.equal(new Set(q1.options).size, q1.options.length);
  assert.equal((await request('/attempts', { questionId: q1.id, answer: q1.answer }, user.cookie)).data.correct, true);
  const incorrect = await request('/attempts', { questionId: q2.id, answer: 'tampered', question: { ...q2, answer: 'tampered' } }, user.cookie);
  assert.equal(incorrect.data.correct, false);
  const state = (await request('/state', undefined, user.cookie)).data;
  assert.equal(state.questions.length, 7);
  assert.equal(state.questions[0].reason, '练习出错');
  assert.equal(state.attempts.length, 2);
});

test('mini-program bearer login persists across requests and logout revokes token', async () => {
  const account = { name: '小程序用户', email: 'mini@example.com', password: 'study12345' };
  const register = await request('/auth/register', account, undefined, undefined, { 'X-Client-Type': 'miniprogram' });
  assert.match(register.data.token, /^[a-f0-9]{64}$/);
  const headers = { Authorization: 'Bearer ' + register.data.token };
  const state = await request('/state', undefined, undefined, undefined, headers);
  assert.equal(state.data.user.email, account.email);
  const created = await request('/questions', { subject: '数学', title: '小程序错题', content: '1+1', answer: '2' }, undefined, undefined, headers);
  assert.equal(created.status, 200);
  await request('/logout', {}, undefined, undefined, headers);
  assert.equal((await request('/state', undefined, undefined, undefined, headers)).data.user, null);
  assert.equal((await request('/questions', { subject: '数学', content: '1', answer: '1' }, undefined, undefined, headers)).status, 401);
  const login = await request('/auth/login', account, undefined, undefined, { 'X-Client-Type': 'miniprogram' });
  assert.notEqual(login.data.token, register.data.token);
  const restored = await request('/state', undefined, undefined, undefined, { Authorization: 'Bearer ' + login.data.token });
  assert.equal(restored.data.questions.length, 7);
});

async function uploadImage(bytes, cookie, filename = 'question.png') {
  const form = new FormData();
  form.append('image', new Blob([bytes], { type: 'image/png' }), filename);
  const response = await fetch(base + '/photos', { method: 'POST', headers: cookie ? { cookie } : {}, body: form });
  return { status: response.status, data: await response.json() };
}

test('photo capture lifecycle: upload, third-party model recognition, ownership, save, reload and delete', async () => {
  const { default: sharp } = await import('sharp');
  const image = await sharp(Buffer.from('<svg width="1200" height="400"><rect width="100%" height="100%" fill="white"/><text x="40" y="120" font-size="55" fill="black">解方程：3x + 7 = 22。</text><text x="40" y="240" font-size="55" fill="black">Find the value of x.</text></svg>')).png().toBuffer();
  assert.equal((await uploadImage(image)).status, 401);
  const a = await request('/auth/register', { name: '拍照用户', email: 'photo@example.com', password: 'study12345' });
  const b = await request('/auth/register', { name: '另一位用户', email: 'photo-other@example.com', password: 'study12345' });
  assert.equal((await uploadImage(Buffer.from('not an image'), a.cookie)).status, 400);
  assert.equal((await uploadImage(Buffer.alloc(8 * 1024 * 1024 + 1), a.cookie)).status, 400);
  const uploaded = await uploadImage(image, a.cookie);
  assert.equal(uploaded.status, 200); assert.match(uploaded.data.imageId, /^[a-f0-9]{32}$/);
  const id = uploaded.data.imageId;
  assert.equal((await fetch(base + '/photos/' + id)).status, 401);
  assert.equal((await fetch(base + '/photos/' + id, { headers: { cookie: b.cookie } })).status, 404);
  const original = await fetch(base + '/photos/' + id, { headers: { cookie: a.cookie } });
  assert.equal(original.status, 200); assert.match(original.headers.get('content-type'), /image\/jpeg/);
  assert.equal(original.headers.get('cache-control'), 'private, no-store');
  assert.equal((await request('/photos/' + id + '/recognize', {}, b.cookie)).status, 404);
  const recognized = await request('/photos/' + id + '/recognize', {}, a.cookie);
  assert.equal(recognized.status, 200); assert.match(recognized.data.text, /22/); assert.match(recognized.data.text, /value/i); assert.equal(recognized.data.title, '方程练习'); assert.equal(transcriptionCalls, 1);
  const q = { subject: '数学', title: recognized.data.title, content: recognized.data.text, answer: '5', imageId: id };
  assert.equal((await request('/questions', q, b.cookie)).status, 400);
  const created = await request('/questions', q, a.cookie);
  assert.equal(created.status, 200);
  const stored = (await request('/state', undefined, a.cookie)).data.questions[0];
  assert.equal(stored.image_id, id); assert.equal(stored.content, recognized.data.text);
  await request(`/questions/${created.data.id}`, {}, b.cookie, 'DELETE');
  assert.equal((await fetch(base + '/photos/' + id, { headers: { cookie: a.cookie } })).status, 200);
  await request(`/questions/${created.data.id}`, {}, a.cookie, 'DELETE');
  assert.equal((await fetch(base + '/photos/' + id, { headers: { cookie: a.cookie } })).status, 404);
});

test('classification supports any grade, course and question type without losing legacy questions', async () => {
  const user = await request('/auth/register', { name: '分类用户', email: 'catalog@example.com', password: 'study12345' });
  const q = { subject: '医学影像学', grade: '大学五年级', questionType: '病例分析', title: '病例分析题', content: '病例描述', answer: '参考解答' };
  assert.equal((await request('/questions', q, user.cookie)).status, 200);
  const qs = (await request('/state', undefined, user.cookie)).data.questions;
  assert.equal(qs[0].grade, q.grade); assert.equal(qs[0].subject, q.subject); assert.equal(qs[0].question_type, q.questionType);
  assert.equal(qs[1].grade, '未分类');
  assert.equal((await request('/questions', { ...q, grade: '超'.repeat(41) }, user.cookie)).status, 400);
  assert.equal((await request('/catalog')).data.grades.includes('小学一年级'), true);
});

test('whole-page assessment imports only selected items, crops images and is idempotent', async () => {
  const { default: sharp } = await import('sharp');
  const bytes = await sharp({ create: { width: 600, height: 800, channels: 3, background: '#fff' } }).png().toBuffer();
  const user = await request('/auth/register', { name: '整页用户', email: 'sheet@example.com', password: 'study12345' });
  const other = await request('/auth/login', { email: 'photo-other@example.com', password: 'study12345' });
  const photo = await uploadImage(bytes, user.cookie);
  const assessment = await request('/photos/' + photo.data.imageId + '/assess', { grade: '小学一年级', subject: '数学' }, user.cookie);
  assert.equal(assessment.status, 200); assert.equal(assessment.data.questions.length, 3);
  assert.equal(assessment.data.questions[2].verdict, 'uncertain');
  assert.equal((await request('/state', undefined, user.cookie)).data.questions.length, 6);
  const route = '/assessments/' + assessment.data.id + '/import';
  assert.equal((await request(route, { confirmed: true, items: [{ index: 0 }] }, other.cookie)).status, 404);
  assert.equal((await request(route, { items: [{ index: 0 }] }, user.cookie)).status, 400);
  assert.equal((await request(route, { confirmed: true, items: [{ index: 0 }, { index: 0 }] }, user.cookie)).status, 400);
  assert.equal((await request(route, { confirmed: true, items: [{ index: 0, answer: '' }] }, user.cookie)).status, 400);
  const selected = { confirmed: true, items: [{ index: 0, grade: '小学二年级', questionType: '应用题' }] };
  const imported = await request(route, selected, user.cookie); assert.equal(imported.status, 200);
  assert.deepEqual((await request(route, selected, user.cookie)).data.ids, imported.data.ids);
  const state = (await request('/state', undefined, user.cookie)).data;
  assert.equal(state.questions.length, 7); const saved = state.questions[0];
  assert.equal(saved.grade, '小学二年级'); assert.equal(saved.question_type, '应用题'); assert.equal(saved.student_answer, '3'); assert.equal(saved.assessment_source, 'vision');
  assert.notEqual(saved.image_id, photo.data.imageId);
  assert.equal(saved.source_image_id, photo.data.imageId);
  const cropped = await fetch(base + '/photos/' + saved.image_id, { headers: { cookie: user.cookie } });
  const metadata = await sharp(Buffer.from(await cropped.arrayBuffer())).metadata(); assert.equal(metadata.width, 420); assert.equal(metadata.height, 400);
  assert.equal((await request('/attempts', { questionId: saved.id, answer: '二' }, user.cookie)).status, 400);
  assert.equal((await request('/attempts', { questionId: saved.id, answer: '二', selfAssessment: true }, user.cookie)).data.correct, true);
});
