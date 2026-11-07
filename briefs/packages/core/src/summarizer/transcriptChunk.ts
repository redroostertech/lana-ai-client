import { graphemeCount, graphemes } from "../text/graphemes.js";
import type { TranscriptSegment } from "../intent/meetingParts.js";

/** Counts model tokens for prompt text (Swift `TokenCounting`). */
export interface TokenCounter {
  tokenCount(text: string): number;
}

/** One token per 3.5 characters, rounded up (Swift `HeuristicTokenCounter`). */
export const HEURISTIC_TOKENS: TokenCounter = {
  tokenCount: (text) => (text === "" ? 0 : Math.ceil(graphemeCount(text) / 3.5)),
};

/** A run of consecutive transcript segments small enough for one model call (Swift `TranscriptChunk`). */
export interface TranscriptChunk {
  readonly index: number;
  readonly segments: readonly TranscriptSegment[];
  readonly estimatedTokens: number;
}

export function chunkStart(chunk: TranscriptChunk): number {
  return chunk.segments[0]?.start ?? 0;
}

export function chunkEnd(chunk: TranscriptChunk): number {
  return chunk.segments.at(-1)?.end ?? 0;
}

/** The segment a 1-based line citation points at, or undefined for an invented number. */
export function segmentAtLine(chunk: TranscriptChunk, line: number): TranscriptSegment | undefined {
  return Number.isInteger(line) && line >= 1 ? chunk.segments[line - 1] : undefined;
}

/**
 * Swift `String(format: "%.1f")`: the exact binary value rounded, an exact tie to even. At one
 * decimal the only exact ties are quarters (x.25, x.75), since x.x5 is not representable
 * otherwise; `toFixed` rounds every other value from its exact binary value already.
 */
export function oneDecimal(seconds: number): string {
  const quarters = seconds * 4;
  if (Number.isInteger(quarters) && Math.abs(quarters) % 2 === 1) {
    const tenths = Math.floor(seconds * 10);
    return ((tenths % 2 === 0 ? tenths : tenths + 1) / 10).toFixed(1);
  }
  return seconds.toFixed(1);
}

/** `S1 [12.0-15.5]: text`: the speaker label and times the model copies into evidence. */
export function chunkLine(segment: TranscriptSegment): string {
  return `${segment.speaker} [${oneDecimal(segment.start)}-${oneDecimal(segment.end)}]: ${segment.text}`;
}

/** The chunk as the model sees it, one numbered line per segment (`L1`, `L2`...). */
export function chunkPromptText(chunk: TranscriptChunk): string {
  return chunk.segments.map((segment, offset) => `L${offset + 1} ${chunkLine(segment)}`).join("\n");
}

export interface ChunkBudget {
  readonly targetTokens: number;
  readonly maxTokens: number;
}

/** About 1,500 tokens per chunk, never over 2,000 (Swift `TranscriptChunker.Budget.default`). */
export const DEFAULT_CHUNK_BUDGET: ChunkBudget = { targetTokens: 1_500, maxTokens: 2_000 };

const WHITESPACE = /^[\s\u0085​]+|[\s\u0085​]+$/gu;

/**
 * Splits a diarized transcript into chunks for one model call each (Swift
 * `TranscriptChunker`). Chunks close on speaker-turn boundaries once past the target; a
 * segment is split only when it alone exceeds the maximum, at sentences (or words for one
 * run-on sentence), with times interpolated by character offset.
 */
export class TranscriptChunker {
  constructor(private readonly budget: ChunkBudget = DEFAULT_CHUNK_BUDGET, private readonly counter: TokenCounter = HEURISTIC_TOKENS) {}

  cost(segment: TranscriptSegment): number {
    return this.counter.tokenCount(chunkLine(segment)) + 3;
  }

  chunk(segments: readonly TranscriptSegment[]): TranscriptChunk[] {
    const pieces: Array<{ segment: TranscriptSegment; tokens: number }> = [];
    for (const segment of segments) {
      if (segment.text.replace(WHITESPACE, "") === "") continue;
      const tokens = this.cost(segment);
      if (tokens > this.budget.maxTokens) pieces.push(...this.split(segment));
      else pieces.push({ segment, tokens });
    }
    const chunks: TranscriptChunk[] = [];
    let current: TranscriptSegment[] = [];
    let currentTokens = 0;
    const close = (): void => {
      if (current.length === 0) return;
      chunks.push({ index: chunks.length, segments: current, estimatedTokens: currentTokens });
      current = [];
      currentTokens = 0;
    };
    pieces.forEach((piece, offset) => {
      if (current.length > 0 && currentTokens + piece.tokens > this.budget.maxTokens) close();
      current.push(piece.segment);
      currentTokens += piece.tokens;
      const next = pieces[offset + 1]?.segment;
      const turnEnds = next === undefined || next.speaker !== piece.segment.speaker;
      if (currentTokens >= this.budget.targetTokens && turnEnds) close();
    });
    close();
    return chunks;
  }

  private split(segment: TranscriptSegment): Array<{ segment: TranscriptSegment; tokens: number }> {
    const characters = graphemes(segment.text);
    const total = Math.max(characters.length, 1);
    // Units as grapheme offsets [start, end).
    const sentences = sentenceUnits(segment.text);
    const units: Array<[number, number]> = [];
    for (const unit of sentences.length === 0 ? [[0, characters.length] as [number, number]] : sentences) {
      const probe: TranscriptSegment = { speaker: "S0", start: 0, end: 0, text: characters.slice(unit[0], unit[1]).join("") };
      if (this.cost(probe) > this.budget.maxTokens) units.push(...wordUnits(characters, unit));
      else units.push(unit);
    }
    const piece = (start: number, end: number): TranscriptSegment => {
      const duration = segment.end - segment.start;
      return {
        speaker: segment.speaker,
        start: segment.start + duration * (start / total),
        end: segment.start + duration * (end / total),
        text: characters.slice(start, end).join("").replace(WHITESPACE, ""),
      };
    };
    const output: Array<{ segment: TranscriptSegment; tokens: number }> = [];
    let pendingStart: number | null = null;
    let pendingEnd: number | null = null;
    const flush = (): void => {
      if (pendingStart === null || pendingEnd === null) return;
      const candidate = piece(pendingStart, pendingEnd);
      output.push({ segment: candidate, tokens: this.cost(candidate) });
      pendingStart = null;
      pendingEnd = null;
    };
    for (const [start, end] of units) {
      if (pendingStart !== null) {
        if (this.cost(piece(pendingStart, end)) > this.budget.maxTokens) {
          flush();
          pendingStart = start;
        }
      } else {
        pendingStart = start;
      }
      pendingEnd = end;
    }
    flush();
    return output;
  }
}

const sentenceSegmenter = new Intl.Segmenter("en", { granularity: "sentence" });
const wordSegmenter = new Intl.Segmenter("en", { granularity: "word" });

/** Sentence ranges in grapheme offsets (Foundation `.bySentences`, both ICU). */
function sentenceUnits(text: string): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  let at = 0;
  for (const { segment } of sentenceSegmenter.segment(text)) {
    const length = graphemes(segment).length;
    out.push([at, at + length]);
    at += length;
  }
  return out;
}

/** Each word from its start to the next word's start (Foundation `.byWords` with its enclosing range). */
function wordUnits(characters: readonly string[], [from, to]: [number, number]): Array<[number, number]> {
  const text = characters.slice(from, to).join("");
  const starts: number[] = [];
  let at = from;
  for (const part of wordSegmenter.segment(text)) {
    if (part.isWordLike === true) starts.push(at);
    at += graphemes(part.segment).length;
  }
  return starts.map((start, index) => [start, starts[index + 1] ?? to] as [number, number]);
}
