const fetch = require('node-fetch');

// Trích xuất các đường link http/https trong văn bản
function extractUrls(text) {
  if (!text) return [];
  const urlRegex = /https?:\/\/[^\s<>"'{}|\\^`]+/gi;
  return text.match(urlRegex) || [];
}

// Bóc tách nội dung trực tiếp từ 1 trang web (Con Cưng, KidsPlaza, Shopee, Bibomart...)
async function fetchUrlContent(url) {
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7'
      },
      timeout: 8000
    });

    if (!res.ok) {
      return { url, error: `HTTP ${res.status}` };
    }

    const html = await res.text();

    // 1. Tên sản phẩm / Tiêu đề trang
    const ogTitle = (html.match(/<meta\s+(?:property|name)=["']og:title["']\s+content=["']([^"']+)["']/i) || [])[1];
    const pageTitle = (html.match(/<title>([^<]+)<\/title>/i) || [])[1];
    const title = (ogTitle || pageTitle || '').replace(/[\r\n\t]+/g, ' ').trim();

    // 2. Mô tả sản phẩm
    const metaDesc = (html.match(/<meta\s+(?:property|name)=["'](?:description|og:description)["']\s+content=["']([^"']+)["']/i) || [])[1];
    const description = (metaDesc || '').replace(/[\r\n\t]+/g, ' ').trim();

    // 3. Quét giá niêm yết thực tế
    let foundPrice = '';

    // Ưu tiên 1: Quét thẻ class chứa giá (Con Cưng, KidsPlaza, Bibomart...)
    const priceMatches = html.match(/<[^>]+class=["'][^"']*(?:product-price|order-price|current-price|price-current|price-box)[^"']*["'][^>]*>([\s\S]*?)<\//gi) || [];
    for (const p of priceMatches) {
      const clean = p.replace(/<[^>]+>/g, '').trim();
      const numMatch = clean.match(/(\d{1,3}(?:\.\d{3})+|\d+)\s*(?:đ|₫|VND)?/i);
      if (numMatch && numMatch[0].length >= 4) {
        // Loại trừ các số không phải tiền (như năm 2026, hotline 1800...)
        if (!numMatch[0].startsWith('1800') && !numMatch[0].startsWith('1900')) {
          foundPrice = numMatch[0].includes('đ') || numMatch[0].includes('₫') ? numMatch[0] : `${numMatch[0]} đ`;
          break;
        }
      }
    }

    // Ưu tiên 2: Quét meta og:price hoặc product:price:amount
    if (!foundPrice) {
      const ogPrice = (html.match(/<meta\s+(?:property|name)=["'](?:product:price:amount|og:price:amount)["']\s+content=["']([^"']+)["']/i) || [])[1];
      if (ogPrice && /^\d+$/.test(ogPrice)) {
        foundPrice = parseInt(ogPrice).toLocaleString('vi-VN') + ' đ';
      }
    }

    // Ưu tiên 3: Quét JSON-LD schema
    if (!foundPrice) {
      const jsonPrice = (html.match(/"price"\s*:\s*"?(\d+)"?/i) || [])[1];
      if (jsonPrice && /^\d+$/.test(jsonPrice) && jsonPrice.length >= 4) {
        foundPrice = parseInt(jsonPrice).toLocaleString('vi-VN') + ' đ';
      }
    }

    return {
      url,
      title: title || 'Trang web sản phẩm',
      price: foundPrice || 'Không quét được con số giá công khai (có thể web yêu cầu chọn khu vực/đăng nhập)',
      description: description || ''
    };
  } catch (err) {
    return { url, error: err.message };
  }
}

// Định dạng dữ liệu đọc từ link web để nạp vào prompt cho Gemini
function formatUrlContent(info) {
  if (!info || info.error) return '';
  return `\n=== [DỮ LIỆU ĐỌC TRỰC TIẾP TỪ LINK WEB SẾP GỬI] ===\n` +
         `🔗 URL: ${info.url}\n` +
         `🏷️ TÊN SẢN PHẨM: ${info.title}\n` +
         `💰 GIÁ NIÊM YẾT CHÍNH XÁC: ${info.price}\n` +
         `📝 MÔ TẢ TRÊN WEB: ${info.description}\n` +
         `===================================================\n`;
}

// Tra cứu thông tin trên Internet qua DuckDuckGo HTML
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
  extractUrls,
  fetchUrlContent,
  formatUrlContent,
  searchWeb,
  formatSearchResults
};
