import { canonicalString } from "../json/canonical.js";
import type { JsonValue } from "../json/jsonValue.js";
import { parseJson } from "../json/parse.js";
import { utf8 } from "../bytes/utf8.js";
import { decodeIntent, encodeIntent } from "./intent.js";
import { decodeKeyPoint, encodeKeyPoint, keyPointStart } from "./keyPoint.js";
import type { MeetingRecord } from "./meeting.js";
import { decodeNotes, decodeSegment, decodeSpeaker, encodeNotes, encodeSegment, encodeSpeaker, type NotesGap } from "./meetingParts.js";
import { decodeOutcome, EMPTY_SYNC, encodeOutcome } from "./meetingSync.js";
import { decodeTranscriptClip, encodeTranscriptClip } from "./transcriptClip.js";
import { decodeUserNote, encodeUserNote } from "./userNote.js";

/**
 * Swift `RecordUnits`: a record split into the units merged one by one (`title`,
 * `speaker/<id>`, `segment/<index>`, `gaps`, `keypoint/<id>`, `note/<id>`, `clip/<id>`,
 * `intent/<id>`, `outcome/<intent id>`), each as canonical JSON, and rebuilt in a fixed
 * order so both devices produce byte-identical records.
 */
export function recordUnits(record: MeetingRecord): Map<string, string> {
  const units = new Map<string, string>();
  units.set("title", canonicalString(record.title));
  units.set("gaps", canonicalString(encodeNotes({ keyPoints: [], gaps: record.notes.gaps }).gaps ?? []));
  for (const speaker of record.speakers) units.set(`speaker/${speaker.id}`, canonicalString(encodeSpeaker(speaker)));
  record.transcript.forEach((segment, index) => units.set(`segment/${index}`, canonicalString(encodeSegment(segment))));
  for (const point of record.notes.keyPoints) units.set(`keypoint/${point.id}`, canonicalString(encodeKeyPoint(point)));
  for (const note of record.userNotes) units.set(`note/${note.id}`, canonicalString(encodeUserNote(note)));
  for (const clip of record.clips) units.set(`clip/${clip.id}`, canonicalString(encodeTranscriptClip(clip)));
  for (const intent of record.intents) units.set(`intent/${intent.id}`, canonicalString(encodeIntent(intent)));
  for (const outcome of record.sync?.outcomes ?? []) units.set(`outcome/${outcome.intentID}`, canonicalString(encodeOutcome(outcome)));
  return units;
}

export function parseUnit(value: string): JsonValue {
  return parseJson(utf8(value));
}

function values<T>(units: Map<string, string>, prefix: string, decode: (value: JsonValue, path: string) => T): { key: string; value: T }[] {
  const found: { key: string; value: T }[] = [];
  for (const [unit, value] of units) {
    if (unit.startsWith(prefix)) found.push({ key: unit.slice(prefix.length), value: decode(parseUnit(value), unit) });
  }
  return found;
}

const byID = (a: { id: string }, b: { id: string }): number => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** `base` with every unit field replaced from `units` (Swift `RecordUnits.rebuild`). */
export function rebuildRecord(base: MeetingRecord, units: Map<string, string>): MeetingRecord {
  const title = units.get("title");
  const gaps = units.get("gaps");
  const outcomes = values(units, "outcome/", decodeOutcome).map((entry) => entry.value).sort((a, b) => (a.intentID < b.intentID ? -1 : a.intentID > b.intentID ? 1 : 0));
  const sync = base.sync !== undefined || outcomes.length > 0 ? { ...(base.sync ?? EMPTY_SYNC), outcomes } : undefined;
  return {
    ...base,
    title: title === undefined ? base.title : (parseUnit(title) as string),
    speakers: values(units, "speaker/", decodeSpeaker).map((entry) => entry.value).sort(byID),
    transcript: values(units, "segment/", decodeSegment).sort((a, b) => Number(a.key) - Number(b.key)).map((entry) => entry.value),
    notes: {
      gaps: gaps === undefined ? [] : (decodeNotes({ key_points: [], gaps: parseUnit(gaps) }, "gaps").gaps as NotesGap[]),
      keyPoints: values(units, "keypoint/", decodeKeyPoint).map((entry) => entry.value)
        .sort((a, b) => keyPointStart(a) - keyPointStart(b) || byID(a, b)),
    },
    userNotes: values(units, "note/", decodeUserNote).map((entry) => entry.value).sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || byID(a, b)),
    clips: values(units, "clip/", decodeTranscriptClip).map((entry) => entry.value).sort((a, b) => a.start - b.start || byID(a, b)),
    intents: values(units, "intent/", (value, path) => decodeIntent(value, path)).map((entry) => entry.value)
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || byID(a, b)),
    sync,
  };
}

/** The record in the fixed order. */
export function normalizedRecord(record: MeetingRecord): MeetingRecord {
  return rebuildRecord(record, recordUnits(record));
}
