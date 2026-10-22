// Bóc tách nội dung trích dẫn (Reply / Quote Reader) để AI hiểu trọn vẹn ngữ cảnh được reply
function extractQuotedMessage(ctx) {
  const reply = ctx.message?.reply_to_message;
  if (!reply) return '';

  let authorName = 'Thành viên';
  if (reply.from?.id === ctx.me?.id) {
    authorName = 'Tiểu Cường';
  } else if (reply.from?.first_name) {
    authorName = reply.from.first_name;
  }

  let quotedContent = '';
  if (reply.text) {
    quotedContent = reply.text;
  } else if (reply.caption) {
    quotedContent = reply.caption;
  } else if (reply.photo) {
    quotedContent = '[Hình ảnh]';
  } else if (reply.document) {
    quotedContent = `[Tài liệu: ${reply.document.file_name || 'file'}]`;
  } else if (reply.sticker) {
    quotedContent = '[Sticker biểu cảm]';
  } else {
    quotedContent = '[Tin nhắn đa phương tiện]';
  }

  return `[Đang trích dẫn tin nhắn của ${authorName}: "${quotedContent.trim()}"]\n`;
}

module.exports = {
  extractQuotedMessage
};
