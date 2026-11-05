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

// Tính toán thông tin tuổi và tuần phát triển chuẩn y khoa của Sếp Mỡ theo thời gian thực
function getBabyCurrentAgeProfile() {
  const birthDate = new Date(2026, 6, 13); // 13/07/2026 (tháng 0-indexed: 6 = tháng 7)
  const now = new Date();
  
  const diffTime = Math.max(0, now.getTime() - birthDate.getTime());
  const totalDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
  const totalWeeks = Math.floor(totalDays / 7);
  const remainingDays = totalDays % 7;
  
  // Tính số tháng xấp xỉ
  let months = (now.getFullYear() - birthDate.getFullYear()) * 12 + (now.getMonth() - birthDate.getMonth());
  if (now.getDate() < birthDate.getDate()) {
    months = Math.max(0, months - 1);
  }

  // Xác định giai đoạn Wonder Week (tuần khủng hoảng phát triển trí não)
  let wonderWeekInfo = '';
  if (totalWeeks < 4) {
    wonderWeekInfo = 'Giai đoạn sơ sinh làm quen với môi trường bên ngoài.';
  } else if (totalWeeks >= 4 && totalWeeks <= 6) {
    wonderWeekInfo = 'Wonder Week 5 (Tuần 4 - 5): Bước nhảy vọt 1 - Thế giới của các cảm giác biến đổi.';
  } else if (totalWeeks >= 7 && totalWeeks <= 10) {
    wonderWeekInfo = 'Wonder Week 8 (Tuần 7 - 9): Bước nhảy vọt 2 - Thế giới của các mẫu hình & tri giác.';
  } else if (totalWeeks >= 11 && totalWeeks <= 14) {
    wonderWeekInfo = 'Wonder Week 12 (Tuần 11 - 13): Bước nhảy vọt 3 - Thế giới của những chuyển tiếp êm ái.';
  } else if (totalWeeks >= 15 && totalWeeks <= 20) {
    wonderWeekInfo = 'Wonder Week 19 (Tuần 15 - 19): Bước nhảy vọt 4 - Thế giới của các chuỗi sự kiện, lẫy thành thạo, hóng chuyện, hiểu khoảng cách.';
  } else if (totalWeeks >= 21 && totalWeeks <= 27) {
    wonderWeekInfo = 'Wonder Week 26 (Tuần 22 - 26): Bước nhảy vọt 5 - Thế giới của các mối quan hệ & lo âu xa cách.';
  } else if (totalWeeks >= 28 && totalWeeks <= 38) {
    wonderWeekInfo = 'Wonder Week 37 (Tuần 33 - 37): Bước nhảy vọt 6 - Thế giới của sự phân loại & khám phá.';
  } else if (totalWeeks >= 39 && totalWeeks <= 47) {
    wonderWeekInfo = 'Wonder Week 46 (Tuần 41 - 46): Bước nhảy vọt 7 - Thế giới của các trình tự & chuỗi hành động.';
  } else {
    wonderWeekInfo = `Wonder Week tương ứng mốc ${totalWeeks} tuần tuổi.`;
  }

  const todayStr = `${now.getDate().toString().padStart(2, '0')}/${(now.getMonth() + 1).toString().padStart(2, '0')}/${now.getFullYear()}`;

  return {
    todayStr,
    birthDateStr: '13/07/2026',
    totalDays,
    totalWeeks,
    remainingDays,
    monthsApprox: months,
    wonderWeekInfo,
    summaryText: `Hôm nay là ngày ${todayStr}. Sếp Mỡ sinh ngày 13/07/2026 ➔ Hiện tại chính xác là ${totalDays} ngày tuổi (${totalWeeks} tuần ${remainingDays} ngày, khoảng ${months} tháng tuổi). Giai đoạn phát triển: ${wonderWeekInfo}`
  };
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
    'sổ tay', 'dặn dò', 'lưu ý riêng', 'lưu ý', 'ghi nhớ', 'nhớ', 'quên', 'đã học', 'dạy',
    'sếp', 'boss', 'mốc', 'tuần', 'tháng', 'tuổi', 'giai đoạn', 'wonder week', 'ww', 'ngày sinh', 'sinh ngày', 'sinh nhật', 'lịch',
    'trả lời lại', 'nói lại', 'câu trên', 'câu vừa rồi', 'lại đi'
  ];
  
  return personalKeywords.some(kw => low.includes(kw));
}

// Bóc tách toàn bộ mẩu kiến thức trong sổ tay riêng để nạp động vào lượt chat đó (Dynamic In-Context Injection)
function getRelevantMemories(userPrompt = '') {
  if (!shouldRetrievePersonalMemories(userPrompt)) {
    return ''; // CỔNG ĐÓNG 100%: Hoàn toàn không nạp sổ tay nếu câu hỏi là khách quan ngoài đời!
  }

  const memories = loadMemories();
  const ageProfile = getBabyCurrentAgeProfile();

  let text = `\n[THÔNG TIN THỜI GIAN THỰC & HỒ SƠ SẾP MỠ (CẬP NHẬT TỰ ĐỘNG CHUẨN XÁC)]:\n• ${ageProfile.summaryText}\n\n`;
  text += '[TOÀN BỘ SỔ TAY KIẾN THỨC & DẶN DÒ GIA ĐÌNH BÉ MỠ]:\n';
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
  getBabyCurrentAgeProfile,
  formatMemoriesForPrompt,
  formatMemoriesForUser
};
