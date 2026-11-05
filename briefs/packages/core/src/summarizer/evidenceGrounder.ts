import type { Evidence } from "../intent/intent.js";
import { speakerDisplayName, type Speaker, type TranscriptSegment } from "../intent/meetingParts.js";
import type { Grounding } from "../intent/intentAssembler.js";
import type { CandidateQuote } from "./notesFormat.js";
import { normalizeText } from "./textNormalizer.js";

/** Quotes shorter than this many words ground too easily ("yes", "okay"). */
const MINIMUM_QUOTE_WORDS = 3;
/** Seconds of slack when matching a cited time range to segments. */
const TIME_TOLERANCE = 1;
const WHITESPACE = /^[\s\u0085​]+|[\s\u0085​]+$/gu;

/**
 * Swift `EvidenceGrounder`: every quote must appear in the transcript, contiguously inside
 * the segments it cites (same speaker, overlapping times). One found verbatim elsewhere in
 * the chunk is kept with its citation corrected (lowering confidence); one found nowhere is
 * dropped. Nothing is invented.
 */
export function groundQuotes(quotes: readonly CandidateQuote[], segments: readonly TranscriptSegment[], speakers: readonly Speaker[]): Grounding {
  const evidence: Evidence[] = [];
  let corrected = 0;
  const seen = new Set<string>();
  for (const quote of quotes) {
    const normalized = normalizeText(quote.quote);
    if (normalized.split(" ").filter((word) => word !== "").length < MINIMUM_QUOTE_WORDS || seen.has(normalized)) continue;
    const match = locate(quote, normalized, segments, speakers);
    if (match === null) continue;
    seen.add(normalized);
    if (match.corrected) corrected += 1;
    evidence.push(match.evidence);
  }
  return { evidence, citedCount: quotes.length, correctedCount: corrected };
}

function locate(quote: CandidateQuote, normalized: string, segments: readonly TranscriptSegment[], speakers: readonly Speaker[]): { evidence: Evidence; corrected: boolean } | null {
  const label = speakerLabel(quote.speaker, segments, speakers);
  const lower = Math.min(quote.tStart, quote.tEnd) - TIME_TOLERANCE;
  const upper = Math.max(quote.tStart, quote.tEnd) + TIME_TOLERANCE;
  const cited = segments.flatMap((segment, index) => (segment.speaker === label && segment.end >= lower && segment.start <= upper ? [index] : []));
  const exact = find(normalized, cited, segments);
  if (exact !== null) return { evidence: evidenceFor(exact, quote.quote, segments), corrected: false };
  const anywhere = find(normalized, segments.map((_segment, index) => index), segments);
  if (anywhere !== null) return { evidence: evidenceFor(anywhere, quote.quote, segments), corrected: true };
  return null;
}

/** Smallest run of consecutive same-speaker segments (from `candidates`) whose text contains the quote. */
function find(normalized: string, candidates: readonly number[], segments: readonly TranscriptSegment[]): [number, number] | null {
  const available = new Set(candidates);
  for (const index of candidates) if (contains(normalizeText(segments[index]!.text), normalized)) return [index, index];
  for (const index of candidates) {
    let combined = normalizeText(segments[index]!.text);
    let next = index + 1;
    while (next < segments.length && available.has(next) && segments[next]!.speaker === segments[index]!.speaker && next - index < 4) {
      combined += ` ${normalizeText(segments[next]!.text)}`;
      if (contains(combined, normalized)) return [index, next];
      next += 1;
    }
  }
  return null;
}

/** Whole-word containment, so "pay" does not match inside "payment". */
function contains(haystack: string, needle: string): boolean {
  return ` ${haystack} `.includes(` ${needle} `);
}

function evidenceFor([first, last]: [number, number], quote: string, segments: readonly TranscriptSegment[]): Evidence {
  return { speaker: segments[first]!.speaker, tStart: segments[first]!.start, tEnd: segments[last]!.end, quote: quote.replace(WHITESPACE, "") };
}

/** Accepts the diarization label or the display name the model echoed. */
function speakerLabel(raw: string, segments: readonly TranscriptSegment[], speakers: readonly Speaker[]): string {
  const trimmed = raw.replace(WHITESPACE, "");
  if (speakers.some((speaker) => speaker.id === trimmed) || segments.some((segment) => segment.speaker === trimmed)) return trimmed;
  const folded = normalizeText(trimmed);
  return speakers.find((speaker) => normalizeText(speakerDisplayName(speaker)) === folded)?.id ?? trimmed;
}
