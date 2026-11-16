import { speakerDisplayName, type Speaker, type TranscriptSegment } from "../intent/meetingParts.js";
import { splitLines } from "../runtime/answerFormat.js";
import type { ModelOutputValidation } from "../runtime/kernel.js";
import { lineScores, verifiedLines } from "./lineMatcher.js";
import { spansFor, type DraftPoint } from "./summaryReducer.js";
import { textSimilarity } from "./textNormalizer.js";
import { chunkLine, chunkPromptText, segmentAtLine, type TokenCounter, type TranscriptChunk } from "./transcriptChunk.js";

/** The open questions the notes still list and the later lines that might answer them (Swift `QuestionCheckRequest`). */
export interface QuestionCheckRequest {
  readonly questions: readonly string[];
  /** Candidate answer lines in meeting order, numbered `L1`... like a chunk. */
  readonly lines: TranscriptChunk;
  readonly speakers: readonly Speaker[];
}

/** A question the model says the meeting answered; unverified until `applyQuestionCheck` (Swift `QuestionResolution`). */
export interface QuestionResolution {
  /** 0-based index into `questions`. */
  readonly question: number;
  readonly answer: string;
  /** 1-based lines of `lines`. */
  readonly lines: readonly number[];
}

/** Swift `QuestionCheckFormat` (`lana.notes.questions.v1`). */
export const QUESTION_CHECK_SCHEMA = "lana.notes.questions.v1";
export const QUESTION_CHECK_MAX_RESPONSE_TOKENS = 160;
const MAX_LINES_PER_ANSWER = 4;

export const QUESTION_CHECK_INSTRUCTIONS = "You check whether questions raised in a meeting were answered later in the same meeting. "
  + "Each transcript line looks like: L4 S1 [12.0-15.5]: text. "
  + "Reply with one line per question and nothing else, in exactly this format:\n"
  + "Q1: answered | 3, 4 | One short sentence stating the answer.\n"
  + "Q2: open\n"
  + "Write answered only when the cited lines clearly answer that question. "
  + "The numbers are the L numbers of the lines that give the answer. "
  + "Write open when the lines do not answer it, or only touch on it.";

export function questionCheckPrompt(request: QuestionCheckRequest): string {
  const parts: string[] = [];
  const named = request.speakers.filter((speaker) => speaker.name !== undefined);
  if (named.length > 0) parts.push(`Speakers: ${named.map((speaker) => `${speaker.id} is ${speakerDisplayName(speaker)}`).join(", ")}.`);
  parts.push(`Questions:\n${request.questions.map((question, index) => `Q${index + 1}: ${question}`).join("\n")}`);
  parts.push(`Later in the meeting:\n${chunkPromptText(request.lines)}`);
  return parts.join("\n\n");
}

/** `Q3: rest` (Markdown dressing ignored) as [3, rest]. */
function questionLabel(rawLine: string): [number, string] | undefined {
  const line = rawLine.replace(/^[*_#\->`\p{Zs}\t]+|[*_#\->`\p{Zs}\t]+$/gu, "");
  if (line[0] !== "Q" && line[0] !== "q") return undefined;
  const digits = /^\d+/u.exec(line.slice(1))?.[0];
  if (digits === undefined) return undefined;
  const rest = line.slice(1 + digits.length).replace(/^[*_` ]+/u, "");
  if (rest[0] !== ":") return undefined;
  return [Number(digits), rest.slice(1).replace(/^[*_` ]+|[*_` ]+$/gu, "")];
}

export function validateQuestionCheck(reply: string): ModelOutputValidation {
  return splitLines(reply).some((line) => questionLabel(line) !== undefined) ? { valid: true, parsed: {} } : { valid: false, reason: "no_recognised_lines" };
}

/** The answered questions in `reply`; open ones, unknown numbers and answers citing no request line are left out. */
export function parseQuestionCheck(reply: string, request: QuestionCheckRequest): QuestionResolution[] {
  const out: QuestionResolution[] = [];
  for (const raw of splitLines(reply)) {
    const label = questionLabel(raw);
    if (label === undefined || label[0] < 1 || label[0] > request.questions.length) continue;
    const bar1 = label[1].indexOf("|");
    const bar2 = bar1 < 0 ? -1 : label[1].indexOf("|", bar1 + 1);
    if (bar2 < 0) continue;
    const fields = [label[1].slice(0, bar1), label[1].slice(bar1 + 1, bar2), label[1].slice(bar2 + 1)].map((field) => field.trim());
    if (fields[0]!.toLowerCase() !== "answered" || fields[2] === "") continue;
    const seen = new Set<number>();
    const lines = fields[1]!.split(/[, ]/u)
      .map((token) => token.replace(/^[Ll]+|[Ll]+$/gu, ""))
      .filter((token) => /^\d+$/u.test(token))
      .map(Number)
      .filter((line) => segmentAtLine(request.lines, line) !== undefined && !seen.has(line) && (seen.add(line), true))
      .slice(0, MAX_LINES_PER_ANSWER);
    if (lines.length === 0) continue;
    out.push({ question: label[0] - 1, answer: fields[2]!, lines });
  }
  return out;
}

/** What was sent: for each question, the drafts it came from, and the request. */
export interface QuestionCheckPlan {
  readonly drafts: readonly (readonly number[])[];
  readonly request: QuestionCheckRequest;
}

const LINES_PER_QUESTION = 3;
const FOLLOWING_LINES = 2;
const SAME_QUESTION = 0.8;
const BUDGET_TOKENS = 900;
const TIME_TOLERANCE = 0.5;

/**
 * Swift `OpenQuestionCheck.plan`: for each open question (repeats asked once), the lines right
 * after it and the later lines that share the most content with it, inside the token budget.
 * Undefined when there is no open question or no later line.
 */
export function planQuestionCheck(drafts: readonly DraftPoint[], transcript: readonly TranscriptSegment[], speakers: readonly Speaker[], counter: TokenCounter, maxQuestions: number): QuestionCheckPlan | undefined {
  const groups: number[][] = [];
  drafts.forEach((draft, index) => {
    if (draft.kind !== "open_question") return;
    const group = groups.find((item) => textSimilarity(drafts[item[0]!]!.text, draft.text) >= SAME_QUESTION);
    if (group !== undefined) group.push(index);
    else if (groups.length < maxQuestions) groups.push([index]);
  });
  if (groups.length === 0) return undefined;
  const best = new Map<number, number>();
  for (const group of groups) {
    const draft = drafts[group[0]!]!;
    const after = (draft.sources[0]?.end ?? 0) - TIME_TOLERANCE;
    const later = transcript.map((_, index) => index).filter((index) => transcript[index]!.start >= after);
    const scores = lineScores(draft.text, later.map((index) => transcript[index]!.text));
    const ranked = later.map((segment, offset) => [segment, scores[offset]!] as const).filter(([, score]) => score > 0)
      .sort((a, b) => b[1] - a[1]).slice(0, LINES_PER_QUESTION);
    for (const [segment, score] of ranked) best.set(segment, Math.max(best.get(segment) ?? 0, score));
    const top = Math.max(0, ...best.values()) + 1;
    for (const segment of later.slice(0, FOLLOWING_LINES)) best.set(segment, top);
  }
  if (best.size === 0) return undefined;
  const picked: number[] = [];
  let tokens = 0;
  for (const [segment] of [...best.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])) {
    const cost = counter.tokenCount(chunkLine(transcript[segment]!)) + 3;
    if (tokens + cost > BUDGET_TOKENS) continue;
    picked.push(segment);
    tokens += cost;
  }
  if (picked.length === 0) return undefined;
  const lines: TranscriptChunk = { index: 0, segments: picked.sort((a, b) => a - b).map((index) => transcript[index]!), estimatedTokens: tokens };
  return { drafts: groups, request: { questions: groups.map((group) => drafts[group[0]!]!.text), lines, speakers } };
}

/**
 * Swift `OpenQuestionCheck.apply`: each answered question becomes a key point stating the
 * answer, cited to the lines that gave it (only lines that exist and come after the question).
 */
export function applyQuestionCheck(resolutions: readonly QuestionResolution[], plan: QuestionCheckPlan, drafts: readonly DraftPoint[]): DraftPoint[] {
  const replaced = new Map<number, DraftPoint>();
  const removed = new Set<number>();
  for (const resolution of resolutions) {
    const group = plan.drafts[resolution.question];
    if (group === undefined) continue;
    const answer = resolution.answer.trim();
    if (answer === "" || replaced.has(group[0]!)) continue;
    const segments = plan.request.lines.segments;
    const lines = verifiedLines(answer, resolution.lines, segments);
    const after = (drafts[group[0]!]!.sources[0]?.end ?? 0) - TIME_TOLERANCE;
    const cited = [...new Set(lines)].sort((a, b) => a - b).flatMap((line) => {
      const segment = segmentAtLine(plan.request.lines, line);
      return segment === undefined || segment.start < after ? [] : [segment];
    });
    if (cited.length === 0) continue;
    const asked = drafts[group[0]!]!;
    // The answer keeps the question's transcript part, so the key point cap still takes points from every part.
    replaced.set(group[0]!, { kind: "summary", text: answer, sources: spansFor(cited), precision: "exact", ...(asked.chunk === undefined ? {} : { chunk: asked.chunk }) });
    for (const index of group.slice(1)) removed.add(index);
  }
  return drafts.flatMap((draft, index) => (removed.has(index) ? [] : [replaced.get(index) ?? draft]));
}
