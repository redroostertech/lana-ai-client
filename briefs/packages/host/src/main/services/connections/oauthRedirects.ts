import type { ConnectorID } from "../../../shared/api.js";
import { OAUTH_CALLBACK_SCHEME } from "../appConfiguration.js";
import { ConnectorError } from "./connectorService.js";

/** How long a sign-in in the browser may take before the card gives up. */
export const AUTHORIZE_TIMEOUT_MS = 10 * 60_000;

interface Pending {
  readonly resolve: (url: string) => void;
  readonly reject: (error: Error) => void;
  readonly timer: NodeJS.Timeout;
}

/**
 * Routes `lananotes-auth://oauth/<connector>?...` redirects (from `open-url` on a Mac and
 * the second instance's arguments on Windows) to the sign-in that is waiting for them.
 * One pending sign-in per connector; a new one replaces the old. Redirects nobody waits
 * for are dropped. URLs carry codes: never logged.
 */
export class OAuthRedirects {
  private readonly pending = new Map<ConnectorID, Pending>();

  constructor(private readonly timeoutMs = AUTHORIZE_TIMEOUT_MS) {}

  /** Resolves with the full redirect URL for `id`. */
  waitFor(id: ConnectorID): Promise<string> {
    this.cancel(id);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new ConnectorError("cancelled", "Sign-in did not finish. Try again."));
      }, this.timeoutMs);
      timer.unref?.();
      this.pending.set(id, { resolve, reject, timer });
    });
  }

  /** Delivers a redirect. True when it matched a waiting sign-in. */
  deliver(url: string): boolean {
    const id = connectorOf(url);
    if (id === null) return false;
    const waiting = this.pending.get(id);
    if (waiting === undefined) return false;
    clearTimeout(waiting.timer);
    this.pending.delete(id);
    waiting.resolve(url);
    return true;
  }

  cancel(id: ConnectorID): void {
    const waiting = this.pending.get(id);
    if (waiting === undefined) return;
    clearTimeout(waiting.timer);
    this.pending.delete(id);
    waiting.reject(new ConnectorError("cancelled", "Sign-in did not finish. Try again."));
  }

  cancelAll(): void {
    for (const id of [...this.pending.keys()]) this.cancel(id);
  }
}

/** The connector a redirect is for, or null for anything that is not ours. */
export function connectorOf(url: string): ConnectorID | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== `${OAUTH_CALLBACK_SCHEME}:` || parsed.host !== "oauth") return null;
  const path = parsed.pathname.replace(/^\/+|\/+$/g, "");
  return path === "clio" || path === "microsoft" ? path : null;
}

/** The redirect among process arguments (Windows starts a second instance with it). */
export function redirectInArgs(args: readonly string[]): string | null {
  return args.find((arg) => arg.startsWith(`${OAUTH_CALLBACK_SCHEME}://`)) ?? null;
}
