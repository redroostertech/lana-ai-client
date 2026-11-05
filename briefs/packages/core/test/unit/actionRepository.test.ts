import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { issueReceipt, openBundle, type OpenedBundle } from "../../src/handoff/index.js";
import { utf8 } from "../../src/bytes/index.js";
import type { LanaId } from "../../src/ids/index.js";
import { STORE_DATABASE_FILE } from "../../src/store/index.js";
import { goldenIdentities } from "../support/goldenIdentities.js";
import { goldenBundle, openRig, type StoreRig } from "../support/storeRig.js";

const { mac, phone } = goldenIdentities();
const task = { type: "task.create" as const, task: { title: "Send the engagement letter", detail: "" } };
const matter = utf8('{"target":{"recipients":[],"regarding":{"displayName":"00042 Acme Logistics","id":"m-42","kind":"matter"}}}');

async function receive(rig: StoreRig): Promise<OpenedBundle> {
  await rig.store.pairDevice(phone.publicKeys, new Uint8Array(32).fill(7));
  const { manifest, parts } = goldenBundle();
  for (const [index, part] of parts.entries()) await rig.store.storePart(manifest.bundleID, index, part);
  const opened = await openBundle(manifest, parts, mac);
  await rig.store.complete(opened, issueReceipt(manifest, mac, rig.clock.now()), { sessionID: "s1", phoneDeviceID: phone.publicKeys.deviceID, method: "acoustic", latencyMs: 420, attestedAt: rig.clock.now(), tonePlays: 1 });
  return opened;
}

function events(rig: StoreRig, id: string): string[] {
  return rig.store.actions.history(id as LanaId).map((entry) => entry.event);
}

let rig: StoreRig;
beforeEach(async () => {
  rig = await openRig();
});
afterEach(() => rig.cleanup());

describe("actions added by hand", () => {
  it("creates one with no meeting, origin manual, sealed at rest, audited with ids only", () => {
    const created = rig.store.actions.createManual({ params: task, meetingID: null, resolution: null });
    expect(created).toMatchObject({ origin: "manual", meetingID: null, type: "task.create", status: "transferred", deletedAt: null, idempotencyKey: `${created.id}:task.create`, evidence: [] });
    expect(created.params).toEqual(task);
    const raw = new DatabaseSync(join(rig.directory, STORE_DATABASE_FILE), { readOnly: true });
    try {
      const row = raw.prepare("SELECT * FROM manual_action").get() as Record<string, unknown>;
      expect(Buffer.from(row["sealed_action"] as Uint8Array).toString("latin1")).not.toContain("engagement");
      const audit = raw.prepare("SELECT event, subject, detail FROM audit_log").all();
      expect(audit).toEqual([{ event: "action.created_manually", subject: created.id, detail: '{"meeting_id":"","status":"transferred","type":"task.create"}' }]);
    } finally {
      raw.close();
    }
  });

  it("starts resolved with a matter, links to a meeting that exists, and refuses one that does not", async () => {
    const opened = await receive(rig);
    const linked = rig.store.actions.createManual({ params: task, meetingID: opened.meeting.id, resolution: matter });
    expect(linked).toMatchObject({ status: "resolved", meetingID: opened.meeting.id });
    expect(Buffer.from(linked.resolution ?? []).toString()).toContain("m-42");
    expect(() => rig.store.actions.createManual({ params: task, meetingID: "mtg_01ZZZZZZZZZZZZZZZZZZZZZZZZ" as LanaId, resolution: null })).toThrow(expect.objectContaining({ kind: "notFound" }));
  });

  it("saves edits with the matter, moving transferred to resolved, and runs through the same states", () => {
    const created = rig.store.actions.createManual({ params: task, meetingID: null, resolution: null });
    rig.clock.advance(60);
    const saved = rig.store.actions.save(created.id, { type: "task.create", task: { title: "Send the signed letter", detail: "Today" } }, matter);
    expect(saved).toMatchObject({ status: "resolved", params: { task: { title: "Send the signed letter", detail: "Today" } } });
    expect(saved.updatedAt.getTime()).toBeGreaterThan(created.updatedAt.getTime());
    expect(() => rig.store.actions.save(created.id, { type: "note.log", note: { subject: "x", body: "" } }, null)).toThrow(expect.objectContaining({ kind: "corrupt" }));
    rig.store.actions.transition(created.id, "confirmed", "user");
    expect(() => rig.store.actions.save(created.id, task, null)).toThrow(expect.objectContaining({ kind: "notEditable" }));
    expect(() => rig.store.actions.transition(created.id, "undone", "user")).toThrow(expect.objectContaining({ kind: "invalidTransition" }));
    rig.store.actions.transition(created.id, "executed", "system", { lana_id: "t-1" });
    expect(events(rig, created.id)).toEqual(["action.created_manually", "action.saved", "intent.transition", "intent.transition"]);
  });
});

describe("soft delete and restore", () => {
  it("hides a deleted action from the list, keeps it under Deleted, and restores it", () => {
    const keep = rig.store.actions.createManual({ params: task, meetingID: null, resolution: null });
    const gone = rig.store.actions.createManual({ params: { type: "note.log", note: { subject: "Old", body: "" } }, meetingID: null, resolution: null });
    const removed = rig.store.actions.remove(gone.id);
    expect(removed.deletedAt).not.toBeNull();
    expect(rig.store.actions.list({ status: [], kind: [] }).map((action) => action.id)).toEqual([keep.id]);
    expect(rig.store.actions.list({ status: [], kind: [], deleted: true }).map((action) => action.id)).toEqual([gone.id]);
    expect(() => rig.store.actions.remove(gone.id)).toThrow(expect.objectContaining({ kind: "notEditable" }));
    expect(() => rig.store.actions.save(gone.id, { type: "note.log", note: { subject: "New", body: "" } }, null)).toThrow(expect.objectContaining({ kind: "notEditable" }));
    expect(rig.store.actions.restore(gone.id).deletedAt).toBeNull();
    expect(() => rig.store.actions.restore(gone.id)).toThrow(expect.objectContaining({ kind: "notEditable" }));
    expect(events(rig, gone.id)).toEqual(["action.created_manually", "action.deleted", "action.restored"]);
  });

  it("soft deletes a phone action, never one that is running, and filters by status and type in SQL", async () => {
    const opened = await receive(rig);
    const phoneActions = rig.store.actions.list({ status: [], kind: [] });
    expect(phoneActions.length).toBe(opened.meeting.intents.length);
    expect(phoneActions.every((action) => action.origin === "meeting" && action.meetingID === opened.meeting.id)).toBe(true);
    const first = phoneActions[0]!;
    rig.store.actions.remove(first.id);
    expect(rig.store.intents.get(first.id).intent.status).toBe("transferred");
    expect(rig.store.actions.list({ status: [], kind: [] })).toHaveLength(phoneActions.length - 1);
    rig.store.actions.restore(first.id);
    const second = phoneActions[1]!;
    rig.store.actions.transition(second.id, "resolved", "user");
    rig.store.actions.transition(second.id, "confirmed", "user");
    expect(() => rig.store.actions.remove(second.id)).toThrow(expect.objectContaining({ kind: "notEditable" }));
    expect(rig.store.actions.list({ status: ["interrupted"], kind: [] }).map((action) => action.id)).toEqual([second.id]);
    expect(rig.store.actions.list({ status: [], kind: ["unsupported"] }).every((action) => !["task.create", "note.log", "email.draft"].includes(action.type))).toBe(true);
    expect(events(rig, first.id)).toEqual(["action.deleted", "action.restored"]);
  });

  it("saves a phone action's params and matter in one step and records its history", async () => {
    await receive(rig);
    const target = rig.store.actions.list({ status: [], kind: ["task"] })[0];
    expect(target).toBeDefined();
    if (target === undefined) return;
    const params = { type: "task.create" as const, task: { title: "Edited title", detail: "x" } };
    const saved = rig.store.actions.save(target.id, params, matter);
    expect(saved).toMatchObject({ status: "resolved", params, idempotencyKey: target.idempotencyKey });
    expect(rig.store.intents.history(target.id).at(-1)).toMatchObject({ from: "transferred", to: "resolved", actor: "user" });
    expect(events(rig, target.id)).toEqual(["action.saved"]);
  });
});
