import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { MeetingTranscriber, TRANSCRIPTION_SAMPLE_RATE, transcriptionModelPaths } from "../../src/recording/index.js";
import { temporaryDirectory } from "../support/storeRig.js";

/**
 * Real models (opt in, macOS for the voices): `LANA_RUN_SPEECH_TESTS=1 LANA_SPEECH_MODELS_DIR=<folder>`
 * holding `silero_vad.onnx`, the Parakeet TDT folder, the pyannote segmentation folder and
 * `nemo_en_titanet_small.onnx`. Two system voices take turns: one on the mic, one on the
 * meeting audio, the way a call sounds with headphones (with a little bleed).
 */
const RUN = process.env["LANA_RUN_SPEECH_TESTS"] === "1" && process.platform === "darwin";

const TURNS: Array<[voice: string, channel: "mic" | "system", text: string]> = [
  ["Samantha", "mic", "Thanks for joining. Let's review the Acme intake and the filing deadline next Friday."],
  ["Daniel", "system", "Sure. I spoke with the client yesterday and they want the draft by Wednesday."],
  ["Samantha", "mic", "Okay, I will send the engagement letter today and schedule a follow up call."],
  ["Daniel", "system", "Great. Can you also check whether the insurance policy covers the warehouse?"],
];

function voice(folder: string, name: string, text: string, index: number): Float32Array {
  const aiff = join(folder, `${index}.aiff`);
  const wav = join(folder, `${index}.wav`);
  execFileSync("/usr/bin/say", ["-v", name, "-o", aiff, text]);
  execFileSync("/usr/bin/afconvert", ["-f", "WAVE", "-d", "LEI16@16000", "-c", "1", aiff, wav]);
  const data = readFileSync(wav);
  const start = data.indexOf("data") + 8;
  const samples = new Float32Array((data.length - start) / 2);
  for (let at = 0; at < samples.length; at += 1) samples[at] = data.readInt16LE(start + at * 2) / 0x8000;
  return samples;
}

describe.skipIf(!RUN)("whole-meeting transcription with speakers (opt in)", () => {
  it("transcribes both sides and labels the mic speaker S1", async () => {
    const folder = temporaryDirectory("voices");
    try {
      const gap = TRANSCRIPTION_SAMPLE_RATE * 0.8;
      const clips = TURNS.map(([name, , text], index) => voice(folder.path, name, text, index));
      const length = clips.reduce((sum, clip) => sum + clip.length + gap, 0);
      const mic = new Float32Array(length);
      const system = new Float32Array(length);
      let at = 0;
      TURNS.forEach(([, channel], index) => {
        const clip = clips[index]!;
        const [main, bleed] = channel === "mic" ? [mic, system] : [system, mic];
        for (let offset = 0; offset < clip.length; offset += 1) {
          main[at + offset] = clip[offset]!;
          bleed[at + offset] = clip[offset]! * 0.05;
        }
        at += clip.length + gap;
      });
      const transcriber = new MeetingTranscriber({ models: transcriptionModelPaths(process.env["LANA_SPEECH_MODELS_DIR"] ?? "") });
      // Live: frames of 100 ms, as the window sends them.
      const live = [];
      const frame = TRANSCRIPTION_SAMPLE_RATE / 10;
      for (let offset = 0; offset < length; offset += frame) {
        live.push(...(await transcriber.pushLive({ mic: mic.slice(offset, offset + frame), system: system.slice(offset, offset + frame) })));
      }
      live.push(...(await transcriber.flushLive()));
      expect(live.length).toBeGreaterThanOrEqual(4);
      expect(live.map((line) => line.speaker)).toEqual(["S1", "S2", "S1", "S2"]);

      const progress: number[] = [];
      const result = await transcriber.transcribe({ mic, system }, (fraction) => progress.push(fraction));
      expect(result.transcript.map((line) => line.speaker)).toEqual(["S1", "S2", "S1", "S2"]);
      expect(result.speakers).toEqual([{ id: "S1" }, { id: "S2" }]);
      const text = result.transcript.map((line) => line.text.toLowerCase()).join(" ");
      for (const word of ["acme", "wednesday", "engagement", "warehouse"]) expect(text).toContain(word);
      expect(progress.at(-1)).toBe(1);
    } finally {
      folder.cleanup();
    }
  }, 120_000);
});
