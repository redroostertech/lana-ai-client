import type { TranscriptSegment } from "../intent/meetingParts.js";
import { graphemeCount, graphemes } from "../text/graphemes.js";
import { normalizedWords } from "./textNormalizer.js";

/**
 * Deterministic content matching between model-written text and transcript lines (Swift
 * `LineMatcher`, Nov 13).
 *
 * A key point or action whose cited lines share no content with what it says is moved to the
 * line that does carry it (models often cite the line after, or the question before), long
 * lines are trimmed to the sentences an action is about, and the open question check picks
 * the later lines that could answer a question.
 *
 * Words are compared by a short stem (lowercased, at least four letters, cut to five, filler
 * words removed). Each shared stem is weighted by how rare it is among the lines compared.
 */
const MINIMUM_WORD_LENGTH = 4;
const STEM_LENGTH = 5;
/** Distinct stems an uncited line must share with the text before a citation moves to it. */
const MINIMUM_SHARED_STEMS = 2;
/** How many times the best cited line's score another line must beat to take the citation. */
const CLEARLY_BETTER = 2.0;

const FILLER_WORDS = new Set([
  "about", "after", "again", "also", "because", "been", "before", "being", "could", "does", "doing",
  "done", "each", "even", "from", "gonna", "gotcha", "have", "here", "into", "just", "know", "like",
  "make", "more", "much", "need", "okay", "only", "other", "over", "really", "right", "said", "same",
  "should", "some", "something", "still", "such", "sure", "than", "that", "their", "them", "then",
  "there", "these", "they", "thing", "things", "think", "this", "those", "through", "very", "want",
  "wanna", "well", "were", "what", "when", "where", "which", "while", "will", "with", "would", "yeah",
  "your", "yours",
]);

/** Content stems of `text`. */
export function stems(text: string): Set<string> {
  const out = new Set<string>();
  for (const word of normalizedWords(text)) {
    const letters = graphemes(word);
    if (letters.length < MINIMUM_WORD_LENGTH || FILLER_WORDS.has(word) || /^\p{N}+$/u.test(word)) continue;
    out.add(letters.slice(0, STEM_LENGTH).join(""));
  }
  return out;
}

/** Rarity-weighted overlap of `text` with each line, in line order. */
export function lineScores(text: string, lines: readonly string[]): number[] {
  const wanted = stems(text);
  const lineStems = lines.map(stems);
  const count = Math.max(lines.length, 1);
  return lineStems.map((line) => {
    let total = 0;
    for (const stem of wanted) {
      if (!line.has(stem)) continue;
      const frequency = lineStems.filter((other) => other.has(stem)).length;
      total += Math.log(1 + count / frequency);
    }
    return total;
  });
}

/**
 * The 1-based lines of `segments` that `text` should cite: the best scoring line instead of
 * `cited` when it shares at least two stems with `text` and scores more than twice the best
 * cited line; otherwise `cited`.
 */
export function verifiedLines(text: string, cited: readonly number[], segments: readonly TranscriptSegment[]): number[] {
  if (segments.length === 0) return [...cited];
  const wanted = stems(text);
  if (wanted.size === 0) return [...cited];
  const lineStems = segments.map((segment) => stems(segment.text));
  const scores = lineScores(text, segments.map((segment) => segment.text));
  const citedScore = Math.max(0, ...cited.filter((line) => line >= 1 && line <= segments.length).map((line) => scores[line - 1]!));
  let best: { line: number; score: number } | undefined;
  segments.forEach((_, index) => {
    let shared = 0;
    for (const stem of wanted) if (lineStems[index]!.has(stem)) shared += 1;
    if (shared >= MINIMUM_SHARED_STEMS && scores[index]! > (best?.score ?? 0)) best = { line: index + 1, score: scores[index]! };
  });
  if (best === undefined || !(best.score > CLEARLY_BETTER * citedScore)) return [...cited];
  return [best.line];
}

function sentencesOf(text: string): string[] {
  const segmenter = new Intl.Segmenter("en", { granularity: "sentence" });
  return [...segmenter.segment(text)].map((part) => part.segment.trim()).filter((sentence) => sentence !== "");
}

/**
 * `text` cut to at most `limit` characters around the sentences that best match `about`:
 * always a contiguous run of whole sentences from `text` (or its first `limit` characters
 * when one sentence is longer), so it still grounds word for word against the line.
 */
export function excerpt(text: string, about: string, limit: number): string {
  const trimmed = text.trim();
  if (graphemeCount(trimmed) <= limit) return trimmed;
  const sentences = sentencesOf(trimmed);
  const scores = lineScores(about, sentences);
  let anchor = -1;
  scores.forEach((score, index) => {
    if (anchor < 0 || score > scores[anchor]!) anchor = index;
  });
  const length = (sentence: string): number => graphemeCount(sentence);
  if (anchor < 0 || length(sentences[anchor]!) > limit) return graphemes(trimmed).slice(0, limit).join("").trim();
  let lower = anchor;
  let upper = anchor;
  let total = length(sentences[anchor]!);
  for (;;) {
    const before = lower > 0 ? length(sentences[lower - 1]!) + 1 : Number.MAX_SAFE_INTEGER;
    const after = upper + 1 < sentences.length ? length(sentences[upper + 1]!) + 1 : Number.MAX_SAFE_INTEGER;
    const preferAfter = upper + 1 < sentences.length && (lower === 0 || scores[upper + 1]! >= scores[lower - 1]!);
    if (preferAfter && total + after <= limit) {
      upper += 1;
      total += after;
    } else if (lower > 0 && total + before <= limit) {
      lower -= 1;
      total += before;
    } else if (!preferAfter && upper + 1 < sentences.length && total + after <= limit) {
      upper += 1;
      total += after;
    } else {
      break;
    }
  }
  return sentences.slice(lower, upper + 1).join(" ");
}
