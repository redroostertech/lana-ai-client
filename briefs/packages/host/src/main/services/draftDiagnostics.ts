import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import type { ClipDraftAttempt } from "@lana/core/runtime";

/** Set to 1 before launching the app to record every clip draft attempt. Off by default. */
export const DRAFT_DIAGNOSTICS_ENV = "LANA_DRAFT_DIAGNOSTICS";
export const DRAFT_DIAGNOSTICS_FILE = "draft-diagnostics.jsonl";

/** How one background draft settled. Ids, sizes and states only. */
export interface DraftOutcome {
  readonly draft: string;
  readonly kind: string;
  /** The model wrote a line the parser read. */
  readonly parsed: boolean;
  /** The parsed draft became the action (false: the starting point was used). */
  readonly drafted: boolean;
  /** Why a parsed draft was refused: validator field names only. */
  readonly issues: readonly string[];
  readonly ms: number;
}

export interface DraftDiagnosticsSink {
  attempt(attempt: ClipDraftAttempt): void;
  outcome(outcome: DraftOutcome): void;
}

/**
 * The opt-in drafting diagnostic: one JSON line per model call and per settled draft, in
 * `draft-diagnostics.jsonl` next to the main log. It records reply length, line and field
 * counts, the label found, which rule failed, the attempt and the timing. It never records
 * the prompt, the reply, the question or any transcript text.
 */
export class DraftDiagnostics implements DraftDiagnosticsSink {
  constructor(readonly path: string, private readonly now: () => Date = () => new Date()) {}

  /** Null unless the environment turns it on and there is a log folder. */
  static fromEnvironment(env: Readonly<Record<string, string | undefined>>, mainLogPath: string | null): DraftDiagnostics | null {
    if (env[DRAFT_DIAGNOSTICS_ENV] !== "1" || mainLogPath === null) return null;
    return new DraftDiagnostics(join(dirname(mainLogPath), DRAFT_DIAGNOSTICS_FILE));
  }

  attempt(attempt: ClipDraftAttempt): void {
    this.write({ event: "draft.attempt", ...attempt });
  }

  outcome(outcome: DraftOutcome): void {
    this.write({ event: "draft.outcome", ...outcome, issues: outcome.issues.join(",") });
  }

  private write(fields: Record<string, string | number | boolean | null | readonly string[]>): void {
    try {
      mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 });
      appendFileSync(this.path, `${JSON.stringify({ at: this.now().toISOString(), ...fields })}\n`, { mode: 0o600 });
    } catch {
      // A diagnostic never breaks drafting.
    }
  }
}
