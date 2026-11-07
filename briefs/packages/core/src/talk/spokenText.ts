import { graphemeCount } from "../text/graphemes.js";
import { sentences } from "../text/sentences.js";

/**
 * Turns on-screen answer text into text that sounds natural read aloud (Swift
 * `SpokenText.prepare`): passage labels and double quotes removed, whitespace normalised.
 */
export function prepareSpokenText(text: string): string {
  let spoken = text;
  // Passage labels such as [P2] or (P2) are for the screen only.
  spoken = spoken.replace(/[[(]P\d+[\])]/g, "");
  // Straight and curly double quotes read as noise.
  spoken = spoken.replace(/["\u{201C}\u{201D}]/gu, "");
  spoken = spoken.replace(/\s+/gu, " ");
  // No space before punctuation left behind by removed labels.
  spoken = spoken.replace(/ ([.,;:!?])/g, "$1");
  return spoken.trim();
}

/** Splits long text at sentence ends so playback can start before everything is made. */
export function spokenSentences(text: string, maxCharacters = 280): string[] {
  const chunks: string[] = [];
  let current = "";
  for (const sentence of sentences(text)) {
    if (current.length > 0 && graphemeCount(current) + graphemeCount(sentence) + 1 > maxCharacters) {
      chunks.push(current);
      current = sentence;
    } else {
      current = current.length === 0 ? sentence : `${current} ${sentence}`;
    }
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}
