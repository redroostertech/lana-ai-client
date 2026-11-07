import { describe, expect, it } from "vitest";
import { fromBase64, fromHex, toBase64, toHex } from "../../src/bytes/index.js";
import { encodeMeeting } from "../../src/intent/index.js";
import { canonicalString, parseJson } from "../../src/json/index.js";
import {
  attestationSignedBytes, bundleHpkeInfo, decodeManifest, decodeMessage, decodeReceipt, encodeFrame, encodeManifest, encodeMessage, encodeReceipt,
  FrameDecoder, HandoffError, issueReceipt, manifestHashHex, manifestSignedBytes, MAX_BODY_BYTES, MAX_HEADER_BYTES, openBundle, partAad,
  receiptSignedBytes, verifyManifest, verifyReceipt, type AttestationMethod,
} from "../../src/handoff/index.js";
import { golden } from "./fixtures.js";
import { goldenIdentities } from "../support/goldenIdentities.js";

const { mac, phone } = goldenIdentities();
const bytes = (base64: string): Uint8Array => fromBase64(base64) as Uint8Array;

describe("frames match Swift", () => {
  const fixture = golden<{
    frames: { kind: string; frame: string; header: string; body: string }[];
    max_header_bytes: number;
    max_body_bytes: number;
    attestation_signed_bytes: { session: string; nonce: string; binding: string; method: AttestationMethod; bytes: string };
  }>("frames");

  it("covers every message kind and re-encodes each frame byte for byte", () => {
    expect(new Set(fixture.frames.map((frame) => frame.kind)).size).toBe(17);
    for (const { kind, frame, header, body } of fixture.frames) {
      const message = decodeMessage(parseJson(header));
      expect(message.type).toBe(kind);
      expect(canonicalString(encodeMessage(message))).toBe(header);
      expect(toBase64(encodeFrame({ message, body: bytes(body) }))).toBe(frame);
    }
  });

  it("decodes a stream fed in uneven chunks", () => {
    const stream = Buffer.concat(fixture.frames.map(({ frame }) => bytes(frame)));
    const decoder = new FrameDecoder();
    const decoded: string[] = [];
    for (let offset = 0; offset < stream.length; offset += 7) {
      decoder.append(stream.subarray(offset, offset + 7));
      for (let frame = decoder.next(); frame !== undefined; frame = decoder.next()) decoded.push(toBase64(encodeFrame(frame)));
    }
    expect(decoded).toEqual(fixture.frames.map(({ frame }) => frame));
  });

  it("enforces the same limits and rejects malformed headers", () => {
    expect(MAX_HEADER_BYTES).toBe(fixture.max_header_bytes);
    expect(MAX_BODY_BYTES).toBe(fixture.max_body_bytes);
    const oversized = new FrameDecoder();
    oversized.append(Uint8Array.of(0x00, 0x04, 0x00, 0x01));
    expect(() => oversized.next()).toThrow(HandoffError);
    const garbage = new FrameDecoder();
    garbage.append(Uint8Array.of(0, 0, 0, 2, 0x7b, 0x7d, 0, 0, 0, 0));
    expect(() => garbage.next()).toThrow(expect.objectContaining({ code: "malformed_frame" }));
    expect(() => encodeFrame({ message: { type: "done" }, body: new Uint8Array(MAX_BODY_BYTES + 1) })).toThrow(HandoffError);
  });

  it("builds the same attestation bytes", () => {
    const vector = fixture.attestation_signed_bytes;
    expect(toHex(attestationSignedBytes(vector.session, fromHex(vector.nonce), fromHex(vector.binding), vector.method))).toBe(vector.bytes);
  });
});

describe("a bundle sealed by the Swift phone opens on the desktop", () => {
  const fixture = golden<Record<string, unknown>>("bundle");
  const manifest = decodeManifest(parseJson(fixture["manifest_json"] as string));
  const parts = (fixture["parts"] as string[]).map(bytes);
  const plaintexts = (fixture["plaintexts"] as string[]).map(bytes);

  it("re-encodes the manifest, its signed bytes and its hash", () => {
    expect(canonicalString(encodeManifest(manifest))).toBe(fixture["manifest_json"]);
    expect(Buffer.from(manifestSignedBytes(manifest)).toString("utf8")).toBe(fixture["manifest_signed_bytes"]);
    expect(manifestHashHex(manifest)).toBe(fixture["manifest_hash"]);
    expect(Buffer.from(bundleHpkeInfo(manifest.bundleID, manifest.macDeviceID)).toString("utf8")).toBe(fixture["hpke_info"]);
    expect(manifest.parts.map((part) => Buffer.from(partAad(manifest.bundleID, part.index, manifest.parts.length, part.name)).toString("utf8"))).toEqual(fixture["part_aads"]);
  });

  it("verifies the phone's manifest signature and refuses the wrong peers", () => {
    expect(() => verifyManifest(manifest, phone.publicKeys, mac.publicKeys)).not.toThrow();
    expect(() => verifyManifest(manifest, mac.publicKeys, mac.publicKeys)).toThrow(HandoffError);
    expect(() => verifyManifest(manifest, phone.publicKeys, phone.publicKeys)).toThrow(expect.objectContaining({ detail: "bundle addressed to another Mac" }));
    const forged = { ...manifest, createdAt: new Date(manifest.createdAt.getTime() + 1) };
    expect(() => verifyManifest(forged, phone.publicKeys, mac.publicKeys)).toThrow(expect.objectContaining({ detail: "bad manifest signature" }));
  });

  it("opens the HPKE envelope, decrypts every part and decodes the meeting", async () => {
    const opened = await openBundle(manifest, parts, mac);
    expect(opened.audio.map((part) => toHex(part.data))).toEqual(plaintexts.slice(1).map(toHex));
    expect(opened.rejectedIntents).toHaveLength(0);
    expect(canonicalString(encodeMeeting(opened.meeting))).toBe(Buffer.from(plaintexts[0] as Uint8Array).toString("utf8"));
  });

  it("rejects a corrupted part before decrypting", async () => {
    const corrupted = parts.map((part) => part.slice());
    const audio = corrupted[1] as Uint8Array;
    audio[0] = (audio[0] ?? 0) ^ 1;
    await expect(openBundle(manifest, corrupted, mac)).rejects.toThrow(expect.objectContaining({ detail: "part 1 hash mismatch" }));
    await expect(openBundle(manifest, parts.slice(1), mac)).rejects.toThrow(HandoffError);
  });

  it("verifies the Swift receipt and issues receipts the phone will accept", () => {
    const receipt = decodeReceipt(parseJson(fixture["receipt_json"] as string));
    expect(canonicalString(encodeReceipt(receipt))).toBe(fixture["receipt_json"]);
    expect(Buffer.from(receiptSignedBytes(receipt)).toString("utf8")).toBe(fixture["receipt_signed_bytes"]);
    expect(verifyReceipt(receipt, manifest, mac.publicKeys)).toBe(true);
    expect(verifyReceipt(receipt, manifest, phone.publicKeys)).toBe(false);
    const ours = issueReceipt(manifest, mac, new Date("2026-11-01T16:04:28.000Z"));
    expect(verifyReceipt(ours, manifest, mac.publicKeys)).toBe(true);
    expect(verifyReceipt({ ...ours, manifestHash: "00" }, manifest, mac.publicKeys)).toBe(false);
  });
});

describe("messages", () => {
  it("rejects unknown types and accepts done without a payload", () => {
    expect(() => decodeMessage(parseJson('{"type":"teleport","payload":{}}'))).toThrow();
    expect(decodeMessage(parseJson('{"type":"done"}'))).toEqual({ type: "done" });
    expect(canonicalString(encodeMessage({ type: "done" }))).toBe('{"payload":{},"type":"done"}');
  });
});
