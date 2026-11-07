import type { JsonObject, JsonValue } from "../json/jsonValue.js";
import { arrayOf, asObject, asString, field, optional } from "../json/read.js";
import { decodeEntityHint, encodeEntityHint, type EntityHint } from "./entityHint.js";

export interface NoteParams {
  readonly subject: string;
  readonly body: string;
  readonly regarding?: EntityHint | undefined;
}

export interface TaskParams {
  readonly title: string;
  readonly detail: string;
  /** Calendar date `YYYY-MM-DD`. */
  readonly dueDate?: string | undefined;
  readonly assigneeHint?: string | undefined;
  readonly regarding?: EntityHint | undefined;
}

export interface EmailParams {
  readonly to: readonly EntityHint[];
  readonly subject: string;
  readonly body: string;
  readonly regarding?: EntityHint | undefined;
}

export const SUPPORTED_INTENT_TYPES = ["note.log", "task.create", "email.draft"] as const;

/** Parameters by intent type. Types from a newer phone build are kept as raw JSON, never executed. */
export type IntentParams =
  | { readonly type: "note.log"; readonly note: NoteParams }
  | { readonly type: "task.create"; readonly task: TaskParams }
  | { readonly type: "email.draft"; readonly email: EmailParams }
  | { readonly type: "unsupported"; readonly rawType: string; readonly raw: JsonValue };

/** The wire `type` string. */
export function intentType(params: IntentParams): string {
  return params.type === "unsupported" ? params.rawType : params.type;
}

export function regardingOf(params: IntentParams): EntityHint | undefined {
  switch (params.type) {
    case "note.log":
      return params.note.regarding;
    case "task.create":
      return params.task.regarding;
    case "email.draft":
      return params.email.regarding;
    case "unsupported":
      return undefined;
  }
}

/** Short human title for action cards and idempotency keys. */
export function titleOf(params: IntentParams): string {
  switch (params.type) {
    case "note.log":
      return params.note.subject;
    case "task.create":
      return params.task.title;
    case "email.draft":
      return params.email.subject;
    case "unsupported":
      return params.rawType;
  }
}

/** The body text (note text, task detail, email body). Empty for a type this version cannot read. */
export function bodyOf(params: IntentParams): string {
  switch (params.type) {
    case "note.log":
      return params.note.body;
    case "task.create":
      return params.task.detail;
    case "email.draft":
      return params.email.body;
    case "unsupported":
      return "";
  }
}

/**
 * The title people see. Same as `titleOf` for supported types. A type from a newer phone
 * build shows its own title when it carries one, otherwise a plain label for its type
 * ("Calendar event"), never the dotted wire key.
 */
export function displayTitleOf(params: IntentParams): string {
  if (params.type !== "unsupported") return titleOf(params);
  const raw = params.raw;
  if (raw !== null && typeof raw === "object" && !Array.isArray(raw)) {
    for (const key of ["title", "subject", "name"]) {
      const value = (raw as JsonObject)[key];
      if (typeof value === "string" && value.trim() !== "") return value.trim();
    }
  }
  return unsupportedTypeLabel(params.rawType);
}

/** "calendar.event.create" reads "Calendar event": the last part (the verb) goes, the rest become words. */
export function unsupportedTypeLabel(rawType: string): string {
  const parts = rawType.split(".").filter((part) => part.trim() !== "");
  const words = (parts.length > 1 ? parts.slice(0, -1) : parts)
    .join(" ")
    .replace(/(\p{Ll})(\p{Lu})/gu, "$1 $2")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .toLocaleLowerCase("en");
  return words === "" ? "Newer action" : words.charAt(0).toLocaleUpperCase("en") + words.slice(1);
}

const hint = (value: EntityHint | undefined): JsonObject | undefined => (value === undefined ? undefined : encodeEntityHint(value));

export function encodeParams(params: IntentParams): JsonValue {
  switch (params.type) {
    case "note.log":
      return { subject: params.note.subject, body: params.note.body, regarding: hint(params.note.regarding) };
    case "task.create":
      return {
        title: params.task.title,
        detail: params.task.detail,
        due_date: params.task.dueDate,
        assignee_hint: params.task.assigneeHint,
        regarding: hint(params.task.regarding),
      };
    case "email.draft":
      return {
        to: params.email.to.map(encodeEntityHint),
        subject: params.email.subject,
        body: params.email.body,
        regarding: hint(params.email.regarding),
      };
    case "unsupported":
      return params.raw;
  }
}

export function decodeParams(type: string, value: JsonValue, path: string): IntentParams {
  switch (type) {
    case "note.log": {
      const object = asObject(value, path);
      return {
        type,
        note: {
          subject: field(object, "subject", path, asString),
          body: field(object, "body", path, asString),
          regarding: optional(object, "regarding", path, decodeEntityHint),
        },
      };
    }
    case "task.create": {
      const object = asObject(value, path);
      return {
        type,
        task: {
          title: field(object, "title", path, asString),
          detail: field(object, "detail", path, asString),
          dueDate: optional(object, "due_date", path, asString),
          assigneeHint: optional(object, "assignee_hint", path, asString),
          regarding: optional(object, "regarding", path, decodeEntityHint),
        },
      };
    }
    case "email.draft": {
      const object = asObject(value, path);
      return {
        type,
        email: {
          to: field(object, "to", path, arrayOf(decodeEntityHint)),
          subject: field(object, "subject", path, asString),
          body: field(object, "body", path, asString),
          regarding: optional(object, "regarding", path, decodeEntityHint),
        },
      };
    }
    default:
      return { type: "unsupported", rawType: type, raw: value };
  }
}
