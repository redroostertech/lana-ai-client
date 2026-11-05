import { LanaDate } from "../json/lanaDate.js";
import type { JsonObject, JsonValue } from "../json/jsonValue.js";
import { asDate, asNumber, asObject, asString, field } from "../json/read.js";
import type { TranscriptSegment } from "./meetingParts.js";

/** A stretch of the transcript the person marked, kept by time rather than line number. */
export interface TranscriptClip {
  readonly id: string;
  readonly start: number;
  readonly end: number;
  readonly createdAt: Date;
}

/** Seconds of slack for times that went through rounding. */
const TOLERANCE = 0.01;

/** Mirrors the Swift initializer, which orders `start` and `end`. Decoding does not reorder. */
export function transcriptClip(id: string, start: number, end: number, createdAt: Date): TranscriptClip {
  return { id, start: Math.min(start, end), end: Math.max(start, end), createdAt };
}

/** The clip spanning `segments`, or undefined for none. */
export function clipCovering(id: string, segments: readonly TranscriptSegment[], createdAt: Date): TranscriptClip | undefined {
  if (segments.length === 0) return undefined;
  const start = Math.min(...segments.map((segment) => segment.start));
  const end = Math.max(...segments.map((segment) => segment.end));
  return transcriptClip(id, start, end, createdAt);
}

/** Whether a line belongs to the clip: it starts inside it. */
export function clipContains(clip: TranscriptClip, segment: TranscriptSegment): boolean {
  return segment.start >= clip.start - TOLERANCE && segment.start < clip.end - TOLERANCE;
}

export function clipLineIndices(clip: TranscriptClip, transcript: readonly TranscriptSegment[]): number[] {
  return transcript.flatMap((segment, index) => (clipContains(clip, segment) ? [index] : []));
}

export function encodeTranscriptClip(clip: TranscriptClip): JsonObject {
  return { id: clip.id, start: clip.start, end: clip.end, created_at: LanaDate.format(clip.createdAt) };
}

export function decodeTranscriptClip(value: JsonValue, path: string): TranscriptClip {
  const object = asObject(value, path);
  return {
    id: field(object, "id", path, asString),
    start: field(object, "start", path, asNumber),
    end: field(object, "end", path, asNumber),
    createdAt: field(object, "created_at", path, asDate),
  };
}
