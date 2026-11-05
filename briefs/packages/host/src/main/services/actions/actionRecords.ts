import type { EntityHint } from "@lana/core/intent";

/**
 * What an action stores about its target and its run on LANA (the `resolution` column of
 * the store's actions): the person's chosen target and the created record with its undo.
 */

/**
 * `lana.*` run on the firm's LANA server. `clio.*` and `graph.*` only appear in actions run
 * by the standalone app before Briefs moved into the LANA client; they are read, never run.
 */
export type ExecutorKind = "clio.note" | "clio.task" | "graph.draft" | "lana.task" | "lana.note";

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

/** What the person chose as the action's target. */
export interface ResolvedTarget {
  readonly regarding?: ResolvedEntity | undefined;
  readonly assignee?: ResolvedEntity | undefined;
  readonly recipients: readonly ResolvedRecipient[];
}

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
