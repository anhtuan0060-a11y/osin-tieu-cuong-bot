const fs = require('fs');
const path = require('path');

const MEMORY_FILE = path.join(__dirname, 'data', 'memory.json');

// Đảm bảo thư mục data tồn tại
if (!fs.existsSync(path.join(__dirname, 'data'))) {
  fs.mkdirSync(path.join(__dirname, 'data'), { recursive: true });
}

// Đọc danh sách kiến thức
function loadMemories() {
  try {
    if (!fs.existsSync(MEMORY_FILE)) {
      fs.writeFileSync(MEMORY_FILE, '[]', 'utf8');
      return [];
    }
    const raw = fs.readFileSync(MEMORY_FILE, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    console.error('❌ Lỗi đọc file memory.json:', err);
    return [];
  }
}

// Lưu danh sách kiến thức vào đĩa
function saveMemories(memories) {
  try {
    fs.writeFileSync(MEMORY_FILE, JSON.stringify(memories, null, 2), 'utf8');
    return true;
  } catch (err) {
    console.error('❌ Lỗi ghi file memory.json:', err);
    return false;
  }
}

// Thêm một kiến thức mới
function addMemory(content, topic = 'Kiến thức & Lưu ý') {
  const memories = loadMemories();
  const nextId = memories.length > 0 ? Math.max(...memories.map(m => m.id || 0)) + 1 : 1;
  const newEntry = {
    id: nextId,
    createdAt: new Date().toISOString(),
    topic: topic,
    content: content.trim()
  };
  memories.push(newEntry);
  saveMemories(memories);
  return newEntry;
}

// Xóa một kiến thức theo ID
function deleteMemory(id) {
  const memories = loadMemories();
  const filtered = memories.filter(m => m.id !== Number(id));
  if (filtered.length !== memories.length) {
    saveMemories(filtered);
    return true;
  }
  return false;
}

// Định dạng kiến thức để đưa vào System Prompt cho Gemini
function formatMemoriesForPrompt() {
  const memories = loadMemories();
  if (memories.length === 0) return '';

  let text = '\n\n=== [SỔ TAY KIẾN THỨC VĨNH VIỄN BẠN ĐÃ ĐƯỢC DẠY (BẮT BUỘC TUÂN THỦ)] ===\n';
  memories.forEach((m, idx) => {
    text += `${idx + 1}. [${m.topic}]: ${m.content}\n`;
  });
  text += '=========================================================================\n';
  return text;
}

// Định dạng danh sách để hiển thị cho người dùng xem trên Telegram
function formatMemoriesForUser() {
  const memories = loadMemories();
  if (memories.length === 0) {
    return '📭 Sổ tay kiến thức hiện đang trống! Sếp có thể dạy em bằng cách nhắn: /learn [nội dung] hoặc nhắn "Ghi nhớ: [nội dung]" nhé!';
  }

  let text = '🧠 **SỔ TAY KIẾN THỨC VĨNH VIỄN CỦA TIỂU CƯỜNG:**\n\n';
  memories.forEach((m) => {
    text += `🔹 **#${m.id}** [${m.topic}]\n📝 ${m.content}\n\n`;
  });
  text += '💡 *Để dạy thêm: nhắn "Ghi nhớ: [nội dung]" hoặc /learn [nội dung]*\n';
  text += '🗑️ *Để xóa một mục: gõ lệnh /forget [mã số]*';
  return text;
}

module.exports = {
  loadMemories,
  addMemory,
  deleteMemory,
  formatMemoriesForPrompt,
  formatMemoriesForUser
};
