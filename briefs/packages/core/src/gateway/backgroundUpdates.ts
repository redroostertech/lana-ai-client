import type { DeviceIdentity } from "../crypto/deviceIdentity.js";
import type { DevicePublicKeys } from "../crypto/devicePublicKeys.js";
import { issueBackgroundLease, type BackgroundLease, type LeaseAuthority, type LeasedSessionOutcome } from "../handoff/backgroundLease.js";
import type { Clock } from "../handoff/ports.js";
import { LanaDate } from "../json/lanaDate.js";
import { AUDIT_EVENTS } from "../store/auditLog.js";
import type { AuditSink, TrustStore } from "../store/interfaces.js";
import type { SettingsWriter } from "./handoffSettings.js";

/** Store setting keys for background updates (plain values; never secrets). */
export const BACKGROUND_UPDATE_KEYS = {
  enabled: "handoff.background_updates",
  leaseHours: "handoff.background_lease_hours",
  /** Leases issued at or before this time are refused (setting turned off, sign out). */
  revokedAt: "handoff.leases_revoked_at",
  /** Per phone: leases issued at or before this time are refused (unpaired). */
  phoneRevokedAtPrefix: "handoff.lease_revoked_at.",
} as const;

export const LEASE_HOUR_CHOICES: readonly number[] = [1, 4, 8, 24];
export const DEFAULT_LEASE_HOURS = 8;
const HOUR_MS = 3_600_000;

/**
 * "Let paired phones receive updates in the background": off by default, per firm (this
 * desktop's store). While on, every tone or QR attested session hands the phone a lease of
 * `leaseHours`; the phone may then run receive-only sessions without the tone until it expires.
 */
export interface BackgroundUpdateSettings {
  readonly enabled: boolean;
  readonly leaseHours: number;
}

export function loadBackgroundUpdates(store: { get(key: string): string | null }): BackgroundUpdateSettings {
  const hours = Number(store.get(BACKGROUND_UPDATE_KEYS.leaseHours));
  return {
    enabled: store.get(BACKGROUND_UPDATE_KEYS.enabled) === "true",
    leaseHours: LEASE_HOUR_CHOICES.includes(hours) ? hours : DEFAULT_LEASE_HOURS,
  };
}

/**
 * Saves the setting. Turning it off revokes every lease at once (the desktop refuses them from
 * now on, before any phone hears about it) and is audited.
 */
export async function saveBackgroundUpdates(store: SettingsWriter, audit: AuditSink, next: BackgroundUpdateSettings, now: Date): Promise<BackgroundUpdateSettings> {
  const current = loadBackgroundUpdates(store);
  const hours = LEASE_HOUR_CHOICES.includes(next.leaseHours) ? next.leaseHours : current.leaseHours;
  store.set(BACKGROUND_UPDATE_KEYS.leaseHours, String(hours));
  store.set(BACKGROUND_UPDATE_KEYS.enabled, String(next.enabled === true));
  if (current.enabled && next.enabled !== true) await revokeAllLeases(store, audit, "setting_off", now);
  return loadBackgroundUpdates(store);
}

/** Refuses every lease issued until now (setting off, sign out). Audited. */
export async function revokeAllLeases(store: SettingsWriter, audit: AuditSink, reason: "setting_off" | "signed_out", now: Date): Promise<void> {
  store.set(BACKGROUND_UPDATE_KEYS.revokedAt, LanaDate.format(now));
  await audit.appendAudit(AUDIT_EVENTS.leasesRevoked, "all", { reason });
}

/** Refuses every lease issued to one phone until now (unpaired). Audited. */
export async function revokePhoneLeases(store: SettingsWriter, audit: AuditSink, phoneDeviceID: string, now: Date): Promise<void> {
  store.set(`${BACKGROUND_UPDATE_KEYS.phoneRevokedAtPrefix}${phoneDeviceID}`, LanaDate.format(now));
  await audit.appendAudit(AUDIT_EVENTS.leasesRevoked, phoneDeviceID, { reason: "unpaired" });
}

/**
 * The desktop's lease policy over its store (the session's `LeaseAuthority`): issues leases
 * while the setting is on, and admits a presented lease only while the setting is still on,
 * the phone is still paired and nothing revoked it since it was issued.
 */
export class StoreLeaseAuthority implements LeaseAuthority {
  constructor(
    private readonly deps: {
      readonly identity: DeviceIdentity;
      readonly settings: SettingsWriter;
      readonly trust: TrustStore;
      readonly audit: AuditSink;
      readonly clock: Clock;
    },
  ) {}

  async issue(phone: DevicePublicKeys): Promise<BackgroundLease | null> {
    const settings = loadBackgroundUpdates(this.deps.settings);
    if (!settings.enabled) return null;
    const lease = issueBackgroundLease({ phone, mac: this.deps.identity, at: this.deps.clock.now(), durationMs: settings.leaseHours * HOUR_MS });
    await this.deps.audit.appendAudit(AUDIT_EVENTS.leaseIssued, phone.deviceID, { expires_at: LanaDate.format(lease.expiresAt), hours: String(settings.leaseHours) });
    return lease;
  }

  async admit(phone: DevicePublicKeys, lease: BackgroundLease): Promise<string | null> {
    if (!loadBackgroundUpdates(this.deps.settings).enabled) return "background_updates_off";
    if ((await this.deps.trust.pinnedPhone(phone.deviceID)) === null) return "not_paired";
    const issued = lease.issuedAt.getTime();
    for (const key of [BACKGROUND_UPDATE_KEYS.revokedAt, `${BACKGROUND_UPDATE_KEYS.phoneRevokedAtPrefix}${phone.deviceID}`]) {
      const raw = this.deps.settings.get(key);
      const revoked = raw === null ? null : LanaDate.parseMilliseconds(raw);
      if (revoked !== null && issued <= revoked) return "revoked";
    }
    return null;
  }

  async finished(phone: DevicePublicKeys, outcome: LeasedSessionOutcome): Promise<void> {
    await this.deps.audit.appendAudit(AUDIT_EVENTS.leasedSession, phone.deviceID, {
      result: outcome.result,
      ...(outcome.reason === undefined ? {} : { reason: outcome.reason }),
      listed: String(outcome.listed),
      updates_sent: String(outcome.updatesSent),
      updates_acknowledged: String(outcome.updatesAcknowledged),
    });
  }
}
