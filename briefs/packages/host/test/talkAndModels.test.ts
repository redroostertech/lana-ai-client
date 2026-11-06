import { AVAILABLE, type AskAnswer, type Passage } from "@lana/core/ask";
import { LanaRuntimeTextModel, SpeechModelStore, type FetchLike, type SpeechModelPackage } from "@lana/core/model";
import { createRequire } from "node:module";

// The LANA client's catalog: the one list of every model the client downloads.
const CATALOG_SPEECH = (createRequire(import.meta.url)("../../../../electron-local-models.js") as { speechPackages(): SpeechModelPackage[] }).speechPackages();
import type { TalkAnswerer, TalkHearing, TalkListener, TalkSpeaker } from "@lana/core/talk";
import { MeetingAskService, storeAskSource, decodeSavedAskTurns } from "@lana/core/ask";
import { RuntimeAnswerBackend } from "@lana/core/runtime";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LanaEvent, ModelsStatus, PlatformInfo, TalkAudioCommand, TalkSession as TalkView, VoiceOption } from "../src/shared/api.js";
import { AskService } from "../src/main/services/ask/askService.js";
import { ScriptedAskModel } from "../src/main/services/ask/scriptedAskModel.js";
import { ModelService, sizeText } from "../src/main/services/models/modelService.js";
import { MicrophoneError, RendererAudio } from "../src/main/services/talk/rendererAudio.js";
import { TALK_INTRO_ACCEPTED, TalkService, type TalkParts, type TalkPartsFactory } from "../src/main/services/talk/talkService.js";
import { readVoice, VOICE_SETTING_KEYS } from "../src/main/services/preferencesService.js";
import { openRealRig, receiveGoldenMeeting, RecordingLog, type RealRig } from "./support/realRig.js";

const platform: PlatformInfo = { os: "mac", deviceNoun: "computer", appVersion: "0.1.0", isDemo: false, features: { ask: true, talk: true } };
const sha = (data: Uint8Array): string => createHash("sha256").update(data).digest("hex");
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

let folder: string;
beforeEach(() => {
  folder = mkdtempSync(join(tmpdir(), "lana-models-"));
});
afterEach(() => rmSync(folder, { recursive: true, force: true }));

function streamOf(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (let index = 0; index < bytes.length; index += 64) controller.enqueue(bytes.slice(index, index + 64));
      controller.close();
    },
  });
}

function models(options: { fetch?: FetchLike; speech?: SpeechModelPackage[]; engineBase?: string | null; token?: string | null } = {}) {
  const fetch: FetchLike = options.fetch ?? (async () => ({ status: 200, body: streamOf(new Uint8Array(4)) }));
  const pushed: ModelsStatus[] = [];
  const log = new RecordingLog();
  const runtime = { engine: options.engineBase === undefined ? "http://127.0.0.1:8079" : options.engineBase, token: options.token === undefined ? "tok" : options.token };
  const service = new ModelService({
    directory: folder,
    platform,
    emit: (status) => pushed.push(status),
    log,
    runtime: { engineBase: () => runtime.engine, token: () => runtime.token },
    speechPackages: options.speech ?? CATALOG_SPEECH,
    speech: new SpeechModelStore({ directory: join(folder, "speech"), fetch, packages: options.speech ?? CATALOG_SPEECH }),
  });
  return { service, pushed, log, runtime };
}

describe("ModelService", () => {
  it("the LANA model is LANA's runtime: ready while the engine runs and a session is there, never downloaded or removed here", async () => {
    const { service, pushed, runtime } = models();
    expect((await service.status()).ask).toMatchObject({ state: { kind: "ready" }, title: "LANA model", shared: true, sizeText: "" });
    expect(service.isReady("ask")).toBe(true);
    expect((await service.download("ask")).ask.state).toEqual({ kind: "ready" });
    expect((await service.remove("ask")).ask.state).toEqual({ kind: "ready" });
    expect(pushed).toEqual([]);
    runtime.engine = null;
    expect((await service.status()).ask.state).toEqual({ kind: "notDownloaded" });
    runtime.engine = "http://127.0.0.1:8079";
    runtime.token = null;
    expect(service.isReady("ask")).toBe(false);
  });

  it("gives each kind of work LANA's runtime with its own purpose; background work waits behind a person", async () => {
    const { service } = models();
    const ask = service.textModel("briefs.ask");
    expect(ask).toBeInstanceOf(LanaRuntimeTextModel);
    expect(ask.modelID).toBe("lana-runtime");
    expect(await ask.availability()).toEqual({ available: true });
    const sent: Array<Record<string, unknown>> = [];
    const capture = (purpose: "briefs.notes" | "briefs.ask") => new LanaRuntimeTextModel({
      engineBase: () => "http://e", token: () => "t", purpose, priority: purpose === "briefs.notes" ? "background" : "foreground",
      fetch: async (_url, init) => (sent.push(JSON.parse(init.body) as Record<string, unknown>), { ok: true, status: 200, body: null, json: async () => ({ data: { content: "x" } }), text: async () => "" }),
    });
    await capture("briefs.notes").respond({ instructions: "i", prompt: "p", temperature: 0, maximumResponseTokens: 10 });
    await capture("briefs.ask").respond({ instructions: "i", prompt: "p", temperature: 0, maximumResponseTokens: 10 });
    expect(sent.map((body) => [body["purpose"], body["priority"]])).toEqual([["briefs.notes", "background"], ["briefs.ask", "foreground"]]);
  });

  it("downloads the Talk listener and the LANA voice through the speech store", async () => {
    const vad = new TextEncoder().encode("vad-model");
    const voice = new TextEncoder().encode("voice-model");
    const files: Record<string, Uint8Array> = { "https://example.test/vad": vad, "https://example.test/voice": voice };
    const pkg = (id: "vad" | "kokoro", url: string, data: Uint8Array): SpeechModelPackage => ({
      id, target: `${id}.onnx`, files: [{ path: `${id}.onnx`, bytes: data.length, sha256: sha(data), url }],
    });
    const parakeet: SpeechModelPackage = { ...pkg("vad", "https://example.test/vad", vad), id: "parakeet" };
    const { service } = models({
      fetch: async (url) => ({ status: 200, body: streamOf(files[url]!) }),
      speech: [pkg("vad", "https://example.test/vad", vad), parakeet, pkg("kokoro", "https://example.test/voice", voice)],
    });
    const seen: number[] = [];
    await service.ensure("listener", (fraction) => seen.push(fraction));
    expect(service.isReady("listener")).toBe(true);
    expect(seen.at(-1)).toBe(1);
    expect(service.isReady("voice")).toBe(false);
    await service.ensure("voice");
    expect((await service.status()).voice.state).toEqual({ kind: "ready" });
  });

  it("downloads a package two models share once when both start together, and both end ready", async () => {
    const data = (text: string) => new TextEncoder().encode(text);
    const files: Record<string, Uint8Array> = {
      "https://models.test/vad": data("vad-model"), "https://models.test/parakeet": data("parakeet-model".repeat(50)),
      "https://models.test/segmentation": data("segmentation"), "https://models.test/embedding": data("embedding"),
    };
    const fetched: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    files["https://models.test/kokoro"] = data("kokoro");
    const speech = (["vad", "parakeet", "segmentation", "embedding", "kokoro"] as const).map((id): SpeechModelPackage => {
      const bytes = files[`https://models.test/${id}`]!;
      return { id, target: `${id}.onnx`, files: [{ path: `${id}.onnx`, bytes: bytes.length, sha256: sha(bytes), url: `https://models.test/${id}` }] };
    });
    const { service, pushed } = models({
      fetch: async (url) => {
        fetched.push(url);
        await gate;
        return { status: 200, body: streamOf(files[url]!) };
      },
      speech,
    });
    await service.download("transcription");
    await service.download("listener");
    release();
    await vi.waitFor(() => expect(pushed.at(-1)).toMatchObject({ listener: { state: { kind: "ready" } }, transcription: { state: { kind: "ready" } } }));
    expect(service.isReady("listener") && service.isReady("transcription")).toBe(true);
    expect(fetched.sort()).toEqual(Object.keys(files).filter((url) => !url.endsWith("kokoro")).sort());
    expect(pushed.some((status) => status.listener.state.kind === "failed" || status.transcription.state.kind === "failed")).toBe(false);
  });

  it("resumes cut-off speech downloads at launch from their .part files", async () => {
    const voice = new TextEncoder().encode("voice-model-bytes");
    const speech: SpeechModelPackage[] = (["vad", "parakeet", "segmentation", "embedding", "kokoro"] as const).map((id) => ({
      id, target: `${id}.onnx`,
      files: [{ path: `${id}.onnx`, bytes: voice.length, sha256: sha(voice), url: `https://models.test/${id}` }],
    }));
    const ranges: Record<string, string> = {};
    const fetch: FetchLike = async (url, init) => {
      ranges[url] = init.headers["Range"] ?? "";
      const from = Number(/bytes=(\d+)-/.exec(init.headers["Range"] ?? "")?.[1] ?? 0);
      return { status: from > 0 ? 206 : 200, body: streamOf(voice.slice(from)) };
    };
    // A download an earlier launch was in the middle of: half of the voice file, and no pending mark.
    mkdirSync(join(folder, "speech"), { recursive: true });
    writeFileSync(join(folder, "speech", "kokoro.onnx.part"), voice.slice(0, 5));
    const { service, pushed } = models({ fetch, speech });
    expect(service.snapshotState("voice")).toEqual({ kind: "notDownloaded" });
    expect(service.resumePending()).toEqual(["voice"]);
    await vi.waitFor(() => expect(pushed.at(-1)).toMatchObject({ voice: { state: { kind: "ready" } } }));
    expect(Object.values(ranges)).toEqual(["bytes=5-"]);
    expect(service.resumePending()).toEqual([]);
  });

  it("says plainly when a speech download fails, and resumes it at the next launch", async () => {
    const data = new TextEncoder().encode("voice");
    const speech: SpeechModelPackage[] = (["vad", "parakeet", "segmentation", "embedding", "kokoro"] as const).map((id) => ({
      id, target: `${id}.onnx`,
      files: [{ path: `${id}.onnx`, bytes: data.length, sha256: sha(data), url: `https://models.test/${id}` }],
    }));
    const { service: before, pushed } = models({ fetch: async () => ({ status: 503, body: null }), speech });
    await expect(before.ensure("voice")).rejects.toBeDefined();
    expect(pushed.at(-1)?.voice.state).toEqual({ kind: "failed", message: "The LANA voice could not be downloaded. Check the connection and try again." });
    const { service } = models({ fetch: async () => ({ status: 200, body: streamOf(data) }), speech });
    expect(service.resumePending()).toEqual(["voice"]);
  });

  it("formats sizes like the Mac", () => {
    expect(sizeText(2_497_281_120)).toBe("2.5 GB");
    expect(sizeText(483_112_239)).toBe("483 MB");
  });
});

describe("RendererAudio (the window's microphone and speakers)", () => {
  it("opens capture when the window says so, passes frames on and measures the level", async () => {
    const sent: TalkAudioCommand[] = [];
    const audio = new RendererAudio((command) => sent.push(command));
    const heard: number[] = [];
    const levels: number[] = [];
    audio.onLevel((level) => levels.push(level));
    audio.frame(new Float32Array(10).fill(0.5));
    const started = audio.input().start((samples, rate) => heard.push(samples.length, rate));
    expect(sent).toEqual([{ kind: "startCapture" }]);
    await audio.captureStarted();
    await started;
    audio.frame(new Float32Array(160).fill(0.1));
    expect(heard).toEqual([160, 16_000]);
    expect(levels[0]).toBeCloseTo(0.6);
    await audio.input().stop();
    audio.frame(new Float32Array(160));
    expect(heard).toHaveLength(2);
    expect(sent.at(-1)).toEqual({ kind: "stopCapture" });
  });

  it("fails the talk's listener when the microphone is refused", async () => {
    const audio = new RendererAudio(() => undefined);
    const started = audio.input().start(() => undefined);
    await audio.captureFailed("denied");
    await expect(started).rejects.toEqual(new MicrophoneError("denied"));
  });

  it("waits for each clip to play and stops all of them at once", async () => {
    const sent: TalkAudioCommand[] = [];
    const audio = new RendererAudio((command) => sent.push(command));
    const output = audio.output();
    const first = output.play(new Float32Array(24_000), 24_000);
    const id = (sent[0] as { id: string }).id;
    let done = false;
    void first.then(() => (done = true));
    await tick();
    expect(done).toBe(false);
    await audio.played(id);
    await first;
    const second = output.play(new Float32Array(240_000), 24_000);
    output.stop();
    await second;
    expect(sent.at(-1)).toEqual({ kind: "stopPlayback" });
  });
});

class FakeListener implements TalkListener {
  handler: ((hearing: TalkHearing) => void) | null = null;
  stops = 0;
  async start(onHearing: (hearing: TalkHearing) => void): Promise<void> {
    this.handler = onHearing;
  }
  async stop(): Promise<void> {
    this.stops += 1;
    this.handler = null;
  }
  hear(hearing: TalkHearing): void {
    this.handler?.(hearing);
  }
}

class FakeSpeaker implements TalkSpeaker {
  spoken: string[] = [];
  stops = 0;
  private finishing: (() => void) | null = null;
  speak(text: string): Promise<void> {
    this.spoken.push(text);
    return new Promise((resolve) => (this.finishing = resolve));
  }
  async stop(): Promise<void> {
    this.stops += 1;
    this.finishing?.();
    this.finishing = null;
  }
  finish(): void {
    this.finishing?.();
    this.finishing = null;
  }
}

describe("the stored voice choice", () => {
  let rig: RealRig;
  beforeEach(async () => {
    rig = await openRealRig();
  });
  afterEach(() => rig.cleanup());

  it("moves the retired Apple voice to the LANA voice, keeps off, and defaults to the LANA voice", () => {
    const settings = rig.store.settings;
    expect(readVoice(settings)).toBe("lana");
    expect(settings.get(VOICE_SETTING_KEYS.voice)).toBeNull();
    settings.set(VOICE_SETTING_KEYS.voice, "apple");
    expect(readVoice(settings)).toBe("lana");
    expect(settings.get(VOICE_SETTING_KEYS.voice)).toBe("lana");
    settings.set(VOICE_SETTING_KEYS.voice, "off");
    expect(readVoice(settings)).toBe("off");
    expect(settings.get(VOICE_SETTING_KEYS.voice)).toBe("off");
  });
});

describe("TalkService (fake speech ports, real Ask store)", () => {
  let rig: RealRig;
  beforeEach(async () => {
    rig = await openRealRig();
  });
  afterEach(() => rig.cleanup());

  function setup(options: { microphone?: boolean; listenerReady?: boolean; voiceReady?: boolean } = {}) {
    const events: LanaEvent[] = [];
    const listener = new FakeListener();
    const speaker = new FakeSpeaker();
    const muted: boolean[] = [];
    let levelListener: ((level: number) => void) | null = null;
    let passage: Passage | null = null;
    const answerer: TalkAnswerer = {
      answer: async (question): Promise<AskAnswer> => ({ status: "answered", text: `Answer to ${question}`, citations: passage === null ? [] : [passage] }),
    };
    let listenerReady = options.listenerReady ?? false;
    let voiceReady = options.voiceReady ?? true;
    const voices: VoiceOption[] = [];
    const factory: TalkPartsFactory = {
      requestMicrophone: async () => options.microphone ?? true,
      listenerReady: () => listenerReady,
      prepareListener: async (progress) => {
        progress(0.5);
        await tick();
        progress(1);
        listenerReady = true;
      },
      voiceReady: () => voiceReady,
      prepareVoice: async (progress) => {
        progress(1);
        voiceReady = true;
      },
      downloadSizeText: (needs) => [needs.listener ? "483 MB" : "", needs.voice ? "350 MB" : ""].filter(Boolean).join(" + "),
      makeParts: async (_scope, voice): Promise<TalkParts> => (voices.push(voice), {
        listener, speaker, answerer,
        setMicrophoneMuted: (value) => muted.push(value),
        onLevel: (next) => (levelListener = next),
        release: () => undefined,
      }),
    };
    const asking = new MeetingAskService(storeAskSource(rig.store), new RuntimeAnswerBackend(new ScriptedAskModel(), rig.log));
    const ask = new AskService({ store: rig.store, asking, platform, emit: (event) => events.push(event), log: rig.log, allowed: () => true });
    const talk = new TalkService({ factory, ask, settings: rig.store.settings, platform, emit: (session) => events.push({ type: "talk", session }), log: rig.log, allowed: () => true });
    const sessions = () => events.flatMap((event) => (event.type === "talk" ? [event.session] : []));
    const last = (): TalkView => sessions().at(-1)!;
    return { talk, listener, speaker, muted, voices, sessions, last, events, setPassage: (value: Passage) => (passage = value), level: (value: number) => levelListener?.(value) };
  }

  it("shows the intro, downloads the listener, then runs a conversation with barge-in, mute and history, and saves it", async () => {
    const opened = await receiveGoldenMeeting(rig);
    const rigged = setup();
    const { talk, listener, speaker, last } = rigged;
    rigged.setPassage({ id: `${opened.meeting.id}#t0`, meetingID: opened.meeting.id, meetingTitle: opened.meeting.title, meetingDate: new Date(), kind: "transcript", start: 1, end: 5, speakers: ["Dana"], text: "" });

    expect((await talk.start({ kind: "meeting", meetingID: opened.meeting.id })).state).toEqual({ kind: "intro", intro: { kind: "ready" } });
    expect(last().scopeTitle).toBe(opened.meeting.title);
    expect(last()).toMatchObject({ introSeen: false, voice: "lana", needs: { listener: true, voice: false }, downloadSizeText: "483 MB" });
    await talk.acceptIntro();
    expect(rigged.sessions().some((session) => session.state.kind === "intro" && session.state.intro.kind === "downloading" && session.state.intro.progress === 0.5)).toBe(true);
    await vi.waitFor(() => expect(last().state.kind).toBe("running"));
    expect(rig.store.settings.get(TALK_INTRO_ACCEPTED)).toBe("1");
    await vi.waitFor(() => expect(listener.handler).not.toBeNull());

    // Hearing, with live words and the level, then thinking, then speaking with the cited answer.
    listener.hear({ kind: "speechStarted" });
    listener.hear({ kind: "partial", text: "When is" });
    await vi.waitFor(() => expect(last().state).toMatchObject({ kind: "running", orb: "hearing", caption: "When is" }));
    rigged.level(0.7);
    expect(last().state).toMatchObject({ level: 0.7 });
    listener.hear({ kind: "endOfTurn", text: "When is the deposition?" });
    await vi.waitFor(() => expect(last().state).toMatchObject({ orb: "speaking", current: { question: "When is the deposition?", text: "Answer to When is the deposition?", interrupted: false } }));
    expect(speaker.spoken).toEqual(["Answer to When is the deposition?"]);
    const state = last().state;
    if (state.kind !== "running") throw new Error("not running");
    expect(state.current?.citations).toEqual([expect.objectContaining({ meetingID: opened.meeting.id, meetingTitle: opened.meeting.title, title: "Dana at 0:01" })]);

    // Barge-in: LANA stops speaking at once and the answer is marked interrupted.
    listener.hear({ kind: "speechStarted" });
    await vi.waitFor(() => expect(speaker.stops).toBe(1));
    listener.hear({ kind: "endOfTurn", text: "What about the letter?" });
    await vi.waitFor(() => expect(last().state).toMatchObject({ orb: "speaking", current: { question: "What about the letter?" }, history: [{ question: "When is the deposition?", interrupted: true }] }));
    speaker.finish();
    await vi.waitFor(() => expect(last().state).toMatchObject({ orb: "listening", current: { question: "What about the letter?" } }));

    // Mute (M): nothing heard reaches the conversation, and the microphone track is disabled.
    await talk.toggleMute();
    expect(last().state).toMatchObject({ muted: true });
    expect(rigged.muted).toEqual([true]);
    listener.hear({ kind: "speechStarted" });
    listener.hear({ kind: "endOfTurn", text: "Muted words" });
    await tick();
    expect(last().state).toMatchObject({ orb: "listening" });
    await talk.toggleMute();

    // End: the talk is saved as an Ask conversation over its scope.
    expect((await talk.end()).state).toEqual({ kind: "idle" });
    expect(listener.stops).toBe(1);
    const threads = rig.store.ask.list();
    expect(threads).toHaveLength(1);
    expect(threads[0]?.meetingID).toBe(opened.meeting.id);
    expect(decodeSavedAskTurns(threads[0]!.turns).turns.map((turn) => turn.question)).toEqual(["When is the deposition?", "What about the letter?"]);
    expect(rigged.events.some((event) => event.type === "askThreads" && event.threads.length === 1)).toBe(true);

    // Next time: no intro.
    await talk.start({ kind: "all" });
    await vi.waitFor(() => expect(last().state.kind).toBe("running"));
    await talk.end();

    const log = rig.log.lines.join("\n");
    for (const words of ["deposition", "letter", "Muted words", "When is", "Answer to"]) expect(log).not.toContain(words);
  });

  it("asks before downloading the LANA voice when it is chosen but missing, then talks with it", async () => {
    rig.store.settings.set(TALK_INTRO_ACCEPTED, "1");
    const { talk, last, voices } = setup({ listenerReady: true, voiceReady: false });
    expect((await talk.start({ kind: "all" })).state).toEqual({ kind: "intro", intro: { kind: "ready" } });
    expect(last()).toMatchObject({ introSeen: true, voice: "lana", needs: { listener: false, voice: true }, downloadSizeText: "350 MB" });
    await talk.acceptIntro();
    await vi.waitFor(() => expect(last().state.kind).toBe("running"));
    expect(last()).toMatchObject({ needs: { listener: false, voice: false }, downloadSizeText: "" });
    expect(voices).toEqual(["lana"]);
    await talk.end();
  });

  it("asks for both downloads together when neither is there", async () => {
    rig.store.settings.set(TALK_INTRO_ACCEPTED, "1");
    const { talk, last } = setup({ listenerReady: false, voiceReady: false });
    await talk.start({ kind: "all" });
    expect(last()).toMatchObject({ state: { kind: "intro" }, needs: { listener: true, voice: true }, downloadSizeText: "483 MB + 350 MB" });
    await talk.end();
  });

  it("with the voice off, needs no voice download and talks without speaking", async () => {
    rig.store.settings.set(TALK_INTRO_ACCEPTED, "1");
    rig.store.settings.set(VOICE_SETTING_KEYS.voice, "off");
    const { talk, last, voices } = setup({ listenerReady: true, voiceReady: false });
    await talk.start({ kind: "all" });
    await vi.waitFor(() => expect(last().state.kind).toBe("running"));
    expect(last()).toMatchObject({ voice: "off", needs: { listener: false, voice: false } });
    expect(voices).toEqual(["off"]);
    await talk.end();
  });

  it("asks for the microphone and says how to allow it when refused", async () => {
    rig.store.settings.set(TALK_INTRO_ACCEPTED, "1");
    const { talk, last } = setup({ microphone: false, listenerReady: true });
    await talk.start({ kind: "all" });
    await vi.waitFor(() => expect(last().state).toEqual({ kind: "failed", message: "LANA needs the microphone to talk. Allow it in System Settings, Privacy and Security, Microphone." }));
    expect((await talk.end()).state).toEqual({ kind: "idle" });
  });

  it("fails plainly when the listener stops on its own, and ends in the background only when asked", async () => {
    rig.store.settings.set(TALK_INTRO_ACCEPTED, "1");
    const { talk, listener, last } = setup({ listenerReady: true });
    await talk.start({ kind: "all" });
    await vi.waitFor(() => expect(last().state.kind).toBe("running"));
    talk.appResignedActive();
    await tick();
    expect(last().state.kind).toBe("running");
    rig.store.settings.set(VOICE_SETTING_KEYS.endWhenInactive, "true");
    talk.appResignedActive();
    await vi.waitFor(() => expect(last().state).toEqual({ kind: "idle" }));
    expect(listener.stops).toBe(1);
  });
});
