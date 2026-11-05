import type { IntentParams } from "../intent/params.js";
import type { IntentStatus } from "../intent/intentStatus.js";
import { isCalendarDate } from "../intent/validatorRules.js";
import type { ActionKind } from "./actionList.js";

/** The fields a person edits on an action page. */
export interface ActionFieldValues {
  readonly title: string;
  readonly body: string;
  /** `YYYY-MM-DD`, tasks only. */
  readonly dueDate: string | null;
}

export const MAX_TITLE_LENGTH = 300;
export const MAX_BODY_LENGTH = 20_000;

/** Statuses on which the person may still edit (store `EDITABLE_STATUSES`). */
const EDITABLE: ReadonlySet<IntentStatus> = new Set(["transferred", "resolved", "failed"]);

export function typeTitleOf(kind: ActionKind): string {
  return { note: "Log a note", task: "Create a task", email: "Draft an email", unsupported: "Needs a newer LANA" }[kind];
}

export function titleLabelOf(kind: ActionKind): string {
  return kind === "task" ? "Task" : "Subject";
}

export function bodyLabelOf(kind: ActionKind): string {
  return kind === "task" ? "Details" : kind === "email" ? "Message" : "Note";
}

/** "From Weekly case review", "From a meeting" when the title is unknown, or "Added by you". */
export function originLabelOf(origin: "meeting" | "manual", meetingTitle: string | null): string {
  if (origin === "manual") return "Added by you";
  return meetingTitle === null || meetingTitle.trim() === "" ? "From a meeting" : `From ${meetingTitle}`;
}

/** Why the fields cannot be saved, in plain words, or null. */
export function fieldsProblem(kind: ActionKind, fields: ActionFieldValues): string | null {
  if (kind === "unsupported") return "This action can no longer be edited.";
  const title = fields.title.trim();
  if (title === "") return `Add a ${titleLabelOf(kind).toLowerCase()}.`;
  if ([...title].length > MAX_TITLE_LENGTH) return `Keep the ${titleLabelOf(kind).toLowerCase()} under ${MAX_TITLE_LENGTH} characters.`;
  if ([...fields.body].length > MAX_BODY_LENGTH) return `Keep the ${bodyLabelOf(kind).toLowerCase()} under ${MAX_BODY_LENGTH.toLocaleString("en-US")} characters.`;
  if (kind === "task" && fields.dueDate !== null && !isCalendarDate(fields.dueDate)) return "Choose a real due date.";
  return null;
}

/**
 * New params from the edited fields. For a meeting action the previous params keep what
 * the page does not edit (what the meeting called the matter, the assignee, recipients).
 */
export function paramsFromFields(kind: "task" | "note" | "email", fields: ActionFieldValues, previous: IntentParams | null): IntentParams {
  const title = fields.title.trim();
  const body = fields.body.trim();
  switch (kind) {
    case "task": {
      const before = previous?.type === "task.create" ? previous.task : undefined;
      return { type: "task.create", task: { ...before, title, detail: body, dueDate: fields.dueDate ?? undefined } };
    }
    case "note": {
      const before = previous?.type === "note.log" ? previous.note : undefined;
      return { type: "note.log", note: { ...before, subject: title, body } };
    }
    case "email": {
      const before = previous?.type === "email.draft" ? previous.email : undefined;
      return { type: "email.draft", email: { to: before?.to ?? [], regarding: before?.regarding, subject: title, body } };
    }
  }
}

export interface ActionPermissions {
  readonly isEditable: boolean;
  readonly canDelete: boolean;
  readonly canRestore: boolean;
  /** Shown with Delete when the action already ran in LANA. */
  readonly deleteNote: string | null;
}

/**
 * What the page may do apart from running. A deleted action is read only until restored.
 * A running action (confirmed, not finished) cannot be deleted. Deleting one that ran
 * keeps the LANA record, and the page says so.
 */
export function actionPermissions(input: { readonly kind: ActionKind; readonly status: IntentStatus; readonly deleted: boolean }): ActionPermissions {
  const { kind, status, deleted } = input;
  const ran = status === "executed";
  const what = kind === "task" ? "task" : kind === "note" ? "note" : "item";
  return {
    isEditable: !deleted && kind !== "unsupported" && EDITABLE.has(status),
    canDelete: !deleted && status !== "confirmed",
    canRestore: deleted,
    deleteNote: ran ? `This action already ran. Deleting it here does not remove the ${what} from LANA.` : null,
  };
}

/** The Run button's words: "Create task on 00042 Acme Logistics", "Add note to ...", "Save draft". */
export function runTitleOf(kind: ActionKind, matterLabel: string | null): string {
  switch (kind) {
    case "task":
      return matterLabel === null ? "Create task" : `Create task on ${matterLabel}`;
    case "note":
      return matterLabel === null ? "Add note" : `Add note to ${matterLabel}`;
    case "email":
      return "Save draft";
    case "unsupported":
      return "Not available";
  }
}

/** Why Run waits for a matter, or null when the type needs none or has one. */
export function matterBlockReason(kind: ActionKind, hasMatter: boolean): string | null {
  if (hasMatter || (kind !== "task" && kind !== "note")) return null;
  return kind === "task" ? "Choose the matter for this task." : "Choose the matter for this note.";
}
