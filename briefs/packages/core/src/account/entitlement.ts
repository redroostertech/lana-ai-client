import { SECRET_ACCOUNTS, type KeyVault } from "../keys/keyVault.js";
import type { AccountLog } from "./accountManager.js";
import { isAccountError, LanaAccountError } from "./lanaAccountError.js";
import type { LanaAccountSession } from "./lanaAccountSession.js";

/**
 * Whether this person may use LANA Briefs. Access comes from their LANA platform account:
 * the directory's discovery reply for their organization lists the apps turned on for it
 * (`enabled_apps`, objects with an `id`), and LANA Briefs is on when one of them is
 * `lana-notes`. The LANA control plane owns that list; this app only reads it.
 */
export const LANA_NOTES_APP_ID = "lana-notes";

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/** How long the last confirmed "on" answer keeps working while the directory cannot be reached. */
export const ENTITLEMENT_OFFLINE_GRACE_MS = 7 * DAY_MS;
/** How often a signed-in app asks again. */
export const ENTITLEMENT_RECHECK_MS = 4 * HOUR_MS;
/** Coming to the foreground asks again only when the last attempt is older than this. */
export const ENTITLEMENT_FOREGROUND_MIN_MS = 5 * MINUTE_MS;
/** A cached answer stamped a little in the future (clock drift) still counts; more does not. */
const CLOCK_SKEW_MS = 5 * MINUTE_MS;

export function isEntitled(enabledAppIDs: readonly string[]): boolean {
  return enabledAppIDs.includes(LANA_NOTES_APP_ID);
}

export type EntitlementState =
  /** Nobody is signed in. */
  | { readonly kind: "signedOut" }
  /** Signed in, first answer not in yet. */
  | { readonly kind: "checking" }
  /** On. `offline` when the answer is the cached one because the directory did not answer. */
  | { readonly kind: "entitled"; readonly checkedAt: Date; readonly offline: boolean }
  /** The organization does not have LANA Briefs turned on (or is not active at the directory). */
  | { readonly kind: "notEntitled"; readonly organizationID: string }
  /** No answer from the directory and no cached "on" inside the grace period. */
  | { readonly kind: "unreachable"; readonly organizationID: string }
  /** The session has no Organization ID (a server typed under Advanced), so discovery cannot run. */
  | { readonly kind: "noOrganization" };

export function hasAccess(state: EntitlementState): boolean {
  return state.kind === "entitled";
}

/** The last answer the directory gave, kept sealed in the KeyVault. */
export interface EntitlementRecord {
  readonly organizationID: string;
  readonly entitled: boolean;
  readonly checkedAt: Date;
}

/** What a cached answer allows when the directory cannot be reached. */
export function offlineEntitlement(record: EntitlementRecord | null, organizationID: string, now: Date, graceMs: number = ENTITLEMENT_OFFLINE_GRACE_MS): EntitlementState {
  if (record === null || record.organizationID !== organizationID) return { kind: "unreachable", organizationID };
  if (!record.entitled) return { kind: "notEntitled", organizationID };
  const age = now.getTime() - record.checkedAt.getTime();
  if (age >= -CLOCK_SKEW_MS && age <= graceMs) return { kind: "entitled", checkedAt: record.checkedAt, offline: true };
  return { kind: "unreachable", organizationID };
}

export interface EntitlementCacheStoring {
  load(): Promise<EntitlementRecord | null>;
  save(record: EntitlementRecord): Promise<void>;
  clear(): Promise<void>;
}

/** The record as one KeyVault secret (`lana.entitlement`), sealed so it cannot be edited to stretch the grace. */
export class VaultEntitlementCache implements EntitlementCacheStoring {
  constructor(private readonly vault: Pick<KeyVault, "secret" | "setSecret">) {}

  async load(): Promise<EntitlementRecord | null> {
    const data = await this.vault.secret(SECRET_ACCOUNTS.entitlement);
    return data === null ? null : decodeEntitlementRecord(data);
  }

  save(record: EntitlementRecord): Promise<void> {
    return this.vault.setSecret(SECRET_ACCOUNTS.entitlement, encodeEntitlementRecord(record));
  }

  clear(): Promise<void> {
    return this.vault.setSecret(SECRET_ACCOUNTS.entitlement, null);
  }
}

export class MemoryEntitlementCache implements EntitlementCacheStoring {
  record: EntitlementRecord | null = null;
  async load(): Promise<EntitlementRecord | null> {
    return this.record;
  }
  async save(record: EntitlementRecord): Promise<void> {
    this.record = record;
  }
  async clear(): Promise<void> {
    this.record = null;
  }
}

export function encodeEntitlementRecord(record: EntitlementRecord): Uint8Array {
  return new TextEncoder().encode(JSON.stringify({ checked_at: record.checkedAt.toISOString(), entitled: record.entitled, organization_id: record.organizationID }));
}

/** Null for anything unreadable: the app then needs a fresh answer. */
export function decodeEntitlementRecord(data: Uint8Array): EntitlementRecord | null {
  try {
    const object = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(data)) as Record<string, unknown>;
    const checkedAt = new Date(String(object["checked_at"]));
    if (typeof object["organization_id"] !== "string" || typeof object["entitled"] !== "boolean" || Number.isNaN(checkedAt.getTime())) return null;
    return { organizationID: object["organization_id"], entitled: object["entitled"], checkedAt };
  } catch {
    return null;
  }
}

export interface EntitlementMonitorOptions {
  /** Discovery for the organization: the ids of its enabled apps. Throws `LanaAccountError`. */
  readonly discover: (organizationID: string, domain: string) => Promise<{ readonly enabledAppIDs: readonly string[] }>;
  readonly cache: EntitlementCacheStoring;
  /** Every state change. */
  readonly onChange?: (state: EntitlementState) => void;
  /** The answer flipped (or was first known) for an organization. Ids only: for the audit log. */
  readonly onEntitlementChanged?: (organizationID: string, entitled: boolean) => Promise<void> | void;
  readonly now?: () => Date;
  readonly graceMs?: number;
  readonly log?: AccountLog;
}

const SILENT: AccountLog = { info() {}, notice() {} };

/**
 * Keeps the entitlement for the signed-in session: asks the directory at sign-in, at
 * launch with a restored session, every few hours and when the app comes forward; falls
 * back to the cached answer for a bounded time when the directory cannot be reached.
 */
export class EntitlementMonitor {
  private current: EntitlementState = { kind: "signedOut" };
  /** Bumped by every check and sign-out, so a late answer for an older session is dropped. */
  private generation = 0;
  private lastAttempt: Date | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly now: () => Date;
  private readonly graceMs: number;
  private readonly log: AccountLog;

  constructor(private readonly options: EntitlementMonitorOptions) {
    this.now = options.now ?? (() => new Date());
    this.graceMs = options.graceMs ?? ENTITLEMENT_OFFLINE_GRACE_MS;
    this.log = options.log ?? SILENT;
  }

  get state(): EntitlementState {
    return this.current;
  }

  get hasAccess(): boolean {
    return hasAccess(this.current);
  }

  /** Asks the directory for `session`'s organization now. */
  async check(session: LanaAccountSession | null): Promise<EntitlementState> {
    const generation = ++this.generation;
    if (session === null) {
      this.set({ kind: "signedOut" });
      return this.current;
    }
    const organizationID = session.server.organizationID?.trim().toLowerCase() ?? "";
    if (organizationID === "") {
      this.log.notice("entitlement.no_organization");
      this.set({ kind: "noOrganization" });
      return this.current;
    }
    this.lastAttempt = this.now();
    const record = await this.options.cache.load().catch(() => null);
    if (generation !== this.generation) return this.current;
    if (this.current.kind === "signedOut" || this.current.kind === "noOrganization") {
      // Launch with a cached "on": usable at once while the directory is asked.
      const cached = offlineEntitlement(record, organizationID, this.now(), this.graceMs);
      this.set(cached.kind === "entitled" ? cached : { kind: "checking" });
    }
    let next: EntitlementState;
    try {
      const found = await this.options.discover(organizationID, session.server.domain ?? "");
      if (generation !== this.generation) return this.current;
      next = await this.answered(record, organizationID, isEntitled(found.enabledAppIDs));
    } catch (error) {
      if (isAccountError(error, "organizationNotFound") || isAccountError(error, "organizationDetailsInvalid")) {
        // The directory answered: the organization is unknown or not active there.
        if (generation !== this.generation) return this.current;
        next = await this.answered(record, organizationID, false);
      } else {
        this.log.notice("entitlement.check_failed", { error: error instanceof LanaAccountError ? error.kind : "unknown" });
        next = offlineEntitlement(record, organizationID, this.now(), this.graceMs);
      }
    }
    if (generation !== this.generation) return this.current;
    this.set(next);
    return this.current;
  }

  /** Coming to the foreground: asks again when the last attempt is a few minutes old. */
  async checkIfStale(session: LanaAccountSession | null, minimumMs: number = ENTITLEMENT_FOREGROUND_MIN_MS): Promise<EntitlementState> {
    if (session === null) return this.current;
    if (this.lastAttempt !== null && this.now().getTime() - this.lastAttempt.getTime() < minimumMs) return this.current;
    return this.check(session);
  }

  /** Signed out: forgets the answer and the cache. */
  async signedOut(): Promise<void> {
    this.generation += 1;
    this.lastAttempt = null;
    this.set({ kind: "signedOut" });
    await this.options.cache.clear().catch(() => undefined);
  }

  /** Asks again every `intervalMs` while signed in. */
  startPeriodic(session: () => LanaAccountSession | null, intervalMs: number = ENTITLEMENT_RECHECK_MS): void {
    this.stopPeriodic();
    this.timer = setInterval(() => {
      const current = session();
      if (current !== null) void this.check(current);
    }, intervalMs);
    if (typeof this.timer === "object" && "unref" in this.timer) this.timer.unref();
  }

  stopPeriodic(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
  }

  // Private

  private async answered(record: EntitlementRecord | null, organizationID: string, entitled: boolean): Promise<EntitlementState> {
    const checkedAt = this.now();
    await this.options.cache.save({ organizationID, entitled, checkedAt }).catch(() => this.log.notice("entitlement.cache_failed"));
    if (record === null || record.organizationID !== organizationID || record.entitled !== entitled) {
      this.log.info("entitlement.changed", { entitled });
      try {
        await this.options.onEntitlementChanged?.(organizationID, entitled);
      } catch {
        this.log.notice("entitlement.audit_failed");
      }
    }
    return entitled ? { kind: "entitled", checkedAt, offline: false } : { kind: "notEntitled", organizationID };
  }

  private set(next: EntitlementState): void {
    if (sameState(this.current, next)) return;
    const was = this.current.kind;
    this.current = next;
    if (was !== next.kind) this.log.info("entitlement.state", { state: next.kind });
    try {
      this.options.onChange?.(next);
    } catch {
      // Listeners forward to the UI; their failures are theirs.
    }
  }
}

function sameState(a: EntitlementState, b: EntitlementState): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === "entitled" && b.kind === "entitled") return a.offline === b.offline && a.checkedAt.getTime() === b.checkedAt.getTime();
  return JSON.stringify(a) === JSON.stringify(b);
}
