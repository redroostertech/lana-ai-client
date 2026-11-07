import { trimWhitespace } from "../text/whitespace.js";
import type { KeyPoint } from "./keyPoint.js";
import type { TranscriptSegment } from "./meetingParts.js";
import { clipCovering, clipLineIndices, type TranscriptClip } from "./transcriptClip.js";

/**
 * The rules for clips and what is made from them, shared by every screen that clips
 * (Swift `ReviewViewModel` clip methods). Pure: callers save the result through the shared
 * record, so each change syncs to the phone.
 */

/** The transcript lines `first` through `last` (inclusive, in either order), in order. */
export function linesBetween(transcript: readonly TranscriptSegment[], first: number, last: number): TranscriptSegment[] {
  const low = Math.max(0, Math.min(first, last));
  const high = Math.min(transcript.length - 1, Math.max(first, last));
  return high < low ? [] : transcript.slice(low, high + 1);
}

/** Clips in a fixed order: by start, then id (the record's unit order). */
export function sortedClips(clips: readonly TranscriptClip[]): TranscriptClip[] {
  return [...clips].sort((a, b) => (a.start === b.start ? (a.id < b.id ? -1 : a.id > b.id ? 1 : 0) : a.start - b.start));
}

/**
 * Saves lines `first`...`last` as a clip. A clip already covering exactly those lines is
 * returned unchanged; a new clip replaces any clip it overlaps, so highlights never stack.
 * Undefined when the range holds no line.
 */
export function savingClip(
  clips: readonly TranscriptClip[], transcript: readonly TranscriptSegment[], first: number, last: number, id: string, now: Date,
): { clips: TranscriptClip[]; clip: TranscriptClip } | undefined {
  const clip = clipCovering(id, linesBetween(transcript, first, last), now);
  if (clip === undefined) return undefined;
  const low = Math.min(first, last);
  const high = Math.max(first, last);
  const wanted = Array.from({ length: high - low + 1 }, (_, offset) => low + offset).join(",");
  const existing = clips.find((item) => clipLineIndices(item, transcript).join(",") === wanted);
  if (existing !== undefined) return { clips: sortedClips(clips), clip: existing };
  const kept = clips.filter((item) => item.end <= clip.start || item.start >= clip.end);
  return { clips: sortedClips([...kept, clip]), clip };
}

export function removingClip(clips: readonly TranscriptClip[], id: string): TranscriptClip[] {
  return clips.filter((clip) => clip.id !== id);
}

/** Adds a reviewed decision to the key points; a blank one changes nothing, the same id is replaced. */
export function addingDecision(keyPoints: readonly KeyPoint[], point: KeyPoint, text: string): KeyPoint[] {
  const trimmed = trimWhitespace(text);
  if (trimmed === "") return [...keyPoints];
  return [...keyPoints.filter((item) => item.id !== point.id), { ...point, text: trimmed }];
}
