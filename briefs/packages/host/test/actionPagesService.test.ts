import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { StoredAction } from "@lana/core/store";
import type { ActionListRequest, Result } from "../src/shared/api.js";
import { ActionPagesService, type ActionRunner, type RunGate } from "../src/main/services/actions/actionPagesService.js";
import { openRealRig, receiveGoldenMeeting, type RealRig } from "./support/realRig.js";

/** A runner that records calls; the gate only checks for a matter, as the LANA one will. */
class FakeRunner implements ActionRunner {
  ran: string[] = [];
  async run(action: StoredAction): Promise<Result<null>> {
    this.ran.push(action.id);
    return { ok: true, value: null };
  }
  async undo(): Promise<Result<null>> {
    return { ok: false, error: { code: "undoClosed", message: "The undo window has closed." } };
  }
  gate(action: StoredAction): RunGate {
    const hasMatter = action.resolution !== null;
    return { phase: { kind: "review" }, canRun: hasMatter, runTitle: "Create task", runBlockReason: hasMatter ? null : "Choose the matter for this task.", canUndo: false, lanaURL: null, actionError: null };
  }
}

const acme = { id: "11111111-2222-3333-4444-555555555555", label: "00099 Zephyr Holdings", detail: "Harbor lease" };

let rig: RealRig;
let runner: FakeRunner;
let pending: number[];
let unread: number[];
let service: ActionPagesService;
beforeEach(async () => {
  rig = await openRealRig();
  runner = new FakeRunner();
  pending = [];
  unread = [];
  service = new ActionPagesService({
    store: rig.store, runner: () => runner, deviceNoun: "computer", log: rig.log,
    onChange: (counts) => {
      pending.push(counts.pending);
      unread.push(counts.unread);
    },
  });
});
afterEach(() => rig.cleanup());

function request(change: Partial<ActionListRequest> = {}): ActionListRequest {
  return { query: "", filters: { status: [], kind: [] }, sort: { by: "created", dir: "desc" }, page: 1, pageSize: 25, ...change };
}

describe("the Inbox list and action pages over the real store", () => {
  it("lists the phone's actions with their meeting, and an action added by hand with no meeting", async () => {
    const meeting = await receiveGoldenMeeting(rig);
    const created = await service.create({ kind: "note", title: "Call notes", body: "Spoke with the client.", dueDate: null, matter: acme, meetingID: null });
    if (!created.ok) throw new Error(created.error.message);
    expect(created.value).toMatchObject({ origin: "manual", originLabel: "Added by you", meetingID: null, status: "review", fields: { matter: { id: acme.id, label: acme.label } } });
    const page = await service.list(request());
    if (!page.ok) throw new Error(page.error.message);
    expect(page.value.total).toBe(meeting.meeting.intents.length + 1);
    expect(page.value.rows.find((row) => row.id === created.value.id)).toMatchObject({ origin: "manual", meetingTitle: null, matter: { label: acme.label } });
    expect(page.value.rows.filter((row) => row.origin === "meeting").every((row) => row.meetingTitle !== null)).toBe(true);
    const byBody = await service.list(request({ query: "spoke client" }));
    expect(byBody.ok && byBody.value.rows.map((row) => row.id)).toEqual([created.value.id]);
    expect(byBody.ok && byBody.value.rows[0]).not.toHaveProperty("detail");
    const byMatter = await service.list(request({ filters: { status: [], kind: [], matterID: acme.id } }));
    expect(byMatter.ok && byMatter.value.rows.map((row) => row.id)).toEqual([created.value.id]);
    const searched = await service.list(request({ query: "zephyr" }));
    expect(searched.ok && searched.value.rows.map((row) => row.id)).toEqual([created.value.id]);
    expect(searched.ok && searched.value.facets.matters).toEqual([{ id: acme.id, label: acme.label }]);
  });

  it("titles a type this version cannot run in plain words, in the list and on its page", async () => {
    await receiveGoldenMeeting(rig);
    const page = await service.list(request());
    if (!page.ok) throw new Error(page.error.message);
    const newer = page.value.rows.find((row) => row.kind === "unsupported");
    expect(newer?.title).toBe("Calendar");
    expect(newer?.status).toBe("unsupported");
    expect(page.value.rows.every((row) => !row.title.includes("calendar.hold"))).toBe(true);
    const review = await service.list(request({ filters: { status: ["review"], kind: [] } }));
    expect(review.ok && review.value.rows.some((row) => row.kind === "unsupported")).toBe(false);
    const detail = await service.get(newer?.id ?? "");
    expect(detail.ok && detail.value.fields.title).toBe("Calendar");
  });

  it("saves with a matter, then runs through the runner, and refuses to run a deleted action", async () => {
    const created = await service.create({ kind: "task", title: "Send the letter", body: "", dueDate: null, matter: null, meetingID: null });
    if (!created.ok) throw new Error(created.error.message);
    expect(created.value).toMatchObject({ canRun: false, runBlockReason: "Choose the matter for this task.", canDelete: true, canRestore: false });
    const invalid = await service.save(created.value.id, { title: "", body: "", dueDate: null, matter: acme });
    expect(!invalid.ok && invalid.error.message).toBe("Add a task.");
    const badDate = await service.save(created.value.id, { title: "Send it", body: "", dueDate: "2026-13-01", matter: acme });
    expect(!badDate.ok && badDate.error.message).toBe("Choose a real due date.");
    const saved = await service.save(created.value.id, { title: "Send the signed letter", body: "Today", dueDate: "2026-11-06", matter: acme });
    expect(saved.ok && saved.value).toMatchObject({ canRun: true, fields: { title: "Send the signed letter", dueDate: "2026-11-06", matter: { id: acme.id } } });
    expect((await service.run(created.value.id)).ok).toBe(true);
    expect(runner.ran).toEqual([created.value.id]);
    const removed = await service.remove(created.value.id);
    expect(removed.ok && removed.value).toMatchObject({ canRestore: true, canRun: false, isEditable: false, runBlockReason: "Restore this action to run it." });
    const refused = await service.run(created.value.id);
    expect(!refused.ok && refused.error.message).toBe("Restore this action to run it.");
    expect(runner.ran).toHaveLength(1);
    const restored = await service.restore(created.value.id);
    expect(restored.ok && restored.value.history.map((item) => item.sentence)).toEqual([
      "Added by you: Send the signed letter",
      "Saved changes: Send the signed letter",
      "Deleted: Send the signed letter",
      "Restored: Send the signed letter",
    ]);
    expect(pending.length).toBeGreaterThan(0);
  });

  it("shows unread rows, marks one read only when its page asks, and marks all read, with the counts in the event", async () => {
    const meeting = await receiveGoldenMeeting(rig);
    const total = meeting.meeting.intents.length;
    expect(service.unreadCount()).toBe(total);
    expect(await service.inbox.unreadCount()).toBe(total);
    const page = await service.list(request());
    if (!page.ok) throw new Error(page.error.message);
    expect(page.value.rows.every((row) => row.unread)).toBe(true);
    // Listing and opening the detail read nothing.
    const first = page.value.rows[0]!;
    const detail = await service.get(first.id);
    expect(detail.ok && detail.value.unread).toBe(true);
    expect(service.unreadCount()).toBe(total);
    expect(await service.markRead(first.id)).toEqual({ ok: true, value: null });
    expect(unread.at(-1)).toBe(total - 1);
    const after = await service.get(first.id);
    expect(after.ok && after.value.unread).toBe(false);
    const onlyUnread = await service.list(request({ filters: { status: [], kind: [], unread: true } }));
    expect(onlyUnread.ok && onlyUnread.value.rows.map((row) => row.id)).not.toContain(first.id);
    expect(onlyUnread.ok && onlyUnread.value.total).toBe(total - 1);
    // Marking it again changes nothing and sends no event.
    const events = unread.length;
    await service.markRead(first.id);
    expect(unread).toHaveLength(events);
    expect(await service.markRead("not-an-id")).toMatchObject({ ok: false, error: { code: "notFound" } });
    expect(await service.markAllRead()).toEqual({ ok: true, value: null });
    expect(service.unreadCount()).toBe(0);
    expect(unread.at(-1)).toBe(0);
    expect(pending.at(-1)).toBe(service.pendingCount());
    // Adding one by hand is the person's own: never unread.
    const created = await service.create({ kind: "note", title: "Call notes", body: "", dueDate: null, matter: acme, meetingID: null });
    expect(created.ok && created.value.unread).toBe(false);
    expect(service.unreadCount()).toBe(0);
  });

  it("counts waiting actions without deleted ones, and answers plain messages for bad input", async () => {
    await receiveGoldenMeeting(rig);
    const before = service.pendingCount();
    const first = await service.list(request({ filters: { status: ["review"], kind: ["task", "note", "email"] } }));
    const id = first.ok ? first.value.rows[0]?.id : undefined;
    expect(id).toBeDefined();
    await service.remove(id ?? "");
    expect(service.pendingCount()).toBe(before - 1);
    expect(await service.get("not-an-id")).toMatchObject({ ok: false, error: { code: "notFound" } });
    expect(await service.create({ kind: "email" as "task", title: "x", body: "", dueDate: null, matter: null, meetingID: null })).toMatchObject({ ok: false, error: { message: "Choose a task or a note." } });
    expect(await service.create({ kind: "task", title: "x", body: "", dueDate: null, matter: null, meetingID: "mtg_01ZZZZZZZZZZZZZZZZZZZZZZZZ" })).toMatchObject({ ok: false, error: { code: "invalid" } });
  });
});
