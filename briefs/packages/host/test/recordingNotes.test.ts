import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AVAILABLE, BackendError, unavailable } from "@lana/core/ask";
import { makeLanaId } from "@lana/core/ids";
import { localMeetingRecord, type TranscriptionModelPaths } from "@lana/core/recording";
import type { TextModel, TextModelRequest } from "@lana/core/runtime";
import type { LanaEvent, RecordingView } from "../src/shared/api.js";
import { NotesWriter, type NotesWriting } from "../src/main/services/recording/notesWriter.js";
import { RecordingService, type MeetingTranscription } from "../src/main/services/recording/recordingService.js";
import { openRealRig, type RealRig } from "./support/realRig.js";

const MODELS: TranscriptionModelPaths = { vad: "v", parakeet: "p", segmentation: "s", embedding: "e" };
const TRANSCRIPT = [
  { speaker: "S1", start: 0, end: 4, text: "Thanks for joining. Let's review the Acme intake today." },
  { speaker: "S2", start: 4.5, end: 9, text: "I will send the engagement letter to Acme Logistics by Friday." },
  { speaker: "S1", start: 9.5, end: 13, text: "We agreed to mediation in December." },
];

class Scripted implements TextModel {
  readonly modelID = "scripted";
  calls = 0;
  constructor(private readonly replies: Array<string | BackendError>, private readonly available = true) {}
  async availability() {
    return this.available ? AVAILABLE : unavailable("modelNotReady");
  }
  async respond(_request: TextModelRequest): Promise<string> {
    const next = this.replies[this.calls++];
    if (next === undefined || next instanceof BackendError) throw next ?? BackendError.failed("exhausted");
    return next;
  }
}

const REPLY = [
  "POINT: summary | 1 | The team reviewed the Acme intake.",
  "POINT: decision | 3 | Mediation in December.",
  "ACTION: task | 2 | Send the engagement letter | By Friday | none | S2 | Acme Logistics",
  "ACTION: task | 99 | Invented line | x | none | none | none",
  "SUMMARY: Intake reviewed.",
].join("\n");

let rig: RealRig;
beforeEach(async () => {
  rig = await openRealRig();
});
afterEach(() => rig.cleanup());

function storeLocal() {
  const id = makeLanaId("meeting");
  rig.store.local.insert(localMeetingRecord({
    id, title: "Intake", startedAt: rig.clock.now(), durationSeconds: 13, consent: { method: "verbal_announced", confirmedBy: [], confirmedAt: rig.clock.now() },
    userNotes: [], appVersion: "0.1.0", speakers: [{ id: "S1" }, { id: "S2" }], transcript: TRANSCRIPT,
  }), []);
  return id;
}

describe("LANA's notes for a meeting recorded here", () => {
  it("writes cited key points and validated actions into the record and the Inbox, never an invented one", async () => {
    const id = storeLocal();
    const outcome = await new NotesWriter(rig.store, new Scripted([REPLY]), rig.log).write(id, () => undefined);
    expect(outcome).toBe("written");
    const record = rig.store.shared.current(id);
    expect(record.notes.keyPoints.map((point) => [point.kind, point.text, point.sources[0]?.start])).toEqual([["summary", "The team reviewed the Acme intake.", 0], ["decision", "Mediation in December.", 9.5]]);
    expect(record.intents).toHaveLength(1);
    expect(record.intents[0]).toMatchObject({ type: "task.create", status: "transferred" });
    expect(record.intents[0]!.evidence[0]?.quote).toBe(TRANSCRIPT[1]!.text);
    expect(record.provenance.notesModel).toBe("scripted");
    expect(rig.store.meetings.list()[0]?.openIntents).toBe(1);
    expect(rig.log.lines.join("\n")).not.toContain("engagement");
  });

  it("says unavailable without the LANA model, and changes nothing", async () => {
    const id = storeLocal();
    expect(await new NotesWriter(rig.store, new Scripted([], false), rig.log).write(id, () => undefined)).toBe("unavailable");
    expect(rig.store.shared.current(id).notes.keyPoints).toEqual([]);
  });

  it("records a gap for a part the model could not do, and keeps the rest", async () => {
    const id = storeLocal();
    // First call fails, the kernel retries once, that fails too: the chunk is skipped.
    expect(await new NotesWriter(rig.store, new Scripted([BackendError.failed("x"), BackendError.failed("x")]), rig.log).write(id, () => undefined)).toBe("written");
    expect(rig.store.shared.current(id).notes.gaps).toEqual([{ start: 0, end: 13, reason: "model_error" }]);
  });
});

describe("notes after Stop", () => {
  const transcription: MeetingTranscription = { transcribe: async () => ({ speakers: [{ id: "S1" }], transcript: TRANSCRIPT }) };
  function service(notes: NotesWriting, events: LanaEvent[]): RecordingService {
    const created: RecordingService = new RecordingService({
      store: rig.store,
      emit: (event) => {
        events.push(event);
        if (event.type === "recordingAudio" && event.command.kind === "stop") void created.captureStopped();
      },
      log: rig.log, appVersion: "0.1.0", transcription, notes,
      models: { isReady: () => true, paths: () => MODELS },
      permissions: () => ({ microphone: "granted", meetingAudio: "granted" }),
      openPrivacySettings: async () => undefined, requestMicrophone: async () => true, armMeetingAudio: () => undefined, meetingStored: () => undefined,
    });
    return created;
  }
  const record = async (target: RecordingService) => {
    await target.start({ title: "Intake", consent: "announced", participants: [], jurisdictionNote: "" });
    await target.captureStarted(true);
    target.frame({ mic: new Float32Array(16_000).fill(0.3), system: new Float32Array(16_000), aac: [new Uint8Array([1, 2])] });
    await target.stop();
    await target.idle();
  };

  it("writes the notes, with progress, before the meeting page opens", async () => {
    const events: LanaEvent[] = [];
    await record(service(new NotesWriter(rig.store, new Scripted([REPLY]), rig.log), events));
    const views = events.flatMap((event) => (event.type === "recording" ? [event.view] : [])) as RecordingView[];
    expect(views.map((view) => view.phase)).toEqual(expect.arrayContaining(["transcribing", "writingNotes", "done"]));
    expect(views.at(-1)).toMatchObject({ phase: "done", message: null });
    expect(rig.store.shared.current(views.at(-1)!.meetingID as never).notes.keyPoints).toHaveLength(2);
  });

  it("never loses or blocks the meeting when the notes fail; Write notes runs them later", async () => {
    const events: LanaEvent[] = [];
    const broken: NotesWriting = { write: async () => { throw new Error("boom"); } };
    const target = service(broken, events);
    await record(target);
    const last = events.flatMap((event) => (event.type === "recording" ? [event.view] : [])).at(-1)!;
    expect(last).toMatchObject({ phase: "done" });
    expect(last.message).toContain("Write notes");
    const id = last.meetingID!;
    expect(rig.store.shared.current(id as never).transcript).toHaveLength(3);
    const again = service(new NotesWriter(rig.store, new Scripted([REPLY]), rig.log), []);
    expect(await again.writeNotes(id)).toEqual({ ok: true, value: null });
    expect(rig.store.shared.current(id as never).notes.keyPoints).toHaveLength(2);
    expect((await again.writeNotes("mtg_nope")).ok).toBe(false);
  });

  it("says how to get notes when the LANA model is not on this computer", async () => {
    const events: LanaEvent[] = [];
    await record(service(new NotesWriter(rig.store, new Scripted([], false), rig.log), events));
    const last = events.flatMap((event) => (event.type === "recording" ? [event.view] : [])).at(-1)!;
    expect(last.message).toContain("LANA model is needed");
  });
});
