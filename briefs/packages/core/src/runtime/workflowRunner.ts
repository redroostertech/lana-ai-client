import { randomUUID } from "node:crypto";
import { BackendError } from "../ask/backend.js";
import { SILENT_LOG, type HandoffLog } from "../handoff/log.js";
import {
  BRIEFING_FRAMING_PREFIX, runWorkflow,
  type GateEvaluation, type JsonLike, type JsonRecord, type ModelOutputValidation, type StepRecord, type WorkflowMessage, type WorkflowVerdict,
} from "./kernel.js";
import type { TextModel } from "./textModel.js";
import { workflowDefinition, type WorkflowName } from "./workflows.js";

export type Validator = (content: string) => ModelOutputValidation;
export type Gate = (content: string, output: JsonLike | undefined) => GateEvaluation;

/** What one workflow run left behind. Held in memory for this run only. */
export class WorkflowRun {
  constructor(
    readonly verdict: WorkflowVerdict,
    /** Every step record (begin and end, with attempts). */
    readonly trail: readonly StepRecord[],
    /** The model's own error when the run failed because the model threw. */
    readonly modelError: BackendError | undefined,
  ) {}

  /** The final output of `stepID`, as the kernel recorded it. */
  output(stepID: string): JsonRecord | undefined {
    const steps = this.verdict.output["step_outputs"];
    if (typeof steps !== "object" || steps === null || Array.isArray(steps)) return undefined;
    const step = (steps as JsonRecord)[stepID];
    return typeof step === "object" && step !== null && !Array.isArray(step) ? step as JsonRecord : undefined;
  }

  /** Attempts made for `stepID` (1 when it succeeded first time). */
  attempts(stepID: string): number {
    return this.trail.filter((record) => record.stepID === stepID && record.phase === "begin").length;
  }
}

export interface WorkflowRunOptions {
  /** The system instructions, including the required output format. */
  readonly instructions: string;
  /** The material for this run (passages and question). */
  readonly content: string;
  readonly maximumResponseTokens: number;
  /** Output format validators by the `output_schema` names the definition uses. */
  readonly validators: Readonly<Record<string, Validator>>;
  /** Output gates by the gate ids the definition uses. */
  readonly gates?: Readonly<Record<string, Gate>>;
  /** Each model call's reply so far. A retry starts again from the beginning. */
  readonly onText?: ((text: string) => void) | undefined;
  readonly signal?: AbortSignal | undefined;
}

/**
 * The kernel's messages as the local model takes them (Swift `ModelMessages`): the system
 * prompt becomes the instructions; the run's material (a "briefing" system message behind
 * the kernel's fixed label) and then the step's own prompt become the prompt.
 */
export function modelMessages(messages: readonly WorkflowMessage[]): { instructions: string; prompt: string } {
  const instructions: string[] = [];
  const material: string[] = [];
  const steps: string[] = [];
  for (const message of messages) {
    if (message.role === "system" && message.content.startsWith(BRIEFING_FRAMING_PREFIX)) material.push(message.content.slice(BRIEFING_FRAMING_PREFIX.length));
    else if (message.role === "system") {
      if (message.content.length > 0) instructions.push(message.content);
    } else if (message.content.length > 0) steps.push(message.content);
  }
  return { instructions: instructions.join("\n\n"), prompt: [...material, ...steps].join("\n\n") };
}

/** Why a step failed, as a short code: the validator's reason or the kernel's error. Never reply text. */
export function failureReason(output: JsonLike | undefined): string | undefined {
  if (typeof output !== "object" || output === null || Array.isArray(output)) return undefined;
  const object = output as JsonRecord;
  if (typeof object["parse_error"] === "string") return `format:${object["parse_error"]}`;
  if (typeof object["error"] === "string") return `error:${object["error"].slice(0, 80)}`;
  return undefined;
}

/**
 * Runs a bundled workflow on the kernel with the local model behind the model port.
 * Nothing leaves the machine: there are no tools, step records stay in memory, and logs
 * carry ids and statuses, never text.
 */
export class WorkflowRunner {
  constructor(private readonly model: TextModel, private readonly log: HandoffLog = SILENT_LOG) {}

  async run(name: WorkflowName, options: WorkflowRunOptions): Promise<WorkflowRun> {
    const runID = randomUUID();
    const trail: StepRecord[] = [];
    let modelError: BackendError | undefined;
    const gates = options.gates ?? {};
    const verdict = await runWorkflow(
      { definition: workflowDefinition(name), runID, systemPrompt: options.instructions, briefing: options.content, signal: options.signal },
      {
        callModel: async (messages, { temperature, signal }) => {
          const shaped = modelMessages(messages);
          try {
            const content = await this.model.respond({
              instructions: shaped.instructions, prompt: shaped.prompt, temperature,
              maximumResponseTokens: options.maximumResponseTokens, onText: options.onText, signal,
            });
            return { content };
          } catch (error) {
            if (error instanceof BackendError) modelError = error;
            throw error;
          }
        },
        persist: (record) => {
          trail.push(record);
        },
        validateModelOutput: (schema, content) => options.validators[schema]?.(content) ?? { valid: false, reason: `unknown_schema:${schema}` },
        ...(Object.keys(gates).length === 0 ? {} : {
          evaluateGate: (id: string, content: string, _phase: unknown, output: JsonLike) =>
            gates[id]?.(content, output) ?? { verdict: "withhold" as const, reason: `unknown_gate:${id}` },
        }),
      },
    );
    const run = new WorkflowRun(verdict, trail, modelError);
    const steps = trail.filter((record) => record.phase === "end").map((record) => {
      const reason = record.status === "errored" ? failureReason(record.output) : undefined;
      return `${record.stepID}=${record.status}#${record.attempt}${reason === undefined ? "" : `(${reason})`}`;
    }).join(",");
    this.log.info("runtime.run", { workflow: name, run: runID, status: verdict.status, steps, model_error: modelError?.message ?? "none" });
    return run;
  }
}
