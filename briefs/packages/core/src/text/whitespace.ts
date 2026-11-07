/**
 * Foundation's `.whitespacesAndNewlines`: Zs, tab, U+000A...U+000D, U+0085, U+2028, U+2029
 * and also U+200B (zero width space), which Foundation counts as whitespace. Not U+FEFF.
 * The exact sets are checked against the golden export.
 */
const BLANK = /^[\p{Zs}\t\n\v\f\r\u{85}\u{200B}\u{2028}\u{2029}]*$/u;
/** Foundation's `.whitespaces`: Zs, tab and U+200B. */
const BLANK_LINE = /^[\p{Zs}\t\u{200B}]*$/u;
/** Swift `Character.isWhitespace`: the Unicode White_Space property of the first scalar. */
const WHITESPACE_START = /^\p{White_Space}/u;
const segmenter = new Intl.Segmenter("en", { granularity: "grapheme" });

/** True when `trimmingCharacters(in: .whitespacesAndNewlines)` would leave nothing. */
export function isBlank(text: string): boolean {
  return BLANK.test(text);
}

/** True when `trimmingCharacters(in: .whitespaces)` would leave nothing. */
export function isBlankLine(text: string): boolean {
  return BLANK_LINE.test(text);
}

/** `contains(where: \.isWhitespace)` over grapheme clusters. */
export function containsWhitespace(text: string): boolean {
  for (const { segment } of segmenter.segment(text)) if (WHITESPACE_START.test(segment)) return true;
  return false;
}

const TRIM = /^[\p{Zs}\t\n\v\f\r\u{85}\u{200B}\u{2028}\u{2029}]+|[\p{Zs}\t\n\v\f\r\u{85}\u{200B}\u{2028}\u{2029}]+$/gu;

/** `trimmingCharacters(in: .whitespacesAndNewlines)`. */
export function trimWhitespace(text: string): string {
  return text.replace(TRIM, "");
}
