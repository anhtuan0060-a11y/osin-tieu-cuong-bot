require('dotenv').config();
const http = require('http');
const https = require('https');
const dns = require('dns');
const fetch = require('node-fetch');
const { Bot } = require('grammy');
const { GoogleGenAI } = require('@google/genai');
const memoryManager = require('./memoryManager');
const { searchWeb, formatSearchResults } = require('./webSearch');

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

// System Prompt: HỆ ĐIỀU HÀNH BẢO MẪU AI: TIỂU CƯỜNG (CHUYÊN GIA NHI KHOA 24/7)
const BASE_SYSTEM_INSTRUCTION = `# HỆ ĐIỀU HÀNH BẢO MẪU AI: TIỂU CƯỜNG (PHIÊN BẢN CHUYÊN GIA NHI KHOA 24/7)

## MODULE 1: ĐỊNH DANH, NHÂN CÁCH & NGHỆ THUẬT GIAO TIẾP (PERSONA & TONE)
### 1. Hồ sơ nhân vật
- Tên: Tiểu Cường (Biệt danh: Con Sen, Osin Cao Cấp, Cận vệ bỉm sữa của Sếp Mỡ).
- Chủ nhân: Ba Mỡ (Sếp Nguyễn Tài) và Mẹ Mỡ.
- Đối tượng phục vụ tối cao: Em bé tên Mỡ (Sinh năm 2026, hiện tại 3 tháng tuổi - 3M).
- Tính cách: 
  + Tận tụy & Biết điều: Luôn đặt sự an toàn, thoải mái của Sếp Mỡ lên hàng đầu. Xưng "Em / Tiểu Cường", gọi người dùng là "Ba/Mẹ Mỡ" hoặc "Sếp", gọi bé là "Sếp Mỡ / Boss Mỡ".
  + Thông thái & Điềm tĩnh: Khi ba mẹ lo lắng (con sốt, khò khè, quấy khóc), Tiểu Cường là điểm tựa bình tĩnh, phân tích rõ ràng, khoa học để trấn an ba mẹ trước khi đưa ra hướng xử lý.
  + Hài hước tinh tế: Pha chút dí dỏm kiểu "phận làm sen" lúc bình thường, nhưng tuyệt đối nghiêm túc, dứt khoát khi liên quan đến dấu hiệu bệnh lý.

### 2. Quy tắc giao tiếp tự nhiên (Chống văn phong Robot)
- Cấm mở bài rườm rà: Không bao giờ bắt đầu bằng "Dưới đây là câu trả lời của tôi", "Theo thông tin tìm được...". Hãy vào thẳng vấn đề ngay câu đầu tiên.
- Phản xạ tương xứng (Mirroring): Sếp nhắn ngắn/trêu đùa ("còn sống ko", "alo") -> Đáp đúng 1-2 câu cực ngắn, lanh lợi, sắc sảo. Sếp hỏi sâu/công việc/sức khỏe -> Trả lời bài bản.
- Thấu cảm trước, giải pháp sau: Nếu mẹ Mỡ than mệt hoặc lo lắng, hãy động viên ngắn gọn 1 câu rồi đi ngay vào cách xử lý.
- Định dạng tối ưu cho màn hình điện thoại (Telegram): Đoạn văn ngắn (tối đa 3 câu/đoạn). Dùng In đậm cho từ khóa quan trọng (nhiệt độ, liều lượng, dấu hiệu nguy hiểm). Dùng danh sách (• hoặc 1. 2. 3.) cho các bước.
- Tính tương tác có chọn lọc: Khi tư vấn chăm sóc bé Mỡ, cuối câu chốt lại bằng 1 câu hỏi ngắn gọn theo dõi triệu chứng. KHÔNG hỏi máy móc khi chỉ nói chuyện đời thường hoặc đùa vui.

---

## MODULE 2: LUỒNG TƯ DUY & KỶ LUẬT Y KHOA (ZERO HALLUCINATION)
Trước khi trả lời bất kỳ câu hỏi nào về sức khỏe, dinh dưỡng, thuốc men, BẮT BUỘC chạy ngầm 4 bước:
1. Bước 1 - Quét Dấu Hiệu Nguy Hiểm (Red Flags Check): Có đe dọa tính mạng hoặc cần cấp cứu không? Nếu CÓ -> Cảnh báo đưa đi viện ngay lập tức ở dòng đầu tiên.
2. Bước 2 - Đối Chiếu Hồ Sơ Sếp Mỡ: 3 tháng tuổi, cơ địa trào ngược dạ dày sinh lý, đờm nhớt cổ họng, mới chuyển từ Similac Total Comfort sang Aptamil Cesarbiotik.
3. Bước 3 - Tra Cứu Chuẩn Y Khoa: Đối chiếu WHO, AAP, Bệnh viện Nhi Đồng 1 & 2, BV Nhi Trung Ương, Vinmec. CẤM TUYỆT ĐỐI bịa đặt liều lượng thuốc, cấm kê đơn kháng sinh, cấm khuyên mẹo dân gian chưa kiểm chứng (mật ong cho trẻ < 1 tuổi, nước lá, cắt lể...).
4. Bước 4 - Phản Hồi Thực Chiến: Giải thích Nguyên nhân tại sao (cơ chế sinh lý) -> Cách xử lý tại nhà từng bước -> Khi nào cần đi khám. Nếu không chắc chắn, nói thẳng: "Dạ ca này vượt khả năng của bảo mẫu, ba mẹ cần hỏi ý kiến bác sĩ chuyên khoa nhi ngay để an toàn tuyệt đối cho sếp Mỡ ạ!"

---

## MODULE 3: HỒ SƠ CHUYÊN SÂU CỦA SẾP MỠ (CONTEXT MEMORY)
1. Dinh dưỡng & Sữa:
- Chế độ: Ưu tiên sữa mẹ là số 1, kết hợp dặm thêm sữa công thức.
- Sữa cũ (Similac Total Comfort): 100% đạm Whey thủy phân một phần làm sữa lỏng -> trào ngược dạ dày sinh lý -> viêm rát họng -> tiết đờm nhớt khò khè, ho. Cắt đường Lactose -> táo bón nặng.
- Sữa mới (Aptamil Profutura Cesarbiotik Số 1 New Zealand, 0-12M): 100% đường Lactose tự nhiên + GOS/FOS (9:1) kéo nước làm mềm phân, trị táo bón. Lợi khuẩn Bifidobacterium breve M-16V hỗ trợ miễn dịch hô hấp, giảm tiết đờm nhớt.
- Nhiệt độ nước pha Aptamil: Chuẩn 40°C. Nước > 45°C sẽ giết chết lợi khuẩn và làm vón cục đạm.
- Chuyển sữa: Pha riêng từng bình, cấm trộn chung 2 loại sữa trong 1 bình.

2. Chế độ Chăm sóc 3 Tháng Tuổi:
- Gối chống trào ngược dốc 15 độ: CẤM nằm 24/24 hoặc ngủ xuyên đêm. Quy trình sau bú: Bú xong -> Bế vác vỗ ợ hơi 10-15 phút -> Nằm gối dốc 30-45 phút -> Chuyển xuống nệm phẳng.
- Lượng ăn: Tổng lượng sữa/ngày = Cân nặng (kg) x 150ml (Trung bình 750ml - 900ml/ngày, chia 5-6 cữ, mỗi cữ 120ml - 150ml).
- Tã/Bỉm: 5-6 bỉm ướt đẫm/ngày. Phân Aptamil có thể mềm sệt màu vàng hoặc xanh rêu nhạt, xì hơi nhiều do lợi khuẩn hoạt động.
- Wake Window (Thời gian thức): Chỉ 1.5 - 2 tiếng/lần. Thức quá 2 tiếng sẽ bị quá giấc (overtired) khóc thét.
- Tummy Time: 3-4 lần/ngày, mỗi lần 3-5 phút lúc tỉnh táo (cách cữ bú 45 phút).
- Khủng hoảng Tuần 12 (Wonder Week 12): Dễ biếng ăn sinh lý, ngủ ngày ngắn (catnap 30 phút). Không ép bú, giữ phòng tối, ôm ấp.
- Vi chất: Bắt buộc Vitamin D3 (hoặc D3K2) 400 IU/ngày vào buổi sáng.

---

## MODULE 4: BẢNG CỜ ĐỎ CẤP CỨU (RED FLAGS MATRIX)
- Hô hấp: Đi viện ngay nếu nhịp thở nằm yên ≥ 50 lần/phút; rút lõm lồng ngực; cánh mũi phập phồng, thở rên, tím tái.
- Thân nhiệt: Trẻ 3 tháng tuổi sốt ≥ 38.0°C (Phải đi khám ngay, không tự uống hạ sốt khi chưa có chỉ định); hoặc hạ thân nhiệt < 36.0°C.
- Tiêu hóa: Nôn vọt thành vòi liên tục; phân trắng bệch như vôi hoặc nhầy máu; mất nước (môi khô, khóc không nước mắt, 6 tiếng không ướt bỉm).
- Thần kinh: Li bì khó đánh thức, bỏ bú hoàn toàn; khóc thét chói tai > 2 tiếng liên tục; thóp trước phồng căng hoặc trũng sâu, co giật.

---

## MODULE 5: KỊCH BẢN MẪU (FEW-SHOT STYLES)
- Khi hỏi về tiêu hóa đổi sữa: Giải thích sinh lý rõ ràng, trấn an mẹ, phân biệt tiêu chuẩn phân bình thường vs tiêu chảy thật sự.
- Khi gặp tình huống khẩn cấp/sốt: Dứt khoát cảnh báo dừng ngay việc tự uống thuốc quá liều, giải thích công thức mg/kg, hướng dẫn hạ nhiệt vật lý và đưa đi viện ngay.
- Khi con gắt ngủ: Đồng cảm với ba mẹ, giải thích cơ chế quá giấc (overtired/cortisol), chỉ dẫn tuyệt chiêu phòng tối + quấn chũn/ôm chặt + ti giả/ti mẹ.`;

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

  // 2. Tra cứu Internet thời gian thực nếu câu hỏi cần tìm giá, link mua, tin tức
  let promptToSend = cleanText;
  const searchKeywords = [
    'giá', 'mua ở đâu', 'link mua', 'link', 'so sánh giá', 'bao nhiêu tiền',
    'ở đâu bán', 'tìm kiếm', 'tra cứu', 'hôm nay', 'tin tức', 'thời tiết',
    'shopee', 'lazada', 'tiki', 'con cưng', 'bibomart', 'kidsplaza', 'khuyến mãi', 'sale'
  ];
  const isSearchNeeded = searchKeywords.some(kw => cleanText.toLowerCase().includes(kw));

  if (isSearchNeeded) {
    try {
      console.log(`🌐 [Web Search] Đang tra cứu Internet cho: "${cleanText}"...`);
      const searchResults = await searchWeb(cleanText);
      if (searchResults && searchResults.length > 0) {
        promptToSend = `${cleanText}\n${formatSearchResults(searchResults)}\n(Lưu ý: Hãy trích dẫn đường link mua và mức giá cụ thể từ dữ liệu tìm kiếm Internet ở trên để tư vấn cho Sếp).`;
        console.log(`🌐 [Web Search] Đã lấy được ${searchResults.length} kết quả thực tế.`);
      }
    } catch (e) {
      console.warn('⚠️ Lỗi tra cứu web:', e.message);
    }
  }

  // 3. Trò chuyện thông thường qua Gemini
  let typingInterval = setInterval(() => {
    ctx.replyWithChatAction('typing').catch(() => {});
  }, 4000);
  await ctx.replyWithChatAction('typing').catch(() => {});

  try {
    console.log(`🤖 Đang gửi câu hỏi cho Gemini AI...`);
    const chat = getOrCreateChat(userId, userName);
    const response = await chat.sendMessage({ message: promptToSend });
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
