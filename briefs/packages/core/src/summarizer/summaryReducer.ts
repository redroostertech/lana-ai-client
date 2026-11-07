import { INTENT_LIMITS } from "../intent/validator.js";
import type { Intent } from "../intent/intent.js";
import { KEY_POINT_KINDS, type KeyPoint, type KeyPointKind, type KeyPointPrecision, type SourceSpan } from "../intent/keyPoint.js";
import type { MeetingNotes, NotesGap, TranscriptSegment } from "../intent/meetingParts.js";
import { regardingOf, titleOf } from "../intent/params.js";
import type { EntityHint } from "../intent/entityHint.js";
import { normalizeText, textSimilarity } from "./textNormalizer.js";

/** Swift `MeetingSummarizer.Limits`. */
export interface SummaryLimits {
  readonly runningSummaryTokens: number;
  readonly maxSummaryBullets: number;
  readonly maxDecisions: number;
  readonly maxOpenQuestions: number;
  readonly maxIntents: number;
  readonly titleSimilarityThreshold: number;
  readonly noteSimilarityThreshold: number;
}

export const DEFAULT_SUMMARY_LIMITS: SummaryLimits = {
  runningSummaryTokens: 150,
  maxSummaryBullets: 12,
  maxDecisions: 10,
  maxOpenQuestions: 10,
  maxIntents: 20,
  titleSimilarityThreshold: 0.7,
  noteSimilarityThreshold: 0.8,
};

/** A verified point before ids are assigned. */
export interface DraftPoint {
  readonly kind: KeyPointKind;
  readonly text: string;
  readonly sources: readonly SourceSpan[];
  readonly precision: KeyPointPrecision;
}

const WHITESPACE = /^[\s\u0085​]+|[\s\u0085​]+$/gu;

/** Swift `SpanBuilder.spans`: cited turns as ordered spans; same-speaker turns within `joinGap` join. */
export function spansFor(segments: readonly TranscriptSegment[], joinGap = 2): SourceSpan[] {
  const spans: SourceSpan[] = [];
  for (const segment of [...segments].sort((a, b) => a.start - b.start)) {
    const last = spans.at(-1);
    if (last !== undefined && last.speaker === segment.speaker && segment.start - last.end <= joinGap) {
      spans[spans.length - 1] = { start: last.start, end: Math.max(last.end, segment.end), speaker: last.speaker };
    } else if (last !== undefined && segment.start < last.end) {
      spans[spans.length - 1] = { start: last.start, end: Math.max(last.end, segment.end), speaker: last.speaker === segment.speaker ? last.speaker : undefined };
    } else {
      spans.push({ start: segment.start, end: segment.end, speaker: segment.speaker });
    }
  }
  return spans;
}

/** Swift `SummaryReducer.union`. */
export function unionSpans(left: readonly SourceSpan[], right: readonly SourceSpan[]): SourceSpan[] {
  const out: SourceSpan[] = [];
  for (const span of [...left, ...right].sort((a, b) => a.start - b.start)) {
    const last = out.at(-1);
    if (last !== undefined && span.start <= last.end) out[out.length - 1] = { start: last.start, end: Math.max(last.end, span.end), speaker: last.speaker === span.speaker ? last.speaker : undefined };
    else out.push(span);
  }
  return out;
}

/** Near-identical points of one kind merge (keeping every source), each kind is capped, then numbered `kp-1`... */
export function reduceKeyPoints(drafts: readonly DraftPoint[], gaps: readonly NotesGap[], limits: SummaryLimits = DEFAULT_SUMMARY_LIMITS): MeetingNotes {
  const merged: Array<{ kind: KeyPointKind; text: string; sources: SourceSpan[]; precision: KeyPointPrecision }> = [];
  for (const raw of drafts) {
    const text = raw.text.replace(WHITESPACE, "");
    if (text === "" || raw.sources.length === 0) continue;
    const index = merged.findIndex((point) => point.kind === raw.kind && textSimilarity(point.text, text) >= limits.noteSimilarityThreshold);
    if (index >= 0) {
      const existing = merged[index]!;
      existing.sources = unionSpans(existing.sources, raw.sources);
      if (raw.precision === "approximate") existing.precision = "approximate";
    } else {
      merged.push({ kind: raw.kind, text, sources: [...raw.sources], precision: raw.precision });
    }
  }
  const caps: Record<KeyPointKind, number> = { summary: limits.maxSummaryBullets, decision: limits.maxDecisions, open_question: limits.maxOpenQuestions };
  const ordered = KEY_POINT_KINDS.flatMap((kind) =>
    stableSort(merged.filter((point) => point.kind === kind).slice(0, caps[kind]), (a, b) => (a.sources[0]?.start ?? 0) - (b.sources[0]?.start ?? 0)));
  const keyPoints: KeyPoint[] = ordered.map((point, offset) => ({ id: `kp-${offset + 1}`, kind: point.kind, text: point.text, sources: point.sources, precision: point.precision }));
  return { keyPoints, gaps: [...gaps] };
}

/** Merged intents (same idempotency key, or same type, same entity and similar titles) and how many the cap removed. */
export function reduceIntents(intents: readonly Intent[], limits: SummaryLimits = DEFAULT_SUMMARY_LIMITS): { intents: Intent[]; capped: number } {
  const kept: Intent[] = [];
  for (const intent of intents) {
    const index = kept.findIndex((existing) => isDuplicate(existing, intent, limits));
    if (index >= 0) kept[index] = mergeIntents(kept[index]!, intent);
    else kept.push(intent);
  }
  if (kept.length <= limits.maxIntents) return { intents: kept, capped: 0 };
  const survivors = new Set(stableSort(kept, (a, b) => b.confidence - a.confidence).slice(0, limits.maxIntents).map((intent) => intent.id));
  const capped = kept.filter((intent) => survivors.has(intent.id));
  return { intents: capped, capped: kept.length - capped.length };
}

export function isDuplicate(left: Intent, right: Intent, limits: SummaryLimits = DEFAULT_SUMMARY_LIMITS): boolean {
  if (left.idempotencyKey === right.idempotencyKey) return true;
  if (left.type !== right.type || !sameEntity(regardingOf(left.params), regardingOf(right.params))) return false;
  return textSimilarity(titleOf(left.params), titleOf(right.params)) >= limits.titleSimilarityThreshold;
}

/** Different entity names never merge: deciding that is the resolver's job, with a person. */
function sameEntity(left: EntityHint | undefined, right: EntityHint | undefined): boolean {
  if (left === undefined || right === undefined) return left === right;
  return normalizeText(left.name) === normalizeText(right.name);
}

function mergeIntents(first: Intent, second: Intent): Intent {
  const evidence = [...first.evidence];
  const seen = new Set(evidence.map((item) => `${item.speaker}|${normalizeText(item.quote)}`));
  for (const item of second.evidence) {
    if (evidence.length >= INTENT_LIMITS.maxEvidence) break;
    const key = `${item.speaker}|${normalizeText(item.quote)}`;
    if (!seen.has(key)) {
      seen.add(key);
      evidence.push(item);
    }
  }
  return { ...first, confidence: Math.max(first.confidence, second.confidence), evidence };
}

/** `Array.sort` is stable in JavaScript; Swift's `sorted` is not guaranteed to be. Kept explicit. */
function stableSort<T>(items: readonly T[], compare: (a: T, b: T) => number): T[] {
  return items.map((item, index) => ({ item, index })).sort((a, b) => compare(a.item, b.item) || a.index - b.index).map((entry) => entry.item);
}
