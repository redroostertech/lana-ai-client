import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { contentHash, stampRecord, type MeetingRecord } from "@lana/core/intent";
import { issueReceipt, type OpenedBundle } from "@lana/core/handoff";
import { makeLanaId } from "@lana/core/ids";
import type { LanaEvent } from "../src/shared/api.js";
import { RecordsService } from "../src/main/gateway/recordsService.js";
import { mac, openRealRig, phone, receiveGoldenMeeting, type RealRig } from "./support/realRig.js";

let rig: RealRig;
let events: LanaEvent[];
let service: RecordsService;
let opened: OpenedBundle;

beforeEach(async () => {
  rig = await openRealRig();
  opened = await receiveGoldenMeeting(rig);
  events = [];
  service = new RecordsService({
    store: rig.store, sendToPhone: (meeting, device) => rig.store.shared.queueForPhone(meeting, device), cancelSend: (meeting, device) => rig.store.shared.cancelQueued(meeting, device),
  }, (event) => events.push(event), rig.log);
  // Synthetic key points written on the phone.
  const onPhone = stampRecord(opened.meeting, {
    ...opened.meeting,
    notes: {
      ...opened.meeting.notes,
      keyPoints: [
        { id: "kp-1", kind: "summary", text: "The retainer is 2,500 dollars.", sources: [{ start: 0, end: 4 }], precision: "exact" },
        { id: "kp-2", kind: "decision", text: "Mediation in December.", sources: [{ start: 4, end: 8 }], precision: "exact" },
      ],
    },
  }, "phone");
  await deliver(onPhone);
});
afterEach(() => rig.cleanup());

async function deliver(meeting: MeetingRecord): Promise<void> {
  const manifest = { ...opened.manifest, bundleID: makeLanaId("bundle"), parts: opened.manifest.parts.slice(0, 1) };
  await rig.store.complete({ manifest, meeting, rejectedIntents: [], audio: [] }, issueReceipt(manifest, mac, rig.clock.now()),
    { sessionID: "s2", phoneDeviceID: phone.publicKeys.deviceID, method: "qr", latencyMs: 1, attestedAt: rig.clock.now(), tonePlays: 0 });
}

describe("key point edits on the computer", () => {
  it("edits and removes a key point the phone wrote, as this computer's edits that go to the phone", async () => {
    const id = opened.meeting.id;
    const before = rig.store.shared.current(id);
    const listed = [{ meetingID: id, revision: before.sync?.revision ?? 0, contentHash: contentHash(before) }];
    expect(await service.editKeyPoint(id, "kp-1", "  The retainer is 3,000 dollars.  ")).toEqual({ ok: true, value: null });
    expect(await service.removeKeyPoint(id, "kp-2")).toEqual({ ok: true, value: null });
    const record = rig.store.shared.current(id);
    expect(record.notes.keyPoints.map((point) => [point.id, point.text])).toEqual([["kp-1", "The retainer is 3,000 dollars."]]);
    expect(record.sync?.clock["keypoint/kp-1"]?.desktop).toBeGreaterThan(0);
    expect(events.filter((event) => event.type === "meetingChanged")).toHaveLength(2);
    const outgoing = rig.store.shared.outgoing(phone.publicKeys, listed);
    expect(outgoing[0]?.record.notes.keyPoints.map((point) => point.id)).toEqual(["kp-1"]);
    expect(rig.log.lines.join("\n")).not.toContain("retainer");
  });

  it("keeps a removed key point removed when the phone sends its older copy", async () => {
    const id = opened.meeting.id;
    const phoneCopy = rig.store.shared.current(id);
    await service.removeKeyPoint(id, "kp-2");
    await deliver(phoneCopy);
    expect(rig.store.shared.current(id).notes.keyPoints.map((point) => point.id)).toEqual(["kp-1"]);
  });

  it("refuses empty text and a key point that is gone", async () => {
    const id = opened.meeting.id;
    expect((await service.editKeyPoint(id, "kp-1", "  ")).ok).toBe(false);
    const gone = await service.removeKeyPoint(id, "kp-9");
    expect(!gone.ok && gone.error.code).toBe("invalid");
  });

  it("shows a key point both sides changed as a conflict the person can merge by hand", async () => {
    const id = opened.meeting.id;
    const phoneCopy = rig.store.shared.current(id);
    await service.editKeyPoint(id, "kp-1", "Retainer is 3,000 dollars, said on the computer.");
    await deliver(stampRecord(phoneCopy, {
      ...phoneCopy, notes: { ...phoneCopy.notes, keyPoints: phoneCopy.notes.keyPoints.map((point) => (point.id === "kp-1" ? { ...point, text: "Retainer is 2,800 dollars, said on the phone." } : point)) },
    }, "phone"));
    const state = await service.state(id);
    expect(state.ok && state.value.conflicts).toEqual([{
      unit: "keypoint/kp-1", kind: "keyPoint", label: "Key point", phone: "Retainer is 2,800 dollars, said on the phone.", desktop: "Retainer is 3,000 dollars, said on the computer.", editable: true, phoneAllowed: true,
    }]);
    const resolved = await service.resolve(id, "keypoint/kp-1", { kind: "edited", text: "Retainer is 2,900 dollars." });
    expect(resolved.ok && resolved.value.conflicts).toEqual([]);
    expect(rig.store.shared.current(id).notes.keyPoints.find((point) => point.id === "kp-1")?.text).toBe("Retainer is 2,900 dollars.");
  });
});
