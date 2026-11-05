import { ATTESTATION_METHODS, type AttestationMethod } from "./messages.js";

export const HANDOFF_PROTOCOL_VERSION = 1;
/** Shared meeting records (update bundles, `sync_*`), negotiated in hello and challenge (Swift `handoffSharedRecordVersion`). */
export const HANDOFF_SHARED_RECORD_VERSION = 2;
/** The desktop's LANA account (display only) sent to the phone before `sync_done` (Swift `handoffAccountInfoVersion`). */
export const HANDOFF_ACCOUNT_INFO_VERSION = 3;
/** "Not now" on the phone reaches the desktop (`sync_snooze`, Swift `handoffSnoozeVersion`). */
export const HANDOFF_SNOOZE_VERSION = 4;
/** Background leases: `background_lease`, `lease_session`, `lease_accepted` (Swift `handoffBackgroundLeaseVersion`). */
export const HANDOFF_BACKGROUND_LEASE_VERSION = 5;
export const NONCE_BYTES = 16;

/** Swift `MacHandoffPolicy`, in milliseconds. */
export interface MacHandoffPolicy {
  /** How long a nonce stays valid after it is issued. */
  readonly nonceLifetimeMs: number;
  /** Maximum time between the end of tone playback (or the QR showing) and the signed response. */
  readonly maxResponseMs: number;
  readonly maxTonePlays: number;
  /** Firm policy: require a click on the Mac even after an acoustic success. */
  readonly requireMacConfirmation: boolean;
  readonly allowedMethods: readonly AttestationMethod[];
  readonly messageTimeoutMs: number;
}

export const DEFAULT_MAC_HANDOFF_POLICY: MacHandoffPolicy = Object.freeze({
  nonceLifetimeMs: 30_000,
  maxResponseMs: 5_000,
  maxTonePlays: 3,
  requireMacConfirmation: false,
  allowedMethods: ATTESTATION_METHODS,
  messageTimeoutMs: 60_000,
});

/** The phone's decision window for a meeting it does not hold is 45 s; the desktop waits twice that. */
export const RECORD_DECISION_TIMEOUT_MS = 90_000;

/**
 * How long the desktop waits for `sync_ack` or `sync_decline` after the last part of an
 * update: the person on the phone may be choosing Accept or Decline, so never less than
 * `RECORD_DECISION_TIMEOUT_MS`, and never less than the message timeout.
 */
export function recordDecisionTimeoutMs(policy: MacHandoffPolicy): number {
  return Math.max(policy.messageTimeoutMs, RECORD_DECISION_TIMEOUT_MS);
}

/** Firm settings to policy, as `HandoffSettings.policy`: acoustic always, fallbacks by toggle. */
export function handoffPolicyFromSettings(settings: { requireMacClick: boolean; allowQr: boolean; allowMacApproval: boolean }): MacHandoffPolicy {
  const methods: AttestationMethod[] = ["acoustic"];
  if (settings.allowQr) methods.push("qr");
  if (settings.allowMacApproval) methods.push("mac_approval");
  return { ...DEFAULT_MAC_HANDOFF_POLICY, requireMacConfirmation: settings.requireMacClick, allowedMethods: methods };
}
