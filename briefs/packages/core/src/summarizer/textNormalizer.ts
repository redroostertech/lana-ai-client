import { fold, isLetter, isNumber } from "../ask/tokenizer.js";
import { graphemes } from "../text/graphemes.js";

/** Fullwidth ASCII to ASCII (Foundation's `.widthInsensitive` for the forms that matter here). */
function widthFolded(text: string): string {
  return text.replace(/[！-～]/gu, (character) => String.fromCodePoint(character.codePointAt(0)! - 0xfee0)).replace(/　/gu, " ");
}

/**
 * Swift `TextNormalizer.words`: lowercased, diacritic and width folded words. Letters and
 * numbers build a word, apostrophes are dropped inside it, anything else ends it.
 */
export function normalizedWords(text: string): string[] {
  const folded = fold(widthFolded(text)).toLowerCase().replaceAll("’", "'");
  const words: string[] = [];
  let current = "";
  for (const character of graphemes(folded)) {
    if (isLetter(character) || isNumber(character)) current += character;
    else if (character === "'") continue;
    else if (current !== "") {
      words.push(current);
      current = "";
    }
  }
  if (current !== "") words.push(current);
  return words;
}

/** The words joined by single spaces, so a quote still matches when ASR and the model punctuate differently. */
export function normalizeText(text: string): string {
  return normalizedWords(text).join(" ");
}

/** Jaccard similarity of the two word sets, in 0...1. */
export function textSimilarity(left: string, right: string): number {
  const a = new Set(normalizedWords(left));
  const b = new Set(normalizedWords(right));
  if (a.size === 0 && b.size === 0) return 1;
  let shared = 0;
  for (const word of a) if (b.has(word)) shared += 1;
  const union = new Set([...a, ...b]).size;
  return union === 0 ? 0 : shared / union;
}
