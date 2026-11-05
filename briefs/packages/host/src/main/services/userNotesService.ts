import { parseLanaId } from "@lana/core/ids";
import type { UserNote as CoreUserNote } from "@lana/core/intent";
import { StoreError, type GatewayStore } from "@lana/core/store";
import type { Result, UserNote, UserNotesApi } from "../../shared/api.js";
import type { MainLog } from "../log.js";

/** Longest note id the renderer may send (UUIDs and `note-<time>` ids are far shorter). */
const MAX_ID_LENGTH = 128;

/**
 * "My notes" on a received meeting (Swift `ScratchPadViewModel` saving through
 * `updateUserNotes`): the whole list is replaced, empty notes are dropped, text is cut to
 * `UserNote.maxLength` graphemes by the store and sealed with the meeting record. Note
 * text is never logged.
 */
export class UserNotesService implements UserNotesApi {
  constructor(
    private readonly store: GatewayStore,
    private readonly deviceNoun: string,
    private readonly log: MainLog,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async save(meetingID: string, notes: UserNote[]): Promise<Result<null>> {
    const id = parseLanaId(String(meetingID), "meeting");
    const missing = { ok: false as const, error: { code: "notFound", message: `That meeting is no longer on this ${this.deviceNoun}.` } };
    if (id === null || !Array.isArray(notes)) return missing;
    try {
      const existing = new Map(this.store.meetings.get(id).userNotes.map((note) => [note.id, note]));
      const now = this.now();
      const kept: CoreUserNote[] = [];
      const seen = new Set<string>();
      for (const note of notes) {
        const parsed = parseNote(note);
        if (parsed === null || seen.has(parsed.id) || parsed.text.trim() === "") continue;
        seen.add(parsed.id);
        const previous = existing.get(parsed.id);
        kept.push({
          id: parsed.id,
          text: parsed.text,
          createdAt: previous?.createdAt ?? parsed.createdAt ?? now,
          updatedAt: previous !== undefined && previous.text === parsed.text ? previous.updatedAt : now,
          anchor: parsed.anchor ?? undefined,
        });
      }
      this.store.meetings.updateUserNotes(id, kept);
      this.log.info("notes.saved", { meeting: id, notes: kept.length });
      return { ok: true, value: null };
    } catch (error) {
      if (error instanceof StoreError && error.kind === "notFound") return missing;
      this.log.error("notes.save_failed", { meeting: id });
      return { ok: false, error: { code: "store", message: "Your notes could not be saved. LANA will try again as you type." } };
    }
  }
}

function parseNote(value: unknown): { id: string; text: string; createdAt: Date | null; anchor: number | null } | null {
  if (value === null || typeof value !== "object") return null;
  const note = value as Record<string, unknown>;
  if (typeof note["id"] !== "string" || note["id"] === "" || note["id"].length > MAX_ID_LENGTH || typeof note["text"] !== "string") return null;
  const created = typeof note["createdAt"] === "string" ? new Date(note["createdAt"]) : null;
  const anchor = typeof note["anchor"] === "number" && Number.isFinite(note["anchor"]) ? Math.max(0, note["anchor"]) : null;
  return { id: note["id"], text: note["text"], createdAt: created !== null && !Number.isNaN(created.getTime()) ? created : null, anchor };
}
