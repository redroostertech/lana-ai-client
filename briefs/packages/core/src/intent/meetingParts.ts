import { LanaDate } from "../json/lanaDate.js";
import type { JsonObject, JsonValue } from "../json/jsonValue.js";
import { arrayOf, asDate, asEnum, asNumber, asObject, asString, field, optional } from "../json/read.js";
import { isBlankLine } from "../text/whitespace.js";
import { decodeKeyPoint, encodeKeyPoint, type KeyPoint } from "./keyPoint.js";

export interface Speaker {
  /** Stable diarization label, `S1`, `S2`... */
  readonly id: string;
  readonly name?: string | undefined;
}

export interface TranscriptSegment {
  readonly speaker: string;
  readonly start: number;
  readonly end: number;
  readonly text: string;
}

export const NOTES_GAP_REASONS = ["refused", "model_error"] as const;
export type NotesGapReason = (typeof NOTES_GAP_REASONS)[number];

export interface NotesGap {
  readonly start: number;
  readonly end: number;
  readonly reason: NotesGapReason;
}

export interface MeetingNotes {
  readonly keyPoints: readonly KeyPoint[];
  readonly gaps: readonly NotesGap[];
}

export const CONSENT_METHODS = ["verbal_announced", "all_parties_confirmed"] as const;
export type ConsentMethod = (typeof CONSENT_METHODS)[number];

export interface ConsentRecord {
  readonly method: ConsentMethod;
  readonly confirmedBy: readonly string[];
  readonly confirmedAt: Date;
  readonly jurisdictionNote?: string | undefined;
}

export interface Provenance {
  readonly asrModel: string;
  readonly diarizationModel: string;
  readonly notesModel: string;
  readonly appVersion: string;
}

/** The typed name, or the diarization label when none was typed. */
export function speakerDisplayName(speaker: Speaker): string {
  return speaker.name === undefined || isBlankLine(speaker.name) ? speaker.id : speaker.name;
}

export function encodeSpeaker(speaker: Speaker): JsonObject {
  return { id: speaker.id, name: speaker.name };
}

export function decodeSpeaker(value: JsonValue, path: string): Speaker {
  const object = asObject(value, path);
  return { id: field(object, "id", path, asString), name: optional(object, "name", path, asString) };
}

export function encodeSegment(segment: TranscriptSegment): JsonObject {
  return { speaker: segment.speaker, start: segment.start, end: segment.end, text: segment.text };
}

export function decodeSegment(value: JsonValue, path: string): TranscriptSegment {
  const object = asObject(value, path);
  return {
    speaker: field(object, "speaker", path, asString),
    start: field(object, "start", path, asNumber),
    end: field(object, "end", path, asNumber),
    text: field(object, "text", path, asString),
  };
}

export function encodeNotes(notes: MeetingNotes): JsonObject {
  return {
    key_points: notes.keyPoints.map(encodeKeyPoint),
    gaps: notes.gaps.map((gap) => ({ start: gap.start, end: gap.end, reason: gap.reason })),
  };
}

export function decodeNotes(value: JsonValue, path: string): MeetingNotes {
  const object = asObject(value, path);
  return {
    keyPoints: field(object, "key_points", path, arrayOf(decodeKeyPoint)),
    gaps: field(object, "gaps", path, arrayOf(decodeGap)),
  };
}

function decodeGap(value: JsonValue, path: string): NotesGap {
  const object = asObject(value, path);
  return {
    start: field(object, "start", path, asNumber),
    end: field(object, "end", path, asNumber),
    reason: field(object, "reason", path, (v, p) => asEnum(v, NOTES_GAP_REASONS, p)),
  };
}

export function encodeConsent(consent: ConsentRecord): JsonObject {
  return {
    method: consent.method,
    confirmed_by: [...consent.confirmedBy],
    confirmed_at: LanaDate.format(consent.confirmedAt),
    jurisdiction_note: consent.jurisdictionNote,
  };
}

export function decodeConsent(value: JsonValue, path: string): ConsentRecord {
  const object = asObject(value, path);
  return {
    method: field(object, "method", path, (v, p) => asEnum(v, CONSENT_METHODS, p)),
    confirmedBy: field(object, "confirmed_by", path, arrayOf(asString)),
    confirmedAt: field(object, "confirmed_at", path, asDate),
    jurisdictionNote: optional(object, "jurisdiction_note", path, asString),
  };
}

export function encodeProvenance(provenance: Provenance): JsonObject {
  return {
    asr_model: provenance.asrModel,
    diarization_model: provenance.diarizationModel,
    notes_model: provenance.notesModel,
    app_version: provenance.appVersion,
  };
}

export function decodeProvenance(value: JsonValue, path: string): Provenance {
  const object = asObject(value, path);
  return {
    asrModel: field(object, "asr_model", path, asString),
    diarizationModel: field(object, "diarization_model", path, asString),
    notesModel: field(object, "notes_model", path, asString),
    appVersion: field(object, "app_version", path, asString),
  };
}
