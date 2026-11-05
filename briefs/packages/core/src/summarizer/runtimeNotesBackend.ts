import { BackendError } from "../ask/backend.js";
import type { HandoffLog } from "../handoff/log.js";
import type { TextModel } from "../runtime/textModel.js";
import { WorkflowRunner } from "../runtime/workflowRunner.js";
import type { NotesBackend } from "./meetingSummarizer.js";
import { NOTES_MAX_RESPONSE_TOKENS, NOTES_SCHEMA, notesInstructions, notesPrompt, parseNotes, validateNotes, type ChunkExtraction, type ChunkRequest } from "./notesFormat.js";
import { HEURISTIC_TOKENS, type TokenCounter } from "./transcriptChunk.js";

/**
 * Notes for one chunk from the `notes.chunk.v1` workflow (Swift `RuntimeNotesBackend`): one
 * model call in `NotesFormat`, retried once when the reply is unreadable or the model throws.
 */
export class RuntimeNotesBackend implements NotesBackend {
  private readonly runner: WorkflowRunner;

  constructor(private readonly model: TextModel, log?: HandoffLog, readonly tokenCounter: TokenCounter = HEURISTIC_TOKENS) {
    this.runner = new WorkflowRunner(model, log);
  }

  get modelID(): string {
    return this.model.modelID;
  }

  availability() {
    return this.model.availability();
  }

  async extract(request: ChunkRequest, signal?: AbortSignal): Promise<ChunkExtraction> {
    const run = await this.runner.run("notes.chunk.v1", {
      instructions: notesInstructions(request.phrasing),
      content: notesPrompt(request),
      maximumResponseTokens: NOTES_MAX_RESPONSE_TOKENS,
      validators: { [NOTES_SCHEMA]: validateNotes },
      signal,
    });
    signal?.throwIfAborted();
    const content = run.output("extract")?.["content"];
    if (run.verdict.status !== "completed" || typeof content !== "string") throw run.modelError ?? BackendError.malformedOutput();
    return parseNotes(content, request.chunk);
  }
}
