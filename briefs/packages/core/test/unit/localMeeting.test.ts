import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { issueRecordAck, MacHandoffSession, MemoryFrameChannel, openRecordUpdate, type HandoffMessage, type RecordUpdate } from "../../src/handoff/index.js";
import { makeLanaId } from "../../src/ids/index.js";
import { contentHash, makeIntent } from "../../src/intent/index.js";
import { audioParts, localMeetingRecord } from "../../src/recording/index.js";
import { Database } from "../../src/store/database.js";
import { GATEWAY_MIGRATIONS, migrate } from "../../src/store/gatewaySchema.js";
import { goldenIdentities } from "../support/goldenIdentities.js";
import { Air, FakeClock, FakePresenter, runScriptedPhone } from "../support/handoffFakes.js";
import { openRig, type StoreRig } from "../support/storeRig.js";

const { mac, phone } = goldenIdentities();

function record(rig: StoreRig) {
  return localMeetingRecord({
    id: makeLanaId("meeting", rig.clock.now()),
    title: "Client intake",
    startedAt: rig.clock.now(),
    durationSeconds: 250.5,
    consent: { method: "verbal_announced", confirmedBy: [], confirmedAt: rig.clock.now() },
    userNotes: [],
    appVersion: "0.1.0",
    speakers: [{ id: "S1" }, { id: "S2" }],
    transcript: [{ speaker: "S1", start: 0, end: 2, text: "Thanks for joining." }, { speaker: "S2", start: 3, end: 5, text: "Happy to be here." }],
  });
}

/** 250 s of fake AAC frames: three stored parts (120 s each). */
const frames = Array.from({ length: 11_720 }, (_, index) => new Uint8Array([index & 0xff, 1, 2]));

let rig: StoreRig;
beforeEach(async () => {
  rig = await openRig();
});
afterEach(() => rig.cleanup());

describe("store migration v5_local_meetings", () => {
  it("keeps every handed-off meeting, its audio and its actions when the table is rebuilt", () => {
    const db = new Database(":memory:");
    migrate(db, GATEWAY_MIGRATIONS.slice(0, 4));
    db.run("INSERT INTO paired_device VALUES ('dev_1', 'Phone', x'00', x'00', x'00', '2026-01-01T00:00:00.000Z', NULL)");
    db.run("INSERT INTO meeting VALUES ('mtg_1', 'bnd_1', 'dev_1', '2026-01-01T00:00:00.000Z', 60, '2026-01-01T00:00:00.000Z', 'acoustic', 300, x'00')");
    db.run("INSERT INTO meeting_audio VALUES ('mtg_1', 0, 'audio/seg-0000.m4a', 'mtg_1-0.bin', 10, NULL)");
    db.run("INSERT INTO intent (id, meeting_id, type, status, idempotency_key, sealed_intent, updated_at) VALUES ('int_1', 'mtg_1', 'task.create', 'transferred', 'k', x'00', '2026-01-01T00:00:00.000Z')");
    db.run("INSERT INTO ask_thread VALUES ('ask_1', 'mtg_1', x'00', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')");
    expect(migrate(db)).toEqual(["v5_local_meetings"]);
    expect(db.get("SELECT phone_device_id, origin, attestation_method FROM meeting")).toEqual({ phone_device_id: "dev_1", origin: "phone", attestation_method: "acoustic" });
    expect(db.get("SELECT COUNT(*) AS n FROM intent")?.["n"]).toBe(1);
    expect(db.get("SELECT COUNT(*) AS n FROM meeting_audio")?.["n"]).toBe(1);
    expect(db.get("SELECT COUNT(*) AS n FROM ask_thread")?.["n"]).toBe(1);
    expect(db.all("PRAGMA foreign_key_check")).toEqual([]);
    // Foreign keys are back on: deleting the meeting still cascades to its audio and actions.
    db.run("DELETE FROM meeting WHERE id = 'mtg_1'");
    expect(db.get("SELECT COUNT(*) AS n FROM intent")?.["n"]).toBe(0);
    // Origin and phone must agree.
    expect(() => db.run("INSERT INTO meeting (id, bundle_id, phone_device_id, started_at, duration_seconds, received_at, attestation_method, attestation_latency_ms, sealed_record, origin) VALUES ('mtg_2', 'b2', NULL, 'x', 1, 'x', 'none', 0, x'00', 'phone')")).toThrow();
    expect(() => db.run("INSERT INTO meeting (id, bundle_id, phone_device_id, started_at, duration_seconds, received_at, attestation_method, attestation_latency_ms, sealed_record, origin) VALUES ('mtg_3', 'b3', 'dev_1', 'x', 1, 'x', 'none', 0, x'00', 'computer')")).toThrow();
    db.close();
  });
});

describe("meetings recorded on this computer", () => {
  it("are stored with their audio, listed as recorded here, and readable as a shared record", async () => {
    const meeting = record(rig);
    const parts = audioParts(frames);
    expect(parts.map((part) => part.name)).toEqual(["audio/seg-0000.m4a", "audio/seg-0001.m4a", "audio/seg-0002.m4a"]);
    rig.store.local.insert(meeting, parts);

    const [summary] = rig.store.meetings.list();
    expect(summary).toMatchObject({ id: meeting.id, title: "Client intake", origin: "computer", audioAvailable: true, openIntents: 0 });
    expect(rig.store.meetings.audioParts(meeting.id).map((part) => part.byteCount)).toEqual(parts.map((part) => part.data.length));
    expect(rig.store.meetings.audioData(meeting.id, 1)).toEqual(parts[1]!.data);
    expect(rig.store.local.isLocal(meeting.id)).toBe(true);
    const current = rig.store.shared.current(meeting.id);
    expect(current.transcript).toEqual(meeting.transcript);
    expect(current.provenance.asrModel).toBe("parakeet-tdt-0.6b-v2-int8");
    expect(rig.store.shared.isSharedWith(meeting.id, phone.publicKeys.deviceID)).toBe(false);
    expect(rig.store.shared.lastSynced(meeting.id).size).toBe(0);
    const events = (await rig.store.auditEntries()).map((entry) => [entry.event, JSON.parse(entry.detail) as unknown]);
    expect(events).toContainEqual(["meeting.recorded", { audio_parts: "3", consent: "verbal_announced" }]);
    expect(() => rig.store.local.insert(meeting, parts)).toThrow();
  });

  it("take notes and actions later, which land in the Inbox", () => {
    const meeting = record(rig);
    rig.store.local.insert(meeting, audioParts(frames.slice(0, 10)));
    const action = makeIntent({ meetingID: meeting.id, params: { type: "task.create", task: { title: "Send the engagement letter", detail: "" } }, confidence: 0.7, evidence: [{ speaker: "S1", tStart: 0, tEnd: 2, quote: "Thanks for joining." }], createdAt: rig.clock.now() });
    const notes = { keyPoints: [{ id: "kp-1", kind: "summary" as const, text: "Intake call.", sources: [{ start: 0, end: 5 }], precision: "exact" as const }], gaps: [] };
    expect(rig.store.local.applyNotes(meeting.id, notes, [action], "qwen")).toHaveLength(1);
    const current = rig.store.shared.current(meeting.id);
    expect(current.notes.keyPoints.map((point) => point.text)).toEqual(["Intake call."]);
    expect(current.intents.map((intent) => [intent.id, intent.status])).toEqual([[action.id, "transferred"]]);
    expect(current.provenance.notesModel).toBe("qwen");
    expect(rig.store.meetings.list()[0]?.openIntents).toBe(1);
  });

  it("go to a paired phone with Send to phone, audio parts included", async () => {
    await rig.store.pairDevice(phone.publicKeys, new Uint8Array(32).fill(7));
    const meeting = record(rig);
    const parts = audioParts(frames);
    rig.store.local.insert(meeting, parts);
    rig.store.shared.queueForPhone(meeting.id, phone.publicKeys.deviceID);

    let received: { record: Awaited<ReturnType<typeof openRecordUpdate>>["record"]; audio: { name: string; data: Uint8Array }[] } | null = null;
    const accept = async (update: RecordUpdate, sealed: Uint8Array[]): Promise<HandoffMessage> => {
      const opened = await openRecordUpdate(update, sealed, phone, mac.publicKeys);
      received = opened;
      return { type: "sync_ack", payload: issueRecordAck(update, opened.record, phone, new Date("2026-11-01T16:00:00.000Z")) };
    };
    const air = new Air();
    const presenter = new FakePresenter();
    const session = new MacHandoffSession({ identity: mac, trust: rig.store, tone: air, presenter, sink: rig.store, records: rig.store, clock: new FakeClock() });
    const { client, server } = MemoryFrameChannel.pair();
    const [macResult, phoneResult] = await Promise.allSettled([
      session.run(server),
      runScriptedPhone(client, { identity: phone, mac: mac.publicKeys, bundles: [], air, presenter, maxProtocolVersion: 2, answerUpdate: accept }),
    ]);
    expect(macResult.status).toBe("fulfilled");
    expect(phoneResult.status).toBe("fulfilled");
    expect(received).not.toBeNull();
    const got = received!;
    expect(got.record.id).toBe(meeting.id);
    expect(contentHash(got.record)).toBe(contentHash(rig.store.shared.current(meeting.id)));
    expect(got.audio.map((part) => part.name)).toEqual(parts.map((part) => part.name));
    expect(got.audio.map((part) => part.data)).toEqual(parts.map((part) => part.data));
    // Now shared with that phone, so its later edits merge.
    expect(rig.store.shared.isSharedWith(meeting.id, phone.publicKeys.deviceID)).toBe(true);
    expect(rig.store.shared.queue(phone.publicKeys.deviceID)).toEqual([]);
  });
});
