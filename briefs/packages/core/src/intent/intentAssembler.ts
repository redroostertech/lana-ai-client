import { trimWhitespace } from "../text/whitespace.js";
import { makeLanaId, type LanaId } from "../ids/lanaId.js";
import type { CandidateIntent } from "./candidateIntent.js";
import type { EntityHint, EntityKind } from "./entityHint.js";
import { makeIntent, type Evidence, type Intent } from "./intent.js";
import type { IntentParams } from "./params.js";
import { INTENT_LIMITS, validateIntent, type ValidationIssue } from "./validator.js";
import { isCalendarDate, isValidEmail } from "./validatorRules.js";

/** The quotes an action stands on and how well they grounded (Swift `EvidenceGrounder.Outcome`). */
export interface Grounding {
  readonly evidence: readonly Evidence[];
  readonly citedCount: number;
  readonly correctedCount: number;
}

export type AssemblerFailure =
  | { readonly kind: "unsupportedType" }
  | { readonly kind: "ungrounded" }
  | { readonly kind: "invalid"; readonly issues: readonly ValidationIssue[] };

export type AssemblerResult = { readonly ok: true; readonly intent: Intent } | { readonly ok: false; readonly failure: AssemblerFailure };

/** Multiplier applied when a quote had to be re-attributed to another segment. */
export const CORRECTED_CITATION_PENALTY = 0.85;

const SUPPORTED = new Set(["note.log", "task.create", "email.draft"]);

/**
 * Turns a grounded candidate into a `lana.intent/v1` intent and runs the validator
 * (Swift `IntentAssembler`). `id` is for tests that reuse an id; otherwise a new one is made.
 */
export function assembleIntent(candidate: CandidateIntent, grounding: Grounding, meetingID: LanaId, now: Date, id?: LanaId): AssemblerResult {
  if (!SUPPORTED.has(candidate.type)) return { ok: false, failure: { kind: "unsupportedType" } };
  if (grounding.evidence.length === 0) return { ok: false, failure: { kind: "ungrounded" } };
  const intent = makeIntent({
    id: id ?? makeLanaId("intent", now),
    meetingID,
    params: params(candidate),
    confidence: assemblerConfidence(candidate, grounding),
    evidence: grounding.evidence.slice(0, INTENT_LIMITS.maxEvidence),
    createdAt: now,
  });
  const issues = validateIntent(intent);
  return issues.length === 0 ? { ok: true, intent } : { ok: false, failure: { kind: "invalid", issues } };
}

/** Model confidence clamped to 0...1, scaled by the share of quotes that grounded, reduced again when a citation was corrected. */
export function assemblerConfidence(candidate: CandidateIntent, grounding: Grounding): number {
  const base = Number.isFinite(candidate.confidence) ? Math.min(Math.max(candidate.confidence, 0), 1) : 0;
  const fraction = grounding.citedCount === 0 ? 0 : grounding.evidence.length / grounding.citedCount;
  let value = base * fraction;
  if (grounding.correctedCount > 0) value *= CORRECTED_CITATION_PENALTY;
  return Math.round(value * 1_000) / 1_000;
}

function params(candidate: CandidateIntent): IntentParams {
  const title = trimWhitespace(candidate.title);
  let body = trimWhitespace(candidate.body);
  const regarding = hint(candidate.regardingName, candidate.regardingKind ?? "matter");
  switch (candidate.type) {
    case "task.create": {
      let due = candidate.dueDate === undefined ? undefined : trimWhitespace(candidate.dueDate);
      if (due !== undefined && (due === "" || !isCalendarDate(due))) {
        if (due !== "") body = body === "" ? `Due: ${due}` : `${body}\nDue: ${due}`;
        due = undefined;
      }
      const assignee = candidate.assigneeHint === undefined ? undefined : trimWhitespace(candidate.assigneeHint);
      return { type: "task.create", task: { title, detail: body, dueDate: due, assigneeHint: assignee === "" ? undefined : assignee, regarding } };
    }
    case "email.draft": {
      const to = candidate.recipients.map(trimWhitespace).filter((value) => value !== "").map(recipient);
      return { type: "email.draft", email: { to, subject: title, body, regarding } };
    }
    case "note.log":
      return { type: "note.log", note: { subject: title, body: body === "" ? title : body, regarding } };
  }
}

function hint(name: string | undefined, kind: EntityKind): EntityHint | undefined {
  const cleaned = name === undefined ? "" : trimWhitespace(name);
  return cleaned === "" ? undefined : { kind, name: cleaned };
}

function recipient(raw: string): EntityHint {
  return isValidEmail(raw) ? { kind: "contact", name: raw, email: raw } : { kind: "contact", name: raw };
}
