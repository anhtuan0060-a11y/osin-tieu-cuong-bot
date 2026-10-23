const fs = require('fs');
const path = require('path');
const { GoogleGenAI } = require('@google/genai');
const { GEMINI_API_KEY } = require('./config');

const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

const SUB_HISTORY_FILE = path.join(__dirname, 'data', 'chat_history.json');
const ROOT_HISTORY_FILE = path.join(__dirname, 'chat_history.json');

// CẤU HÌNH CỬA SỔ BỘ NHỚ HỘI THOẠI (CONTEXT WINDOW ARCHITECTURE)
// 1. Lưu 20 lượt chat gần nhất = 40 tin nhắn (20 user + 20 model) nguyên văn 100%
const MAX_RECENT_MESSAGES = 40;
// 2. Ngưỡng kích hoạt nén ngữ cảnh cũ: Đạt 50 tin nhắn (= 25 lượt chat)
const COMPRESSION_TRIGGER = 50;
// 3. Số lượng tin nhắn cũ nhất sẽ nén mỗi lần: 10 tin nhắn (= 5 lượt chat)
// Sau khi nén: 50 - 10 = còn lại đúng 40 tin nhắn (20 lượt chat gần nhất)
const COMPRESSION_BATCH_SIZE = 10;
// 4. Giới hạn cứng phòng ngừa sự cố tràn bộ nhớ khi mất mạng API
const MAX_MESSAGES_HARD_LIMIT = 60;

// Tìm đường dẫn file lịch sử khả dụng
function getHistoryFile() {
  if (fs.existsSync(SUB_HISTORY_FILE)) return SUB_HISTORY_FILE;
  if (fs.existsSync(ROOT_HISTORY_FILE)) return ROOT_HISTORY_FILE;
  return SUB_HISTORY_FILE;
}

// Đọc toàn bộ lịch sử từ đĩa
function loadAllHistories() {
  try {
    let target = getHistoryFile();
    if (!fs.existsSync(target)) {
      if (fs.existsSync(ROOT_HISTORY_FILE)) target = ROOT_HISTORY_FILE;
      else if (fs.existsSync(SUB_HISTORY_FILE)) target = SUB_HISTORY_FILE;
      else {
        return {};
      }
    }
    const raw = fs.readFileSync(target, 'utf8');
    const data = JSON.parse(raw);
    return typeof data === 'object' && data !== null ? data : {};
  } catch (err) {
    console.warn('⚠️ Lỗi đọc chat_history.json:', err.message);
    return {};
  }
}

// Lưu đồng bộ lịch sử vào cả 2 file (data/chat_history.json và ./chat_history.json)
function saveAllHistories(allHistories) {
  try {
    const jsonStr = JSON.stringify(allHistories, null, 2);

    // 1. Ghi vào data/chat_history.json
    try {
      const dataDir = path.join(__dirname, 'data');
      if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
      }
      fs.writeFileSync(SUB_HISTORY_FILE, jsonStr, 'utf8');
    } catch (e1) {
      console.warn('⚠️ Lỗi ghi data/chat_history.json:', e1.message);
    }

    // 2. Ghi vào ./chat_history.json
    try {
      fs.writeFileSync(ROOT_HISTORY_FILE, jsonStr, 'utf8');
    } catch (e2) {
      console.warn('⚠️ Lỗi ghi ./chat_history.json:', e2.message);
    }

    return true;
  } catch (err) {
    console.warn('⚠️ Lỗi lưu chat_history.json:', err.message);
    return false;
  }
}

// Chuẩn hóa cấu trúc session: tương thích cả dạng mảng cũ lẫn object mới { summary, messages }
function getSessionData(all, sessionKey) {
  const raw = all[sessionKey];
  if (!raw) {
    return { summary: '', messages: [] };
  }
  if (Array.isArray(raw)) {
    return { summary: '', messages: raw };
  }
  return {
    summary: typeof raw.summary === 'string' ? raw.summary : '',
    messages: Array.isArray(raw.messages) ? raw.messages : []
  };
}

// Chuẩn hóa và làm sạch lịch sử trò chuyện theo đúng chuẩn luân phiên của Gemini API
function sanitizeGeminiHistory(rawList) {
  if (!Array.isArray(rawList) || rawList.length === 0) return [];

  // 1. Gom nhóm các tin nhắn liên tiếp cùng role để tránh lỗi
  const merged = [];
  for (const item of rawList) {
    if (!item || !item.text) continue;
    const role = item.role === 'model' ? 'model' : 'user';
    if (merged.length > 0 && merged[merged.length - 1].role === role) {
      merged[merged.length - 1].text += '\n' + item.text;
    } else {
      merged.push({ role, text: item.text });
    }
  }

  // 2. Lịch sử Gemini bắt buộc phải bắt đầu bằng tin nhắn của 'user'
  while (merged.length > 0 && merged[0].role !== 'user') {
    merged.shift();
  }

  // 3. Lịch sử trước khi gọi chat.sendMessage(userPrompt) phải kết thúc bằng 'model'
  while (merged.length > 0 && merged[merged.length - 1].role !== 'model') {
    merged.pop();
  }

  return merged.map(m => ({
    role: m.role,
    parts: [{ text: m.text }]
  }));
}

// Lấy danh sách lịch sử theo định dạng chuẩn của Gemini chats (tóm tắt bối cảnh cũ + 20 lượt gần nhất)
function getSessionHistoryForGemini(sessionKey) {
  const all = loadAllHistories();
  const sessionData = getSessionData(all, sessionKey);

  // Chỉ lấy tối đa 20 lượt gần nhất (40 tin nhắn) cho phần hội thoại nguyên văn
  const recentRaw = sessionData.messages.slice(-MAX_RECENT_MESSAGES);
  const sanitized = sanitizeGeminiHistory(recentRaw);

  const summary = sessionData.summary.trim();
  if (summary) {
    const summaryPrefix = [
      {
        role: 'user',
        parts: [{ text: `[Tóm tắt bối cảnh các cuộc trò chuyện trước đó]:\n${summary}\n\n(Lưu ý: Đây là bối cảnh nền tảng các thỏa thuận và sự kiện cũ. Với câu hỏi hiện tại, luôn ưu tiên tuyệt đối ngữ cảnh của các lượt chat gần nhất).` }]
      },
      {
        role: 'model',
        parts: [{ text: 'Dạ, Tiểu Cường đã ghi nhớ toàn bộ tóm tắt bối cảnh trao đổi trước đó của Sếp và sẵn sàng hỗ trợ tiếp tục!' }]
      }
    ];
    return [...summaryPrefix, ...sanitized];
  }

  return sanitized;
}

// Khóa chống xung đột khi gọi nén ngầm
const activeCompressions = new Set();
let onCompressionCompleteHandler = null;

function setOnCompressionComplete(handler) {
  if (typeof handler === 'function') {
    onCompressionCompleteHandler = handler;
  }
}

// Tiến trình nén ngữ cảnh cũ tự động bằng Gemini Flash
async function compressContextInBackground(sessionKey) {
  if (activeCompressions.has(sessionKey)) return;
  activeCompressions.add(sessionKey);

  try {
    const all = loadAllHistories();
    const sessionData = getSessionData(all, sessionKey);
    if (sessionData.messages.length < COMPRESSION_TRIGGER) {
      return;
    }

    const messagesToCompress = sessionData.messages.slice(0, COMPRESSION_BATCH_SIZE);
    const existingSummary = sessionData.summary || '';

    const formattedConversation = messagesToCompress.map(m => {
      const speaker = m.role === 'user' ? 'Sếp' : 'Tiểu Cường';
      return `${speaker}: ${m.text}`;
    }).join('\n---\n');

    const prompt = `Bạn là bộ phận quản lý trí nhớ dài hạn của trợ lý ảo Osin Tiểu Cường.
Dưới đây là một phần cuộc trò chuyện cũ giữa Sếp (người dùng) và Tiểu Cường (trợ lý) đã trôi qua khỏi cửa sổ ngữ cảnh trực tiếp 20 lượt gần nhất.

${existingSummary ? `[BẢN TÓM TẮT TRƯỚC ĐÓ]:\n${existingSummary}\n\n` : ''}[ĐOẠN HỘI THOẠI CŨ CẦN NÉN]:
${formattedConversation}

NHIỆM VỤ:
Hãy cập nhật hoặc tổng hợp lại bản tóm tắt súc tích (khoảng 3 đến 5 gạch đầu dòng ngắn gọn) lưu giữ:
1. Các quyết định, sự kiện, thỏa thuận đã chốt hoặc kết luận quan trọng (ví dụ: đã chọn sản phẩm gì, giá bao nhiêu, đã thống nhất điều gì, việc gì cần làm).
2. Thông tin cá nhân, thói quen hoặc sở thích được nhắc tới.
3. Tiến độ công việc hoặc chủ đề đang dang dở.
BỎ QUA các câu chào hỏi xã giao, cảm ơn, xin lỗi hoặc chi tiết vụn vặt không còn giá trị.
CHỈ TRẢ VỀ các gạch đầu dòng tóm tắt, không thêm bất kỳ lời dẫn hay chào hỏi nào khác.`;

    console.log(`🗜️ [Context Compression] Đang gọi Gemini nén ${COMPRESSION_BATCH_SIZE} tin nhắn cũ cho session ${sessionKey}...`);
    const response = await ai.models.generateContent({
      model: 'gemini-flash-lite-latest',
      contents: prompt
    });

    const newSummary = (response.text || '').trim();

    if (newSummary) {
      // Đọc lại dữ liệu tươi từ đĩa để không làm mất tin nhắn mới đến trong lúc nén
      const freshAll = loadAllHistories();
      const freshSession = getSessionData(freshAll, sessionKey);

      freshSession.summary = newSummary;
      freshSession.messages = freshSession.messages.slice(COMPRESSION_BATCH_SIZE);
      freshAll[sessionKey] = freshSession;

      saveAllHistories(freshAll);
      console.log(`✅ [Context Compression] Nén thành công! Còn lại ${freshSession.messages.length} tin nhắn nguyên văn và bản tóm tắt mới.`);

      if (typeof onCompressionCompleteHandler === 'function') {
        onCompressionCompleteHandler(sessionKey);
      }
    }
  } catch (err) {
    console.warn(`⚠️ [Context Compression] Lỗi khi nén ngữ cảnh session ${sessionKey}:`, err.message);
  } finally {
    activeCompressions.delete(sessionKey);
  }
}

// Thêm tin nhắn vào lịch sử và lưu đĩa
function appendChatTurn(sessionKey, role, text) {
  if (!text || typeof text !== 'string') return;
  const all = loadAllHistories();
  const sessionData = getSessionData(all, sessionKey);

  sessionData.messages.push({
    role: role === 'user' ? 'user' : 'model',
    text: text.trim(),
    timestamp: new Date().toISOString()
  });

  // Phòng ngừa sự cố quá tải cứng (nếu API tóm tắt tạm thời không khả dụng)
  if (sessionData.messages.length > MAX_MESSAGES_HARD_LIMIT) {
    sessionData.messages = sessionData.messages.slice(-MAX_RECENT_MESSAGES);
  }

  all[sessionKey] = sessionData;
  saveAllHistories(all);

  // Kích hoạt nén ngầm khi kết thúc lượt phản hồi của model và số tin nhắn đạt ngưỡng
  if (role === 'model' && sessionData.messages.length >= COMPRESSION_TRIGGER) {
    compressContextInBackground(sessionKey).catch(e => {
      console.warn('⚠️ Lỗi nén ngầm:', e.message);
    });
  }
}

// Xóa lịch sử khi người dùng gọi lệnh /reset
function clearSessionHistory(sessionKey) {
  const all = loadAllHistories();
  if (all[sessionKey]) {
    delete all[sessionKey];
    saveAllHistories(all);
  }
}

module.exports = {
  getSessionHistoryForGemini,
  appendChatTurn,
  clearSessionHistory,
  setOnCompressionComplete,
  compressContextInBackground
};
