import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { makeLanaId, type LanaId } from "../../src/ids/index.js";
import { makeIntent, type Intent, type MeetingRecord } from "../../src/intent/index.js";
import { localMeetingRecord } from "../../src/recording/index.js";
import { buildMeetingState, MeetingStates } from "../../src/state/index.js";
import type { FindMoreSuggestion } from "../../src/summarizer/index.js";
import { openRig, type StoreRig } from "../support/storeRig.js";

// Synthetic meeting text only.
const TRANSCRIPT = [
  { speaker: "S1", start: 0, end: 6, text: "Thanks for joining. Today we review the Harbor onboarding plan." },
  { speaker: "S2", start: 6, end: 12, text: "The setup fee is 1,200 dollars and the monthly fee is 300." },
  { speaker: "S2", start: 12, end: 20, text: "Sorry, my phone. Hi Sam, yes, Thursday works. Okay, bye." },
  { speaker: "S1", start: 20, end: 26, text: "" },
  { speaker: "S1", start: 26, end: 34, text: "Priya will send the checklist tonight." },
];

function record(rig: StoreRig, id: LanaId): MeetingRecord {
  return localMeetingRecord({
    id, title: "Harbor intake", startedAt: rig.clock.now(), durationSeconds: 34, consent: { method: "verbal_announced", confirmedBy: [], confirmedAt: rig.clock.now() },
    userNotes: [], appVersion: "0.1.0", speakers: [{ id: "S1", name: "Dana Reyes" }, { id: "S2", name: "Omar Haddad" }], transcript: TRANSCRIPT,
  });
}

function task(id: LanaId, title: string, status: Intent["status"] = "proposed"): Intent {
  return makeIntent({ meetingID: id, params: { type: "task.create", task: { title, detail: title } }, confidence: 0.7, evidence: [{ speaker: "S1", tStart: 26, tEnd: 34, quote: "Priya will send the checklist tonight." }], createdAt: new Date(1_800_000_000_000), status });
}

let rig: StoreRig;
let id: LanaId;
let states: MeetingStates;
beforeEach(async () => {
  rig = await openRig();
  id = makeLanaId("meeting", rig.clock.now());
  rig.store.local.insert(record(rig, id), []);
  rig.store.shared.edit(id, (current) => ({
    ...current,
    notes: {
      keyPoints: [{ id: "kp-1", kind: "summary", text: "The team reviewed the Harbor onboarding plan.", sources: [{ start: 0, end: 6, speaker: "S1" }], precision: "exact" }],
      gaps: [],
      setAside: [{ start: 12, end: 20, reason: "phone_call" }],
    },
  }));
  states = new MeetingStates(rig.store);
});
afterEach(() => rig.cleanup());

describe("meeting state: the snapshot", () => {
  it("reads one meeting with its visible lines, people and known items", () => {
    const state = states.load(id);
    expect(state.visibleTranscript.map((line) => line.index)).toEqual([0, 1, 4]);
    expect(state.isVisible(13, 19)).toBe(false);
    expect(state.isVisible(0, 6)).toBe(true);
    expect([...state.people]).toEqual(expect.arrayContaining(["dana", "omar", "haddad", "harbor", "sam"]));
    expect(state.keyPoints[0]).toMatchObject({ id: "kp-1", origin: "model" });
    expect(state.known(0, 6).map((item) => item.text)).toEqual(["The team reviewed the Harbor onboarding plan."]);
    expect(state.known(200, 210)).toEqual([]);
  });

  it("changes its version when the record or the local lists change, and not otherwise", () => {
    const first = states.load(id).version;
    expect(states.load(id).version).toBe(first);
    rig.store.shared.edit(id, (current) => ({ ...current, title: "Renamed" }));
    const second = states.load(id).version;
    expect(second).not.toBe(first);
    rig.store.findMore.saveRun(id, []);
    expect(states.load(id).version).toBe(second);
  });

  it("knows a repeat by the shared rules: rewording, same kind, task duplicates and suggestion lists", () => {
    const actions = [task(id, "Send the checklist")];
    const waiting: FindMoreSuggestion[] = [{ id: "s1", kind: "decision", text: "The pilot starts on the bronze plan.", sources: [{ start: 6, end: 12 }], precision: "exact" }];
    const state = buildMeetingState({ record: rig.store.shared.current(id), actions, vocabulary: [], waiting, dismissed: [], removed: [] });
    expect(state.isRepeat("The Harbor onboarding plan was reviewed by the team today.", "summary")).toBe(true);
    expect(state.isRepeat("The setup fee is 1,200 dollars.", "summary")).toBe(false);
    expect(state.isRepeat("The pilot starts on the bronze plan.", "decision")).toBe(true);
    expect(state.isRepeat("Send the checklist", "task", { intent: task(id, "Send the checklist") })).toBe(true);
    // The rewording rule can compare a part of the text (an answered question's answer).
    expect(state.isRepeat("Who reviewed what? Nothing new here at all today.", "summary", { compareText: "Nothing new here at all today." })).toBe(false);
  });

  it("knows what the person rejected: removed key points and dismissed actions or suggestions", () => {
    const state = buildMeetingState({
      record: rig.store.shared.current(id), actions: [task(id, "Call the vendor", "dismissed")], vocabulary: [], waiting: [],
      dismissed: [{ kind: "summary", text: "The monthly fee is 300 dollars.", sources: [{ start: 6, end: 12 }] }],
      removed: [{ kind: "decision", text: "The pilot starts in March.", sources: [{ start: 0, end: 6 }] }],
    });
    expect(state.isRejected("The pilot starts in March.", "decision")).toBe(true);
    expect(state.isRejected("The monthly fee is 300 dollars.", "summary")).toBe(true);
    expect(state.isRejected("Call the vendor", "task", task(id, "Call the vendor"))).toBe(true);
    expect(state.isRejected("The setup fee is 1,200 dollars.", "summary")).toBe(false);
    expect(state.dismissedActions).toHaveLength(1);
    expect(state.actions).toHaveLength(0);
  });
});

describe("meeting state: propose, the one write path", () => {
  it("adds LANA's key points through the shared record, leaving out repeats, uncited and set-aside ones", () => {
    const result = states.propose(id, [{ kind: "addKeyPoints", points: [
      { id: "kp-a", kind: "summary", text: "The setup fee is 1,200 dollars and the monthly fee is 300.", sources: [{ start: 6, end: 12 }], precision: "exact" },
      { id: "kp-b", kind: "summary", text: "The team reviewed the Harbor onboarding plan today.", sources: [{ start: 0, end: 6 }], precision: "exact" },
      { id: "kp-c", kind: "summary", text: "A call about Thursday.", sources: [{ start: 12, end: 20 }], precision: "exact" },
      { id: "kp-d", kind: "summary", text: "No citation.", sources: [], precision: "exact" },
    ] }], "model");
    expect(result).toMatchObject({ applied: 1, dropped: 3 });
    expect(result.state.keyPoints.map((point) => point.id)).toEqual(["kp-1", "kp-a"]);
    expect(rig.store.shared.current(id).sync?.clock["keypoint/kp-a"]?.desktop).toBeGreaterThan(0);
  });

  it("removes a key point and remembers it, so it is rejected later; edits sync as the computer's", () => {
    states.propose(id, [{ kind: "editKeyPoint", pointID: "kp-1", text: "The Harbor plan was reviewed." }], "person");
    expect(states.load(id).keyPoints[0]!.text).toBe("The Harbor plan was reviewed.");
    const removed = states.propose(id, [{ kind: "removeKeyPoint", pointID: "kp-1" }], "person");
    expect(removed.applied).toBe(1);
    expect(removed.state.keyPoints).toEqual([]);
    expect(removed.state.removed.map((item) => item.text)).toEqual(["The Harbor plan was reviewed."]);
    expect(removed.state.isRejected("The Harbor plan was reviewed.", "summary")).toBe(true);
    expect(states.propose(id, [{ kind: "removeKeyPoint", pointID: "kp-1" }], "person")).toMatchObject({ applied: 0, dropped: 1 });
  });

  it("puts Find more's suggestions on the waiting list, not in the notes, and adds them only when accepted", () => {
    const suggestion: FindMoreSuggestion = { id: "more-1", kind: "summary", text: "The setup fee is 1,200 dollars.", sources: [{ start: 6, end: 12 }], precision: "exact" };
    const aside: FindMoreSuggestion = { id: "more-2", kind: "summary", text: "Thursday works for the call.", sources: [{ start: 12, end: 20 }], precision: "exact" };
    const run = states.propose(id, [{ kind: "suggest", suggestions: [suggestion, aside] }], "find_more");
    expect(run).toMatchObject({ applied: 1, dropped: 1 });
    expect(run.state.waiting.map((item) => item.id)).toEqual(["more-1"]);
    expect(run.state.keyPoints).toHaveLength(1);
    const accepted = states.propose(id, [{ kind: "acceptSuggestions", suggestionIDs: ["more-1"] }], "person");
    expect(accepted.state.keyPoints.map((point) => point.origin)).toEqual(["model", "find_more"]);
    expect(accepted.state.waiting).toEqual([]);
  });
});
