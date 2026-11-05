import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { StoredAction } from "@lana/core/store";
import type { ActionDetail, ActionListRequest, Result } from "../src/shared/api.js";
import { ActionPagesService, type ActionRunner, type RunGate } from "../src/main/services/actions/actionPagesService.js";
import type { CandidateIntent, TranscriptSegment } from "@lana/core/intent";
import type { OpenedBundle } from "@lana/core/handoff";
import type { LanaEvent } from "../src/shared/api.js";
import { RecordsService } from "../src/main/gateway/recordsService.js";
import type { ClipDrafting } from "../src/main/gateway/clipDraftQueue.js";
import { MeetingsBridge } from "../src/main/gateway/meetingsBridge.js";
import { openRealRig, receiveGoldenMeeting, type RealRig } from "./support/realRig.js";
import { DraftDiagnostics, type DraftOutcome } from "../src/main/services/draftDiagnostics.js";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** A drafter the test answers by hand, so each draft's moment on the model can be seen. */
class HandDrafter implements ClipDrafting {
  readonly calls: Array<{ kind: "action" | "decision" | "question"; question?: string | undefined; lines: number; signal?: AbortSignal | undefined; answer: (value: unknown) => void; fail: (error?: unknown) => void }> = [];

  action(lines: readonly TranscriptSegment[], _speakers: unknown, signal?: AbortSignal): Promise<CandidateIntent | undefined> {
    return this.call("action", lines, signal) as Promise<CandidateIntent | undefined>;
  }

  decision(lines: readonly TranscriptSegment[], _speakers: unknown, signal?: AbortSignal): Promise<string | undefined> {
    return this.call("decision", lines, signal) as Promise<string | undefined>;
  }

  questionAction(question: string, lines: readonly TranscriptSegment[], _speakers: unknown, signal?: AbortSignal): Promise<CandidateIntent | undefined> {
    return this.call("question", lines, signal, question) as Promise<CandidateIntent | undefined>;
  }

  private call(kind: "action" | "decision" | "question", lines: readonly TranscriptSegment[], signal?: AbortSignal, question?: string): Promise<unknown> {
    return new Promise((answer, fail) => {
      signal?.addEventListener("abort", () => fail(Object.assign(new Error("aborted"), { name: "AbortError" })));
      this.calls.push({ kind, question, lines: lines.length, signal, answer, fail });
    });
  }
}

const task = (title: string): CandidateIntent => ({ type: "task.create", title, body: "Find out before the hearing", recipients: [], confidence: 1 });
const QUESTION = "Does the court need the exhibits in paper?";
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

let rig: RealRig;
let opened: OpenedBundle;
let events: LanaEvent[];
let inboxChanges: number;
let service: RecordsService;
let drafter: HandDrafter;

/** A runner that runs nothing: these tests only read the Inbox. */
class IdleRunner implements ActionRunner {
  async run(): Promise<Result<null>> {
    return { ok: true, value: null };
  }
  async undo(): Promise<Result<null>> {
    return { ok: true, value: null };
  }
  gate(_action: StoredAction): RunGate {
    return { phase: { kind: "review" }, canRun: false, runTitle: "Create task", runBlockReason: null, canUndo: false, lanaURL: null, actionError: null };
  }
}

/** The Inbox (the LANA action pages) over the same store. */
function inbox(): ActionPagesService {
  const runner = new IdleRunner();
  return new ActionPagesService({ store: rig.store, runner: () => runner, drafts: service.drafting, deviceNoun: "computer", onChange: () => undefined, log: rig.log });
}

const LIST: ActionListRequest = { query: "", filters: { status: [], kind: [] }, sort: { by: "created", dir: "desc" }, page: 1, pageSize: 50 };

/** The Inbox's detail for the action with this title, if it is there. */
async function actionTitled(actions: ActionPagesService, title: string): Promise<ActionDetail | undefined> {
  const page = await actions.list(LIST);
  const row = page.ok ? page.value.rows.find((item) => item.title === title && item.origin !== "draft") : undefined;
  if (row === undefined) return undefined;
  const detail = await actions.get(row.id);
  return detail.ok ? detail.value : undefined;
}

function records(store = rig.store): RecordsService {
  const made = new RecordsService({ store, sendToPhone: () => undefined, cancelSend: () => "not_queued" } as never, (event) => events.push(event), rig.log);
  made.onInboxChanged(() => (inboxChanges += 1));
  return made;
}

beforeEach(async () => {
  rig = await openRealRig();
  opened = await receiveGoldenMeeting(rig);
  events = [];
  inboxChanges = 0;
  // An open question on the first two lines, as the phone's notes would carry it.
  rig.store.shared.edit(opened.meeting.id, (record) => ({
    ...record,
    notes: { ...record.notes, keyPoints: [...record.notes.keyPoints, { id: "kp-q", kind: "open_question", text: QUESTION, sources: [{ start: record.transcript[0]!.start, end: record.transcript[1]!.end }], precision: "exact" }] },
  }));
  drafter = new HandDrafter();
  service = records();
  service.useDrafter(drafter);
  service.drafting.start();
});
afterEach(() => {
  service.drafting.stop();
  rig.cleanup();
});

describe("background drafts (clip.draft.v1 in the main process)", () => {
  it("goes requested, drafting, ready, confirmed: the action lands in the Inbox and the button follows it", async () => {
    const id = opened.meeting.id;
    const asked = await service.requestDraft(id, "action", 0, 1, "kp-q");
    expect(asked.ok && asked.value).toMatchObject({ kind: "action", question: QUESTION, questionID: "kp-q" });
    await settle();
    // On the model now, with the question and only the clip's two lines.
    expect(drafter.calls).toHaveLength(1);
    expect(drafter.calls[0]).toMatchObject({ kind: "question", question: QUESTION, lines: 2 });
    const drafting = await service.drafts(id);
    expect(drafting.ok && drafting.value.map((draft) => draft.state)).toEqual([{ kind: "drafting" }]);
    // Asking again for the same question gives the same draft, not a second one.
    const again = await service.requestDraft(id, "action", 0, 1, "kp-q");
    expect(again.ok && asked.ok && again.value.id).toBe(asked.ok ? asked.value.id : "");

    const actions = inbox();
    const before = actions.pendingCount();
    drafter.calls[0]!.answer(task("Research the exhibit rules"));
    await service.drafting.idle();

    expect((await service.drafts(id)).ok && (await service.drafts(id) as { value: unknown[] }).value).toEqual([]);
    const card = await actionTitled(actions, "Research the exhibit rules");
    expect(card).toMatchObject({ kind: "task", startingPoint: false, status: "review" });
    expect(card?.meetingID).toBe(id);
    expect(actions.pendingCount()).toBe(before);
    // The meeting shows it as ready, not made, until the person confirms it.
    const shown = await new MeetingsBridge(rig.store, rig.log).get(id);
    const marker = shown.ok ? shown.value.actions.find((item) => item.id === card?.id) : undefined;
    expect(marker?.confirmed).toBe(false);
    // Confirmed: the meeting shows it as made, and the settled draft is forgotten.
    rig.store.intents.transition(card!.id as never, "resolved", "user");
    rig.store.intents.transition(card!.id as never, "confirmed", "user");
    const made = await new MeetingsBridge(rig.store, rig.log).get(id);
    expect(made.ok && made.value.actions.find((item) => item.id === card?.id)?.confirmed).toBe(true);
    service.drafting.open();
    expect(rig.store.clipDrafts.list()).toEqual([]);
    expect(rig.store.audit.entries().map((entry) => entry.event)).toEqual(expect.arrayContaining(["draft.requested", "draft.ready"]));
    expect(events.filter((event) => event.type === "meetingChanged").length).toBeGreaterThan(2);
    expect(inboxChanges).toBeGreaterThan(2);
    // Nothing of the question or the draft is logged.
    expect(rig.log.lines.join("\n")).not.toMatch(/exhibit|Research/);
  });

  it("falls back to Follow up: <question> when LANA cannot draft it, and says so on the card", async () => {
    const id = opened.meeting.id;
    await service.requestDraft(id, "action", 0, 1, "kp-q");
    await settle();
    drafter.calls[0]!.answer(undefined);
    await service.drafting.idle();
    const actions = inbox();
    const card = await actionTitled(actions, `Follow up: ${QUESTION}`);
    expect(card?.startingPoint).toBe(true);
    const ready = rig.store.audit.entries().find((entry) => entry.event === "draft.ready");
    expect(JSON.parse(ready!.detail)).toMatchObject({ drafted: "false", kind: "question" });
  });

  it("tells the opt-in diagnostic how each draft settled, with field names only", async () => {
    const outcomes: DraftOutcome[] = [];
    service.useDrafter(drafter, { outcome: (outcome) => outcomes.push(outcome) });
    const id = opened.meeting.id;
    await service.requestDraft(id, "action", 0, 1, "kp-q");
    await settle();
    // Parsed, but a 201 character title is refused, so the starting point is used.
    drafter.calls[0]!.answer(task("x".repeat(201)));
    await service.drafting.idle();
    await service.requestDraft(id, "decision", 0, 1);
    await settle();
    drafter.calls[1]!.answer("We file Friday.");
    await service.drafting.idle();
    expect(outcomes.map(({ ms: _ms, draft: _draft, ...rest }) => rest)).toEqual([
      { kind: "question", parsed: true, drafted: false, issues: ["params.title"] },
      { kind: "decision", parsed: true, drafted: true, issues: [] },
    ]);
  });

  it("writes the diagnostic only when LANA_DRAFT_DIAGNOSTICS=1, as sizes and states", () => {
    const folder = mkdtempSync(join(tmpdir(), "lana-diag-"));
    try {
      const log = join(folder, "lana-main.log");
      expect(DraftDiagnostics.fromEnvironment({}, log)).toBeNull();
      expect(DraftDiagnostics.fromEnvironment({ LANA_DRAFT_DIAGNOSTICS: "1" }, null)).toBeNull();
      const diagnostics = DraftDiagnostics.fromEnvironment({ LANA_DRAFT_DIAGNOSTICS: "1" }, log)!;
      expect(diagnostics.path).toBe(join(folder, "draft-diagnostics.jsonl"));
      diagnostics.attempt({ kind: "question", attempt: 1, ms: 3500, promptChars: 900, promptLines: 12, replyChars: 140, replyLines: 1, label: "none", fields: 2, bareLine: true, rule: "no_label", modelError: null });
      diagnostics.outcome({ draft: "d1", kind: "question", parsed: false, drafted: false, issues: [], ms: 7100 });
      const written = readFileSync(diagnostics.path, "utf8").trim().split("\n").map((line) => JSON.parse(line) as Record<string, unknown>);
      expect(written.map((line) => line["event"])).toEqual(["draft.attempt", "draft.outcome"]);
      expect(written[0]).toMatchObject({ rule: "no_label", replyChars: 140, attempt: 1, bareLine: true });
    } finally {
      rmSync(folder, { recursive: true, force: true });
    }
  });

  it("drafts a decision for the person to check, then adds it as a key point", async () => {
    const id = opened.meeting.id;
    await service.requestDraft(id, "decision", 0, 1);
    await settle();
    drafter.calls[0]!.answer("We file the exhibits on paper.");
    await service.drafting.idle();
    const drafts = await service.drafts(id);
    const ready = drafts.ok ? drafts.value[0] : undefined;
    expect(ready?.state).toEqual({ kind: "ready", text: "We file the exhibits on paper.", drafted: true });
    // Kept sealed at rest: the stored queue never holds the decision in clear.
    expect(rig.store.settings.get("clip_drafts.v1")).not.toContain("exhibits");
    expect((await service.addDecision(ready!.id, "  ")).ok).toBe(false);
    expect(await service.addDecision(ready!.id, "We file the exhibits on paper by Friday.")).toEqual({ ok: true, value: null });
    expect(rig.store.shared.current(id).notes.keyPoints.some((point) => point.kind === "decision" && point.text === "We file the exhibits on paper by Friday.")).toBe(true);
    expect((await service.drafts(id)).ok && (await service.drafts(id) as { value: unknown[] }).value).toEqual([]);
    expect(rig.store.audit.entries().map((entry) => entry.event)).toContain("draft.added");
  });

  it("cancels a waiting draft and stops one on the model; nothing is added", async () => {
    const id = opened.meeting.id;
    const intentsBefore = rig.store.intents.list({ meetingID: id }).length;
    const first = await service.requestDraft(id, "action", 0, 0);
    const second = await service.requestDraft(id, "action", 1, 1);
    await settle();
    expect(drafter.calls).toHaveLength(1);
    expect(await service.cancelDraft(second.ok ? second.value.id : "")).toEqual({ ok: true, value: null });
    expect(await service.cancelDraft(first.ok ? first.value.id : "")).toEqual({ ok: true, value: null });
    expect(drafter.calls[0]!.signal?.aborted).toBe(true);
    await service.drafting.idle();
    expect(drafter.calls).toHaveLength(1);
    expect(rig.store.intents.list({ meetingID: id })).toHaveLength(intentsBefore);
    expect((await service.drafts(id)).ok && (await service.drafts(id) as { value: unknown[] }).value).toEqual([]);
    expect(rig.store.audit.entries().filter((entry) => entry.event === "draft.cancelled")).toHaveLength(2);
    expect((await service.cancelDraft("nope")).ok).toBe(false);
  });

  it("drafts one at a time in request order and shows how many are ahead", async () => {
    const id = opened.meeting.id;
    const a = await service.requestDraft(id, "action", 0, 0);
    const b = await service.requestDraft(id, "decision", 1, 1);
    const c = await service.requestDraft(id, "action", 0, 1, "kp-q");
    await settle();
    const shown = await service.drafts(id);
    expect(shown.ok && shown.value.map((draft) => draft.state)).toEqual([{ kind: "drafting" }, { kind: "waiting", ahead: 1 }, { kind: "waiting", ahead: 2 }]);
    expect(drafter.calls.map((call) => call.kind)).toEqual(["action"]);
    drafter.calls[0]!.answer(task("First"));
    await settle();
    await settle();
    expect(drafter.calls.map((call) => call.kind)).toEqual(["action", "decision"]);
    drafter.calls[1]!.answer("Second");
    await settle();
    await settle();
    expect(drafter.calls.map((call) => call.kind)).toEqual(["action", "decision", "question"]);
    drafter.calls[2]!.answer(task("Third"));
    await service.drafting.idle();
    const order = rig.store.audit.entries().filter((entry) => entry.event === "draft.ready").map((entry) => JSON.parse(entry.detail).draft_id);
    expect(order).toEqual([a, b, c].map((item) => (item.ok ? item.value.id : "")));
  });

  it("survives a restart: a draft cut off by quitting resumes, and the queue keeps its order", async () => {
    const id = opened.meeting.id;
    await service.requestDraft(id, "action", 0, 0);
    await service.requestDraft(id, "decision", 1, 1);
    await settle();
    expect(drafter.calls).toHaveLength(1);
    // Quit while the first is on the model.
    service.drafting.stop();
    await service.drafting.idle();

    const store = await rig.reopen();
    const relaunched = records(store);
    const next = new HandDrafter();
    relaunched.useDrafter(next);
    relaunched.drafting.start();
    await settle();
    expect(next.calls.map((call) => call.kind)).toEqual(["action"]);
    next.calls[0]!.answer(task("Resumed"));
    await settle();
    await settle();
    expect(next.calls.map((call) => call.kind)).toEqual(["action", "decision"]);
    next.calls[1]!.answer("Decided");
    await relaunched.drafting.idle();
    expect(store.intents.list({ meetingID: id }).some((stored) => stored.intent.params.type === "task.create" && stored.intent.params.task.title === "Resumed")).toBe(true);
    const drafts = await relaunched.drafts(id);
    expect(drafts.ok && drafts.value.map((draft) => draft.state.kind)).toEqual(["ready"]);
    relaunched.drafting.stop();
  });

  it("refuses a question that is not on the meeting", async () => {
    const result = await service.requestDraft(opened.meeting.id, "action", 0, 1, "kp-missing");
    expect(result.ok).toBe(false);
    expect(rig.store.clipDrafts.list()).toEqual([]);
  });
});
