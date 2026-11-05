import type { LanaId } from "../ids/lanaId.js";
import { decodeIntent, encodeIntent, transitioned, type Intent } from "../intent/intent.js";
import { canTransition, INTENT_STATUSES, type IntentStatus } from "../intent/intentStatus.js";
import { intentType, type IntentParams } from "../intent/params.js";
import { canonicalString } from "../json/canonical.js";
import { LanaDate } from "../json/lanaDate.js";
import { appendAuditRecord, AUDIT_EVENTS } from "./auditLog.js";
import { blob, integer, optionalBlob, optionalText, text, type Database, type Row, type SqlValue } from "./database.js";
import { StoreError } from "./errors.js";
import type { FieldSealer } from "./fieldSealer.js";
import { enqueueOutbox } from "./outboxRepository.js";
import type { StoreContext } from "./storeContext.js";
import { parseStoredDate } from "./storedDate.js";
import { parseStringRecord } from "./stringRecord.js";
import { ACTORS, type Actor, type IntentEvent, type StoredIntent } from "./types.js";

/** Statuses on which the person may still edit the proposal. */
export const EDITABLE_STATUSES: ReadonlySet<IntentStatus> = new Set(["transferred", "resolved", "failed"]);

/**
 * Statuses that need the person: an action moved there (a run failed) reads unread again.
 * Only the run side moves an action to failed, so the person's own steps never count.
 */
export const UNREAD_STATUSES: ReadonlySet<IntentStatus> = new Set(["failed"]);

/** Intent state machines with their status history (Swift `GatewayStore+Intents`). */
export class IntentRepository {
  constructor(private readonly ctx: StoreContext) {}

  list(filter: { readonly statuses?: readonly IntentStatus[]; readonly meetingID?: LanaId } = {}): StoredIntent[] {
    const clauses: string[] = [];
    const params: SqlValue[] = [];
    if (filter.statuses !== undefined) {
      const statuses = [...new Set(filter.statuses)].sort();
      clauses.push(`status IN (${statuses.map(() => "?").join(",")})`);
      params.push(...statuses);
    }
    if (filter.meetingID !== undefined) {
      clauses.push("meeting_id = ?");
      params.push(filter.meetingID);
    }
    const where = clauses.length === 0 ? "" : `WHERE ${clauses.join(" AND ")}`;
    return this.ctx.db.all(`SELECT * FROM intent ${where} ORDER BY id`, ...params).map((row) => storedIntent(this.ctx.sealer, row));
  }

  get(id: LanaId): StoredIntent {
    return fetchIntent(this.ctx, id);
  }

  /** Moves an intent through its lifecycle, recording history, audit and outbox in one transaction. */
  transition(id: LanaId, next: IntentStatus, actor: Actor, detail: Readonly<Record<string, string>> = {}): StoredIntent {
    const at = this.ctx.now();
    const { db, sealer } = this.ctx;
    return db.write(() => {
      const current = fetchIntent(this.ctx, id);
      if (!canTransition(current.intent.status, next)) throw StoreError.invalidTransition(current.intent.status, next);
      const updated = transitioned(current.intent, next);
      db.run("UPDATE intent SET status = ?, sealed_intent = ?, updated_at = ? WHERE id = ?",
        next, sealer.sealJson(encodeIntent(updated), `intent|${id}`), LanaDate.format(at), id);
      if (UNREAD_STATUSES.has(next)) db.run("UPDATE intent SET seen_at = NULL WHERE id = ?", id);
      appendIntentEvent(db, id, current.intent.status, next, actor, detail, at);
      const auditDetail = { ...detail, from: current.intent.status, to: next, actor, type: updated.type };
      appendAuditRecord(db, AUDIT_EVENTS.intentTransition, id, auditDetail, at);
      enqueueOutbox(db, "intent.status", { intent_id: id, status: next }, at);
      return fetchIntent(this.ctx, id);
    });
  }

  /** Replaces the proposal's parameters after a user edit. Id and idempotency key stay. */
  updateParams(id: LanaId, params: IntentParams): StoredIntent {
    const at = this.ctx.now();
    const { db, sealer } = this.ctx;
    return db.write(() => {
      const current = fetchIntent(this.ctx, id);
      if (!EDITABLE_STATUSES.has(current.intent.status)) throw StoreError.notEditable(current.intent.status);
      if (intentType(params) !== current.intent.type) throw StoreError.corrupt("cannot change intent type");
      const updated: Intent = { ...current.intent, params };
      db.run("UPDATE intent SET sealed_intent = ?, resolution = NULL, updated_at = ? WHERE id = ?",
        sealer.sealJson(encodeIntent(updated), `intent|${id}`), LanaDate.format(at), id);
      appendAuditRecord(db, AUDIT_EVENTS.intentEdited, id, { type: updated.type }, at);
      return fetchIntent(this.ctx, id);
    });
  }

  setResolution(id: LanaId, resolution: Uint8Array | null): void {
    const at = this.ctx.now();
    const { db, sealer } = this.ctx;
    db.write(() => {
      fetchIntent(this.ctx, id);
      db.run("UPDATE intent SET resolution = ?, updated_at = ? WHERE id = ?",
        resolution === null ? null : sealer.seal(resolution, `resolution|${id}`), LanaDate.format(at), id);
    });
  }

  history(id: LanaId): IntentEvent[] {
    return this.ctx.db.all("SELECT * FROM intent_event WHERE intent_id = ? ORDER BY seq", id).map((row) => {
      const from = optionalText(row, "from_status");
      const to = text(row, "to_status");
      const actor = text(row, "actor");
      return {
        seq: integer(row, "seq"),
        intentID: id,
        from: from !== null && isStatus(from) ? from : null,
        to: isStatus(to) ? to : "failed",
        actor: (ACTORS as readonly string[]).includes(actor) ? (actor as Actor) : "system",
        detail: parseStringRecord(optionalText(row, "detail")),
        at: parseStoredDate(optionalText(row, "at")),
      };
    });
  }
}

export function appendIntentEvent(db: Database, id: LanaId, from: IntentStatus | null, to: IntentStatus, actor: Actor,
  detail: Readonly<Record<string, string>>, at: Date): void {
  db.run("INSERT INTO intent_event (intent_id, from_status, to_status, actor, detail, at) VALUES (?, ?, ?, ?, ?, ?)",
    id, from, to, actor, canonicalString(detail), LanaDate.format(at));
}

function fetchIntent(ctx: StoreContext, id: LanaId): StoredIntent {
  const row = ctx.db.get("SELECT * FROM intent WHERE id = ?", id);
  if (row === undefined) throw StoreError.notFound(id);
  return storedIntent(ctx.sealer, row);
}

function storedIntent(sealer: FieldSealer, row: Row): StoredIntent {
  const id = text(row, "id");
  const context = `intent|${id}`;
  let intent: Intent;
  try {
    intent = decodeIntent(sealer.openJson(blob(row, "sealed_intent"), context));
  } catch (error) {
    if (error instanceof StoreError) throw error;
    throw StoreError.corrupt(context);
  }
  const resolution = optionalBlob(row, "resolution");
  return {
    intent,
    resolution: resolution === null ? null : sealer.open(resolution, `resolution|${id}`),
    updatedAt: parseStoredDate(optionalText(row, "updated_at")),
  };
}

function isStatus(value: string): value is IntentStatus {
  return (INTENT_STATUSES as readonly string[]).includes(value);
}
