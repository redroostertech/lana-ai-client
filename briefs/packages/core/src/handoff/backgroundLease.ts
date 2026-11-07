import { toBase64 } from "../bytes/base64.js";
import type { DeviceIdentity } from "../crypto/deviceIdentity.js";
import { verifyDeviceSignature, type DevicePublicKeys } from "../crypto/devicePublicKeys.js";
import { asLanaId } from "../ids/codec.js";
import type { LanaId } from "../ids/lanaId.js";
import { canonicalEncode } from "../json/canonical.js";
import type { JsonObject, JsonValue } from "../json/jsonValue.js";
import { LanaDate } from "../json/lanaDate.js";
import { asBytes, asDate, asObject, asString, field, optional } from "../json/read.js";

export const BACKGROUND_LEASE_SCHEMA = "lana.background-lease/v1";
export const LEASE_SESSION_SCHEMA = "lana.lease-session/v1";
/** The only scope: receive updates to meetings already shared with this phone. */
export const LEASE_SCOPE_RECEIVE_SHARED_UPDATES = "receive_shared_updates";
/** A lease issued further than this in the future (clock skew) is refused. */
export const LEASE_CLOCK_SKEW_MS = 5 * 60_000;

/**
 * Permission for one paired phone to run unattested, receive-only sessions until
 * `expiresAt` (Swift `BackgroundLease`). Issued and signed by the desktop after a tone or QR
 * attested session (protocol 5, `background_lease`), presented back by the phone in a
 * background session (`lease_session`). The desktop also checks its own policy at every use
 * (setting still on, phone still paired, not revoked), so the signature alone is never enough.
 */
export interface BackgroundLease {
  readonly schema: string;
  readonly phoneDeviceID: LanaId;
  readonly macDeviceID: LanaId;
  readonly issuedAt: Date;
  readonly expiresAt: Date;
  readonly scope: string;
  readonly signature: Uint8Array;
}

/** `background_lease` payload: a fresh lease, or none (the setting is off: the phone drops its lease). */
export interface BackgroundLeaseGrant {
  readonly lease?: BackgroundLease | undefined;
}

/**
 * `lease_session` (protocol 5): sent by the phone instead of `listening` in a background
 * session. Signed by the phone over this connection's challenge, so it cannot be replayed.
 */
export interface LeaseSession {
  readonly schema: string;
  readonly sessionID: string;
  readonly macDeviceID: LanaId;
  readonly phoneDeviceID: LanaId;
  readonly lease: BackgroundLease;
  readonly presentedAt: Date;
  readonly signature: Uint8Array;
}

export function encodeBackgroundLease(lease: BackgroundLease): JsonObject {
  return {
    schema: lease.schema,
    phone_device_id: lease.phoneDeviceID,
    mac_device_id: lease.macDeviceID,
    issued_at: LanaDate.format(lease.issuedAt),
    expires_at: LanaDate.format(lease.expiresAt),
    scope: lease.scope,
    signature: toBase64(lease.signature),
  };
}

export function decodeBackgroundLease(value: JsonValue, path = "lease"): BackgroundLease {
  const object = asObject(value, path);
  return {
    schema: field(object, "schema", path, asString),
    phoneDeviceID: field(object, "phone_device_id", path, asLanaId),
    macDeviceID: field(object, "mac_device_id", path, asLanaId),
    issuedAt: field(object, "issued_at", path, asDate),
    expiresAt: field(object, "expires_at", path, asDate),
    scope: field(object, "scope", path, asString),
    signature: field(object, "signature", path, asBytes),
  };
}

export function encodeBackgroundLeaseGrant(grant: BackgroundLeaseGrant): JsonObject {
  return grant.lease === undefined ? {} : { lease: encodeBackgroundLease(grant.lease) };
}

export function decodeBackgroundLeaseGrant(value: JsonValue, path = "grant"): BackgroundLeaseGrant {
  const lease = optional(asObject(value, path), "lease", path, decodeBackgroundLease);
  return lease === undefined ? {} : { lease };
}

export function encodeLeaseSession(session: LeaseSession): JsonObject {
  return {
    schema: session.schema,
    session_id: session.sessionID,
    mac_device_id: session.macDeviceID,
    phone_device_id: session.phoneDeviceID,
    lease: encodeBackgroundLease(session.lease),
    presented_at: LanaDate.format(session.presentedAt),
    signature: toBase64(session.signature),
  };
}

export function decodeLeaseSession(value: JsonValue, path = "lease_session"): LeaseSession {
  const object = asObject(value, path);
  return {
    schema: field(object, "schema", path, asString),
    sessionID: field(object, "session_id", path, asString),
    macDeviceID: field(object, "mac_device_id", path, asLanaId),
    phoneDeviceID: field(object, "phone_device_id", path, asLanaId),
    lease: field(object, "lease", path, decodeBackgroundLease),
    presentedAt: field(object, "presented_at", path, asDate),
    signature: field(object, "signature", path, asBytes),
  };
}

/** Canonical bytes the Mac signs (signature field empty). */
export function backgroundLeaseSignedBytes(lease: BackgroundLease): Uint8Array {
  return canonicalEncode(encodeBackgroundLease({ ...lease, signature: new Uint8Array() }));
}

/** Canonical bytes the phone signs (its own signature field empty; the lease stays signed). */
export function leaseSessionSignedBytes(session: LeaseSession): Uint8Array {
  return canonicalEncode(encodeLeaseSession({ ...session, signature: new Uint8Array() }));
}

/** Desktop side: a lease for `phone` from `at` for `durationMs`, signed by the Mac. */
export function issueBackgroundLease(input: { readonly phone: DevicePublicKeys; readonly mac: DeviceIdentity; readonly at: Date; readonly durationMs: number }): BackgroundLease {
  const issued = LanaDate.milliseconds(input.at);
  const unsigned: BackgroundLease = {
    schema: BACKGROUND_LEASE_SCHEMA,
    phoneDeviceID: input.phone.deviceID,
    macDeviceID: input.mac.publicKeys.deviceID,
    issuedAt: new Date(issued),
    expiresAt: new Date(issued + Math.trunc(input.durationMs)),
    scope: LEASE_SCOPE_RECEIVE_SHARED_UPDATES,
    signature: new Uint8Array(),
  };
  return { ...unsigned, signature: input.mac.sign(backgroundLeaseSignedBytes(unsigned)) };
}

/** Phone side (tests): presents `lease` in session `sessionID`. */
export function issueLeaseSession(sessionID: string, mac: DevicePublicKeys, lease: BackgroundLease, phone: DeviceIdentity, at: Date): LeaseSession {
  const unsigned: LeaseSession = {
    schema: LEASE_SESSION_SCHEMA,
    sessionID,
    macDeviceID: mac.deviceID,
    phoneDeviceID: phone.publicKeys.deviceID,
    lease,
    presentedAt: new Date(LanaDate.milliseconds(at)),
    signature: new Uint8Array(),
  };
  return { ...unsigned, signature: phone.sign(leaseSessionSignedBytes(unsigned)) };
}

/** Why a presented lease was refused. Ids and states only. */
export type LeaseRejection = "invalid" | "expired" | "not_yet_valid" | "wrong_device" | "bad_signature";

/**
 * The cryptographic half of the check (the desktop adds its policy: setting on, phone paired,
 * not revoked): the phone signed this presentation for this session, and this Mac signed
 * the lease for this phone, with the receive scope, and it is current at `now`.
 */
export function checkLeaseSession(session: LeaseSession, input: { readonly sessionID: string; readonly mac: DevicePublicKeys; readonly phone: DevicePublicKeys; readonly now: Date }): LeaseRejection | null {
  const lease = session.lease;
  if (session.schema !== LEASE_SESSION_SCHEMA || lease.schema !== BACKGROUND_LEASE_SCHEMA || lease.scope !== LEASE_SCOPE_RECEIVE_SHARED_UPDATES) return "invalid";
  if (session.sessionID !== input.sessionID) return "invalid";
  if (session.macDeviceID !== input.mac.deviceID || lease.macDeviceID !== input.mac.deviceID) return "wrong_device";
  if (session.phoneDeviceID !== input.phone.deviceID || lease.phoneDeviceID !== input.phone.deviceID) return "wrong_device";
  if (!verifyDeviceSignature(input.phone, session.signature, leaseSessionSignedBytes(session))) return "bad_signature";
  if (!verifyDeviceSignature(input.mac, lease.signature, backgroundLeaseSignedBytes(lease))) return "bad_signature";
  const now = input.now.getTime();
  if (lease.expiresAt.getTime() <= lease.issuedAt.getTime()) return "invalid";
  if (lease.issuedAt.getTime() > now + LEASE_CLOCK_SKEW_MS) return "not_yet_valid";
  if (lease.expiresAt.getTime() <= now) return "expired";
  return null;
}

/** How a leased session ended, for the desktop's audit row. Counts only. */
export interface LeasedSessionOutcome {
  readonly result: "completed" | "rejected" | "failed";
  /** For `rejected`: a `LeaseRejection` or the desktop's policy reason; for `failed`: the error code. */
  readonly reason?: string | undefined;
  readonly listed: number;
  readonly updatesSent: number;
  readonly updatesAcknowledged: number;
}

/**
 * The desktop's lease policy, as the handoff session sees it (implemented by the gateway over
 * the store's settings). Without one the session stays on protocol 4.
 */
export interface LeaseAuthority {
  /** After a tone or QR attested session: a fresh lease for `phone`, or null when background updates are off. */
  issue(phone: DevicePublicKeys): Promise<BackgroundLease | null>;
  /**
   * A presented lease that passed `checkLeaseSession`: null admits it, otherwise the reason it
   * is refused (setting off, revoked, phone no longer paired).
   */
  admit(phone: DevicePublicKeys, lease: BackgroundLease): Promise<string | null>;
  /** Every leased session, admitted or not, is audited (`handoff.leased_session`). */
  finished(phone: DevicePublicKeys, outcome: LeasedSessionOutcome): Promise<void>;
}
