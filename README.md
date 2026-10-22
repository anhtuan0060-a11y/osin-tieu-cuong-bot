# Trợ Lý Ảo Telegram - Osin Tiểu Cường

Bot Telegram thông minh tích hợp trí tuệ nhân tạo **Google Gemini AI**.

- **Tên Bot:** Osin Tiểu Cường
- **Username Telegram:** [@Osin_Tieu_Cuong_Bot](https://t.me/Osin_Tieu_Cuong_Bot)
- **Công nghệ:** Node.js, Grammy Framework, Google GenAI SDK (`gemini-flash-latest`)

---

## 🚀 Hướng Dẫn Sử Dụng

### Cách 1: Chạy trực tiếp bằng chuột (Đơn giản nhất)
Chỉ cần nhấp đúp chuột vào file **`Chay_Bot.bat`** trong thư mục này. Cửa sổ dòng lệnh màu xanh sẽ hiện lên và bot sẽ bắt đầu chạy.

### Cách 2: Chạy bằng dòng lệnh
Mở Terminal / PowerShell trong thư mục này và gõ:
```bash
npm start
```

## 🧠 Tính Năng Bộ Nhớ Vĩnh Viễn (Đã kích hoạt)

Bot có khả năng ghi nhớ lâu dài không bao giờ quên:
- **Xem sổ tay kiến thức:** Gõ lệnh `/sotay` hoặc `/memory`
- **Dạy kiến thức mới (Cách 1):** Gõ lệnh `/learn [nội dung]`
- **Dạy kiến thức mới (Cách 2):** Nhắn tin tự nhiên bắt đầu bằng: `"Ghi nhớ: [nội dung]"`
- **Xóa kiến thức:** Gõ lệnh `/forget [mã số]` (ví dụ: `/forget 1`)

---

## ☁️ Hướng Dẫn Đưa Lên Đám Mây (Render.com - Chạy 24/24 Miễn Phí)

1. Tạo một tài khoản miễn phí trên [Render.com](https://render.com/).
2. Đẩy thư mục code này lên GitHub cá nhân của bạn.
3. Trên Render, chọn **New +** -> **Web Service** -> Chọn kho lưu trữ GitHub của bạn.
4. Cấu hình các biến môi trường (Environment Variables):
   - `TELEGRAM_BOT_TOKEN`: Token lấy từ @BotFather
   - `GEMINI_API_KEY`: API Key lấy từ Google AI Studio
5. Bấm **Deploy**. Bot sẽ tự động chạy 24/24 trên mạng internet mà không cần mở máy tính!
