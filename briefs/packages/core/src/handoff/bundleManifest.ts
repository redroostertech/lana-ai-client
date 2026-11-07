import { toBase64 } from "../bytes/base64.js";
import { utf8 } from "../bytes/utf8.js";
import { sha256Hex } from "../crypto/digest.js";
import { decodeHpkeEnvelope, encodeHpkeEnvelope, type HpkeEnvelope } from "../crypto/hpke.js";
import { asLanaId } from "../ids/codec.js";
import type { LanaId } from "../ids/lanaId.js";
import { canonicalEncode } from "../json/canonical.js";
import { LanaDate } from "../json/lanaDate.js";
import type { JsonObject, JsonValue } from "../json/jsonValue.js";
import { arrayOf, asBytes, asDate, asEnum, asInt, asObject, asString, field } from "../json/read.js";

export const BUNDLE_SCHEMA = "lana.bundle/v1";
export const PART_KINDS = ["meeting", "audio"] as const;
export type PartKind = (typeof PART_KINDS)[number];

export interface BundlePart {
  readonly index: number;
  readonly kind: PartKind;
  readonly name: string;
  readonly size: number;
  /** SHA-256 hex of the ciphertext, checked before decrypting. */
  readonly sha256: string;
}

/** Signed table of contents for one sealed meeting. */
export interface BundleManifest {
  readonly schema: string;
  readonly bundleID: LanaId;
  readonly meetingID: LanaId;
  readonly phoneDeviceID: LanaId;
  readonly macDeviceID: LanaId;
  readonly createdAt: Date;
  readonly envelope: HpkeEnvelope;
  readonly parts: readonly BundlePart[];
  readonly signature: Uint8Array;
}

export function encodeManifest(manifest: BundleManifest): JsonObject {
  return {
    schema: manifest.schema,
    bundle_id: manifest.bundleID,
    meeting_id: manifest.meetingID,
    phone_device_id: manifest.phoneDeviceID,
    mac_device_id: manifest.macDeviceID,
    created_at: LanaDate.format(manifest.createdAt),
    envelope: encodeHpkeEnvelope(manifest.envelope),
    parts: manifest.parts.map((part) => ({ index: part.index, kind: part.kind, name: part.name, size: part.size, sha256: part.sha256 })),
    signature: toBase64(manifest.signature),
  };
}

function decodePart(value: JsonValue, path: string): BundlePart {
  const object = asObject(value, path);
  return {
    index: field(object, "index", path, asInt),
    kind: field(object, "kind", path, (v, p) => asEnum(v, PART_KINDS, p)),
    name: field(object, "name", path, asString),
    size: field(object, "size", path, asInt),
    sha256: field(object, "sha256", path, asString),
  };
}

export function decodeManifest(value: JsonValue, path = "manifest"): BundleManifest {
  const object = asObject(value, path);
  return {
    schema: field(object, "schema", path, asString),
    bundleID: field(object, "bundle_id", path, asLanaId),
    meetingID: field(object, "meeting_id", path, asLanaId),
    phoneDeviceID: field(object, "phone_device_id", path, asLanaId),
    macDeviceID: field(object, "mac_device_id", path, asLanaId),
    createdAt: field(object, "created_at", path, asDate),
    envelope: field(object, "envelope", path, decodeHpkeEnvelope),
    parts: field(object, "parts", path, arrayOf(decodePart)),
    signature: field(object, "signature", path, asBytes),
  };
}

/** Canonical bytes the phone signs: the manifest with an empty signature. */
export function manifestSignedBytes(manifest: BundleManifest): Uint8Array {
  return canonicalEncode(encodeManifest({ ...manifest, signature: new Uint8Array() }));
}

/** Hash the Mac's receipt commits to. */
export function manifestHashHex(manifest: BundleManifest): string {
  return sha256Hex(canonicalEncode(encodeManifest(manifest)));
}

export function bundleHpkeInfo(bundleID: LanaId, macDeviceID: LanaId): Uint8Array {
  return utf8(`lana.bundle/v1|${bundleID}|${macDeviceID}`);
}

export function partAad(bundleID: LanaId, index: number, count: number, name: string): Uint8Array {
  return utf8(`lana.part/v1|${bundleID}|${index}|${count}|${name}`);
}
