import { parseLanaId, type LanaId } from "../ids/lanaId.js";
import { LanaDate } from "../json/lanaDate.js";
import { blob, optionalText, text, type Row } from "./database.js";
import type { StoreContext } from "./storeContext.js";
import { parseStoredDate } from "./storedDate.js";
import type { StoredAskThread } from "./types.js";

/** Saved Ask conversations, sealed at rest and never written to the audit log. */
export class AskRepository {
  constructor(private readonly ctx: StoreContext) {}

  save(id: string, meetingID: LanaId | null, turns: Uint8Array): void {
    const at = LanaDate.format(this.ctx.now());
    const { db, sealer } = this.ctx;
    db.write(() => {
      db.run(`INSERT INTO ask_thread (id, meeting_id, sealed_turns, created_at, updated_at) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET sealed_turns = excluded.sealed_turns, updated_at = excluded.updated_at`,
        id, meetingID, sealer.seal(turns, `ask|${id}`), at, at);
    });
  }

  /** Newest first. A meeting id gives that meeting's threads; otherwise all, or only cross-meeting ones. */
  list(meetingID: LanaId | null = null, includeAllMeetingThreads = true): StoredAskThread[] {
    const { db } = this.ctx;
    const rows = meetingID !== null
      ? db.all("SELECT * FROM ask_thread WHERE meeting_id = ? ORDER BY updated_at DESC", meetingID)
      : includeAllMeetingThreads
        ? db.all("SELECT * FROM ask_thread ORDER BY updated_at DESC")
        : db.all("SELECT * FROM ask_thread WHERE meeting_id IS NULL ORDER BY updated_at DESC");
    return rows.map((row) => this.thread(row));
  }

  get(id: string): StoredAskThread | null {
    const row = this.ctx.db.get("SELECT * FROM ask_thread WHERE id = ?", id);
    return row === undefined ? null : this.thread(row);
  }

  delete(id: string): void {
    this.ctx.db.write(() => this.ctx.db.run("DELETE FROM ask_thread WHERE id = ?", id));
  }

  deleteAll(): void {
    this.ctx.db.write(() => this.ctx.db.run("DELETE FROM ask_thread"));
  }

  private thread(row: Row): StoredAskThread {
    const id = text(row, "id");
    const meeting = optionalText(row, "meeting_id");
    return {
      id,
      meetingID: meeting === null ? null : parseLanaId(meeting, "meeting"),
      turns: this.ctx.sealer.open(blob(row, "sealed_turns"), `ask|${id}`),
      createdAt: parseStoredDate(optionalText(row, "created_at")),
      updatedAt: parseStoredDate(optionalText(row, "updated_at")),
    };
  }
}
