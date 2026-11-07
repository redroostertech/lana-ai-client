import type { JsonObject, JsonValue } from "../json/jsonValue.js";
import { arrayOf, asEnum, asNumber, asObject, asString, field, optional } from "../json/read.js";

/** A stretch of the recording a note was derived from, in seconds. */
export interface SourceSpan {
  readonly start: number;
  readonly end: number;
  /** Diarization label (`S1`) when the span is one speaker's turn. */
  readonly speaker?: string | undefined;
}

export const KEY_POINT_KINDS = ["summary", "decision", "open_question"] as const;
export type KeyPointKind = (typeof KEY_POINT_KINDS)[number];
export const KEY_POINT_PRECISIONS = ["exact", "approximate"] as const;
export type KeyPointPrecision = (typeof KEY_POINT_PRECISIONS)[number];

/** One AI-written note, attributed to the parts of the meeting it came from. */
export interface KeyPoint {
  readonly id: string;
  readonly kind: KeyPointKind;
  readonly text: string;
  readonly sources: readonly SourceSpan[];
  readonly precision: KeyPointPrecision;
}

/** Mirrors the Swift initializer, which clamps `end` to at least `start`. Decoding does not clamp. */
export function sourceSpan(start: number, end: number, speaker?: string): SourceSpan {
  return { start, end: Math.max(start, end), speaker };
}

export function encodeSourceSpan(span: SourceSpan): JsonObject {
  return { start: span.start, end: span.end, speaker: span.speaker };
}

export function decodeSourceSpan(value: JsonValue, path: string): SourceSpan {
  const object = asObject(value, path);
  return {
    start: field(object, "start", path, asNumber),
    end: field(object, "end", path, asNumber),
    speaker: optional(object, "speaker", path, asString),
  };
}

export function encodeKeyPoint(point: KeyPoint): JsonObject {
  return { id: point.id, kind: point.kind, text: point.text, sources: point.sources.map(encodeSourceSpan), precision: point.precision };
}

export function decodeKeyPoint(value: JsonValue, path: string): KeyPoint {
  const object = asObject(value, path);
  return {
    id: field(object, "id", path, asString),
    kind: field(object, "kind", path, (v, p) => asEnum(v, KEY_POINT_KINDS, p)),
    text: field(object, "text", path, asString),
    sources: field(object, "sources", path, arrayOf(decodeSourceSpan)),
    precision: field(object, "precision", path, (v, p) => asEnum(v, KEY_POINT_PRECISIONS, p)),
  };
}

/** Earliest moment the note points at. */
export function keyPointStart(point: KeyPoint): number {
  return point.sources.length === 0 ? 0 : Math.min(...point.sources.map((span) => span.start));
}
