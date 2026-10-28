const fs = require('fs');
const path = require('path');

const MEMORY_FILE = path.join(__dirname, 'memory.json');

// Trả về đường dẫn file bộ nhớ duy nhất ở thư mục gốc
function getPrimaryMemoryFile() {
  return MEMORY_FILE;
}

// Đọc danh sách kiến thức từ đĩa
function loadMemories() {
  try {
    if (!fs.existsSync(MEMORY_FILE)) {
      fs.writeFileSync(MEMORY_FILE, '[]', 'utf8');
      return [];
    }
    const raw = fs.readFileSync(MEMORY_FILE, 'utf8');
    const data = JSON.parse(raw);
    return Array.isArray(data) ? data : [];
  } catch (err) {
    console.error('❌ Lỗi đọc file memory.json:', err.message);
    return [];
  }
}

// Lưu danh sách kiến thức vào duy nhất 1 file memory.json ở thư mục gốc
function saveMemories(memories) {
  try {
    const jsonStr = JSON.stringify(memories, null, 2);
    fs.writeFileSync(MEMORY_FILE, jsonStr, 'utf8');
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

// Kiểm tra câu hỏi của người dùng có thực sự cần đến Sổ tay riêng của bé Mỡ không (Intent Gate)
function shouldRetrievePersonalMemories(userPrompt = '') {
  if (!userPrompt || typeof userPrompt !== 'string') return false;
  const low = userPrompt.toLowerCase();
  
  // Các từ khóa kích hoạt hồ sơ riêng của Sếp Mỡ, gia đình và sổ tay dặn dò
  const personalKeywords = [
    'bé mỡ', 'sếp mỡ', 'boss mỡ', 'con mỡ', 'bé nhà mình', 'con nhà mình', 'con tôi', 'con em', 'con bé',
    'ba mỡ', 'mẹ mỡ', 'hữu tài', 'yến oanh', 'nguyentai_1202', 'me_bemo', 'gia đình', 'ba mẹ', 'thành viên', 'nhà mình',
    'sữa của mỡ', 'cữ bú', 'thói quen của mỡ', 'bệnh của mỡ', 'đổi sữa cho mỡ', 'cân nặng', 'thể trạng',
    'sổ tay', 'dặn dò', 'lưu ý riêng', 'ghi nhớ', 'nhớ', 'quên', 'đã học', 'dạy'
  ];
  
  return personalKeywords.some(kw => low.includes(kw));
}

// Bóc tách toàn bộ mẩu kiến thức trong sổ tay riêng để nạp động vào lượt chat đó (Dynamic In-Context Injection)
function getRelevantMemories(userPrompt = '') {
  if (!shouldRetrievePersonalMemories(userPrompt)) {
    return ''; // CỔNG ĐÓNG 100%: Hoàn toàn không nạp sổ tay nếu câu hỏi là khách quan ngoài đời!
  }

  const memories = loadMemories();
  if (memories.length === 0) return '';

  let text = '\n[TOÀN BỘ SỔ TAY KIẾN THỨC & HỒ SƠ GIA ĐÌNH BÉ MỠ (NẠP ĐỘNG VÌ CÂU HỎI LIÊN QUAN ĐẾN GIA ĐÌNH/BÉ/SỔ TAY)]:\n';
  memories.forEach((m) => {
    text += `• #${m.id} [${m.topic}]: ${m.content}\n`;
  });
  return text;
}

// Định dạng kiến thức để đưa vào System Prompt cho Gemini (Hồ sơ riêng của Sếp Mỡ)
function formatMemoriesForPrompt() {
  return ''; // Không còn nạp cứng toàn bộ vào System Prompt để tránh hiện tượng ngáo / chiếm đoạt ngữ cảnh
}

// Trích xuất các quy tắc ứng xử, thói quen riêng do Sếp dặn để nạp vào System Prompt toàn cục (áp dụng cho cả Nhóm và Chat riêng)
function getBehavioralRules() {
  const memories = loadMemories();
  if (!Array.isArray(memories) || memories.length === 0) return '';

  const ruleTopicRegex = /thói quen|quy tắc|ứng xử|dặn dò|lưu ý|hành vi|phục vụ/i;
  const ruleContentRegex = /không tự|tuyệt đối|khi nào|chưa được yêu cầu|xưng hô|quy tắc|phân tích ảnh|chỉ dạ thưa/i;

  const behavioral = memories.filter(m => 
    ruleTopicRegex.test(m.topic || '') || ruleContentRegex.test(m.content || '')
  );

  if (behavioral.length === 0) return '';

  let text = '\n## MODULE QUY TẮC ỨNG XỬ & THÓI QUEN RIÊNG DO SẾP DẶN (ÁP DỤNG BẮT BUỘC MỌI PHIÊN CHAT CẢ NHÓM VÀ RIÊNG):\n';
  behavioral.forEach(b => {
    text += `- [${b.topic}]: ${b.content}\n`;
  });
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
  shouldRetrievePersonalMemories,
  getRelevantMemories,
  getBehavioralRules,
  formatMemoriesForPrompt,
  formatMemoriesForUser
};
