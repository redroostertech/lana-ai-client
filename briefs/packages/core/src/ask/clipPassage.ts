import { displayNameFor, type MeetingRecord } from "../intent/meeting.js";
import { clipLineIndices, type TranscriptClip } from "../intent/transcriptClip.js";
import type { Passage } from "./passage.js";

/**
 * A clip of the transcript as an Ask passage: its lines with who said them (Swift
 * `ClipPassage`). Pinned to a chat started from the clip, so LANA reads it first.
 */
export function clipPassage(clip: TranscriptClip, meeting: MeetingRecord): Passage | undefined {
  const lines = clipLineIndices(clip, meeting.transcript).map((index) => meeting.transcript[index]!);
  if (lines.length === 0) return undefined;
  return {
    id: `clip-${clip.id}`,
    meetingID: meeting.id,
    meetingTitle: meeting.title,
    meetingDate: meeting.startedAt,
    kind: "transcript",
    start: clip.start,
    end: clip.end,
    speakers: [...new Set(lines.map((line) => line.speaker))].sort(),
    text: lines.map((line) => `${displayNameFor(meeting, line.speaker)}: ${line.text}`).join("\n"),
  };
}
