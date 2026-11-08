const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve('miniprogram');
function read(file) { return fs.readFileSync(path.join(root, file), 'utf8'); }
function load(file, mocks = {}) {
  const module = { exports: {} };
  const sandbox = { module, exports: module.exports, console, ...mocks };
  sandbox.require = relative => { const target = path.resolve(path.dirname(path.join(root, file)), relative.endsWith('.js') ? relative : relative + '.js'); if (!fs.existsSync(target)) throw new Error('Mini-program require must resolve a JavaScript module: ' + relative); return load(path.relative(root, target), mocks); };
  vm.runInNewContext(read(file), sandbox, { filename: file });
  return module.exports;
}
function page(file, deps, app, wxOverrides = {}) {
  let definition;
  vm.runInNewContext(read(file), { Page: p => definition = p, require: name => deps[name], getApp: () => app, wx: { enableAlertBeforeUnload() {}, disableAlertBeforeUnload() {}, ...wxOverrides }, console });
  definition.setData = function(data) { Object.assign(this.data, data); };
  return definition;
}
test('native project routes, page handlers, JSON and PNG assets are complete', () => {
  const project = JSON.parse(fs.readFileSync('project.config.json', 'utf8'));
  assert.equal(project.miniprogramRoot, 'miniprogram/');
  const config = JSON.parse(read('app.json'));
  for (const route of config.pages) {
    for (const ext of ['js', 'wxml', 'wxss', 'json']) assert.ok(fs.existsSync(path.join(root, route + '.' + ext)), route + '.' + ext);
    JSON.parse(read(route + '.json'));
    new vm.Script(read(route + '.js'));
    const template = read(route + '.wxml');
    const script = read(route + '.js');
    for (const match of template.matchAll(/(?:bind(?:tap|input|change|confirm)|catchtap)="([A-Za-z_][A-Za-z_0-9]*)"/g)) assert.ok(new RegExp('(?:async\\s+)?' + match[1] + '\\s*\\(').test(script), route + ': missing handler ' + match[1]);
  }
  for (const tab of config.tabBar.list) {
    assert.ok(config.pages.includes(tab.pagePath));
    for (const file of [tab.iconPath, tab.selectedIconPath]) assert.equal(fs.readFileSync(path.join(root, file)).subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  }
});
test('mini-program requests send bearer session and clear expired sessions', async () => {
  const store = new Map([['shizhi_token', 'sample-token'], ['shizhi_user', { id: 1 }]]);
  const app = { globalData: { user: { id: 1 } } }; let sent;
  const wx = { getStorageSync: k => store.get(k), setStorageSync: (k,v) => store.set(k,v), removeStorageSync: k => store.delete(k), request: options => { sent = options; options.success({ statusCode: 200, data: { ok: true } }); } };
  const api = load('utils/api.js', { wx, getApp: () => app });
  assert.equal((await api.request('/questions', { title: 'test' }, 'PATCH')).ok, true);
  assert.equal(sent.method, 'PATCH'); assert.equal(sent.header.Authorization, 'Bearer sample-token'); assert.equal(sent.header['X-Client-Type'], 'miniprogram');
  wx.request = options => options.success({ statusCode: 401, data: { error: 'expired' } });
  await assert.rejects(api.request('/state'), /expired/);
  assert.equal(store.has('shizhi_token'), false); assert.equal(app.globalData.user, null);
});
test('login page supports saved-session entry and remembers the last account without saving passwords', async () => {
  const store = new Map([['shizhi_token', 'token'], ['shizhi_user', { name: '小知', email: 'learner@example.com' }], ['shizhi_last_email', 'learner@example.com']]);
  const app = { globalData: {} }; let loaded = 0, returned = 0;
  const wx = { getStorageSync: key => store.get(key), navigateBack: () => returned++ };
  const p = page('pages/login/index.js', { '../../utils/api': { loadState: async () => { loaded++; return { user: { name: '小知' } }; }, toast() {}, request() {} } }, app, wx);
  p.onLoad(); assert.equal(p.data.canQuickEnter, true); assert.equal(p.data.quickUser.email, 'learner@example.com');
  await p.quickLogin(); assert.equal(loaded, 1); assert.equal(returned, 1);

  store.delete('shizhi_token'); store.delete('shizhi_user');
  p.onLoad(); await p.quickLogin();
  assert.equal(p.data.email, 'learner@example.com'); assert.equal(p.data.focusPassword, true);
  assert.equal(store.get('shizhi_last_email'), 'learner@example.com'); assert.equal(store.has('shizhi_password'), false);

  const signedIn = page('pages/login/index.js', { '../../utils/api': {
    request: async () => ({ token: 'new-token', user: { name: '小知', email: 'learner@example.com' } }),
    loadState: async () => ({ user: { name: '小知' } }), toast() {}
  } }, app, { ...wx, setStorageSync: (key, value) => store.set(key, value), navigateBack: () => returned++ });
  signedIn.setData({ email: 'learner@example.com', password: 'correct-horse' });
  await signedIn.submit();
  assert.equal(store.get('shizhi_last_email'), 'learner@example.com');
  assert.equal(store.get('shizhi_token'), 'new-token'); assert.equal(store.has('shizhi_password'), false);
});
test('study summaries count mastery, recent practice and subjects', () => {
  const { summarize } = load('utils/study.js');
  const stats = summarize({ questions: [{ subject: '数学', mastered: 1 }, { subject: '数学', mastered: 0 }], attempts: [{ correct: 1, created_at: new Date().toISOString() }] });
  assert.equal(stats.percent, 50); assert.equal(stats.todayCount, 1); assert.equal(stats.accuracy, 100); assert.equal(stats.streak, 1);
  assert.equal(stats.distribution[0].width, 50); assert.equal(stats.days.length, 7);
});
test('practice submits to server once and renders final score', async () => {
  let calls = 0;
  const app = { globalData: { user: { id: 7 }, practice: { mode: '复习', questions: [{ id: 1, answer: '2', options: ['1', '2'] }] } } };
  const p = page('pages/practice/index.js', { '../../utils/api': { request: async (url, data) => { calls++; assert.equal(data.answer, '2'); return { correct: true, answer: '2', explanation: '加法' }; }, loadState: async () => ({}), toast: e => { throw e; } } }, app);
  p.onLoad(); p.choose({ currentTarget: { dataset: { index: 1 } } });
  await p.submit(); await p.submit();
  assert.equal(calls, 1); assert.equal(p.data.submitted, true);
  p.next(); assert.equal(p.data.finished, true); assert.equal(p.data.accuracy, 100); assert.equal(app.globalData.practice, null);
});
test('notebook combines subject, mastery and keyword filters', () => {
  const p = page('pages/mistakes/index.js', { '../../utils/api': {}, '../../utils/study': load('utils/study.js') }, { globalData: {} });
  p.questions = [{ subject: '数学', title: '函数', topic: '代数', content: '题干', mastered: 0 }, { subject: '英语', title: '时态', content: 'test', mastered: 1 }];
  p.setData({ subject: '数学', status: 1, search: '代数' }); p.filter();
  assert.equal(p.data.visible.length, 1);
  p.setData({ status: 2 }); p.filter(); assert.equal(p.data.visible.length, 0);
});

test('photo intake uploads before model recognition, fills content and saves the image reference', async () => {
  const calls = []; let saved;
  const p = page('pages/add/index.js', { '../../utils/study': load('utils/study.js'), '../../utils/api': {
    requireLogin: () => true, toast: () => {}, uploadPhoto: async file => { calls.push(file); return { imageId: 'photo-1' }; },
    request: async (url, data) => { calls.push(url); if (url.includes('/recognize')) return { text: '3x + 7 = 22', title: '解方程' }; saved = data; }
  } }, { globalData: {} }, { compressImage: options => options.success({ tempFilePath: '/compressed.jpg' }), showModal: options => options.success({ confirm: true }), navigateBack() {} });
  p.setData({ imagePath: '/camera.jpg' });
  await p.processPhoto();
  assert.equal(calls[0], '/compressed.jpg'); assert.equal(calls[1], '/photos/photo-1/recognize');
  assert.equal(p.data.imageId, 'photo-1'); assert.equal(p.data.content, '3x + 7 = 22'); assert.equal(p.data.title, '解方程');
  assert.equal(p.data.recognizing, false); assert.equal(p.data.uploading, false);
  p.setData({ answer: '5' }); await p.save(); assert.equal(saved.imageId, 'photo-1');
});
test('model recognition failure retains uploaded photo and allows manual entry without reupload', async () => {
  let uploads = 0; let saved;
  const p = page('pages/add/index.js', { '../../utils/study': load('utils/study.js'), '../../utils/api': {
    requireLogin: () => true, toast: () => {}, uploadPhoto: async () => { uploads++; return { imageId: 'photo-2' }; },
    request: async (url, data) => { if (url.includes('/recognize')) throw new Error('识别失败'); saved = data; }
  } }, { globalData: {} }, { compressImage: options => options.fail(), showModal: options => options.success({ confirm: true }), navigateBack() {} });
  p.setData({ imagePath: '/camera.jpg', title: '已有标题', content: '手动题干', answer: '2' });
  await p.processPhoto(); assert.equal(p.data.imageId, 'photo-2'); assert.equal(p.data.content, '手动题干');
  await p.processPhoto(); assert.equal(uploads, 1); assert.equal(p.data.error, '识别失败');
  await p.save(); assert.equal(saved.imageId, 'photo-2'); assert.equal(saved.content, '手动题干');
});
test('recognizing never overwrites existing text without confirmation', async () => {
  const p = page('pages/add/index.js', { '../../utils/study': load('utils/study.js'), '../../utils/api': {
    requireLogin: () => true, request: async () => ({ text: '新题干', title: '新标题' })
  } }, { globalData: {} }, { showModal: options => options.success({ confirm: false }) });
  p.setData({ imageId: 'photo-3', content: '原有题干', title: '原有标题', answer: '原答案' });
  await p.recognize(); assert.equal(p.data.content, '原有题干'); assert.equal(p.data.title, '原有标题'); assert.equal(p.data.answer, '原答案');
});
test('upload failure blocks save and clearing photo preserves typed content', async () => {
  let saved = false;
  const p = page('pages/add/index.js', { '../../utils/study': load('utils/study.js'), '../../utils/api': {
    requireLogin: () => true, uploadPhoto: async () => { throw new Error('上传失败'); }, request: async () => { saved = true; }, toast: () => {}
  } }, { globalData: {} }, { compressImage: options => options.fail(), showModal: options => options.success({ confirm: true }), navigateBack() {} });
  p.setData({ imagePath: '/camera.jpg', title: '题目', content: '手动题干', answer: '2' });
  await p.processPhoto(); await p.save(); assert.equal(saved, false); assert.equal(p.data.imageId, '');
  p.removePhoto(); assert.equal(p.data.imagePath, ''); assert.equal(p.data.content, '手动题干');
  await p.save(); assert.equal(saved, true);
});
test('photo uploads and downloads authenticate and surface server validation errors', async () => {
  const store = new Map([['shizhi_token', 'photo-token']]); let upload, download;
  const wx = {
    getStorageSync: key => store.get(key), removeStorageSync: key => store.delete(key),
    uploadFile: options => { upload = options; options.success({ statusCode: 200, data: JSON.stringify({ imageId: '123' }) }); },
    downloadFile: options => { download = options; options.success({ statusCode: 200, tempFilePath: '/local-photo.jpg' }); }
  };
  const api = load('utils/api.js', { wx, getApp: () => ({ globalData: {} }) });
  assert.equal((await api.uploadPhoto('/camera.jpg')).imageId, '123'); assert.equal(upload.name, 'image'); assert.equal(upload.header.Authorization, 'Bearer photo-token');
  assert.equal(await api.downloadPhoto('123'), '/local-photo.jpg'); assert.equal(download.header.Authorization, 'Bearer photo-token');
  wx.uploadFile = options => options.success({ statusCode: 400, data: JSON.stringify({ error: '图片太大' }) });
  await assert.rejects(api.uploadPhoto('/large.jpg'), /图片太大/);
});

test('notebook intersects grade, custom subject and question type filters', () => {
  const p = page('pages/mistakes/index.js', { '../../utils/api': {}, '../../utils/study': load('utils/study.js') }, { globalData: {} });
  p.questions = [
    { subject: '化学', grade: '高中一年级', question_type: '实验题', title: '实验', content: '题干', mastered: 0 },
    { subject: '化学', grade: '高中二年级', question_type: '实验题', title: '实验', content: '题干', mastered: 0 },
    { subject: '化学', grade: '高中一年级', question_type: '填空题', title: '实验', content: '题干', mastered: 0 }
  ];
  p.setData({ subject: '化学', gradeFilter: '高中一年级', typeFilter: '实验题', search: '' }); p.filter(); assert.equal(p.data.visible.length, 1);
});
test('whole-page review selects only suspected mistakes and imports confirmed selection', async () => {
  const sent = [];
  const p = page('pages/review/index.js', { '../../utils/study': load('utils/study.js'), '../../utils/api': { requireLogin: () => true, toast() {}, request: async (url, body) => { sent.push({ url, body }); return { ids: [1] }; } } }, { globalData: {} }, { showModal: o => o.success({ confirm: true }) });
  p.setData({ assessmentId: 'a1', questions: [
    { index: 0, verdict: 'incorrect', grade: '小学一年级', subject: '数学', content: '1+1', answer: '2', selected: false },
    { index: 1, verdict: 'correct', grade: '小学一年级', subject: '数学', content: '1+1', answer: '2', selected: false },
    { index: 2, verdict: 'uncertain', grade: '小学一年级', subject: '数学', content: '1+1', answer: '', selected: false }
  ] });
  assert.equal(p.data.selectedCount, 0); p.selectMistakes(); assert.equal(p.data.selectedCount, 1);
  await p.saveSelected(); assert.equal(sent.length, 1); assert.equal(sent[0].body.confirmed, true); assert.equal(sent[0].body.items.length, 1); assert.equal(sent[0].body.items[0].index, 0);
  assert.equal(p.data.questions[0].saved, true); assert.equal(p.data.questions[1].saved, undefined);
});
test('whole-page results render every recognized question and link each to its original image', async () => {
  const recognized = [0, 1, 2].map(i => ({ number: String(i + 1), title: `题目${i + 1}`, content: `题干${i + 1}`, studentAnswer: '', answer: '2', explanation: '', grade: '小学一年级', subject: '数学', questionType: '计算题', topic: '', verdict: 'uncertain', reason: '', confidence: .9, bbox: null }));
  const p = page('pages/review/index.js', { '../../utils/study': load('utils/study.js'), '../../utils/api': {
    requireLogin: () => true, toast() {}, uploadPhoto: async () => ({ imageId: 'page-photo' }),
    request: async () => ({ id: 'assessment-1', questions: recognized })
  } }, { globalData: {} }, { showModal: o => o.success({ confirm: true }), compressImage: o => o.success({ tempFilePath: '/page.jpg' }) });
  p.setData({ enabled: true, imagePath: '/page.jpg' });
  await p.analyze();
  assert.equal(p.data.questions.length, 3);
  assert.deepEqual(p.data.questions.map(q => q.content), ['题干1', '题干2', '题干3']);
  const resultsTemplate = read('pages/review/index.wxml');
  assert.match(resultsTemplate, /wx:for="\{\{questions\}\}"/);
  assert.match(resultsTemplate, /查看整页原图，核对第/);
  const detailTemplate = read('pages/detail/index.wxml');
  assert.match(detailTemplate, /wx:if="\{\{question\.image_id\}\}"/);
  assert.match(detailTemplate, /src="\{\{imagePath\}\}"/);
});
test('visual question review requires learner self-assessment rather than literal answer matching', async () => {
  let sent;
  const app = { globalData: { user: { id: 7 }, practice: { mode: '复习', questions: [{ id: 99, assessment_source: 'vision', answer: '参考论述', options: [] }] } } };
  const p = page('pages/practice/index.js', { '../../utils/api': { request: async (url, data) => { sent = data; return { correct: true, answer: '参考论述' }; }, toast() {}, loadState: async () => ({}) } }, app);
  p.onLoad(); p.setData({ answer: '等价的另一种表达' }); await p.submit();
  assert.equal(sent, undefined); assert.equal(p.data.referenceVisible, true);
  p.pendingSelfAssessment = true; await p.submit(); assert.equal(sent.selfAssessment, true); assert.equal(p.data.result.correct, true);
});

test('classification runtime module matches server catalog', () => {
  const runtime = load('data/catalog.js'); const catalog = JSON.parse(read('data/catalog.json'));
  assert.equal(JSON.stringify(runtime), JSON.stringify(catalog));
});
