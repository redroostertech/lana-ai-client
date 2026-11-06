import { MeetingAskService, storeAskSource } from "@lana/core/ask";
import { SpeechModelStore, type SpeechModelPackage } from "@lana/core/model";
import { createRequire } from "node:module";
import { RuntimeAnswerBackend } from "@lana/core/runtime";
import { KokoroSpeaker, resample, speechModelPaths, STT_SAMPLE_RATE } from "@lana/core/talk";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import type { AskConversation, LanaEvent, PlatformInfo, TalkAudioCommand, TalkSession } from "../src/shared/api.js";
import { AskService } from "../src/main/services/ask/askService.js";
import { ModelService } from "../src/main/services/models/modelService.js";
import { VOICE_SETTING_KEYS } from "../src/main/services/preferencesService.js";
import { DeviceTalkFactory } from "../src/main/services/talk/deviceTalkFactory.js";
import { RendererAudio } from "../src/main/services/talk/rendererAudio.js";
import { TALK_INTRO_ACCEPTED, TalkService } from "../src/main/services/talk/talkService.js";
import { intake } from "../../core/test/support/askFakes.js";
import { openRealRig, receiveMeeting, type RealRig } from "./support/realRig.js";

/**
 * Opt in: the real LANA model and speech models through the main-process services.
 * `LANA_RUN_MODEL_TESTS=1 LANA_ENGINE_URL=<the local AI engine> LANA_TOKEN=<a LANA session token> LANA_SPEECH_MODELS_DIR=<folder with
 * silero_vad.onnx, the Parakeet folder and the Kokoro folder> npx vitest run app/test/askTalk.integration.test.ts`.
 * Both folders are adopted as installed (every file's size and SHA-256 checked); nothing is downloaded.
 */
// The LANA client's catalog: the one list of every model the client downloads.
const catalogSpeech = (createRequire(import.meta.url)("../../../../electron-local-models.js") as { speechPackages(): SpeechModelPackage[] }).speechPackages();
const RUN = process.env["LANA_RUN_MODEL_TESTS"] === "1";
const platform: PlatformInfo = { os: "mac", deviceNoun: "computer", appVersion: "0.1.0", isDemo: false, features: { ask: true, talk: true } };

describe.skipIf(!RUN)("Ask and Talk with the real models (opt in)", () => {
  const scratch = mkdtempSync(join(tmpdir(), "lana-models-int-"));
  let rig: RealRig;
  afterAll(async () => {
    rig?.cleanup();
    rmSync(scratch, { recursive: true, force: true });
  });

  it("answers a typed question with streamed drafts and a citation, then a spoken one out loud", async () => {
    rig = await openRealRig();
    const opened = await receiveMeeting(rig, intake);
    const events: LanaEvent[] = [];
    const models = new ModelService({
      directory: scratch,
      platform,
      emit: (status) => events.push({ type: "models", status }),
      log: rig.log,
      runtime: { engineBase: () => process.env["LANA_ENGINE_URL"] ?? null, token: () => process.env["LANA_TOKEN"] ?? null },
      speechPackages: catalogSpeech,
      speech: new SpeechModelStore({ directory: process.env["LANA_SPEECH_MODELS_DIR"] ?? "", packages: catalogSpeech, log: rig.log }),
    });
    expect(models.isReady("ask")).toBe(true);
    await models.ensure("listener");
    await models.ensure("voice");

    const asking = new MeetingAskService(storeAskSource(rig.store), new RuntimeAnswerBackend(models.textModel("briefs.ask"), rig.log), { log: rig.log });
    const ask = new AskService({ store: rig.store, asking, platform, emit: (event) => events.push(event), log: rig.log, allowed: () => true });

    // Typed: drafts in order, then the checked answer with its passage.
    const started = Date.now();
    await ask.setScope("screen", { kind: "meeting", meetingID: opened.meeting.id });
    await ask.send("screen", "When is the Solberg deposition?");
    const asked = () => events.flatMap((event) => (event.type === "ask" ? [event.conversation] : []));
    await vi.waitFor(() => expect(asked().at(-1)?.exchanges.at(-1)?.outcome.kind).toBe("answered"), { timeout: 120_000, interval: 100 });
    const done = asked().at(-1) as AskConversation;
    const outcome = done.exchanges[0]!.outcome;
    const drafts = asked().flatMap((conversation) => (conversation.draft === null ? [] : [conversation.draft.text]));
    console.log(`typed: ${drafts.length} drafts, ${Date.now() - started} ms, status ${outcome.kind === "answered" ? outcome.status : outcome.kind}`);
    expect(drafts.length).toBeGreaterThan(1);
    expect(outcome).toMatchObject({ kind: "answered", status: "answered", text: expect.stringMatching(/December 2/) });
    if (outcome.kind === "answered") expect(outcome.citations.length).toBeGreaterThan(0);

    // Spoken: the window is simulated. It opens the "microphone" and plays a question Kokoro
    // spoke, then reports each clip of LANA's answer as played.
    const kokoro = new KokoroSpeaker({ directory: speechModelPaths(models.speech.directory).kokoro, output: { play: async () => {}, stop: () => {} } });
    const question = (await kokoro.synthesize("When is the Solberg deposition?"))!;
    const speech = resample(question.samples, question.sampleRate, STT_SAMPLE_RATE);
    const stream = new Float32Array(STT_SAMPLE_RATE + speech.length + STT_SAMPLE_RATE * 2);
    stream.set(speech, STT_SAMPLE_RATE);
    const played: number[] = [];
    let audio!: RendererAudio;
    const window = (command: TalkAudioCommand): void => {
      if (command.kind === "startCapture") {
        void audio.captureStarted().then(async () => {
          for (let offset = 0; offset < stream.length; offset += 1_024) {
            audio.frame(stream.slice(offset, offset + 1_024));
            await new Promise((resolve) => setTimeout(resolve, 2));
          }
        });
      }
      if (command.kind === "play") {
        played.push(command.samples.length);
        setTimeout(() => void audio.played(command.id), 5);
      }
    };
    audio = new RendererAudio(window);
    rig.store.settings.set(TALK_INTRO_ACCEPTED, "1");
    rig.store.settings.set(VOICE_SETTING_KEYS.voice, "lana");
    const sessions: TalkSession[] = [];
    const talk = new TalkService({
      factory: new DeviceTalkFactory({ models, audio, asking, requestMicrophone: async () => true, log: rig.log }),
      ask,
      settings: rig.store.settings,
      platform,
      emit: (session) => sessions.push(session),
      log: rig.log,
      allowed: () => true,
    });
    expect(talk.voice).toBe("lana");
    await talk.start({ kind: "meeting", meetingID: opened.meeting.id });
    await vi.waitFor(() => {
      const state = sessions.at(-1)?.state;
      expect(state?.kind === "running" && state.current !== null && played.length > 0).toBe(true);
    }, { timeout: 180_000, interval: 200 });
    const orbs = [...new Set(sessions.flatMap((session) => (session.state.kind === "running" ? [session.state.orb] : [])))];
    const state = sessions.at(-1)!.state;
    if (state.kind !== "running" || state.current === null) throw new Error("no answer");
    console.log(`spoken: heard "${state.current.question}", orbs ${orbs.join(" > ")}, ${played.length} clips played`);
    expect(orbs).toEqual(expect.arrayContaining(["listening", "hearing", "thinking", "speaking"]));
    expect(state.current.question.toLowerCase()).toContain("deposition");
    expect(state.current.text).toMatch(/December/);
    await talk.end();
    expect(rig.store.ask.list()).toHaveLength(2);

    const log = rig.log.lines.join("\n");
    for (const words of ["Solberg", "deposition", "December", "Atlanta"]) expect(log).not.toContain(words);
    await models.stop();
  }, 300_000);
});
