import { mkdirSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { fromBase64, fromHex, toBase64, toHex } from "../../src/bytes/index.js";
import { sha256Hex } from "../../src/crypto/index.js";
import {
  crc16, modulateTone, STANDARD_TONE, toneBurstDuration, toneHighestFrequency, tonePayload, toneSamplesLittleEndian, toneSymbols,
} from "../../src/tone/index.js";
import { golden, GOLDEN_DIR } from "./fixtures.js";

interface ToneFixture {
  configuration: Record<string, number | number[]>;
  crc16: { bytes: string; crc: number }[];
  bursts: { nonce: string; symbols: number[]; sample_count: number; sha256: string; samples_f32le?: string }[];
}

const fixture = golden<ToneFixture>("tone");

describe("tone modulator matches Swift ToneModulator", () => {
  it("uses the same configuration", () => {
    const config = fixture.configuration;
    expect(STANDARD_TONE.sampleRate).toBe(config["sample_rate"]);
    expect(STANDARD_TONE.baseFrequency).toBe(config["base_frequency"]);
    expect(STANDARD_TONE.toneSpacing).toBe(config["tone_spacing"]);
    expect(STANDARD_TONE.toneCount).toBe(config["tone_count"]);
    expect(STANDARD_TONE.symbolSamples).toBe(config["symbol_samples"]);
    expect(STANDARD_TONE.guardSamples).toBe(config["guard_samples"]);
    expect(STANDARD_TONE.amplitude).toBe(config["amplitude"]);
    expect([...STANDARD_TONE.preamble]).toEqual(config["preamble"]);
    expect(toneHighestFrequency(STANDARD_TONE)).toBe(config["highest_frequency"]);
    expect(toneBurstDuration(STANDARD_TONE, 16)).toBe(config["burst_duration_16"]);
  });

  it("frames bytes into the same CRC and Gray-coded symbols", () => {
    for (const vector of fixture.crc16) expect(crc16(fromHex(vector.bytes))).toBe(vector.crc);
    for (const burst of fixture.bursts) {
      const nonce = fromHex(burst.nonce);
      expect(toneSymbols(nonce)).toEqual(burst.symbols);
      expect(tonePayload(burst.symbols)).toEqual(nonce);
    }
    const flipped = [...(fixture.bursts[0]?.symbols ?? [])];
    flipped[3] = (flipped[3] ?? 0) ^ 1;
    expect(tonePayload(flipped)).toBeUndefined();
  });

  it("generates the exact PCM burst for every fixed nonce", () => {
    for (const burst of fixture.bursts) {
      const samples = modulateTone(fromHex(burst.nonce));
      expect(samples.length).toBe(burst.sample_count);
      const bytes = toneSamplesLittleEndian(samples);
      if (burst.samples_f32le !== undefined) {
        const swift = new Float32Array((fromBase64(burst.samples_f32le) as Uint8Array).slice().buffer);
        const firstDifference = samples.findIndex((sample, index) => !Object.is(sample, swift[index]));
        expect(firstDifference).toBe(-1);
      }
      expect(sha256Hex(bytes)).toBe(burst.sha256);
    }
  });

  it("keeps the band and the amplitude", () => {
    const samples = modulateTone(new Uint8Array(16));
    expect(Math.max(...samples.map(Math.abs))).toBeLessThanOrEqual(0.5);
    expect(samples.slice(0, 2_400).every((sample) => sample === 0)).toBe(true);
    expect(toneHighestFrequency(STANDARD_TONE)).toBeLessThanOrEqual(19_500);
    expect(toneBurstDuration(STANDARD_TONE, 16)).toBeLessThan(1);
  });
});

/**
 * Writes TypeScript bursts for the Swift phone decoder (ToneGoldenVectorImportTests).
 * Opt in with `LANA_EXPORT_TS_GOLDEN`; the file lands next to `vectors.json`.
 */
const target = process.env["LANA_EXPORT_TS_GOLDEN"];
describe.runIf(target !== undefined)("tone export for Swift", () => {
  it("writes from-ts/tone.json", () => {
    const nonces = [
      fixture.bursts[0]?.nonce ?? "",
      "5f1e0c7a9b3d42e8a1c6f0d29e4b7a13",
      "00ff00ff00ff00ff00ff00ff00ff00ff",
    ];
    const bursts = nonces.map((nonce) => ({ nonce, samples_f32le: toBase64(toneSamplesLittleEndian(modulateTone(fromHex(nonce)))) }));
    mkdirSync(`${GOLDEN_DIR}from-ts`, { recursive: true });
    writeFileSync(`${GOLDEN_DIR}from-ts/tone.json`, `${JSON.stringify({ bursts }, null, 2)}\n`);
    expect(bursts.map((burst) => toHex(fromHex(burst.nonce)))).toEqual(nonces);
  });
});
