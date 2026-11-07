import { describe, expect, it } from "vitest";
import {
  actionHistoryPassage, actionHistoryText, AskEngine, BackendError, clock, ExtractiveAnswerBackend, estimateTokens, hasAudioMoment,
  MeetingAskService, normalizeLabels, PassageBuilder, PassageIndex, storeAskSource, terms, unavailable, DEFAULT_ASK_BUDGET,
  type Passage,
} from "../../src/ask/index.js";
import { makeLanaId } from "../../src/ids/lanaId.js";
import { makeIntent, type MeetingRecord } from "../../src/intent/index.js";
import type { IntentEvent, MeetingSummary, StoredIntent } from "../../src/store/types.js";
import { fact, intake, meeting, ScriptedBackend } from "../support/askFakes.js";

describe("Ask: passages and retrieval", () => {
  it("covers every turn with overlap and notes", () => {
    const passages = new PassageBuilder(30, 1).passages(intake);
    expect(passages[0]?.kind).toBe("keyPoint");
    const transcript = passages.filter((p) => p.kind === "transcript");
    expect(transcript.length).toBeGreaterThan(1);
    for (const turn of intake.transcript) expect(transcript.some((p) => p.text.includes(turn.text))).toBe(true);
    expect(transcript.every((p) => p.text.includes("Dana Reyes:") || p.text.includes("Mike:"))).toBe(true);
    expect(new Set(passages.map((p) => p.id)).size).toBe(passages.length);
  });

  it("ranks the relevant passage first", () => {
    const index = new PassageIndex(new PassageBuilder(20, 0).passages(intake));
    const top = index.search("When is the Solberg deposition?")[0]?.passage;
    expect(top?.text).toContain("December 2");
    expect(top?.start).toBe(60);
    expect(index.search("zebra quantum")).toEqual([]);
  });

  it("folds case, diacritics and plurals", () => {
    expect(terms("Depositions")).toEqual(terms("deposition"));
    expect(terms("Müller")).toEqual(["muller"]);
    expect(terms("the and of")).toEqual([]);
  });

  it("reads the label shapes small models write", () => {
    expect(normalizeLabels(["P2", "[P3]", "p4.", "Passage 5", "6", "P1, P7", "P2"])).toEqual(["P2", "P3", "P4", "P5", "P6", "P1", "P7"]);
    expect(normalizeLabels(["none", ""])).toEqual([]);
  });
});

describe("Ask: engine", () => {
  const small = (backend: ScriptedBackend): AskEngine => AskEngine.forMeetings([intake], backend, { builder: new PassageBuilder(20, 0) });

  it("answers with verified citations", async () => {
    const backend = new ScriptedBackend((request) => {
      const label = request.passages.find((p) => p.text.includes("December 2"))!.label;
      return fact("December 2 in Atlanta.", [label, "P99", label]);
    });
    const answer = await small(backend).ask("When is the deposition?");
    expect(answer.status).toBe("answered");
    expect(answer.citations).toHaveLength(1);
    expect(answer.citations[0]?.start).toBe(60);
  });

  it("accepts a loosely written label", async () => {
    const backend = new ScriptedBackend((request) => {
      const number = request.passages.find((p) => p.text.includes("December 2"))!.label.slice(1);
      return fact("December 2 in Atlanta.", [`Passage ${number}`]);
    });
    const answer = await AskEngine.forMeetings([intake], backend).ask("When is the deposition?");
    expect(answer.status).toBe("answered");
    expect(answer.citations[0]?.text).toContain("December 2");
  });

  it("refuses to answer without valid citations", async () => {
    const engine = AskEngine.forMeetings([intake], new ScriptedBackend(() => fact("Probably March.", ["P42"])));
    expect((await engine.ask("When is the deposition?")).status).toBe("notFound");
  });

  it("treats not answerable as not found", async () => {
    const answer = await AskEngine.forMeetings([intake], new ScriptedBackend(() => fact("", [], false))).ask("What is the settlement amount?");
    expect(answer.status).toBe("notFound");
    expect(answer.citations).toEqual([]);
  });

  it("never calls the model for an empty question", async () => {
    const backend = new ScriptedBackend(() => fact("", [], false));
    expect((await AskEngine.forMeetings([intake], backend).ask("   ")).status).toBe("notFound");
    expect(backend.requests).toEqual([]);
  });

  it("reads a short meeting whole for a broad question", async () => {
    const backend = new ScriptedBackend((request) => fact("The engagement letter goes out Friday.", [request.passages.find((p) => p.text.includes("Engagement letter goes out Friday"))!.label]));
    expect((await AskEngine.forMeetings([intake], backend).ask("What did we decide?")).status).toBe("answered");
    const passages = new PassageBuilder().passages(intake);
    expect(backend.requests[0]?.passages.map((p) => p.text)).toEqual(passages.map((p) => p.text));
  });

  it("reads the key points of a long meeting with no match", async () => {
    const backend = new ScriptedBackend(() => fact("", [], false));
    const engine = AskEngine.forMeetings([intake], backend, { builder: new PassageBuilder(20, 0), budget: { passageTokens: 60 } });
    expect((await engine.ask("zebra quantum")).status).toBe("notFound");
    const request = backend.requests[0]!;
    expect(request.passages.length).toBeGreaterThan(0);
    expect(request.passages.every((p) => p.text.startsWith("Key point:") || p.text.startsWith("Decision:"))).toBe(true);
  });

  it("falls back to passages when the model is unavailable", async () => {
    const backend = new ScriptedBackend(() => fact("", [], false));
    backend.available = unavailable("modelNotReady");
    const answer = await AskEngine.forMeetings([intake], backend).ask("engagement letter");
    expect(answer.status).toBe("passagesOnly");
    expect(answer.reason).toBe("modelNotReady");
    expect(answer.citations[0]?.text.toLowerCase()).toContain("engagement letter");
  });

  it("still shows passages after a refusal", async () => {
    const backend = new ScriptedBackend(() => { throw BackendError.refused(); });
    const answer = await AskEngine.forMeetings([intake], backend).ask("deposition");
    expect(answer.status).toBe("declined");
    expect(answer.citations.length).toBeGreaterThan(0);
  });

  it("borrows the last question for follow-ups and carries history", async () => {
    const backend = new ScriptedBackend((request) => fact("Friday.", [request.passages[0]!.label]));
    const engine = AskEngine.forMeetings([intake], backend);
    const first = await engine.ask("engagement letter");
    await engine.ask("by when?", { history: [{ question: "engagement letter", answer: first }] });
    const last = backend.requests[backend.requests.length - 1]!;
    expect(last.history.map((h) => h.question)).toEqual(["engagement letter"]);
    expect(last.passages.some((p) => p.text.includes("engagement letter"))).toBe(true);
  });

  it("fits passages to the token budget", async () => {
    const long = meeting(Array.from({ length: 400 }, (_, i) => ["S1", i * 10, `The deposition schedule item ${i} covers exhibits, witnesses and the vendor contracts in detail.`] as [string, number, string]));
    const backend = new ScriptedBackend((request) => fact("x", [request.passages[0]!.label]));
    await AskEngine.forMeetings([long], backend).ask("deposition schedule exhibits");
    const request = backend.requests[0]!;
    expect(request.passages.reduce((sum, p) => sum + estimateTokens(p.text), 0)).toBeLessThanOrEqual(DEFAULT_ASK_BUDGET.passageTokens);
    expect(request.passages.length).toBeLessThanOrEqual(DEFAULT_ASK_BUDGET.maxPassages);
  });

  it("names the meeting in headings across meetings", async () => {
    const other = meeting([["S2", 5, "The Northwind deposition moved to January."]], { title: "Northwind intake" });
    const backend = new ScriptedBackend((request) => fact("x", request.passages.map((p) => p.label)));
    const answer = await AskEngine.forMeetings([intake, other], backend).ask("deposition");
    expect(new Set(answer.citations.map((p) => p.meetingTitle))).toEqual(new Set(["Acme intake", "Northwind intake"]));
    expect(backend.requests[0]!.passages.every((p) => p.heading.includes("intake"))).toBe(true);
  });

  it("puts pinned passages first and marks them", async () => {
    const pinned = new PassageBuilder(20, 0).passages(intake).find((p) => p.kind === "transcript" && p.start === 90)!;
    const backend = new ScriptedBackend((request) => fact("x", ["P1"]));
    const answer = await small(backend).ask("What about this?", { pinned: [pinned] });
    expect(backend.requests[0]!.passages[0]!.heading).toBe("transcript 1:30 to 1:38, the part the person is asking about");
    expect(answer.citations[0]?.id).toBe(pinned.id);
  });

  it("quotes the meeting with the extractive demo backend", async () => {
    const answer = await AskEngine.forMeetings([intake], new ExtractiveAnswerBackend()).ask("When is the deposition of Dr. Solberg?");
    expect(answer.status).toBe("answered");
    expect(answer.text).toContain("December 2");
  });

  it("formats clock times", () => {
    expect(clock(65)).toBe("1:05");
    expect(clock(3_725)).toBe("1:02:05");
  });

  it("stops before calling the model when cancelled", async () => {
    const backend = new ScriptedBackend(() => fact("x", ["P1"]));
    const controller = new AbortController();
    controller.abort();
    await expect(AskEngine.forMeetings([intake], backend).ask("deposition", { signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
    expect(backend.requests).toEqual([]);
  });
});

describe("Ask: recall across notes, scratch pad and actions", () => {
  function richMeeting(): MeetingRecord {
    const record = meeting([["S1", 0, "Welcome."], ["S1", 60, "Our deposition of Dr. Solberg is scheduled for December 2 in Atlanta."]]);
    return {
      ...record,
      notes: { keyPoints: [{ id: "kp-1", kind: "decision", text: "Depose Dr. Solberg on December 2.", sources: [{ start: 60, end: 68, speaker: "S1" }], precision: "exact" }], gaps: [] },
      userNotes: [{ id: "n1", text: "Bring the Bayview Home Care records binder", createdAt: new Date(), updatedAt: new Date(), anchor: 95 }],
      intents: [makeIntent({
        meetingID: record.id, confidence: 0.9, createdAt: new Date(),
        params: { type: "task.create", task: { title: "Prepare Solberg deposition outline", detail: "", dueDate: "2026-11-25", regarding: { kind: "matter", name: "Pemberton v. Lockridge" } } },
        evidence: [{ speaker: "S1", tStart: 60, tEnd: 68, quote: "Our deposition of Dr. Solberg is scheduled for December 2" }],
      })],
    };
  }

  it("makes key points, user notes and actions searchable with moments", () => {
    const passages = new PassageBuilder().passages(richMeeting());
    const point = passages.find((p) => p.kind === "keyPoint")!;
    expect(point.keyPointKind).toBe("decision");
    expect([point.start, point.end, point.speakers, hasAudioMoment(point)]).toEqual([60, 68, ["Dana Reyes"], true]);
    const mine = passages.find((p) => p.kind === "userNote")!;
    expect(mine.start).toBe(95);
    expect(mine.text).toContain("Bayview");
    const action = passages.find((p) => p.kind === "action")!;
    expect(action.text).toContain("Due: 2026-11-25");
    expect(action.text).toContain("Pemberton");
    const index = new PassageIndex(passages);
    expect(index.search("Bayview binder")[0]?.passage.kind).toBe("userNote");
    expect(index.search("deposition outline due")[0]?.passage.kind).toBe("action");
  });

  it("recalls extra history passages", async () => {
    const record = richMeeting();
    const history: Passage = {
      id: "history-1", meetingID: record.id, meetingTitle: record.title, meetingDate: record.startedAt, kind: "action", start: 60, end: 68, speakers: [],
      text: "Task \"Prepare Solberg deposition outline\" was confirmed and created in Clio on Nov 2.",
    };
    const backend = new ScriptedBackend((request) => {
      const label = request.passages.find((p) => p.text.includes("created in Clio"))?.label;
      return fact("Yes, it was created in Clio on Nov 2.", label === undefined ? [] : [label], label !== undefined);
    });
    const answer = await AskEngine.forMeetings([record], backend, { extraPassages: [history] }).ask("Did the Solberg outline task get created in Clio?");
    expect(answer.status).toBe("answered");
    expect(answer.citations[0]?.id).toBe("history-1");
  });
});

describe("Ask: action history (MeetingAskService)", () => {
  const meetingID = makeLanaId("meeting");
  const intent = makeIntent({
    meetingID, confidence: 0.9, createdAt: new Date("2026-11-01T15:00:00Z"),
    params: { type: "task.create", task: { title: "Prepare Solberg outline", detail: "", regarding: { kind: "matter", name: "Pemberton" } } },
    evidence: [{ speaker: "S1", tStart: 10, tEnd: 20, quote: "q" }, { speaker: "S1", tStart: 5, tEnd: 12, quote: "r" }],
  });
  const event = (seq: number, to: IntentEvent["to"], at: string, detail: Record<string, string> = {}): IntentEvent =>
    ({ seq, intentID: intent.id, from: null, to, actor: "user", detail, at: new Date(at) }) as IntentEvent;
  const events = [
    event(3, "undone", "2026-11-03T15:00:00Z"),
    event(1, "confirmed", "2026-11-02T15:00:00Z"),
    event(2, "executed", "2026-11-02T16:00:00Z", { executor: "clio.task" }),
    event(0, "transferred", "2026-11-01T16:00:00Z"),
  ];

  it("writes one plain sentence per action, in event order, grouping days", () => {
    expect(actionHistoryText({ ...intent, status: "undone" }, events, "UTC"))
      .toBe("Task 'Prepare Solberg outline' regarding Pemberton: proposed Nov 1, confirmed Nov 2, created in Clio, undone Nov 3. Status now: undone, removed again.");
    expect(actionHistoryText({ ...intent, status: "executed" }, events.slice(1, 3), "UTC"))
      .toBe("Task 'Prepare Solberg outline' regarding Pemberton: proposed Nov 1, confirmed Nov 2, created in Clio. Status now: created in Clio.");
  });

  it("points the history passage at the evidence span", () => {
    const passage = actionHistoryPassage({ intent, resolution: null, updatedAt: new Date() }, [], "Intake", new Date(0), "UTC");
    expect([passage.id, passage.kind, passage.start, passage.end]).toEqual([`${meetingID}#history-${intent.id}`, "action", 5, 20]);
    expect(passage.text).toContain("Status now: waiting for review on this computer.");
  });

  it("indexes the store's meetings, rebuilds on change, and adds action history", async () => {
    const record: MeetingRecord = { ...intake, id: meetingID, intents: [intent] };
    const summary = { id: meetingID, title: record.title, startedAt: record.startedAt } as MeetingSummary;
    let loads = 0;
    let summaries = [summary];
    const stored: StoredIntent = { intent: { ...intent, status: "executed" }, resolution: null, updatedAt: new Date() };
    const source = storeAskSource({
      meetings: { list: () => summaries, get: () => { loads += 1; return record; } },
      intents: { list: () => [stored], history: () => events.slice(1, 3) },
    });
    const backend = new ScriptedBackend((request) => {
      const label = request.passages.find((p) => p.text.includes("created in Clio"))?.label;
      return fact("Yes.", label === undefined ? [] : [label], label !== undefined);
    });
    const service = new MeetingAskService(source, backend, { timeZone: "UTC" });
    const answer = await service.ask("Was the outline created in Clio?", { kind: "meeting", id: meetingID });
    expect(answer.status).toBe("answered");
    expect(answer.citations[0]?.id).toBe(`${meetingID}#history-${intent.id}`);
    await service.ask("again?", { kind: "all" });
    expect(loads).toBe(1);
    service.meetingChanged(meetingID);
    await service.ask("again?", { kind: "all" });
    expect(loads).toBe(2);
    summaries = [];
    await service.ask("again?", { kind: "all" });
    expect(service.indexedMeetings).toBe(0);
  });
});
