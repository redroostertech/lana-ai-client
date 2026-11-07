import { canonicalString } from "../json/canonical.js";
import { LanaDate } from "../json/lanaDate.js";
import { integer, optionalText, text, type Database } from "./database.js";
import type { StoreContext } from "./storeContext.js";
import { parseStoredDate } from "./storedDate.js";
import { parseStringRecord } from "./stringRecord.js";
import type { OutboxEvent } from "./types.js";

/** Queues an event for the UI or sync, inside the caller's transaction. */
export function enqueueOutbox(db: Database, event: string, payload: Readonly<Record<string, string>>, at: Date): void {
  db.run("INSERT INTO outbox (event, payload, created_at) VALUES (?, ?, ?)", event, canonicalString(payload), LanaDate.format(at));
}

export class OutboxRepository {
  constructor(private readonly ctx: StoreContext) {}

  pending(limit = 100): OutboxEvent[] {
    return this.ctx.db.all("SELECT * FROM outbox WHERE delivered_at IS NULL ORDER BY seq LIMIT ?", limit).map((row) => ({
      seq: integer(row, "seq"),
      event: text(row, "event"),
      payload: parseStringRecord(optionalText(row, "payload")),
      createdAt: parseStoredDate(optionalText(row, "created_at")),
    }));
  }

  /** Events not delivered yet (Settings shows the count). */
  pendingCount(): number {
    const row = this.ctx.db.get("SELECT COUNT(*) AS count FROM outbox WHERE delivered_at IS NULL");
    return row === undefined ? 0 : integer(row, "count");
  }

  markDelivered(seqs: readonly number[]): void {
    const at = LanaDate.format(this.ctx.now());
    this.ctx.db.write(() => {
      for (const seq of seqs) this.ctx.db.run("UPDATE outbox SET delivered_at = ? WHERE seq = ?", at, seq);
    });
  }
}
