require('dotenv').config();
const http = require('http');
const https = require('https');
const dns = require('dns');
const fetch = require('node-fetch');

// 1. Kiểm tra biến môi trường bắt buộc
if (!process.env.TELEGRAM_BOT_TOKEN) {
  console.error('❌ LỖI: Chưa có TELEGRAM_BOT_TOKEN trong file .env');
  process.exit(1);
}
if (!process.env.GEMINI_API_KEY) {
  console.error('❌ LỖI: Chưa có GEMINI_API_KEY trong file .env');
  process.exit(1);
}

// 2. Cấu hình Custom DNS Agent (Chỉ áp dụng khi chạy trên máy tính cá nhân ở Việt Nam)
const TELEGRAM_IP = '149.154.166.110';
const customLookup = (hostname, options, callback) => {
  if (typeof options === 'function') {
    callback = options;
    options = {};
  }
  if (hostname === 'api.telegram.org') {
    if (options && options.all) {
      return callback(null, [{ address: TELEGRAM_IP, family: 4 }]);
    }
    return callback(null, TELEGRAM_IP, 4);
  }
  return dns.lookup(hostname, options, callback);
};

const customAgent = new https.Agent({
  lookup: customLookup,
  keepAlive: true,
  timeout: 60000
});

// Kiểm tra môi trường: nếu đang chạy trên Đám mây (Render) thì dùng DNS trực tiếp, không ép IP
const isCloud = process.env.RENDER === 'true' || !!process.env.RENDER;
console.log(`🌍 Môi trường hoạt động: ${isCloud ? 'ĐÁM MÂY (Render Cloud - Singapore)' : 'MÁY CÁ NHÂN (Local PC - Việt Nam)'}`);

// 3. HTTP Server giữ trạng thái sống cho nền tảng Đám mây (Render, Koyeb, Railway)
const PORT = process.env.PORT || 3000;
function startHealthCheckServer() {
  http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('🤖 Osin Tiểu Cường (@Osin_Tieu_Cuong_Bot) đang hoạt động 24/7 trên Đám Mây!');
  }).listen(PORT, () => {
    console.log(`🌐 Đã mở cổng Health Check: ${PORT} (sẵn sàng đưa lên Cloud 24/7)`);
  });
}

// 4. Cơ chế tự động bắn tín hiệu giữ bot luôn thức (Chống chế độ ngủ 15 phút của Render Free)
const RENDER_APP_URL = process.env.RENDER_EXTERNAL_URL || 'https://osin-tieu-cuong-bot.onrender.com';
function initKeepAlive() {
  if (isCloud) {
    setInterval(async () => {
      try {
        await fetch(RENDER_APP_URL);
        console.log(`⏰ [Keep-Alive] Đã gửi tín hiệu giữ bot thức 24/7 lúc ${new Date().toLocaleTimeString('vi-VN')}`);
      } catch (err) {
        console.warn('⚠️ Lỗi gửi ping keep-alive:', err.message);
      }
    }, 10 * 60 * 1000); // 10 phút tự đánh thức 1 lần
  }
}

module.exports = {
  TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN,
  GEMINI_API_KEY: process.env.GEMINI_API_KEY,
  isCloud,
  PORT,
  customAgent,
  startHealthCheckServer,
  initKeepAlive
};
