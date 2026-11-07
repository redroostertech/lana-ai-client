import { describe, expect, it } from "vitest";
import { Downsampler, meterLevel, mix, softClip } from "../src/preload/recording/mixer.js";
import { monoOf } from "../src/preload/recording/importAudio.js";

// The capture window's audio math (ported from the standalone renderer): the mixed track,
// the meters and the 16 kHz copies for transcription.

describe("recording audio math", () => {
  it("mixes both sides and bends loud peaks instead of clipping", () => {
    const out = mix(new Float32Array([0.1, 0.6, -0.9]), new Float32Array([0.2, 0.6, -0.9]));
    expect(out[0]).toBeCloseTo(0.3);
    expect(out[1]!).toBeLessThan(1);
    expect(out[1]!).toBeGreaterThan(0.8);
    expect(out[2]!).toBeGreaterThan(-1);
    expect(mix(new Float32Array([0.25]), null)[0]).toBeCloseTo(0.25);
    expect(softClip(0.5)).toBe(0.5);
  });

  it("meters read 0 for silence and near 1 for full scale", () => {
    expect(meterLevel(new Float32Array(128))).toBe(0);
    expect(meterLevel(new Float32Array(0))).toBe(0);
    expect(meterLevel(new Float32Array(128).fill(1))).toBeCloseTo(1);
    expect(meterLevel(new Float32Array(128).fill(0.0005))).toBe(0);
  });

  it("48 kHz becomes 16 kHz with no gaps between frames", () => {
    const down = new Downsampler(48_000);
    const first = down.push(new Float32Array(4096).fill(0.3));
    const second = down.push(new Float32Array(4096).fill(0.3));
    expect(first.length + second.length).toBe(Math.floor((4096 * 2) / 3));
    expect(first[0]).toBeCloseTo(0.3);
  });

  it("a file's channels become one track", () => {
    expect(Array.from(monoOf([new Float32Array([1, 0]), new Float32Array([0, 1])]))).toEqual([0.5, 0.5]);
    const single = new Float32Array([0.2]);
    expect(monoOf([single])).toBe(single);
  });
});
