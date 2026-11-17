import { describe, expect, it } from "vitest";
import { MeetingAskService, PassageBuilder, storeAskSource } from "../../src/ask/index.js";
import { makeIntent } from "../../src/intent/index.js";
import { buildMeetingState, visibleView } from "../../src/state/index.js";
import type { MeetingSummary, StoredIntent } from "../../src/store/index.js";
import { fact, meeting, ScriptedBackend } from "../support/askFakes.js";

// Synthetic meeting text only. A phone call (30 to 60 s) is set aside.
const record = meeting([
  ["S1", 0, "Thanks for meeting with us about the vendor contracts."],
  ["S2", 30, "Hi, it is about the dentist appointment, can you move it to Friday?"],
  ["S2", 45, "Sure, Friday morning works, bye."],
  ["S1", 70, "Please send the engagement letter by Friday so we can start."],
], { notes: { keyPoints: [], gaps: [], setAside: [{ start: 30, end: 60, reason: "phone_call" }] } });

const asideTask = makeIntent({
  meetingID: record.id, params: { type: "task.create", task: { title: "Move the dentist appointment", detail: "" } }, confidence: 0.7,
  evidence: [{ speaker: "S2", tStart: 30, tEnd: 38, quote: "can you move it to Friday?" }], createdAt: new Date(1_800_000_000_000),
});
const letterTask = makeIntent({
  meetingID: record.id, params: { type: "task.create", task: { title: "Send the engagement letter", detail: "" } }, confidence: 0.7,
  evidence: [{ speaker: "S1", tStart: 70, tEnd: 78, quote: "Please send the engagement letter by Friday so we can start." }], createdAt: new Date(1_800_000_000_000),
});

describe("Ask and Talk read the visible view of the meeting state", () => {
  it("builds passages from the same visible lines the state shows", () => {
    const view = visibleView(record);
    const state = buildMeetingState({ record, actions: [], vocabulary: [], waiting: [], dismissed: [], removed: [] });
    expect(view.visibleTranscript.map((line) => line.index)).toEqual(state.visibleTranscript.map((line) => line.index));
    const text = new PassageBuilder(40, 0).passages(record).map((passage) => passage.text).join("\n");
    expect(text).not.toContain("dentist");
    expect(text).toContain("engagement letter");
  });

  it("never offers an action's history when the action cites a set-aside part", async () => {
    const summary = { id: record.id, title: record.title, startedAt: record.startedAt } as MeetingSummary;
    const stored = (intent: typeof asideTask): StoredIntent => ({ intent, resolution: null, updatedAt: new Date() });
    const source = storeAskSource({
      meetings: { list: () => [summary], get: () => record },
      intents: { list: () => [stored(asideTask), stored(letterTask)], history: () => [] },
    });
    const backend = new ScriptedBackend((request) => fact("Noted.", request.passages.slice(0, 1).map((passage) => passage.label), true));
    const service = new MeetingAskService(source, backend, { timeZone: "UTC" });
    await service.ask("What happens with the dentist appointment?", { kind: "meeting", id: record.id });
    const sent = backend.requests.flatMap((request) => request.passages.map((passage) => passage.text)).join("\n");
    expect(sent).not.toContain("dentist");
    const history = await service.historyPassages({ kind: "meeting", id: record.id });
    expect(history.map((passage) => passage.text).join("\n")).not.toContain("dentist");
    expect(history.map((passage) => passage.text).join("\n")).toContain("Send the engagement letter");
  });
});
