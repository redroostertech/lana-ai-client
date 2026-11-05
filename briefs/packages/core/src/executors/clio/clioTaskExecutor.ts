import { SILENT_LOG, type HandoffLog } from "../../handoff/log.js";
import { SYSTEM_CLOCK, type Clock } from "../../handoff/ports.js";
import type { Intent } from "../../intent/intent.js";
import { LanaDate } from "../../json/lanaDate.js";
import type { JsonObject } from "../../json/jsonValue.js";
import { graphemeCount } from "../../text/graphemes.js";
import type { ActionExecutor } from "../execution/actionExecutor.js";
import { makeActionPlan, type ActionPlan, type PreviewField } from "../execution/actionPlan.js";
import type { ExecutionResult, UndoToken } from "../execution/executionResult.js";
import { ExecutorError } from "../execution/executorError.js";
import type { IdempotencyLedger } from "../execution/idempotencyLedger.js";
import { MarkerGuardedCreate } from "../execution/markerGuardedCreate.js";
import { jsonRequest } from "../execution/plannedRequest.js";
import type { ResolvedEntity, ResolvedTarget } from "../execution/resolvedTarget.js";
import { parseResponse } from "../execution/responseJson.js";
import type { ClioClient } from "./clioClient.js";
import { ClioMarker } from "./clioMarker.js";
import { decodeClioCreatedId } from "./clioModels.js";

/**
 * task.create to a Clio task (Swift `ClioTaskExecutor`). `due_date` maps to `due_at`; the
 * assignee defaults to the connected user from who_am_i. The description ends with the marker line.
 */
export class ClioTaskExecutor implements ActionExecutor {
  readonly kind = "clio.task" as const;
  private readonly engine: MarkerGuardedCreate;

  constructor(private readonly clio: ClioClient, clock: Clock = SYSTEM_CLOCK, log: HandoffLog = SILENT_LOG) {
    this.engine = new MarkerGuardedCreate("clio.task", clio.http, clock, (id) => clio.recordURL("tasks", id), log);
  }

  async plan(intent: Intent, target: ResolvedTarget): Promise<ActionPlan> {
    if (intent.params.type !== "task.create") throw ExecutorError.unsupportedIntent(intent.type);
    const params = intent.params.task;
    if (params.dueDate !== undefined && !isCalendarDate(params.dueDate)) throw ExecutorError.invalidTarget("due_date");

    let matter: JsonObject | undefined;
    if (target.regarding !== undefined) {
      if (target.regarding.kind !== "matter") throw ExecutorError.invalidTarget("regarding");
      matter = { id: ClioMarker.numericID(target.regarding.id) };
    }
    let assignee: ResolvedEntity;
    if (target.assignee !== undefined) {
      if (target.assignee.kind !== "user") throw ExecutorError.invalidTarget("assignee");
      assignee = target.assignee;
    } else {
      const me = await this.clio.whoAmI();
      assignee = { kind: "user", id: me.id, displayName: me.name ?? "Me" };
    }

    const marker = ClioMarker.make(intent.id);
    const body = {
      data: {
        name: params.title,
        description: ClioMarker.append(marker, params.detail),
        due_at: params.dueDate,
        priority: "Normal",
        matter,
        assignee: { id: ClioMarker.numericID(assignee.id), type: "User" },
      },
    };
    const fields: PreviewField[] = [
      { label: "Task", value: params.title },
      { label: "Assignee", value: assignee.displayName },
      { label: "Due", value: params.dueDate ?? "No due date" },
    ];
    if (target.regarding !== undefined) fields.unshift({ label: "Matter", value: target.regarding.displayName });
    fields.push({ label: "Details", value: params.detail });
    return makeActionPlan({
      executor: this.kind,
      intentID: intent.id,
      idempotencyKey: intent.idempotencyKey,
      marker,
      request: jsonRequest("POST", this.clio.url("tasks.json"), body),
      preview: { title: "Create task in Clio", fields },
    });
  }

  execute(plan: ActionPlan, ledger: IdempotencyLedger): Promise<ExecutionResult> {
    return this.engine.run(
      plan,
      ledger,
      async () => {
        const id = await this.clio.findMarked("tasks", plan.marker, {});
        return id === undefined ? undefined : { id };
      },
      (response) => ({ id: decodeClioCreatedId(parseResponse(response.body)) }),
    );
  }

  undo(token: UndoToken): Promise<void> {
    return this.engine.undo(token);
  }
}

/** `YYYY-MM-DD` that `LanaDate.parse` accepts at midnight (its lenient month rules included). */
function isCalendarDate(raw: string): boolean {
  return LanaDate.parse(`${raw}T00:00:00.000Z`) !== null && graphemeCount(raw) === 10;
}
