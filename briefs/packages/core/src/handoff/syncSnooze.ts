import { toBase64 } from "../bytes/base64.js";
import type { DeviceIdentity } from "../crypto/deviceIdentity.js";
import { verifyDeviceSignature, type DevicePublicKeys } from "../crypto/devicePublicKeys.js";
import { asLanaId } from "../ids/codec.js";
import type { LanaId } from "../ids/lanaId.js";
import { canonicalEncode } from "../json/canonical.js";
import type { JsonObject, JsonValue } from "../json/jsonValue.js";
import { LanaDate } from "../json/lanaDate.js";
import { asBytes, asDate, asObject, asString, field } from "../json/read.js";

export const SYNC_SNOOZE_SCHEMA = "lana.sync-snooze/v1";

/**
 * "Not now" on the phone (`sync_snooze`, protocol 4; Swift `SyncSnooze`). Sent instead of
 * `listening`: no meeting data, it only takes this phone's queue down, so no presence proof
 * is needed (the TLS-PSK pairing and the phone's signature are enough). `wakeNonce` is the
 * wake flag the person answered; `sessionID` is this connection's challenge (no replay).
 */
export interface SyncSnooze {
  readonly schema: string;
  readonly sessionID: string;
  readonly macDeviceID: LanaId;
  readonly phoneDeviceID: LanaId;
  readonly wakeNonce: string;
  readonly snoozedAt: Date;
  readonly signature: Uint8Array;
}

export function encodeSyncSnooze(snooze: SyncSnooze): JsonObject {
  return {
    schema: snooze.schema,
    session_id: snooze.sessionID,
    mac_device_id: snooze.macDeviceID,
    phone_device_id: snooze.phoneDeviceID,
    wake_nonce: snooze.wakeNonce,
    snoozed_at: LanaDate.format(snooze.snoozedAt),
    signature: toBase64(snooze.signature),
  };
}

export function decodeSyncSnooze(value: JsonValue, path = "snooze"): SyncSnooze {
  const object = asObject(value, path);
  return {
    schema: field(object, "schema", path, asString),
    sessionID: field(object, "session_id", path, asString),
    macDeviceID: field(object, "mac_device_id", path, asLanaId),
    phoneDeviceID: field(object, "phone_device_id", path, asLanaId),
    wakeNonce: field(object, "wake_nonce", path, asString),
    snoozedAt: field(object, "snoozed_at", path, asDate),
    signature: field(object, "signature", path, asBytes),
  };
}

export function syncSnoozeSignedBytes(snooze: SyncSnooze): Uint8Array {
  return canonicalEncode(encodeSyncSnooze({ ...snooze, signature: new Uint8Array() }));
}

/** Phone side (tests): signs a snooze for `wakeNonce` in session `sessionID`. */
export function issueSyncSnooze(sessionID: string, mac: DevicePublicKeys, wakeNonce: string, phone: DeviceIdentity, at: Date): SyncSnooze {
  const unsigned: SyncSnooze = {
    schema: SYNC_SNOOZE_SCHEMA,
    sessionID,
    macDeviceID: mac.deviceID,
    phoneDeviceID: phone.publicKeys.deviceID,
    wakeNonce,
    snoozedAt: new Date(LanaDate.milliseconds(at)),
    signature: new Uint8Array(),
  };
  return { ...unsigned, signature: phone.sign(syncSnoozeSignedBytes(unsigned)) };
}

/** True only if the pinned phone signed this snooze for this Mac and this session. */
export function verifySyncSnooze(snooze: SyncSnooze, sessionID: string, macDeviceID: LanaId, phone: DevicePublicKeys): boolean {
  if (snooze.schema !== SYNC_SNOOZE_SCHEMA || snooze.sessionID !== sessionID || snooze.macDeviceID !== macDeviceID || snooze.phoneDeviceID !== phone.deviceID) return false;
  return verifyDeviceSignature(phone, snooze.signature, syncSnoozeSignedBytes(snooze));
}
