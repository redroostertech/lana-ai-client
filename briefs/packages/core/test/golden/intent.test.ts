import { describe, expect, it } from "vitest";
import { sha256Hex } from "../../src/crypto/digest.js";
import { utf8 } from "../../src/bytes/utf8.js";
import { decodeIntent, decodeMeeting, describeIssue, encodeIntent, encodeMeeting, makeIdempotencyKey, makeIntent, validateIntent } from "../../src/intent/index.js";
import { canonicalString, parseJson } from "../../src/json/index.js";
import { golden } from "./fixtures.js";

describe("MeetingRecord round-trips byte for byte", () => {
  const fixture = golden<Record<string, string>>("meeting");

  it("re-encodes the Swift canonical meeting identically", () => {
    const canonical = fixture["canonical"] as string;
    const meeting = decodeMeeting(parseJson(canonical));
    expect(canonicalString(encodeMeeting(meeting))).toBe(canonical);
    expect(sha256Hex(utf8(canonical))).toBe(fixture["sha256"]);
    expect(meeting.clips).toHaveLength(2);
    expect(meeting.userNotes).toHaveLength(2);
  });

  it("defaults user_notes and clips for older phones like Swift", () => {
    const meeting = decodeMeeting(parseJson(fixture["without_user_notes_and_clips"] as string));
    expect(canonicalString(encodeMeeting(meeting))).toBe(fixture["without_user_notes_and_clips_reencoded"]);
  });
});

describe("Intent and IntentValidator match Swift", () => {
  const fixture = golden<{
    intents: { canonical: string; idempotency_key: string; issues: string[] }[];
    validator_cases: { canonical: string; issues: string[] }[];
  }>("intent");

  it("re-encodes intents, recomputes idempotency keys and finds no issues in valid ones", () => {
    for (const { canonical, idempotency_key, issues } of fixture.intents) {
      const intent = decodeIntent(parseJson(canonical));
      expect(canonicalString(encodeIntent(intent))).toBe(canonical);
      expect(makeIdempotencyKey(intent.meetingID, intent.params)).toBe(idempotency_key);
      expect(validateIntent(intent).map(describeIssue)).toEqual(issues);
    }
  });

  it("reports the same issues, in the same order, for every invalid case", () => {
    expect(fixture.validator_cases.length).toBeGreaterThan(20);
    for (const { canonical, issues } of fixture.validator_cases) {
      const intent = decodeIntent(parseJson(canonical));
      expect(canonicalString(encodeIntent(intent))).toBe(canonical);
      expect(validateIntent(intent).map(describeIssue)).toEqual(issues);
    }
  });

  it("builds an intent whose canonical form matches the Swift initializer", () => {
    const swift = decodeIntent(parseJson(fixture.intents[0]?.canonical as string));
    const built = makeIntent({ id: swift.id, meetingID: swift.meetingID, params: swift.params, confidence: swift.confidence, evidence: swift.evidence, createdAt: swift.createdAt });
    expect(canonicalString(encodeIntent(built))).toBe(fixture.intents[0]?.canonical);
  });
});
