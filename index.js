require('dotenv').config();
const http = require('http');
const https = require('https');
const dns = require('dns');
const fetch = require('node-fetch');
const { Bot } = require('grammy');
const { GoogleGenAI } = require('@google/genai');
const memoryManager = require('./memoryManager');

// Kiểm tra biến môi trường
if (!process.env.TELEGRAM_BOT_TOKEN) {
  console.error('❌ LỖI: Chưa có TELEGRAM_BOT_TOKEN trong file .env');
  process.exit(1);
}
if (!process.env.GEMINI_API_KEY) {
  console.error('❌ LỖI: Chưa có GEMINI_API_KEY trong file .env');
  process.exit(1);
}

// 1. Cấu hình Custom DNS Agent (Chỉ áp dụng khi chạy trên máy tính cá nhân ở Việt Nam)
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

// Kiểm tra môi trường: nếu đang chạy trên Đám mây (Render) thì dùng DNS trực tiếp của Singapore, không ép IP
const isCloud = process.env.RENDER === 'true' || !!process.env.RENDER;
console.log(`🌍 Môi trường hoạt động: ${isCloud ? 'ĐÁM MÂY (Render Cloud - Singapore)' : 'MÁY CÁ NHÂN (Local PC - Việt Nam)'}`);

// 2. HTTP Server giữ trạng thái sống cho nền tảng Đám mây (Render, Koyeb, Railway)
const PORT = process.env.PORT || 3000;
http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('🤖 Osin Tiểu Cường (@Osin_Tieu_Cuong_Bot) đang hoạt động 24/7 trên Đám Mây!');
}).listen(PORT, () => {
  console.log(`🌐 Đã mở cổng Health Check: ${PORT} (sẵn sàng đưa lên Cloud 24/7)`);
});

// Cơ chế tự động bắn tín hiệu giữ bot luôn thức (Chống chế độ ngủ 15 phút của Render Free)
const RENDER_APP_URL = process.env.RENDER_EXTERNAL_URL || 'https://osin-tieu-cuong-bot.onrender.com';
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

// 3. Khởi tạo Gemini AI Client
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const AI_MODEL = 'gemini-flash-lite-latest';

// System Prompt đẳng cấp - EQ cao, lanh lợi, không máy móc
const BASE_SYSTEM_INSTRUCTION = `Bạn là "Osin Tiểu Cường" (@Osin_Tieu_Cuong_Bot) - một trợ lý ảo siêu thông minh, sắc sảo, lanh lợi và có EQ cao.
- Xưng hô: Gọi người dùng là "Sếp" (hoặc anh/chị), xưng là "Tiểu Cường" hoặc "em". Văn phong tự nhiên, đĩnh đạc, dí dỏm có duyên, tuyệt đối không nịnh bợ sáo rỗng hay xin lỗi lòng vòng.

🧠 NGUYÊN TẮC GIAO TIẾP ĐẲNG CẤP (BẮT BUỘC TUÂN THỦ):
1. PHẢN XẠ TƯƠNG XỨNG (MIRRORING):
   - Khi Sếp nhắn ngắn, chào hỏi, trêu đùa ("còn sống ko", "alo", "em ơi"): Đáp đúng 1-2 câu cực ngắn, lanh lợi, thông minh. Không rào đón, không viết thành bài văn dài.
   - Khi Sếp hỏi công việc, kế hoạch, phân tích: Áp dụng quy tắc BLUF (kết luận trước, phân tích sau), gạch đầu dòng rõ ràng.
2. CHẤM DỨT BỆNH "CON VẸT" (QUAN TRỌNG):
   - Toàn bộ kiến thức về gia đình và bé Mỡ trong Sổ tay là để bạn HIỂU NGẦM trong tiềm thức.
   - CHỈ nhắc đến bé Mỡ khi Sếp trực tiếp hỏi hoặc đang bàn về chủ đề con cái/gia đình. Tuyệt đối không tự tiện câu nào cũng lôi chuyện ăn ngủ của bé Mỡ ra hỏi!
3. TRÌNH BÀY ĐẸP MẮT TRÊN TELEGRAM:
   - Đoạn văn ngắn (2-3 câu mỗi đoạn), thoáng mắt trên điện thoại.
   - In đậm con số, từ khóa quan trọng. Dùng icon chọn lọc, tinh tế.`;

// Quản lý bộ nhớ hội thoại theo từng người dùng (userId)
const userSessions = new Map();

function buildSystemPrompt(userName) {
  const dynamicMemories = memoryManager.formatMemoriesForPrompt();
  return `${BASE_SYSTEM_INSTRUCTION}\nNgười đang trò chuyện với bạn tên là: ${userName || 'Sếp'}.${dynamicMemories}`;
}

function getOrCreateChat(userId, userName, forceReset = false) {
  if (forceReset || !userSessions.has(userId)) {
    const fullPrompt = buildSystemPrompt(userName);
    const chat = ai.chats.create({
      model: AI_MODEL,
      config: {
        systemInstruction: fullPrompt
      }
    });
    userSessions.set(userId, chat);
  }
  return userSessions.get(userId);
}

// 4. Khởi tạo Telegram Bot (Tự động thích ứng Cloud / Local)
const botConfig = isCloud
  ? {}
  : { client: { baseFetchConfig: { agent: customAgent } } };
const bot = new Bot(process.env.TELEGRAM_BOT_TOKEN, botConfig);

// Hàm chia nhỏ tin nhắn nếu dài hơn giới hạn 4096 ký tự của Telegram
async function sendLongMessage(ctx, text) {
  const MAX_LENGTH = 4000;
  let chunks = [];
  if (!text || text.length <= MAX_LENGTH) {
    chunks = [text || ''];
  } else {
    let remaining = text;
    while (remaining.length > 0) {
      let chunk = remaining.slice(0, MAX_LENGTH);
      const lastNewline = chunk.lastIndexOf('\n');
      if (lastNewline > 2000 && remaining.length > MAX_LENGTH) {
        chunk = remaining.slice(0, lastNewline);
        remaining = remaining.slice(lastNewline + 1);
      } else {
        remaining = remaining.slice(MAX_LENGTH);
      }
      chunks.push(chunk);
    }
  }

  for (const chunk of chunks) {
    try {
      await ctx.reply(chunk, { parse_mode: 'Markdown' });
    } catch (err) {
      console.warn('⚠️ Lỗi format Markdown, tự động gửi lại bằng text thuần:', err.message);
      await ctx.reply(chunk);
    }
  }
}

// Lệnh /start
bot.command('start', async (ctx) => {
  const userName = ctx.from.first_name || 'Sếp';
  getOrCreateChat(ctx.from.id, userName);

  const welcomeMessage = `👋 **Dạ, Osin Tiểu Cường xin kính chào Sếp ${userName}!** 🙇‍♂️

Em là trợ lý ảo AI cao cấp chạy bằng công nghệ **Google Gemini**, đã được nâng cấp tính năng **BỘ NHỚ VĨNH VIỄN**!

🧠 **Em có thể học và nhớ lâu dài:**
• Mọi điều Sếp dặn sẽ được ghi vào **Sổ tay vĩnh viễn**, không bao giờ bị quên dù tắt máy hay khởi động lại.
• Dạy em nhanh: Nhắn *"Ghi nhớ: [nội dung]"* hoặc dùng lệnh \`/learn [nội dung]\`.

⚙️ **Các lệnh chính:**
/sotay hoặc /memory - Xem lại toàn bộ điều em đã ghi nhớ
/learn [nội dung] - Dạy kiến thức mới
/forget [mã số] - Xóa một điều đã ghi nhớ
/reset - Bắt đầu cuộc trò chuyện mới
/help - Xem hướng dẫn

Sếp cứ ra lệnh, Tiểu Cường sẽ phục vụ chu đáo ngay ạ! ✨`;

  await ctx.reply(welcomeMessage, { parse_mode: 'Markdown' });
});

// Lệnh /sotay hoặc /memory: Xem trí nhớ vĩnh viễn
bot.command(['sotay', 'memory'], async (ctx) => {
  const text = memoryManager.formatMemoriesForUser();
  await sendLongMessage(ctx, text);
});

// Lệnh /learn hoặc /ghinho: Dạy kiến thức mới
bot.command(['learn', 'ghinho'], async (ctx) => {
  const content = ctx.match;
  if (!content || content.trim().length === 0) {
    return await ctx.reply('⚠️ Sếp ơi, Sếp hãy nhắn theo cú pháp: `/learn [nội dung cần dạy]` nhé!\nVí dụ: `/learn Sếp Mỡ thích nghe nhạc Ru con khi ngủ`', { parse_mode: 'Markdown' });
  }

  const added = memoryManager.addMemory(content.trim(), 'Kiến thức Sếp dạy');
  getOrCreateChat(ctx.from.id, ctx.from.first_name, true);

  await ctx.reply(`✅ **Dạ, Tiểu Cường đã ghi nhận vào não vĩnh viễn rồi ạ!** 🧠\n\n📌 **Mục #${added.id}:** "${added.content}"\n\nTừ nay trở đi, dù có tắt máy hay chuyển máy chủ thì em cũng không bao giờ quên điều này đâu ạ! 🥰`, { parse_mode: 'Markdown' });
});

// Lệnh /forget: Xóa một kiến thức đã nhớ
bot.command('forget', async (ctx) => {
  const id = ctx.match;
  if (!id || isNaN(id)) {
    return await ctx.reply('⚠️ Sếp vui lòng chỉ định mã số cần xóa, ví dụ: `/forget 2` (Gõ /sotay để xem danh sách mã số nhé).', { parse_mode: 'Markdown' });
  }

  const ok = memoryManager.deleteMemory(id);
  if (ok) {
    getOrCreateChat(ctx.from.id, ctx.from.first_name, true);
    await ctx.reply(`🗑️ Dạ, Tiểu Cường đã xóa mục #${id} khỏi sổ tay ghi nhớ rồi ạ!`);
  } else {
    await ctx.reply(`❌ Không tìm thấy mục mang mã số #${id} trong sổ tay Sếp ơi!`);
  }
});

// Lệnh /reset hoặc /new để làm mới cuộc trò chuyện
bot.command(['reset', 'new'], async (ctx) => {
  getOrCreateChat(ctx.from.id, ctx.from.first_name, true);
  await ctx.reply('🧹 Dạ, Tiểu Cường đã dọn dẹp sạch cuộc trò chuyện ngắn hạn cũ! Nhưng các kiến thức trong **Sổ tay vĩnh viễn** thì em vẫn nhớ 100% nha Sếp. Sếp muốn bảo em làm gì tiếp theo đây ạ? 🤩');
});

// Lệnh /help
bot.command('help', async (ctx) => {
  const helpText = `📖 **HƯỚNG DẪN SỬ DỤNG OSIN TIỂU CƯỜNG:**

1. **Dạy học cho Bot (Bộ nhớ vĩnh viễn):**
   • Nhắn: *Ghi nhớ: [điều cần nhớ]*
   • Hoặc dùng lệnh: \`/learn [nội dung]\`
   • Xem những gì bot đã nhớ: \`/sotay\`
   • Xóa điều đã nhớ: \`/forget [mã số]\`

2. **Gửi hình ảnh:**
   Gửi 1 tấm ảnh kèm chú thích (caption), em sẽ soi kỹ và trả lời chi tiết.

3. **Trò chuyện & Công việc:**
   Cứ hỏi đáp tự nhiên, bot tự nhớ ngữ cảnh và áp dụng quy tắc đã học.

Chúc Sếp có những trải nghiệm thật tuyệt vời! 🚀`;
  await ctx.reply(helpText, { parse_mode: 'Markdown' });
});

// Xử lý tin nhắn hình ảnh
bot.on(':photo', async (ctx) => {
  const userName = ctx.from.first_name || 'Sếp';
  const caption = ctx.message.caption || 'Hãy phân tích chi tiết hình ảnh này giúp tôi.';

  let typingInterval = setInterval(() => {
    ctx.replyWithChatAction('typing').catch(() => {});
  }, 4000);
  await ctx.replyWithChatAction('typing').catch(() => {});

  try {
    const file = await ctx.getFile();
    const fileUrl = `https://api.telegram.org/file/bot${process.env.TELEGRAM_BOT_TOKEN}/${file.file_path}`;

    const response = await fetch(fileUrl, { agent: customAgent });
    const buffer = await response.buffer();
    const base64Data = buffer.toString('base64');

    const promptWithMemory = `${buildSystemPrompt(userName)}\nCâu hỏi/Yêu cầu: ${caption}`;
    const result = await ai.models.generateContent({
      model: AI_MODEL,
      contents: [
        {
          role: 'user',
          parts: [
            { text: promptWithMemory },
            {
              inlineData: {
                data: base64Data,
                mimeType: 'image/jpeg'
              }
            }
          ]
        }
      ]
    });

    clearInterval(typingInterval);
    const replyText = result.text || 'Dạ, em đã xem ảnh nhưng chưa tìm thấy câu trả lời phù hợp ạ!';
    await sendLongMessage(ctx, replyText);

  } catch (err) {
    clearInterval(typingInterval);
    console.error('❌ Lỗi xử lý ảnh:', err);
    await ctx.reply('Úi Sếp ơi, mắt em hôm nay hơi quáng gà nên chưa đọc được tấm ảnh này, Sếp gửi lại giúp em với nhé! 🥺');
  }
});

// Xử lý tin nhắn văn bản thông thường
bot.on('message:text', async (ctx) => {
  const text = ctx.message.text;
  if (!text || text.startsWith('/')) return;

  const isGroup = ctx.chat.type === 'group' || ctx.chat.type === 'supergroup';
  const botUsername = ctx.me.username;
  const isMentioned = text.toLowerCase().includes(`@${botUsername.toLowerCase()}`);
  const isReplyToBot = ctx.message.reply_to_message?.from?.id === ctx.me.id;

  // Trong nhóm: chỉ trả lời khi được tag @ hoặc bấm reply vào tin nhắn của bot
  if (isGroup && !isMentioned && !isReplyToBot) {
    return;
  }

  // Gọt bỏ tag @Osin_Tieu_Cuong_Bot khỏi câu hỏi để AI nhận prompt sạch
  const cleanText = text.replace(new RegExp(`@${botUsername}`, 'gi'), '').trim();
  if (!cleanText) return;

  const userId = ctx.from.id;
  const userName = ctx.from.first_name || 'Sếp';

  console.log(`📩 [${new Date().toLocaleTimeString('vi-VN')}] Nhận tin từ ${userName} (${isGroup ? 'Nhóm' : 'Chat riêng'}): "${cleanText}"`);

  // 1. Nhận diện tự động nếu người dùng muốn dạy kiến thức
  const teachPatterns = [
    /^ghi nhớ\s*:\s*(.+)/i,
    /^nhớ nhé\s*:\s*(.+)/i,
    /^lưu ý\s*:\s*(.+)/i,
    /^học\s*:\s*(.+)/i,
    /^cẩm nang\s*:\s*(.+)/i,
    /^tiểu cường nhớ\s*:\s*(.+)/i
  ];

  for (const pattern of teachPatterns) {
    const match = cleanText.match(pattern);
    if (match && match[1]) {
      const knowledge = match[1].trim();
      const added = memoryManager.addMemory(knowledge, 'Kiến thức Sếp dạy');
      getOrCreateChat(userId, userName, true);
      console.log(`🧠 Đã lưu kiến thức mới #${added.id}: "${added.content}"`);
      return await ctx.reply(`🧠 **Dạ, Tiểu Cường đã ghi nhớ vĩnh viễn điều này vào sổ tay rồi ạ!**\n\n📌 **Mục #${added.id}:** "${added.content}"\n\nEm đã khắc sâu vào tiềm thức, kể cả khi tắt máy hay bảo trì em cũng sẽ không bao giờ quên ạ! 🥰`, { parse_mode: 'Markdown' }).catch(async () => {
        await ctx.reply(`🧠 Dạ, Tiểu Cường đã ghi nhớ vĩnh viễn điều này vào sổ tay rồi ạ!\n\nMục #${added.id}: "${added.content}"`);
      });
    }
  }

  // 2. Trò chuyện thông thường qua Gemini
  let typingInterval = setInterval(() => {
    ctx.replyWithChatAction('typing').catch(() => {});
  }, 4000);
  await ctx.replyWithChatAction('typing').catch(() => {});

  try {
    console.log(`🤖 Đang gửi câu hỏi cho Gemini AI...`);
    const chat = getOrCreateChat(userId, userName);
    const response = await chat.sendMessage({ message: cleanText });
    clearInterval(typingInterval);

    const replyText = response.text || 'Dạ, Tiểu Cường đã ghi nhận ý Sếp!';
    console.log(`✅ Gemini phản hồi thành công (${replyText.length} ký tự). Đang gửi về Telegram...`);
    await sendLongMessage(ctx, replyText);
    console.log(`📤 Đã gửi tin nhắn cho Sếp thành công!`);

  } catch (err) {
    clearInterval(typingInterval);
    console.error('❌ Lỗi xử lý tin nhắn:', err);

    if (err.message && (err.message.includes('429') || err.message.includes('quota'))) {
      await ctx.reply('Dạ Sếp ơi, Google đang tạm nghẽn một chút do nhiều người gọi quá (hạn mức tạm thời). Sếp đợi em khoảng 10-15 giây rồi nhắn lại nhé! 🙇‍♂️').catch(() => {});
    } else {
      userSessions.delete(userId);
      await ctx.reply('Dạ Sếp ơi, vừa có chút chập điện trong mạch não AI của em, em đã tự khởi động lại rồi. Sếp nhắn lại câu vừa rồi giúp em nhé! 🙏').catch(() => {});
    }
  }
});

// Bắt lỗi toàn cục của Bot để không bao giờ bị dừng đột ngột
bot.catch((err) => {
  console.error('⚠️ Lỗi Grammy Bot:', err.error || err);
});

// Khởi chạy Bot
console.log('--------------------------------------------------');
console.log('🤖 OSIN TIỂU CƯỜNG (@Osin_Tieu_Cuong_Bot) ĐANG CHẠY...');
console.log('🧠 TÍNH NĂNG BỘ NHỚ VĨNH VIỄN: ĐÃ KÍCH HOẠT');
console.log(`🌐 PORT HEALTH CHECK: ${PORT}`);
console.log('--------------------------------------------------');

bot.start();
