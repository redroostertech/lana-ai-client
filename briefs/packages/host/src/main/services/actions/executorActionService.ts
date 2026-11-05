import { actionFailure, GatewayTargetResolver, matchReasonPhrase, MirrorCandidateSource, type MirrorSearching } from "@lana/core/connectors";
import {
  StoreIdempotencyLedger,
  type ActionExecutor, type Candidate, type CandidateSource, type ExecutionResult as ExecutorResult, type ResolvedTarget as ExecutorTarget,
  type Resolution as ExecutorResolution, type UndoToken as ExecutorUndoToken,
} from "@lana/core/executors";
import type { EntityHint, Intent } from "@lana/core/intent";
import type { LedgerRepository } from "@lana/core/store";
import type { MainLog } from "../../log.js";
import {
  ActionServiceError,
  type ActionPlan, type ActionService, type ExecutionResult, type ExecutorKind, type PlanOutcome, type ResolvedTarget, type Resolution,
  type TargetCandidate, type UndoToken,
} from "./actionService.js";

/** What the service needs from the `ConnectorHub` (Swift `ExecutorProviding` plus the live sources). */
export interface ExecutorProvider {
  /** Throws `ExecutorUnavailable` when the connector is not linked or the type is unknown. */
  executor(type: string): Promise<ActionExecutor>;
  liveSources(): Promise<CandidateSource[]>;
}

const INTENT_TYPE: Readonly<Record<ExecutorKind, string>> = {
  "clio.note": "note.log", "clio.task": "task.create", "graph.draft": "email.draft", "lana.task": "task.create", "lana.note": "note.log",
};

/**
 * The real `ActionService`: the resolver over the local mirror plus live Clio, and the
 * executors the hub builds for what is connected. Plans are the executor's exact request
 * and hash; execution goes through the store's ledger (`StoreIdempotencyLedger`), so an
 * interrupted run searches for its `Lana:` marker (or Graph property) before any resend.
 * Every failure becomes an `ActionServiceError` with the Mac's `ActionFailure` code and copy.
 */
export class ExecutorActionService implements ActionService {
  private readonly resolver: GatewayTargetResolver;

  constructor(
    private readonly hub: ExecutorProvider,
    mirror: MirrorSearching,
    private readonly deviceNoun: string,
    private readonly log: MainLog,
  ) {
    this.resolver = new GatewayTargetResolver(new MirrorCandidateSource(mirror), () => hub.liveSources());
  }

  async resolve(hint: EntityHint): Promise<Resolution> {
    return toResolution(await this.resolver.resolve(hint));
  }

  async search(text: string, kind: "matter" | "contact"): Promise<TargetCandidate[]> {
    return (await this.resolver.search(text, kind)).map(toCandidate);
  }

  async plan(intent: Intent, target: ResolvedTarget): Promise<PlanOutcome> {
    let executor: ActionExecutor;
    try {
      executor = await this.hub.executor(intent.type);
    } catch (error) {
      const failure = actionFailure(error, this.deviceNoun);
      return { ok: false, code: failure.code, message: failure.message };
    }
    try {
      const plan = await executor.plan(intent, toExecutorTarget(target));
      return {
        ok: true,
        plan: {
          executor: plan.executor,
          method: plan.request.method,
          url: plan.request.url,
          body: plan.request.body === undefined ? null : new TextDecoder().decode(plan.request.body),
          planHash: plan.planHash,
          executable: plan,
        },
      };
    } catch (error) {
      const failure = actionFailure(error, this.deviceNoun);
      this.log.notice("actions.plan_failed", { intent: intent.id, code: failure.code });
      return { ok: false, code: failure.code, message: failure.message };
    }
  }

  async execute(plan: ActionPlan, ledger: LedgerRepository): Promise<ExecutionResult> {
    const executable = plan.executable;
    if (executable === undefined || executable.planHash !== plan.planHash) throw new ActionServiceError("executor", "This action changed after it was prepared. Review it again.");
    const executor = await this.executorFor(plan.executor);
    try {
      return fromExecutorResult(await executor.execute(executable, new StoreIdempotencyLedger(ledger)));
    } catch (error) {
      throw this.serviceError(error);
    }
  }

  async undo(token: UndoToken): Promise<void> {
    const executor = await this.executorFor(token.executor);
    try {
      await executor.undo(toExecutorUndo(token));
    } catch (error) {
      throw this.serviceError(error);
    }
  }

  private async executorFor(kind: ExecutorKind): Promise<ActionExecutor> {
    try {
      return await this.hub.executor(INTENT_TYPE[kind]);
    } catch (error) {
      throw this.serviceError(error);
    }
  }

  private serviceError(error: unknown): ActionServiceError {
    const failure = actionFailure(error, this.deviceNoun);
    return new ActionServiceError(failure.code, failure.message);
  }
}

function toCandidate(candidate: Candidate): TargetCandidate {
  return {
    kind: candidate.kind === "matter" ? "matter" : candidate.kind === "company" ? "company" : "contact",
    id: candidate.id,
    name: candidate.name,
    email: candidate.email,
    displayNumber: candidate.displayNumber,
    clientName: candidate.clientName,
    source: candidate.source,
  };
}

function toResolution(resolution: ExecutorResolution): Resolution {
  switch (resolution.outcome) {
    case "match":
      return { kind: "match", candidate: toCandidate(resolution.candidate), reasons: resolution.reasons.map(matchReasonPhrase) };
    case "ambiguous":
      return { kind: "ambiguous", candidates: resolution.options.map((option) => ({ candidate: toCandidate(option.candidate), reasons: option.reasons.map(matchReasonPhrase) })) };
    case "no_match":
      return { kind: "noMatch" };
  }
}

function toExecutorTarget(target: ResolvedTarget): ExecutorTarget {
  return {
    regarding: target.regarding,
    assignee: target.assignee,
    recipients: target.recipients.map((recipient) => ({ hint: recipient.hint, address: recipient.address ?? undefined, displayName: recipient.displayName })),
  };
}

function toExecutorUndo(token: UndoToken): ExecutorUndoToken {
  // LANA records are undone by the LANA runner, never by a connector.
  if (token.executor === "lana.task" || token.executor === "lana.note") throw new ActionServiceError("executor", "This action was prepared for a different connection.");
  return { executor: token.executor, externalID: token.externalID, url: token.url, expiresAt: token.expiresAt };
}

function fromExecutorResult(result: ExecutorResult): ExecutionResult {
  return {
    externalID: result.externalID,
    webURL: result.webURL ?? null,
    deduplicated: result.deduplicated,
    undo: { executor: result.undo.executor, externalID: result.undo.externalID, url: result.undo.url, expiresAt: result.undo.expiresAt },
  };
}
