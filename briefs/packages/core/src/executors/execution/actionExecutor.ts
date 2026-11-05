import type { Intent } from "../../intent/intent.js";
import type { ActionPlan, ExecutorKind } from "./actionPlan.js";
import type { ExecutionResult, UndoToken } from "./executionResult.js";
import type { IdempotencyLedger } from "./idempotencyLedger.js";
import type { ResolvedTarget } from "./resolvedTarget.js";

/**
 * Turns a confirmed intent into one external write (Swift `ActionExecutor`).
 *
 * `plan` builds the exact request for the confirmation card. `execute` sends that request
 * byte for byte (verified by hash), guarded by the ledger and a marker search. `undo`
 * deletes the record while the token is inside its window.
 */
export interface ActionExecutor {
  readonly kind: ExecutorKind;
  plan(intent: Intent, target: ResolvedTarget): Promise<ActionPlan>;
  execute(plan: ActionPlan, ledger: IdempotencyLedger): Promise<ExecutionResult>;
  undo(token: UndoToken): Promise<void>;
}
