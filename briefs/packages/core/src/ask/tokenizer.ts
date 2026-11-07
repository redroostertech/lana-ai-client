import { graphemeCount, graphemes } from "../text/graphemes.js";
import { SLUG_TABLE_PACKED } from "../text/slugTable.js";

/**
 * Lowercase, diacritic-folded words with stop words removed and a light suffix strip,
 * so "deposition", "depositions" and "Deposition" meet (Swift `Tokenizer` in LanaAsk).
 */
export const STOP_WORDS: ReadonlySet<string> = new Set([
  "a", "an", "and", "are", "as", "at", "be", "but", "by", "did", "do", "does", "for", "from", "had", "has", "have",
  "he", "her", "his", "how", "i", "if", "in", "is", "it", "its", "me", "my", "of", "on", "or", "our", "she", "so",
  "that", "the", "their", "them", "there", "they", "this", "to", "us", "was", "we", "were", "what", "when", "where",
  "which", "who", "whom", "why", "will", "with", "would", "you", "your", "can", "about", "said", "say", "just",
  "okay", "yeah", "um", "uh", "like", "get", "got", "going", "know", "think", "meeting",
]);

const SUFFIXES = ["ations", "ation", "ings", "ing", "edly", "ies", "es", "ed", "s"] as const;
const LETTER = /^\p{L}/u;
const NUMBER = /^\p{N}/u;
const MARKS = /\p{M}/gu;

let folds: Map<number, string> | undefined;

/** Foundation's diacritic and case folding (en_US_POSIX) plus `lowercased()`, per scalar. */
function foldTable(): Map<number, string> {
  if (folds === undefined) {
    folds = new Map();
    for (const entry of SLUG_TABLE_PACKED.split(",")) {
      const separator = entry.indexOf(":");
      folds.set(Number.parseInt(entry.slice(0, separator), 36), entry.slice(separator + 1));
    }
  }
  return folds;
}

export function fold(text: string): string {
  const table = foldTable();
  let result = "";
  for (const scalar of text) {
    const code = scalar.codePointAt(0) ?? 0;
    if (code < 0x80) {
      result += scalar.toLowerCase();
      continue;
    }
    const folded = table.get(code);
    // Scalars Foundation folds to ASCII come from the exported table; the rest lose
    // their combining marks and are lowercased, which is what Foundation does to them.
    result += folded ?? scalar.normalize("NFD").replace(MARKS, "").toLowerCase();
  }
  return result;
}

/** Swift `Character.isLetter` and `isNumber`, by the first scalar of the grapheme. */
export function isLetter(character: string): boolean {
  return LETTER.test(character);
}

export function isNumber(character: string): boolean {
  return NUMBER.test(character);
}

export function terms(text: string): string[] {
  const words: string[] = [];
  let current = "";
  for (const character of graphemes(fold(text))) {
    if (isLetter(character) || isNumber(character)) {
      current += character;
    } else if (current.length > 0) {
      words.push(current);
      current = "";
    }
  }
  if (current.length > 0) words.push(current);
  return words
    .filter((word) => !STOP_WORDS.has(word) && (graphemeCount(word) > 1 || isNumber(graphemes(word)[0] ?? "")))
    .map(stem);
}

export function stem(word: string): string {
  const characters = graphemes(word);
  if (characters.length <= 4 || !characters.every(isLetter)) return word;
  for (const suffix of SUFFIXES) {
    if (word.endsWith(suffix) && characters.length - suffix.length >= 3) {
      const base = characters.slice(0, characters.length - suffix.length).join("");
      return suffix === "ies" ? base + "y" : base;
    }
  }
  return word;
}
