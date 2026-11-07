import { describe, expect, it } from "vitest";
import { fromBase64, toBase64 } from "../../src/bytes/index.js";
import { fromUtf8 } from "../../src/bytes/utf8.js";
import { canonicalString, parseJson } from "../../src/json/index.js";
import {
  decodeMessage, decodeSyncSnooze, encodeFrame, encodeMessage, encodeSyncSnooze, FrameDecoder, HANDOFF_SNOOZE_VERSION, SYNC_SNOOZE_SCHEMA,
  syncSnoozeSignedBytes, verifySyncSnooze,
} from "../../src/handoff/index.js";
import { golden } from "./fixtures.js";
import { goldenIdentities } from "../support/goldenIdentities.js";

const fixture = golden<{
  session_id: string;
  snooze_json: string;
  signed_bytes: string;
  frames: { kind: string; frame: string; header: string }[];
}>("snooze");

describe("protocol 4 (sync_snooze) matches Swift", () => {
  const { mac, phone } = goldenIdentities();

  it("re-encodes the hello, challenge and snooze frames byte for byte", () => {
    expect(fixture.frames.map((frame) => frame.kind)).toEqual(["hello", "challenge", "sync_snooze"]);
    const decoder = new FrameDecoder();
    decoder.append(Buffer.concat(fixture.frames.map(({ frame }) => fromBase64(frame) as Uint8Array)));
    for (const { kind, frame, header } of fixture.frames) {
      const decoded = decoder.next();
      expect(decoded?.message.type).toBe(kind);
      const message = decodeMessage(parseJson(new TextEncoder().encode(header)));
      expect(canonicalString(encodeMessage(message))).toBe(header);
      expect(toBase64(encodeFrame({ message, body: decoded?.body ?? new Uint8Array() }))).toBe(frame);
    }
    const hello = decodeMessage(parseJson(new TextEncoder().encode(fixture.frames[0]?.header ?? "")));
    expect(hello.type === "hello" ? hello.payload.maxProtocolVersion : null).toBe(HANDOFF_SNOOZE_VERSION);
  });

  it("checks the Swift phone's signed snooze", () => {
    const snooze = decodeSyncSnooze(parseJson(new TextEncoder().encode(fixture.snooze_json)));
    expect(canonicalString(encodeSyncSnooze(snooze))).toBe(fixture.snooze_json);
    expect(fromUtf8(syncSnoozeSignedBytes(snooze))).toBe(fixture.signed_bytes);
    expect(snooze).toMatchObject({ schema: SYNC_SNOOZE_SCHEMA, sessionID: fixture.session_id, macDeviceID: mac.publicKeys.deviceID, phoneDeviceID: phone.publicKeys.deviceID });
    expect(verifySyncSnooze(snooze, fixture.session_id, mac.publicKeys.deviceID, phone.publicKeys)).toBe(true);
    expect(verifySyncSnooze(snooze, "another session", mac.publicKeys.deviceID, phone.publicKeys)).toBe(false);
    expect(verifySyncSnooze(snooze, fixture.session_id, mac.publicKeys.deviceID, mac.publicKeys)).toBe(false);
    expect(verifySyncSnooze({ ...snooze, wakeNonce: "ffffffffffffffff" }, fixture.session_id, mac.publicKeys.deviceID, phone.publicKeys)).toBe(false);
  });
});
