import { LanaDate } from "../json/lanaDate.js";
import { integer, optionalText, text } from "./database.js";
import { StoreError } from "./errors.js";
import type { StoreContext } from "./storeContext.js";
import { LEDGER_STATUSES, type LedgerRecord, type LedgerStatus } from "./types.js";

/**
 * Idempotency ledger. The executor records an attempt before calling the remote API,
 * so a crash mid-call leaves a `pending` row that forces a marker search on retry
 * instead of a blind duplicate create.
 */
export class LedgerRepository {
  constructor(private readonly ctx: StoreContext) {}

  /** Starts (or resumes) an attempt. A completed key comes back untouched. */
  begin(key: string, planHash: string): LedgerRecord {
    const at = LanaDate.format(this.ctx.now());
    const { db } = this.ctx;
    return db.write(() => {
      const existing = this.get(key);
      if (existing !== null && existing.status === "completed") return existing;
      db.run(`INSERT INTO idempotency_ledger (key, plan_hash, status, started_at) VALUES (?, ?, 'pending', ?)
        ON CONFLICT(key) DO UPDATE SET plan_hash = excluded.plan_hash, status = 'pending', error = NULL,
            attempts = attempts + 1, started_at = excluded.started_at, finished_at = NULL`, key, planHash, at);
      const record = this.get(key);
      if (record === null) throw StoreError.notFound(key);
      return record;
    });
  }

  complete(key: string, result: string): void {
    const { db } = this.ctx;
    db.write(() => {
      const changes = db.run("UPDATE idempotency_ledger SET status = 'completed', result = ?, finished_at = ? WHERE key = ?",
        result, LanaDate.format(this.ctx.now()), key);
      if (changes !== 1) throw StoreError.notFound(key);
    });
  }

  /** Marks a failure; a completed key stays completed. */
  fail(key: string, error: string): void {
    const { db } = this.ctx;
    db.write(() => {
      db.run("UPDATE idempotency_ledger SET status = 'failed', error = ?, finished_at = ? WHERE key = ? AND status != 'completed'",
        error, LanaDate.format(this.ctx.now()), key);
    });
  }

  get(key: string): LedgerRecord | null {
    const row = this.ctx.db.get("SELECT * FROM idempotency_ledger WHERE key = ?", key);
    if (row === undefined) return null;
    const status = text(row, "status");
    return {
      key: text(row, "key"),
      planHash: text(row, "plan_hash"),
      status: (LEDGER_STATUSES as readonly string[]).includes(status) ? (status as LedgerStatus) : "failed",
      result: optionalText(row, "result"),
      error: optionalText(row, "error"),
      attempts: integer(row, "attempts"),
    };
  }
}
