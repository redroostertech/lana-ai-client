import { lanaIdKind } from "../ids/lanaId.js";
import { graphemeCount } from "../text/graphemes.js";
import { isBlank } from "../text/whitespace.js";
import type { EntityHint } from "./entityHint.js";
import { makeIdempotencyKey } from "./idempotencyKey.js";
import type { Intent } from "./intent.js";
import { isCalendarDate, isValidEmail } from "./validatorRules.js";

export const INTENT_LIMITS = {
  maxTitle: 200,
  maxBody: 20_000,
  maxQuote: 600,
  maxEvidence: 8,
  maxRecipients: 20,
} as const;

export interface ValidationIssue {
  readonly field: string;
  readonly message: string;
}

/** `field: message`, the same text as Swift's `Issue.description`. */
export function describeIssue(issue: ValidationIssue): string {
  return `${issue.field}: ${issue.message}`;
}

/**
 * Structural checks the gateway runs on every received intent before storing it.
 * Same rules, order and messages as Swift `IntentValidator.validate`; lengths are
 * counted in grapheme clusters like Swift `String.count`.
 */
export function validateIntent(intent: Intent): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const fail = (field: string, message: string): void => {
    issues.push({ field, message });
  };
  const L = INTENT_LIMITS;

  if (lanaIdKind(intent.id) !== "intent") fail("id", "must be an int_ identifier");
  if (lanaIdKind(intent.meetingID) !== "meeting") fail("meeting_id", "must be an mtg_ identifier");
  if (!(intent.confidence >= 0 && intent.confidence <= 1)) fail("confidence", "must be between 0 and 1");
  if (intent.evidence.length === 0) fail("evidence", "at least one quote is required");
  if (intent.evidence.length > L.maxEvidence) fail("evidence", `at most ${L.maxEvidence} quotes`);
  intent.evidence.forEach((item, index) => {
    if (isBlank(item.quote)) fail(`evidence[${index}].quote`, "must not be empty");
    if (graphemeCount(item.quote) > L.maxQuote) fail(`evidence[${index}].quote`, "too long");
    if (item.tStart < 0 || item.tEnd < item.tStart || !Number.isFinite(item.tStart) || !Number.isFinite(item.tEnd)) {
      fail(`evidence[${index}]`, "invalid time range");
    }
    if (item.speaker.length === 0) fail(`evidence[${index}].speaker`, "must not be empty");
  });
  if (intent.idempotencyKey !== makeIdempotencyKey(intent.meetingID, intent.params)) {
    fail("idempotency_key", "does not match params");
  }

  const params = intent.params;
  switch (params.type) {
    case "note.log":
      checkText("params.subject", params.note.subject, L.maxTitle, fail);
      checkText("params.body", params.note.body, L.maxBody, fail);
      checkHint("params.regarding", params.note.regarding, fail);
      break;
    case "task.create":
      checkText("params.title", params.task.title, L.maxTitle, fail);
      if (graphemeCount(params.task.detail) > L.maxBody) fail("params.detail", "too long");
      if (params.task.dueDate !== undefined && !isCalendarDate(params.task.dueDate)) fail("params.due_date", "must be YYYY-MM-DD");
      checkHint("params.regarding", params.task.regarding, fail);
      break;
    case "email.draft":
      checkText("params.subject", params.email.subject, L.maxTitle, fail);
      checkText("params.body", params.email.body, L.maxBody, fail);
      if (params.email.to.length === 0) fail("params.to", "at least one recipient");
      if (params.email.to.length > L.maxRecipients) fail("params.to", "too many recipients");
      params.email.to.forEach((hint, index) => checkHint(`params.to[${index}]`, hint, fail));
      checkHint("params.regarding", params.email.regarding, fail);
      break;
    case "unsupported":
      break;
  }
  return issues;
}

type Fail = (field: string, message: string) => void;

function checkText(field: string, value: string, max: number, fail: Fail): void {
  if (isBlank(value)) fail(field, "must not be empty");
  if (graphemeCount(value) > max) fail(field, "too long");
}

function checkHint(field: string, hint: EntityHint | undefined, fail: Fail): void {
  if (hint === undefined) return;
  if (isBlank(hint.name) && hint.email === undefined) fail(field, "needs a name or email");
  if (graphemeCount(hint.name) > INTENT_LIMITS.maxTitle) fail(`${field}.name`, "too long");
  if (hint.email !== undefined && !isValidEmail(hint.email)) fail(`${field}.email`, "invalid address");
}
