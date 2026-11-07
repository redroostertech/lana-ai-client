import { appendFileSync, mkdirSync, renameSync, statSync } from "node:fs";
import { join } from "node:path";

export type LogFields = Readonly<Record<string, string | number | boolean>>;

/** Ids, counts, codes and states only. Never transcript text, names, emails, tokens, passwords or keys. */
export interface MainLog {
  info(event: string, fields?: LogFields): void;
  notice(event: string, fields?: LogFields): void;
  error(event: string, fields?: LogFields): void;
  /** Where the file is, for the instructions and the startup error screen. */
  readonly path: string | null;
}

const MAX_BYTES = 5 * 1024 * 1024;

/**
 * One JSON line per event to `<directory>/lana-main.log` (rotated once at 5 MB) and to
 * stdout, so `npm run dev` shows it too.
 */
export function createMainLog(directory: string | null): MainLog {
  let path: string | null = null;
  if (directory !== null) {
    try {
      mkdirSync(directory, { recursive: true, mode: 0o700 });
      path = join(directory, "lana-main.log");
      if ((statSync(path, { throwIfNoEntry: false })?.size ?? 0) > MAX_BYTES) renameSync(path, `${path}.1`);
    } catch {
      path = null;
    }
  }
  const write = (level: string, event: string, fields?: LogFields): void => {
    const line = JSON.stringify({ at: new Date().toISOString(), level, event, ...(fields ?? {}) });
    console.log(`[lana] ${line}`);
    if (path === null) return;
    try {
      appendFileSync(path, `${line}\n`, { mode: 0o600 });
    } catch {
      // Logging never breaks the app.
    }
  };
  return {
    info: (event, fields) => write("info", event, fields),
    notice: (event, fields) => write("notice", event, fields),
    error: (event, fields) => write("error", event, fields),
    path,
  };
}
