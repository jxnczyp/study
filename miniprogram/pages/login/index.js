const { request, loadState, toast } = require('../../utils/api');
const { grades } = require('../../utils/study');
Page({
  data: { register: false, name: '', email: '', password: '', showPassword: false, busy: false, error: '', quickUser: null, canQuickEnter: false, focusPassword: false, grades, gradeIndex: 0 },
  onLoad() { this.refreshQuickUser(); },
  refreshQuickUser() {
    const token = wx.getStorageSync('shizhi_token');
    const user = wx.getStorageSync('shizhi_user');
    const email = wx.getStorageSync('shizhi_last_email') || user?.email || '';
    this.setData({ quickUser: user || (email ? { email, name: '' } : null), canQuickEnter: !!(token && user) });
  },
  toggleMode() { this.setData({ register: !this.data.register, error: '' }); },
  input(e) { this.setData({ [e.currentTarget.dataset.field]: e.detail.value }); },
  pickGrade(e) { this.setData({ gradeIndex: Number(e.detail.value) }); },
  togglePassword() { this.setData({ showPassword: !this.data.showPassword }); },
  async quickLogin() {
    if (this.data.busy || !this.data.quickUser) return;
    if (!this.data.canQuickEnter) {
      this.setData({ email: this.data.quickUser.email, focusPassword: true, error: '' });
      return toast('已填入上次账号，请输入密码');
    }
    this.setData({ busy: true, error: '' });
    try {
      const state = await loadState();
      if (!state.user) throw new Error('登录状态已失效，请使用邮箱和密码登录');
      toast('欢迎回来');
      wx.navigateBack({ fail: () => wx.switchTab({ url: '/pages/home/index' }) });
    } catch (e) {
      this.setData({ error: e.message });
      if (!wx.getStorageSync('shizhi_token')) this.refreshQuickUser();
    } finally { this.setData({ busy: false }); }
  },
  async submit() {
    if (this.data.busy) return;
    const { register, name, email, password } = this.data;
    if (register && !name.trim()) return this.setData({ error: '请输入你的昵称' });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) || password.length < 8 || password.length > 128) return this.setData({ error: '请输入有效邮箱和 8–128 位密码' });
    this.setData({ busy: true, error: '' });
    try {
      const payload = register ? { name, email, password, grade: grades[this.data.gradeIndex] } : { email, password };
      const result = await request('/auth/' + (register ? 'register' : 'login'), payload);
      if (!result.token) throw new Error('登录失败，服务端未返回会话凭证');
      wx.setStorageSync('shizhi_token', result.token); wx.setStorageSync('shizhi_user', result.user);
      wx.setStorageSync('shizhi_last_email', result.user.email);
      getApp().globalData.user = result.user;
      await loadState(); toast('登录成功，下次可快捷进入');
      this.refreshQuickUser();
      wx.navigateBack({ fail: () => wx.switchTab({ url: '/pages/home/index' }) });
    } catch(e) { this.setData({ error: e.message }); } finally { this.setData({ busy: false }); }
  }
});
