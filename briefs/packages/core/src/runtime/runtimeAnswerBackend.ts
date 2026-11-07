import type { AnswerBackend, AnswerDraft, AnswerDraftHandler, AnswerOptions, AnswerRequest, ModelAnswer } from "../ask/askEngine.js";
import { BackendError, throwIfAborted, type BackendAvailability } from "../ask/backend.js";
import type { HandoffLog } from "../handoff/log.js";
import { ANSWER_INSTRUCTIONS, ANSWER_MAXIMUM_RESPONSE_TOKENS, ANSWER_SCHEMA, answerPrompt, draftAnswer, groundingGate, GROUNDING_GATE, parseAnswer, validateAnswer } from "./answerFormat.js";
import type { TextModel } from "./textModel.js";
import { WorkflowRunner } from "./workflowRunner.js";

/**
 * Ask (and Talk) answered by the `ask.answer.v1` workflow (Swift `RuntimeAnswerBackend`):
 * one model call in the answer format, retried once when the reply is unreadable or the
 * model throws, then the grounding gate. `AskEngine` verifies citations again on the way out.
 */
export class RuntimeAnswerBackend implements AnswerBackend {
  private readonly runner: WorkflowRunner;

  constructor(private readonly model: TextModel, log?: HandoffLog) {
    this.runner = new WorkflowRunner(model, log);
  }

  get modelID(): string {
    return this.model.modelID;
  }

  availability(): Promise<BackendAvailability> {
    return this.model.availability();
  }

  async answer(request: AnswerRequest, options: AnswerOptions = {}): Promise<ModelAnswer> {
    const run = await this.runner.run("ask.answer.v1", {
      instructions: ANSWER_INSTRUCTIONS,
      content: answerPrompt(request),
      maximumResponseTokens: ANSWER_MAXIMUM_RESPONSE_TOKENS,
      validators: { [ANSWER_SCHEMA]: validateAnswer },
      gates: { [GROUNDING_GATE]: groundingGate(new Set(request.passages.map((passage) => passage.label))) },
      onText: options.onDraft === undefined ? undefined : drafts(options.onDraft),
      signal: options.signal,
    });
    throwIfAborted(options.signal);
    const step = run.output("answer");
    if (run.verdict.status !== "completed" || step === undefined) throw run.modelError ?? BackendError.malformedOutput();
    // The gate found no supplied source behind the answer: not found, not a guess.
    if (step["withheld"] === true) return { answerable: false, answer: "", citations: [], kind: "fact" };
    const content = step["content"];
    if (typeof content !== "string") throw BackendError.malformedOutput();
    return parseAnswer(content);
  }
}

/** Turns the reply so far into drafts, reporting only when the draft changes. */
function drafts(report: AnswerDraftHandler): (reply: string) => void {
  let last: AnswerDraft | undefined;
  return (reply) => {
    const draft = draftAnswer(reply) ?? { kind: undefined, text: "" };
    if (last !== undefined && last.kind === draft.kind && last.text === draft.text) return;
    last = draft;
    report(draft);
  };
}
