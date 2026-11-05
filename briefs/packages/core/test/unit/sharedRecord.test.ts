import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { issueReceipt, openBundle, type OpenedBundle } from "../../src/handoff/index.js";
import { makeLanaId, type LanaId } from "../../src/ids/index.js";
import { contentHash, makeIntent, mergeRecords, stampRecord, type MeetingRecord } from "../../src/intent/index.js";
import type { AttestationRecord } from "../../src/store/index.js";
import { goldenIdentities } from "../support/goldenIdentities.js";
import { goldenBundle, openRig, type StoreRig } from "../support/storeRig.js";

const { mac, phone } = goldenIdentities();
const other = { ...phone.publicKeys, deviceID: makeLanaId("device") };

function attestation(): AttestationRecord {
  return { sessionID: "s1", phoneDeviceID: phone.publicKeys.deviceID, method: "qr", latencyMs: 300, attestedAt: new Date(1_800_000_000_000), tonePlays: 0 };
}

/** A later bundle from `from` carrying `meeting` (record only), as the phone's update would. */
async function deliver(rig: StoreRig, meeting: MeetingRecord, from = phone.publicKeys.deviceID): Promise<OpenedBundle> {
  const golden = goldenBundle();
  const manifest = { ...golden.manifest, bundleID: makeLanaId("bundle"), phoneDeviceID: from, parts: golden.manifest.parts.slice(0, 1) };
  const opened: OpenedBundle = { manifest, meeting, rejectedIntents: [], audio: [] };
  await rig.store.complete(opened, issueReceipt(manifest, mac, rig.clock.now()), attestation());
  return opened;
}

let rig: StoreRig;
let first: OpenedBundle;
let id: LanaId;
beforeEach(async () => {
  rig = await openRig();
  await rig.store.pairDevice(phone.publicKeys, new Uint8Array(32).fill(7));
  const { manifest, parts } = goldenBundle();
  first = await openBundle(manifest, parts, mac);
  await rig.store.complete(first, issueReceipt(manifest, mac, rig.clock.now()), attestation());
  id = first.meeting.id;
});
afterEach(() => rig.cleanup());

describe("shared meeting record on the desktop", () => {
  it("folds the Inbox into the desktop copy, stamped as desktop changes", () => {
    const current = rig.store.shared.current(id);
    expect(current.intents.every((intent) => intent.status === "transferred")).toBe(true);
    const unit = `intent/${current.intents[0]?.id}`;
    expect(current.sync?.clock[unit]).toEqual({ phone: 0, desktop: 1 });
    // Reading again changes nothing.
    expect(contentHash(rig.store.shared.current(id))).toBe(contentHash(current));
  });

  it("merges a later phone bundle instead of inserting the meeting twice", async () => {
    const shared = rig.store.shared.current(id);
    const added = makeIntent({ meetingID: id, params: { type: "task.create", task: { title: "Call Dana", detail: "" } }, confidence: 0.7, evidence: [], createdAt: rig.clock.now() });
    const onPhone = stampRecord(shared, { ...shared, title: "Corrected on the iPhone", intents: [...shared.intents, added] }, "phone");
    await deliver(rig, onPhone);

    expect(rig.store.meetings.list()).toHaveLength(1);
    expect(rig.store.meetings.audioParts(id)).toHaveLength(2);
    const after = rig.store.shared.current(id);
    expect(after.title).toBe("Corrected on the iPhone");
    expect(rig.store.intents.get(added.id).intent.status).toBe("transferred");
    const events = (await rig.store.auditEntries()).map((entry) => entry.event);
    expect(events.filter((event) => event === "meeting.updated")).toHaveLength(1);
    // A stale copy (lower phone clock) changes nothing.
    await deliver(rig, shared);
    expect(contentHash(rig.store.shared.current(id))).toBe(contentHash(after));
  });

  it("refuses a bundle for this meeting from a phone it is not shared with", async () => {
    await rig.store.pairDevice(other, new Uint8Array(32).fill(8));
    await expect(deliver(rig, rig.store.shared.current(id), other.deviceID)).rejects.toMatchObject({ kind: "corrupt" });
  });

  it("sends only what differs, and queued meetings with their audio", () => {
    const current = rig.store.shared.current(id);
    expect(rig.store.shared.outgoing(phone.publicKeys, [{ meetingID: id, revision: 1, contentHash: contentHash(current) }])).toEqual([]);
    rig.store.meetings.updateUserNotes(id, [{ id: "d1", text: "From the desk", createdAt: rig.clock.now(), updatedAt: rig.clock.now() }]);
    const changed = rig.store.shared.outgoing(phone.publicKeys, [{ meetingID: id, revision: 1, contentHash: contentHash(current) }]);
    expect(changed.map((item) => [item.record.userNotes.map((note) => note.id), item.audio.length])).toEqual([[["d1"], 0]]);
    // Not shared with another phone until queued for it; then the audio goes too.
    expect(rig.store.shared.outgoing(other, [{ meetingID: id, revision: 0, contentHash: "x" }])).toEqual([]);
    rig.store.shared.queueForPhone(id, other.deviceID);
    expect(rig.store.shared.outgoing(other, []).map((item) => item.audio.length)).toEqual([2]);
    expect(rig.store.shared.isSharedWith(id, other.deviceID)).toBe(false);
  });

  it("keeps both versions when both sides edited the same note, and applies the person's choice", async () => {
    const at = rig.clock.now();
    rig.store.meetings.updateUserNotes(id, [...rig.store.shared.current(id).userNotes.map((note, index) => (index === 0 ? { ...note, text: "Desk words", updatedAt: at } : note))]);
    const base = first.meeting;
    const onPhone = stampRecord(base, { ...base, userNotes: base.userNotes.map((note, index) => (index === 0 ? { ...note, text: "Phone words", updatedAt: at } : note)) }, "phone");
    await deliver(rig, onPhone);
    const unit = `note/${base.userNotes[0]?.id}`;
    const withConflict = rig.store.shared.current(id);
    expect(withConflict.sync?.conflicts.map((conflict) => conflict.unit)).toEqual([unit]);
    expect(withConflict.userNotes[0]?.text).toBe("Desk words");

    const resolved = rig.store.shared.resolve(id, unit, { kind: "edited", text: "Both, merged" });
    expect(resolved.userNotes[0]?.text).toBe("Both, merged");
    expect(resolved.sync?.conflicts).toEqual([]);
    // The phone takes the decision on its next sync.
    expect(mergeRecords(onPhone, resolved).userNotes[0]?.text).toBe("Both, merged");
  });

  it("never applies a phone edit to an action the Inbox can no longer change", async () => {
    const shared = rig.store.shared.current(id);
    const target = shared.intents.find((intent) => intent.type === "note.log") ?? shared.intents[0];
    if (target === undefined) throw new Error("no action");
    rig.store.intents.transition(target.id, "dismissed", "user");
    const seen = rig.store.shared.current(id);
    const edited = seen.intents.map((intent) => (intent.id === target.id && intent.params.type === "note.log" ? { ...intent, params: { ...intent.params, note: { ...intent.params.note, subject: "Edited on the phone" } } } : intent));
    await deliver(rig, stampRecord(seen, { ...seen, intents: edited }, "phone"));
    const after = rig.store.shared.current(id);
    expect(after.sync?.conflicts.map((conflict) => conflict.unit)).toEqual([`intent/${target.id}`]);
    expect(rig.store.intents.get(target.id).intent.status).toBe("dismissed");
    expect(() => rig.store.shared.resolve(id, `intent/${target.id}`, { kind: "phone" })).toThrow();
    expect(rig.store.shared.resolve(id, `intent/${target.id}`, { kind: "desktop" }).sync?.conflicts).toEqual([]);
  });
});
