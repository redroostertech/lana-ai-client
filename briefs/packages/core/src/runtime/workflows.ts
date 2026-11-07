import type { WorkflowDefinition } from "./kernel.js";

/**
 * The workflow definitions Lana runs, identical to the JSON the native app bundles
 * (`LanaRuntime/Workflows/*.json`; a test checks they stay equal). Kept in code so the
 * Electron main bundle needs no data files.
 */
export const WORKFLOW_NAMES = ["ask.answer.v1", "clip.draft.v1", "notes.chunk.v1"] as const;
export type WorkflowName = (typeof WORKFLOW_NAMES)[number];

const ASK_ANSWER_V1: WorkflowDefinition = {
  initial_state: "answer",
  states: [
    {
      id: "answer",
      type: "llm_call",
      sub_prompt: "Reply in this format and nothing else. First line: KIND: fact, or KIND: suggestion if the question asks for advice, ideas, methods or next steps. Then ANSWER: the full answer, which may continue over several lines (a suggestion gives one direct sentence, then 3 to 6 concrete steps, each on its own line starting with - ), or ANSWER: NONE for a fact the passages do not give. Last line: SOURCES: the passage labels you used, such as P1, P3. Never repeat an earlier answer.",
      temperature: 0.1,
      output_schema: "lana.ask.answer.v1",
      retry: { limit: 1 },
      gates: [{ id: "lana.grounded_citations", on: "output" }],
      next: "answered",
    },
    { id: "answered", type: "terminal", outcome: "answered" },
  ],
};

const CLIP_DRAFT_V1: WorkflowDefinition = {
  initial_state: "draft",
  states: [
    {
      id: "draft",
      type: "llm_call",
      sub_prompt: "Reply with exactly one line in the format above and nothing else.",
      temperature: 0.2,
      output_schema: "lana.clip.draft.v1",
      retry: { limit: 1 },
      next: "drafted",
    },
    { id: "drafted", type: "terminal", outcome: "drafted" },
  ],
};

const NOTES_CHUNK_V1: WorkflowDefinition = {
  initial_state: "extract",
  states: [
    {
      id: "extract",
      type: "llm_call",
      sub_prompt: "Write the notes for this transcript part, in the required format.",
      temperature: 0.2,
      output_schema: "lana.notes.chunk.v1",
      retry: { limit: 1 },
      next: "extracted",
    },
    { id: "extracted", type: "terminal", outcome: "extracted" },
  ],
};

export function workflowDefinition(name: WorkflowName): WorkflowDefinition {
  switch (name) {
    case "ask.answer.v1":
      return ASK_ANSWER_V1;
    case "clip.draft.v1":
      return CLIP_DRAFT_V1;
    case "notes.chunk.v1":
      return NOTES_CHUNK_V1;
  }
}
