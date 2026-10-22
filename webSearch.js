const fetch = require('node-fetch');

// Tìm kiếm thông tin trên Internet qua DuckDuckGo HTML (Miễn phí 100%, không cần API key)
async function searchWeb(query) {
  try {
    const url = 'https://html.duckduckgo.com/html/?q=' + encodeURIComponent(query);
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      },
      timeout: 10000
    });
    const html = await res.text();

    const results = [];
    // Regex lấy URL và nội dung trích dẫn
    const snippetMatches = html.match(/<a class="result__snippet[^>]*>([\s\S]*?)<\/a>/g) || [];
    const urlMatches = html.match(/href="\/\/duckduckgo\.com\/l\/\?uddg=([^"&]+)/g) || [];
    const titleMatches = html.match(/<a class="result__url"[^>]*>([\s\S]*?)<\/a>/g) || [];

    for (let i = 0; i < Math.min(snippetMatches.length, 5); i++) {
      const cleanSnippet = snippetMatches[i] ? snippetMatches[i].replace(/<[^>]+>/g, '').trim() : '';
      let cleanUrl = '';
      if (urlMatches[i]) {
        const raw = urlMatches[i].replace('href="//duckduckgo.com/l/?uddg=', '');
        try {
          cleanUrl = decodeURIComponent(raw);
        } catch {
          cleanUrl = raw;
        }
      }

      if (cleanSnippet) {
        results.push({
          title: titleMatches[i] ? titleMatches[i].replace(/<[^>]+>/g, '').trim() : `Kết quả ${i + 1}`,
          snippet: cleanSnippet,
          url: cleanUrl
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
  let text = '\n\n=== [DỮ LIỆU TÌM KIẾM TỪ INTERNET THEO THỜI GIAN THỰC] ===\n';
  results.forEach((r, idx) => {
    text += `${idx + 1}. ${r.snippet}\nLink tham khảo: ${r.url}\n\n`;
  });
  text += '========================================================\n';
  return text;
}

module.exports = {
  searchWeb,
  formatSearchResults
};
