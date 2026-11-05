import { trimWhitespace } from "../text/whitespace.js";
import type { EntityHint } from "./entityHint.js";
import { makeIntent, type Intent } from "./intent.js";
import type { IntentParams } from "./params.js";

/**
 * The text fields a person may change on a proposed action before it is kept (Swift
 * `ActionEdit`). Type, evidence and confidence come from the meeting and are never edited.
 */
export interface ActionEdit {
  readonly title: string;
  readonly body: string;
  readonly regarding: string;
  /** `YYYY-MM-DD` for tasks; ignored for other types. */
  readonly dueDate: string;
}

/** The current values of `intent`. */
export function actionEditOf(intent: Intent): ActionEdit {
  const params = intent.params;
  switch (params.type) {
    case "note.log":
      return { title: params.note.subject, body: params.note.body, regarding: params.note.regarding?.name ?? "", dueDate: "" };
    case "task.create":
      return { title: params.task.title, body: params.task.detail, regarding: params.task.regarding?.name ?? "", dueDate: params.task.dueDate ?? "" };
    case "email.draft":
      return { title: params.email.subject, body: params.email.body, regarding: params.email.regarding?.name ?? "", dueDate: "" };
    case "unsupported":
      return { title: params.rawType, body: "", regarding: "", dueDate: "" };
  }
}

/**
 * A new intent with these values. The id, meeting, evidence and confidence are kept; the
 * idempotency key is recomputed because it covers the params. The regarding hint keeps its
 * kind and email; an empty name removes it, which tells the desktop to ask.
 */
export function applyActionEdit(edit: ActionEdit, intent: Intent): Intent {
  const hint = (original: EntityHint | undefined): EntityHint | undefined => {
    const name = trimWhitespace(edit.regarding);
    return name === "" ? undefined : { kind: original?.kind ?? "matter", name, email: original?.email };
  };
  const params = intent.params;
  let next: IntentParams;
  switch (params.type) {
    case "note.log":
      next = { type: "note.log", note: { subject: trimWhitespace(edit.title), body: trimWhitespace(edit.body), regarding: hint(params.note.regarding) } };
      break;
    case "task.create": {
      const due = trimWhitespace(edit.dueDate);
      next = { type: "task.create", task: { ...params.task, title: trimWhitespace(edit.title), detail: trimWhitespace(edit.body), dueDate: due === "" ? undefined : due, regarding: hint(params.task.regarding) } };
      break;
    }
    case "email.draft":
      next = { type: "email.draft", email: { ...params.email, subject: trimWhitespace(edit.title), body: trimWhitespace(edit.body), regarding: hint(params.email.regarding) } };
      break;
    case "unsupported":
      return intent;
  }
  return makeIntent({ id: intent.id, meetingID: intent.meetingID, params: next, confidence: intent.confidence, evidence: intent.evidence, createdAt: intent.createdAt, status: intent.status });
}
