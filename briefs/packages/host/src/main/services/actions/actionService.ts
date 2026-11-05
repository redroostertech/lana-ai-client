import type { ActionPlan as ExecutorPlan } from "@lana/core/executors";
import type { EntityHint, Intent } from "@lana/core/intent";
import type { LedgerRepository } from "@lana/core/store";

/**
 * What the action cards need from the executors (Swift `ExecutorProviding`,
 * `TargetResolving` and `ActionExecutor`). `ExecutorActionService` implements it over the
 * `ConnectorHub` and the resolver in `@lana/core/connectors`. The card rules (block
 * reasons, transitions, audit) stay in `ActionsService`.
 */
export interface ActionService {
  /** The resolver: a spoken target to a firm record. Never auto-merges near duplicates. */
  resolve(hint: EntityHint): Promise<Resolution>;
  /** Free-text search for the person to choose a record. */
  search(text: string, kind: "matter" | "contact"): Promise<TargetCandidate[]>;
  /** The exact request for a settled target, or why it cannot be prepared. */
  plan(intent: Intent, target: ResolvedTarget): Promise<PlanOutcome>;
  /** Runs the plan once, idempotently (marker search on retry), recording attempts in the ledger. */
  execute(plan: ActionPlan, ledger: LedgerRepository): Promise<ExecutionResult>;
  /** Reverses an executed action inside its window. */
  undo(token: UndoToken): Promise<void>;
}

/** Errors the service throws: a short code for the audit log and the card copy (Swift `ActionFailure`). */
export class ActionServiceError extends Error {
  override readonly name = "ActionServiceError";
  constructor(readonly code: string, message: string) {
    super(message);
  }
}

/** `lana.*` run on the firm's LANA server (the default route); `clio.*` and `graph.*` stay in the code, unrouted. */
export type ExecutorKind = "clio.note" | "clio.task" | "graph.draft" | "lana.task" | "lana.note";

/** A firm record from the mirror or a live search (Swift `Candidate`). */
export interface TargetCandidate {
  readonly kind: "matter" | "contact" | "company";
  readonly id: string;
  readonly name: string;
  readonly email?: string | undefined;
  readonly displayNumber?: string | undefined;
  readonly clientName?: string | undefined;
  readonly source: string;
}

export type Resolution =
  | { readonly kind: "match"; readonly candidate: TargetCandidate; readonly reasons: readonly string[] }
  | { readonly kind: "ambiguous"; readonly candidates: ReadonlyArray<{ readonly candidate: TargetCandidate; readonly reasons: readonly string[] }> }
  | { readonly kind: "noMatch" };

export interface ResolvedEntity {
  readonly kind: "matter" | "contact" | "user";
  /** External id in the target system. */
  readonly id: string;
  readonly displayName: string;
}

export interface ResolvedRecipient {
  readonly hint: EntityHint;
  /** Null while unresolved; any null blocks the plan. */
  readonly address: string | null;
  readonly displayName: string;
}

/** What the person confirmed on the card (Swift `ResolvedTarget`). */
export interface ResolvedTarget {
  readonly regarding?: ResolvedEntity | undefined;
  readonly assignee?: ResolvedEntity | undefined;
  readonly recipients: readonly ResolvedRecipient[];
}

export interface ActionPlan {
  readonly executor: ExecutorKind;
  readonly method: string;
  readonly url: string;
  /** Canonical JSON body exactly as it will be sent, or null. */
  readonly body: string | null;
  /** SHA-256 of the request, shown on the card and recorded on confirm. */
  readonly planHash: string;
  /** The executor's own plan (marker, idempotency key, request), sent verbatim on confirm. */
  readonly executable?: ExecutorPlan | undefined;
}

export type PlanOutcome = { readonly ok: true; readonly plan: ActionPlan } | { readonly ok: false; readonly code: string; readonly message: string };

export interface UndoToken {
  readonly executor: ExecutorKind;
  readonly externalID: string;
  /** The DELETE target (for LANA, the API path; undo sends it only to the signed-in server). */
  readonly url: string;
  readonly expiresAt: Date;
}

export interface ExecutionResult {
  readonly externalID: string;
  readonly webURL: string | null;
  readonly undo: UndoToken;
  /** True when an earlier attempt had already created the record. */
  readonly deduplicated: boolean;
}

export function executorFor(type: string): ExecutorKind | null {
  switch (type) {
    case "note.log":
      return "clio.note";
    case "task.create":
      return "clio.task";
    case "email.draft":
      return "graph.draft";
    default:
      return null;
  }
}

/** The connector an intent type needs, in the words Connections uses. */
export function connectorNameFor(type: string): string {
  return type === "email.draft" ? "Microsoft 365" : "Clio";
}
