import { kindOfType, matterBlockReason, runTitleOf } from "@lana/core/actions";
import { failureMessage } from "@lana/core/connectors";
import {
  LANA_ERROR_KINDS, LANA_ERROR_MESSAGES, LanaError, LanaUndoClosedError,
  type LanaActionExecutor, type LanaActionInput, type LanaErrorKind,
} from "@lana/core/lana";
import { AUDIT_EVENTS, StoreError, type GatewayStore, type StoredAction } from "@lana/core/store";
import type { ActionPhase, Result } from "../../../shared/api.js";
import { NOT_ENTITLED_MESSAGE } from "../../gateway/accessMessages.js";
import type { MainLog } from "../../log.js";
import type { ActionRunner, RunGate } from "./actionPagesService.js";
import type { ExecutionResult } from "./actionService.js";
import { decodeStoredResolution, encodeStoredResolution, type StoredResolution } from "./storedResolution.js";

/** Email drafts are not sent to LANA: it has no email path yet. */
export const EMAIL_STAYS_DRAFT = "Email drafts stay in LANA Briefs for now. LANA cannot send email yet, so copy the draft into your email.";
export const UNDO_CLOSED = "The undo window has closed.";

export interface LanaActionRunnerDependencies {
  readonly store: Pick<GatewayStore, "actions" | "ledger" | "appendAudit">;
  /** The executor over the signed-in session. */
  readonly executor: () => Pick<LanaActionExecutor, "run" | "undo">;
  readonly isSignedIn: () => boolean;
  /** LANA Briefs is on for the organization. */
  readonly isEntitled: () => boolean;
  /** "computer". */
  readonly deviceNoun: string;
  readonly log: MainLog;
  readonly now?: () => Date;
}

/**
 * Runs confirmed actions on the firm's LANA server (the default route; the Clio and
 * Microsoft executors stay in the code, unrouted). A task becomes a LANA task and a note a
 * LANA matter note on the matter the person chose; an email stays a draft here.
 *
 * Run: resolved, then confirmed, then the executor (idempotent: ledger plus marker), then
 * executed with the LANA record kept in the resolution and `action.ran {lana_id}` in the
 * audit log. A failure moves the action to failed with a short code. Undo soft deletes the
 * LANA record within 24 hours and audits `action.undone {lana_id}`. Logs carry ids, codes
 * and states only.
 */
export class LanaActionRunner implements ActionRunner {
  /** The last run or undo problem per action, shown on its page until the next attempt. */
  private readonly errors = new Map<string, string>();
  private readonly now: () => Date;

  constructor(private readonly deps: LanaActionRunnerDependencies) {
    this.now = deps.now ?? (() => new Date());
  }

  async run(action: StoredAction): Promise<Result<null>> {
    const gate = this.gate(action);
    if (!gate.canRun) return blocked(gate.runBlockReason ?? "This action cannot run right now.");
    const input = this.input(action);
    if (input === null) return blocked(EMAIL_STAYS_DRAFT);
    const { store, log } = this.deps;
    const executor = input.type === "task.create" ? "lana.task" : "lana.note";
    this.errors.delete(action.id);
    let current = action;
    try {
      if (current.status === "transferred") current = store.actions.transition(current.id, "resolved", "user");
      if (current.status === "resolved" || current.status === "failed") current = store.actions.transition(current.id, "confirmed", "user", { executor });
      const outcome = await this.deps.executor().run(input, store.ledger);
      current = store.actions.transition(current.id, "executed", "system", { executor });
      const saved = decodeStoredResolution(current.resolution);
      const result: ExecutionResult = {
        externalID: outcome.record.id,
        webURL: outcome.record.link,
        deduplicated: outcome.deduplicated,
        undo: { executor, externalID: outcome.record.id, url: lanaDeletePath(outcome.record.kind, outcome.record.matterID, outcome.record.id), expiresAt: outcome.undoUntil },
      };
      store.actions.setResolution(current.id, encodeStoredResolution({ target: saved?.target ?? { recipients: [] }, result }));
      await store.appendAudit(AUDIT_EVENTS.actionRan, current.id, { lana_id: outcome.record.id });
      log.info("actions.ran", { action: current.id, executor, deduplicated: outcome.deduplicated });
      return { ok: true, value: null };
    } catch (error) {
      const failure = this.failure(error);
      try {
        if (store.actions.get(current.id).status === "confirmed") store.actions.transition(current.id, "failed", "system", { reason: failure.code });
      } catch {
        // The action keeps its status; the page still shows the problem.
      }
      this.errors.set(action.id, failure.message);
      log.notice("actions.run_failed", { action: action.id, code: failure.code });
      return { ok: false, error: failure };
    }
  }

  async undo(action: StoredAction): Promise<Result<null>> {
    const gate = this.gate(action);
    if (!this.deps.isSignedIn()) return { ok: false, error: { code: "signedOut", message: LANA_ERROR_MESSAGES.signedOut } };
    const saved = decodeStoredResolution(action.resolution);
    const result = saved?.result;
    const kind = result?.undo.executor === "lana.task" ? "task" : result?.undo.executor === "lana.note" ? "note" : null;
    const matter = saved?.target.regarding?.kind === "matter" ? saved.target.regarding.id : null;
    if (!gate.canUndo || result === undefined || kind === null || matter === null) return { ok: false, error: { code: "undoClosed", message: UNDO_CLOSED } };
    this.errors.delete(action.id);
    try {
      await this.deps.executor().undo({ kind, id: result.externalID, matterID: matter }, result.undo.expiresAt);
      this.deps.store.actions.transition(action.id, "undone", "user");
      await this.deps.store.appendAudit(AUDIT_EVENTS.actionUndone, action.id, { lana_id: result.externalID });
      this.deps.log.info("actions.undone", { action: action.id });
      return { ok: true, value: null };
    } catch (error) {
      const failure = error instanceof LanaUndoClosedError ? { code: "undoClosed", message: UNDO_CLOSED } : this.failure(error);
      this.errors.set(action.id, failure.message);
      this.deps.log.notice("actions.undo_failed", { action: action.id, code: failure.code });
      return { ok: false, error: failure };
    }
  }

  gate(action: StoredAction): RunGate {
    const kind = kindOfType(action.type);
    const saved = decodeStoredResolution(action.resolution);
    const matter = saved?.target.regarding?.kind === "matter" ? saved.target.regarding.displayName : null;
    const phase = this.phase(action, saved);
    const open = phase.kind === "review" || phase.kind === "failed" || phase.kind === "interrupted";
    const runBlockReason = !open ? null
      : kind === "email" ? EMAIL_STAYS_DRAFT
        : !this.deps.isSignedIn() ? `Sign in to LANA on this ${this.deps.deviceNoun} to run actions.`
          : !this.deps.isEntitled() ? NOT_ENTITLED_MESSAGE
            : matterBlockReason(kind, matter !== null);
    const lana = saved?.result !== undefined && isLanaExecutor(saved.result.undo.executor) ? saved.result : undefined;
    return {
      phase,
      canRun: open && runBlockReason === null && (kind === "task" || kind === "note"),
      runTitle: phase.kind === "failed" || phase.kind === "interrupted" ? "Retry" : runTitleOf(kind, matter),
      runBlockReason,
      canUndo: phase.kind === "executed" && lana !== undefined && this.now().getTime() <= lana.undo.expiresAt.getTime(),
      lanaURL: lana?.webURL ?? null,
      actionError: this.errors.get(action.id) ?? null,
    };
  }

  // MARK: - Private

  /** What LANA gets, or null for a type that does not run on LANA. */
  private input(action: StoredAction): LanaActionInput | null {
    const matterID = decodeStoredResolution(action.resolution)?.target.regarding;
    const matter = matterID?.kind === "matter" ? matterID.id : "";
    const params = action.params;
    switch (params.type) {
      case "task.create":
        return { actionID: action.id, type: "task.create", idempotencyKey: action.idempotencyKey, matterID: matter, title: params.task.title, body: params.task.detail, dueDate: params.task.dueDate };
      case "note.log":
        return { actionID: action.id, type: "note.log", idempotencyKey: action.idempotencyKey, matterID: matter, title: params.note.subject, body: params.note.body };
      default:
        return null;
    }
  }

  private phase(action: StoredAction, saved: StoredResolution | null): ActionPhase {
    switch (action.status) {
      case "executed": {
        const result = saved?.result;
        return result === undefined
          ? { kind: "executed", externalID: "", deduplicated: false, undoExpiresAt: new Date(0).toISOString() }
          : { kind: "executed", externalID: result.externalID, deduplicated: result.deduplicated, undoExpiresAt: result.undo.expiresAt.toISOString() };
      }
      case "undone":
        return { kind: "undone" };
      case "dismissed":
        return { kind: "dismissed" };
      case "confirmed":
        return { kind: "interrupted" };
      case "failed":
        return { kind: "failed", reason: runFailureMessage(this.failedReason(action)) };
      default:
        return { kind: "review" };
    }
  }

  /** The code the last move to failed recorded (`intent.transition` audit detail). */
  private failedReason(action: StoredAction): string | undefined {
    try {
      for (const entry of [...this.deps.store.actions.history(action.id)].reverse()) {
        if (entry.event !== AUDIT_EVENTS.intentTransition) continue;
        const detail = JSON.parse(entry.detail) as Record<string, unknown>;
        if (detail["to"] === "failed") return typeof detail["reason"] === "string" ? detail["reason"] : undefined;
      }
    } catch {
      // An unreadable history falls back to the general message.
    }
    return undefined;
  }

  private failure(error: unknown): { code: string; message: string } {
    if (error instanceof LanaError) return { code: error.kind, message: error.message };
    if (error instanceof StoreError) return { code: "store", message: `LANA Briefs could not save this change on this ${this.deps.deviceNoun}. Try again.` };
    return { code: "unknown", message: "Something went wrong. Try again." };
  }
}

/** The message for a stored failure code: LANA's kinds, or the connectors' older codes. */
export function runFailureMessage(code: string | undefined): string {
  if (code !== undefined && (LANA_ERROR_KINDS as readonly string[]).includes(code)) return LANA_ERROR_MESSAGES[code as LanaErrorKind];
  return failureMessage(code);
}

/** The LANA call undo makes, kept with the result for reference (the bearer token goes only to the signed-in server). */
export function lanaDeletePath(kind: "task" | "note", matterID: string, id: string): string {
  const matter = encodeURIComponent(matterID);
  return kind === "task" ? `/api/v1/tasks/${encodeURIComponent(id)}?matter_id=${matter}` : `/api/v1/matters/${matter}/notes/${encodeURIComponent(id)}`;
}

function isLanaExecutor(executor: string): boolean {
  return executor === "lana.task" || executor === "lana.note";
}

function blocked(message: string): Result<null> {
  return { ok: false, error: { code: "blocked", message } };
}
