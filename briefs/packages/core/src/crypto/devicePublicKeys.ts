import { toBase64 } from "../bytes/base64.js";
import { asLanaId } from "../ids/codec.js";
import type { LanaId } from "../ids/lanaId.js";
import type { JsonObject, JsonValue } from "../json/jsonValue.js";
import { asBytes, asObject, asString, field } from "../json/read.js";
import { p256Verify } from "./p256.js";

/** The public half of a device's identity, pinned by its peer at pairing. Keys are X9.63. */
export interface DevicePublicKeys {
  readonly deviceID: LanaId;
  readonly signingKey: Uint8Array;
  readonly agreementKey: Uint8Array;
  readonly displayName: string;
}

export function encodeDevicePublicKeys(keys: DevicePublicKeys): JsonObject {
  return {
    device_id: keys.deviceID,
    signing_key: toBase64(keys.signingKey),
    agreement_key: toBase64(keys.agreementKey),
    display_name: keys.displayName,
  };
}

export function decodeDevicePublicKeys(value: JsonValue, path: string): DevicePublicKeys {
  const object = asObject(value, path);
  return {
    deviceID: field(object, "device_id", path, asLanaId),
    signingKey: field(object, "signing_key", path, asBytes),
    agreementKey: field(object, "agreement_key", path, asBytes),
    displayName: field(object, "display_name", path, asString),
  };
}

/** Verifies a raw (r||s) P-256 signature made by this device. */
export function verifyDeviceSignature(keys: DevicePublicKeys, signature: Uint8Array, message: Uint8Array): boolean {
  return p256Verify(keys.signingKey, message, signature);
}
