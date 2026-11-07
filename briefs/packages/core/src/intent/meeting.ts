import { asLanaId } from "../ids/codec.js";
import type { LanaId } from "../ids/lanaId.js";
import { LanaDate } from "../json/lanaDate.js";
import type { JsonObject, JsonValue } from "../json/jsonValue.js";
import { arrayOf, asDate, asNumber, asObject, asString, field, optional } from "../json/read.js";
import { decodeIntent, encodeIntent, type Intent } from "./intent.js";
import { decodeMeetingSync, encodeMeetingSync, type MeetingSync } from "./meetingSync.js";
import type { SourceSpan } from "./keyPoint.js";
import {
  decodeConsent, decodeNotes, decodeProvenance, decodeSegment, decodeSpeaker,
  encodeConsent, encodeNotes, encodeProvenance, encodeSegment, encodeSpeaker,
  speakerDisplayName,
  type ConsentRecord, type MeetingNotes, type Provenance, type Speaker, type TranscriptSegment,
} from "./meetingParts.js";
import { decodeTranscriptClip, encodeTranscriptClip, type TranscriptClip } from "./transcriptClip.js";
import { decodeUserNote, encodeUserNote, type UserNote } from "./userNote.js";

export const MEETING_SCHEMA = "lana.meeting/v1";

/** Everything the phone produced for one meeting, minus audio: `meeting.json` in a bundle. */
export interface MeetingRecord {
  /** Kept as received; Swift does not check it on decode. */
  readonly schema: string;
  readonly id: LanaId;
  readonly title: string;
  readonly startedAt: Date;
  readonly durationSeconds: number;
  readonly speakers: readonly Speaker[];
  readonly transcript: readonly TranscriptSegment[];
  readonly notes: MeetingNotes;
  readonly intents: readonly Intent[];
  readonly userNotes: readonly UserNote[];
  readonly clips: readonly TranscriptClip[];
  readonly consent: ConsentRecord;
  readonly provenance: Provenance;
  /** Shared record state (Swift `MeetingRecord.sync`). Absent on records never shared. */
  readonly sync?: MeetingSync | undefined;
}

export function encodeMeeting(meeting: MeetingRecord): JsonObject {
  return {
    schema: meeting.schema,
    id: meeting.id,
    title: meeting.title,
    started_at: LanaDate.format(meeting.startedAt),
    duration_seconds: meeting.durationSeconds,
    speakers: meeting.speakers.map(encodeSpeaker),
    transcript: meeting.transcript.map(encodeSegment),
    notes: encodeNotes(meeting.notes),
    intents: meeting.intents.map(encodeIntent),
    user_notes: meeting.userNotes.map(encodeUserNote),
    clips: meeting.clips.map(encodeTranscriptClip),
    consent: encodeConsent(meeting.consent),
    provenance: encodeProvenance(meeting.provenance),
    sync: meeting.sync === undefined ? undefined : encodeMeetingSync(meeting.sync),
  };
}

/** Older phone builds omit `user_notes` and `clips`; both default to empty. */
export function decodeMeeting(value: JsonValue, path = "meeting"): MeetingRecord {
  const object = asObject(value, path);
  return {
    schema: field(object, "schema", path, asString),
    id: field(object, "id", path, asLanaId),
    title: field(object, "title", path, asString),
    startedAt: field(object, "started_at", path, asDate),
    durationSeconds: field(object, "duration_seconds", path, asNumber),
    speakers: field(object, "speakers", path, arrayOf(decodeSpeaker)),
    transcript: field(object, "transcript", path, arrayOf(decodeSegment)),
    notes: field(object, "notes", path, decodeNotes),
    intents: field(object, "intents", path, arrayOf((v, p) => decodeIntent(v, p))),
    userNotes: optional(object, "user_notes", path, arrayOf(decodeUserNote)) ?? [],
    clips: optional(object, "clips", path, arrayOf(decodeTranscriptClip)) ?? [],
    consent: field(object, "consent", path, decodeConsent),
    provenance: field(object, "provenance", path, decodeProvenance),
    sync: optional(object, "sync", path, decodeMeetingSync),
  };
}

/** Transcript turns overlapping `span`. */
export function segmentsIn(meeting: MeetingRecord, span: SourceSpan): TranscriptSegment[] {
  return meeting.transcript.filter((segment) => segment.end > span.start && segment.start < span.end);
}

export function displayNameFor(meeting: MeetingRecord, speakerID: string): string {
  const speaker = meeting.speakers.find((candidate) => candidate.id === speakerID);
  return speaker === undefined ? speakerID : speakerDisplayName(speaker);
}
