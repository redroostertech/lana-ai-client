import type { HandoffGateway } from "../../src/gateway/index.js";
import { saveBackgroundUpdates } from "../../src/gateway/index.js";
import { encodeBackgroundLease, issueBackgroundLease } from "../../src/handoff/index.js";
import { canonicalString } from "../../src/json/index.js";

/** Background lease commands the Swift cross test sends to the desktop (protocol 5). */
export interface LeaseCommand {
  readonly op: "background_updates" | "lease_sign_out" | "lease_audit" | "lease_expired";
  /** `background_updates`: the setting and the lease length in hours. */
  readonly enabled?: boolean;
  readonly hours?: number;
  /** `lease_expired`: the phone the lease is for. */
  readonly phone?: string;
}

export function isLeaseCommand(command: { readonly op: string }): boolean {
  return ["background_updates", "lease_sign_out", "lease_audit", "lease_expired"].includes(command.op);
}

export async function runLeaseCommand(gateway: HandoffGateway, command: LeaseCommand): Promise<unknown> {
  const store = gateway.store;
  switch (command.op) {
    case "background_updates":
      return saveBackgroundUpdates(store.settings, store, { enabled: command.enabled === true, leaseHours: command.hours ?? 8 }, new Date());
    case "lease_sign_out":
      await gateway.revokeLeasesOnSignOut();
      return { ok: true };
    case "lease_audit":
      return { rows: (await store.auditEntries()).filter((entry) => entry.event.startsWith("handoff.")).map((entry) => ({ event: entry.event, subject: entry.subject, detail: JSON.parse(entry.detail) as unknown })) };
    case "lease_expired": {
      // A lease this desktop really signed, already past its expiry: only the desktop's expiry check can refuse it.
      const phone = await store.pinnedPhone(command.phone ?? "");
      if (phone === null) throw new Error("not paired");
      const lease = issueBackgroundLease({ phone, mac: gateway.identity, at: new Date(Date.now() - 2 * 3_600_000), durationMs: 3_600_000 });
      return { lease_json: canonicalString(encodeBackgroundLease(lease)) };
    }
  }
}
