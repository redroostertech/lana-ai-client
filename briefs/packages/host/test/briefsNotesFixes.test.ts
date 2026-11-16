import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AVAILABLE } from "@lana/core/ask";
import { saveVocabulary } from "@lana/core/gateway";
import { makeLanaId } from "@lana/core/ids";
import { localMeetingRecord } from "@lana/core/recording";
import type { TextModel, TextModelRequest } from "@lana/core/runtime";
import { MeetingsBridge } from "../src/main/gateway/meetingsBridge.js";
import { RecordsService } from "../src/main/gateway/recordsService.js";
import { NotesWriter } from "../src/main/services/recording/notesWriter.js";
import { openRealRig, type RealRig } from "./support/realRig.js";

// Synthetic meeting text only.
const TRANSCRIPT = [
  { speaker: "S1", start: 0, end: 10, text: "Let's go over the onboarding schedule for the Harbor account." },
  { speaker: "S2", start: 10, end: 20, text: "I'll send the revised schedule tonight and copy Priya." },
  { speaker: "S1", start: 20, end: 30, text: "Sorry, I have to take this call quickly." },
  { speaker: "S3", start: 30, end: 60, text: "Hi, calling about the plumber visit on Saturday." },
  { speaker: "S1", start: 60, end: 70, text: "Okay, back. The setup fee is 1,200 dollars." },
];

class Scripted implements TextModel {
  readonly modelID = "scripted";
  readonly prompts: string[] = [];
  constructor(private readonly replies: string[]) {}
  async availability() {
    return AVAILABLE;
  }
  async respond(request: TextModelRequest): Promise<string> {
    this.prompts.push(request.prompt);
    return this.replies[this.prompts.length - 1] ?? "SUMMARY: x";
  }
}

const REPLY = [
  "POINT: summary | L1 | The team went over the onboarding schedule.",
  "POINT: decision | L2 | S2 | Omar will send the revised schedule tonight and copy Priya.",
  "ASIDE: phone_call | L3, L4",
  "POINT: summary | L4 | A plumber visit is on Saturday.",
  "POINT: summary | L5 | The setup fee is 1,200 dollars.",
  "SUMMARY: Schedule and fees.",
].join("\n");

let rig: RealRig;
beforeEach(async () => {
  rig = await openRealRig();
});
afterEach(() => rig.cleanup());

function storeLocal(speakers = [{ id: "S1", name: "Dana Reyes" }, { id: "S2", name: "Omar Haddad" }, { id: "S3" }]) {
  const id = makeLanaId("meeting");
  rig.store.local.insert(localMeetingRecord({
    id, title: "Onboarding", startedAt: new Date(2026, 10, 11, 15, 0), durationSeconds: 70,
    consent: { method: "verbal_announced", confirmedBy: [], confirmedAt: rig.clock.now() },
    userNotes: [], appVersion: "0.1.0", speakers, transcript: TRANSCRIPT,
  }), []);
  return id;
}

function records(): RecordsService {
  return new RecordsService({ store: rig.store, sendToPhone: () => undefined, cancelSend: () => "cancelled" as never }, () => undefined, rig.log);
}

describe("notes for a meeting recorded here, with the notes fixes", () => {
  it("writes set-aside parts, an owner and a resolved due date, and uses the firm's word list", async () => {
    saveVocabulary(rig.store.settings, [{ term: "Leadli" }]);
    const id = storeLocal();
    const model = new Scripted([REPLY]);
    expect(await new NotesWriter(rig.store, model, rig.log).write(id, () => undefined)).toBe("written");
    expect(model.prompts[0]).toContain("Spell these names exactly: Leadli.");
    const record = rig.store.shared.current(id);
    expect(record.notes.setAside).toEqual([{ start: 20, end: 60, reason: "phone_call", speakers: ["S1", "S3"] }]);
    expect(record.notes.keyPoints.map((point) => point.text)).toEqual(["The team went over the onboarding schedule.", "The setup fee is 1,200 dollars."]);
    const actions = rig.store.intents.list({ meetingID: id });
    expect(actions).toHaveLength(1);
    expect(actions[0]!.intent.params).toMatchObject({ type: "task.create", task: { assigneeHint: "Omar Haddad", dueText: "tonight", dueDate: "2026-11-11" } });
  });

  it("does not add the same action twice when notes are written again", async () => {
    const id = storeLocal();
    await new NotesWriter(rig.store, new Scripted([REPLY]), rig.log).write(id, () => undefined);
    await new NotesWriter(rig.store, new Scripted([REPLY]), rig.log).write(id, () => undefined);
    expect(rig.store.intents.list({ meetingID: id }).filter((stored) => stored.intent.status !== "dismissed")).toHaveLength(1);
  });

  it("restores a set-aside part and lets the person set a range aside; writing the notes again keeps their list", async () => {
    const id = storeLocal();
    await new NotesWriter(rig.store, new Scripted([REPLY]), rig.log).write(id, () => undefined);
    const service = records();
    expect(await service.restoreSetAside(id, 20)).toEqual({ ok: true, value: null });
    expect(rig.store.shared.current(id).notes.setAside ?? []).toEqual([]);
    // A rewrite: the model's ASIDE lines are ignored, the person's (empty) list stays.
    await new NotesWriter(rig.store, new Scripted([REPLY]), rig.log).write(id, () => undefined);
    expect(rig.store.shared.current(id).notes.setAside ?? []).toEqual([]);

    expect(await service.setAside(id, 3, 3, "other_matter")).toEqual({ ok: true, value: null });
    expect(rig.store.shared.current(id).notes.setAside).toEqual([{ start: 30, end: 60, reason: "other_matter", speakers: ["S3"], by: "person" }]);
    const model = new Scripted([REPLY]);
    await new NotesWriter(rig.store, model, rig.log).write(id, () => undefined);
    expect(model.prompts[0]).not.toContain("plumber");
    expect(rig.store.shared.current(id).notes.setAside).toEqual([{ start: 30, end: 60, reason: "other_matter", speakers: ["S3"], by: "person" }]);
    expect((await service.setAside(id, 9, 9, "phone_call")).ok).toBe(false);
    expect((await service.setAside(id, 1, 1, "lunch" as never)).ok).toBe(false);
  });

  it("a rewrite replaces untouched actions instead of adding copies, and keeps ones the person acted on", async () => {
    const id = storeLocal();
    await new NotesWriter(rig.store, new Scripted([REPLY]), rig.log).write(id, () => undefined);
    const first = rig.store.intents.list({ meetingID: id });
    expect(first).toHaveLength(1);
    const renamed = REPLY.replace("Omar will send", "Omar Haddad will send");
    await new NotesWriter(rig.store, new Scripted([renamed]), rig.log).write(id, () => undefined);
    const after = rig.store.intents.list({ meetingID: id });
    expect(after.filter((stored) => stored.intent.status !== "dismissed")).toHaveLength(1);
    expect(after.find((stored) => stored.intent.id === first[0]!.intent.id)?.intent.status).toBe("dismissed");
  });

  it("the meeting view leaves out key points and actions that cite a part set aside later", async () => {
    const id = storeLocal();
    await new NotesWriter(rig.store, new Scripted([[
      "POINT: summary | L2 | The revised schedule goes out tonight.",
      "ACTION: task | L2 | Send revised schedule | Send it and copy Priya | tonight | S2 | none",
      "POINT: summary | L5 | The setup fee is 1,200 dollars.",
      "SUMMARY: x",
    ].join("\n")]), rig.log).write(id, () => undefined);
    await records().setAside(id, 1, 1, "side_conversation");
    const shown = await new MeetingsBridge(rig.store, rig.log).get(id);
    if (!shown.ok) throw new Error("not shown");
    expect(shown.value.keyPoints.map((point) => point.text)).toEqual(["The setup fee is 1,200 dollars."]);
    expect(shown.value.actions).toEqual([]);
  });

  it("shows the meeting with set-aside parts, tables, who decided, action owners and due dates", async () => {
    const id = storeLocal();
    await new NotesWriter(rig.store, new Scripted([[
      "POINT: decision | L5 | S1 | The setup fee is 1,200 dollars.",
      "TABLE: Fees | Item; Amount",
      "ROW: Fees | L5 | Setup fee; 1,200 dollars",
      "ACTION: task | L2 | Send revised schedule | Send the revised schedule and copy Priya | tonight | S2 | none",
      "ASIDE: phone_call | L3, L4",
      "SUMMARY: x",
    ].join("\n")]), rig.log).write(id, () => undefined);
    const shown = await new MeetingsBridge(rig.store, rig.log).get(id);
    if (!shown.ok) throw new Error("not shown");
    expect(shown.value.setAside).toEqual([{ start: 20, end: 60, reason: "phone_call", speakers: ["S1", "S3"] }]);
    expect(shown.value.tables).toEqual([{ title: "Fees", columns: ["Item", "Amount"], rows: [["Setup fee", "1,200 dollars"]], sources: [{ start: 60, end: 70, speaker: "S1" }] }]);
    expect(shown.value.keyPoints[0]).toMatchObject({ kind: "decision", decidedBy: "S1" });
    expect(shown.value.actions[0]).toMatchObject({ title: "Send revised schedule", owner: "Omar Haddad", dueDate: "2026-11-11", dueText: "tonight", start: 10, end: 20 });
    // S3 speaks only inside the set-aside part, so every speaker in the meeting itself has a name.
    expect(shown.value.speakersNamed).toBe(true);
    expect(shown.value.unnamedSpeakers).toEqual([]);
  });

  it("says when speakers in the meeting have no names yet", async () => {
    const id = storeLocal([{ id: "S1" }, { id: "S2", name: "Omar Haddad" }, { id: "S3" }]);
    const shown = await new MeetingsBridge(rig.store, rig.log).get(id);
    expect(shown.ok && shown.value.speakersNamed).toBe(false);
    // Only the speakers with lines in the meeting who have no name (S2 is named).
    expect(shown.ok && shown.value.unnamedSpeakers).toEqual(["S1", "S3"]);
  });
});

describe("seeding the word list from the firm's connectors", () => {
  it("seeds once when LANA lists connectors, and waits while it lists none or fails", async () => {
    const { seedVocabularyFromConnectors } = await import("../src/main/services/vocabularySeeding.js");
    const { loadVocabulary } = await import("@lana/core/gateway");
    expect(await seedVocabularyFromConnectors(rig.store.settings, async () => { throw new Error("offline"); }, rig.log)).toBe(false);
    expect(await seedVocabularyFromConnectors(rig.store.settings, async () => [], rig.log)).toBe(false);
    expect(await seedVocabularyFromConnectors(rig.store.settings, async () => ["Leadli", "Actionstep"], rig.log)).toBe(true);
    expect(await seedVocabularyFromConnectors(rig.store.settings, async () => ["Clio"], rig.log)).toBe(false);
    expect(loadVocabulary(rig.store.settings).map((entry) => entry.term)).toEqual(["Leadli", "Actionstep"]);
  });
});

describe("records written before strict reading", () => {
  it("never show raw | fields: a stored point keeps only its first field", async () => {
    const { pointText } = await import("../src/main/gateway/meetingsBridge.js");
    expect(pointText("Move the files to the new system | none | Dana | client matters | none")).toBe("Move the files to the new system");
    expect(pointText("Who signs? | The meeting left this open")).toBe("Who signs?");
    expect(pointText("A plain point.")).toBe("A plain point.");
    expect(pointText(" | only fields")).toBe("only fields");
  });
});

describe("Send to phone without audio", () => {
  it("the shared record view says which phones got the meeting without audio", async () => {
    const { phone } = await import("./support/realRig.js");
    await rig.store.pairDevice(phone.publicKeys, new Uint8Array(32).fill(7));
    const id = makeLanaId("meeting");
    rig.store.local.insert(localMeetingRecord({
      id, title: "Junk audio", startedAt: new Date(2026, 10, 11), durationSeconds: 70,
      consent: { method: "verbal_announced", confirmedBy: [], confirmedAt: rig.clock.now() }, userNotes: [], appVersion: "0.1.0", speakers: [{ id: "S1" }], transcript: TRANSCRIPT,
    }), [{ name: "seg-0000.m4a", data: new Uint8Array([9, 9, 9, 9, 9, 9, 9, 9]) }]);
    const before = await records().state(id);
    expect(before.ok && before.value.phones.map((item) => item.audioWithheld === true)).toEqual([false]);
    rig.store.shared.edit(id, (current) => ({ ...current, notes: { ...current.notes, setAside: [{ start: 20, end: 60, reason: "phone_call" as const }] } }));
    rig.store.shared.queueForPhone(id, phone.publicKeys.deviceID);
    expect(rig.store.shared.outgoing(phone.publicKeys, [])[0]).toMatchObject({ audio: [], audioWithheld: true });
    const after = await records().state(id);
    expect(after.ok && after.value.phones.map((item) => item.audioWithheld === true)).toEqual([true]);
  });
});
