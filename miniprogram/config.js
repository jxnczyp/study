// 线上地址：服务器 nginx 以 /study/ 前缀反代 127.0.0.1:3001（域名 ichatbotai.com，已配 HTTPS）。
// 本地调试时可临时改回 http://127.0.0.1:3001/api 并在开发者工具勾选「不校验合法域名」。
module.exports = { apiBase: 'https://ichatbotai.com/study/api' };
