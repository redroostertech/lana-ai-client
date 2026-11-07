/**
 * Cleans a local model's reply: hybrid Qwen models can still emit `<think>` blocks, which
 * are reasoning, not the reply. An unclosed block runs to the end.
 */
export function cleanedReply(raw: string): string {
  let text = raw;
  for (;;) {
    const open = text.indexOf("<think>");
    if (open === -1) break;
    const close = text.indexOf("</think>", open + "<think>".length);
    text = close === -1 ? text.slice(0, open) : text.slice(0, open) + text.slice(close + "</think>".length);
  }
  return text.replace(/^[\s\u{85}\u{200B}]+|[\s\u{85}\u{200B}]+$/gu, "");
}
