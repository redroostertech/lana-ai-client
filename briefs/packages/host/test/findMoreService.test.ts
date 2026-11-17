import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AVAILABLE, unavailable } from "@lana/core/ask";
import { makeLanaId } from "@lana/core/ids";
import { localMeetingRecord } from "@lana/core/recording";
import type { TextModel, TextModelRequest } from "@lana/core/runtime";
import type { FindMoreView, LanaEvent } from "../src/shared/api.js";
import { FindMoreService } from "../src/main/gateway/findMoreService.js";
import { openRealRig, type RealRig } from "./support/realRig.js";

// Synthetic meeting text only.
const TRANSCRIPT = [
  { speaker: "S1", start: 0, end: 6, text: "Thanks for joining. Let's review the Acme intake today." },
  { speaker: "S2", start: 6, end: 12, text: "The retainer is 2,500 dollars and covers the first three months." },
  { speaker: "S2", start: 12, end: 18, text: "I will send the engagement letter to Acme Logistics by Friday." },
  { speaker: "S1", start: 18, end: 24, text: "Who reviews the lease amendment before it is signed?" },
];

class Scripted implements TextModel {
  readonly modelID = "scripted";
  readonly calls: TextModelRequest[] = [];
  constructor(private readonly replies: string[], private readonly available = true) {}
  async availability() {
    return this.available ? AVAILABLE : unavailable("modelNotReady");
  }
  async respond(request: TextModelRequest): Promise<string> {
    this.calls.push(request);
    return this.replies[this.calls.length - 1] ?? "NONE";
  }
}

const REPLY = [
  "POINT: summary | L2 | The retainer is 2,500 dollars and covers the first three months.",
  "POINT: question | L4 | Who reviews the lease amendment before it is signed.",
  "ACTION: task | L3 | Send the engagement letter | Send it to Acme Logistics | by Friday | S2 | Acme Logistics",
].join("\n");

let rig: RealRig;
let events: LanaEvent[];
beforeEach(async () => {
  rig = await openRealRig();
  events = [];
});
afterEach(() => rig.cleanup());

function storeMeeting() {
  const id = makeLanaId("meeting");
  rig.store.local.insert(localMeetingRecord({
    id, title: "Intake", startedAt: rig.clock.now(), durationSeconds: 24, consent: { method: "verbal_announced", confirmedBy: [], confirmedAt: rig.clock.now() },
    userNotes: [], appVersion: "0.1.0", speakers: [{ id: "S1", name: "Dana Reyes" }, { id: "S2", name: "Omar Haddad" }], transcript: TRANSCRIPT,
  }), []);
  rig.store.shared.edit(id, (record) => ({
    ...record,
    notes: { keyPoints: [{ id: "kp-1", kind: "summary", text: "The team reviewed the Acme intake.", sources: [{ start: 0, end: 6, speaker: "S1" }], precision: "exact" }], gaps: [] },
    provenance: { ...record.provenance, notesModel: "scripted" },
  }));
  return id;
}

function service(model: TextModel, notesBusy: (id: string) => boolean = () => false): FindMoreService {
  return new FindMoreService({ store: rig.store, model, emit: (event) => events.push(event), log: rig.log, notesBusy });
}

function views(): FindMoreView[] {
  return events.flatMap((event) => (event.type === "findMore" ? [event.view] : []));
}

describe("Find more notes on the computer", () => {
  it("runs in the background, reports part n of total, and lists suggestions waiting to be added", async () => {
    const id = storeMeeting();
    const finder = service(new Scripted([REPLY]));
    const started = await finder.start(id);
    expect(started.ok && started.value.status).toBe("running");
    await finder.idle();
    const done = views().at(-1)!;
    expect(done.status).toBe("ready");
    expect(done.lastRun?.found).toBe(3);
    expect(done.suggestions.map((item) => item.kind)).toEqual(["summary", "task", "openQuestion"]);
    const task = done.suggestions.find((item) => item.kind === "task")!;
    expect(task).toMatchObject({ text: "Send the engagement letter", owner: "Omar Haddad", start: 12, end: 18 });
    expect(views().some((view) => view.status === "running" && view.part === 1 && view.of === 1)).toBe(true);
    // Nothing changed the notes.
    expect(rig.store.shared.current(id).notes.keyPoints).toHaveLength(1);
    expect(rig.log.lines.join("\n")).not.toContain("retainer");
  });

  it("adds one, adds all, and dismisses all, through the shared record", async () => {
    const id = storeMeeting();
    const finder = service(new Scripted([REPLY]));
    await finder.start(id);
    await finder.idle();
    const ids = views().at(-1)!.suggestions.map((item) => item.id);
    const first = await finder.add(id, [ids[0]!]);
    expect(first.ok && first.value.suggestions).toHaveLength(2);
    expect(rig.store.shared.current(id).notes.keyPoints.map((point) => point.text)).toContain("The retainer is 2,500 dollars and covers the first three months.");
    expect(events.some((event) => event.type === "meetingChanged" && event.meetingID === id)).toBe(true);
    const rest = await finder.dismiss(id, ids.slice(1));
    expect(rest.ok && rest.value.suggestions).toEqual([]);
    expect((await finder.state(id)).ok).toBe(true);
  });

  it("never suggests a dismissed item again on a later run", async () => {
    const id = storeMeeting();
    const model = new Scripted([REPLY, "Q1: open", REPLY, "Q1: open"]);
    const finder = service(model);
    await finder.start(id);
    await finder.idle();
    await finder.dismiss(id, views().at(-1)!.suggestions.map((item) => item.id));
    await finder.start(id);
    await finder.idle();
    const again = views().at(-1)!;
    expect(again.status).toBe("ready");
    expect(again.suggestions).toEqual([]);
    expect(again.lastRun?.found).toBe(0);
    const secondRun = model.calls.filter((call) => call.prompt.includes("Transcript part 1:"))[1]!;
    expect(secondRun.prompt).toContain("- Question: Who reviews the lease amendment before it is signed.");
  });

  it("does not start while notes are being written or another run is going", async () => {
    const id = storeMeeting();
    const busy = await service(new Scripted([REPLY]), () => true).start(id);
    expect(!busy.ok && busy.error.message).toBe("LANA is writing this meeting's notes. Try again when it finishes.");
    const finder = service(new Scripted([REPLY]));
    await finder.start(id);
    const second = await finder.start(storeMeeting());
    expect(!second.ok && second.error.message).toBe("LANA is finding more notes for another meeting. Try again when it finishes.");
    await finder.idle();
  });

  it("says when the LANA model is not ready, and keeps nothing", async () => {
    const id = storeMeeting();
    const finder = service(new Scripted([], false));
    await finder.start(id);
    await finder.idle();
    expect(views().at(-1)).toMatchObject({ status: "unavailable", suggestions: [] });
  });
});
