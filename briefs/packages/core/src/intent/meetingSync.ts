import { asLanaId } from "../ids/codec.js";
import type { LanaId } from "../ids/lanaId.js";
import type { JsonObject, JsonValue } from "../json/jsonValue.js";
import { arrayOf, asInt, asObject, asString, field, optional } from "../json/read.js";

/** Which copy of a shared meeting record made a change (Swift `RecordSide`). */
export type RecordSide = "phone" | "desktop";

/** How many times each side changed one unit (Swift `UnitClock`). */
export interface UnitClock {
  readonly phone: number;
  readonly desktop: number;
}

export const ZERO_CLOCK: UnitClock = { phone: 0, desktop: 0 };

export function clockIncludes(a: UnitClock, b: UnitClock): boolean {
  return a.phone >= b.phone && a.desktop >= b.desktop;
}

export function clockJoined(a: UnitClock, b: UnitClock): UnitClock {
  return { phone: Math.max(a.phone, b.phone), desktop: Math.max(a.desktop, b.desktop) };
}

export function clockEquals(a: UnitClock, b: UnitClock): boolean {
  return a.phone === b.phone && a.desktop === b.desktop;
}

export function clockBumped(clock: UnitClock, side: RecordSide): UnitClock {
  return side === "phone" ? { phone: clock.phone + 1, desktop: clock.desktop } : { phone: clock.phone, desktop: clock.desktop + 1 };
}

/** One unit both sides changed (Swift `RecordConflict`). `null` means that side deleted it. */
export interface RecordConflict {
  readonly unit: string;
  readonly phone: JsonValue;
  readonly desktop: JsonValue;
  readonly clock: UnitClock;
}

/** Where an executed action landed, as the desktop reports it (Swift `ActionOutcome`). */
export interface ActionOutcome {
  readonly intentID: LanaId;
  /** "Clio" or "Outlook". */
  readonly destination: string;
  readonly recordName?: string | undefined;
  readonly recordURL?: string | undefined;
}

/** `MeetingRecord.sync` (Swift `MeetingSync`). */
export interface MeetingSync {
  readonly revision: number;
  readonly clock: Readonly<Record<string, UnitClock>>;
  readonly conflicts: readonly RecordConflict[];
  readonly outcomes: readonly ActionOutcome[];
}

export const EMPTY_SYNC: MeetingSync = { revision: 0, clock: {}, conflicts: [], outcomes: [] };

function encodeClock(clock: UnitClock): JsonObject {
  return { phone: clock.phone, desktop: clock.desktop };
}

function decodeClock(value: JsonValue, path: string): UnitClock {
  const object = asObject(value, path);
  return { phone: field(object, "phone", path, asInt), desktop: field(object, "desktop", path, asInt) };
}

export function encodeOutcome(outcome: ActionOutcome): JsonObject {
  return { intent_id: outcome.intentID, destination: outcome.destination, record_name: outcome.recordName, record_url: outcome.recordURL };
}

export function decodeOutcome(value: JsonValue, path: string): ActionOutcome {
  const object = asObject(value, path);
  return {
    intentID: field(object, "intent_id", path, asLanaId),
    destination: field(object, "destination", path, asString),
    recordName: optional(object, "record_name", path, asString),
    recordURL: optional(object, "record_url", path, asString),
  };
}

export function encodeMeetingSync(sync: MeetingSync): JsonObject {
  const clock: Record<string, JsonValue> = {};
  for (const [unit, value] of Object.entries(sync.clock)) clock[unit] = encodeClock(value);
  return {
    revision: sync.revision,
    clock,
    conflicts: sync.conflicts.map((conflict) => ({ unit: conflict.unit, phone: conflict.phone, desktop: conflict.desktop, clock: encodeClock(conflict.clock) })),
    outcomes: sync.outcomes.map(encodeOutcome),
  };
}

export function decodeMeetingSync(value: JsonValue, path: string): MeetingSync {
  const object = asObject(value, path);
  const clockObject = field(object, "clock", path, asObject);
  const clock: Record<string, UnitClock> = {};
  for (const [unit, entry] of Object.entries(clockObject)) {
    if (entry !== undefined) clock[unit] = decodeClock(entry, `${path}.clock.${unit}`);
  }
  return {
    revision: field(object, "revision", path, asInt),
    clock,
    conflicts: field(object, "conflicts", path, arrayOf((item, itemPath) => {
      const conflict = asObject(item, itemPath);
      return {
        unit: field(conflict, "unit", itemPath, asString),
        phone: conflict["phone"] ?? null,
        desktop: conflict["desktop"] ?? null,
        clock: field(conflict, "clock", itemPath, decodeClock),
      };
    })),
    outcomes: field(object, "outcomes", path, arrayOf(decodeOutcome)),
  };
}
