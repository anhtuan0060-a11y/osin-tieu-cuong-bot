const fs = require('fs');
const path = require('path');

const SUB_MEMORY_FILE = path.join(__dirname, 'data', 'memory.json');
const ROOT_MEMORY_FILE = path.join(__dirname, 'memory.json');

// Tìm đường dẫn file bộ nhớ khả dụng nhất (hỗ trợ cả Render khi file ở root hoặc ở data/)
function getPrimaryMemoryFile() {
  if (fs.existsSync(SUB_MEMORY_FILE)) return SUB_MEMORY_FILE;
  if (fs.existsSync(ROOT_MEMORY_FILE)) return ROOT_MEMORY_FILE;
  return SUB_MEMORY_FILE;
}

// Đọc danh sách kiến thức từ đĩa
function loadMemories() {
  try {
    let target = getPrimaryMemoryFile();
    if (!fs.existsSync(target)) {
      if (fs.existsSync(ROOT_MEMORY_FILE)) target = ROOT_MEMORY_FILE;
      else if (fs.existsSync(SUB_MEMORY_FILE)) target = SUB_MEMORY_FILE;
      else {
        const dataDir = path.join(__dirname, 'data');
        if (!fs.existsSync(dataDir)) {
          fs.mkdirSync(dataDir, { recursive: true });
        }
        fs.writeFileSync(SUB_MEMORY_FILE, '[]', 'utf8');
        return [];
      }
    }
    const raw = fs.readFileSync(target, 'utf8');
    const data = JSON.parse(raw);
    return Array.isArray(data) ? data : [];
  } catch (err) {
    console.error('❌ Lỗi đọc file memory.json:', err.message);
    return [];
  }
}

// Lưu danh sách kiến thức đồng bộ vào CẢ HAI nơi để Render và Git không bao giờ lệch
function saveMemories(memories) {
  try {
    const jsonStr = JSON.stringify(memories, null, 2);

    // 1. Lưu vào thư mục con data/memory.json
    try {
      const dataDir = path.join(__dirname, 'data');
      if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
      }
      fs.writeFileSync(SUB_MEMORY_FILE, jsonStr, 'utf8');
    } catch (e1) {
      console.warn('⚠️ Lỗi ghi data/memory.json:', e1.message);
    }

    // 2. Lưu vào thư mục gốc ./memory.json
    try {
      fs.writeFileSync(ROOT_MEMORY_FILE, jsonStr, 'utf8');
    } catch (e2) {
      console.warn('⚠️ Lỗi ghi ./memory.json:', e2.message);
    }

    return true;
  } catch (err) {
    console.error('❌ Lỗi ghi file memory.json:', err.message);
    return false;
  }
}

// Thêm một kiến thức mới
function addMemory(content, topic = 'Kiến thức Sếp dạy') {
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

// Cập nhật thay thế một kiến thức đã có theo ID
function updateMemory(id, newContent, topic = null) {
  const memories = loadMemories();
  const item = memories.find(m => m.id === Number(id));
  if (!item) return null;
  item.content = newContent.trim();
  item.updatedAt = new Date().toISOString();
  if (topic) item.topic = topic;
  saveMemories(memories);
  return item;
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

// Kiểm tra xung đột logic giữa kiến thức mới và kiến thức đã lưu bằng Gemini
async function checkMemoryConflict(ai, newKnowledge) {
  const memories = loadMemories();
  if (memories.length === 0) {
    return { hasConflict: false, suggestedTopic: 'Kiến thức Sếp dạy' };
  }

  const memoryContext = memories.map(m => `#${m.id} [${m.topic}]: ${m.content}`).join('\n');
  const prompt = `Bạn là hệ thống kiểm tra logic và chống xung đột kiến thức cho trợ lý ảo bảo mẫu.
Nhiệm vụ: So sánh "KIẾN THỨC MỚI" với "DANH SÁCH KIẾN THỨC ĐÃ LƯU" để xem có sự mâu thuẫn, xung đột hoặc thay thế trực tiếp nào không.

DANH SÁCH KIẾN THỨC ĐÃ LƯU:
${memoryContext}

KIẾN THỨC MỚI CẦN HỌC:
"${newKnowledge}"

HÃY ĐÁNH GIÁ:
1. Nếu KIẾN THỨC MỚI mâu thuẫn trực tiếp hoặc thay đổi thông số/quy tắc của một mục cũ (Ví dụ: mục cũ dặn pha sữa 40°C, mục mới dặn 70°C; mục cũ dùng Aptamil, mục mới đổi sang sữa khác; mục cũ cấm nằm gối dốc xuyên đêm, mục mới cho nằm...), hãy xác định là CONFLICT.
2. Nếu KIẾN THỨC MỚI là bổ sung, làm rõ thêm, hoặc một chủ đề mới không va chạm với mục cũ, hãy xác định là NEW.

TRẢ VỀ KẾT QUẢ DUY NHẤT LÀ 1 ĐOẠN JSON (không thêm markdown hoặc giải thích ngoài):
{
  "hasConflict": true hoặc false,
  "conflictId": null hoặc số ID mục cũ bị xung đột,
  "oldContent": null hoặc chuỗi nội dung mục cũ,
  "reason": null hoặc giải thích ngắn gọn lý do xung đột,
  "suggestedTopic": "Dinh dưỡng & Sữa / Giấc ngủ & Sinh hoạt / Y tế & Cấp cứu / Thói quen riêng / Mua sắm"
}`;

  try {
    const res = await ai.models.generateContent({
      model: 'gemini-flash-lite-latest',
      contents: prompt
    });
    const text = (res.text || '').replace(/```json/gi, '').replace(/```/g, '').trim();
    const parsed = JSON.parse(text);
    return parsed;
  } catch (err) {
    console.warn('⚠️ Lỗi phân tích xung đột bộ nhớ:', err.message);
    return { hasConflict: false, suggestedTopic: 'Kiến thức Sếp dạy' };
  }
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

// Định dạng danh sách để hiển thị cho người dùng xem trên Telegram (/sotay)
function formatMemoriesForUser() {
  const memories = loadMemories();
  if (memories.length === 0) {
    return '📭 Sổ tay kiến thức hiện đang trống! Sếp có thể dạy em bằng cách nhắn: /learn [nội dung] hoặc nhắn "Ghi nhớ: [nội dung]" nhé!';
  }

  let text = `🧠 **SỔ TAY KIẾN THỨC VĨNH VIỄN CỦA TIỂU CƯỜNG (${memories.length} mục):**\n\n`;
  memories.forEach((m) => {
    text += `🔹 **#${m.id}** [${m.topic}]\n📝 ${m.content}\n\n`;
  });
  text += '💡 *Để dạy thêm: nhắn "Ghi nhớ: [nội dung]" hoặc /learn [nội dung]*\n';
  text += '🗑️ *Để xóa một mục: gõ lệnh /forget [mã số]*\n';
  text += '📦 *Để tải file sao lưu: gõ lệnh /backup*';
  return text;
}

module.exports = {
  getPrimaryMemoryFile,
  loadMemories,
  saveMemories,
  addMemory,
  updateMemory,
  deleteMemory,
  checkMemoryConflict,
  formatMemoriesForPrompt,
  formatMemoriesForUser
};
