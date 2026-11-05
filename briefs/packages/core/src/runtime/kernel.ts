/**
 * The part of the LANA agent-runtime kernel Lana runs on this computer: a declarative
 * workflow state machine with `llm_call` and `terminal` steps, a transition cap, output
 * validation by named schema, retries and output gates. It mirrors the Swift SDK the native
 * app runs (`lana-runtime-ios-sdk`, `WorkflowRuntime`) step for step, and reads the same JSON
 * workflow definitions. Every effect is an injected port. Tools, approvals and branches are
 * not run on this computer; a definition that uses them fails with a named reason.
 */

export type JsonLike = string | number | boolean | null | readonly JsonLike[] | { readonly [key: string]: JsonLike };
export type JsonRecord = { [key: string]: JsonLike };

export const BRIEFING_FRAMING_PREFIX = "MATTER/ORG BRIEFING (pre-fetched at run start; refresh via tools if newer data is needed):\n\n";
export const DEFAULT_MAX_TRANSITIONS = 64;
export const DEFAULT_LLM_TEMPERATURE = 0.2;

export type GatePhase = "output" | "release";
export type GateVerdict = "allow" | "rewrite" | "flag_and_deliver" | "withhold";

export interface WorkflowGate {
  readonly id: string;
  readonly on?: GatePhase;
  readonly config?: JsonLike;
}

export interface WorkflowState {
  readonly id: string;
  readonly type: string;
  readonly sub_prompt?: string;
  readonly temperature?: number;
  readonly output_schema?: string;
  readonly retry?: { readonly limit?: number; readonly backoffMs?: number; readonly strategy?: "fixed" | "exponential" };
  readonly gates?: readonly (string | WorkflowGate)[];
  readonly next?: string;
  readonly transitions?: readonly { readonly destination: string }[];
  readonly outcome?: string;
}

export interface WorkflowDefinition {
  readonly initial_state?: string;
  readonly states: readonly WorkflowState[];
}

export interface WorkflowMessage {
  readonly role: "system" | "user" | "assistant";
  readonly content: string;
}

export type ModelOutputValidation = { readonly valid: true; readonly parsed: JsonLike } | { readonly valid: false; readonly reason: string };

export interface GateEvaluation {
  readonly verdict: GateVerdict | undefined;
  readonly content?: string;
  readonly reason?: string;
  readonly findings?: readonly JsonLike[];
}

export type StepStatus = "running" | "completed" | "errored";

export interface StepRecord {
  readonly phase: "begin" | "end";
  readonly runID: string;
  readonly stepID: string;
  readonly status: StepStatus;
  readonly output?: JsonLike;
  readonly attempt: number;
  readonly willRetry?: boolean;
}

export type TerminalStatus = "completed" | "failed" | "invalid_definition" | "max_steps_exceeded";

export interface WorkflowVerdict {
  readonly status: TerminalStatus;
  readonly lastStepID: string | undefined;
  readonly stepsExecuted: number;
  readonly output: JsonRecord;
}

export interface WorkflowPorts {
  callModel(messages: readonly WorkflowMessage[], options: { readonly temperature: number; readonly signal?: AbortSignal | undefined }): Promise<{ content: string }>;
  persist(record: StepRecord): void;
  validateModelOutput?(schema: string, content: string): ModelOutputValidation;
  evaluateGate?(id: string, content: string, phase: GatePhase, output: JsonLike, config: JsonLike | undefined): Promise<GateEvaluation | undefined> | GateEvaluation | undefined;
  wait?(milliseconds: number): Promise<void>;
}

export interface WorkflowRequest {
  readonly definition: WorkflowDefinition;
  readonly runID: string;
  readonly systemPrompt?: string;
  readonly briefing?: string;
  readonly maxTransitions?: number;
  readonly signal?: AbortSignal | undefined;
}

const SUPPORTED_STEPS = new Set(["llm_call", "terminal"]);

/** The definition's initial state, or the reason it cannot run. */
export function validateDefinition(definition: WorkflowDefinition): { ok: true; initial: string } | { ok: false; reason: string } {
  if (!Array.isArray(definition.states) || definition.states.length === 0) return { ok: false, reason: "definition.states must be a non-empty array" };
  const ids = new Set<string>();
  for (const state of definition.states) {
    if (typeof state.id !== "string" || state.id.length === 0) return { ok: false, reason: "each state must have a string id" };
    if (ids.has(state.id)) return { ok: false, reason: `duplicate state id: ${state.id}` };
    ids.add(state.id);
  }
  const initial = definition.initial_state ?? definition.states[0]!.id;
  if (!ids.has(initial)) return { ok: false, reason: `initial_state ${initial} is not a defined state` };
  return { ok: true, initial };
}

interface RetryPolicy {
  readonly limit: number;
  readonly backoffMs: number;
  readonly strategy: "fixed" | "exponential";
}

function bounded(value: number | undefined, maximum: number): number {
  if (value === undefined || !Number.isFinite(value)) return 0;
  return Math.min(Math.max(Math.trunc(value), 0), maximum);
}

export function retryPolicy(state: WorkflowState): RetryPolicy {
  if (state.retry === undefined) return { limit: 0, backoffMs: 0, strategy: "fixed" };
  return { limit: bounded(state.retry.limit, 10), backoffMs: bounded(state.retry.backoffMs, 60_000), strategy: state.retry.strategy === "exponential" ? "exponential" : "fixed" };
}

function delayBeforeAttempt(policy: RetryPolicy, attempt: number): number {
  if (policy.backoffMs <= 0 || attempt <= 1) return 0;
  if (policy.strategy !== "exponential") return policy.backoffMs;
  return Math.min(60_000, policy.backoffMs * 2 ** (attempt - 2));
}

export function shouldRetry(policy: RetryPolicy, attempt: number, ok: boolean, output: JsonLike): boolean {
  if (policy.limit <= 0 || ok || attempt > policy.limit) return false;
  if (typeof output !== "object" || output === null || Array.isArray(output)) return true;
  const object = output as JsonRecord;
  if (object["deniedByPolicy"] === true || object["aborted"] === true) return false;
  return object["error"] !== "agent_step_max_iterations_exceeded";
}

interface StepResult {
  ok: boolean;
  output: JsonRecord;
  halt: boolean;
}

const failure = (message: string, aborted = false): StepResult => ({ ok: false, output: { error: message, aborted }, halt: false });

function gatesFor(state: WorkflowState, phase: GatePhase): WorkflowGate[] {
  return (state.gates ?? []).map((gate) => (typeof gate === "string" ? { id: gate } : gate)).filter((gate) => (gate.on ?? "output") === phase);
}

interface GateOutcome {
  readonly content: string;
  readonly withheld: boolean;
  readonly withheldBy?: string;
  readonly reason?: string;
  readonly ran: boolean;
  readonly findings: readonly JsonLike[];
}

async function runGates(state: WorkflowState, phase: GatePhase, content: string, output: JsonLike, ports: WorkflowPorts): Promise<GateOutcome> {
  const gates = gatesFor(state, phase);
  if (gates.length === 0) return { content, withheld: false, ran: false, findings: [] };
  const evaluate = ports.evaluateGate?.bind(ports);
  if (evaluate === undefined) return { content, withheld: true, withheldBy: gates[0]!.id, reason: "gate_port_not_wired", ran: true, findings: [] };
  let current = content;
  const findings: JsonLike[] = [];
  for (const gate of gates) {
    let decision: GateEvaluation | undefined;
    try {
      decision = await evaluate(gate.id, current, phase, output, gate.config);
    } catch (error) {
      return { content: current, withheld: true, withheldBy: gate.id, reason: `gate_threw:${error instanceof Error ? error.name : "error"}`, ran: true, findings };
    }
    if (decision === undefined) return { content: current, withheld: true, withheldBy: gate.id, reason: "gate_returned_nothing", ran: true, findings };
    let verdict: GateVerdict;
    let reason: string | undefined;
    if (decision.verdict === "rewrite" && decision.content === undefined) {
      verdict = "withhold";
      reason = "gate_rewrite_without_content";
    } else if (decision.verdict !== undefined) {
      verdict = decision.verdict;
      reason = decision.reason;
    } else {
      verdict = "withhold";
      reason = "gate_returned_nothing";
    }
    findings.push(...(decision.findings ?? []));
    if (verdict === "withhold") return { content: current, withheld: true, withheldBy: gate.id, ...(reason === undefined ? {} : { reason }), ran: true, findings };
    if (verdict === "rewrite") current = decision.content!;
  }
  return { content: current, withheld: false, ran: true, findings };
}

function messages(state: WorkflowState, request: WorkflowRequest): WorkflowMessage[] {
  const result: WorkflowMessage[] = [{ role: "system", content: request.systemPrompt ?? "" }];
  if (request.briefing !== undefined && request.briefing.length > 0) result.push({ role: "system", content: BRIEFING_FRAMING_PREFIX + request.briefing });
  // The definitions use no `${...}` templates, and the Swift SDK revision does not interpolate them either.
  result.push({ role: "user", content: state.sub_prompt ?? "" });
  return result;
}

/** Read through a call so the compiler does not assume the signal cannot change while awaiting. */
function isAborted(signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true;
}

async function perform(state: WorkflowState, request: WorkflowRequest, ports: WorkflowPorts): Promise<StepResult> {
  switch (state.type) {
    case "llm_call": {
      if (request.signal?.aborted === true) return failure("aborted before model call", true);
      let content: string;
      try {
        content = (await ports.callModel(messages(state, request), { temperature: state.temperature ?? DEFAULT_LLM_TEMPERATURE, signal: request.signal })).content;
      } catch (error) {
        if (isAborted(request.signal)) return failure("aborted during model call", true);
        return failure(error instanceof Error ? error.message : "model_call_failed");
      }
      if (isAborted(request.signal)) return failure("aborted during model call", true);
      const tokens = { input: 0, output: 0 };
      if (state.output_schema !== undefined) {
        if (ports.validateModelOutput === undefined) return failure(`output_schema_validator_not_wired:${state.output_schema}`);
        const validation = ports.validateModelOutput(state.output_schema, content);
        return validation.valid
          ? { ok: true, output: { content, parsed: validation.parsed, parse_error: null, tokens }, halt: false }
          : { ok: false, output: { content, parsed: null, parse_error: validation.reason, tokens }, halt: false };
      }
      return { ok: true, output: { content, parsed: null, parse_error: null, tokens }, halt: false };
    }
    case "terminal":
      return { ok: true, output: { outcome: state.outcome ?? null, terminal: true }, halt: true };
    default:
      return failure(`step type ${state.type} is not run on this computer`);
  }
}

/** Runs one workflow to a verdict. Setup errors throw; everything that happens to a run returns. */
export async function runWorkflow(request: WorkflowRequest, ports: WorkflowPorts): Promise<WorkflowVerdict> {
  if (request.runID.length === 0) throw new Error("runID is required");
  const validation = validateDefinition(request.definition);
  if (!validation.ok) return { status: "invalid_definition", lastStepID: undefined, stepsExecuted: 0, output: { error: validation.reason } };
  for (const state of request.definition.states) {
    if (!SUPPORTED_STEPS.has(state.type)) {
      return { status: "invalid_definition", lastStepID: undefined, stepsExecuted: 0, output: { error: `step type ${state.type} is not run on this computer` } };
    }
  }
  const states = new Map(request.definition.states.map((state) => [state.id, state]));
  const maxTransitions = request.maxTransitions ?? DEFAULT_MAX_TRANSITIONS;
  const outputs: JsonRecord = {};
  let current: string | undefined = validation.initial;
  let last: string | undefined;
  let executed = 0;
  let terminal: TerminalStatus = "completed";
  let release: JsonRecord | undefined;

  while (current !== undefined) {
    if (executed >= maxTransitions) {
      terminal = "max_steps_exceeded";
      break;
    }
    const state = states.get(current);
    if (state === undefined) {
      terminal = "invalid_definition";
      break;
    }
    last = state.id;
    const policy = retryPolicy(state);
    let attempt = 0;
    let result: StepResult = failure("step did not run");
    let haltedByGate = false;
    let exceeded = false;
    for (;;) {
      attempt += 1;
      if (executed + attempt > maxTransitions) {
        exceeded = true;
        break;
      }
      const delay = delayBeforeAttempt(policy, attempt);
      if (delay > 0) await (ports.wait?.(delay) ?? new Promise((resolve) => setTimeout(resolve, delay)));
      ports.persist({ phase: "begin", runID: request.runID, stepID: state.id, status: "running", attempt });
      result = await perform(state, request, ports);
      if (shouldRetry(policy, attempt, result.ok, result.output)) {
        ports.persist({ phase: "end", runID: request.runID, stepID: state.id, status: "errored", output: result.output, attempt, willRetry: true });
        continue;
      }
      if (result.ok) {
        for (const phase of ["output", "release"] as const) {
          const content = typeof result.output["content"] === "string" ? result.output["content"] : "";
          const outcome = await runGates(state, phase, content, result.output, ports);
          if (!outcome.ran) continue;
          if (release === undefined || release["withheld"] !== true) {
            release = outcome.withheld
              ? { withheld: true, by: outcome.withheldBy ?? null, reason: outcome.reason ?? null, step_id: state.id, findings: [...outcome.findings] }
              : { withheld: false, by: null, reason: null, step_id: null, findings: [...outcome.findings] };
          }
          if (typeof result.output["content"] === "string") {
            result.output["content"] = outcome.withheld ? "" : outcome.content;
            if (outcome.withheld) {
              result.output["withheld"] = true;
              result.output["withheld_by"] = outcome.withheldBy ?? null;
              result.output["withheld_reason"] = outcome.reason ?? null;
            }
          }
          if (outcome.withheld) {
            haltedByGate = true;
            break;
          }
        }
      }
      ports.persist({ phase: "end", runID: request.runID, stepID: state.id, status: result.ok ? "completed" : "errored", output: result.output, attempt });
      break;
    }
    if (exceeded) {
      terminal = "max_steps_exceeded";
      break;
    }
    outputs[state.id] = result.output;
    executed += 1;
    if (haltedByGate) break;
    if (result.halt) {
      terminal = result.ok ? "completed" : "failed";
      break;
    }
    if (!result.ok) {
      terminal = "failed";
      break;
    }
    current = state.transitions?.[0]?.destination ?? state.next;
  }
  const output: JsonRecord = { step_outputs: outputs, last_step_id: last ?? null };
  if (release !== undefined) output["release"] = release;
  return { status: terminal, lastStepID: last, stepsExecuted: executed, output };
}
