import type { LanaId } from "../ids/lanaId.js";
import { MEETING_SCHEMA, type MeetingRecord } from "../intent/meeting.js";
import type { ConsentRecord, Speaker, TranscriptSegment } from "../intent/meetingParts.js";
import type { UserNote } from "../intent/userNote.js";
import { normalizedDate } from "../store/storedDate.js";
import { AAC_SAMPLES_PER_FRAME, muxM4a } from "./m4a.js";
import { ASR_MODEL_ID, DIARIZATION_MODEL_ID } from "./transcriber.js";

/** The phone's audio format: AAC LC, 48 kHz mono, 64 kbps (`SegmentWriter.swift`). */
export const RECORDING_SAMPLE_RATE = 48_000;
export const RECORDING_BIT_RATE = 64_000;
/** Audio is stored in parts of this length, like the phone's segments (`RecordingLimits.segmentSeconds`). */
export const PART_SECONDS = 120;

export interface LocalRecordInput {
  readonly id: LanaId;
  readonly title: string;
  readonly startedAt: Date;
  readonly durationSeconds: number;
  readonly consent: ConsentRecord;
  readonly userNotes: readonly UserNote[];
  readonly appVersion: string;
  readonly speakers?: readonly Speaker[];
  readonly transcript?: readonly TranscriptSegment[];
}

/**
 * The shared record for a meeting recorded on this computer: the same `lana.meeting/v1`
 * the phone writes, with no notes or actions yet (LANA writes them after transcription).
 */
export function localMeetingRecord(input: LocalRecordInput): MeetingRecord {
  return {
    schema: MEETING_SCHEMA,
    id: input.id,
    title: input.title,
    startedAt: normalizedDate(input.startedAt),
    durationSeconds: Math.round(input.durationSeconds * 1_000) / 1_000,
    speakers: [...(input.speakers ?? [])],
    transcript: [...(input.transcript ?? [])],
    notes: { keyPoints: [], gaps: [] },
    intents: [],
    userNotes: [...input.userNotes],
    clips: [],
    consent: input.consent,
    provenance: { asrModel: ASR_MODEL_ID, diarizationModel: DIARIZATION_MODEL_ID, notesModel: "", appVersion: `desktop ${input.appVersion}` },
  };
}

/** AAC frames cut into stored parts of `PART_SECONDS`, each a complete M4A file named like the phone's. */
export function audioParts(frames: readonly Uint8Array[], audioSpecificConfig?: Uint8Array): Array<{ name: string; data: Uint8Array }> {
  const perPart = Math.round((PART_SECONDS * RECORDING_SAMPLE_RATE) / AAC_SAMPLES_PER_FRAME);
  const parts: Array<{ name: string; data: Uint8Array }> = [];
  for (let at = 0; at < frames.length; at += perPart) {
    const name = `audio/seg-${String(parts.length).padStart(4, "0")}.m4a`;
    parts.push({ name, data: muxM4a({ sampleRate: RECORDING_SAMPLE_RATE, channels: 1, frames: frames.slice(at, at + perPart), audioSpecificConfig, bitRate: RECORDING_BIT_RATE }) });
  }
  return parts;
}
