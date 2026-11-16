import { utf8 } from "../bytes/utf8.js";
import { canonicalString } from "../json/canonical.js";
import { parseJson } from "../json/parse.js";
import { SET_ASIDE_REASONS, type SetAsidePart } from "../intent/meetingParts.js";
import type { SettingsReader, SettingsWriter } from "./handoffSettings.js";

/**
 * The person's own set-aside choices for one meeting, kept on this computer so writing the
 * notes again respects them: parts they restored (not set aside again) and ranges they set
 * aside themselves. The meeting's `set_aside` itself is in the shared record.
 */
export interface StoredSetAsideChoices {
  readonly restored: Array<{ start: number; end: number }>;
  readonly added: SetAsidePart[];
}

const key = (meetingID: string): string => `notes.set_aside_choices.${meetingID}`;
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

export function loadSetAsideChoices(store: SettingsReader, meetingID: string): StoredSetAsideChoices {
  const raw = store.get(key(meetingID));
  const empty = { restored: [], added: [] };
  if (raw === null) return empty;
  try {
    const value = parseJson(utf8(raw)) as { restored?: unknown; added?: unknown };
    const restored = (Array.isArray(value.restored) ? value.restored : []).flatMap((item: { start?: unknown; end?: unknown }) =>
      finite(item?.start) && finite(item?.end) ? [{ start: item.start, end: item.end }] : []);
    const added = (Array.isArray(value.added) ? value.added : []).flatMap((item: { start?: unknown; end?: unknown; reason?: unknown }) =>
      finite(item?.start) && finite(item?.end) && (SET_ASIDE_REASONS as readonly unknown[]).includes(item?.reason)
        ? [{ start: item.start, end: item.end, reason: item.reason as SetAsidePart["reason"] }] : []);
    return { restored, added };
  } catch {
    return empty;
  }
}

function save(store: SettingsWriter, meetingID: string, choices: StoredSetAsideChoices): void {
  store.set(key(meetingID), canonicalString({ restored: choices.restored, added: choices.added.map((part) => ({ start: part.start, end: part.end, reason: part.reason })) }));
}

const overlaps = (a: { start: number; end: number }, b: { start: number; end: number }): boolean => Math.min(a.end, b.end) - Math.max(a.start, b.start) > 0;

/** The person restored this part: it is not set aside again, and any range they added over it goes. */
export function restoreSetAsideChoice(store: SettingsWriter, meetingID: string, part: { start: number; end: number }): void {
  const current = loadSetAsideChoices(store, meetingID);
  save(store, meetingID, {
    restored: [...current.restored.filter((item) => !overlaps(item, part)), { start: part.start, end: part.end }],
    added: current.added.filter((item) => !overlaps(item, part)),
  });
}

/** The person set this range aside: it stays aside, and an earlier restore over it no longer applies. */
export function addSetAsideChoice(store: SettingsWriter, meetingID: string, part: SetAsidePart): void {
  const current = loadSetAsideChoices(store, meetingID);
  save(store, meetingID, {
    restored: current.restored.filter((item) => !overlaps(item, part)),
    added: [...current.added.filter((item) => !overlaps(item, part)), { start: part.start, end: part.end, reason: part.reason }],
  });
}
