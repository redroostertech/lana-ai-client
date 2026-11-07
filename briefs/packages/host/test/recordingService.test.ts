import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { unpackPcm, type TranscriptionModelPaths } from "@lana/core/recording";
import type { LanaEvent, RecordingFrame, RecordingView } from "../src/shared/api.js";
import { MeetingsBridge } from "../src/main/gateway/meetingsBridge.js";
import { RecordingService, type MeetingTranscription } from "../src/main/services/recording/recordingService.js";
import { InProcessTranscription } from "../src/main/services/recording/workerTranscription.js";
import { openRealRig, type RealRig } from "./support/realRig.js";

const RATE = 16_000;
const MODELS: TranscriptionModelPaths = { vad: "v", parakeet: "p", segmentation: "s", embedding: "e" };

/** Labels each 16 kHz second by the louder channel, as a stand-in for the real models. */
class FakeTranscription implements MeetingTranscription {
  calls = 0;
  fail = false;
  async transcribe(_models: TranscriptionModelPaths, pcm: Uint8Array[], progress: (fraction: number) => void) {
    this.calls += 1;
    if (this.fail) throw new Error("model");
    progress(0.5);
    const { mic, system } = unpackPcm(pcm);
    const seconds = Math.floor(mic.length / RATE);
    const transcript = Array.from({ length: seconds }, (_, second) => {
      const loud = (channel: Float32Array) => Math.abs(channel[second * RATE + 10] ?? 0);
      return { speaker: loud(mic) >= loud(system) ? "S1" : "S2", start: second, end: second + 1, text: `Line ${second}` };
    });
    progress(1);
    return { speakers: [...new Set(transcript.map((line) => line.speaker))].sort().map((id) => ({ id })), transcript };
  }
}

/** One second of 16 kHz audio on one side, with AAC frames for it. */
function second(side: "mic" | "system"): RecordingFrame {
  const loud = new Float32Array(RATE).fill(0.4);
  const quiet = new Float32Array(RATE);
  return { mic: side === "mic" ? loud : quiet, system: side === "system" ? loud : quiet, aac: Array.from({ length: 47 }, () => new Uint8Array([0x21, 0x10, 0x05])) };
}

let rig: RealRig;
let events: LanaEvent[];
let transcription: FakeTranscription;
let ready: boolean;
let service: RecordingService;
let stored: string[];

function makeService(options: { transcription?: MeetingTranscription } = {}): RecordingService {
  const created: RecordingService = new RecordingService({
    store: rig.store,
    emit: (event) => {
      events.push(event);
      // The window: flushes its encoder and says so when asked to stop.
      if (event.type === "recordingAudio" && event.command.kind === "stop") void created.captureStopped();
    },
    log: rig.log,
    appVersion: "0.1.0",
    transcription: options.transcription ?? transcription,
    models: { isReady: () => ready, paths: () => MODELS },
    permissions: () => ({ microphone: "granted", meetingAudio: "granted" }),
    openPrivacySettings: async () => undefined,
    requestMicrophone: async () => true,
    armMeetingAudio: () => undefined,
    meetingStored: (id) => stored.push(id),
  });
  return created;
}

const consent = { title: "  Acme intake  ", consent: "announced" as const, participants: [], jurisdictionNote: "" };
const views = () => events.flatMap((event) => (event.type === "recording" ? [event.view] : []));
const lastView = (): RecordingView => views().at(-1)!;
const settle = async (target: RecordingService) => {
  await target.idle();
};

beforeEach(async () => {
  rig = await openRealRig();
  events = [];
  stored = [];
  ready = true;
  transcription = new FakeTranscription();
  service = makeService();
});
afterEach(() => rig.cleanup());

describe("recording a meeting on this computer", () => {
  it("records both sides, stores the meeting with its audio, and transcribes it after Stop", async () => {
    const started = await service.start(consent);
    expect(started.ok).toBe(true);
    expect(events).toContainEqual({ type: "recordingAudio", command: { kind: "start" } });
    await service.captureStarted(true);
    expect(lastView()).toMatchObject({ phase: "recording", title: "Acme intake", meetingAudio: "on" });
    service.frame(second("mic"));
    service.frame(second("system"));
    await service.pause();
    service.frame(second("system")); // Dropped while paused.
    await service.resume();
    service.frame(second("mic"));
    await service.saveNotes([{ id: "n1", text: "Ask about the warehouse", anchor: 1.5 }]);
    await service.stop();
    await settle(service);

    const id = lastView().meetingID!;
    expect(lastView()).toMatchObject({ phase: "done", meetingID: id, message: null });
    expect(views().map((view) => view.phase)).toEqual(expect.arrayContaining(["starting", "recording", "paused", "saving", "transcribing", "done"]));
    const [summary] = rig.store.meetings.list();
    expect(summary).toMatchObject({ id, title: "Acme intake", origin: "computer", audioAvailable: true });
    expect(summary!.durationSeconds).toBeCloseTo(3, 1);
    const record = rig.store.shared.current(summary!.id);
    expect(record.transcript.map((line) => line.speaker)).toEqual(["S1", "S2", "S1"]);
    expect(record.speakers).toEqual([{ id: "S1" }, { id: "S2" }]);
    expect(record.consent.method).toBe("verbal_announced");
    expect(record.userNotes.map((note) => [note.text, note.anchor])).toEqual([["Ask about the warehouse", 1.5]]);
    expect(rig.store.meetings.audioParts(summary!.id)).toHaveLength(1);
    const shown = await new MeetingsBridge(rig.store, rig.log).get(id);
    expect(shown.ok && shown.value.attestationMethod).toBe("recordedHere");
    expect(shown.ok && shown.value.consent).toBe("announced");
    // The journal is gone once the transcript is saved; the store announced the meeting.
    expect(readdirSync(join(rig.store.directory, "recordings"))).toEqual([]);
    expect(stored).toEqual([id, id]);
    expect(rig.log.lines.join()).not.toContain("journal_unreadable");
    // Ids and states only in the logs.
    const logged = rig.log.lines.join("\n");
    for (const secret of ["Acme", "warehouse", "Line 0"]) expect(logged).not.toContain(secret);
  });

  it("refuses to start without LANA transcription, or while another recording runs", async () => {
    ready = false;
    expect(await service.start(consent)).toMatchObject({ ok: false, error: { code: "transcriptionMissing" } });
    ready = true;
    expect((await service.start(consent)).ok).toBe(true);
    expect(await service.start(consent)).toMatchObject({ ok: false, error: { code: "busy" } });
  });

  it("keeps nothing when the microphone cannot open", async () => {
    await service.start(consent);
    await service.captureFailed("denied");
    expect(lastView()).toMatchObject({ phase: "failed" });
    expect(lastView().message).toContain("Microphone");
    expect(readdirSync(join(rig.store.directory, "recordings"))).toEqual([]);
    expect(rig.store.meetings.list()).toEqual([]);
  });

  it("says when only the microphone is recorded", async () => {
    await service.start(consent);
    await service.captureStarted(false);
    expect(lastView()).toMatchObject({ phase: "recording", meetingAudio: "off" });
    expect(lastView().message).toContain("Screen and System Audio Recording");
  });

  it("recovers a recording a crash cut off: stored and transcribed at the next launch", async () => {
    await service.start(consent);
    await service.captureStarted(true);
    service.frame(second("mic"));
    service.frame(second("system"));
    service.frame({ ...second("mic"), mic: new Float32Array(RATE / 2).fill(0.4), system: new Float32Array(RATE / 2) }); // Not yet sealed: lost.
    // The process dies here: no stop, no shutdown. The next launch:
    events = [];
    const next = makeService();
    await next.recover();
    const [summary] = rig.store.meetings.list();
    expect(summary).toMatchObject({ title: "Acme intake", origin: "computer", audioAvailable: true });
    expect(rig.store.shared.current(summary!.id).transcript.map((line) => line.speaker)).toEqual(["S1", "S2"]);
    expect(readdirSync(join(rig.store.directory, "recordings"))).toEqual([]);
    // A recovery never takes over the window.
    expect(views()).toEqual([]);
  });

  it("keeps the meeting when transcription fails, and transcribes it at the next launch", async () => {
    transcription.fail = true;
    await service.start(consent);
    await service.captureStarted(true);
    service.frame(second("mic"));
    await service.stop();
    await settle(service);
    expect(lastView()).toMatchObject({ phase: "done" });
    expect(lastView().message).toContain("audio are saved");
    const [summary] = rig.store.meetings.list();
    expect(summary).toMatchObject({ audioAvailable: true });
    expect(rig.store.shared.current(summary!.id).transcript).toEqual([]);
    transcription.fail = false;
    await makeService().recover();
    expect(rig.store.shared.current(summary!.id).transcript).toHaveLength(1);
    expect(readdirSync(join(rig.store.directory, "recordings"))).toEqual([]);
  });

  it("stores a recording in progress when the app quits, and transcribes it next time", async () => {
    await service.start(consent);
    await service.captureStarted(true);
    service.frame({ ...second("mic"), mic: new Float32Array(RATE / 2).fill(0.4), system: new Float32Array(RATE / 2) });
    await service.shutdown();
    await makeService().recover();
    expect(rig.store.meetings.list()).toHaveLength(1);
  });
});

describe("importing a recording", () => {
  it("stores a picked file as a meeting recorded here and transcribes it by voice alone", async () => {
    const opened = await service.beginImport({ ...consent, title: "Voice memo" });
    expect(opened.ok).toBe(true);
    expect(lastView()).toMatchObject({ phase: "importing", meetingAudio: "off" });
    service.frame(second("mic"));
    service.frame(second("mic"));
    await service.importProgress(0.5);
    expect(lastView().progress).toBe(0.5);
    await service.finishImport();
    await settle(service);
    const [summary] = rig.store.meetings.list();
    expect(summary).toMatchObject({ title: "Voice memo", origin: "computer", audioAvailable: true });
    expect(rig.store.shared.current(summary!.id).transcript).toHaveLength(2);
    expect(lastView()).toMatchObject({ phase: "done", meetingID: summary!.id });
  });

  it("keeps nothing for a file that could not be read", async () => {
    await service.beginImport(consent);
    await service.cancelImport("unreadable");
    expect(lastView()).toMatchObject({ phase: "failed" });
    expect(rig.store.meetings.list()).toEqual([]);
    expect(readdirSync(join(rig.store.directory, "recordings"))).toEqual([]);
    // An import with no audio at all is the same.
    await service.beginImport(consent);
    await service.finishImport();
    expect(rig.store.meetings.list()).toEqual([]);
  });

  /**
   * Real models (opt in, macOS): `LANA_RUN_SPEECH_TESTS=1 LANA_SPEECH_MODELS_DIR=<folder>`.
   * A two-voice "voice memo" (one mono track) goes the whole import path with the real
   * transcriber and diarizer.
   */
  it.runIf(process.env["LANA_RUN_SPEECH_TESTS"] === "1" && process.platform === "darwin")("transcribes a real two-voice file and tells the voices apart", async () => {
    const directory = process.env["LANA_SPEECH_MODELS_DIR"] ?? "";
    const { transcriptionModelPaths } = await import("@lana/core/recording");
    const real = new RecordingService({ ...optionsFor(), transcription: new InProcessTranscription(), models: { isReady: () => true, paths: () => transcriptionModelPaths(directory) } });
    const voices: Array<[string, string]> = [
      ["Samantha", "Thanks for joining. Let's review the Acme intake and the filing deadline next Friday."],
      ["Daniel", "Sure. I spoke with the client yesterday and they want the draft by Wednesday."],
      ["Samantha", "Okay, I will send the engagement letter today and schedule a follow up call."],
      ["Daniel", "Great. Can you also check whether the insurance policy covers the warehouse?"],
    ];
    const folder = join(rig.directory, "voices");
    execFileSync("/bin/mkdir", ["-p", folder]);
    await real.beginImport({ ...consent, title: "Voice memo" });
    for (const [index, [name, text]] of voices.entries()) {
      const aiff = join(folder, `${index}.aiff`);
      const wav = join(folder, `${index}.wav`);
      execFileSync("/usr/bin/say", ["-v", name, "-o", aiff, text]);
      execFileSync("/usr/bin/afconvert", ["-f", "WAVE", "-d", "LEI16@16000", "-c", "1", aiff, wav]);
      const data = readFileSync(wav);
      const start = data.indexOf("data") + 8;
      const samples = new Float32Array((data.length - start) / 2 + RATE * 0.8);
      for (let at = 0; at < (data.length - start) / 2; at += 1) samples[at] = data.readInt16LE(start + at * 2) / 0x8000;
      real.frame({ mic: samples, system: new Float32Array(samples.length), aac: [new Uint8Array([0x21, 0x10])] });
    }
    await real.finishImport();
    await real.idle();
    const [summary] = rig.store.meetings.list();
    const record = rig.store.shared.current(summary!.id);
    expect(record.transcript.map((line) => line.speaker)).toEqual(["S1", "S2", "S1", "S2"]);
    expect(record.transcript.map((line) => line.text).join(" ").toLowerCase()).toContain("warehouse");
    expect(existsSync(join(rig.store.directory, "recordings", summary!.id))).toBe(false);
  }, 120_000);
});

function optionsFor() {
  return {
    store: rig.store,
    emit: (event: LanaEvent) => void events.push(event),
    log: rig.log,
    appVersion: "0.1.0",
    permissions: () => ({ microphone: "granted" as const, meetingAudio: "granted" as const }),
    openPrivacySettings: async () => undefined,
    requestMicrophone: async () => true,
    armMeetingAudio: () => undefined,
    meetingStored: () => undefined,
  };
}
