require('dotenv').config();
const fs = require('fs');
const http = require('http');
const https = require('https');
const dns = require('dns');
const fetch = require('node-fetch');
const { Bot, InputFile } = require('grammy');
const { GoogleGenAI } = require('@google/genai');
const memoryManager = require('./memoryManager');
const chatHistoryManager = require('./chatHistoryManager');
const { searchWeb, formatSearchResults, fetchUrlContent, formatUrlContent, extractUrls, getLiveExchangeRate, formatExchangeRate } = require('./webSearch');

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
- Đối tượng phục vụ tối cao: Em bé tên Mỡ (Sinh ngày 13/07/2026, hiện tại hơn 3 tháng tuổi - 3M).
- Tính cách & Tác phong:
  + Tận tụy & Chuẩn mực: Luôn đặt sự an toàn, thoải mái của Sếp Mỡ lên hàng đầu. Xưng "Em / Tiểu Cường", gọi người dùng là "Ba/Mẹ Mỡ" hoặc "Sếp", gọi bé là "Sếp Mỡ / Boss Mỡ".
  + Thông thái & Điềm tĩnh: Phân tích rõ ràng, khoa học, là điểm tựa vững chắc cho ba mẹ. Lịch thiệp, khiêm nhường, lễ phép.
  + TUYỆT ĐỐI CẤM NÓI NHẢM & CỢT NHẢ: Tuyệt đối KHÔNG đùa cợt vô duyên, KHÔNG tự bịa chuyện đùa về đời tư (quỹ đen, trốn việc, nói xấu ba mẹ, não cá vàng...). Không nói những câu đưa đẩy vô bổ làm phiền ba mẹ.
  + NGUYÊN TẮC THẲNG THẮN & THIẾT THỰC (NO FLUFF): Có dữ liệu thì trả lời ngay, đúng trọng tâm. Khi thiếu thông tin hoặc chưa có trong sổ tay, nói thẳng thắn, nhã nhặn và lịch sự: "Dạ thông tin này em chưa có trong hồ sơ của Sếp Mỡ, Ba Mỡ cho em xin để em lưu vào sổ tay ngay nhé ạ!", tuyệt đối không bịa chuyện đùa cợt để lấp liếm.

### 2. Quy tắc giao tiếp tự nhiên (Chống văn phong Robot)
- Đi thẳng vào trọng tâm: Cấm mở bài rườm rà ("Dưới đây là câu trả lời của tôi", "Theo thông tin..."). Hãy vào thẳng vấn đề ngay câu đầu tiên. Tiết kiệm thời gian tối đa cho ba mẹ.
- Phản xạ tương xứng (Mirroring): Sếp nhắn ngắn/trêu đùa ("còn sống ko", "alo") -> Đáp đúng 1-2 câu cực ngắn, lanh lợi, sắc sảo. Sếp hỏi sâu/công việc/sức khỏe -> Trả lời bài bản.
- Thấu cảm trước, giải pháp sau: Nếu mẹ Mỡ than mệt hoặc lo lắng, hãy động viên ngắn gọn 1 câu rồi đi ngay vào cách xử lý.
- Định dạng tối ưu cho màn hình điện thoại (Telegram): Đoạn văn ngắn (tối đa 3 câu/đoạn). Dùng In đậm cho từ khóa quan trọng (nhiệt độ, liều lượng, dấu hiệu nguy hiểm). Dùng danh sách (• hoặc 1. 2. 3.) cho các bước.
- Tính tương tác có chọn lọc: Khi tư vấn chăm sóc bé Mỡ, cuối câu chốt lại bằng 1 câu hỏi ngắn gọn theo dõi triệu chứng. KHÔNG hỏi máy móc khi chỉ nói chuyện đời thường.

---

## MODULE 2: LUỒNG TƯ DUY & KỶ LUẬT Y KHOA (ZERO HALLUCINATION)
Trước khi trả lời bất kỳ câu hỏi nào về sức khỏe, dinh dưỡng, thuốc men, BẮT BUỘC chạy ngầm 4 bước:
1. Bước 1 - Quét Dấu Hiệu Nguy Hiểm (Red Flags Check): Có đe dọa tính mạng hoặc cần cấp cứu không? Nếu CÓ -> Cảnh báo đưa đi viện ngay lập tức ở dòng đầu tiên.
2. Bước 2 - Đối Chiếu Hồ Sơ Sếp Mỡ: Sinh ngày 13/07/2026 (hơn 3 tháng tuổi), cơ địa trào ngược dạ dày sinh lý, đờm nhớt cổ họng, mới chuyển từ Similac Total Comfort sang Aptamil Cesarbiotik.
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
- Khi con gắt ngủ: Đồng cảm với ba mẹ, giải thích cơ chế quá giấc (overtired/cortisol), chỉ dẫn tuyệt chiêu phòng tối + quấn chũn/ôm chặt + ti giả/ti mẹ.

---

## MODULE 6: KỸ NĂNG TRA CỨU INTERNET & GỬI LINK MUA HÀNG, CHECK GIÁ (WEB BROWSING)
- Bạn ĐÃ ĐƯỢC TRANG BỊ CÔNG CỤ TRA CỨU INTERNET THEO THỜI GIAN THỰC.
- Khi Ba Mẹ Mỡ nhờ check giá, so sánh giá, tìm link mua sữa, tã bỉm hay bất kỳ sản phẩm nào:
  + TUYỆT ĐỐI CẤM TỪ CHỐI bằng các câu như "em không có quyền truy cập internet theo thời gian thực", "vượt khả năng của bảo mẫu", "ba mẹ tự lên app kiểm tra".
  + Bạn BẮT BUỘC phải đọc kỹ dữ liệu tìm kiếm Internet / dữ liệu đọc link được đính kèm ở câu hỏi để:
    1. Báo mức giá cụ thể (ví dụ: Con Cưng khoảng bao nhiêu, Shopee khoảng bao nhiêu).
    2. ĐÍNH KÈM ĐƯỜNG LINK MUA HÀNG (đặt trong cú pháp Markdown [Tên shop / sản phẩm](URL)) để ba mẹ bấm vào đặt mua được ngay!
    3. Hướng dẫn ba mẹ chọn đúng gian hàng chính hãng (Mall) để đảm bảo chất lượng cho Sếp Mỡ.

---

## MODULE 7: KỶ LUẬT THÉP BẢO VỆ CHÂN LÝ - TUYỆT ĐỐI CẤM "CHÉM GIÓ" / BỊA ĐẶT (ZERO HALLUCINATION PROTOCOL)
Bạn phục vụ chăm sóc cho em bé sơ sinh (Sếp Mỡ, sinh ngày 13/07/2026, hiện tại hơn 3 tháng tuổi). Mọi sai sót, bịa đặt hoặc phán bừa đều có thể gây hậu quả nghiêm trọng. Do đó bạn PHẢI TUÂN THỦ TUYỆT ĐỐI 5 NGUYÊN TẮC BẤT KHẢ XÂM PHẠM SAU:

1. NGUYÊN TẮC SỰ THẬT LÀ SỐ 1 (FACTS ONLY):
   - Mọi thông tin bạn đưa ra (giá tiền, quy cách đóng gói hộp nhỏ/hộp lớn, thành phần, liều lượng, link mua hàng) BẮT BUỘC phải dựa trên DỮ LIỆU THỰC TẾ được cung cấp (từ kết quả tìm kiếm Internet, dữ liệu đọc trực tiếp từ link web, hoặc sổ tay kiến thức đã lưu).
   - KHÔNG CÓ DỮ LIỆU THẬT = TUYỆT ĐỐI KHÔNG ĐƯỢC PHÁN BỪA.

2. CẤM TỰ BỊA ĐẶT GIÁ TIỀN & THÔNG SỐ:
   - TUYỆT ĐỐI CẤM tự nghĩ ra mức giá (ví dụ: cấm bịa 'khoảng 795k - 830k' hoặc '415.000đ').
   - Nếu trong dữ liệu đọc link hoặc tìm kiếm có con số giá cụ thể (ví dụ: Con Cưng hộp 380g là 346.000đ, hộp 800g là 764.000đ) -> Báo ĐÚNG con số tiền đó.
   - Nếu dữ liệu không có con số chính xác hoặc web yêu cầu chọn chi nhánh -> Phải nói thẳng thắn và trung thực: "Dạ trên web hiện chưa hiển thị con số giá cụ thể (có thể do hệ thống yêu cầu chọn chi nhánh/địa chỉ nhận hàng), Ba Mẹ bấm trực tiếp vào link [Tên shop](URL) để xem giá chuẩn tại chi nhánh gần nhà nhé!".

3. CẤM TỰ PHÁN BỪA VỀ SỰ TỒN TẠI CỦA SẢN PHẨM:
   - TUYỆT ĐỐI CẤM tự khẳng định: "Hãng không sản xuất hộp nhỏ hơn cho dòng này", "Hãng không có loại này" khi chưa có thông tin chính thức.
   - Nếu chưa tra thấy thông tin, chỉ được nói: "Dạ hiện tại em chưa quét thấy quy cách hộp nhỏ của dòng này trên kết quả tìm kiếm, để em tìm kỹ lại hoặc Ba Mẹ có đường link cụ thể gửi em soi ngay nhé!".

4. CẤM "DIỄN KỊCH", ĐÙA CỢT NHẢM NHÍ VÀ DÙNG VĂN MẪU GIẢ TẠO:
   - TUYỆT ĐỐI CẤM viết những câu giả vờ như "(Tiểu Cường đang quét dữ liệu thời gian thực...)" rồi sau đó lại đưa thông tin bịa đặt.
   - TUYỆT ĐỐI CẤM tự bịa chuyện đùa nhảm nhí, cợt nhả về đời tư gia đình (như 'quỹ đen', 'trốn việc', 'quên bài', 'lú lẫn'...).
   - Nếu thiếu thông tin, báo thẳng thắn, ngắn gọn và lịch thiệp, tuyệt đối không nói những câu đưa đẩy vô bổ làm mất thời gian của ba mẹ.

5. BẢO TOÀN KỶ LUẬT Y KHOA:
   - Nhiệt độ nước pha Aptamil Cesarbiotik BẮT BUỘC là 40°C.
   - Vitamin D3: 400 IU/ngày.
   - Trẻ 3 tháng tuổi sốt >= 38.0°C hoặc thở >= 50 lần/phút, rút lõm lồng ngực: CẢNH BÁO ĐI VIỆN NGAY LẬP TỨC. Cấm tự kê kháng sinh, cấm khuyên mẹo dân gian nguy hiểm.`;

// Quản lý phiên hội thoại AI (Tách biệt rõ: Group theo nhóm, Chat riêng theo người dùng)
const userSessions = new Map();

// Trả về khóa phiên duy nhất (Group: 'group_<id>', Chat riêng: 'user_<id>')
function getSessionKey(ctx) {
  const isGroup = ctx.chat.type === 'group' || ctx.chat.type === 'supergroup';
  return isGroup ? `group_${ctx.chat.id}` : `user_${ctx.from.id}`;
}

// Quản lý ngữ cảnh chủ đề gần nhất cho từng phiên (Group hoặc User)
const sessionContexts = new Map();
function getSessionContext(sessionKey) {
  if (!sessionContexts.has(sessionKey)) {
    sessionContexts.set(sessionKey, {
      lastProduct: 'sữa Aptamil Profutura Cesarbiotik số 1 (New Zealand)',
      lastSubject: 'general'
    });
  }
  return sessionContexts.get(sessionKey);
}

function buildSystemPrompt(displayName) {
  const dynamicMemories = memoryManager.formatMemoriesForPrompt();
  return `${BASE_SYSTEM_INSTRUCTION}\nNgười / Nhóm đang trò chuyện với bạn là: ${displayName || 'Gia đình Sếp Mỡ'}.${dynamicMemories}`;
}

function getOrCreateChat(sessionKey, displayName, forceReset = false) {
  if (forceReset || !userSessions.has(sessionKey)) {
    const fullPrompt = buildSystemPrompt(displayName);
    const history = chatHistoryManager.getSessionHistoryForGemini(sessionKey);
    const chat = ai.chats.create({
      model: AI_MODEL,
      history: history.length > 0 ? history : undefined,
      config: {
        systemInstruction: fullPrompt
      }
    });
    userSessions.set(sessionKey, chat);
  }
  return userSessions.get(sessionKey);
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
  const sessionKey = getSessionKey(ctx);
  const userName = ctx.from.first_name || 'Sếp';
  getOrCreateChat(sessionKey, userName);

  const welcomeMessage = `👋 **Dạ, Osin Tiểu Cường xin kính chào Sếp ${userName}!** 🙇‍♂️

Em là trợ lý ảo AI cao cấp chạy bằng công nghệ **Google Gemini**, đã được nâng cấp tính năng **BỘ NHỚ THÔNG MINH CHỐNG XUNG ĐỘT**!

🧠 **Em có thể học và nhớ lâu dài:**
• Mọi điều Sếp dặn sẽ được ghi vào **Sổ tay vĩnh viễn**, không bao giờ bị quên dù tắt máy hay khởi động lại.
• Tự động kiểm tra xung đột: nếu kiến thức mới va chạm với điều cũ, em sẽ hỏi lại Ba Mỡ ngay để tránh nhớ sai!
• Dạy em nhanh: Nhắn *"Ghi nhớ: [nội dung]"* hoặc dùng lệnh \`/learn [nội dung]\`.

⚙️ **Các lệnh chính:**
/sotay hoặc /memory - Xem lại toàn bộ điều em đã ghi nhớ
/learn [nội dung] - Dạy kiến thức mới (tự động chống xung đột)
/backup hoặc /export - Tải file sao lưu sổ tay về máy
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

// Quản lý trạng thái chờ xác nhận xung đột bộ nhớ
const pendingConflicts = new Map();

// Hàm xử lý dạy kiến thức mới có kiểm tra xung đột logic thông minh
async function handleTeachKnowledge(ctx, sessionKey, userName, knowledge) {
  let typingInterval = setInterval(() => {
    ctx.replyWithChatAction('typing').catch(() => {});
  }, 4000);
  await ctx.replyWithChatAction('typing').catch(() => {});

  try {
    const check = await memoryManager.checkMemoryConflict(ai, knowledge);
    clearInterval(typingInterval);

    if (check.hasConflict && check.conflictId) {
      pendingConflicts.set(sessionKey, {
        newKnowledge: knowledge,
        conflictId: check.conflictId,
        oldContent: check.oldContent,
        topic: check.suggestedTopic || 'Kiến thức Sếp dạy',
        timestamp: Date.now()
      });

      const msg = `⚠️ **Ba Mỡ ơi, Tiểu Cường phát hiện kiến thức mới này đang XUNG ĐỘT với điều em đã nhớ trước đây:**\n\n` +
                  `📌 **Điều cũ (#${check.conflictId}):** "${check.oldContent}"\n\n` +
                  `🆕 **Điều mới Ba vừa dặn:** "${knowledge}"\n` +
                  `❓ **Lý do xung đột:** ${check.reason || 'Có sự mâu thuẫn trực tiếp giữa kiến thức mới và cũ'}\n\n` +
                  `Ba có muốn em **THAY THẾ** điều cũ bằng điều mới này không ạ?\n\n` +
                  `👉 Nhắn **"Thay thế"** (hoặc /thaythe) để cập nhật mới.\n` +
                  `👉 Nhắn **"Giữ cả hai"** (hoặc /giucahai) nếu muốn lưu thêm song song.\n` +
                  `👉 Nhắn **"Hủy"** (hoặc /huy) nếu Ba dặn nhầm nhé!`;

      return await ctx.reply(msg, { parse_mode: 'Markdown' });
    }

    const topic = check.suggestedTopic || 'Kiến thức Sếp dạy';
    const added = memoryManager.addMemory(knowledge, topic);
    getOrCreateChat(sessionKey, userName, true);
    console.log(`🧠 Đã lưu kiến thức mới #${added.id} [${added.topic}]: "${added.content}"`);

    chatHistoryManager.appendChatTurn(sessionKey, 'user', `[Dạy kiến thức]: ${knowledge}`);
    chatHistoryManager.appendChatTurn(sessionKey, 'model', `🧠 Dạ, Tiểu Cường đã ghi nhớ vĩnh viễn vào sổ tay mục #${added.id} [${added.topic}]: "${added.content}"`);

    return await ctx.reply(
      `🧠 **Dạ, Tiểu Cường đã ghi nhớ vĩnh viễn điều này vào sổ tay rồi ạ!**\n\n` +
      `📌 **Mục #${added.id} [${added.topic}]:** "${added.content}"\n\n` +
      `Em đã đối chiếu kiểm tra không thấy xung đột với các điều cũ. Em đã khắc sâu vào tiềm thức rồi nha Ba Mỡ! 🥰`,
      { parse_mode: 'Markdown' }
    );
  } catch (err) {
    clearInterval(typingInterval);
    console.error('❌ Lỗi khi học kiến thức mới:', err);
    const added = memoryManager.addMemory(knowledge, 'Kiến thức Sếp dạy');
    getOrCreateChat(sessionKey, userName, true);
    chatHistoryManager.appendChatTurn(sessionKey, 'user', `[Dạy kiến thức]: ${knowledge}`);
    chatHistoryManager.appendChatTurn(sessionKey, 'model', `🧠 Dạ, Tiểu Cường đã ghi nhận vào sổ tay mục #${added.id}: "${added.content}"`);
    return await ctx.reply(
      `🧠 **Dạ, Tiểu Cường đã ghi nhận vào sổ tay rồi ạ!**\n\n📌 **Mục #${added.id}:** "${added.content}"`,
      { parse_mode: 'Markdown' }
    );
  }
}

// Lệnh /learn hoặc /ghinho: Dạy kiến thức mới
bot.command(['learn', 'ghinho'], async (ctx) => {
  const content = ctx.match;
  if (!content || content.trim().length === 0) {
    return await ctx.reply('⚠️ Sếp ơi, Sếp hãy nhắn theo cú pháp: `/learn [nội dung cần dạy]` nhé!\nVí dụ: `/learn Sếp Mỡ thích nghe nhạc Ru con khi ngủ`', { parse_mode: 'Markdown' });
  }

  const sessionKey = getSessionKey(ctx);
  const userName = ctx.from.first_name || 'Sếp';
  await handleTeachKnowledge(ctx, sessionKey, userName, content.trim());
});

// Lệnh /thaythe: Xác nhận thay thế kiến thức cũ khi có xung đột
bot.command('thaythe', async (ctx) => {
  const sessionKey = getSessionKey(ctx);
  if (!pendingConflicts.has(sessionKey)) return await ctx.reply('Dạ hiện tại không có xung đột nào đang chờ xử lý ạ!');
  const pending = pendingConflicts.get(sessionKey);
  const updated = memoryManager.updateMemory(pending.conflictId, pending.newKnowledge, pending.topic);
  pendingConflicts.delete(sessionKey);
  getOrCreateChat(sessionKey, ctx.from.first_name, true);
  await ctx.reply(`✅ **Dạ, Tiểu Cường đã THAY THẾ thành công mục #${pending.conflictId}!**\n\n📌 **Nội dung mới:** "${updated.content}"\n\nSổ tay đã được làm mới chuẩn chỉnh rồi nha Ba Mỡ! 🥰`, { parse_mode: 'Markdown' });
});

// Lệnh /giucahai: Lưu thêm mục mới song song với mục cũ
bot.command('giucahai', async (ctx) => {
  const sessionKey = getSessionKey(ctx);
  if (!pendingConflicts.has(sessionKey)) return await ctx.reply('Dạ hiện tại không có xung đột nào đang chờ xử lý ạ!');
  const pending = pendingConflicts.get(sessionKey);
  const added = memoryManager.addMemory(pending.newKnowledge, pending.topic);
  pendingConflicts.delete(sessionKey);
  getOrCreateChat(sessionKey, ctx.from.first_name, true);
  await ctx.reply(`✅ **Dạ, Tiểu Cường đã lưu thêm thành mục mới #${added.id} [${added.topic}] song song với mục cũ ạ!**`, { parse_mode: 'Markdown' });
});

// Lệnh /huy: Hủy cập nhật
bot.command('huy', async (ctx) => {
  const sessionKey = getSessionKey(ctx);
  if (pendingConflicts.has(sessionKey)) {
    const pending = pendingConflicts.get(sessionKey);
    pendingConflicts.delete(sessionKey);
    await ctx.reply(`👌 Dạ, Tiểu Cường đã hủy yêu cầu cập nhật. Điều cũ (#${pending.conflictId}) vẫn được giữ nguyên vẹn 100% ạ!`);
  } else {
    await ctx.reply('Dạ hiện tại không có thao tác nào cần hủy ạ!');
  }
});

// Lệnh /backup hoặc /export: Gửi file sao lưu trực tiếp về Telegram
bot.command(['backup', 'export'], async (ctx) => {
  const filePath = memoryManager.getPrimaryMemoryFile();
  if (!fs.existsSync(filePath)) {
    return await ctx.reply('⚠️ Chưa có dữ liệu memory.json để backup Sếp ơi!');
  }
  await ctx.reply('📦 **Dạ, Tiểu Cường gửi ngay file sao lưu Sổ tay kiến thức (memory.json) cho Ba Mỡ cất giữ an toàn đây ạ:**', { parse_mode: 'Markdown' });
  await ctx.replyWithDocument(new InputFile(filePath, 'memory.json'));
});

// Lệnh /forget: Xóa một kiến thức đã nhớ
bot.command('forget', async (ctx) => {
  const id = ctx.match;
  if (!id || isNaN(id)) {
    return await ctx.reply('⚠️ Sếp vui lòng chỉ định mã số cần xóa, ví dụ: `/forget 2` (Gõ /sotay để xem danh sách mã số nhé).', { parse_mode: 'Markdown' });
  }

  const ok = memoryManager.deleteMemory(id);
  if (ok) {
    const sessionKey = getSessionKey(ctx);
    getOrCreateChat(sessionKey, ctx.from.first_name, true);
    await ctx.reply(`🗑️ Dạ, Tiểu Cường đã xóa mục #${id} khỏi sổ tay ghi nhớ rồi ạ!`);
  } else {
    await ctx.reply(`❌ Không tìm thấy mục mang mã số #${id} trong sổ tay Sếp ơi!`);
  }
});

// Lệnh /reset hoặc /new để làm mới cuộc trò chuyện
bot.command(['reset', 'new'], async (ctx) => {
  const sessionKey = getSessionKey(ctx);
  chatHistoryManager.clearSessionHistory(sessionKey);
  getOrCreateChat(sessionKey, ctx.from.first_name, true);
  await ctx.reply('🧹 Dạ, Tiểu Cường đã dọn dẹp sạch cuộc trò chuyện ngắn hạn cũ! Nhưng các kiến thức trong **Sổ tay vĩnh viễn** thì em vẫn nhớ 100% nha Sếp. Sếp muốn bảo em làm gì tiếp theo đây ạ? 🤩');
});

// Lệnh /help
bot.command('help', async (ctx) => {
  const helpText = `📖 **HƯỚNG DẪN SỬ DỤNG OSIN TIỂU CƯỜNG:**

1. **Dạy học cho Bot (Bộ nhớ thông minh chống xung đột):**
   • Nhắn: *Ghi nhớ: [điều cần nhớ]*
   • Hoặc dùng lệnh: \`/learn [nội dung]\`
   • Nếu kiến thức mới mâu thuẫn với điều cũ, bot sẽ lập tức hỏi lại Ba Mỡ để chọn *Thay thế* hay *Giữ cả hai*.
   • Xem những gì bot đã nhớ: \`/sotay\`
   • Tải file sao lưu về máy: \`/backup\`
   • Xóa điều đã nhớ: \`/forget [mã số]\`

2. **Soi link mua hàng & Check giá thực tế:**
   • Gửi bất kỳ link Con Cưng, Shopee, KidsPlaza nào, bot sẽ tự cào giá niêm yết chuẩn đét!
   • Hỏi giá, quy cách hộp nhỏ, hộp lớn.

3. **Gửi hình ảnh:**
   Gửi 1 tấm ảnh kèm chú thích (caption), em sẽ soi kỹ và trả lời chi tiết.

4. **Trò chuyện & Chăm sóc Sếp Mỡ:**
   Cứ hỏi đáp tự nhiên, bot tự nhớ ngữ cảnh và áp dụng quy tắc đã học.

Chúc Ba Mẹ có những trải nghiệm thật tuyệt vời! 🚀`;
  await ctx.reply(helpText, { parse_mode: 'Markdown' });
});

// Bóc tách nội dung trích dẫn (Reply / Quote Reader) để AI hiểu trọn vẹn ngữ cảnh được reply
function extractQuotedMessage(ctx) {
  const reply = ctx.message?.reply_to_message;
  if (!reply) return '';

  let authorName = 'Thành viên';
  if (reply.from?.id === ctx.me?.id) {
    authorName = 'Tiểu Cường';
  } else if (reply.from?.first_name) {
    authorName = reply.from.first_name;
  }

  let quotedContent = '';
  if (reply.text) {
    quotedContent = reply.text;
  } else if (reply.caption) {
    quotedContent = reply.caption;
  } else if (reply.photo) {
    quotedContent = '[Hình ảnh]';
  } else if (reply.document) {
    quotedContent = `[Tài liệu: ${reply.document.file_name || 'file'}]`;
  } else if (reply.sticker) {
    quotedContent = '[Sticker biểu cảm]';
  } else {
    quotedContent = '[Nội dung tin nhắn cũ]';
  }

  return `[Đang trích dẫn tin nhắn của ${authorName}: "${quotedContent.trim()}"]\n`;
}

// Xử lý tin nhắn hình ảnh (Đồng bộ lưu vào Lịch sử trò chuyện để không bị đứt mạch ngữ cảnh)
bot.on(':photo', async (ctx) => {
  const isGroup = ctx.chat.type === 'group' || ctx.chat.type === 'supergroup';
  const botUsername = ctx.me.username;
  const caption = ctx.message.caption || '';
  const isMentioned = caption.toLowerCase().includes(`@${botUsername.toLowerCase()}`);
  const isReplyToBot = ctx.message.reply_to_message?.from?.id === ctx.me.id;

  // Trong nhóm: chỉ trả lời khi được tag @ hoặc bấm reply ảnh vào bot
  if (isGroup && !isMentioned && !isReplyToBot && caption) {
    return;
  }

  const sessionKey = getSessionKey(ctx);
  const userName = ctx.from.first_name || 'Sếp';
  const cleanCaption = caption.replace(new RegExp(`@${botUsername}`, 'gi'), '').trim() || 'Hãy phân tích chi tiết hình ảnh này giúp tôi.';

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

    const displayName = isGroup ? `Gia đình Sếp Mỡ (${ctx.chat.title || 'Nhóm'})` : userName;
    const chat = getOrCreateChat(sessionKey, displayName);
    const quotePrefix = extractQuotedMessage(ctx);
    const senderPrompt = isGroup ? `[${userName} vừa gửi 1 tấm ảnh kèm chú thích]: ${cleanCaption}` : cleanCaption;
    const finalPhotoPrompt = `${quotePrefix}${senderPrompt}`;

    const result = await chat.sendMessage({
      message: [
        { text: finalPhotoPrompt },
        {
          inlineData: {
            data: base64Data,
            mimeType: 'image/jpeg'
          }
        }
      ]
    });

    clearInterval(typingInterval);
    const replyText = result.text || 'Dạ, em đã xem ảnh nhưng chưa tìm thấy câu trả lời phù hợp ạ!';

    // Lưu vào lịch sử trò chuyện bền vững trên đĩa cứng
    chatHistoryManager.appendChatTurn(sessionKey, 'user', `${finalPhotoPrompt} [Kèm 1 hình ảnh]`);
    chatHistoryManager.appendChatTurn(sessionKey, 'model', replyText);

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

  const sessionKey = getSessionKey(ctx);
  const userId = ctx.from.id;
  const userName = ctx.from.first_name || 'Sếp';
  const sessionCtx = getSessionContext(sessionKey);

  console.log(`📩 [${new Date().toLocaleTimeString('vi-VN')}] Nhận tin từ ${userName} (${isGroup ? `Nhóm ${ctx.chat.id}` : 'Chat riêng'}): "${cleanText}"`);

  // 0. Kiểm tra nếu phiên này đang có yêu cầu giải quyết xung đột bộ nhớ
  if (pendingConflicts.has(sessionKey)) {
    const pending = pendingConflicts.get(sessionKey);
    const low = cleanText.toLowerCase();

    if (low === 'thay thế' || low === 'thay the' || low === 'đồng ý thay thế' || low === 'dong y thay the') {
      const updated = memoryManager.updateMemory(pending.conflictId, pending.newKnowledge, pending.topic);
      pendingConflicts.delete(sessionKey);
      getOrCreateChat(sessionKey, userName, true);
      return await ctx.reply(
        `✅ **Dạ, Tiểu Cường đã THAY THẾ thành công mục #${pending.conflictId}!**\n\n` +
        `📌 **Nội dung mới:** "${updated.content}"\n\n` +
        `Sổ tay đã được làm mới chuẩn xác theo lệnh của Ba Mỡ rồi ạ! 🙇‍♂️`,
        { parse_mode: 'Markdown' }
      );
    }

    if (low === 'giữ cả hai' || low === 'giu ca hai' || low === 'lưu cả hai') {
      const added = memoryManager.addMemory(pending.newKnowledge, pending.topic);
      pendingConflicts.delete(sessionKey);
      getOrCreateChat(sessionKey, userName, true);
      return await ctx.reply(
        `✅ **Dạ, Tiểu Cường đã lưu thêm thành mục mới #${added.id} [${added.topic}]!**\n\n` +
        `📌 **Mục mới:** "${added.content}"\n` +
        `📌 **Mục cũ (#${pending.conflictId}):** Vẫn được giữ nguyên vẹn song song ạ!`,
        { parse_mode: 'Markdown' }
      );
    }

    if (low === 'hủy' || low === 'huy' || low === 'bỏ qua') {
      pendingConflicts.delete(sessionKey);
      return await ctx.reply(`👌 Dạ, Tiểu Cường đã hủy yêu cầu cập nhật. Điều cũ (#${pending.conflictId}) vẫn được giữ nguyên vẹn 100% ạ!`);
    }
  }

  // 1. Nhận diện tự động nếu người dùng muốn dạy kiến thức rõ ràng
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
      return await handleTeachKnowledge(ctx, sessionKey, userName, knowledge);
    }
  }

  // 2. Tra cứu Dữ liệu Trực tiếp (Tỷ giá ngoại tệ hoặc Web Search)
  let promptToSend = cleanText;
  let fxBlock = '';
  let directUrlBlock = '';
  let searchBlock = '';

  // A. Tra cứu TỶ GIÁ NGOẠI TỆ THEO THỜI GIAN THỰC (USD, EUR, JPY...)
  const currencyKeywords = ['usd', 'đô la', 'đô mỹ', 'đô', 'tỷ giá', 'ngoại tệ', 'eur', 'euro', 'jpy', 'yên', 'tiền việt', 'vnd', 'quy đổi', 'đổi tiền'];
  const isCurrencyQuery = currencyKeywords.some(ck => cleanText.toLowerCase().includes(ck));

  // Nhận diện phản hồi nghi vấn hoặc yêu cầu tính lại ("sai rồi", "tính lại", "check lại", "thật không")
  const doubtKeywords = ['sai rồi', 'sai roi', 'tính lại', 'tinh lai', 'check lại', 'check lai', 'xem lại', 'thật không', 'chính xác chưa', 'đúng không', 'bậy rồi', 'bậy'];
  const isDoubtQuery = doubtKeywords.some(dk => cleanText.toLowerCase().includes(dk));

  if (isCurrencyQuery || (isDoubtQuery && sessionCtx.lastSubject === 'currency')) {
    console.log(`💵 [Live FX Rate] Đang lấy tỷ giá liên ngân hàng cho: "${cleanText}"...`);
    const fxInfo = await getLiveExchangeRate(cleanText);
    if (fxInfo) {
      sessionCtx.lastSubject = 'currency';
      fxBlock = formatExchangeRate(fxInfo);
      console.log(`💵 [Live FX Rate] 1 ${fxInfo.base} = ${fxInfo.formattedRate} VNĐ`);
    }
  }

  // B. Bóc tách nội dung nếu có link URL
  const detectedUrls = extractUrls(cleanText);
  if (detectedUrls.length > 0) {
    try {
      console.log(`🔗 [URL Scraper] Phát hiện link từ Sếp: ${detectedUrls[0]}`);
      const pageInfo = await fetchUrlContent(detectedUrls[0]);
      if (pageInfo && !pageInfo.error) {
        directUrlBlock = formatUrlContent(pageInfo);
        console.log(`✅ [URL Scraper] Đã đọc thành công: "${pageInfo.title}", Giá: ${pageInfo.price}`);
      }
    } catch (e) {
      console.warn('⚠️ Lỗi đọc link trực tiếp:', e.message);
    }
  }

  // C. Tra cứu Internet sản phẩm / giá cả nếu cần
  const searchKeywords = [
    'giá', 'mua ở đâu', 'link mua', 'link', 'so sánh giá', 'bao nhiêu tiền',
    'ở đâu bán', 'tìm kiếm', 'tra cứu', 'hôm nay', 'tin tức', 'thời tiết',
    'shopee', 'lazada', 'tiki', 'con cưng', 'bibomart', 'kidsplaza', 'khuyến mãi', 'sale',
    'hộp nhỏ', 'hộp lớn', 'lon', '380g', '800g', '900g', 'mấy lạng', 'quy cách'
  ];
  const isSearchNeeded = searchKeywords.some(kw => cleanText.toLowerCase().includes(kw)) || (isDoubtQuery && sessionCtx.lastSubject === 'product');

  if (isSearchNeeded && !fxBlock) {
    try {
      sessionCtx.lastSubject = 'product';
      let searchQuery = cleanText;
      const hasBrand = ['aptamil', 'similac', 'meiji', 'nan', 'colosbaby', 'sữa', 'bỉm', 'tã', 'd3k2'].some(b => cleanText.toLowerCase().includes(b));
      if (!hasBrand && sessionCtx.lastProduct) {
        searchQuery = `${sessionCtx.lastProduct} ${cleanText}`;
        console.log(`🔍 [Context Search] Đã ghép ngữ cảnh vào truy vấn: "${searchQuery}"`);
      }

      console.log(`🌐 [Web Search] Đang tra cứu Internet cho: "${searchQuery}"...`);
      const searchResults = await searchWeb(searchQuery);

      if (searchResults && searchResults.length > 0) {
        searchBlock = formatSearchResults(searchResults);
        console.log(`🌐 [Web Search] Đã lấy được ${searchResults.length} kết quả thực tế.`);

        if (!directUrlBlock) {
          const topShop = searchResults.find(r => r.url.includes('concung.com') || r.url.includes('kidsplaza.vn'));
          if (topShop) {
            try {
              console.log(`🛒 [Direct Shop Check] Đang quét lấy giá từ: ${topShop.url}...`);
              const shopData = await fetchUrlContent(topShop.url);
              if (shopData && shopData.price && !shopData.error) {
                directUrlBlock = formatUrlContent(shopData);
              }
            } catch (err) {
              console.warn('⚠️ Lỗi quét link shop:', err.message);
            }
          }
        }
      }
    } catch (e) {
      console.warn('⚠️ Lỗi tra cứu web:', e.message);
    }
  }

  // D. Nhận diện tự động và lưu ngầm mốc phát triển của Sếp Mỡ (Auto-Learn Context)
  let autoLearnedNote = '';
  const weightMatch = cleanText.match(/(?:cân|nặng|kí|kg)\s*(?:được|là|tầm)?\s*(\d+(?:[.,]\d+)?)\s*(?:kg|kí|cân)/i);
  if (weightMatch) {
    const weightVal = weightMatch[1].replace(',', '.');
    if (parseFloat(weightVal) >= 3 && parseFloat(weightVal) <= 15) {
      const todayStr = new Date().toLocaleDateString('vi-VN');
      memoryManager.addMemory(`Mốc cân nặng Sếp Mỡ: ${weightVal} kg (Ghi nhận ngày ${todayStr})`, 'Thể trạng & Cân nặng Sếp Mỡ');
      autoLearnedNote = `\n\n💡 *(Tiểu Cường đã tự động ghi nhớ mốc cân nặng **${weightVal} kg** của Sếp Mỡ vào sổ tay theo dõi rồi nha Ba Mẹ!)*`;
    }
  }

  // Ghép toàn bộ dữ liệu thực tế vào Prompt gửi cho Gemini
  if (fxBlock || directUrlBlock || searchBlock) {
    promptToSend = `${cleanText}\n${fxBlock}${directUrlBlock}${searchBlock}\n(CHÚ Ý BẮT BUỘC TỪ HỆ THỐNG: Bạn PHẢI dựa 100% vào dữ liệu thực tế ở trên để trả lời. TUYỆT ĐỐI CẤM TỰ BỊA GIÁ TIỀN, TỶ GIÁ HAY THÔNG SỐ. Phép tính phải ghi rõ: [Số tiền] x [Tỷ giá] = [Kết quả]).`;
  }

  // Bóc tách nội dung trích dẫn (nếu người dùng bấm Reply tin nhắn cũ)
  const quotePrefix = extractQuotedMessage(ctx);

  // Trong nhóm: Gắn nhãn tên người nói để AI nhận biết người đang tương tác
  const senderPrefix = isGroup ? `[${userName}]: ` : '';
  const finalPromptForAI = `${quotePrefix}${senderPrefix}${promptToSend}`;

  // 3. Trò chuyện thông thường qua Gemini
  let typingInterval = setInterval(() => {
    ctx.replyWithChatAction('typing').catch(() => {});
  }, 4000);
  await ctx.replyWithChatAction('typing').catch(() => {});

  try {
    console.log(`🤖 Đang gửi câu hỏi cho Gemini AI (Phiên: ${sessionKey})...`);
    const displayName = isGroup ? `Gia đình Sếp Mỡ (${ctx.chat.title || 'Nhóm'})` : userName;
    const chat = getOrCreateChat(sessionKey, displayName);
    const response = await chat.sendMessage({ message: finalPromptForAI });
    clearInterval(typingInterval);

    const baseReply = response.text || 'Dạ, Tiểu Cường đã ghi nhận ý Sếp!';
    const replyText = `${baseReply}${autoLearnedNote}`;

    // Lưu vào lịch sử trò chuyện bền vững trên đĩa cứng
    chatHistoryManager.appendChatTurn(sessionKey, 'user', finalPromptForAI);
    chatHistoryManager.appendChatTurn(sessionKey, 'model', replyText);

    console.log(`✅ Gemini phản hồi thành công (${replyText.length} ký tự). Đang gửi về Telegram...`);
    await sendLongMessage(ctx, replyText);
    console.log(`📤 Đã gửi tin nhắn cho Sếp thành công!`);

  } catch (err) {
    clearInterval(typingInterval);
    console.error('❌ Lỗi xử lý tin nhắn:', err);

    if (err.message && (err.message.includes('429') || err.message.includes('quota'))) {
      await ctx.reply('Dạ Sếp ơi, Google đang tạm nghẽn một chút do nhiều người gọi quá (hạn mức tạm thời). Sếp đợi em khoảng 10-15 giây rồi nhắn lại nhé! 🙇‍♂️').catch(() => {});
    } else {
      userSessions.delete(sessionKey);
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
