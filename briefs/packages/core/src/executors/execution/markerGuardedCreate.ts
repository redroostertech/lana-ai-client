import { SILENT_LOG, type HandoffLog } from "../../handoff/log.js";
import type { Clock } from "../../handoff/ports.js";
import { HTTPError } from "../http/httpError.js";
import type { HTTPResponse } from "../http/httpResponse.js";
import { OAuthError } from "../oauth/oauthError.js";
import type { ActionPlan, ExecutorKind } from "./actionPlan.js";
import type { AuthorizedHTTPClient } from "./authorizedHTTPClient.js";
import { UNDO_WINDOW, type ExecutionResult, type UndoToken } from "./executionResult.js";
import { ExecutorError } from "./executorError.js";
import type { IdempotencyLedger } from "./idempotencyLedger.js";
import { plannedRequestHash } from "./plannedRequest.js";

export interface CreatedRecord {
  readonly id: string;
  readonly webURL?: string | undefined;
}

/**
 * Shared execute path for every create executor (Swift `MarkerGuardedCreate`): verify the
 * plan hash, record the attempt in the ledger, look for the marker, send the planned
 * request, and on an ambiguous failure look for the marker again before any resend.
 * A POST is never resent blindly.
 */
export class MarkerGuardedCreate {
  constructor(
    readonly kind: ExecutorKind,
    readonly http: AuthorizedHTTPClient,
    readonly clock: Clock,
    private readonly undoURL: (id: string) => string | undefined,
    private readonly log: HandoffLog = SILENT_LOG,
  ) {}

  async run(
    plan: ActionPlan,
    ledger: IdempotencyLedger,
    findExisting: () => Promise<CreatedRecord | undefined>,
    decodeCreated: (response: HTTPResponse) => CreatedRecord,
  ): Promise<ExecutionResult> {
    if (plan.executor !== this.kind) throw ExecutorError.wrongExecutor();
    if (plannedRequestHash(plan.request) !== plan.planHash) throw ExecutorError.planHashMismatch();

    const entry = await ledger.begin(plan.idempotencyKey, plan.planHash);
    if (entry.state.kind === "completed") {
      this.log.info("executor.ledger_hit", { intent: plan.intentID });
      return entry.state.result;
    }

    try {
      const existing = await findExisting();
      if (existing !== undefined) return await this.finish(plan, existing, true, ledger);
      const policy = this.http.client.retryPolicy;
      let attempt = 1;
      for (;;) {
        try {
          const response = await this.http.send(plan.request);
          response.requireSuccess(this.clock.now());
          return await this.finish(plan, decodeCreated(response), false, ledger);
        } catch (error) {
          if (!(error instanceof HTTPError) || !error.isRetryable || attempt >= policy.maxAttempts) throw error;
          this.log.notice("executor.ambiguous_create", { intent: plan.intentID, attempt });
          const landed = await findExisting();
          if (landed !== undefined) return await this.finish(plan, landed, true, ledger);
          const retryAfter = error.reason.kind === "status" ? error.reason.retryAfter : undefined;
          await this.http.client.sleeper.sleep(policy.delay(attempt, retryAfter));
          attempt += 1;
        }
      }
    } catch (error) {
      try {
        await ledger.fail(plan.idempotencyKey, `${typeName(error)}: ${safeDescription(error)}`);
      } catch {
        // The original failure matters more than the ledger write.
      }
      throw error;
    }
  }

  async undo(token: UndoToken): Promise<void> {
    if (token.executor !== this.kind) throw ExecutorError.wrongExecutor();
    if (this.clock.now().getTime() > token.expiresAt.getTime()) throw ExecutorError.undoExpired();
    await this.http.delete(token.url);
    this.log.info("executor.undone", { executor: token.executor });
  }

  private async finish(plan: ActionPlan, record: CreatedRecord, deduplicated: boolean, ledger: IdempotencyLedger): Promise<ExecutionResult> {
    const url = this.undoURL(record.id);
    if (url === undefined) throw ExecutorError.unexpectedResponse();
    const result: ExecutionResult = {
      externalID: record.id,
      webURL: record.webURL,
      undo: { executor: this.kind, externalID: record.id, url, expiresAt: new Date(this.clock.now().getTime() + UNDO_WINDOW * 1000) },
      deduplicated,
    };
    await ledger.complete(plan.idempotencyKey, result);
    this.log.info("executor.executed", { intent: plan.intentID, deduplicated });
    return result;
  }
}

/** Swift `String(describing: type(of: error))` for the errors the executors raise. */
function typeName(error: unknown): string {
  if (error instanceof HTTPError) return "HTTPError";
  if (error instanceof ExecutorError) return "ExecutorError";
  if (error instanceof OAuthError) return "OAuthError";
  return error instanceof Error ? error.name : "Error";
}

/** Our error types never carry names or bodies; anything else is reduced to its type. */
function safeDescription(error: unknown): string {
  if (error instanceof HTTPError || error instanceof ExecutorError || error instanceof OAuthError) return error.description;
  return "unclassified";
}
