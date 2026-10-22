const fetch = require('node-fetch');

// Tra cứu thông tin trên Internet qua DuckDuckGo HTML (Miễn phí 100%, không cần API key)
async function searchWeb(query) {
  try {
    const url = 'https://html.duckduckgo.com/html/?q=' + encodeURIComponent(query);
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7'
      },
      timeout: 10000
    });

    if (!res.ok) {
      console.warn(`⚠️ Tra cứu DuckDuckGo trả về mã HTTP: ${res.status}`);
      return [];
    }

    const html = await res.text();
    const results = [];
    const blocks = html.split('<div class="result results_links');

    for (let i = 1; i < Math.min(blocks.length, 6); i++) {
      const b = blocks[i];
      const urlM = b.match(/href="\/\/duckduckgo\.com\/l\/\?uddg=([^"&]+)/);
      const titleM = b.match(/<a class="result__snippet"[^>]*>([\s\S]*?)<\/a>/) || b.match(/<a class="result__url"[^>]*>([\s\S]*?)<\/a>/);
      const snipM = b.match(/<a class="result__snippet"[^>]*>([\s\S]*?)<\/a>/);

      let realUrl = '';
      if (urlM) {
        try {
          realUrl = decodeURIComponent(urlM[1]);
        } catch {
          realUrl = urlM[1];
        }
      }

      const snippet = snipM ? snipM[1].replace(/<[^>]+>/g, '').trim() : '';
      const title = titleM ? titleM[1].replace(/<[^>]+>/g, '').trim() : 'Nguồn tham khảo';

      if (realUrl && snippet) {
        results.push({
          title: title,
          snippet: snippet,
          url: realUrl
        });
      }
    }

    return results;
  } catch (err) {
    console.error('❌ Lỗi tra cứu web:', err.message);
    return [];
  }
}

// Format kết quả tìm kiếm để nạp vào prompt cho Gemini
function formatSearchResults(results) {
  if (!results || results.length === 0) return '';
  let text = '\n\n=== [DỮ LIỆU TÌM KIẾM INTERNET THEO THỜI GIAN THỰC] ===\n';
  results.forEach((r, idx) => {
    text += `${idx + 1}. MÔ TẢ/GIÁ CẢ: ${r.snippet}\n🔗 LINK MUA HÀNG/THAM KHẢO: ${r.url}\n\n`;
  });
  text += '========================================================\n';
  return text;
}

module.exports = {
  searchWeb,
  formatSearchResults
};
