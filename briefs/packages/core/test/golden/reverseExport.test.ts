import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { describe, expect, it } from "vitest";
import { fromHex, toBase64, toHex, utf8 } from "../../src/bytes/index.js";
import { invitationQrString, makePairingInvitation, RecordingKey, sealHpke, shortCode, aesKeyWrap } from "../../src/crypto/index.js";
import { decodeManifest, encodeFrame, issueReceipt, encodeReceipt } from "../../src/handoff/index.js";
import { makeLanaId } from "../../src/ids/index.js";
import { decodeMeeting, encodeMeeting, makeIntent, sourceSpan, transcriptClip, type MeetingRecord } from "../../src/intent/index.js";
import { canonicalString, parseJson } from "../../src/json/index.js";
import { golden } from "./fixtures.js";
import { goldenIdentities } from "../support/goldenIdentities.js";

/**
 * Writes vectors produced by the TypeScript core for the Swift side to check
 * (GoldenVectorImportTests). Opt in: `LANA_EXPORT_TS_GOLDEN=<file> npx vitest run`.
 */
const target = process.env["LANA_EXPORT_TS_GOLDEN"];

function tsMeeting(): MeetingRecord {
  const swift = decodeMeeting(parseJson(golden<Record<string, string>>("meeting")["canonical"] as string));
  const meetingID = makeLanaId("meeting", new Date("2026-11-02T09:00:00.000Z"));
  const createdAt = new Date("2026-11-02T10:00:00.250Z");
  const intent = makeIntent({
    meetingID,
    params: { type: "task.create", task: { title: "Draft the Étude response / v3", detail: "Due \"soon\"\n", dueDate: "2026-11-20", regarding: { kind: "matter", name: "Straße Holdings" } } },
    confidence: 0.7071067811865476,
    evidence: [{ speaker: "S2", tStart: 1e-5, tEnd: 0.30000000000000004, quote: "Let's get the Étude response out \u{1F680}" }],
    createdAt,
  });
  return {
    ...swift,
    id: meetingID,
    title: "Desktop built   meeting \u{1F600}",
    startedAt: new Date("2026-11-02T09:00:00.001Z"),
    durationSeconds: 9007199254740992,
    notes: { keyPoints: [{ id: "kp-1", kind: "decision", text: "A", sources: [sourceSpan(5, 1, "S1")], precision: "exact" }], gaps: [] },
    intents: [intent],
    clips: [transcriptClip("c1", 9.5, 2.25, createdAt)],
    userNotes: [],
  };
}

describe.runIf(target !== undefined)("reverse golden export (TypeScript to Swift)", () => {
  it("writes vectors for GoldenVectorImportTests", async () => {
    const { mac, phone } = goldenIdentities();
    const bundle = golden<Record<string, string>>("bundle");
    const atRest = golden<Record<string, string>>("atrest");
    const manifest = decodeManifest(parseJson(bundle["manifest_json"] as string));
    const messages = ["", "desktop", "\u{1F600} canonical"].map(utf8);
    const hpkeInfo = utf8("lana.bundle/v1|bdl_01JCQ9A1B2C3D4E5F6G7H8J9K0|dev_01JCQ8ZX9V7S5D2F4G6H8J0K1M");
    const hpkePlaintext = utf8("thirty-two byte bundle key here!");
    const envelope = await sealHpke(hpkePlaintext, mac.publicKeys.agreementKey, hpkeInfo, utf8("aad"));
    const recording = new RecordingKey(fromHex(atRest["recording_key"] as string));
    const invitation = makePairingInvitation(mac.publicKeys, "Lana Desktop 01", new Date("2026-11-02T09:00:00.000Z"));
    const numbers = Array.from({ length: 500 }, (_, index) => (index % 2 === 0 ? Math.random() * 10 ** ((index % 40) - 20) : Math.round(Math.random() * 1e6) / 100));
    const vectors = {
      signatures: messages.map((message) => ({ message: toHex(message), signature: toHex(phone.sign(message)), signer: "phone" })),
      mac_signature: { message: toHex(utf8("mac")), signature: toHex(mac.sign(utf8("mac"))) },
      receipt_json: canonicalString(encodeReceipt(issueReceipt(manifest, mac, new Date("2026-11-02T09:30:00.123Z")))),
      hpke: { info: toHex(hpkeInfo), aad: toHex(utf8("aad")), plaintext: toHex(hpkePlaintext), enc: toHex(envelope.encapsulatedKey), ct: toHex(envelope.ciphertext) },
      atrest: {
        wrapped: toHex(aesKeyWrap(fromHex(atRest["master"] as string), recording.key)),
        context: "desktop/segment/1",
        plaintext: toHex(utf8("desktop sealed audio")),
        sealed: toHex(recording.seal(utf8("desktop sealed audio"), "desktop/segment/1")),
      },
      frames: [
        encodeFrame({ message: { type: "hello", payload: { protocolVersion: 1, deviceID: mac.publicKeys.deviceID, appVersion: "desktop 0.1" } }, body: new Uint8Array() }),
        encodeFrame({ message: { type: "receipt", payload: issueReceipt(manifest, mac, new Date("2026-11-02T09:31:00.000Z")) }, body: new Uint8Array() }),
        encodeFrame({ message: { type: "part", payload: { bundleID: manifest.bundleID, index: 2 } }, body: utf8("part body") }),
        encodeFrame({ message: { type: "pair_complete", payload: mac.publicKeys }, body: new Uint8Array() }),
      ].map(toBase64),
      meeting_json: canonicalString(encodeMeeting(tsMeeting())),
      numbers_json: canonicalString(numbers),
      ids: ["intent", "meeting", "bundle", "device", "audit", "segment"].map((kind) => makeLanaId(kind as "intent")),
      pairing: { qr: invitationQrString(invitation), short_code: shortCode(invitation, phone.publicKeys) },
    };
    mkdirSync(dirname(target as string), { recursive: true });
    writeFileSync(target as string, JSON.stringify(vectors, null, 2));
    expect(vectors.frames).toHaveLength(4);
  });
});
