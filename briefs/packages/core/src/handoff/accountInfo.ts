import { toBase64 } from "../bytes/base64.js";
import { utf8 } from "../bytes/utf8.js";
import type { DeviceIdentity } from "../crypto/deviceIdentity.js";
import { verifyDeviceSignature, type DevicePublicKeys } from "../crypto/devicePublicKeys.js";
import { decodeHpkeEnvelope, encodeHpkeEnvelope, sealHpke, type HpkeEnvelope } from "../crypto/hpke.js";
import { asLanaId } from "../ids/codec.js";
import { makeLanaId, type LanaId } from "../ids/lanaId.js";
import { canonicalEncode } from "../json/canonical.js";
import type { JsonObject, JsonValue } from "../json/jsonValue.js";
import { LanaDate } from "../json/lanaDate.js";
import { parseJson } from "../json/parse.js";
import { asBytes, asDate, asObject, asString, field } from "../json/read.js";
import { HandoffError } from "./errors.js";

export const ACCOUNT_INFO_SCHEMA = "lana.account-info/v1";

/**
 * The LANA account signed in on the desktop, for display on the phone only (Swift
 * `AccountInfo`). The phone never signs in and never receives tokens.
 */
export interface AccountInfo {
  readonly name: string;
  readonly email: string;
  readonly organization: string;
  readonly serverHost: string;
}

/**
 * The desktop's account info sealed for the phone (protocol 3, `account_info`). The body is
 * HPKE-sealed to the phone's pinned agreement key; the header is signed by the Mac.
 */
export interface AccountInfoUpdate {
  readonly schema: string;
  readonly updateID: LanaId;
  readonly phoneDeviceID: LanaId;
  readonly macDeviceID: LanaId;
  readonly createdAt: Date;
  readonly envelope: HpkeEnvelope;
  readonly signature: Uint8Array;
}

export function encodeAccountInfo(account: AccountInfo): JsonObject {
  return { name: account.name, email: account.email, organization: account.organization, server_host: account.serverHost };
}

export function decodeAccountInfo(value: JsonValue, path = "account"): AccountInfo {
  const object = asObject(value, path);
  return {
    name: field(object, "name", path, asString),
    email: field(object, "email", path, asString),
    organization: field(object, "organization", path, asString),
    serverHost: field(object, "server_host", path, asString),
  };
}

export function encodeAccountInfoUpdate(update: AccountInfoUpdate): JsonObject {
  return {
    schema: update.schema,
    update_id: update.updateID,
    phone_device_id: update.phoneDeviceID,
    mac_device_id: update.macDeviceID,
    created_at: LanaDate.format(update.createdAt),
    envelope: encodeHpkeEnvelope(update.envelope),
    signature: toBase64(update.signature),
  };
}

export function decodeAccountInfoUpdate(value: JsonValue, path = "account_info"): AccountInfoUpdate {
  const object = asObject(value, path);
  return {
    schema: field(object, "schema", path, asString),
    updateID: field(object, "update_id", path, asLanaId),
    phoneDeviceID: field(object, "phone_device_id", path, asLanaId),
    macDeviceID: field(object, "mac_device_id", path, asLanaId),
    createdAt: field(object, "created_at", path, asDate),
    envelope: field(object, "envelope", path, decodeHpkeEnvelope),
    signature: field(object, "signature", path, asBytes),
  };
}

/** Canonical bytes the Mac signs (signature field empty). */
export function accountInfoSignedBytes(update: AccountInfoUpdate): Uint8Array {
  return canonicalEncode(encodeAccountInfoUpdate({ ...update, signature: new Uint8Array() }));
}

export function accountInfoHpkeInfo(updateID: LanaId, phoneDeviceID: LanaId): Uint8Array {
  return utf8(`${ACCOUNT_INFO_SCHEMA}|${updateID}|${phoneDeviceID}`);
}

/** Mac side: seals `account` for `phone` and signs the header. */
export async function issueAccountInfoUpdate(input: {
  readonly account: AccountInfo;
  readonly phone: DevicePublicKeys;
  readonly mac: DeviceIdentity;
  readonly at: Date;
  readonly updateID?: LanaId;
}): Promise<AccountInfoUpdate> {
  const updateID = input.updateID ?? makeLanaId("bundle");
  const unsigned: AccountInfoUpdate = {
    schema: ACCOUNT_INFO_SCHEMA,
    updateID,
    phoneDeviceID: input.phone.deviceID,
    macDeviceID: input.mac.publicKeys.deviceID,
    createdAt: new Date(LanaDate.milliseconds(input.at)),
    envelope: await sealHpke(canonicalEncode(encodeAccountInfo(input.account)), input.phone.agreementKey, accountInfoHpkeInfo(updateID, input.phone.deviceID)),
    signature: new Uint8Array(),
  };
  return { ...unsigned, signature: input.mac.sign(accountInfoSignedBytes(unsigned)) };
}

/** Phone side (tests and the golden check): verifies the pinned Mac's signature, then opens. */
export async function openAccountInfoUpdate(update: AccountInfoUpdate, phone: DeviceIdentity, mac: DevicePublicKeys): Promise<AccountInfo> {
  if (update.schema !== ACCOUNT_INFO_SCHEMA) throw new HandoffError("bundle_rejected", "unsupported account info");
  if (update.phoneDeviceID !== phone.publicKeys.deviceID || update.macDeviceID !== mac.deviceID) throw new HandoffError("bundle_rejected", "account info for another device");
  if (!verifyDeviceSignature(mac, update.signature, accountInfoSignedBytes(update))) throw new HandoffError("bundle_rejected", "bad account info signature");
  let plaintext: Uint8Array;
  try {
    plaintext = await phone.openHpke(update.envelope, accountInfoHpkeInfo(update.updateID, update.phoneDeviceID));
  } catch {
    throw new HandoffError("bundle_rejected", "account info does not open");
  }
  return decodeAccountInfo(parseJson(plaintext));
}
