import type { AccountSessionStoring } from "./accountSessionStore.js";
import { isAccountError, LanaAccountError } from "./lanaAccountError.js";
import type { LanaAccountService } from "./lanaAccountService.js";
import type { LanaAccountSession } from "./lanaAccountSession.js";
import type { LanaServer } from "./lanaServer.js";

export type SignedOutReason =
  /** Nobody has signed in on this computer (or the last session was cleared). */
  | "notSignedIn"
  /** The person chose Sign out. */
  | "signedOut"
  /** LANA ended the session or it ran out. */
  | "expired";

export type AccountManagerState =
  /** Reading the vault at launch. */
  | { readonly kind: "restoring" }
  | { readonly kind: "signedOut"; readonly reason: SignedOutReason }
  | { readonly kind: "signedIn"; readonly session: LanaAccountSession };

/** Ids and states only (`ACCOUNT_LOG_EVENTS`), never tokens, emails or names. */
export interface AccountLog {
  info(event: string, fields?: Readonly<Record<string, string | number | boolean>>): void;
  notice(event: string, fields?: Readonly<Record<string, string | number | boolean>>): void;
}

/** Sleeps `ms`, rejecting when `signal` aborts. Injected so tests control time. */
export type Sleeper = (ms: number, signal: AbortSignal) => Promise<void>;

export const realSleeper: Sleeper = (ms, signal) =>
  new Promise<void>((resolve, reject) => {
    if (signal.aborted) return reject(new Error("aborted"));
    const timer = setTimeout(resolve, Math.min(ms, MAX_TIMER_MS));
    signal.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(new Error("aborted"));
    }, { once: true });
  });

export interface AccountManagerOptions {
  readonly service: LanaAccountService;
  readonly sessions: AccountSessionStoring;
  readonly now?: () => Date;
  readonly sleep?: Sleeper;
  /** Refresh this long before expiry. Default ten minutes. */
  readonly refreshMarginMs?: number;
  /** Wait after a failed refresh before trying again. Default one minute. */
  readonly retryDelayMs?: number;
  readonly log?: AccountLog;
}

const MAX_TIMER_MS = 2_147_483_647;
const SILENT: AccountLog = { info() {}, notice() {} };

/**
 * The one LANA session on this computer (Swift `AccountManager`): restored from the vault
 * at launch, refreshed before it expires, and ended on sign-out or when LANA refuses it.
 * Everything that receives meetings or runs actions asks this gate first.
 */
export class AccountManager {
  private current: AccountManagerState = { kind: "restoring" };
  /** The server of the last session, kept in memory so signing back in skips the organization step. */
  private last: LanaServer | null = null;
  private readonly observers = new Set<(signedIn: boolean) => void>();
  private readonly stateListeners = new Set<(state: AccountManagerState) => void>();
  private refreshLoop: AbortController | null = null;
  private readonly service: LanaAccountService;
  private readonly sessions: AccountSessionStoring;
  private readonly now: () => Date;
  private readonly sleep: Sleeper;
  private readonly refreshMarginMs: number;
  private readonly retryDelayMs: number;
  private readonly log: AccountLog;

  constructor(options: AccountManagerOptions) {
    this.service = options.service;
    this.sessions = options.sessions;
    this.now = options.now ?? (() => new Date());
    this.sleep = options.sleep ?? realSleeper;
    this.refreshMarginMs = options.refreshMarginMs ?? 10 * 60 * 1_000;
    this.retryDelayMs = options.retryDelayMs ?? 60 * 1_000;
    this.log = options.log ?? SILENT;
  }

  // Public

  get state(): AccountManagerState {
    return this.current;
  }

  get isSignedIn(): boolean {
    return this.current.kind === "signedIn";
  }

  get session(): LanaAccountSession | null {
    return this.current.kind === "signedIn" ? this.current.session : null;
  }

  get lastServer(): LanaServer | null {
    return this.last;
  }

  /** Called with the new signed-in flag whenever it changes. Returns the unsubscribe function. */
  addObserver(observer: (signedIn: boolean) => void): () => void {
    this.observers.add(observer);
    return () => this.observers.delete(observer);
  }

  /** Called on every state change (sign in, sign out, expiry, token refresh). */
  onState(listener: (state: AccountManagerState) => void): () => void {
    this.stateListeners.add(listener);
    return () => this.stateListeners.delete(listener);
  }

  /** Launch: the stored session if it is still valid, refreshed when close to expiry. */
  async restore(): Promise<void> {
    if (this.current.kind !== "restoring") return;
    let stored: LanaAccountSession | null;
    try {
      stored = await this.sessions.load();
    } catch (error) {
      this.log.notice("account.restore_failed", { error: errorName(error) });
      stored = null;
    }
    if (stored === null) return this.set({ kind: "signedOut", reason: "notSignedIn" });
    this.last = stored.server;
    if (stored.expiresAt.getTime() <= this.now().getTime()) {
      await this.sessions.clear().catch(() => undefined);
      return this.set({ kind: "signedOut", reason: "expired" });
    }
    this.set({ kind: "signedIn", session: stored });
    this.log.info("account.restored", { user: stored.user.id });
    if (this.needsRefresh(stored)) await this.refreshNow();
    if (this.isSignedIn) this.startRefreshing();
  }

  /** A successful sign-in: saved to the vault first, then the gateway opens. */
  async didSignIn(session: LanaAccountSession): Promise<void> {
    await this.sessions.save(session);
    this.last = session.server;
    this.set({ kind: "signedIn", session });
    this.log.info("account.signed_in", { user: session.user.id });
    this.startRefreshing();
  }

  /**
   * Closes the gateway at once, clears the vault, then ends the session on LANA (best
   * effort: an unreachable server still leaves this computer signed out).
   */
  async signOut(): Promise<void> {
    const session = this.session;
    if (session === null) return;
    this.stopRefreshing();
    this.set({ kind: "signedOut", reason: "signedOut" });
    await this.sessions.clear().catch(() => undefined);
    try {
      await this.service.signOut(session);
    } catch (error) {
      this.log.notice("account.logout_unconfirmed", { error: errorName(error) });
    }
    this.log.info("account.signed_out");
  }

  /**
   * Swaps in a fresh token. LANA refusing it ends the session; a network failure keeps
   * the current one until it actually runs out.
   */
  async refreshNow(): Promise<boolean> {
    const current = this.session;
    if (current === null) return false;
    try {
      const fresh = await this.service.refresh(current);
      // A sign-out while the request was in flight wins.
      if (this.session?.token !== current.token) return false;
      await this.sessions.save(fresh).catch(() => undefined);
      this.set({ kind: "signedIn", session: fresh });
      this.log.info("account.refreshed");
      return true;
    } catch (error) {
      if (isAccountError(error, "sessionExpired")) {
        await this.expire();
        return false;
      }
      this.log.notice("account.refresh_failed", { error: errorName(error) });
      if (current.expiresAt.getTime() <= this.now().getTime()) await this.expire();
      return false;
    }
  }

  /**
   * Runs a LANA call with the current token. When it throws `sessionExpired` (a 401),
   * refreshes once and retries; a second 401 signs out.
   */
  async authorized<T>(operation: (token: string) => Promise<T>): Promise<T> {
    const current = this.session;
    if (current === null) throw new LanaAccountError("sessionExpired");
    try {
      return await operation(current.token);
    } catch (error) {
      if (!isAccountError(error, "sessionExpired")) throw error;
      const refreshed = await this.refreshNow();
      const fresh = this.session;
      if (!refreshed || fresh === null) throw new LanaAccountError("sessionExpired");
      try {
        return await operation(fresh.token);
      } catch (retryError) {
        if (isAccountError(retryError, "sessionExpired")) await this.expire();
        throw retryError;
      }
    }
  }

  /** Stops the refresh loop (app quit). */
  dispose(): void {
    this.stopRefreshing();
  }

  // Private

  private async expire(): Promise<void> {
    if (!this.isSignedIn) return;
    this.stopRefreshing();
    this.set({ kind: "signedOut", reason: "expired" });
    await this.sessions.clear().catch(() => undefined);
    this.log.info("account.expired");
  }

  private needsRefresh(session: LanaAccountSession): boolean {
    return session.expiresAt.getTime() - this.now().getTime() <= this.refreshMarginMs;
  }

  private set(next: AccountManagerState): void {
    const wasSignedIn = this.isSignedIn;
    this.current = next;
    for (const listener of [...this.stateListeners]) safely(() => listener(next));
    if (wasSignedIn === this.isSignedIn) return;
    const signedIn = this.isSignedIn;
    for (const observer of [...this.observers]) safely(() => observer(signedIn));
  }

  /** Sleeps until `refreshMargin` before expiry, refreshes, repeats. */
  private startRefreshing(): void {
    this.stopRefreshing();
    const loop = new AbortController();
    this.refreshLoop = loop;
    void (async () => {
      while (!loop.signal.aborted) {
        const session = this.session;
        if (session === null) return;
        const wait = Math.max(session.expiresAt.getTime() - this.now().getTime() - this.refreshMarginMs, this.retryDelayMs);
        try {
          await this.sleep(wait, loop.signal);
        } catch {
          return;
        }
        if (loop.signal.aborted) return;
        await this.refreshNow();
      }
    })();
  }

  private stopRefreshing(): void {
    this.refreshLoop?.abort();
    this.refreshLoop = null;
  }
}

function safely(action: () => void): void {
  try {
    action();
  } catch {
    // Listeners are UI forwarding; their failures are theirs.
  }
}

function errorName(error: unknown): string {
  if (error instanceof LanaAccountError) return error.kind;
  return error instanceof Error ? error.name : "unknown";
}
