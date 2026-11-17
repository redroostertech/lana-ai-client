import type { SourceSpan } from "../intent/keyPoint.js";
import type { KeyPointKind } from "../intent/keyPoint.js";
import type { Speaker, TranscriptSegment } from "../intent/meetingParts.js";
import { stems } from "../summarizer/lineMatcher.js";
import { graphemes } from "../text/graphemes.js";

/**
 * The shared rules every AI step uses to see a meeting the same way (meeting state contract):
 * what is already known near a moment, when a text repeats a known one, and who the people of
 * the meeting are. Moved here from Find more so notes, Find more and Ask read one copy.
 */

export type SuggestionKind = KeyPointKind | "task";

/** An item the notes already hold, an action, or a suggestion waiting, dismissed or removed by hand. */
export interface KnownItem {
  readonly kind: SuggestionKind;
  /** The point's text, or the task's title. */
  readonly text: string;
  readonly sources: readonly SourceSpan[];
}

/** Known items with a source this close to a stretch are listed for it. */
export const KNOWN_NEAR_SECONDS = 60;
const MAX_KNOWN = 30;
const MAX_KNOWN_CHARACTERS = 200;

/** Known items with a source within 60 s of start to end, in time order, at most 30, each cut to 200 characters. */
export function knownNear(items: readonly KnownItem[], start: number, end: number): KnownItem[] {
  const low = start - KNOWN_NEAR_SECONDS;
  const high = end + KNOWN_NEAR_SECONDS;
  const first = (item: KnownItem) => Math.min(...item.sources.map((span) => span.start));
  return items
    .filter((item) => item.sources.some((span) => span.end >= low && span.start <= high))
    .map((item, index) => ({ item, index }))
    .sort((a, b) => first(a.item) - first(b.item) || a.index - b.index)
    .slice(0, MAX_KNOWN)
    .map(({ item }) => ({ ...item, text: knownText(item.text) }));
}

export function knownText(text: string): string {
  const flat = text.replace(/[|\r\n\u2028\u2029]+/gu, " ").replace(/ {2,}/gu, " ").trim();
  return graphemes(flat).slice(0, MAX_KNOWN_CHARACTERS).join("");
}


/** A suggestion whose content words are at least this share of one known item's is a rewording of it. */
const COVERED_SHARE = 0.5;
/** ...with at least this many tokens in common. */
const COVERED_MIN_SHARED = 3;
/** With every figure already in that item, this share is enough. */
const COVERED_FIGURE_SHARE = 0.4;

/**
 * True when the text is a rewording of one known item, of any kind: at least 60% of its content
 * words and figures are in that item, or every figure it holds is there and at least 40% overall.
 */
export function covered(text: string, known: readonly string[]): boolean {
  const figures = figuresOf(text);
  const wanted = new Set([...stems(text), ...figures]);
  if (wanted.size === 0) return false;
  return known.some((item) => {
    const itemFigures = figuresOf(item);
    const have = new Set([...stems(item), ...itemFigures]);
    let shared = 0;
    for (const token of wanted) if (have.has(token)) shared += 1;
    const share = shared / wanted.size;
    if (share >= COVERED_SHARE && shared >= COVERED_MIN_SHARED) return true;
    return figures.size > 0 && [...figures].every((figure) => itemFigures.has(figure)) && share >= COVERED_FIGURE_SHARE;
  });
}

/** The numbers in a text, written without separators ("410,000" is "410000"). */
export function figuresOf(text: string): Set<string> {
  return new Set([...text.matchAll(/\p{N}+(?:[.,]\p{N}+)*/gu)].map((match) => match[0].replace(/,/gu, "")));
}

const MONTHS_AND_DAYS = new Set(["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]);
/** Words that start a sentence but never name the person who commits. */
export const NOT_NAMES = ["The", "We", "They", "He", "She", "It", "This", "That", "These", "Those", "Each", "Both", "Everyone", "Everybody", "Someone", "Nobody", "No", "Our", "Their", "His", "Her", "I", "You", "Who", "All"] as const;

/**
 * The people of a meeting, lowercased: each speaker's name (whole, first and last word) and every
 * capitalized word inside a transcript line that is not the first word of a sentence, a month or
 * a day, or one of the not-names.
 */
export function meetingPeople(speakers: readonly Speaker[], transcript: readonly TranscriptSegment[]): Set<string> {
  const out = new Set<string>();
  for (const speaker of speakers) {
    if (speaker.name === undefined || speaker.name.trim() === "") continue;
    const words = speaker.name.trim().split(/\s+/u);
    out.add(speaker.name.trim().toLowerCase());
    out.add(words[0]!.toLowerCase());
    out.add(words.at(-1)!.toLowerCase());
  }
  for (const segment of transcript) {
    for (const match of segment.text.matchAll(/(?<![.!?]\s)(?<!^)(?<=\s)(\p{Lu}[\p{Ll}'\u2019-]+)/gu)) {
      const word = match[1]!.replace(/['\u2019]s$/u, "");
      if (MONTHS_AND_DAYS.has(word) || (NOT_NAMES as readonly string[]).includes(word)) continue;
      out.add(word.toLowerCase());
    }
    for (const match of segment.text.matchAll(/\b(?:Mr|Ms|Mrs|Dr)\.?\s+(\p{Lu}[\p{Ll}'\u2019-]+)/gu)) out.add(match[1]!.toLowerCase());
  }
  return out;
}


