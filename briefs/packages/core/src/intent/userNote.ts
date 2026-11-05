import { LanaDate } from "../json/lanaDate.js";
import type { JsonObject, JsonValue } from "../json/jsonValue.js";
import { asDate, asNumber, asObject, asString, field, optional } from "../json/read.js";

/** A note the person typed themselves, optionally anchored to a moment of the audio. */
export interface UserNote {
  readonly id: string;
  readonly text: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  /** Seconds into the recording when typed; undefined for notes added afterwards. */
  readonly anchor?: number | undefined;
}

export const USER_NOTE_MAX_LENGTH = 10_000;

export function encodeUserNote(note: UserNote): JsonObject {
  return {
    id: note.id,
    text: note.text,
    created_at: LanaDate.format(note.createdAt),
    updated_at: LanaDate.format(note.updatedAt),
    anchor: note.anchor,
  };
}

export function decodeUserNote(value: JsonValue, path: string): UserNote {
  const object = asObject(value, path);
  return {
    id: field(object, "id", path, asString),
    text: field(object, "text", path, asString),
    createdAt: field(object, "created_at", path, asDate),
    updatedAt: field(object, "updated_at", path, asDate),
    anchor: optional(object, "anchor", path, asNumber),
  };
}
