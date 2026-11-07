import { toBase64 } from "../bytes/base64.js";
import type { DeviceIdentity } from "../crypto/deviceIdentity.js";
import { verifyDeviceSignature, type DevicePublicKeys } from "../crypto/devicePublicKeys.js";
import { asLanaId } from "../ids/codec.js";
import type { LanaId } from "../ids/lanaId.js";
import { canonicalEncode } from "../json/canonical.js";
import { LanaDate } from "../json/lanaDate.js";
import type { JsonObject, JsonValue } from "../json/jsonValue.js";
import { asBytes, asDate, asObject, asString, field } from "../json/read.js";
import { manifestHashHex, type BundleManifest } from "./bundleManifest.js";

export const RECEIPT_SCHEMA = "lana.receipt/v1";

/** Mac-signed proof that a bundle arrived intact. The phone deletes only on a verified receipt. */
export interface Receipt {
  readonly schema: string;
  readonly bundleID: LanaId;
  readonly manifestHash: string;
  readonly macDeviceID: LanaId;
  readonly receivedAt: Date;
  readonly signature: Uint8Array;
}

export function encodeReceipt(receipt: Receipt): JsonObject {
  return {
    schema: receipt.schema,
    bundle_id: receipt.bundleID,
    manifest_hash: receipt.manifestHash,
    mac_device_id: receipt.macDeviceID,
    received_at: LanaDate.format(receipt.receivedAt),
    signature: toBase64(receipt.signature),
  };
}

export function decodeReceipt(value: JsonValue, path = "receipt"): Receipt {
  const object = asObject(value, path);
  return {
    schema: field(object, "schema", path, asString),
    bundleID: field(object, "bundle_id", path, asLanaId),
    manifestHash: field(object, "manifest_hash", path, asString),
    macDeviceID: field(object, "mac_device_id", path, asLanaId),
    receivedAt: field(object, "received_at", path, asDate),
    signature: field(object, "signature", path, asBytes),
  };
}

export function receiptSignedBytes(receipt: Receipt): Uint8Array {
  return canonicalEncode(encodeReceipt({ ...receipt, signature: new Uint8Array() }));
}

export function issueReceipt(manifest: BundleManifest, mac: DeviceIdentity, at: Date): Receipt {
  const unsigned: Receipt = {
    schema: RECEIPT_SCHEMA,
    bundleID: manifest.bundleID,
    manifestHash: manifestHashHex(manifest),
    macDeviceID: mac.publicKeys.deviceID,
    receivedAt: new Date(LanaDate.milliseconds(at)),
    signature: new Uint8Array(),
  };
  return { ...unsigned, signature: mac.sign(receiptSignedBytes(unsigned)) };
}

/** True only if the pinned Mac signed a receipt for exactly this manifest. */
export function verifyReceipt(receipt: Receipt, manifest: BundleManifest, mac: DevicePublicKeys): boolean {
  if (receipt.schema !== RECEIPT_SCHEMA || receipt.bundleID !== manifest.bundleID || receipt.macDeviceID !== mac.deviceID) return false;
  if (receipt.manifestHash !== manifestHashHex(manifest)) return false;
  return verifyDeviceSignature(mac, receipt.signature, receiptSignedBytes(receipt));
}
