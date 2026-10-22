/**
 * Osin Tiểu Cường (@Osin_Tieu_Cuong_Bot)
 * Hệ điều hành Bảo Mẫu AI Chuyên Gia Nhi Khoa 24/7
 * Kiến trúc Agentic AI - Google Gemini Native Function Calling
 */

const config = require('./config');
const { startBot } = require('./telegramBot');

// 1. Mở HTTP server health check cho Render Cloud
config.startHealthCheckServer();

// 2. Kích hoạt tín hiệu Keep-Alive 10 phút chống ngủ đông trên Cloud
config.initKeepAlive();

// 3. Khởi chạy Telegram Agent Bot
startBot();
