import { fromBase64, toBase64 } from "../bytes/index.js";
import { parseLanaId, type LanaId } from "../ids/lanaId.js";
import type { JsonValue } from "../json/index.js";
import { LanaDate } from "../json/lanaDate.js";
import { appendAuditRecord, AUDIT_EVENTS } from "./auditLog.js";
import { text } from "./database.js";
import { StoreError } from "./errors.js";
import type { StoreContext } from "./storeContext.js";
import { parseStoredDate } from "./storedDate.js";

/** What a background draft makes. A question is an action drafted for an open question. */
export type ClipDraftKind = "action" | "decision" | "question";
/** Waiting its turn, on the model now, or ready for the person. */
export type ClipDraftStatus = "queued" | "drafting" | "ready";

export interface ClipDraftRequest {
  readonly meetingID: LanaId;
  readonly kind: ClipDraftKind;
  readonly firstLine: number;
  readonly lastLine: number;
  readonly clipID: string;
  /** The open question (a key point id) it answers. */
  readonly questionID?: string | undefined;
}

export interface StoredClipDraft extends ClipDraftRequest {
  readonly id: string;
  readonly seq: number;
  readonly status: ClipDraftStatus;
  /** Ready action: the proposed action it became. */
  readonly intentID: LanaId | null;
  /** Ready: true when LANA drafted it, false when the starting point was used. */
  readonly drafted: boolean | null;
  /** Ready decision: the decision text, for the person to check. */
  readonly text: string | null;
  readonly createdAt: Date;
}

/** The setting row that holds the queue, sealed: a drafted decision is meeting content. */
const SETTING_KEY = "clip_drafts.v1";
const SEAL_CONTEXT = `setting|${SETTING_KEY}`;

type Row = Record<string, JsonValue>;

/**
 * Drafts LANA writes in the background, one at a time in request order, kept so they
 * survive a restart (desktop only). They live in one sealed setting row, so the store's
 * schema stays identical to the Swift store's. Every change appends its audit record (ids
 * and states only) in the same transaction. Drafts of a deleted meeting are dropped.
 */
export class ClipDraftRepository {
  constructor(private readonly ctx: StoreContext) {}

  add(id: string, request: ClipDraftRequest): StoredClipDraft {
    return this.change((rows) => {
      const at = this.ctx.now();
      const seq = rows.reduce((max, row) => Math.max(max, Number(row["seq"])), 0) + 1;
      rows.push({
        id, seq, meeting_id: request.meetingID, kind: request.kind, status: "queued", first_line: request.firstLine, last_line: request.lastLine,
        clip_id: request.clipID, question_id: request.questionID ?? null, intent_id: null, drafted: null, text: null, created_at: LanaDate.format(at),
      });
      appendAuditRecord(this.ctx.db, AUDIT_EVENTS.draftRequested, request.meetingID, { draft_id: id, kind: request.kind }, at);
      return this.draft(rows.at(-1)!);
    });
  }

  /** Every draft not yet settled, in queue order. */
  list(): StoredClipDraft[] {
    return this.rows().map((row) => this.draft(row));
  }

  get(id: string): StoredClipDraft | null {
    const row = this.rows().find((item) => item["id"] === id);
    return row === undefined ? null : this.draft(row);
  }

  /** The draft that became this proposed action, if any. */
  forIntent(intentID: string): StoredClipDraft | null {
    const row = this.rows().find((item) => item["intent_id"] === intentID);
    return row === undefined ? null : this.draft(row);
  }

  /** The oldest queued draft, now on the model. */
  startNext(): StoredClipDraft | null {
    return this.change((rows) => {
      const row = rows.find((item) => item["status"] === "queued");
      if (row === undefined) return null;
      row["status"] = "drafting";
      return this.draft(row);
    });
  }

  /** At launch: a draft cut off by quitting goes back to the queue, in its place. */
  requeueInterrupted(): number {
    return this.change((rows) => {
      const cut = rows.filter((row) => row["status"] === "drafting");
      for (const row of cut) row["status"] = "queued";
      return cut.length;
    });
  }

  /** A drafted action: it is now a proposed action in the Inbox. */
  readyAction(id: string, intentID: LanaId, drafted: boolean): void {
    this.ready(id, { intent_id: intentID, drafted: drafted ? "true" : "false" }, (row) => {
      Object.assign(row, { status: "ready", intent_id: intentID, drafted });
    });
  }

  /** A drafted decision, waiting for the person to add it. */
  readyDecision(id: string, decision: string, drafted: boolean): void {
    this.ready(id, { drafted: drafted ? "true" : "false" }, (row) => {
      Object.assign(row, { status: "ready", drafted, text: decision });
    });
  }

  /** Cancelled while waiting or drafting, or a ready decision dismissed. */
  cancel(id: string): StoredClipDraft | null {
    return this.remove(id, AUDIT_EVENTS.draftCancelled);
  }

  /** A ready decision the person added to the meeting. */
  added(id: string): StoredClipDraft | null {
    return this.remove(id, AUDIT_EVENTS.draftAdded);
  }

  /** Forgets a settled action draft (its proposed action was confirmed, dismissed or undone). No audit: the action has its own. */
  forget(id: string): void {
    this.change((rows) => {
      const index = rows.findIndex((row) => row["id"] === id && row["status"] === "ready" && row["intent_id"] !== null);
      if (index >= 0) rows.splice(index, 1);
    });
  }

  // MARK: - Private

  private ready(id: string, detail: Record<string, string>, update: (row: Row) => void): void {
    this.change((rows) => {
      const row = rows.find((item) => item["id"] === id);
      if (row === undefined) throw StoreError.notFound(`clip draft ${id}`);
      update(row);
      appendAuditRecord(this.ctx.db, AUDIT_EVENTS.draftReady, String(row["meeting_id"]), { draft_id: id, kind: String(row["kind"]), ...detail }, this.ctx.now());
    });
  }

  private remove(id: string, event: typeof AUDIT_EVENTS.draftCancelled | typeof AUDIT_EVENTS.draftAdded): StoredClipDraft | null {
    return this.change((rows) => {
      const index = rows.findIndex((row) => row["id"] === id);
      if (index < 0) return null;
      const [row] = rows.splice(index, 1);
      appendAuditRecord(this.ctx.db, event, String(row!["meeting_id"]), { draft_id: id, kind: String(row!["kind"]) }, this.ctx.now());
      return this.draft(row!);
    });
  }

  /** Reads, changes and writes the queue in one transaction. */
  private change<T>(body: (rows: Row[]) => T): T {
    return this.ctx.db.write(() => {
      const rows = this.rows();
      const result = body(rows);
      const sealed = toBase64(this.ctx.sealer.sealJson(rows, SEAL_CONTEXT));
      this.ctx.db.run("INSERT INTO setting (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", SETTING_KEY, sealed);
      return result;
    });
  }

  /** The queue in order, without drafts whose meeting is gone. */
  private rows(): Row[] {
    const stored = this.ctx.db.get("SELECT value FROM setting WHERE key = ?", SETTING_KEY);
    if (stored === undefined) return [];
    const bytes = fromBase64(text(stored, "value"));
    if (bytes === null) throw StoreError.corrupt(SETTING_KEY);
    const value = this.ctx.sealer.openJson(bytes, SEAL_CONTEXT);
    if (!Array.isArray(value)) throw StoreError.corrupt(SETTING_KEY);
    return (value as Row[])
      .filter((row) => this.ctx.db.get("SELECT 1 AS found FROM meeting WHERE id = ?", String(row["meeting_id"])) !== undefined)
      .sort((a, b) => Number(a["seq"]) - Number(b["seq"]));
  }

  private draft(row: Row): StoredClipDraft {
    const meetingID = parseLanaId(String(row["meeting_id"]), "meeting");
    if (meetingID === null) throw StoreError.corrupt("clip draft meeting");
    const intent = row["intent_id"];
    const question = row["question_id"];
    const drafted = row["drafted"];
    const decision = row["text"];
    return {
      id: String(row["id"]),
      seq: Number(row["seq"]),
      meetingID,
      kind: String(row["kind"]) as ClipDraftKind,
      status: String(row["status"]) as ClipDraftStatus,
      firstLine: Number(row["first_line"]),
      lastLine: Number(row["last_line"]),
      clipID: String(row["clip_id"]),
      questionID: typeof question === "string" ? question : undefined,
      intentID: typeof intent === "string" ? parseLanaId(intent, "intent") : null,
      drafted: typeof drafted === "boolean" ? drafted : null,
      text: typeof decision === "string" ? decision : null,
      createdAt: parseStoredDate(String(row["created_at"])),
    };
  }
}
