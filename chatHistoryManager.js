const fs = require('fs');
const path = require('path');

const SUB_HISTORY_FILE = path.join(__dirname, 'data', 'chat_history.json');
const ROOT_HISTORY_FILE = path.join(__dirname, 'chat_history.json');
const MAX_MESSAGES_PER_SESSION = 40;

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
      if (!fs.existsSync(path.join(__dirname, 'data'))) {
        fs.mkdirSync(path.join(__dirname, 'data'), { recursive: true });
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

// Chuẩn hóa và làm sạch lịch sử trò chuyện theo đúng chuẩn luân phiên của Gemini API
// Quy tắc Gemini: Bắt đầu bằng 'user', luân phiên 'user' <-> 'model', và kết thúc bằng 'model' (để sẵn sàng đón tin nhắn 'user' mới)
function sanitizeGeminiHistory(rawList) {
  if (!Array.isArray(rawList) || rawList.length === 0) return [];

  // 1. Gom nhóm các tin nhắn liên tiếp cùng role để tránh lỗi liên tiếp 2 tin user hoặc 2 tin model
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

// Lấy danh sách lịch sử theo định dạng chuẩn của Gemini chats (parts array)
function getSessionHistoryForGemini(sessionKey) {
  const all = loadAllHistories();
  const sessionList = all[sessionKey] || [];
  return sanitizeGeminiHistory(sessionList);
}

// Thêm tin nhắn vào lịch sử và lưu đĩa
function appendChatTurn(sessionKey, role, text) {
  if (!text || typeof text !== 'string') return;
  const all = loadAllHistories();
  if (!all[sessionKey]) {
    all[sessionKey] = [];
  }

  all[sessionKey].push({
    role: role === 'user' ? 'user' : 'model',
    text: text.trim(),
    timestamp: new Date().toISOString()
  });

  // Giới hạn số lượng tin nhắn gần nhất để không làm nặng dữ liệu
  if (all[sessionKey].length > MAX_MESSAGES_PER_SESSION) {
    all[sessionKey] = all[sessionKey].slice(-MAX_MESSAGES_PER_SESSION);
  }

  saveAllHistories(all);
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
  clearSessionHistory
};
