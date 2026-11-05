/**
 * Structured log sink for the handoff layer. Fields carry ids, counts, codes and
 * states only: never transcript text, names, tokens, codes shown to people, or keys.
 */
export interface HandoffLog {
  info(event: string, fields?: Readonly<Record<string, string | number | boolean>>): void;
  notice(event: string, fields?: Readonly<Record<string, string | number | boolean>>): void;
  error(event: string, fields?: Readonly<Record<string, string | number | boolean>>): void;
}

export const SILENT_LOG: HandoffLog = { info() {}, notice() {}, error() {} };
