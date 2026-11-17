import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { issueReceipt, openBundle, type OpenedBundle } from "../../src/handoff/index.js";
import { makeLanaId, type LanaId } from "../../src/ids/index.js";
import { stampRecord, type MeetingRecord } from "../../src/intent/index.js";
import { MeetingStates } from "../../src/state/index.js";
import type { AttestationRecord } from "../../src/store/index.js";
import { goldenIdentities } from "../support/goldenIdentities.js";
import { goldenBundle, openRig, type StoreRig } from "../support/storeRig.js";

const { mac, phone } = goldenIdentities();

function attestation(): AttestationRecord {
  return { sessionID: "s1", phoneDeviceID: phone.publicKeys.deviceID, method: "qr", latencyMs: 300, attestedAt: new Date(1_800_000_000_000), tonePlays: 0 };
}

async function deliver(rig: StoreRig, meeting: MeetingRecord): Promise<void> {
  const golden = goldenBundle();
  const manifest = { ...golden.manifest, bundleID: makeLanaId("bundle"), parts: golden.manifest.parts.slice(0, 1) };
  const opened: OpenedBundle = { manifest, meeting, rejectedIntents: [], audio: [] };
  await rig.store.complete(opened, issueReceipt(manifest, mac, rig.clock.now()), attestation());
}

// Synthetic key points only.
const POINTS = [
  { id: "kp-1", kind: "summary" as const, text: "The retainer is 2,500 dollars.", sources: [{ start: 0, end: 4 }], precision: "exact" as const },
  { id: "kp-2", kind: "decision" as const, text: "Mediation in December.", sources: [{ start: 4, end: 8 }], precision: "exact" as const },
];

let rig: StoreRig;
let id: LanaId;
beforeEach(async () => {
  rig = await openRig();
  await rig.store.pairDevice(phone.publicKeys, new Uint8Array(32).fill(7));
  const { manifest, parts } = goldenBundle();
  const first = await openBundle(manifest, parts, mac);
  await rig.store.complete(first, issueReceipt(manifest, mac, rig.clock.now()), attestation());
  id = first.meeting.id;
  // The phone sends its notes once; both sides now share them.
  const shared = rig.store.shared.current(id);
  await deliver(rig, stampRecord(shared, { ...shared, notes: { ...shared.notes, keyPoints: [...shared.notes.keyPoints, ...POINTS] } }, "phone"));
});
afterEach(() => rig.cleanup());

describe("removals learned from sync (meeting state contract)", () => {
  it("remembers a key point the phone removed, so Find more and rewrites never bring it back", async () => {
    const onComputer = rig.store.shared.current(id);
    const withoutDecision = { ...onComputer, notes: { ...onComputer.notes, keyPoints: onComputer.notes.keyPoints.filter((point) => point.id !== "kp-2") } };
    await deliver(rig, stampRecord(onComputer, withoutDecision, "phone"));
    expect(rig.store.shared.current(id).notes.keyPoints.map((point) => point.id)).not.toContain("kp-2");
    expect(rig.store.shared.current(id).notes.keyPoints.map((point) => point.id)).toContain("kp-1");
    expect(rig.store.findMore.state(id).removed).toEqual([{ kind: "decision", text: "Mediation in December.", sources: [{ start: 4, end: 8 }] }]);
    const state = new MeetingStates(rig.store).load(id);
    expect(state.isRejected("Mediation in December.", "decision")).toBe(true);
    // The same removal sent again adds nothing.
    await deliver(rig, stampRecord(onComputer, withoutDecision, "phone"));
    expect(rig.store.findMore.state(id).removed).toHaveLength(1);
  });

  it("learns nothing from an older phone copy that never had the point, or when both sides changed it", async () => {
    const before = rig.store.shared.current(id);
    // The computer adds a point; an older phone copy without it is not a removal (the phone's counter did not move).
    rig.store.shared.edit(id, (record) => ({ ...record, notes: { ...record.notes, keyPoints: [...record.notes.keyPoints, { id: "kp-3", kind: "summary", text: "Added here.", sources: [{ start: 8, end: 12 }], precision: "exact" }] } }));
    await deliver(rig, before);
    expect(rig.store.shared.current(id).notes.keyPoints.map((point) => point.id)).toContain("kp-3");
    expect(rig.store.findMore.state(id).removed).toEqual([]);
    // The computer edits kp-1 while the phone removes it: a conflict for the person, not a learned removal.
    const shared = rig.store.shared.current(id);
    rig.store.shared.edit(id, (record) => ({ ...record, notes: { ...record.notes, keyPoints: record.notes.keyPoints.map((point) => (point.id === "kp-1" ? { ...point, text: "The retainer is 3,000 dollars." } : point)) } }));
    await deliver(rig, stampRecord(shared, { ...shared, notes: { ...shared.notes, keyPoints: shared.notes.keyPoints.filter((point) => point.id !== "kp-1") } }, "phone"));
    expect(rig.store.shared.conflicts(id).map((conflict) => conflict.unit)).toContain("keypoint/kp-1");
    expect(rig.store.findMore.state(id).removed).toEqual([]);
  });
});
