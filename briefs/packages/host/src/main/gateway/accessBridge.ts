import type { AccountManager, EntitlementMonitor, EntitlementState } from "@lana/core/account";
import type { AccessApi, AccessState } from "../../shared/api.js";
import { organizationText } from "../../shared/organization.js";

/** Why receiving, pairing, Ask, Talk and actions refuse while LANA Briefs is off. */
export const NOT_ENTITLED_MESSAGE = "LANA Briefs is not turned on for your firm. Ask your firm admin to enable it in LANA.";

/** The monitor's state in the bridge's shape. Names are for the screen only, never logged. */
export function toAccessState(state: EntitlementState, organizationName: string): AccessState {
  switch (state.kind) {
    case "signedOut":
    case "checking":
    case "noOrganization":
      return { kind: state.kind };
    case "entitled":
      return { kind: "entitled", offline: state.offline };
    case "notEntitled":
    case "unreachable":
      return { kind: state.kind, organizationName };
  }
}

/**
 * Whether this person may use LANA Briefs (the organization's `enabled_apps` at LANA
 * discovery). `isOpen` is the one gate for receiving, Ask, Talk and actions: signed in and
 * entitled. Listeners hear when it opens or closes.
 */
export class AccessBridge implements AccessApi {
  private readonly listeners = new Set<(open: boolean) => void>();
  private open = false;

  constructor(private readonly manager: AccountManager, private readonly monitor: EntitlementMonitor) {}

  get isOpen(): boolean {
    return this.manager.isSignedIn && this.monitor.hasAccess;
  }

  /** Called with the new value whenever `isOpen` flips. Returns the unsubscribe function. */
  onChange(listener: (open: boolean) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Re-reads the gate; the runtime calls it on every account and entitlement change. */
  update(): void {
    const open = this.isOpen;
    if (open === this.open) return;
    this.open = open;
    for (const listener of [...this.listeners]) {
      try {
        listener(open);
      } catch {
        // Listeners forward to services; their failures are theirs.
      }
    }
  }

  snapshot(): AccessState {
    const server = this.manager.session?.server ?? this.manager.lastServer;
    return toAccessState(this.monitor.state, server === null ? "" : organizationText(server));
  }

  // MARK: - AccessApi

  async state(): Promise<AccessState> {
    return this.snapshot();
  }

  async checkAgain(): Promise<AccessState> {
    await this.monitor.check(this.manager.session);
    return this.snapshot();
  }
}
