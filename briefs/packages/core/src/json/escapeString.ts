const SHORT_ESCAPES: Readonly<Record<number, string>> = {
  0x22: '\\"',
  0x5c: "\\\\",
  0x08: "\\b",
  0x09: "\\t",
  0x0a: "\\n",
  0x0c: "\\f",
  0x0d: "\\r",
};

/**
 * A JSON string literal as Swift's `JSONEncoder` writes it with `.withoutEscapingSlashes`:
 * quote, backslash and C0 controls escaped (lowercase `\u00xx` where there is no short
 * form); everything else, including DEL, U+2028 and non-ASCII, is written raw.
 */
export function escapeString(text: string): string {
  if (!text.isWellFormed()) throw new RangeError("String contains a lone surrogate");
  let out = '"';
  let runStart = 0;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (code >= 0x20 && code !== 0x22 && code !== 0x5c) continue;
    out += text.slice(runStart, index);
    out += SHORT_ESCAPES[code] ?? `\\u${code.toString(16).padStart(4, "0")}`;
    runStart = index + 1;
  }
  return `${out}${text.slice(runStart)}"`;
}
