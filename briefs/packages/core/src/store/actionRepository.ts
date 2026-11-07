import { actionListSql, type ActionListFilters } from "../actions/actionList.js";
import { asLanaId } from "../ids/codec.js";
import { makeLanaId, type LanaId } from "../ids/lanaId.js";
import { decodeEvidence, encodeEvidence, encodeIntent as encodeIntentJson, transitioned, type Evidence } from "../intent/intent.js";
import { canTransition, INTENT_STATUSES, type IntentStatus } from "../intent/intentStatus.js";
import { decodeParams, encodeParams, intentType, type IntentParams } from "../intent/params.js";
import { LanaDate } from "../json/lanaDate.js";
import { arrayOf, asDate, asObject, asString, field, optional } from "../json/read.js";
import { appendAuditRecord, AUDIT_EVENTS, readAuditEntries, type AuditDetail, type AuditEntry } from "./auditLog.js";
import { blob, integer, optionalBlob, optionalText, text, type Row } from "./database.js";
import { StoreError } from "./errors.js";
import { appendIntentEvent, EDITABLE_STATUSES, UNREAD_STATUSES, type IntentRepository } from "./intentRepository.js";
import type { StoreContext } from "./storeContext.js";
import { parseStoredDate } from "./storedDate.js";
import type { Actor } from "./types.js";

export const MANUAL_ACTION_SCHEMA = "lana.manual_action/v1";

/** Where an action lives: `intent` (from a meeting on the phone) or `manual_action` (added by the person). */
export type StoredActionOrigin = "meeting" | "manual";

/**
 * One action as the Inbox and the run flow see it, from either table. Params, type,
 * evidence and the idempotency key come from the sealed intent (or the sealed manual
 * action); status, dates and the meeting id are clear columns; `resolution` is the
 * opened resolution blob (the chosen matter, and once run, the result).
 */
export interface StoredAction {
  readonly id: LanaId;
  readonly origin: StoredActionOrigin;
  /** Always set for origin "meeting"; null for a manual action not linked to a meeting. */
  readonly meetingID: LanaId | null;
  /** Wire type, "task.create", "note.log", "email.draft" or a newer type. */
  readonly type: string;
  readonly status: IntentStatus;
  readonly params: IntentParams;
  /** Empty for a manual action. */
  readonly evidence: readonly Evidence[];
  /** The phone's key for a meeting action; "<actionID>:<type>" for a manual one. */
  readonly idempotencyKey: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly deletedAt: Date | null;
  /**
   * When the person last saw it; null means unread. An action arrives unread (a phone
   * handoff, a finished background draft) and reads unread again when it needs the person
   * (a failed run, an update from the phone). Opening it or Mark all as read sets this.
   */
  readonly seenAt: Date | null;
  readonly resolution: Uint8Array | null;
}

export interface NewManualAction {
  readonly params: IntentParams;
  readonly meetingID: LanaId | null;
  /** Usually null; a chosen matter goes in the same transaction. */
  readonly resolution: Uint8Array | null;
}

/**
 * Every action in one place (desktop only): the phone's intents and the actions added
 * by hand, with soft delete. Each change and its audit record (ids, types and states,
 * never text) commit in one transaction. Matter, titles and text stay sealed at rest.
 */
export class ActionRepository {
  constructor(private readonly ctx: StoreContext, private readonly intents: IntentRepository) {}

  /** The rows the indexed filters allow, from both tables. Matter, search, sort and paging happen in core `listActions`. */
  list(filters: ActionListFilters): StoredAction[] {
    const sql = actionListSql(filters);
    if (sql.empty) return [];
    const intents = this.ctx.db.all(`SELECT * FROM intent ${sql.where} ORDER BY id`, ...sql.params).map((row) => this.fromIntentRow(row));
    const manual = this.ctx.db.all(`SELECT * FROM manual_action ${sql.where} ORDER BY id`, ...sql.params).map((row) => this.fromManualRow(row));
    return [...intents, ...manual];
  }

  get(id: LanaId): StoredAction {
    const manual = this.ctx.db.get("SELECT * FROM manual_action WHERE id = ?", id);
    if (manual !== undefined) return this.fromManualRow(manual);
    const intent = this.ctx.db.get("SELECT * FROM intent WHERE id = ?", id);
    if (intent === undefined) throw StoreError.notFound(id);
    return this.fromIntentRow(intent);
  }

  /** Adds an action by hand: status "resolved" when it has a resolution (a matter), else "transferred". */
  createManual(input: NewManualAction): StoredAction {
    const at = this.ctx.now();
    const { db, sealer } = this.ctx;
    const id = makeLanaId("intent", at);
    const type = intentType(input.params);
    const status: IntentStatus = input.resolution === null ? "transferred" : "resolved";
    if (input.meetingID !== null && db.get("SELECT id FROM meeting WHERE id = ?", input.meetingID) === undefined) throw StoreError.notFound(input.meetingID);
    return db.write(() => {
      const sealed = sealer.sealJson({
        schema: MANUAL_ACTION_SCHEMA, id, meeting_id: input.meetingID ?? undefined, type, params: encodeParams(input.params), evidence: [], created_at: LanaDate.format(at),
      }, `manual_action|${id}`);
      // The person wrote it, so it is never unread.
      db.run(`INSERT INTO manual_action (id, meeting_id, type, status, idempotency_key, sealed_action, resolution, created_at, updated_at, deleted_at, seen_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)`,
        id, input.meetingID, type, status, `${id}:${type}`, sealed,
        input.resolution === null ? null : sealer.seal(input.resolution, `resolution|${id}`), LanaDate.format(at), LanaDate.format(at), LanaDate.format(at));
      appendAuditRecord(db, AUDIT_EVENTS.actionCreatedManually, id, { type, meeting_id: input.meetingID ?? "", status }, at);
      return this.get(id);
    });
  }

  /**
   * Saves edited params and the resolution together, without running. A resolution
   * (a chosen matter) moves "transferred" to "resolved". Type and idempotency key stay.
   */
  save(id: LanaId, params: IntentParams, resolution: Uint8Array | null): StoredAction {
    const at = this.ctx.now();
    const { db, sealer } = this.ctx;
    return db.write(() => {
      const current = this.get(id);
      if (current.deletedAt !== null || !EDITABLE_STATUSES.has(current.status)) throw StoreError.notEditable(current.status);
      if (intentType(params) !== current.type) throw StoreError.corrupt("cannot change action type");
      const sealedResolution = resolution === null ? null : sealer.seal(resolution, `resolution|${id}`);
      const next: IntentStatus = resolution !== null && current.status === "transferred" ? "resolved" : current.status;
      if (current.origin === "meeting") {
        const stored = this.intents.get(id).intent;
        const updated = { ...(next === stored.status ? stored : transitioned(stored, next)), params };
        db.run("UPDATE intent SET status = ?, sealed_intent = ?, resolution = ?, updated_at = ? WHERE id = ?",
          next, sealer.sealJson(encodeIntentJson(updated), `intent|${id}`), sealedResolution, LanaDate.format(at), id);
        if (next !== current.status) appendIntentEvent(db, id, current.status, next, "user", {}, at);
      } else {
        db.run("UPDATE manual_action SET status = ?, sealed_action = ?, resolution = ?, updated_at = ? WHERE id = ?",
          next, this.sealManual(current, params), sealedResolution, LanaDate.format(at), id);
      }
      appendAuditRecord(db, AUDIT_EVENTS.actionSaved, id, { type: current.type, from: current.status, to: next }, at);
      return this.get(id);
    });
  }

  /** Moves an action through its lifecycle (same rules as intents), with history, audit and, for intents, the outbox. */
  transition(id: LanaId, next: IntentStatus, actor: Actor, detail: Readonly<Record<string, string>> = {}): StoredAction {
    const current = this.get(id);
    if (current.origin === "meeting") {
      this.intents.transition(id, next, actor, detail);
      return this.get(id);
    }
    const at = this.ctx.now();
    const { db } = this.ctx;
    return db.write(() => {
      if (!canTransition(current.status, next)) throw StoreError.invalidTransition(current.status, next);
      db.run("UPDATE manual_action SET status = ?, updated_at = ? WHERE id = ?", next, LanaDate.format(at), id);
      if (UNREAD_STATUSES.has(next)) db.run("UPDATE manual_action SET seen_at = NULL WHERE id = ?", id);
      appendAuditRecord(db, AUDIT_EVENTS.intentTransition, id, { ...detail, from: current.status, to: next, actor, type: current.type }, at);
      return this.get(id);
    });
  }

  setResolution(id: LanaId, resolution: Uint8Array | null): StoredAction {
    const current = this.get(id);
    if (current.origin === "meeting") {
      this.intents.setResolution(id, resolution);
      return this.get(id);
    }
    const at = this.ctx.now();
    const { db, sealer } = this.ctx;
    db.write(() => {
      db.run("UPDATE manual_action SET resolution = ?, updated_at = ? WHERE id = ?",
        resolution === null ? null : sealer.seal(resolution, `resolution|${id}`), LanaDate.format(at), id);
    });
    return this.get(id);
  }

  /** Soft delete: sets `deleted_at`. Nothing is removed, here or on LANA. */
  remove(id: LanaId): StoredAction {
    return this.mark(id, true);
  }

  restore(id: LanaId): StoredAction {
    return this.mark(id, false);
  }

  /**
   * The person opened it: it reads as read. Not a change to the action, so `updated_at`
   * stays and nothing is audited. Already read keeps its first time.
   */
  markRead(id: LanaId): StoredAction {
    const { db } = this.ctx;
    return db.write(() => {
      const current = this.get(id);
      db.run(`UPDATE ${tableOf(current.origin)} SET seen_at = ? WHERE id = ? AND seen_at IS NULL`, LanaDate.format(this.ctx.now()), id);
      return this.get(id);
    });
  }

  /** Mark all as read: every unread action that is not deleted. Returns how many changed. */
  markAllRead(): number {
    const { db } = this.ctx;
    const at = LanaDate.format(this.ctx.now());
    return db.write(() => {
      const count = this.unreadCount();
      for (const table of ["intent", "manual_action"]) db.run(`UPDATE ${table} SET seen_at = ? WHERE seen_at IS NULL AND deleted_at IS NULL`, at);
      return count;
    });
  }

  /** Unread actions that are not deleted, from both tables: the Inbox badge. */
  unreadCount(): number {
    const row = this.ctx.db.get(`SELECT
      (SELECT COUNT(*) FROM intent WHERE seen_at IS NULL AND deleted_at IS NULL) +
      (SELECT COUNT(*) FROM manual_action WHERE seen_at IS NULL AND deleted_at IS NULL) AS n`);
    return row === undefined ? 0 : integer(row, "n");
  }

  /** The audit entries for this action, oldest first: its history. */
  history(id: LanaId): AuditEntry[] {
    const seqs = this.ctx.db.all("SELECT seq FROM audit_log WHERE subject = ? ORDER BY seq", id).map((row) => integer(row, "seq"));
    if (seqs.length === 0) return [];
    const first = seqs[0]! - 1;
    const wanted = new Set(seqs);
    return readAuditEntries(this.ctx.db, first).filter((entry) => wanted.has(entry.seq));
  }

  // MARK: - Private

  private mark(id: LanaId, deleted: boolean): StoredAction {
    const at = this.ctx.now();
    const { db } = this.ctx;
    return db.write(() => {
      const current = this.get(id);
      if ((current.deletedAt !== null) === deleted) throw new StoreError("notEditable", deleted ? "deleted" : "not_deleted");
      if (deleted && current.status === "confirmed") throw StoreError.notEditable(current.status);
      const table = tableOf(current.origin);
      db.run(`UPDATE ${table} SET deleted_at = ?, updated_at = ? WHERE id = ?`, deleted ? LanaDate.format(at) : null, LanaDate.format(at), id);
      const detail: AuditDetail = { type: current.type, status: current.status, origin: current.origin };
      appendAuditRecord(db, deleted ? AUDIT_EVENTS.actionDeleted : AUDIT_EVENTS.actionRestored, id, detail, at);
      return this.get(id);
    });
  }

  private sealManual(current: StoredAction, params: IntentParams): Uint8Array {
    return this.ctx.sealer.sealJson({
      schema: MANUAL_ACTION_SCHEMA, id: current.id, meeting_id: current.meetingID ?? undefined, type: current.type, params: encodeParams(params),
      evidence: current.evidence.map(encodeEvidence), created_at: LanaDate.format(current.createdAt),
    }, `manual_action|${current.id}`);
  }

  private fromIntentRow(row: Row): StoredAction {
    const id = text(row, "id");
    const stored = this.intents.get(id as LanaId);
    const deletedAt = optionalText(row, "deleted_at");
    const seenAt = optionalText(row, "seen_at");
    return {
      id: stored.intent.id,
      origin: "meeting",
      meetingID: stored.intent.meetingID,
      type: stored.intent.type,
      status: stored.intent.status,
      params: stored.intent.params,
      evidence: stored.intent.evidence,
      idempotencyKey: stored.intent.idempotencyKey,
      createdAt: stored.intent.createdAt,
      updatedAt: stored.updatedAt,
      deletedAt: deletedAt === null ? null : parseStoredDate(deletedAt),
      seenAt: seenAt === null ? null : parseStoredDate(seenAt),
      resolution: stored.resolution,
    };
  }

  private fromManualRow(row: Row): StoredAction {
    const id = text(row, "id");
    const context = `manual_action|${id}`;
    let object;
    try {
      object = asObject(this.ctx.sealer.openJson(blob(row, "sealed_action"), context), "manual_action");
    } catch (error) {
      if (error instanceof StoreError) throw error;
      throw StoreError.corrupt(context);
    }
    const status = text(row, "status");
    const deletedAt = optionalText(row, "deleted_at");
    const seenAt = optionalText(row, "seen_at");
    const resolution = optionalBlob(row, "resolution");
    const meetingID = optionalText(row, "meeting_id");
    try {
      const type = field(object, "type", "manual_action", asString);
      return {
        id: field(object, "id", "manual_action", asLanaId),
        origin: "manual",
        meetingID: meetingID === null ? null : (meetingID as LanaId),
        type,
        status: (INTENT_STATUSES as readonly string[]).includes(status) ? (status as IntentStatus) : "failed",
        params: decodeParams(type, object["params"] ?? null, "manual_action.params"),
        evidence: optional(object, "evidence", "manual_action", arrayOf(decodeEvidence)) ?? [],
        idempotencyKey: text(row, "idempotency_key"),
        createdAt: field(object, "created_at", "manual_action", asDate),
        updatedAt: parseStoredDate(text(row, "updated_at")),
        deletedAt: deletedAt === null ? null : parseStoredDate(deletedAt),
        seenAt: seenAt === null ? null : parseStoredDate(seenAt),
        resolution: resolution === null ? null : this.ctx.sealer.open(resolution, `resolution|${id}`),
      };
    } catch {
      throw StoreError.corrupt(context);
    }
  }
}

function tableOf(origin: StoredActionOrigin): "intent" | "manual_action" {
  return origin === "meeting" ? "intent" : "manual_action";
}
