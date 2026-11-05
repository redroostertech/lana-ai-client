import type { CandidateIntent, CandidateIntentType } from "../intent/candidateIntent.js";
import { speakerDisplayName, type Speaker, type TranscriptSegment } from "../intent/meetingParts.js";
import { splitLines } from "./answerFormat.js";
import { formatLineValue, trimSpaces } from "./formatLine.js";
import type { ModelOutputValidation } from "./kernel.js";
import type { TextModel } from "./textModel.js";
import { WorkflowRunner } from "./workflowRunner.js";
import type { HandoffLog } from "../handoff/log.js";
import { clipDraftReplyShape, type ClipDraftObserver } from "./clipDraftDiagnostics.js";

/** What a clip draft makes: one action, one decision, or one follow-up task for an open question. */
export type ClipDraftKind = "action" | "decision" | "question";

/**
 * The reply format (`lana.clip.draft.v1`) for turning clipped transcript lines into one
 * action, one decision, or one follow-up task for an open question (Swift
 * `ClipDraftFormat`). The person reviews every draft before it is kept. Instructions and
 * parsing match Swift byte for byte (`clip-draft.json`).
 */
export const CLIP_DRAFT_SCHEMA = "lana.clip.draft.v1";
/** One labelled line is about 60 tokens. A reply cut short still parses. */
export const CLIP_DRAFT_MAX_RESPONSE_TOKENS = 120;

export function clipDraftInstructions(kind: ClipDraftKind): string {
  switch (kind) {
    case "action":
      return "You turn a few lines from a meeting the person recorded into one follow-up action for "
        + "their records. Use only what the lines say. Reply with exactly one line and nothing else:\n"
        + "ACTION: task | Short title | One sentence of detail | YYYY-MM-DD, or none | who, or none | client, matter or company, or none\n"
        + "The first field is task (someone must do something), note (something to record in the "
        + "file) or email (an email to send). Write a date only if a specific calendar date was said; "
        + "otherwise write none.";
    case "decision":
      return "You turn a few lines from a meeting the person recorded into one decision for their "
        + "records. Use only what the lines say. Reply with exactly one line and nothing else:\n"
        + "DECISION: one plain sentence stating what was decided, and by whom when it is said.";
    case "question":
      return "You turn an open question from a meeting the person recorded into one follow-up task "
        + "for them, so the question gets answered. Use only what the question and the lines say. "
        + "Reply with exactly one line and nothing else:\n"
        + "TASK: a short title of at most 8 words that starts with a verb, such as Research, Find out or Follow up with | one sentence on what to find out and why";
  }
}

/** The clipped lines, each with its speaker's name. */
export function clipDraftPrompt(lines: readonly TranscriptSegment[], speakers: readonly Speaker[]): string {
  const names = new Map(speakers.map((speaker) => [speaker.id, speakerDisplayName(speaker)] as const));
  return `Lines:\n${lines.map((line) => `${names.get(line.speaker) ?? line.speaker}: ${line.text}`).join("\n")}`;
}

/**
 * The open question, then the lines it came from, then what to write. A question placed
 * in the prompt invites an answer, so the last line asks for the task line instead.
 */
export function clipQuestionPrompt(question: string, lines: readonly TranscriptSegment[], speakers: readonly Speaker[]): string {
  return `Open question: ${trimSpaces(question)}\n${clipDraftPrompt(lines, speakers)}\n${CLIP_QUESTION_REQUEST}`;
}

/** The prompt's last line for an open question. */
export const CLIP_QUESTION_REQUEST = "Do not answer the question. Write the one TASK: line for the follow-up.";
/** A bare `title | detail` line is read as the task only when its title is this short. */
export const CLIP_BARE_TITLE_MAX_WORDS = 12;

/**
 * The kernel's output validator for `kind`: the reply must hold a line that kind's parser
 * reads, so a reply the parser would drop is retried instead of accepted.
 */
export function validateClipDraft(reply: string, kind: ClipDraftKind): ModelOutputValidation {
  const parsed = kind === "decision" ? parseClipDecision(reply) : kind === "question" ? parseClipQuestion(reply) : parseClipAction(reply);
  return parsed !== undefined ? { valid: true, parsed: {} } : { valid: false, reason: "no_draft_line" };
}

const ACTION_KINDS: readonly string[] = ["task", "note", "email"];

/** Swift `split(separator: "|", maxSplits:, omittingEmptySubsequences: false)`, each trimmed. */
function splitFields(body: string, maxSplits: number): string[] {
  const fields: string[] = [];
  let rest = body;
  while (fields.length < maxSplits) {
    const bar = rest.indexOf("|");
    if (bar < 0) break;
    fields.push(rest.slice(0, bar));
    rest = rest.slice(bar + 1);
  }
  fields.push(rest);
  return fields.map(trimSpaces);
}

function optionalField(field: string | undefined): string | undefined {
  const trimmed = trimSpaces(field ?? "");
  return trimmed === "" || trimmed.toLowerCase() === "none" ? undefined : trimmed;
}

/**
 * The drafted action, or undefined when the reply has none. Small models drop fields, so
 * the line is read tolerantly: with no kind first it is a task and the first field is the
 * title; with fewer than six fields only the kind, title and detail are kept, because which
 * optional fields were left out cannot be told. A detail of none is empty.
 */
export function parseClipAction(reply: string): CandidateIntent | undefined {
  for (const raw of splitLines(reply)) {
    const body = formatLineValue("ACTION:", trimSpaces(raw));
    if (body === undefined) continue;
    let fields = splitFields(body, 5);
    if (!ACTION_KINDS.includes(fields[0]!.toLowerCase())) fields = ["task", ...splitFields(body, 4)];
    const title = fields[1] ?? "";
    if (title === "") return undefined;
    const complete = fields.length === 6;
    const kind = fields[0]!.toLowerCase();
    const type: CandidateIntentType = kind === "note" ? "note.log" : kind === "email" ? "email.draft" : "task.create";
    const person = complete ? optionalField(fields[4]) : undefined;
    return {
      type,
      title,
      body: optionalField(fields[2]) ?? "",
      dueDate: complete ? optionalField(fields[3]) : undefined,
      // For an email, "who" is who it goes to.
      assigneeHint: type === "email.draft" ? undefined : person,
      recipients: type === "email.draft" && person !== undefined ? [person] : [],
      regardingName: complete ? optionalField(fields[5]) : undefined,
      confidence: 1,
    };
  }
  return undefined;
}

/**
 * The follow-up task for an open question (`TASK: title | detail`), or undefined. An
 * `ACTION:` line is read as a task too, since models fall back to the better known format.
 */
export function parseClipQuestion(reply: string): CandidateIntent | undefined {
  for (const raw of splitLines(reply)) {
    const body = formatLineValue("TASK:", unquoted(trimSpaces(raw)));
    if (body === undefined) continue;
    const [title = "", detail] = splitFields(body, 1);
    if (title === "") return undefined;
    return { type: "task.create", title, body: optionalField(detail) ?? "", recipients: [], confidence: 1 };
  }
  const action = parseClipAction(reply);
  if (action !== undefined) return { type: "task.create", title: action.title, body: action.body, recipients: [], confidence: 1 };
  // Models also drop the label and write the task as `title | detail`.
  for (const raw of splitLines(reply)) {
    const [title = "", detail] = splitFields(unquoted(trimSpaces(raw)).replace(BARE_MARKERS, ""), 1);
    if (detail === undefined || !isBareTitle(title)) continue;
    return { type: "task.create", title, body: optionalField(detail) ?? "", recipients: [], confidence: 1 };
  }
  return undefined;
}

/** List markers before a bare line (`- `, `* `, `> `). */
const BARE_MARKERS = /^[*\->\p{Zs}\t]+/u;
const WORD_SEPARATORS = /[\p{Zs}\t]+/u;

/** One pair of straight double quotes around a whole line comes off. */
function unquoted(line: string): string {
  return line.length >= 2 && line.startsWith("\"") && line.endsWith("\"") ? trimSpaces(line.slice(1, -1)) : line;
}

/** A task title, not prose or a label: starts with a letter, has no colon, and is short. */
function isBareTitle(title: string): boolean {
  if (title === "" || !/^\p{L}/u.test(title) || title.includes(":")) return false;
  return title.split(WORD_SEPARATORS).filter((word) => word !== "").length <= CLIP_BARE_TITLE_MAX_WORDS;
}

/** The drafted decision, or undefined when the reply has none. */
export function parseClipDecision(reply: string): string | undefined {
  for (const raw of splitLines(reply)) {
    const body = formatLineValue("DECISION:", trimSpaces(raw));
    if (body !== undefined && body !== "") return body;
  }
  return undefined;
}

/**
 * Drafts an action, a decision or an open question's follow-up task with the
 * `clip.draft.v1` workflow (Swift `ClipDrafter`). Undefined when the model is unavailable
 * or writes nothing usable; the person then starts from the fallback. A cancelled draft
 * rejects with the abort. Nothing is logged but ids and statuses.
 */
export class ClipDrafter {
  private readonly runner: WorkflowRunner;

  /** `observer` (the opt-in diagnostic) hears every model call as sizes and states, never text. */
  constructor(private readonly model: TextModel, private readonly log?: HandoffLog, private readonly observer?: ClipDraftObserver) {
    this.runner = new WorkflowRunner(model, log);
  }

  async action(lines: readonly TranscriptSegment[], speakers: readonly Speaker[], signal?: AbortSignal): Promise<CandidateIntent | undefined> {
    const reply = await this.draft("action", clipDraftPrompt(lines, speakers), lines, signal);
    return reply === undefined ? undefined : parseClipAction(reply);
  }

  async decision(lines: readonly TranscriptSegment[], speakers: readonly Speaker[], signal?: AbortSignal): Promise<string | undefined> {
    const reply = await this.draft("decision", clipDraftPrompt(lines, speakers), lines, signal);
    return reply === undefined ? undefined : parseClipDecision(reply);
  }

  /** One follow-up task for the open question, from the question and its lines. */
  async questionAction(question: string, lines: readonly TranscriptSegment[], speakers: readonly Speaker[], signal?: AbortSignal): Promise<CandidateIntent | undefined> {
    const reply = await this.draft("question", clipQuestionPrompt(question, lines, speakers), lines, signal);
    return reply === undefined ? undefined : parseClipQuestion(reply);
  }

  private async draft(kind: ClipDraftKind, content: string, lines: readonly TranscriptSegment[], signal?: AbortSignal): Promise<string | undefined> {
    if (lines.length === 0) return undefined;
    try {
      const runner = this.observer === undefined ? this.runner : new WorkflowRunner(this.observed(kind, this.observer), this.log);
      const run = await runner.run("clip.draft.v1", {
        instructions: clipDraftInstructions(kind),
        content,
        maximumResponseTokens: CLIP_DRAFT_MAX_RESPONSE_TOKENS,
        validators: { [CLIP_DRAFT_SCHEMA]: (reply) => validateClipDraft(reply, kind) },
        signal,
      });
      signal?.throwIfAborted();
      if (run.verdict.status !== "completed") return undefined;
      const reply = run.output("draft")?.["content"];
      return typeof reply === "string" ? reply : undefined;
    } catch (error) {
      if (signal?.aborted === true) throw signal.reason ?? error;
      return undefined;
    }
  }

  /** The model, timed and measured for the diagnostic. Each call is reported once, after it ends. */
  private observed(kind: ClipDraftKind, observer: ClipDraftObserver): TextModel {
    const model = this.model;
    let attempt = 0;
    return {
      modelID: model.modelID,
      availability: () => model.availability(),
      async respond(request) {
        attempt += 1;
        const started = Date.now();
        const prompt = { promptChars: [...request.prompt].length, promptLines: splitLines(request.prompt).length };
        try {
          const reply = await model.respond(request);
          const parsed = validateClipDraft(reply, kind).valid;
          safely(() => observer({ kind, attempt, ms: Date.now() - started, ...prompt, ...clipDraftReplyShape(reply, kind, parsed), modelError: null }));
          return reply;
        } catch (error) {
          safely(() => observer({
            kind, attempt, ms: Date.now() - started, ...prompt, replyChars: 0, replyLines: 0, label: "none", fields: 0, bareLine: false, rule: "model_error",
            modelError: error instanceof Error ? error.name : "unknown",
          }));
          throw error;
        }
      },
    };
  }
}

function safely(action: () => void): void {
  try {
    action();
  } catch {
    // A diagnostic never changes a draft.
  }
}
