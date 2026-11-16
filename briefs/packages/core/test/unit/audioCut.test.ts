import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { cutSetAsideAudio, parseM4a, SILENT_AAC_MONO_FRAME, silenceSetAsideAudio } from "../../src/recording/audioCut.js";
import { aacDuration, muxM4a } from "../../src/recording/m4a.js";

// Synthetic audio only: numbered fake AAC frames, and a 3 second sine made with ffmpeg.
const RATE = 48_000;
const FRAME = 1024 / RATE;
const frames = (count: number, from = 0): Uint8Array[] => Array.from({ length: count }, (_, index) => new Uint8Array([0x21, (from + index) >> 8, (from + index) & 0xff, 7]));
const part = (name: string, count: number, from = 0) => ({ name, data: muxM4a({ sampleRate: RATE, channels: 1, frames: frames(count, from) }) });
const ids = (data: Uint8Array): number[] => parseM4a(data).frames.map((frame) => (frame[1]! << 8) | frame[2]!);
const sine = new Uint8Array(readFileSync(fileURLToPath(new URL("../../../../fixtures/recording/sine-3s.m4a", import.meta.url))));

describe("reading m4a audio", () => {
  it("reads back the frames, rate and channels the muxer wrote", () => {
    const parsed = parseM4a(part("a.m4a", 50).data);
    expect(parsed).toMatchObject({ sampleRate: RATE, channels: 1 });
    expect(parsed.frames).toEqual(frames(50));
    expect(parsed.duration).toBeCloseTo(aacDuration(50, RATE), 9);
  });

  it("reads a file another encoder wrote, with several chunks", () => {
    const parsed = parseM4a(sine);
    expect(parsed.sampleRate).toBe(RATE);
    expect(parsed.channels).toBe(1);
    expect(parsed.duration).toBeGreaterThan(2.9);
    expect(parsed.duration).toBeLessThan(3.1);
  });

  it("refuses something that is not m4a audio", () => {
    expect(() => parseM4a(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]))).toThrow();
  });
});

describe("cutting set-aside parts out of exported audio", () => {
  it("drops the frames inside each part across stored parts, keeping the rest in order", () => {
    // Two stored parts of 100 frames (about 2.13 s each); set aside 1.0 s to 3.0 s.
    const out = cutSetAsideAudio([part("seg-0.m4a", 100, 0), part("seg-1.m4a", 100, 100)], [{ start: 1.0, end: 3.0 }]);
    const kept = out.flatMap((item) => ids(item.data));
    const inside = (id: number) => (id + 0.5) * FRAME >= 1.0 && (id + 0.5) * FRAME < 3.0;
    expect(kept).toEqual(Array.from({ length: 200 }, (_, id) => id).filter((id) => !inside(id)));
    const total = out.reduce((sum, item) => sum + parseM4a(item.data).duration, 0);
    expect(total).toBeCloseTo(aacDuration(200, RATE) - 2.0, 1);
  });

  it("drops a stored part that is all set aside, and returns the original bytes when nothing is", () => {
    const first = part("seg-0.m4a", 50, 0);
    const second = part("seg-1.m4a", 50, 50);
    expect(cutSetAsideAudio([first, second], [{ start: 0, end: 50 * FRAME }]).map((item) => item.name)).toEqual(["seg-1.m4a"]);
    const same = cutSetAsideAudio([first, second], []);
    expect(same[0]!.data).toBe(first.data);
  });

  it("cuts a real encoder's file", () => {
    const out = cutSetAsideAudio([{ name: "sine.m4a", data: sine }], [{ start: 1.0, end: 2.0 }]);
    expect(parseM4a(out[0]!.data).duration).toBeGreaterThan(1.9);
    expect(parseM4a(out[0]!.data).duration).toBeLessThan(2.1);
  });

  it("will not hand out audio it cannot cut while parts are set aside", () => {
    expect(() => cutSetAsideAudio([{ name: "x.mp3", data: new Uint8Array([1, 2, 3]) }], [{ start: 0, end: 1 }])).toThrow();
  });
});

describe("silencing set-aside parts in audio sent to a paired phone", () => {
  it("keeps every frame's time so replay stays in step with the transcript, with silence inside parts", () => {
    const out = silenceSetAsideAudio([part("seg-0.m4a", 100)], [{ start: 1.0, end: 1.5 }]);
    const parsed = parseM4a(out[0]!.data);
    expect(parsed.frames).toHaveLength(100);
    parsed.frames.forEach((frame, id) => {
      const inside = (id + 0.5) * FRAME >= 1.0 && (id + 0.5) * FRAME < 1.5;
      expect(Array.from(frame)).toEqual(inside ? Array.from(SILENT_AAC_MONO_FRAME) : Array.from(frames(100)[id]!));
    });
  });
});
