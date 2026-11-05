import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { stampRecord } from "@lana/core/intent";
import { issueReceipt, type OpenedBundle, type RecordDecline, type RecordUpdate } from "@lana/core/handoff";
import { makeLanaId } from "@lana/core/ids";
import type { LanaEvent } from "../src/shared/api.js";
import { RecordsService } from "../src/main/gateway/recordsService.js";
import { MeetingsBridge } from "../src/main/gateway/meetingsBridge.js";
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
});
afterEach(() => rig.cleanup());

describe("shared meeting record in the desktop app", () => {
  it("edits the title, a speaker and a line as desktop changes, and says the meeting changed", async () => {
    const id = opened.meeting.id;
    expect(await service.rename(id, "  Renamed here  ")).toEqual({ ok: true, value: null });
    expect(await service.renameSpeaker(id, "S2", "Dana")).toEqual({ ok: true, value: null });
    expect(await service.correctLine(id, 0, "Corrected on the desktop")).toEqual({ ok: true, value: null });
    expect((await service.rename(id, " ")).ok).toBe(false);
    const record = rig.store.shared.current(id);
    expect(record.title).toBe("Renamed here");
    expect(record.speakers.find((speaker) => speaker.id === "S2")?.name).toBe("Dana");
    expect(record.transcript[0]?.text).toBe("Corrected on the desktop");
    expect(record.sync?.clock["title"]).toEqual({ phone: 0, desktop: 1 });
    expect(events).toEqual(Array(3).fill({ type: "meetingChanged", meetingID: id }));
    // The window's record shows the change; logs carry ids only.
    const shown = await new MeetingsBridge(rig.store, rig.log).get(id);
    expect(shown.ok && shown.value.title).toBe("Renamed here");
    expect(rig.log.lines.join("\n")).not.toContain("Renamed here");
  });

  it("shows a conflict with both versions and applies the person's choice", async () => {
    const id = opened.meeting.id;
    await service.rename(id, "Desktop title");
    const onPhone = stampRecord(opened.meeting, { ...opened.meeting, title: "iPhone title" }, "phone");
    const manifest = { ...opened.manifest, bundleID: makeLanaId("bundle"), parts: opened.manifest.parts.slice(0, 1) };
    await rig.store.complete({ manifest, meeting: onPhone, rejectedIntents: [], audio: [] }, issueReceipt(manifest, mac, rig.clock.now()),
      { sessionID: "s2", phoneDeviceID: phone.publicKeys.deviceID, method: "qr", latencyMs: 1, attestedAt: rig.clock.now(), tonePlays: 0 });

    const state = await service.state(id);
    expect(state.ok && state.value.conflicts).toEqual([
      { unit: "title", kind: "title", label: "Title", phone: "iPhone title", desktop: "Desktop title", editable: true, phoneAllowed: true },
    ]);
    const resolved = await service.resolve(id, "title", { kind: "edited", text: "Both agree" });
    expect(resolved.ok && resolved.value.conflicts).toEqual([]);
    expect(rig.store.shared.current(id).title).toBe("Both agree");
  });

  it("queues Send to phone for a paired phone only", async () => {
    const id = opened.meeting.id;
    const sent = await service.sendToPhone(id, phone.publicKeys.deviceID);
    expect(sent.ok && sent.value.phones).toEqual([{ id: phone.publicKeys.deviceID, name: phone.publicKeys.displayName, shared: true, queued: true, declinedAt: null, snoozedAt: null, lastSyncedAt: rig.clock.now().toISOString() }]);
    expect((await service.sendToPhone(id, makeLanaId("device"))).ok).toBe(false);
  });

  it("cancels a queued send, says when nothing was queued, and shows a decline from the phone", async () => {
    const id = opened.meeting.id;
    await service.sendToPhone(id, phone.publicKeys.deviceID);
    const cancelled = await service.cancelSend(id, phone.publicKeys.deviceID);
    expect(cancelled.ok && cancelled.value.status).toBe("cancelled");
    expect(cancelled.ok && cancelled.value.record.phones[0]?.queued).toBe(false);
    expect(rig.store.shared.queue(phone.publicKeys.deviceID)).toEqual([]);
    const again = await service.cancelSend(id, phone.publicKeys.deviceID);
    expect(again.ok && again.value.status).toBe("not_queued");
    expect((await service.cancelSend(id, "not-a-device")).ok).toBe(false);

    // A session is delivering it: not cancelled.
    await service.sendToPhone(id, phone.publicKeys.deviceID);
    expect(await rig.store.beginDelivery(phone.publicKeys, id)).toBe(true);
    const busy = await service.cancelSend(id, phone.publicKeys.deviceID);
    expect(busy.ok && busy.value.status).toBe("delivering");
    expect(rig.store.shared.queue(phone.publicKeys.deviceID)).toEqual([id]);

    // The person declined it on the phone.
    const update = { updateID: makeLanaId("bundle"), meetingID: id } as RecordUpdate;
    await rig.store.endDelivery(phone.publicKeys, id);
    await rig.store.recordDeclined(phone.publicKeys, update, { declinedAt: new Date("2026-11-01T16:00:00.000Z") } as RecordDecline);
    const state = await service.state(id);
    expect(state.ok && state.value.phones[0]).toMatchObject({ queued: false, declinedAt: "2026-11-01T16:00:00.000Z" });

    // Sent again, then "Not now" on the phone: no longer queued, shown as Not now.
    await service.sendToPhone(id, phone.publicKeys.deviceID);
    expect(rig.store.shared.snoozedByPhone(phone.publicKeys, new Date("2026-11-01T17:00:00.000Z"))).toEqual([id]);
    const snoozed = await service.state(id);
    expect(snoozed.ok && snoozed.value.phones[0]).toMatchObject({ queued: false, declinedAt: null, snoozedAt: "2026-11-01T17:00:00.000Z" });
    expect(rig.log.lines.join("\n")).not.toContain(phone.publicKeys.displayName);
  });
});

describe("clips and notes through the shared record", () => {
  it("saves a clip as a desktop change, keeps one clip per lines, and replaces an overlapping one", async () => {
    const id = opened.meeting.id;
    const first = await service.saveClip(id, 0, 1);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const again = await service.saveClip(id, 1, 0);
    expect(again.ok && again.value.id).toBe(first.value.id);
    const record = rig.store.shared.current(id);
    expect(record.clips.map((clip) => clip.id)).toContain(first.value.id);
    expect(record.sync?.clock[`clip/${first.value.id}`]).toEqual({ phone: 0, desktop: 1 });
    // A clip over line 1 only overlaps the first one, which it replaces.
    const narrower = await service.saveClip(id, 1, 1);
    expect(narrower.ok && rig.store.shared.current(id).clips.map((clip) => clip.id)).toEqual([narrower.ok ? narrower.value.id : ""]);
    expect((await service.saveClip(id, 500, 600)).ok).toBe(false);
    expect((await service.removeClip(id, narrower.ok ? narrower.value.id : "")).ok).toBe(true);
    expect(rig.store.shared.current(id).clips).toEqual([]);
    expect(events.every((event) => event.type === "meetingChanged")).toBe(true);
  });

  it("saves a note anchored to a clip as a desktop change of the record", async () => {
    const id = opened.meeting.id;
    const clip = await service.saveClip(id, 0, 1);
    if (!clip.ok) throw new Error("clip");
    rig.store.meetings.updateUserNotes(id, [{ id: "note-1", text: "Ask about the filing fee", createdAt: rig.clock.now(), updatedAt: rig.clock.now(), anchor: clip.value.start }]);
    const record = rig.store.shared.current(id);
    expect(record.userNotes[0]?.anchor).toBe(clip.value.start);
    expect(record.sync?.clock["note/note-1"]).toEqual({ phone: 0, desktop: 1 });
  });
});
