import { sha256Hex } from "../crypto/digest.js";
import { ClioMarker } from "../executors/clio/clioMarker.js";
import { UNDO_WINDOW } from "../executors/execution/executionResult.js";
import { canonicalEncode, canonicalString } from "../json/canonical.js";
import { LanaDate } from "../json/lanaDate.js";
import type { LedgerRecord } from "../store/types.js";
import { LANA_TASK_DESCRIPTION_MAX, type LanaClient, type LanaRecordText } from "./lanaClient.js";
import { LanaError } from "./lanaError.js";

/** The action types that run on LANA. Email drafts stay in LANA Briefs until LANA has an email path. */
export type LanaActionType = "task.create" | "note.log";

/** What a confirmed action sends to LANA. */
export interface LanaActionInput {
  readonly actionID: string;
  readonly type: LanaActionType;
  /** The action's idempotency key: one LANA record per key, however often the run is retried. */
  readonly idempotencyKey: string;
  /** LANA's matter id (`client_matters.id`) the person chose. */
  readonly matterID: string;
  readonly title: string;
  readonly body: string;
  /** `YYYY-MM-DD`, tasks only. */
  readonly dueDate?: string | undefined;
}

/** The record an action made on LANA. */
export interface LanaRecord {
  readonly kind: "task" | "note";
  readonly id: string;
  readonly matterID: string;
  /** The LANA app's route to the item (the server serves no web pages). */
  readonly link: string;
}

export interface LanaRunOutcome {
  readonly record: LanaRecord;
  /** True when an earlier attempt had already made the record and it was reused. */
  readonly deduplicated: boolean;
  /** Undo deletes the record until then. */
  readonly undoUntil: Date;
}

/** The store's ledger rows (`LedgerRepository`). */
export type LanaRunLedger = {
  begin(key: string, planHash: string): LedgerRecord;
  complete(key: string, result: string): void;
  fail(key: string, error: string): void;
};

export class LanaUndoClosedError extends Error {
  override readonly name = "LanaUndoClosedError";
  constructor() {
    super("The undo window has closed.");
  }
}

/** The ledger keeps LANA runs apart from any earlier connector attempt for the same action. */
export function lanaLedgerKey(idempotencyKey: string): string {
  return `lana:${idempotencyKey}`;
}

/** `Lana:<action id>`, the last line of the task description or note, found again by a retry. */
export function lanaMarker(actionID: string): string {
  return ClioMarker.make(actionID);
}

/** The LANA app's page for the record: the matter workspace on its Tasks or Notes tab. */
export function lanaRecordLink(kind: "task" | "note", matterID: string, id: string): string {
  const matter = encodeURIComponent(matterID);
  return kind === "task" ? `workspace-details.html?id=${matter}&tab=tasks&task=${encodeURIComponent(id)}` : `workspace-details.html?id=${matter}&tab=notes`;
}

/**
 * Runs confirmed tasks and notes on the firm's LANA server and undoes them. LANA's task and
 * note routes take no idempotency key, so a run is made safe the way the connectors are:
 *
 * 1. The ledger row (`lana:<idempotency key>`) is written before the request. A key that
 *    already completed returns its record without calling LANA.
 * 2. A key with an earlier unfinished attempt first searches the matter for the marker line.
 * 3. The create is sent once. When it may have landed (no answer or a 5xx), the matter is
 *    searched for the marker; only a record found there is used. Nothing is resent in the
 *    same run, so the person's Retry starts again at step 2.
 *
 * Undo soft deletes the record within 24 hours (LANA sets `deleted_at`).
 */
export class LanaActionExecutor {
  constructor(private readonly client: LanaClient, private readonly now: () => Date = () => new Date()) {}

  async run(input: LanaActionInput, ledger: LanaRunLedger): Promise<LanaRunOutcome> {
    if (input.matterID.trim() === "") throw new LanaError("notFound");
    if (input.title.trim() === "") throw new LanaError("rejected");
    const kind = input.type === "task.create" ? "task" : "note";
    const marker = lanaMarker(input.actionID);
    const key = lanaLedgerKey(input.idempotencyKey);
    const text = kind === "task" ? taskDescription(marker, input.body) : ClioMarker.append(marker, input.body);
    const planHash = sha256Hex(canonicalEncode({ type: input.type, matter: input.matterID, title: input.title, text, due: input.dueDate ?? null }));

    const entry = ledger.begin(key, planHash);
    if (entry.status === "completed") {
      const stored = decodeOutcome(entry.result ?? null);
      if (stored !== null) return { ...stored, deduplicated: true };
      // An unreadable completed row is never resent.
      throw new LanaError("invalidResponse");
    }

    try {
      if (entry.attempts > 1) {
        const earlier = await this.find(kind, input.matterID, marker);
        if (earlier !== undefined) return this.finish(key, kind, input.matterID, earlier, true, ledger);
      }
      let id: string;
      try {
        id = kind === "task"
          ? await this.client.createTask(input.matterID, { title: input.title, description: text, dueDate: input.dueDate })
          : await this.client.createNote(input.matterID, { title: input.title, content: text });
      } catch (error) {
        if (!(error instanceof LanaError) || !error.isAmbiguous) throw error;
        const landed = await this.find(kind, input.matterID, marker).catch(() => undefined);
        if (landed === undefined) throw error;
        return this.finish(key, kind, input.matterID, landed, true, ledger);
      }
      return this.finish(key, kind, input.matterID, id, false, ledger);
    } catch (error) {
      try {
        ledger.fail(key, error instanceof LanaError ? `LanaError: ${error.kind}` : "unclassified");
      } catch {
        // The original failure matters more than the ledger write.
      }
      throw error;
    }
  }

  /** Soft deletes the record while `undoUntil` has not passed. A record already gone counts as undone. */
  async undo(record: Pick<LanaRecord, "kind" | "id" | "matterID">, undoUntil: Date): Promise<void> {
    if (this.now().getTime() > undoUntil.getTime()) throw new LanaUndoClosedError();
    if (record.kind === "task") await this.client.deleteTask(record.matterID, record.id);
    else await this.client.deleteNote(record.matterID, record.id);
  }

  private finish(key: string, kind: "task" | "note", matterID: string, id: string, deduplicated: boolean, ledger: LanaRunLedger): LanaRunOutcome {
    const outcome: LanaRunOutcome = {
      record: { kind, id, matterID, link: lanaRecordLink(kind, matterID, id) },
      deduplicated,
      undoUntil: new Date(this.now().getTime() + UNDO_WINDOW * 1000),
    };
    ledger.complete(key, encodeOutcome(outcome));
    return outcome;
  }

  private async find(kind: "task" | "note", matterID: string, marker: string): Promise<string | undefined> {
    const found: LanaRecordText[] = kind === "task" ? await this.client.searchTasks(matterID, marker) : await this.client.recentNotes(matterID);
    return found.find((item) => ClioMarker.endsWithMarker(item.text, marker))?.id;
  }
}

/** The details ending with the marker line, cut so the whole fits LANA's 10,000 characters. */
function taskDescription(marker: string, body: string): string {
  const room = LANA_TASK_DESCRIPTION_MAX - [...marker].length - 2;
  const characters = [...body];
  return ClioMarker.append(marker, characters.length <= room ? body : characters.slice(0, room).join(""));
}

function encodeOutcome(outcome: LanaRunOutcome): string {
  return canonicalString({
    kind: outcome.record.kind,
    lana_id: outcome.record.id,
    matter_id: outcome.record.matterID,
    link: outcome.record.link,
    undo_until: LanaDate.format(outcome.undoUntil),
  });
}

function decodeOutcome(text: string | null): Omit<LanaRunOutcome, "deduplicated"> | null {
  if (text === null) return null;
  try {
    const object = JSON.parse(text) as Record<string, unknown>;
    const kind = object["kind"];
    const undoUntil = typeof object["undo_until"] === "string" ? LanaDate.parse(object["undo_until"]) : null;
    if ((kind !== "task" && kind !== "note") || typeof object["lana_id"] !== "string" || typeof object["matter_id"] !== "string" || typeof object["link"] !== "string" || undoUntil === null) return null;
    return { record: { kind, id: object["lana_id"], matterID: object["matter_id"], link: object["link"] }, undoUntil };
  } catch {
    return null;
  }
}
