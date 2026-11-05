import { describe, expect, it } from "vitest";
import { fromBase64, toBase64 } from "../../src/bytes/index.js";
import {
  contentHash, decodeMeeting, encodeMeeting, mergeRecords, reconcileRecords, recordUnits, resolveUnit, stampRecord,
  type MeetingRecord, type RecordSide,
} from "../../src/intent/index.js";
import { canonicalString, parseJson, type JsonValue } from "../../src/json/index.js";
import {
  accountInfoHpkeInfo, accountInfoSignedBytes, decodeAccountInfoUpdate, encodeAccountInfo, encodeAccountInfoUpdate, openAccountInfoUpdate,
  decodeMessage, decodeRecordAck, decodeRecordUpdate, encodeFrame, encodeMessage, encodeRecordAck, encodeRecordUpdate, FrameDecoder,
  openRecordUpdate, recordAckSignedBytes, recordUpdateHpkeInfo, recordUpdatePartAad, recordUpdateSignedBytes, verifyRecordAck,
  decodeRecordDecline, encodeRecordDecline, RECORD_DECLINE_SCHEMA, recordDeclineSignedBytes, verifyRecordDecline,
} from "../../src/handoff/index.js";
import { fromUtf8 } from "../../src/bytes/utf8.js";
import { golden } from "./fixtures.js";
import { goldenIdentities } from "../support/goldenIdentities.js";

interface MergeCase {
  name: string;
  phone: string;
  desktop: string;
  merged: string;
  merged_hash: string;
  reconciled_on_phone: string;
  reconciled_on_desktop: string;
}

const fixture = golden<{
  base: string;
  base_hash: string;
  units: Record<string, string>;
  merges: MergeCase[];
  stamps: { old: string; new: string; side: RecordSide; stamped: string }[];
  resolves: { record: string; unit: string; value: string; side: RecordSide; result: string }[];
  frames: { kind: string; frame: string; header: string }[];
  update: {
    update_json: string; signed_bytes: string; parts: string[]; record_json: string; audio: string[]; hpke_info: string; part_aads: string[];
    ack_json: string; ack_signed_bytes: string;
    /** `sync_decline`, signed by the golden phone for the same update. */
    decline_json?: string; decline_signed_bytes?: string;
  };
  /** Protocol 3: account info sealed by the golden Mac for the golden phone. */
  account?: { update_json: string; signed_bytes: string; hpke_info: string; account_json: string; frame: string; header: string };
}>("sync");

const record = (json: string): MeetingRecord => decodeMeeting(parseJson(json));
const encode = (value: MeetingRecord): string => canonicalString(encodeMeeting(value));
const bytes = (base64: string): Uint8Array => fromBase64(base64) as Uint8Array;

describe("shared meeting record matches Swift", () => {
  it("re-encodes a shared record, its units and its content hash byte for byte", () => {
    const base = record(fixture.base);
    expect(encode(base)).toBe(fixture.base);
    expect(contentHash(base)).toBe(fixture.base_hash);
    expect(Object.fromEntries(recordUnits(base))).toEqual(fixture.units);
  });

  it.each(fixture.merges.map((entry) => [entry.name, entry] as const))("merges %s the same way on both sides", (_name, entry) => {
    const phone = record(entry.phone);
    const desktop = record(entry.desktop);
    const merged = mergeRecords(phone, desktop);
    expect(encode(merged)).toBe(entry.merged);
    expect(contentHash(merged)).toBe(entry.merged_hash);
    expect(encode(reconcileRecords(phone, desktop, "phone"))).toBe(entry.reconciled_on_phone);
    expect(encode(reconcileRecords(desktop, phone, "desktop"))).toBe(entry.reconciled_on_desktop);
  });

  it("stamps edits like Swift", () => {
    for (const entry of fixture.stamps) {
      expect(encode(stampRecord(record(entry.old), record(entry.new), entry.side))).toBe(entry.stamped);
    }
  });

  it("applies a reconcile choice like Swift", () => {
    for (const entry of fixture.resolves) {
      expect(encode(resolveUnit(record(entry.record), entry.unit, parseJson(new TextEncoder().encode(entry.value)) as JsonValue, entry.side))).toBe(entry.result);
    }
  });
});

describe("protocol 2 matches Swift", () => {
  const { mac, phone } = goldenIdentities();

  it("re-encodes every new frame byte for byte", () => {
    expect(fixture.frames.map((frame) => frame.kind)).toEqual(["hello", "challenge", "sync_request", "sync_update", "sync_part", "sync_ack", "sync_done", "sync_decline"]);
    const stream = Buffer.concat(fixture.frames.map(({ frame }) => bytes(frame)));
    const decoder = new FrameDecoder();
    decoder.append(stream);
    for (const { kind, frame, header } of fixture.frames) {
      const decoded = decoder.next();
      expect(decoded?.message.type).toBe(kind);
      const message = decodeMessage(parseJson(new TextEncoder().encode(header)));
      expect(canonicalString(encodeMessage(message))).toBe(header);
      expect(toBase64(encodeFrame({ message, body: decoded?.body ?? new Uint8Array() }))).toBe(frame);
    }
  });

  it("verifies and opens the Swift Mac's record update with the phone key, and checks the ack", async () => {
    const vector = fixture.update;
    const update = decodeRecordUpdate(parseJson(new TextEncoder().encode(vector.update_json)));
    expect(canonicalString(encodeRecordUpdate(update))).toBe(vector.update_json);
    expect(fromUtf8(recordUpdateSignedBytes(update))).toBe(vector.signed_bytes);
    expect(fromUtf8(recordUpdateHpkeInfo(update.updateID, update.phoneDeviceID))).toBe(vector.hpke_info);
    expect(update.parts.map((part) => fromUtf8(recordUpdatePartAad(update.updateID, update.meetingID, update.revision, part.index, part.name)))).toEqual(vector.part_aads);
    const opened = await openRecordUpdate(update, vector.parts.map(bytes), phone, mac.publicKeys);
    expect(encode(opened.record)).toBe(vector.record_json);
    expect(opened.audio.map((part) => toBase64(part.data))).toEqual(vector.audio);
    await expect(openRecordUpdate(update, vector.parts.map(bytes), mac, mac.publicKeys)).rejects.toThrow();

    const ack = decodeRecordAck(parseJson(new TextEncoder().encode(vector.ack_json)));
    expect(canonicalString(encodeRecordAck(ack))).toBe(vector.ack_json);
    expect(fromUtf8(recordAckSignedBytes(ack))).toBe(vector.ack_signed_bytes);
    expect(verifyRecordAck(ack, update, phone.publicKeys)).toBe(true);
    expect(verifyRecordAck(ack, update, mac.publicKeys)).toBe(false);
  });

  it("checks the Swift phone's signed decline of the record update", () => {
    const vector = fixture.update;
    const update = decodeRecordUpdate(parseJson(new TextEncoder().encode(vector.update_json)));
    const decline = decodeRecordDecline(parseJson(new TextEncoder().encode(vector.decline_json ?? "")));
    expect(canonicalString(encodeRecordDecline(decline))).toBe(vector.decline_json);
    expect(fromUtf8(recordDeclineSignedBytes(decline))).toBe(vector.decline_signed_bytes);
    expect(decline).toMatchObject({ schema: RECORD_DECLINE_SCHEMA, reason: "declined", updateID: update.updateID, meetingID: update.meetingID });
    expect(verifyRecordDecline(decline, update, phone.publicKeys)).toBe(true);
    expect(verifyRecordDecline(decline, update, mac.publicKeys)).toBe(false);
    expect(verifyRecordDecline({ ...decline, reason: "later" }, update, phone.publicKeys)).toBe(false);
    expect(verifyRecordDecline(decline, { ...update, meetingID: update.phoneDeviceID }, phone.publicKeys)).toBe(false);
    const frame = fixture.frames.find((item) => item.kind === "sync_decline");
    const message = decodeMessage(parseJson(new TextEncoder().encode(frame?.header ?? "")));
    expect(message.type === "sync_decline" ? canonicalString(encodeRecordDecline(message.payload)) : null).toBe(vector.decline_json);
  });

  it.runIf(fixture.account !== undefined)("verifies and opens the Swift Mac's account info with the phone key", async () => {
    const vector = fixture.account as NonNullable<typeof fixture.account>;
    const update = decodeAccountInfoUpdate(parseJson(new TextEncoder().encode(vector.update_json)));
    expect(canonicalString(encodeAccountInfoUpdate(update))).toBe(vector.update_json);
    expect(fromUtf8(accountInfoSignedBytes(update))).toBe(vector.signed_bytes);
    expect(fromUtf8(accountInfoHpkeInfo(update.updateID, update.phoneDeviceID))).toBe(vector.hpke_info);
    const account = await openAccountInfoUpdate(update, phone, mac.publicKeys);
    expect(canonicalString(encodeAccountInfo(account))).toBe(vector.account_json);
    await expect(openAccountInfoUpdate(update, mac, mac.publicKeys)).rejects.toThrow();

    const message = decodeMessage(parseJson(new TextEncoder().encode(vector.header)));
    expect(message.type).toBe("account_info");
    expect(canonicalString(encodeMessage(message))).toBe(vector.header);
    expect(toBase64(encodeFrame({ message, body: new Uint8Array() }))).toBe(vector.frame);
    const decoder = new FrameDecoder();
    decoder.append(bytes(vector.frame));
    expect(decoder.next()?.message.type).toBe("account_info");
  });
});
