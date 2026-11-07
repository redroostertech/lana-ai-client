import { sha256Hex } from "../crypto/digest.js";
import { ChunkCipher } from "../crypto/chunkCipher.js";
import type { DeviceIdentity } from "../crypto/deviceIdentity.js";
import { verifyDeviceSignature, type DevicePublicKeys } from "../crypto/devicePublicKeys.js";
import type { Intent } from "../intent/intent.js";
import { decodeMeeting, type MeetingRecord } from "../intent/meeting.js";
import { validateIntent, type ValidationIssue } from "../intent/validator.js";
import { parseJson } from "../json/parse.js";
import { BUNDLE_SCHEMA, bundleHpkeInfo, manifestSignedBytes, partAad, type BundleManifest, type BundlePart } from "./bundleManifest.js";
import { HandoffError } from "./errors.js";

export interface OpenedBundle {
  readonly manifest: BundleManifest;
  /** The meeting with only the intents that passed validation. */
  readonly meeting: MeetingRecord;
  /** Intents that failed validation at the trust boundary: kept for the audit log, never executed. */
  readonly rejectedIntents: readonly { readonly intent: Intent; readonly issues: readonly ValidationIssue[] }[];
  /** Decrypted audio parts in order. */
  readonly audio: readonly { readonly name: string; readonly data: Uint8Array }[];
}

/** Mac side checks before accepting any part (Swift `BundleOpener.verifyManifest`). */
export function verifyManifest(manifest: BundleManifest, phone: DevicePublicKeys, mac: DevicePublicKeys): void {
  if (manifest.schema !== BUNDLE_SCHEMA) throw new HandoffError("bundle_rejected", "unsupported bundle schema");
  if (manifest.phoneDeviceID !== phone.deviceID) throw new HandoffError("bundle_rejected", "bundle from another phone");
  if (manifest.macDeviceID !== mac.deviceID) throw new HandoffError("bundle_rejected", "bundle addressed to another Mac");
  if (!verifyDeviceSignature(phone, manifest.signature, manifestSignedBytes(manifest))) throw new HandoffError("bundle_rejected", "bad manifest signature");
  const parts = manifest.parts;
  if (parts.length === 0 || parts[0]?.kind !== "meeting" || !parts.every((part, offset) => part.index === offset)) {
    throw new HandoffError("bundle_rejected", "bad part table");
  }
}

export function checkPart(ciphertext: Uint8Array, part: BundlePart): boolean {
  return ciphertext.length === part.size && sha256Hex(ciphertext) === part.sha256;
}

/** Decrypts a fully received bundle and validates its intents. */
export async function openBundle(manifest: BundleManifest, parts: readonly Uint8Array[], mac: DeviceIdentity): Promise<OpenedBundle> {
  if (parts.length !== manifest.parts.length) throw new HandoffError("bundle_rejected", "missing parts");
  const key = await mac.openHpke(manifest.envelope, bundleHpkeInfo(manifest.bundleID, manifest.macDeviceID));
  const plaintexts = manifest.parts.map((part, offset) => {
    const ciphertext = parts[offset] as Uint8Array;
    if (!checkPart(ciphertext, part)) throw new HandoffError("bundle_rejected", `part ${part.index} hash mismatch`);
    return ChunkCipher.open(ciphertext, key, partAad(manifest.bundleID, part.index, manifest.parts.length, part.name));
  });
  const meeting = decodeMeeting(parseJson(plaintexts[0] as Uint8Array));
  if (meeting.id !== manifest.meetingID) throw new HandoffError("bundle_rejected", "meeting id mismatch");
  const accepted: Intent[] = [];
  const rejected: { intent: Intent; issues: ValidationIssue[] }[] = [];
  for (const intent of meeting.intents) {
    const issues = validateIntent(intent);
    if (intent.meetingID !== meeting.id) issues.push({ field: "meeting_id", message: "belongs to another meeting" });
    if (issues.length === 0) accepted.push(intent);
    else rejected.push({ intent, issues });
  }
  const audio = manifest.parts.slice(1).map((part, offset) => ({ name: part.name, data: plaintexts[offset + 1] as Uint8Array }));
  return { manifest, meeting: { ...meeting, intents: accepted }, rejectedIntents: rejected, audio };
}
