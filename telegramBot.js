const { Bot, InputFile } = require('grammy');
const fetch = require('node-fetch');
const config = require('./config');
const memoryStore = require('./memoryStore');
const historyStore = require('./historyStore');
const { extractQuotedMessage } = require('./quoteReader');
const { ai, askGeminiAgent, getOrCreateChatSession, resetChatSession } = require('./geminiAgent');

// Khởi tạo Grammy Bot (Tự động chuyển đổi Cloud / Local)
const botConfig = config.isCloud
  ? {}
  : { client: { baseFetchConfig: { agent: config.customAgent } } };
const bot = new Bot(config.TELEGRAM_BOT_TOKEN, botConfig);

// Trả về khóa phiên duy nhất (Group: 'group_<id>', Chat riêng: 'user_<id>')
function getSessionKey(ctx) {
  const isGroup = ctx.chat.type === 'group' || ctx.chat.type === 'supergroup';
  return isGroup ? `group_${ctx.chat.id}` : `user_${ctx.from.id}`;
}

// Chia nhỏ tin nhắn nếu vượt quá 4096 ký tự của Telegram
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
      console.warn('⚠️ Lỗi format Markdown, gửi lại bằng text thuần:', err.message);
      await ctx.reply(chunk);
    }
  }
}

// Quản lý trạng thái chờ xác nhận xung đột bộ nhớ
const pendingConflicts = new Map();

// Hàm xử lý dạy kiến thức mới có kiểm tra xung đột logic thông minh
async function handleTeachKnowledge(ctx, sessionKey, userName, knowledge) {
  let typingInterval = setInterval(() => {
    ctx.replyWithChatAction('typing').catch(() => {});
  }, 4000);
  await ctx.replyWithChatAction('typing').catch(() => {});

  try {
    const check = await memoryStore.checkMemoryConflict(ai, knowledge);
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
    const added = memoryStore.addMemory(knowledge, topic);
    resetChatSession(sessionKey);
    console.log(`🧠 Đã lưu kiến thức mới #${added.id} [${added.topic}]: "${added.content}"`);

    historyStore.appendChatTurn(sessionKey, 'user', `[Dạy kiến thức]: ${knowledge}`);
    historyStore.appendChatTurn(sessionKey, 'model', `🧠 Dạ, Tiểu Cường đã ghi nhớ vĩnh viễn vào sổ tay mục #${added.id} [${added.topic}]: "${added.content}"`);

    return await ctx.reply(
      `🧠 **Dạ, Tiểu Cường đã ghi nhớ vĩnh viễn điều này vào sổ tay rồi ạ!**\n\n` +
      `📌 **Mục #${added.id} [${added.topic}]:** "${added.content}"\n\n` +
      `Em đã đối chiếu kiểm tra không thấy xung đột với các điều cũ. Em đã khắc sâu vào tiềm thức rồi nha Ba Mỡ! 🥰`,
      { parse_mode: 'Markdown' }
    );
  } catch (err) {
    clearInterval(typingInterval);
    console.error('❌ Lỗi khi học kiến thức mới:', err);
    const added = memoryStore.addMemory(knowledge, 'Kiến thức Sếp dạy');
    resetChatSession(sessionKey);
    historyStore.appendChatTurn(sessionKey, 'user', `[Dạy kiến thức]: ${knowledge}`);
    historyStore.appendChatTurn(sessionKey, 'model', `🧠 Dạ, Tiểu Cường đã ghi nhận vào sổ tay mục #${added.id}: "${added.content}"`);
    return await ctx.reply(
      `🧠 **Dạ, Tiểu Cường đã ghi nhận vào sổ tay rồi ạ!**\n\n📌 **Mục #${added.id}:** "${added.content}"`,
      { parse_mode: 'Markdown' }
    );
  }
}

// 1. Lệnh /start
bot.command('start', async (ctx) => {
  const sessionKey = getSessionKey(ctx);
  const userName = ctx.from.first_name || 'Sếp';
  getOrCreateChatSession(sessionKey, userName);

  const welcomeMessage = `👋 **Dạ, Osin Tiểu Cường xin kính chào Sếp ${userName}!** 🙇‍♂️

Em là trợ lý ảo AI cao cấp chạy bằng công nghệ **Google Gemini Agent**, đã được nâng cấp kiến trúc **TÁC NHÂN TỰ CHỦ (NATIVE FUNCTION CALLING)** & **BỘ NHỚ THÔNG MINH BỀN VỮNG**!

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

// 2. Lệnh /sotay hoặc /memory
bot.command(['sotay', 'memory'], async (ctx) => {
  const text = memoryStore.formatMemoriesForUser();
  await sendLongMessage(ctx, text);
});

// 3. Lệnh /learn hoặc /ghinho
bot.command(['learn', 'ghinho'], async (ctx) => {
  const content = ctx.match;
  if (!content || content.trim().length === 0) {
    return await ctx.reply('⚠️ Sếp ơi, Sếp hãy nhắn theo cú pháp: `/learn [nội dung cần dạy]` nhé!\nVí dụ: `/learn Sếp Mỡ thích nghe nhạc Ru con khi ngủ`', { parse_mode: 'Markdown' });
  }

  const sessionKey = getSessionKey(ctx);
  const userName = ctx.from.first_name || 'Sếp';
  await handleTeachKnowledge(ctx, sessionKey, userName, content.trim());
});

// 4. Lệnh /thaythe
bot.command('thaythe', async (ctx) => {
  const sessionKey = getSessionKey(ctx);
  if (!pendingConflicts.has(sessionKey)) return await ctx.reply('Dạ hiện tại không có xung đột nào đang chờ xử lý ạ!');
  const pending = pendingConflicts.get(sessionKey);
  const updated = memoryStore.updateMemory(pending.conflictId, pending.newKnowledge, pending.topic);
  pendingConflicts.delete(sessionKey);
  resetChatSession(sessionKey);
  historyStore.appendChatTurn(sessionKey, 'user', 'Thay thế điều cũ bằng điều mới');
  historyStore.appendChatTurn(sessionKey, 'model', `Đã thay thế thành công mục #${pending.conflictId}: "${updated.content}"`);
  await ctx.reply(`✅ **Dạ, Tiểu Cường đã THAY THẾ thành công mục #${pending.conflictId}!**\n\n📌 **Nội dung mới:** "${updated.content}"\n\nSổ tay đã được làm mới chuẩn chỉnh rồi nha Ba Mỡ! 🥰`, { parse_mode: 'Markdown' });
});

// 5. Lệnh /giucahai
bot.command('giucahai', async (ctx) => {
  const sessionKey = getSessionKey(ctx);
  if (!pendingConflicts.has(sessionKey)) return await ctx.reply('Dạ hiện tại không có xung đột nào đang chờ xử lý ạ!');
  const pending = pendingConflicts.get(sessionKey);
  const added = memoryStore.addMemory(pending.newKnowledge, pending.topic);
  pendingConflicts.delete(sessionKey);
  resetChatSession(sessionKey);
  historyStore.appendChatTurn(sessionKey, 'user', 'Giữ cả hai điều');
  historyStore.appendChatTurn(sessionKey, 'model', `Đã lưu thêm mục mới #${added.id}: "${added.content}"`);
  await ctx.reply(`✅ **Dạ, Tiểu Cường đã lưu thêm thành mục mới #${added.id} [${added.topic}] song song với mục cũ ạ!**`, { parse_mode: 'Markdown' });
});

// 6. Lệnh /huy
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

// 7. Lệnh /backup hoặc /export
bot.command(['backup', 'export'], async (ctx) => {
  const filePath = memoryStore.getPrimaryMemoryFile();
  if (!filePath) {
    return await ctx.reply('⚠️ Chưa có dữ liệu memory.json để backup Sếp ơi!');
  }
  await ctx.reply('📦 **Dạ, Tiểu Cường gửi ngay file sao lưu Sổ tay kiến thức (memory.json) cho Ba Mỡ cất giữ an toàn đây ạ:**', { parse_mode: 'Markdown' });
  await ctx.replyWithDocument(new InputFile(filePath, 'memory.json'));
});

// 8. Lệnh /forget
bot.command('forget', async (ctx) => {
  const id = ctx.match;
  if (!id || isNaN(id)) {
    return await ctx.reply('⚠️ Sếp vui lòng chỉ định mã số cần xóa, ví dụ: `/forget 2` (Gõ /sotay để xem danh sách mã số nhé).', { parse_mode: 'Markdown' });
  }

  const ok = memoryStore.deleteMemory(id);
  if (ok) {
    const sessionKey = getSessionKey(ctx);
    resetChatSession(sessionKey);
    await ctx.reply(`🗑️ Dạ, Tiểu Cường đã xóa mục #${id} khỏi sổ tay ghi nhớ rồi ạ!`);
  } else {
    await ctx.reply(`❌ Không tìm thấy mục mang mã số #${id} trong sổ tay Sếp ơi!`);
  }
});

// 9. Lệnh /reset hoặc /new
bot.command(['reset', 'new'], async (ctx) => {
  const sessionKey = getSessionKey(ctx);
  historyStore.clearSessionHistory(sessionKey);
  resetChatSession(sessionKey);
  await ctx.reply('🧹 Dạ, Tiểu Cường đã dọn dẹp sạch cuộc trò chuyện ngắn hạn cũ! Nhưng các kiến thức trong **Sổ tay vĩnh viễn** thì em vẫn nhớ 100% nha Sếp. Sếp muốn bảo em làm gì tiếp theo đây ạ? 🤩');
});

// 10. Lệnh /help
bot.command('help', async (ctx) => {
  const helpText = `📖 **HƯỚNG DẪN SỬ DỤNG OSIN TIỂU CƯỜNG:**

1. **Dạy học cho Bot (Bộ nhớ thông minh chống xung đột):**
   • Nhắn: *Ghi nhớ: [điều cần nhớ]*
   • Hoặc dùng lệnh: \`/learn [nội dung]\`
   • Nếu kiến thức mới mâu thuẫn với điều cũ, bot sẽ lập tức hỏi lại Ba Mỡ để chọn *Thay thế* hay *Giữ cả hai*.
   • Xem những gì bot đã nhớ: \`/sotay\`
   • Tải file sao lưu về máy: \`/backup\`
   • Xóa điều đã nhớ: \`/forget [mã số]\`

2. **Soi link mua hàng & Tra giá tự động (Agentic Tools):**
   • Cứ gửi link Shopee, Con Cưng, KidsPlaza hoặc hỏi giá bất kỳ, bot tự động kích hoạt Tool đọc web và cào giá chuẩn đét!
   • Hỏi tỷ giá ngoại tệ USD, EUR, JPY -> bot tự gọi Tool lấy tỷ giá thời gian thực từ ngân hàng.

3. **Gửi hình ảnh (Multimodal):**
   • Gửi 1 tấm ảnh kèm chú thích (caption), em sẽ soi kỹ và trả lời chi tiết.

4. **Trò chuyện & Chăm sóc Sếp Mỡ:**
   • Cứ hỏi đáp tự nhiên, bot tự nhớ ngữ cảnh và áp dụng quy tắc đã học.

Chúc Ba Mẹ có những trải nghiệm thật tuyệt vời! 🚀`;
  await ctx.reply(helpText, { parse_mode: 'Markdown' });
});

// 11. Xử lý tin nhắn hình ảnh
bot.on(':photo', async (ctx) => {
  const isGroup = ctx.chat.type === 'group' || ctx.chat.type === 'supergroup';
  const botUsername = ctx.me.username;
  const caption = ctx.message.caption || '';
  const isMentioned = caption.toLowerCase().includes(`@${botUsername.toLowerCase()}`);
  const isReplyToBot = ctx.message.reply_to_message?.from?.id === ctx.me.id;

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
    const fileUrl = `https://api.telegram.org/file/bot${config.TELEGRAM_BOT_TOKEN}/${file.file_path}`;

    const response = await fetch(fileUrl, { agent: config.customAgent });
    const buffer = await response.buffer();
    const base64Data = buffer.toString('base64');

    const displayName = isGroup ? `Gia đình Sếp Mỡ (${ctx.chat.title || 'Nhóm'})` : userName;
    const quotePrefix = extractQuotedMessage(ctx);
    const senderPrompt = isGroup ? `[${userName} vừa gửi 1 tấm ảnh kèm chú thích]: ${cleanCaption}` : cleanCaption;
    const finalPhotoPrompt = `${quotePrefix}${senderPrompt}`;

    const replyText = await askGeminiAgent(sessionKey, displayName, finalPhotoPrompt, base64Data);

    clearInterval(typingInterval);

    // Lưu vào lịch sử đĩa cứng
    historyStore.appendChatTurn(sessionKey, 'user', `${finalPhotoPrompt} [Kèm 1 hình ảnh]`);
    historyStore.appendChatTurn(sessionKey, 'model', replyText);

    await sendLongMessage(ctx, replyText);

  } catch (err) {
    clearInterval(typingInterval);
    console.error('❌ Lỗi xử lý ảnh:', err);
    await ctx.reply('Úi Sếp ơi, mắt em hôm nay hơi quáng gà nên chưa đọc được tấm ảnh này, Sếp gửi lại giúp em với nhé! 🥺');
  }
});

// 12. Xử lý tin nhắn văn bản thông thường
bot.on('message:text', async (ctx) => {
  const text = ctx.message.text;
  if (!text || text.startsWith('/')) return;

  const isGroup = ctx.chat.type === 'group' || ctx.chat.type === 'supergroup';
  const botUsername = ctx.me.username;
  const isMentioned = text.toLowerCase().includes(`@${botUsername.toLowerCase()}`);
  const isReplyToBot = ctx.message.reply_to_message?.from?.id === ctx.me.id;

  if (isGroup && !isMentioned && !isReplyToBot) {
    return;
  }

  const cleanText = text.replace(new RegExp(`@${botUsername}`, 'gi'), '').trim();
  if (!cleanText) return;

  const sessionKey = getSessionKey(ctx);
  const userName = ctx.from.first_name || 'Sếp';

  console.log(`📩 [${new Date().toLocaleTimeString('vi-VN')}] Nhận tin từ ${userName} (${isGroup ? `Nhóm ${ctx.chat.id}` : 'Chat riêng'}): "${cleanText}"`);

  // Xử lý xác nhận xung đột bộ nhớ
  if (pendingConflicts.has(sessionKey)) {
    const pending = pendingConflicts.get(sessionKey);
    const low = cleanText.toLowerCase();

    if (low === 'thay thế' || low === 'thay the' || low === 'đồng ý thay thế' || low === 'dong y thay the') {
      const updated = memoryStore.updateMemory(pending.conflictId, pending.newKnowledge, pending.topic);
      pendingConflicts.delete(sessionKey);
      resetChatSession(sessionKey);
      return await ctx.reply(
        `✅ **Dạ, Tiểu Cường đã THAY THẾ thành công mục #${pending.conflictId}!**\n\n` +
        `📌 **Nội dung mới:** "${updated.content}"\n\n` +
        `Sổ tay đã được làm mới chuẩn xác theo lệnh của Ba Mỡ rồi ạ! 🙇‍♂️`,
        { parse_mode: 'Markdown' }
      );
    }

    if (low === 'giữ cả hai' || low === 'giu ca hai' || low === 'lưu cả hai') {
      const added = memoryStore.addMemory(pending.newKnowledge, pending.topic);
      pendingConflicts.delete(sessionKey);
      resetChatSession(sessionKey);
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

  // Tự động nhận diện lệnh dạy kiến thức
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

  // Tự động nhận diện và lưu ngầm mốc cân nặng của Sếp Mỡ
  let autoLearnedNote = '';
  const weightMatch = cleanText.match(/(?:cân|nặng|kí|kg)\s*(?:được|là|tầm)?\s*(\d+(?:[.,]\d+)?)\s*(?:kg|kí|cân)/i);
  if (weightMatch) {
    const weightVal = weightMatch[1].replace(',', '.');
    if (parseFloat(weightVal) >= 3 && parseFloat(weightVal) <= 15) {
      const todayStr = new Date().toLocaleDateString('vi-VN');
      memoryStore.addMemory(`Mốc cân nặng Sếp Mỡ: ${weightVal} kg (Ghi nhận ngày ${todayStr})`, 'Thể trạng & Cân nặng Sếp Mỡ');
      autoLearnedNote = `\n\n💡 *(Tiểu Cường đã tự động ghi nhớ mốc cân nặng **${weightVal} kg** của Sếp Mỡ vào sổ tay theo dõi rồi nha Ba Mẹ!)*`;
    }
  }

  // Bóc tách nội dung trích dẫn (Quote Reader)
  const quotePrefix = extractQuotedMessage(ctx);
  const senderPrefix = isGroup ? `[${userName}]: ` : '';
  const finalPromptForAI = `${quotePrefix}${senderPrefix}${cleanText}`;

  let typingInterval = setInterval(() => {
    ctx.replyWithChatAction('typing').catch(() => {});
  }, 4000);
  await ctx.replyWithChatAction('typing').catch(() => {});

  try {
    console.log(`🤖 [Agent Dispatch] Đang gửi câu hỏi cho Gemini Agent (Phiên: ${sessionKey})...`);
    const displayName = isGroup ? `Gia đình Sếp Mỡ (${ctx.chat.title || 'Nhóm'})` : userName;

    const baseReply = await askGeminiAgent(sessionKey, displayName, finalPromptForAI);
    clearInterval(typingInterval);

    const replyText = `${baseReply}${autoLearnedNote}`;

    // Lưu vào lịch sử đĩa cứng bền vững
    historyStore.appendChatTurn(sessionKey, 'user', finalPromptForAI);
    historyStore.appendChatTurn(sessionKey, 'model', replyText);

    console.log(`✅ Agent phản hồi thành công (${replyText.length} ký tự). Đang gửi về Telegram...`);
    await sendLongMessage(ctx, replyText);
    console.log(`📤 Đã gửi tin nhắn cho Sếp thành công!`);

  } catch (err) {
    clearInterval(typingInterval);
    console.error('❌ Lỗi xử lý tin nhắn:', err);

    if (err.message && (err.message.includes('429') || err.message.includes('quota'))) {
      await ctx.reply('Dạ Sếp ơi, Google đang tạm nghẽn một chút do nhiều người gọi quá (hạn mức tạm thời). Sếp đợi em khoảng 10-15 giây rồi nhắn lại nhé! 🙇‍♂️').catch(() => {});
    } else {
      resetChatSession(sessionKey);
      await ctx.reply('Dạ Sếp ơi, vừa có chút chập điện trong mạch não AI của em, em đã tự khởi động lại rồi. Sếp nhắn lại câu vừa rồi giúp em nhé! 🙏').catch(() => {});
    }
  }
});

// Bắt lỗi toàn cục của Bot để không bao giờ dừng đột ngột khi xử lý tin nhắn
bot.catch((err) => {
  console.error('⚠️ Lỗi Grammy Bot:', err.error || err);
});

// Xử lý đóng kết nối êm ái khi Render cập nhật phiên bản mới (Zero-Downtime Graceful Handover)
let isShuttingDown = false;
const gracefulShutdown = async (signal) => {
  if (isShuttingDown) return;
  isShuttingDown = true;
  console.log(`🛑 [Graceful Shutdown] Nhận tín hiệu ${signal}. Đang đóng kết nối Telegram để bàn giao cho phiên bản mới...`);
  try {
    await bot.stop();
    console.log('✅ [Graceful Shutdown] Đã ngắt kết nối Telegram an toàn.');
  } catch (err) {
    console.warn('⚠️ Lỗi khi dừng bot:', err.message);
  }
  process.exit(0);
};

process.once('SIGINT', () => gracefulShutdown('SIGINT'));
process.once('SIGTERM', () => gracefulShutdown('SIGTERM'));

async function startBot(maxRetries = 10, retryDelayMs = 4000) {
  console.log('--------------------------------------------------');
  console.log('🤖 OSIN TIỂU CƯỜNG (@Osin_Tieu_Cuong_Bot) ĐANG KHỞI CHẠY...');
  console.log('🧠 KIẾN TRÚC AGENTIC AI (GEMINI NATIVE TOOLS): ĐÃ KÍCH HOẠT');
  console.log(`🌐 PORT HEALTH CHECK: ${config.PORT}`);
  console.log('--------------------------------------------------');

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`🚀 [Telegram Bot] Đang kết nối Telegram API (Lần thử ${attempt}/${maxRetries})...`);
      await bot.start({
        drop_pending_updates: false,
        onStart: (botInfo) => {
          console.log(`✅ [Telegram Bot] @${botInfo.username} đã kết nối thành công 24/7!`);
        }
      });
      break; // Bot dừng bình thường nếu có lệnh ngắt
    } catch (err) {
      const isConflict = err.error_code === 409 ||
        (err.message && (err.message.includes('409') || err.message.includes('Conflict') || err.message.includes('other getUpdates')));

      if (isConflict && attempt < maxRetries) {
        console.warn(`⚠️ [409 Conflict] Phiên bản cũ đang bàn giao kết nối Telegram. Đang đợi ${retryDelayMs / 1000}s để tiếp quản (Lần ${attempt}/${maxRetries})...`);
        await new Promise((res) => setTimeout(res, retryDelayMs));
      } else if (attempt < maxRetries) {
        console.warn(`⚠️ [Telegram Connect Error] ${err.message}. Đang thử lại sau ${retryDelayMs / 1000}s...`);
        await new Promise((res) => setTimeout(res, retryDelayMs));
      } else {
        console.error('❌ [Telegram Bot] Không thể kết nối Telegram sau nhiều lần thử:', err);
        process.exit(1);
      }
    }
  }
}

module.exports = {
  bot,
  startBot
};
