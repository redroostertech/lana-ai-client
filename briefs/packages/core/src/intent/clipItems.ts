import type { LanaId } from "../ids/lanaId.js";
import { graphemes } from "../text/graphemes.js";
import { trimWhitespace } from "../text/whitespace.js";
import type { CandidateIntent } from "./candidateIntent.js";
import type { Evidence, Intent } from "./intent.js";
import { assembleIntent } from "./intentAssembler.js";
import { sourceSpan, type KeyPoint } from "./keyPoint.js";
import type { TranscriptSegment } from "./meetingParts.js";
import type { TranscriptClip } from "./transcriptClip.js";
import { INTENT_LIMITS } from "./validator.js";

function prefix(text: string, count: number): string {
  return graphemes(text).slice(0, count).join("");
}

/**
 * Turns a clip into a proposed action or a decision (Swift `ClipItems`). The clipped lines
 * are the evidence: the person chose them, so they are quoted as they are rather than
 * searched for. `id` lets a test reuse an intent id; otherwise a new one is made.
 */
export function clipIntent(candidate: CandidateIntent, lines: readonly TranscriptSegment[], meetingID: LanaId, now: Date, id?: LanaId): Intent | undefined {
  const evidence: Evidence[] = lines.slice(0, INTENT_LIMITS.maxEvidence).map((line) => ({
    speaker: line.speaker, tStart: line.start, tEnd: line.end, quote: prefix(line.text, INTENT_LIMITS.maxQuote),
  }));
  const grounding = { evidence, citedCount: evidence.length, correctedCount: 0 };
  const first = assembleIntent(candidate, grounding, meetingID, now, id);
  if (first.ok) return first.intent;
  // An email with no one to send it to is still worth keeping as a task.
  if (candidate.type !== "email.draft") return undefined;
  const task = assembleIntent({ ...candidate, type: "task.create" }, grounding, meetingID, now, id);
  return task.ok ? task.intent : undefined;
}

/**
 * Why `clipIntent` refused a candidate, as the validator's field names only ("params.title"),
 * or the assembler's failure kind. Empty when it builds. For the drafting diagnostic.
 */
export function clipIntentIssues(candidate: CandidateIntent, lines: readonly TranscriptSegment[], meetingID: LanaId, now: Date): string[] {
  const evidence: Evidence[] = lines.slice(0, INTENT_LIMITS.maxEvidence).map((line) => ({
    speaker: line.speaker, tStart: line.start, tEnd: line.end, quote: prefix(line.text, INTENT_LIMITS.maxQuote),
  }));
  const result = assembleIntent(candidate, { evidence, citedCount: evidence.length, correctedCount: 0 }, meetingID, now);
  if (result.ok) return [];
  return result.failure.kind === "invalid" ? result.failure.issues.map((issue) => issue.field) : [result.failure.kind];
}

/** A decision key point sourced to the clip. */
export function clipDecision(text: string, clip: TranscriptClip, lines: readonly TranscriptSegment[]): KeyPoint {
  const speakers = new Set(lines.map((line) => line.speaker));
  return {
    id: `kp-clip-${clip.id}`,
    kind: "decision",
    text: trimWhitespace(text),
    sources: [sourceSpan(clip.start, clip.end, speakers.size === 1 ? lines[0]?.speaker : undefined)],
    precision: "exact",
  };
}

/** A blank task draft for when no model can write one: the clip's words as its detail. */
export function clipFallbackAction(lines: readonly TranscriptSegment[]): CandidateIntent {
  const text = lines.map((line) => line.text).join(" ");
  return { type: "task.create", title: "Follow up", body: prefix(text, INTENT_LIMITS.maxQuote), recipients: [], confidence: 1 };
}

/** The starting point for an open question no model could draft: "Follow up: <question>", the clip's words as its detail. */
export function clipQuestionFallbackAction(question: string, lines: readonly TranscriptSegment[]): CandidateIntent {
  return { ...clipFallbackAction(lines), title: prefix(`Follow up: ${trimWhitespace(question)}`, INTENT_LIMITS.maxTitle) };
}

/**
 * The intent with the clip's lines as evidence, or `fallback` (the blank fallback unless
 * given) when there is no draft or it does not validate (Swift `ReviewViewModel.draftAction`).
 */
export function clipActionDraft(candidate: CandidateIntent | undefined, lines: readonly TranscriptSegment[], meetingID: LanaId, now: Date, fallback: CandidateIntent = clipFallbackAction(lines)): Intent | undefined {
  if (lines.length === 0) return undefined;
  return clipIntent(candidate ?? fallback, lines, meetingID, now) ?? clipIntent(fallback, lines, meetingID, now);
}
