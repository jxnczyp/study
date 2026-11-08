const { request, uploadPhoto, requireLogin, toast } = require('../../utils/api');
const { subjects, grades, questionTypes, difficulties } = require('../../utils/study');
Page({
  data: { subjects, grades, questionTypes, gradeIndex: 0, typeIndex: 0, customSubject: '', customGrade: '', customType: '', difficulties, reasons: ['概念不清', '计算失误', '审题疏忽', '公式用错', '记忆模糊', '思路不对'], subjectIndex: 0, difficultyIndex: 0, reasonIndex: 0, title: '', content: '', answer: '', explanation: '', topic: '', busy: false, error: '', imagePath: '', imageId: '', uploading: false, recognizing: false, photoNote: '', recognitionConfirmed: false },
  onLoad() { requireLogin(); },
  reviewPage() { wx.navigateTo({ url: '/pages/review/index' }); },
  onUnload() { this.disposed = true; },
  choosePhoto(e) {
    if (this.data.busy || this.data.uploading || this.data.recognizing || !requireLogin()) return;
    wx.chooseMedia({ count: 1, mediaType: ['image'], sourceType: [e.currentTarget.dataset.source], sizeType: ['compressed'],
      success: async result => {
        const file = result.tempFiles[0];
        if (!file || this.disposed) return;
        this.setData({ imagePath: file.tempFilePath, imageId: '', photoNote: '', error: '', recognitionConfirmed: false });
        await this.processPhoto();
      },
      fail: error => {
        if ((error.errMsg || '').includes('cancel')) return;
        if (/auth|deny|permission/i.test(error.errMsg || '')) wx.showModal({ title: '需要相机或相册权限', content: '请在设置中允许拍照或选图，然后重试。', confirmText: '打开设置', success: result => { if (result.confirm) wx.openSetting({}); } });
        else toast('无法获取图片，请重试');
      }
    });
  },
  async processPhoto() {
    if (!this.data.imagePath || this.data.uploading || this.data.recognizing || this.data.busy || !requireLogin()) return;
    if (!this.data.recognitionConfirmed) {
      const confirmed = await new Promise(resolve => wx.showModal({ title: '使用第三方视觉模型识别？', content: '继续后，题目图片会上传到服务端并发送给已配置的第三方视觉模型，用于转录题目文字。识别结果可能有误，请核对。', confirmText: '继续识别', success: result => resolve(result.confirm), fail: () => resolve(false) }));
      if (!confirmed || this.disposed) return;
      this.setData({ recognitionConfirmed: true });
    }
    if (!this.data.imageId) {
      this.setData({ uploading: true, photoNote: '正在上传原图…', error: '' });
      try {
        const path = await new Promise(resolve => wx.compressImage({ src: this.data.imagePath, quality: 80, compressedWidth: 2000, success: result => resolve(result.tempFilePath), fail: () => resolve(this.data.imagePath) }));
        const uploaded = await uploadPhoto(path);
        if (this.disposed) return;
        this.setData({ imageId: uploaded.imageId });
      } catch(e) { if (!this.disposed) this.setData({ error: e.message, photoNote: '上传失败，点击重试，或移除图片后手动录入。' }); return; }
      finally { if (!this.disposed) this.setData({ uploading: false }); }
    }
    if (!this.disposed) await this.recognize();
  },
  async recognize() {
    if (!this.data.imageId || this.data.recognizing || this.data.busy || !requireLogin()) return;
    this.setData({ recognizing: true, photoNote: '正在识别题目，请稍候…', error: '' });
    try {
      const result = await request('/photos/' + this.data.imageId + '/recognize', {}, 'POST', 90000);
      if (this.disposed) return;
      if (!result.text) { this.setData({ photoNote: '未识别到文字。原图已保留，可以重拍或手动录入。' }); return; }
      let apply = true;
      if (this.data.content.trim()) apply = await new Promise(resolve => wx.showModal({ title: '使用识别出的题目？', content: '题目内容已有文字，确认后会替换。其他字段将保留。', confirmText: '替换题干', success: r => resolve(r.confirm), fail: () => resolve(false) }));
      if (this.disposed) return;
      if (apply) this.setData({ content: result.text, ...(!this.data.title.trim() ? { title: result.title || '拍照录入的错题' } : {}), photoNote: '已填入识别结果，请校对题干、公式和选项，并补充正确答案。' });
      else this.setData({ photoNote: '已保留原有题干和新原图，可再次识别。' });
    } catch(e) { if (!this.disposed) this.setData({ error: e.message, photoNote: '原图已上传，可重试识别，也可手动填写后保存。' }); }
    finally { if (!this.disposed) this.setData({ recognizing: false }); }
  },
  previewPhoto() { if (this.data.imagePath) wx.previewImage({ current: this.data.imagePath, urls: [this.data.imagePath] }); },
  removePhoto() { if (!this.data.busy && !this.data.uploading && !this.data.recognizing) this.setData({ imagePath: '', imageId: '', photoNote: '', error: '', recognitionConfirmed: false }); },
  input(e) { this.setData({ [e.currentTarget.dataset.field]: e.detail.value }); },
  pick(e) { this.setData({ [e.currentTarget.dataset.field]: Number(e.detail.value) }); },
  async save() {
    if (this.data.busy || this.data.uploading || this.data.recognizing || !requireLogin()) return;
    const d = this.data;
    if (d.imagePath && !d.imageId) return this.setData({ error: '图片尚未上传成功，请重试或移除图片后保存' });
    if (!d.title.trim() || !d.content.trim() || !d.answer.trim()) return this.setData({ error: '请完整填写标题、题目内容和正确答案' });
    this.setData({ busy: true, error: '' });
    try { await request('/questions', { subject: d.customSubject.trim() || subjects[d.subjectIndex], grade: d.customGrade.trim() || grades[d.gradeIndex], questionType: d.customType.trim() || questionTypes[d.typeIndex], difficulty: difficulties[d.difficultyIndex], reason: d.reasons[d.reasonIndex], title: d.title, content: d.content, answer: d.answer, explanation: d.explanation, topic: d.topic, imageId: d.imageId || undefined }); toast('错题已收录'); wx.navigateBack(); }
    catch(e) { this.setData({ error: e.message }); } finally { this.setData({ busy: false }); }
  }
});
