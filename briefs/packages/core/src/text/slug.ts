import { SLUG_TABLE_PACKED } from "./slugTable.js";

const MAX_SLUG = 64;
let table: Map<number, string> | undefined;

function foldTable(): Map<number, string> {
  if (table === undefined) {
    table = new Map();
    for (const entry of SLUG_TABLE_PACKED.split(",")) {
      const separator = entry.indexOf(":");
      table.set(Number.parseInt(entry.slice(0, separator), 36), entry.slice(separator + 1));
    }
  }
  return table;
}

function isAsciiAlphanumeric(code: number): boolean {
  return (code >= 48 && code <= 57) || (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
}

/**
 * `IdempotencyKey.slug`: diacritic and case folded, lowercased ASCII words joined by
 * dashes, at most 64 characters, `untitled` when nothing is left. The folding of
 * non-ASCII scalars comes from a table exported from Foundation.
 */
export function slug(text: string): string {
  const folds = foldTable();
  let raw = "";
  for (const character of text) {
    const code = character.codePointAt(0) ?? 0;
    if (code < 0x80) raw += isAsciiAlphanumeric(code) ? character.toLowerCase() : "-";
    else raw += folds.get(code) ?? "-";
  }
  const joined = raw.split("-").filter((word) => word.length > 0).join("-");
  if (joined.length === 0) return "untitled";
  return joined.slice(0, MAX_SLUG).replace(/^-+|-+$/g, "");
}
