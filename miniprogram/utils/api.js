const { apiBase } = require('../config');
function request(path, data, method, timeout) {
  return new Promise((resolve, reject) => {
    const token = wx.getStorageSync('shizhi_token');
    wx.request({
      url: apiBase + path, method: method || (data === undefined ? 'GET' : 'POST'), data,
      timeout: timeout || 15000,
      header: { 'content-type': 'application/json', 'X-Client-Type': 'miniprogram', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
      success(res) {
        if (res.statusCode >= 200 && res.statusCode < 300) resolve(res.data);
        else {
          if (res.statusCode === 401 && !path.startsWith('/auth/')) clearSession();
          reject(new Error(res.data.error || '请求失败，请稍后重试'));
        }
      },
      fail() { reject(new Error('连接失败，请检查服务地址和网络设置')); }
    });
  });
}
function uploadPhoto(filePath) {
  return new Promise((resolve, reject) => {
    wx.uploadFile({
      url: apiBase + '/photos', filePath, name: 'image', timeout: 60000,
      header: { 'X-Client-Type': 'miniprogram', Authorization: 'Bearer ' + wx.getStorageSync('shizhi_token') },
      success(res) {
        let data;
        try { data = JSON.parse(res.data); } catch { return reject(new Error('图片上传失败，请稍后重试')); }
        if (res.statusCode >= 200 && res.statusCode < 300) resolve(data);
        else { if (res.statusCode === 401) clearSession(); reject(new Error(data.error || '图片上传失败')); }
      },
      fail() { reject(new Error('图片上传失败，请检查网络后重试')); }
    });
  });
}
function downloadPhoto(imageId) {
  return new Promise((resolve, reject) => {
    wx.downloadFile({
      url: apiBase + '/photos/' + encodeURIComponent(imageId), timeout: 30000,
      header: { Authorization: 'Bearer ' + wx.getStorageSync('shizhi_token') },
      success(res) {
        if (res.statusCode === 200) resolve(res.tempFilePath);
        else { if (res.statusCode === 401) clearSession(); reject(new Error('原图加载失败，请重试')); }
      },
      fail() { reject(new Error('原图加载失败，请检查网络')); }
    });
  });
}
function clearSession() {
  wx.removeStorageSync('shizhi_token'); wx.removeStorageSync('shizhi_user');
  getApp().globalData.user = null; getApp().globalData.state = null; getApp().globalData.practice = null;
}
async function loadState() {
  const state = await request('/state');
  getApp().globalData.state = state; getApp().globalData.user = state.user;
  if (state.user) wx.setStorageSync('shizhi_user', state.user);
  else { wx.removeStorageSync('shizhi_user'); wx.removeStorageSync('shizhi_token'); }
  return state;
}
function requireLogin() {
  if (getApp().globalData.user && wx.getStorageSync('shizhi_token')) return true;
  wx.navigateTo({ url: '/pages/login/index' }); return false;
}
function toast(error) { wx.showToast({ title: error.message || error, icon: 'none', duration: 2500 }); }
function startPractice(questions, mode) {
  if (!questions.length) return toast('暂无可练习的错题');
  getApp().globalData.practice = { questions, mode };
  wx.navigateTo({ url: '/pages/practice/index' });
}
module.exports = { request, uploadPhoto, downloadPhoto, loadState, requireLogin, clearSession, toast, startPractice };
