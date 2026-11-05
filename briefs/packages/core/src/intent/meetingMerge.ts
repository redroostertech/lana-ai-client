import { utf8 } from "../bytes/utf8.js";
import { sha256Hex } from "../crypto/digest.js";
import { canonicalString } from "../json/canonical.js";
import type { JsonValue } from "../json/jsonValue.js";
import { decodeIntent, encodeIntent } from "./intent.js";
import { encodeMeeting, type MeetingRecord } from "./meeting.js";
import {
  clockBumped, clockEquals, clockIncludes, clockJoined, EMPTY_SYNC, ZERO_CLOCK,
  type MeetingSync, type RecordConflict, type RecordSide, type UnitClock,
} from "./meetingSync.js";
import { parseUnit, rebuildRecord, recordUnits } from "./recordUnits.js";

/**
 * Swift `MeetingMerge`: merges, stamps and reconciles copies of one shared meeting
 * record. Checked against Swift golden vectors (`fixtures/golden/sync.json`). See
 * docs/ARCHITECTURE.md, "Shared meeting record".
 */
export function mergeRecords(phone: MeetingRecord, desktop: MeetingRecord): MeetingRecord {
  const phoneSync = phone.sync ?? EMPTY_SYNC;
  const desktopSync = desktop.sync ?? EMPTY_SYNC;
  const phoneUnits = recordUnits(phone);
  const desktopUnits = recordUnits(desktop);
  const keys = new Set([...phoneUnits.keys(), ...desktopUnits.keys(), ...Object.keys(phoneSync.clock), ...Object.keys(desktopSync.clock)]);

  const units = new Map<string, string>();
  const clock: Record<string, UnitClock> = {};
  const conflicts = new Map<string, RecordConflict>();
  for (const unit of [...keys].sort()) {
    const phoneClock = phoneSync.clock[unit] ?? ZERO_CLOCK;
    const desktopClock = desktopSync.clock[unit] ?? ZERO_CLOCK;
    const phoneValue = phoneUnits.get(unit);
    const desktopValue = desktopUnits.get(unit);
    const joined = clockJoined(phoneClock, desktopClock);
    let value = desktopValue;
    if (phoneValue === desktopValue) {
      value = desktopValue;
    } else if (!clockEquals(phoneClock, desktopClock) && clockIncludes(phoneClock, desktopClock)) {
      value = phoneValue;
    } else if (!clockEquals(phoneClock, desktopClock) && clockIncludes(desktopClock, phoneClock)) {
      value = desktopValue;
    } else if (unit.startsWith("intent/") && phoneValue !== undefined && desktopValue !== undefined && sameExceptStatus(phoneValue, desktopValue)) {
      value = desktopValue;
    } else {
      conflicts.set(unit, { unit, phone: unitJson(phoneValue), desktop: unitJson(desktopValue), clock: joined });
    }
    if (value !== undefined) units.set(unit, value);
    if (!clockEquals(joined, ZERO_CLOCK)) clock[unit] = joined;
  }
  // A conflict found earlier stays until a choice moves the unit's clock past it.
  for (const conflict of [...desktopSync.conflicts, ...phoneSync.conflicts]) {
    if (!conflicts.has(conflict.unit) && clockEquals(clock[conflict.unit] ?? ZERO_CLOCK, conflict.clock)) conflicts.set(conflict.unit, conflict);
  }
  const sync: MeetingSync = {
    revision: Math.max(phoneSync.revision, desktopSync.revision),
    clock,
    conflicts: [...conflicts.values()].sort((a, b) => (a.unit < b.unit ? -1 : a.unit > b.unit ? 1 : 0)),
    outcomes: [],
  };
  return rebuildRecord({ ...phone, sync }, units);
}

/** Merges an incoming copy into the local one; the revision moves past both only when the result is new. */
export function reconcileRecords(local: MeetingRecord, incoming: MeetingRecord, localSide: RecordSide): MeetingRecord {
  const merged = localSide === "phone" ? mergeRecords(local, incoming) : mergeRecords(incoming, local);
  const hash = contentHash(merged);
  if (hash !== contentHash(local) && hash !== contentHash(incoming)) {
    return { ...merged, sync: { ...(merged.sync ?? EMPTY_SYNC), revision: (merged.sync?.revision ?? 0) + 1 } };
  }
  return merged;
}

/** One side's edits: changed units get that side's counter bumped, their conflicts settle, revision + 1. */
export function stampRecord(old: MeetingRecord, next: MeetingRecord, side: RecordSide): MeetingRecord {
  const before = recordUnits(old);
  const after = recordUnits(next);
  const base = old.sync ?? EMPTY_SYNC;
  const clock: Record<string, UnitClock> = { ...base.clock };
  const changed = new Set([...before.keys(), ...after.keys()].filter((unit) => before.get(unit) !== after.get(unit)));
  for (const unit of changed) clock[unit] = clockBumped(clock[unit] ?? ZERO_CLOCK, side);
  const sync: MeetingSync = {
    ...base,
    revision: base.revision + (changed.size > 0 ? 1 : 0),
    clock,
    conflicts: base.conflicts.filter((conflict) => !changed.has(conflict.unit)),
  };
  return rebuildRecord({ ...next, sync }, after);
}

/** The person's choice for a unit: `value` (`null` deletes), the chooser's counter moves past the conflict. */
export function resolveUnit(record: MeetingRecord, unit: string, value: JsonValue, side: RecordSide): MeetingRecord {
  const units = recordUnits(record);
  if (value === null) units.delete(unit);
  else units.set(unit, canonicalString(value));
  const base = record.sync ?? EMPTY_SYNC;
  const sync: MeetingSync = {
    ...base,
    revision: base.revision + 1,
    clock: { ...base.clock, [unit]: clockBumped(base.clock[unit] ?? ZERO_CLOCK, side) },
    conflicts: base.conflicts.filter((conflict) => conflict.unit !== unit),
  };
  return rebuildRecord({ ...record, sync }, units);
}

/** SHA-256 hex of the canonical record with `sync.revision` 0 (Swift `MeetingMerge.contentHash`). */
export function contentHash(record: MeetingRecord): string {
  const sync = { ...(record.sync ?? EMPTY_SYNC), revision: 0 };
  return sha256Hex(utf8(canonicalString(encodeMeeting({ ...record, sync }))));
}

function sameExceptStatus(phone: string, desktop: string): boolean {
  const phoneIntent = decodeIntent(parseUnit(phone));
  const desktopIntent = decodeIntent(parseUnit(desktop));
  return canonicalString(encodeIntent({ ...phoneIntent, status: desktopIntent.status })) === desktop;
}

function unitJson(value: string | undefined): JsonValue {
  return value === undefined ? null : parseUnit(value);
}
