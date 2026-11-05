import { SILENT_LOG, type HandoffLog } from "../../handoff/log.js";
import { SYSTEM_CLOCK, type Clock } from "../../handoff/ports.js";
import type { Intent } from "../../intent/intent.js";
import { fromUtf8 } from "../../bytes/utf8.js";
import type { ActionExecutor } from "../execution/actionExecutor.js";
import { makeActionPlan, type ActionPlan } from "../execution/actionPlan.js";
import type { ExecutionResult, UndoToken } from "../execution/executionResult.js";
import { ExecutorError, ResponseDecodingError } from "../execution/executorError.js";
import type { IdempotencyLedger } from "../execution/idempotencyLedger.js";
import { MarkerGuardedCreate } from "../execution/markerGuardedCreate.js";
import { jsonRequest } from "../execution/plannedRequest.js";
import type { ResolvedEntity, ResolvedTarget } from "../execution/resolvedTarget.js";
import { obj, parseResponse, str } from "../execution/responseJson.js";
import type { ClioClient } from "./clioClient.js";
import { ClioMarker } from "./clioMarker.js";
import { decodeClioCreatedId } from "./clioModels.js";

/**
 * note.log to a Clio note on a matter or contact (Swift `ClioNoteExecutor`). The note detail
 * ends with the marker line `Lana:<intent id>` so a retry finds the note instead of
 * creating a second one.
 */
export class ClioNoteExecutor implements ActionExecutor {
  readonly kind = "clio.note" as const;
  private readonly engine: MarkerGuardedCreate;

  constructor(private readonly clio: ClioClient, clock: Clock = SYSTEM_CLOCK, log: HandoffLog = SILENT_LOG) {
    this.engine = new MarkerGuardedCreate("clio.note", clio.http, clock, (id) => clio.recordURL("notes", id), log);
  }

  async plan(intent: Intent, target: ResolvedTarget): Promise<ActionPlan> {
    if (intent.params.type !== "note.log") throw ExecutorError.unsupportedIntent(intent.type);
    const params = intent.params.note;
    const regarding = target.regarding;
    if (regarding === undefined) throw ExecutorError.missingTarget();
    const noteType = noteTypeFor(regarding);
    const marker = ClioMarker.make(intent.id);
    const body = {
      data: {
        type: noteType,
        subject: params.subject,
        detail: ClioMarker.append(marker, params.body),
        regarding: { id: ClioMarker.numericID(regarding.id), type: noteType },
      },
    };
    return makeActionPlan({
      executor: this.kind,
      intentID: intent.id,
      idempotencyKey: intent.idempotencyKey,
      marker,
      request: jsonRequest("POST", this.clio.url("notes.json"), body),
      preview: {
        title: "Log note in Clio",
        fields: [
          { label: noteType === "Matter" ? "Matter" : "Contact", value: regarding.displayName },
          { label: "Subject", value: params.subject },
          { label: "Note", value: params.body },
        ],
      },
    });
  }

  async execute(plan: ActionPlan, ledger: IdempotencyLedger): Promise<ExecutionResult> {
    const noteType = plannedNoteType(plan);
    return this.engine.run(
      plan,
      ledger,
      async () => {
        const id = await this.clio.findMarked("notes", plan.marker, { type: noteType });
        return id === undefined ? undefined : { id };
      },
      (response) => ({ id: decodeClioCreatedId(parseResponse(response.body)) }),
    );
  }

  undo(token: UndoToken): Promise<void> {
    return this.engine.undo(token);
  }
}

function noteTypeFor(entity: ResolvedEntity): "Matter" | "Contact" {
  switch (entity.kind) {
    case "matter":
      return "Matter";
    case "contact":
      return "Contact";
    case "user":
      throw ExecutorError.invalidTarget("user");
  }
}

/** The note type the plan's body was built with (`data.type`). */
function plannedNoteType(plan: ActionPlan): string {
  if (plan.request.body === undefined) throw new ResponseDecodingError("$");
  let parsed: unknown;
  try {
    parsed = JSON.parse(fromUtf8(plan.request.body));
  } catch {
    throw new ResponseDecodingError("$");
  }
  return str(obj(obj(parsed, "$")["data"], "$.data"), "type", "$.data");
}
