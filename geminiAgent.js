const { GoogleGenAI, Type } = require('@google/genai');
const { GEMINI_API_KEY } = require('./config');
const { buildSystemPrompt } = require('./systemPrompt');
const historyStore = require('./historyStore');
const memoryStore = require('./memoryStore');
const webTools = require('./webSearch');

const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
const PRIMARY_MODEL = 'gemini-flash-lite-latest';
const FALLBACK_MODEL = 'gemini-flash-latest';

// Khai báo bộ công cụ (Tools) cho Gemini Function Calling
const agentToolDeclarations = [
  {
    name: 'getLiveExchangeRate',
    description: 'Tra cứu tỷ giá ngoại tệ trực tiếp từ ngân hàng theo thời gian thực (USD, EUR, JPY, GBP, CNY...) sang VNĐ. Bắt buộc gọi tool này khi người dùng hỏi tỷ giá, đổi tiền hoặc quy đổi ngoại tệ.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        currencyCode: {
          type: Type.STRING,
          description: 'Mã tiền tệ gốc cần quy đổi sang VNĐ, ví dụ: USD, EUR, JPY, GBP, CNY, SGD, AUD, KRW'
        }
      },
      required: ['currencyCode']
    }
  },
  {
    name: 'searchInternet',
    description: 'Tìm kiếm thời gian thực trên Internet/Google: Bảng giá thị trường, link mua hàng chính hãng (Shopee, Con Cưng, KidsPlaza...), kiểm tra mã sản phẩm từ hình ảnh hoặc tên gọi (bình đun nước, máy tiệt trùng, xe đẩy, bỉm sữa...), bảng thành phần dinh dưỡng (Nutrition Facts) và kiến thức y khoa. BẮT BUỘC gọi tool này khi: (1) người dùng hỏi giá, hỏi mua ở đâu, xin link mua hàng; (2) người dùng hỏi có nên mua hay không, có bị đắt/phí hay không; (3) người dùng gửi ảnh sản phẩm cần kiểm tra giá hoặc tính năng; (4) so sánh sản phẩm hoặc cần số liệu thực tế ngoài đời.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        query: {
          type: Type.STRING,
          description: 'Từ khóa tìm kiếm tối ưu trên Google (ví dụ: "giá bình đun nước Fatz Baby FB3830BN Shopee", "bảng thành phần sữa Aptamil Cesarbiotik 1", "link mua bình sữa Hegen chính hãng")'
        }
      },
      required: ['query']
    }
  },
  {
    name: 'fetchWebPage',
    description: 'Đọc nội dung và giá sản phẩm trực tiếp từ một đường link cụ thể (như concung.com, shopee.vn, kidsplaza.vn...). Bắt buộc gọi khi người dùng gửi một đường link web hoặc khi muốn xem chi tiết giá từ link tìm được.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        url: {
          type: Type.STRING,
          description: 'Đường link web cần bóc tách dữ liệu'
        }
      },
      required: ['url']
    }
  },
  {
    name: 'searchFamilyNotebook',
    description: 'Tra cứu sổ tay kiến thức vĩnh viễn của gia đình Sếp Mỡ (hồ sơ sức khỏe, cữ bú, thói quen riêng, lịch sinh hoạt...). Bắt buộc gọi khi muốn kiểm tra kỹ các thông tin gia đình đã dặn dò.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        query: {
          type: Type.STRING,
          description: 'Từ khóa hoặc chủ đề cần tra cứu trong sổ tay'
        }
      },
      required: ['query']
    }
  }
];

// Hàm thực thi các Tools
async function executeToolCall(toolName, args) {
  console.log(`🛠️ [Agent ToolCall] Thực thi: ${toolName}(${JSON.stringify(args)})`);
  try {
    switch (toolName) {
      case 'getLiveExchangeRate': {
        const info = await webTools.getLiveExchangeRate(args.currencyCode || 'USD');
        if (info) {
          return {
            status: 'success',
            baseCurrency: info.base,
            targetCurrency: 'VND',
            exchangeRate: info.rateVND,
            formattedRate: info.formattedRate,
            updateTime: info.updateTime,
            instruction: `Tỷ giá hiện tại là 1 ${info.base} = ${info.formattedRate} VNĐ. Bạn PHẢI dùng đúng tỷ giá này để làm phép tính nhân cho người dùng.`
          };
        }
        return { status: 'failed', message: 'Không lấy được tỷ giá thời gian thực từ ngân hàng.' };
      }

      case 'searchInternet': {
        const results = await webTools.searchWeb(args.query);
        if (results && results.length > 0) {
          return {
            status: 'success',
            count: results.length,
            results: results.map(r => ({
              title: r.title,
              snippet: r.snippet,
              url: r.url
            }))
          };
        }
        return { status: 'empty', message: 'Không tìm thấy kết quả nào phù hợp trên Internet.' };
      }

      case 'fetchWebPage': {
        const pageData = await webTools.fetchUrlContent(args.url);
        if (pageData && !pageData.error) {
          return {
            status: 'success',
            title: pageData.title,
            listedPrice: pageData.price,
            description: pageData.description,
            url: pageData.url
          };
        }
        return { status: 'failed', error: pageData?.error || 'Không tải được trang web.' };
      }

      case 'searchFamilyNotebook': {
        const memories = memoryStore.loadMemories();
        const q = (args.query || '').toLowerCase();
        const matched = memories.filter(m =>
          m.topic.toLowerCase().includes(q) || m.content.toLowerCase().includes(q)
        );
        return {
          status: 'success',
          foundCount: matched.length,
          memories: matched.length > 0 ? matched : memories.slice(0, 5)
        };
      }

      default:
        return { status: 'unknown_tool', message: `Công cụ ${toolName} không tồn tại.` };
    }
  } catch (err) {
    console.error(`❌ Lỗi thực thi tool ${toolName}:`, err.message);
    return { status: 'error', error: err.message };
  }
}

// Quản lý các phiên Chat đa lượt (Multi-turn Sessions)
const activeSessions = new Map();

// Đăng ký listener: Khi historyStore hoàn thành nén ngữ cảnh ngầm, tự động reset session RAM
historyStore.setOnCompressionComplete((sessionKey) => {
  console.log(`🔄 [Context Sync] Session ${sessionKey} đã hoàn thành nén ngữ cảnh cũ, làm mới phiên RAM...`);
  resetChatSession(sessionKey);
});

function getOrCreateChatSession(sessionKey, displayName, forceReset = false) {
  if (!forceReset && activeSessions.has(sessionKey)) {
    const existingChat = activeSessions.get(sessionKey);
    try {
      const liveHistory = existingChat.getHistory();
      if (Array.isArray(liveHistory) && liveHistory.length > 42) {
        console.log(`🔄 [Context Sync] Phiên RAM ${sessionKey} vượt ngưỡng 20 lượt chat (${liveHistory.length} tin nhắn), đồng bộ làm mới từ lịch sử nén...`);
        activeSessions.delete(sessionKey);
      }
    } catch (e) {
      // Bỏ qua nếu không đọc được liveHistory
    }
  }

  if (forceReset || !activeSessions.has(sessionKey)) {
    const fullSystemPrompt = buildSystemPrompt(displayName);
    const history = forceReset ? [] : historyStore.getSessionHistoryForGemini(sessionKey);

    const chat = ai.chats.create({
      model: PRIMARY_MODEL,
      history: history.length > 0 ? history : undefined,
      config: {
        systemInstruction: fullSystemPrompt,
        temperature: 0.7,
        tools: [{ functionDeclarations: agentToolDeclarations }]
      }
    });

    activeSessions.set(sessionKey, chat);
  }
  return activeSessions.get(sessionKey);
}

// Vòng lặp Agentic AI xử lý Tool Calls tự động đến khi có câu trả lời cuối cùng
async function askGeminiAgent(sessionKey, displayName, userPrompt, imageBase64 = null) {
  const chat = getOrCreateChatSession(sessionKey, displayName);

  // Áp dụng Intent-Gated Dynamic Memory: Chỉ nạp sổ tay nếu câu hỏi thực sự liên quan đến bé Mỡ
  const relevantMemory = memoryStore.getRelevantMemories(userPrompt);
  const effectivePrompt = relevantMemory
    ? `${relevantMemory}\n${userPrompt}`
    : userPrompt;

  // Tạo nội dung tin nhắn ban đầu (hỗ trợ text hoặc multimodal có ảnh)
  let initialMessage;
  if (imageBase64) {
    initialMessage = [
      { text: effectivePrompt },
      {
        inlineData: {
          data: imageBase64,
          mimeType: 'image/jpeg'
        }
      }
    ];
  } else {
    initialMessage = effectivePrompt;
  }

  let currentResponse;
  try {
    currentResponse = await chat.sendMessage({ message: initialMessage });
  } catch (err) {
    console.warn('⚠️ Lỗi gọi mô hình chính, đang thử lại với fallback model:', err.message);
    const fallbackChat = ai.chats.create({
      model: FALLBACK_MODEL,
      config: {
        systemInstruction: buildSystemPrompt(displayName),
        temperature: 0.7,
        tools: [{ functionDeclarations: agentToolDeclarations }]
      }
    });
    activeSessions.set(sessionKey, fallbackChat);
    currentResponse = await fallbackChat.sendMessage({ message: initialMessage });
  }

  // Vòng lặp giải quyết Tool Calls (tối đa 5 vòng để tránh lặp vô tận)
  let loopCount = 0;
  const activeChat = activeSessions.get(sessionKey);

  while (currentResponse.functionCalls && currentResponse.functionCalls.length > 0 && loopCount < 5) {
    loopCount++;
    console.log(`🔄 [Agent Loop Turn ${loopCount}] Nhận ${currentResponse.functionCalls.length} yêu cầu gọi Tool từ Gemini...`);

    const functionResponses = await Promise.all(
      currentResponse.functionCalls.map(async (call) => {
        const result = await executeToolCall(call.name, call.args);
        return {
          functionResponse: {
            name: call.name,
            response: result
          }
        };
      })
    );

    currentResponse = await activeChat.sendMessage({ message: functionResponses });
  }

  // Nếu sau các vòng lặp mà Gemini vẫn trả về functionCall (chưa chốt text câu trả lời):
  if (!currentResponse.text && currentResponse.functionCalls && currentResponse.functionCalls.length > 0) {
    console.log('⚡ Model vẫn muốn gọi thêm tool, gửi phản hồi chốt câu trả lời cuối cùng cho người dùng...');
    const dummyResponses = currentResponse.functionCalls.map(c => ({
      functionResponse: {
        name: c.name,
        response: { status: 'complete', message: 'Dữ liệu đã đủ. Hãy tổng hợp câu trả lời chi tiết, chính xác và đầy đủ nhất cho Ba Mỡ ngay.' }
      }
    }));
    try {
      currentResponse = await activeChat.sendMessage({ message: dummyResponses });
    } catch (e) {
      console.warn('⚠️ Lỗi chốt câu trả lời:', e.message);
    }
  }

  // Trích xuất text từ response (hỗ trợ cả getter .text và candidates parts)
  let finalText = currentResponse.text;
  if (!finalText && currentResponse.candidates?.[0]?.content?.parts) {
    finalText = currentResponse.candidates[0].content.parts
      .filter(p => p.text)
      .map(p => p.text)
      .join('\n')
      .trim();
  }

  const finalReply = finalText || 'Dạ Ba Mỡ ơi, Tiểu Cường đang tra cứu thông tin này nhưng mạng bên ngoài phản hồi hơi chậm, Ba Mỡ đợi em một chút rồi hỏi lại giúp em nhé! 🙏';
  return finalReply;
}

function resetChatSession(sessionKey) {
  activeSessions.delete(sessionKey);
}

module.exports = {
  ai,
  askGeminiAgent,
  getOrCreateChatSession,
  resetChatSession
};
