import type { EntityKind } from "./entityHint.js";

/** The supported action types a draft can name (Swift `IntentType.supported`). */
export type CandidateIntentType = "note.log" | "task.create" | "email.draft";

/** A proposed action exactly as the model wrote it, before it is grounded and validated (Swift `CandidateIntent`). */
export interface CandidateIntent {
  readonly type: CandidateIntentType;
  readonly title: string;
  readonly body: string;
  /** `YYYY-MM-DD` when stated; anything else is moved into the body. */
  readonly dueDate?: string | undefined;
  readonly assigneeHint?: string | undefined;
  /** Email recipients by name or address (email.draft only). */
  readonly recipients: readonly string[];
  readonly regardingName?: string | undefined;
  readonly regardingKind?: EntityKind | undefined;
  readonly confidence: number;
}
