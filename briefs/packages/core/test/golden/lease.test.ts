import { describe, expect, it } from "vitest";
import { fromBase64, fromHex, toBase64 } from "../../src/bytes/index.js";
import { fromUtf8 } from "../../src/bytes/utf8.js";
import { proximityServiceUuid, wakeServiceUuid } from "../../src/crypto/index.js";
import { canonicalString, LanaDate, parseJson } from "../../src/json/index.js";
import {
  BACKGROUND_LEASE_SCHEMA, backgroundLeaseSignedBytes, checkLeaseSession, decodeBackgroundLease, decodeLeaseSession, decodeMessage, encodeBackgroundLease, encodeFrame,
  encodeLeaseSession, encodeMessage, FrameDecoder, HANDOFF_BACKGROUND_LEASE_VERSION, issueBackgroundLease, leaseSessionSignedBytes,
} from "../../src/handoff/index.js";
import { golden } from "./fixtures.js";
import { goldenIdentities } from "../support/goldenIdentities.js";

const fixture = golden<{
  session_id: string;
  lease_json: string;
  lease_signed_bytes: string;
  session_json: string;
  session_signed_bytes: string;
  frames: { kind: string; frame: string; header: string }[];
  wake_psk_hex: string;
  wake: { at: string; uuid: string }[];
  presence_uuid: string;
}>("lease");

const text = (value: string) => new TextEncoder().encode(value);

describe("protocol 5 (background leases) matches Swift", () => {
  const { mac, phone } = goldenIdentities();

  it("re-encodes every lease frame byte for byte", () => {
    expect(fixture.frames.map((frame) => frame.kind)).toEqual(["hello", "challenge", "lease_session", "lease_accepted", "background_lease", "background_lease"]);
    const decoder = new FrameDecoder();
    decoder.append(Buffer.concat(fixture.frames.map(({ frame }) => fromBase64(frame) as Uint8Array)));
    for (const { kind, frame, header } of fixture.frames) {
      const decoded = decoder.next();
      expect(decoded?.message.type).toBe(kind);
      const message = decodeMessage(parseJson(text(header)));
      expect(canonicalString(encodeMessage(message))).toBe(header);
      expect(toBase64(encodeFrame({ message, body: decoded?.body ?? new Uint8Array() }))).toBe(frame);
    }
    const hello = decodeMessage(parseJson(text(fixture.frames[0]?.header ?? "")));
    expect(hello.type === "hello" ? hello.payload.maxProtocolVersion : null).toBe(HANDOFF_BACKGROUND_LEASE_VERSION);
    expect(fixture.frames[5]?.header).toBe('{"payload":{},"type":"background_lease"}');
  });

  it("verifies the Swift lease and presentation, and signs the same bytes", () => {
    const lease = decodeBackgroundLease(parseJson(text(fixture.lease_json)));
    expect(canonicalString(encodeBackgroundLease(lease))).toBe(fixture.lease_json);
    expect(fromUtf8(backgroundLeaseSignedBytes(lease))).toBe(fixture.lease_signed_bytes);
    expect(lease).toMatchObject({ schema: BACKGROUND_LEASE_SCHEMA, macDeviceID: mac.publicKeys.deviceID, phoneDeviceID: phone.publicKeys.deviceID });
    const session = decodeLeaseSession(parseJson(text(fixture.session_json)));
    expect(canonicalString(encodeLeaseSession(session))).toBe(fixture.session_json);
    expect(fromUtf8(leaseSessionSignedBytes(session))).toBe(fixture.session_signed_bytes);
    const at = new Date(lease.issuedAt.getTime() + 3_600_000);
    expect(checkLeaseSession(session, { sessionID: fixture.session_id, mac: mac.publicKeys, phone: phone.publicKeys, now: at })).toBeNull();
    expect(checkLeaseSession(session, { sessionID: "another", mac: mac.publicKeys, phone: phone.publicKeys, now: at })).toBe("invalid");
    expect(checkLeaseSession(session, { sessionID: fixture.session_id, mac: mac.publicKeys, phone: phone.publicKeys, now: lease.expiresAt })).toBe("expired");
    // TypeScript issues the same unsigned lease for the same inputs.
    const ours = issueBackgroundLease({ phone: phone.publicKeys, mac, at: lease.issuedAt, durationMs: lease.expiresAt.getTime() - lease.issuedAt.getTime() });
    expect(fromUtf8(backgroundLeaseSignedBytes(ours))).toBe(fixture.lease_signed_bytes);
  });

  it("derives the same daily wake UUIDs and presence UUID", () => {
    const psk = fromHex(fixture.wake_psk_hex);
    for (const { at, uuid } of fixture.wake) expect(wakeServiceUuid(psk, new Date(LanaDate.parseMilliseconds(at) as number))).toBe(uuid);
    expect(proximityServiceUuid(psk)).toBe(fixture.presence_uuid);
  });
});
