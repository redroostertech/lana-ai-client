import { describe, expect, it } from "vitest";
import {
  KokoroSpeaker, loadSherpa, resample, SherpaListener, speechModelPaths, STT_SAMPLE_RATE,
  type AudioInput, type TalkHearing,
} from "../../src/talk/index.js";
import { kokoroConfig } from "../../src/talk/sherpa.js";

/**
 * Real speech models (opt in): `LANA_RUN_SPEECH_TESTS=1 LANA_SPEECH_MODELS_DIR=<folder>`
 * with `silero_vad.onnx`, the Parakeet TDT folder and the Kokoro multi-lang v1.0 folder.
 */
const RUN = process.env["LANA_RUN_SPEECH_TESTS"] === "1";
const SENTENCE = "Call Ngozi Okonkwo-Zyxtrel about matter 2026-0147.";

function words(text: string): string[] {
  return text.toLowerCase().replace(/[^a-z0-9' ]+/g, " ").split(/\s+/).filter((word) => word.length > 0);
}

describe.skipIf(!RUN)("Talk speech with sherpa-onnx (opt in)", () => {
  const paths = speechModelPaths(process.env["LANA_SPEECH_MODELS_DIR"] ?? "");
  const silentOutput = { play: async () => {}, stop: () => {} };

  it("speaks every word of the matter sentence (round trip through Parakeet)", async () => {
    const speaker = new KokoroSpeaker({ directory: paths.kokoro, output: silentOutput });
    const listener = new SherpaListener({ vadModel: paths.vad, parakeet: paths.parakeet, input: { start: async () => {}, stop: async () => {} } });
    await speaker.prepare();

    // Every token maps to lexicon sounds, rule sounds or spelled letters.
    const phonemized = speaker.phonemize(SENTENCE);
    expect(phonemized.words.every((w) => w.phonemes.length > 0)).toBe(true);

    const audio = (await speaker.synthesize(SENTENCE))!;
    const heard = await listener.transcribe(resample(audio.samples, audio.sampleRate, STT_SAMPLE_RATE));

    // The old path: sherpa's own lexicon-only text input, which drops what it does not know.
    const sherpa = await loadSherpa();
    const plain = await (await sherpa.OfflineTts.createAsync(kokoroConfig(paths.kokoro))).generateAsync(
      { text: SENTENCE, sid: 0, speed: 1, enableExternalBuffer: false } as never);
    const heardPlain = await listener.transcribe(resample(plain.samples, plain.sampleRate, STT_SAMPLE_RATE));

    console.log(`phonemes: ${phonemized.phonemes}`);
    console.log(`sources: ${phonemized.words.map((w) => `${w.word}=${w.source}`).join(" ")}`);
    console.log(`round trip, phoneme path (${(audio.samples.length / audio.sampleRate).toFixed(2)} s): "${heard}"`);
    console.log(`round trip, text path (${(plain.samples.length / plain.sampleRate).toFixed(2)} s): "${heardPlain}"`);

    const got = words(heard);
    expect(got).toEqual(expect.arrayContaining(["call", "about", "matter"]));
    // The number is spoken: Parakeet writes it back as digits or words.
    expect(heard.replace(/[^0-9]/g, "")).toMatch(/2026|20260147|0147|147/);
    // Nothing dropped: the names come back as words between "call" and "about".
    expect(got.indexOf("about") - got.indexOf("call") - 1).toBeGreaterThanOrEqual(2);
    expect(words(heardPlain).length).toBeLessThan(got.length);
  }, 120_000);

  it("hears a turn from audio: speech started, then the transcript at the end of the turn", async () => {
    const speaker = new KokoroSpeaker({ directory: paths.kokoro, output: silentOutput });
    const spoken = (await speaker.synthesize("When is the Solberg deposition?"))!;
    const speech = resample(spoken.samples, spoken.sampleRate, 48_000);
    const silence = new Float32Array(48_000);
    const stream = new Float32Array(silence.length * 2 + speech.length + 48_000 * 1.5);
    stream.set(silence, 0);
    stream.set(speech, silence.length);
    let feed: ((samples: Float32Array, rate: number) => void) | undefined;
    const input: AudioInput = { start: async (onSamples) => { feed = onSamples; }, stop: async () => {} };
    const listener = new SherpaListener({ vadModel: paths.vad, parakeet: paths.parakeet, input, partialEvery: 0.5 });
    const heard: TalkHearing[] = [];
    await listener.start((hearing) => heard.push(hearing));
    for (let offset = 0; offset < stream.length; offset += 4_800) feed!(stream.slice(offset, offset + 4_800), 48_000);
    const deadline = Date.now() + 20_000;
    while (!heard.some((h) => h.kind === "endOfTurn") && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 50));
    await listener.stop();
    console.log(`hearing: ${heard.map((h) => (h.kind === "speechStarted" ? h.kind : `${h.kind}(${h.text})`)).join(", ")}`);
    expect(heard[0]?.kind).toBe("speechStarted");
    const end = heard.find((h) => h.kind === "endOfTurn");
    expect(end?.kind === "endOfTurn" ? end.text.toLowerCase() : "").toMatch(/deposition/);
  }, 120_000);
});
