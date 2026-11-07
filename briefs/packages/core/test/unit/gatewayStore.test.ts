import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { toHex } from "../../src/bytes/index.js";
import { issueReceipt, openBundle, type OpenedBundle } from "../../src/handoff/index.js";
import { makeLanaId, type LanaId } from "../../src/ids/index.js";
import { encodeMeeting, makeIntent, type MeetingRecord } from "../../src/intent/index.js";
import { canonicalString, LanaDate } from "../../src/json/index.js";
import { InMemoryDataKeyProvider } from "../../src/keys/index.js";
import { AUDIT_EVENTS, GatewayStore, STORE_DATABASE_FILE, type AttestationRecord } from "../../src/store/index.js";
import { goldenIdentities } from "../support/goldenIdentities.js";
import { goldenBundle, openRig, type StoreRig } from "../support/storeRig.js";

const { mac, phone } = goldenIdentities();
const PSK = new Uint8Array(32).fill(7);

function attestation(): AttestationRecord {
  return { sessionID: "s1", phoneDeviceID: phone.publicKeys.deviceID, method: "acoustic", latencyMs: 420, attestedAt: new Date(1_800_000_000_000), tonePlays: 1 };
}

/** Raw access for the tests that play an attacker with the database file. */
function rawDatabase(rig: StoreRig): DatabaseSync {
  return new DatabaseSync(join(rig.directory, STORE_DATABASE_FILE));
}

async function receiveGoldenBundle(rig: StoreRig): Promise<OpenedBundle> {
  const { manifest, parts } = goldenBundle();
  for (const [index, part] of parts.entries()) await rig.store.storePart(manifest.bundleID, index, part);
  const opened = await openBundle(manifest, parts, mac);
  await rig.store.complete(opened, issueReceipt(manifest, mac, rig.clock.now()), attestation());
  return opened;
}

let rig: StoreRig;
beforeEach(async () => {
  rig = await openRig();
  await rig.store.pairDevice(phone.publicKeys, PSK);
});
afterEach(() => rig.cleanup());

describe("schema and migrations", () => {
  it("records every migration once and reopens without re-running them", async () => {
    const again = await rig.reopen();
    const db = rawDatabase(rig);
    expect(db.prepare("SELECT identifier FROM grdb_migrations ORDER BY rowid").all().map((row) => row["identifier"])).toEqual(["v1_core", "v2_ask_threads", "v3_action_inbox", "v4_action_seen", "v5_local_meetings"]);
    db.close();
    expect(await again.pairedDevices()).toHaveLength(1);
  });

  it("rejects edits and deletes of the audit log and intent history", async () => {
    const opened = await receiveGoldenBundle(rig);
    const db = rawDatabase(rig);
    try {
      expect(() => db.exec("UPDATE audit_log SET subject = 'x' WHERE seq = 1")).toThrow(/audit_log is append-only/);
      expect(() => db.exec("DELETE FROM audit_log WHERE seq = 1")).toThrow(/audit_log is append-only/);
      expect(() => db.exec("UPDATE intent_event SET actor = 'user'")).toThrow(/intent_event is append-only/);
      expect(() => db.exec("DELETE FROM intent_event")).toThrow(/intent_event is append-only/);
      // History goes only with its intent (cascade from the meeting), as in Swift.
      db.exec("PRAGMA foreign_keys = ON");
      db.prepare("DELETE FROM meeting WHERE id = ?").run(opened.meeting.id);
      expect(db.prepare("SELECT COUNT(*) AS n FROM intent_event").get()?.["n"]).toBe(0);
      expect(db.prepare("SELECT COUNT(*) AS n FROM audit_log").get()?.["n"]).toBeGreaterThan(0);
    } finally {
      db.close();
    }
  });

  it("rejects ledger rows with an unknown status", () => {
    const db = rawDatabase(rig);
    expect(() => db.exec("INSERT INTO idempotency_ledger (key, plan_hash, status, started_at) VALUES ('k', 'h', 'done', 'x')")).toThrow(/CHECK/);
    db.close();
  });
});

describe("audit chain in the store", () => {
  it("verifies, then finds the first tampered row when someone bypasses the triggers", async () => {
    await rig.store.appendAudit(AUDIT_EVENTS.connectorLinked, "clio", { account: "a1" });
    await rig.store.appendAudit(AUDIT_EVENTS.audioPurged, "retention", { days: "30" });
    expect(await rig.store.verifyAudit()).toEqual({ entries: 3, brokenAt: null, isIntact: true });
    const db = rawDatabase(rig);
    db.exec("DROP TRIGGER audit_append_only_update");
    db.exec("UPDATE audit_log SET detail = '{\"account\":\"a2\"}' WHERE seq = 2");
    db.close();
    expect(await rig.store.verifyAudit()).toEqual({ entries: 3, brokenAt: 2, isIntact: false });
    const exported = Buffer.from(await rig.store.exportAudit()).toString("utf8").trim().split("\n");
    expect(exported).toHaveLength(4);
    expect(JSON.parse(exported[3] as string)).toEqual({ entries: "3", head: (await rig.store.auditEntries()).at(-1)?.hash, intact: "false" });
  });

  it("pages entries after a sequence number", async () => {
    await rig.store.appendAudit(AUDIT_EVENTS.connectorLinked, "a");
    await rig.store.appendAudit(AUDIT_EVENTS.connectorLinked, "b");
    expect((await rig.store.auditEntries(1, 1)).map((entry) => entry.subject)).toEqual(["a"]);
  });
});

describe("bundles: resume, finalize and recall", () => {
  it("keeps staged parts across a restart and completes the bundle once", async () => {
    const { manifest, parts, plaintexts } = goldenBundle();
    await rig.store.storePart(manifest.bundleID, 0, parts[0] as Uint8Array);
    await rig.store.storePart(manifest.bundleID, 1, parts[1] as Uint8Array);

    const restarted = await rig.reopen();
    const staged = await restarted.storedParts(manifest.bundleID);
    expect([...staged.keys()].sort()).toEqual([0, 1]);
    expect(toHex(staged.get(1) as Uint8Array)).toBe(toHex(parts[1] as Uint8Array));
    expect(await restarted.existingReceipt(manifest.bundleID)).toBeNull();

    await restarted.storePart(manifest.bundleID, 2, parts[2] as Uint8Array);
    const all = await restarted.storedParts(manifest.bundleID);
    const opened = await openBundle(manifest, [0, 1, 2].map((index) => all.get(index) as Uint8Array), mac);
    const receipt = issueReceipt(manifest, mac, rig.clock.now());
    await restarted.complete(opened, receipt, attestation());

    expect((await restarted.storedParts(manifest.bundleID)).size).toBe(0);
    expect(await restarted.existingReceipt(manifest.bundleID)).toEqual(receipt);
    expect(restarted.meetings.audioParts(opened.meeting.id).map((part) => part.name)).toEqual(manifest.parts.slice(1).map((part) => part.name));
    expect(toHex(restarted.meetings.audioData(opened.meeting.id, 1))).toBe(toHex(plaintexts[2] as Uint8Array));
    await expect(restarted.complete(opened, receipt, attestation())).rejects.toThrow();
  });

  it("recalls meetings, records, clips and user notes", async () => {
    const opened = await receiveGoldenBundle(rig);
    const meeting = opened.meeting;
    const [summary] = rig.store.meetings.list();
    expect(summary).toMatchObject({ id: meeting.id, title: meeting.title, attestationMethod: "acoustic", audioAvailable: true, openIntents: meeting.intents.length });
    expect(canonicalString(encodeMeeting(rig.store.meetings.get(meeting.id)))).toBe(canonicalString(encodeMeeting(meeting)));
    expect(rig.store.meetings.clips(meeting.id)).toHaveLength(meeting.clips.length);
    expect(() => rig.store.meetings.get(makeLanaId("meeting"))).toThrow(expect.objectContaining({ kind: "notFound" }));

    const long = "é".repeat(10_005);
    const note = { id: "n1", text: long, createdAt: rig.clock.now(), updatedAt: rig.clock.now() };
    rig.store.meetings.updateUserNotes(meeting.id, [note]);
    const saved = rig.store.meetings.get(meeting.id).userNotes;
    expect(saved).toHaveLength(1);
    expect(saved[0]?.text).toBe("é".repeat(10_000));
    expect(rig.store.outbox.pending().map((event) => event.event)).toEqual(["meeting.received", "meeting.notes_edited"]);
  });

  it("stores intents as transferred with history, audit and outbox", async () => {
    const opened = await receiveGoldenBundle(rig);
    const stored = rig.store.intents.list({ meetingID: opened.meeting.id });
    expect(stored).toHaveLength(opened.meeting.intents.length);
    expect(stored.every((intent) => intent.intent.status === "transferred")).toBe(true);
    const first = stored[0]?.intent.id as LanaId;
    expect(rig.store.intents.history(first)).toMatchObject([{ from: "proposed", to: "transferred", actor: "phone", detail: { bundle_id: opened.manifest.bundleID } }]);
    const audit = await rig.store.auditEntries();
    const received = audit.find((entry) => entry.event === "bundle.received");
    expect(JSON.parse(received?.detail ?? "{}")).toMatchObject({ attestation_method: "acoustic", tone_plays: "1", audio_parts: "2", quarantined: "0" });
  });

  it("quarantines rejected intents in the audit log without storing them", async () => {
    const { manifest, parts } = goldenBundle();
    const opened = await openBundle(manifest, parts, mac);
    const bad = makeIntent({ meetingID: opened.meeting.id, params: { type: "note.log", note: { subject: "", body: "" } }, confidence: 3, evidence: [], createdAt: rig.clock.now() });
    await rig.store.complete({ ...opened, rejectedIntents: [{ intent: bad, issues: [{ field: "params.subject", message: "empty" }, { field: "confidence", message: "range" }] }] },
      issueReceipt(manifest, mac, rig.clock.now()), attestation());
    const quarantined = (await rig.store.auditEntries()).filter((entry) => entry.event === "intent.quarantined");
    expect(quarantined.map((entry) => [entry.subject, JSON.parse(entry.detail)])).toEqual([[bad.id, { meeting_id: opened.meeting.id, issues: "params.subject,confidence" }]]);
    expect(() => rig.store.intents.get(bad.id)).toThrow(expect.objectContaining({ kind: "notFound" }));
  });

  it("keeps meeting content, intents and audio sealed on disk", async () => {
    const opened = await receiveGoldenBundle(rig);
    rig.store.ask.save("t1", opened.meeting.id, Buffer.from("which matter was this"));
    const raw = rawDatabase(rig);
    raw.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    raw.close();
    const files = [join(rig.directory, STORE_DATABASE_FILE), ...readdirSync(join(rig.directory, "audio")).map((name) => join(rig.directory, "audio", name))];
    const haystack = Buffer.concat(files.filter(existsSync).map((path) => readFileSync(path)));
    for (const secret of [opened.meeting.title, opened.meeting.transcript[0]?.text ?? "", "which matter was this", (opened.meeting.intents[0]?.params as { note?: { subject: string } }).note?.subject ?? "Acme"]) {
      expect(secret.length).toBeGreaterThan(3);
      expect(haystack.includes(Buffer.from(secret))).toBe(false);
    }
    expect(haystack.includes(Buffer.from(PSK))).toBe(false);
    const audio = readFileSync(join(rig.directory, "audio", `${opened.meeting.id}-0.bin`));
    expect(audio.includes(Buffer.from(opened.audio[0]?.data.subarray(0, 32) ?? []))).toBe(false);

    const otherKey = await GatewayStore.open({ directory: rig.directory, keys: new InMemoryDataKeyProvider() });
    expect(() => otherKey.meetings.list()).toThrow(expect.objectContaining({ kind: "corrupt" }));
    otherKey.close();
  });

  it("purges audio past retention and keeps the transcript", async () => {
    const opened = await receiveGoldenBundle(rig);
    expect(rig.store.meetings.purgeAudio(30)).toBe(0);
    rig.clock.advance(31 * 86_400);
    expect(rig.store.meetings.purgeAudio(30)).toBe(2);
    expect(rig.store.meetings.audioParts(opened.meeting.id)).toEqual([]);
    expect(() => rig.store.meetings.audioData(opened.meeting.id, 0)).toThrow(expect.objectContaining({ kind: "notFound" }));
    expect(rig.store.meetings.list()[0]?.audioAvailable).toBe(false);
    expect(rig.store.meetings.get(opened.meeting.id).transcript.length).toBeGreaterThan(0);
    expect((await rig.store.auditEntries()).at(-1)).toMatchObject({ event: "audio.purged", subject: "retention", detail: "{\"days\":\"30\",\"parts\":\"2\"}" });
  });
});

describe("intents", () => {
  let meeting: MeetingRecord;
  let id: LanaId;
  beforeEach(async () => {
    meeting = (await receiveGoldenBundle(rig)).meeting;
    id = rig.store.intents.list()[0]?.intent.id as LanaId;
  });

  it("moves through the lifecycle with history, audit and outbox", () => {
    rig.clock.advance(1);
    rig.store.intents.transition(id, "resolved", "system", { target: "matter-1" });
    rig.store.intents.transition(id, "confirmed", "user");
    const executed = rig.store.intents.transition(id, "executed", "system");
    expect(executed.intent.status).toBe("executed");
    expect(rig.store.intents.history(id).map((event) => `${event.from}>${event.to}:${event.actor}`))
      .toEqual(["proposed>transferred:phone", "transferred>resolved:system", "resolved>confirmed:user", "confirmed>executed:system"]);
    expect(rig.store.intents.list({ statuses: ["executed"] }).map((intent) => intent.intent.id)).toEqual([id]);
    expect(rig.store.meetings.list()[0]?.openIntents).toBe(meeting.intents.length - 1);
    const transition = rig.store.intents.history(id)[1];
    expect(transition?.detail).toEqual({ target: "matter-1" });
    expect(LanaDate.format(transition?.at as Date)).toBe(LanaDate.format(rig.clock.now()));
    expect(rig.store.outbox.pending(100).filter((event) => event.event === "intent.status").map((event) => event.payload["status"])).toEqual(["resolved", "confirmed", "executed"]);
  });

  it("refuses illegal moves and edits after confirmation", () => {
    expect(() => rig.store.intents.transition(id, "executed", "user")).toThrow(expect.objectContaining({ kind: "invalidTransition", from: "transferred", to: "executed" }));
    const current = rig.store.intents.get(id).intent;
    const edited = rig.store.intents.updateParams(id, current.params);
    expect(edited.intent.idempotencyKey).toBe(current.idempotencyKey);
    rig.store.intents.transition(id, "resolved", "system");
    rig.store.intents.transition(id, "confirmed", "user");
    expect(() => rig.store.intents.updateParams(id, current.params)).toThrow(expect.objectContaining({ kind: "notEditable" }));
    expect(() => rig.store.intents.updateParams(id, { type: "task.create", task: { title: "x", detail: "" } })).toThrow();
  });

  it("seals and clears the executor's resolution", () => {
    rig.store.intents.setResolution(id, Buffer.from("plan"));
    expect(Buffer.from(rig.store.intents.get(id).resolution as Uint8Array).toString()).toBe("plan");
    rig.store.intents.setResolution(id, null);
    expect(rig.store.intents.get(id).resolution).toBeNull();
    expect(() => rig.store.intents.setResolution(makeLanaId("intent"), null)).toThrow(expect.objectContaining({ kind: "notFound" }));
  });
});

describe("idempotency ledger", () => {
  it("counts attempts, keeps completed keys and ignores late failures", () => {
    const ledger = rig.store.ledger;
    expect(ledger.begin("k1", "h1")).toMatchObject({ status: "pending", attempts: 1 });
    ledger.fail("k1", "timeout");
    expect(ledger.get("k1")).toMatchObject({ status: "failed", error: "timeout" });
    expect(ledger.begin("k1", "h2")).toMatchObject({ status: "pending", attempts: 2, planHash: "h2", error: null });
    ledger.complete("k1", "clio:123");
    expect(ledger.begin("k1", "h3")).toEqual({ key: "k1", planHash: "h2", status: "completed", result: "clio:123", error: null, attempts: 2 });
    ledger.fail("k1", "late");
    expect(ledger.get("k1")?.status).toBe("completed");
    expect(() => ledger.complete("missing", "x")).toThrow(expect.objectContaining({ kind: "notFound" }));
    expect(ledger.get("missing")).toBeNull();
  });
});

describe("devices, outbox, mirror, ask and settings", () => {
  it("pins, lists and revokes phones", async () => {
    expect(await rig.store.pinnedPhone(phone.publicKeys.deviceID)).toEqual(phone.publicKeys);
    expect(await rig.store.transportPsks()).toEqual([{ identity: phone.publicKeys.deviceID, key: PSK }]);
    await rig.store.revokeDevice(phone.publicKeys.deviceID);
    expect(await rig.store.pinnedPhone(phone.publicKeys.deviceID)).toBeNull();
    expect(await rig.store.transportPsks()).toEqual([]);
    expect(await rig.store.pairedDevices()).toEqual([]);
    expect((await rig.store.pairedDevices(true))[0]?.revokedAt).not.toBeNull();
    await expect(rig.store.revokeDevice(phone.publicKeys.deviceID)).rejects.toThrow(expect.objectContaining({ kind: "notFound" }));
    await rig.store.pairDevice(phone.publicKeys, PSK);
    expect((await rig.store.pairedDevices())[0]?.revokedAt).toBeNull();
    expect((await rig.store.auditEntries()).map((entry) => entry.event)).toEqual(["device.paired", "device.revoked", "device.paired"]);
  });

  it("delivers outbox events once", async () => {
    await receiveGoldenBundle(rig);
    const pending = rig.store.outbox.pending();
    rig.store.outbox.markDelivered(pending.map((event) => event.seq));
    expect(rig.store.outbox.pending()).toEqual([]);
  });

  it("searches the entity mirror by prefix, ignoring accents", () => {
    rig.store.mirror.replace("clio", [
      { source: "clio", externalID: "1", kind: "matter", name: "Acme Logistics", displayNumber: "00042", clientName: "Acme" },
      { source: "clio", externalID: "2", kind: "contact", name: "José Muñoz", email: "jose@example.com" },
      { source: "graph", externalID: "3", kind: "user", name: "Ignored" },
    ]);
    expect(rig.store.mirror.search("acm").map((entity) => entity.externalID)).toEqual(["1"]);
    expect(rig.store.mirror.search("jose munoz", "contact")).toEqual([{ source: "clio", externalID: "2", kind: "contact", name: "José Muñoz", email: "jose@example.com", displayNumber: undefined, clientName: undefined }]);
    expect(rig.store.mirror.search("jose", "matter")).toEqual([]);
    expect(rig.store.mirror.search("  ,, ")).toEqual([]);
    rig.store.mirror.replace("clio", []);
    expect(rig.store.mirror.search("acme")).toEqual([]);
  });

  it("saves, lists and deletes Ask threads", async () => {
    const meeting = (await receiveGoldenBundle(rig)).meeting;
    rig.store.ask.save("global", null, Buffer.from("a"));
    rig.clock.advance(1);
    rig.store.ask.save("local", meeting.id, Buffer.from("b"));
    expect(rig.store.ask.list().map((thread) => thread.id)).toEqual(["local", "global"]);
    expect(rig.store.ask.list(meeting.id).map((thread) => thread.id)).toEqual(["local"]);
    expect(rig.store.ask.list(null, false).map((thread) => thread.id)).toEqual(["global"]);
    rig.store.ask.save("global", null, Buffer.from("c"));
    expect(Buffer.from(rig.store.ask.get("global")?.turns as Uint8Array).toString()).toBe("c");
    rig.store.ask.delete("global");
    expect(rig.store.ask.get("global")).toBeNull();
    rig.store.ask.deleteAll();
    expect(rig.store.ask.list()).toEqual([]);
  });

  it("keeps settings", () => {
    expect(rig.store.settings.get("retention.days")).toBeNull();
    rig.store.settings.set("retention.days", "30");
    rig.store.settings.set("retention.days", "45");
    expect(rig.store.settings.get("retention.days")).toBe("45");
  });
});
