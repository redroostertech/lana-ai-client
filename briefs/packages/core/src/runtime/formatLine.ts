/**
 * Reads one labelled line of a reply format (`ANSWER:`, `POINT:` and so on), Swift
 * `FormatLine`. Models dress lines in Markdown (`**ANSWER:** text`, `- ANSWER: ...`,
 * `### ANSWER: ...`, `Answer: text`): list markers, heading marks, quote marks and
 * emphasis around the label are ignored and the label is matched without regard to case.
 */

/** Foundation `.whitespaces`: Zs, tab and U+200B. */
const SPACE = "\\p{Zs}\\t\\u{200B}";

function trimmer(characters: string): RegExp {
  return new RegExp(`^[${characters}]+|[${characters}]+$`, "gu");
}

const MARKERS = trimmer(`*_#\\->\`${SPACE}`);
const VALUE_MARKERS = trimmer(`*_\`${SPACE}`);
const EMPHASIS = trimmer("*_` ");

/** `trimmingCharacters(in: .whitespaces)`. */
export function trimSpaces(text: string): string {
  return text.replace(trimmer(SPACE), "");
}

/** Drops the first `count` Unicode scalars, as Swift `dropFirst` does for ASCII labels. */
function dropScalars(text: string, count: number): string {
  return Array.from(text).slice(count).join("");
}

export function formatLineValue(label: string, rawLine: string): string | undefined {
  const line = rawLine.replace(MARKERS, "");
  if (!line.toUpperCase().startsWith(label)) return emphasisedLabel(label, line);
  return dropScalars(line, label.length).replace(VALUE_MARKERS, "");
}

/** `ANSWER**: text` (emphasis closing before the colon). */
function emphasisedLabel(label: string, line: string): string | undefined {
  const bare = label.slice(0, -1);
  if (!label.endsWith(":") || !line.toUpperCase().startsWith(bare)) return undefined;
  let rest = dropScalars(line, bare.length);
  while (rest.length > 0 && "*_` ".includes(rest[0]!)) rest = rest.slice(1);
  if (!rest.startsWith(":")) return undefined;
  return rest.slice(1).replace(EMPHASIS, "");
}
