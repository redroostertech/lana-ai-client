import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { utf8 } from "../../src/bytes/index.js";
import { issueReceipt, openBundle, type OpenedBundle } from "../../src/handoff/index.js";
import { makeLanaId, type LanaId } from "../../src/ids/index.js";
import { makeIntent, stampRecord, type MeetingRecord } from "../../src/intent/index.js";
import { STORE_DATABASE_FILE, type AttestationRecord, type GatewayStore } from "../../src/store/index.js";
import { goldenIdentities } from "../support/goldenIdentities.js";
import { goldenBundle, openRig, type StoreRig } from "../support/storeRig.js";

const { mac, phone } = goldenIdentities();
const task = { type: "task.create" as const, task: { title: "Send the engagement letter", detail: "" } };
const matter = utf8('{"target":{"recipients":[],"regarding":{"displayName":"00042 Acme Logistics","id":"m-42","kind":"matter"}}}');

function attestation(rig: StoreRig): AttestationRecord {
  return { sessionID: "s1", phoneDeviceID: phone.publicKeys.deviceID, method: "acoustic", latencyMs: 420, attestedAt: rig.clock.now(), tonePlays: 1 };
}

/** The golden handoff: a meeting and its proposed actions from the phone. */
async function receive(rig: StoreRig): Promise<OpenedBundle> {
  await rig.store.pairDevice(phone.publicKeys, new Uint8Array(32).fill(7));
  const { manifest, parts } = goldenBundle();
  for (const [index, part] of parts.entries()) await rig.store.storePart(manifest.bundleID, index, part);
  const opened = await openBundle(manifest, parts, mac);
  await rig.store.complete(opened, issueReceipt(manifest, mac, rig.clock.now()), attestation(rig));
  return opened;
}

/** A later bundle from the phone carrying `meeting` (record only), as its update would. */
async function deliver(rig: StoreRig, meeting: MeetingRecord): Promise<void> {
  const golden = goldenBundle();
  const manifest = { ...golden.manifest, bundleID: makeLanaId("bundle"), parts: golden.manifest.parts.slice(0, 1) };
  await rig.store.complete({ manifest, meeting, rejectedIntents: [], audio: [] }, issueReceipt(manifest, mac, rig.clock.now()), attestation(rig));
}

/** The phone's copy with one action's title changed on the phone. */
function phoneEdit(record: MeetingRecord, id: string, title: string): MeetingRecord {
  const intents = record.intents.map((intent) => (intent.id === id && intent.params.type === "task.create" ? { ...intent, params: { ...intent.params, task: { ...intent.params.task, title } } } : intent));
  return stampRecord(record, { ...record, intents }, "phone");
}

function unread(store: GatewayStore): string[] {
  return store.actions.list({ status: [], kind: [] }).filter((action) => action.seenAt === null).map((action) => action.id).sort();
}

let rig: StoreRig;
beforeEach(async () => {
  rig = await openRig();
});
afterEach(() => rig.cleanup());

describe("when an action is unread", () => {
  it("arrives unread from a phone handoff, counted for the badge and on its meeting", async () => {
    const opened = await receive(rig);
    const ids = opened.meeting.intents.map((intent) => intent.id).sort();
    expect(ids.length).toBeGreaterThan(0);
    expect(unread(rig.store)).toEqual(ids);
    expect(rig.store.actions.unreadCount()).toBe(ids.length);
    expect(rig.store.meetings.list().map((meeting) => meeting.unreadActions)).toEqual([ids.length]);
  });

  it("arrives unread when a background draft is ready (the clip action lands in the Inbox)", async () => {
    const opened = await receive(rig);
    rig.store.actions.markAllRead();
    const drafted = makeIntent({ meetingID: opened.meeting.id, params: { type: "task.create", task: { title: "Call Dana", detail: "" } }, confidence: 0.7, evidence: [{ speaker: "S1", tStart: 1, tEnd: 4, quote: "Call Dana about the lease." }], createdAt: rig.clock.now() });
    rig.store.shared.addAction(opened.meeting.id, drafted);
    expect(unread(rig.store)).toEqual([drafted.id]);
    expect(rig.store.meetings.list()[0]?.unreadActions).toBe(1);
  });

  it("reads unread again when a run fails, for a phone action and one added by hand", async () => {
    await receive(rig);
    const target = rig.store.actions.list({ status: [], kind: [] })[0]!;
    const manual = rig.store.actions.createManual({ params: task, meetingID: null, resolution: matter });
    rig.store.actions.markAllRead();
    for (const id of [target.id, manual.id]) {
      if (rig.store.actions.get(id).status === "transferred") rig.store.actions.transition(id, "resolved", "user");
      rig.store.actions.transition(id, "confirmed", "user");
      expect(rig.store.actions.get(id).seenAt).not.toBeNull();
      rig.store.actions.transition(id, "failed", "system", { reason: "server" });
    }
    expect(unread(rig.store)).toEqual([target.id, manual.id].sort());
  });

  it("reads unread again when an update to it arrives from the phone", async () => {
    await receive(rig);
    rig.store.actions.markAllRead();
    const record = rig.store.shared.current(rig.store.meetings.list()[0]!.id);
    const target = record.intents.find((intent) => intent.type === "task.create")!;
    await deliver(rig, phoneEdit(record, target.id, "Edited on the phone"));
    expect(unread(rig.store)).toEqual([target.id]);
  });

  it("reads unread for a new conflict from the phone, but not when the same one comes again", async () => {
    await receive(rig);
    const meetingID = rig.store.meetings.list()[0]!.id;
    const target = rig.store.shared.current(meetingID).intents.find((intent) => intent.type === "task.create")!;
    rig.store.intents.transition(target.id, "dismissed", "user");
    rig.store.actions.markAllRead();
    const edited = phoneEdit(rig.store.shared.current(meetingID), target.id, "Edited on the phone");
    await deliver(rig, edited);
    expect(rig.store.shared.conflicts(meetingID).map((conflict) => conflict.unit)).toEqual([`intent/${target.id}`]);
    expect(unread(rig.store)).toEqual([target.id]);
    rig.store.actions.markRead(target.id);
    await deliver(rig, phoneEdit(edited, target.id, "Edited on the phone"));
    expect(unread(rig.store)).toEqual([]);
  });

  it("never reads unread for the person's own edits and steps", async () => {
    const opened = await receive(rig);
    const meetingID = opened.meeting.id;
    const manual = rig.store.actions.createManual({ params: task, meetingID, resolution: null });
    expect(manual.seenAt).not.toBeNull();
    rig.store.actions.markAllRead();
    const [first, second, third] = rig.store.actions.list({ status: [], kind: ["task"] }).filter((action) => action.origin === "meeting");
    rig.clock.advance(60);
    rig.store.actions.save(manual.id, { type: "task.create", task: { title: "Send the signed letter", detail: "Today" } }, matter);
    if (first !== undefined) {
      rig.store.actions.save(first.id, { type: "task.create", task: { title: "Edited here", detail: "" } }, matter);
      rig.store.actions.transition(first.id, "confirmed", "user");
      rig.store.actions.transition(first.id, "executed", "system", { lana_id: "t-1" });
    }
    if (second !== undefined) {
      rig.store.intents.updateParams(second.id, { type: "task.create", task: { title: "Edited again", detail: "" } });
      rig.store.actions.setResolution(second.id, matter);
      rig.store.actions.remove(second.id);
      rig.store.actions.restore(second.id);
    }
    if (third !== undefined) rig.store.actions.transition(third.id, "dismissed", "user");
    rig.store.shared.edit(meetingID, (record) => ({ ...record, title: "Renamed here" }));
    expect(unread(rig.store)).toEqual([]);
    expect(rig.store.actions.unreadCount()).toBe(0);
  });
});

describe("marking read", () => {
  it("marks one action read when its page opens, keeps the first time, and changes nothing else", async () => {
    await receive(rig);
    const target = rig.store.actions.list({ status: [], kind: [] })[0]!;
    const before = rig.store.actions.history(target.id).length;
    const total = rig.store.actions.unreadCount();
    const read = rig.store.actions.markRead(target.id);
    expect(read.seenAt?.getTime()).toBe(rig.clock.now().getTime());
    expect(read.updatedAt.getTime()).toBe(target.updatedAt.getTime());
    expect(rig.store.actions.history(target.id)).toHaveLength(before);
    expect(rig.store.actions.unreadCount()).toBe(total - 1);
    rig.clock.advance(60);
    expect(rig.store.actions.markRead(target.id).seenAt?.getTime()).toBe(read.seenAt?.getTime());
    expect(() => rig.store.actions.markRead("int_01ZZZZZZZZZZZZZZZZZZZZZZZZ" as LanaId)).toThrow(expect.objectContaining({ kind: "notFound" }));
  });

  it("marks every live action read with Mark all as read; a deleted one is not counted or changed", async () => {
    const opened = await receive(rig);
    const [kept, gone] = rig.store.actions.list({ status: [], kind: [] });
    rig.store.actions.remove(gone!.id);
    expect(rig.store.actions.unreadCount()).toBe(opened.meeting.intents.length - 1);
    expect(rig.store.actions.markAllRead()).toBe(opened.meeting.intents.length - 1);
    expect(rig.store.actions.unreadCount()).toBe(0);
    expect(rig.store.meetings.list()[0]?.unreadActions).toBe(0);
    expect(rig.store.actions.get(kept!.id).seenAt).not.toBeNull();
    expect(rig.store.actions.get(gone!.id).seenAt).toBeNull();
    expect(rig.store.actions.markAllRead()).toBe(0);
  });

  it("filters the list to unread rows in SQL, together with a status", async () => {
    await receive(rig);
    const [first, second] = rig.store.actions.list({ status: [], kind: [] });
    rig.store.actions.markRead(first!.id);
    const unreadReview = rig.store.actions.list({ status: ["review"], kind: [], unread: true }).map((action) => action.id);
    expect(unreadReview).toContain(second!.id);
    expect(unreadReview).not.toContain(first!.id);
    expect(rig.store.actions.list({ status: ["ran"], kind: [], unread: true })).toEqual([]);
  });
});

describe("migration v4_action_seen", () => {
  it("marks every action already in the store as seen, so an upgrade brings no pile of unread", async () => {
    await receive(rig);
    rig.store.actions.createManual({ params: task, meetingID: null, resolution: null });
    rig.store.close();
    // Turn the store back into a v3 one, holding the same rows.
    const raw = new DatabaseSync(join(rig.directory, STORE_DATABASE_FILE));
    raw.exec(`ALTER TABLE intent DROP COLUMN seen_at;
      ALTER TABLE manual_action DROP COLUMN seen_at;
      DELETE FROM grdb_migrations WHERE identifier = 'v4_action_seen';`);
    raw.close();
    rig.clock.advance(3_600);
    const upgraded = await rig.reopen();
    const actions = upgraded.actions.list({ status: [], kind: [] });
    expect(actions.length).toBeGreaterThan(1);
    expect(actions.every((action) => action.seenAt?.getTime() === action.updatedAt.getTime())).toBe(true);
    expect(upgraded.actions.unreadCount()).toBe(0);
    expect(upgraded.meetings.list().map((meeting) => meeting.unreadActions)).toEqual([0]);
  });
});
