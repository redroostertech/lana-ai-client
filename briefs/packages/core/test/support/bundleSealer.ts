import { canonicalEncode, parseJson } from "../../src/json/index.js";
import { ChunkCipher, randomBytes, sealHpke, sha256Hex, type DevicePublicKeys, type SoftwareIdentity } from "../../src/crypto/index.js";
import { BUNDLE_SCHEMA, bundleHpkeInfo, manifestSignedBytes, partAad, type BundleManifest, type BundlePart } from "../../src/handoff/index.js";
import { makeLanaId, type LanaId } from "../../src/ids/index.js";
import { decodeMeeting, encodeMeeting, makeIdempotencyKey } from "../../src/intent/index.js";
import type { ScriptedBundle } from "./handoffFakes.js";
import { goldenBundle } from "./storeRig.js";

/**
 * A TypeScript stand-in for the Swift `BundleSealer`: the golden meeting under fresh ids,
 * sealed for `mac` and signed by `phone`, so a test can hand off as many distinct
 * bundles as it needs to a Mac identity created at run time.
 */
export async function sealTestBundle(phone: SoftwareIdentity, mac: DevicePublicKeys, audio: readonly Uint8Array[]): Promise<ScriptedBundle & { readonly meetingID: LanaId; readonly intents: number }> {
  const base = decodeMeeting(parseJson(goldenBundle().plaintexts[0] as Uint8Array));
  const meetingID = makeLanaId("meeting");
  const meeting = {
    ...base,
    id: meetingID,
    intents: base.intents.map((intent) => ({ ...intent, id: makeLanaId("intent"), meetingID, idempotencyKey: makeIdempotencyKey(meetingID, intent.params) })),
  };
  const bundleID = makeLanaId("bundle");
  const key = randomBytes(32);
  const plaintexts = [canonicalEncode(encodeMeeting(meeting)), ...audio];
  const names = ["meeting.json", ...audio.map((_, index) => `audio-${index}.m4a`)];
  const parts: Uint8Array[] = [];
  const table: BundlePart[] = plaintexts.map((plaintext, index) => {
    const name = names[index] as string;
    const sealed = ChunkCipher.seal(plaintext, key, partAad(bundleID, index, plaintexts.length, name));
    parts.push(sealed);
    return { index, kind: index === 0 ? "meeting" : "audio", name, size: sealed.length, sha256: sha256Hex(sealed) };
  });
  const unsigned: BundleManifest = {
    schema: BUNDLE_SCHEMA,
    bundleID,
    meetingID,
    phoneDeviceID: phone.publicKeys.deviceID,
    macDeviceID: mac.deviceID,
    createdAt: new Date(Math.floor(Date.now() / 1_000) * 1_000),
    envelope: await sealHpke(key, mac.agreementKey, bundleHpkeInfo(bundleID, mac.deviceID)),
    parts: table,
    signature: new Uint8Array(),
  };
  const manifest = { ...unsigned, signature: phone.sign(manifestSignedBytes(unsigned)) };
  return { manifest, parts, meetingID, intents: meeting.intents.length };
}
