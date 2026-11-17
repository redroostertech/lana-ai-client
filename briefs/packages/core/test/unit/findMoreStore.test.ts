import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { issueReceipt, openBundle } from "../../src/handoff/index.js";
import { makeLanaId, type LanaId } from "../../src/ids/index.js";
import { contentHash, makeIntent } from "../../src/intent/index.js";
import type { FindMoreSuggestion } from "../../src/summarizer/index.js";
import type { AttestationRecord } from "../../src/store/index.js";
import { goldenIdentities } from "../support/goldenIdentities.js";
import { goldenBundle, openRig, type StoreRig } from "../support/storeRig.js";

const { mac, phone } = goldenIdentities();

function attestation(): AttestationRecord {
  return { sessionID: "s1", phoneDeviceID: phone.publicKeys.deviceID, method: "qr", latencyMs: 300, attestedAt: new Date(1_800_000_000_000), tonePlays: 0 };
}

let rig: StoreRig;
let id: LanaId;
beforeEach(async () => {
  rig = await openRig();
  await rig.store.pairDevice(phone.publicKeys, new Uint8Array(32).fill(7));
  const { manifest, parts } = goldenBundle();
  const opened = await openBundle(manifest, parts, mac);
  await rig.store.complete(opened, issueReceipt(manifest, mac, rig.clock.now()), attestation());
  id = opened.meeting.id;
});
afterEach(() => rig.cleanup());

// Synthetic text only.
function suggestions(): FindMoreSuggestion[] {
  const task = makeIntent({
    meetingID: id, params: { type: "task.create", task: { title: "Send the fee schedule", detail: "Send the fee schedule to the client" } }, confidence: 0.7,
    evidence: [{ speaker: "S1", tStart: 1, tEnd: 3, quote: "I will send the fee schedule." }], createdAt: rig.clock.now(), status: "proposed",
  });
  return [
    { id: "more-a", kind: "summary", text: "The setup fee is 1,200 dollars.", sources: [{ start: 1, end: 3, speaker: "S1" }], precision: "exact" },
    { id: "more-b", kind: "decision", text: "The pilot starts on the bronze plan.", sources: [{ start: 4, end: 6 }], precision: "exact", decidedBy: "S1" },
    { id: "more-c", kind: "task", text: "Send the fee schedule", sources: [{ start: 1, end: 3, speaker: "S1" }], precision: "exact", intent: task },
  ];
}

describe("Find more notes on this computer", () => {
  it("keeps suggestions waiting, and nothing changes the notes until one is added", () => {
    const before = contentHash(rig.store.shared.current(id));
    const state = rig.store.findMore.saveRun(id, suggestions());
    expect(state.suggestions.map((item) => item.id)).toEqual(["more-a", "more-b", "more-c"]);
    expect(state.lastRun).toMatchObject({ found: 3 });
    expect(contentHash(rig.store.shared.current(id))).toBe(before);
  });

  it("adds a key point and a task through the shared record, so the phone gets them in its next sync", () => {
    rig.store.findMore.saveRun(id, suggestions());
    const synced = rig.store.shared.current(id);
    const listed = [{ meetingID: id, revision: synced.sync?.revision ?? 0, contentHash: contentHash(synced) }];
    expect(rig.store.shared.outgoing(phone.publicKeys, listed)).toEqual([]);
    expect(rig.store.findMore.add(id, ["more-b", "more-c"])).toBe(2);
    const record = rig.store.shared.current(id);
    const added = record.notes.keyPoints.find((point) => point.text === "The pilot starts on the bronze plan.");
    expect(added).toMatchObject({ kind: "decision", decidedBy: "S1" });
    expect(added!.id).toMatch(/^kp-more-[0-9a-f]{8}$/u);
    expect(record.intents.some((intent) => intent.params.type === "task.create" && intent.params.task.title === "Send the fee schedule" && intent.status === "transferred")).toBe(true);
    expect(record.sync?.clock[`keypoint/${added!.id}`]).toMatchObject({ desktop: 1 });
    const outgoing = rig.store.shared.outgoing(phone.publicKeys, listed);
    expect(outgoing).toHaveLength(1);
    expect(outgoing[0]!.record.notes.keyPoints.map((point) => point.id)).toContain(added!.id);
    expect(rig.store.findMore.state(id).suggestions.map((item) => item.id)).toEqual(["more-a"]);
  });

  it("remembers dismissed suggestions across a reopen, and they leave the list", async () => {
    rig.store.findMore.saveRun(id, suggestions());
    expect(rig.store.findMore.dismiss(id, ["more-a", "missing"])).toBe(1);
    const reopened = await rig.reopen();
    const state = reopened.findMore.state(id);
    expect(state.suggestions.map((item) => item.id)).toEqual(["more-b", "more-c"]);
    expect(state.dismissed).toEqual([{ kind: "summary", text: "The setup fee is 1,200 dollars.", sources: [{ start: 1, end: 3, speaker: "S1" }] }]);
    expect(state.suggestions[1]!.intent?.params.type).toBe("task.create");
  });

  it("seals the state and audits counts only", async () => {
    rig.store.findMore.saveRun(id, suggestions());
    rig.store.findMore.dismiss(id, ["more-a"]);
    const row = await (async () => JSON.stringify((rig.store as unknown as { ctx: { db: { all(sql: string): unknown[] } } }).ctx.db.all("SELECT key, value FROM setting")))();
    expect(row).toContain(`find_more.v1|${id}`);
    expect(row).not.toContain("1,200 dollars");
    const entries = (await rig.store.auditEntries()).filter((entry) => entry.event.startsWith("find_more."));
    expect(entries.map((entry) => entry.event)).toEqual(["find_more.ran", "find_more.dismissed"]);
    expect(JSON.stringify(entries)).not.toContain("dollars");
  });

  it("keeps a task that no longer passes the validator in the list, and adds the rest", () => {
    const [point, , task] = suggestions();
    const broken = { ...task!, id: "more-x", intent: { ...task!.intent!, meetingID: makeLanaId("meeting") } };
    rig.store.findMore.saveRun(id, [point!, broken]);
    expect(rig.store.findMore.add(id, ["more-a", "more-x"])).toBe(1);
    expect(rig.store.findMore.state(id).suggestions.map((item) => item.id)).toEqual(["more-x"]);
  });

  it("has no state for a meeting that is not here", () => {
    expect(rig.store.findMore.state(makeLanaId("meeting"))).toEqual({ suggestions: [], dismissed: [], removed: [], lastRun: null });
  });
});
