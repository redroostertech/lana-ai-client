import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { aacDuration, aacLcConfig, adtsFrames, muxM4a } from "../../src/recording/index.js";
import { temporaryDirectory } from "../support/storeRig.js";

/** Four-character box types at the top level of an MPEG-4 file, with sizes. */
function topBoxes(file: Uint8Array): Array<[string, number]> {
  const view = new DataView(file.buffer, file.byteOffset, file.byteLength);
  const out: Array<[string, number]> = [];
  for (let at = 0; at + 8 <= file.length;) {
    const size = view.getUint32(at);
    out.push([String.fromCharCode(...file.slice(at + 4, at + 8)), size]);
    if (size < 8) break;
    at += size;
  }
  return out;
}

describe("M4A writer", () => {
  it("builds the AAC LC configuration the phone's encoder writes", () => {
    expect([...aacLcConfig(48_000, 1)]).toEqual([0x11, 0x88]);
    expect([...aacLcConfig(44_100, 2)]).toEqual([0x12, 0x10]);
    expect(() => aacLcConfig(12_345, 1)).toThrow();
    expect(aacDuration(4_688, 48_000)).toBeCloseTo(100, 0);
  });

  it("lays out ftyp, moov and mdat with every frame in order", () => {
    const frames = [new Uint8Array([1, 2, 3]), new Uint8Array([4, 5]), new Uint8Array([6])];
    const file = muxM4a({ sampleRate: 48_000, channels: 1, frames });
    expect(topBoxes(file).map(([type]) => type)).toEqual(["ftyp", "moov", "mdat"]);
    expect([...file.slice(-6)]).toEqual([1, 2, 3, 4, 5, 6]);
    const total = topBoxes(file).reduce((sum, [, size]) => sum + size, 0);
    expect(total).toBe(file.length);
    // The single chunk offset points at the first frame.
    const text = Buffer.from(file).toString("latin1");
    const stco = text.indexOf("stco");
    const offset = new DataView(file.buffer).getUint32(stco + 12);
    expect(file[offset]).toBe(1);
  });

  it("writes an empty but valid file for a recording with no audio", () => {
    expect(topBoxes(muxM4a({ sampleRate: 48_000, channels: 1, frames: [] })).map(([type]) => type)).toEqual(["ftyp", "moov", "mdat"]);
  });

  // Frames from the recorder's own encoder (Chromium WebCodecs in Electron), muxed here.
  it.runIf(process.platform === "darwin")("muxes WebCodecs AAC frames into a file AudioToolbox decodes", () => {
    const fixture = JSON.parse(readFileSync(join(import.meta.dirname, "../../../../fixtures/recording/webcodecs-aac.json"), "utf8")) as { config: string; frames: string[] };
    const frames = fixture.frames.map((frame) => new Uint8Array(Buffer.from(frame, "base64")));
    const config = new Uint8Array(Buffer.from(fixture.config, "base64"));
    expect([...config]).toEqual([...aacLcConfig(48_000, 1)]);
    const folder = temporaryDirectory("m4a-webcodecs");
    try {
      const m4a = join(folder.path, "recorded.m4a");
      writeFileSync(m4a, muxM4a({ sampleRate: 48_000, channels: 1, frames, audioSpecificConfig: config }));
      const info = execFileSync("/usr/bin/afinfo", [m4a]).toString();
      expect(info).toMatch(/1 ch,\s+48000 Hz, aac/);
      expect(Number(/estimated duration: ([\d.]+) sec/.exec(info)?.[1])).toBeGreaterThan(2.9);
      execFileSync("/usr/bin/afconvert", ["-f", "WAVE", "-d", "LEI16", m4a, join(folder.path, "decoded.wav")]);
    } finally {
      folder.cleanup();
    }
  });

  // AudioToolbox is the same decoder the phone plays with.
  it.runIf(process.platform === "darwin")("produces a file AudioToolbox decodes to the full length", () => {
    const folder = temporaryDirectory("m4a");
    try {
      const wav = join(folder.path, "tone.wav");
      const samples = 48_000 * 3;
      const pcm = Buffer.alloc(44 + samples * 2);
      pcm.write("RIFF", 0); pcm.writeUInt32LE(36 + samples * 2, 4); pcm.write("WAVEfmt ", 8);
      pcm.writeUInt32LE(16, 16); pcm.writeUInt16LE(1, 20); pcm.writeUInt16LE(1, 22); pcm.writeUInt32LE(48_000, 24);
      pcm.writeUInt32LE(96_000, 28); pcm.writeUInt16LE(2, 32); pcm.writeUInt16LE(16, 34); pcm.write("data", 36); pcm.writeUInt32LE(samples * 2, 40);
      for (let index = 0; index < samples; index += 1) pcm.writeInt16LE(Math.round(Math.sin((index / 48_000) * 2 * Math.PI * 440) * 8_000), 44 + index * 2);
      writeFileSync(wav, pcm);
      const adts = join(folder.path, "tone.aac");
      execFileSync("/usr/bin/afconvert", ["-f", "adts", "-d", "aac", "-b", "64000", wav, adts]);
      const frames = adtsFrames(new Uint8Array(readFileSync(adts)));
      expect(frames.length).toBeGreaterThan(140);
      const m4a = join(folder.path, "tone.m4a");
      writeFileSync(m4a, muxM4a({ sampleRate: 48_000, channels: 1, frames }));
      const info = execFileSync("/usr/bin/afinfo", [m4a]).toString();
      expect(info).toContain("File type ID:   m4af");
      expect(info).toMatch(/1 ch,\s+48000 Hz, aac/);
      const seconds = Number(/estimated duration: ([\d.]+) sec/.exec(info)?.[1]);
      expect(seconds).toBeCloseTo(aacDuration(frames.length, 48_000), 1);
      const decoded = join(folder.path, "decoded.wav");
      execFileSync("/usr/bin/afconvert", ["-f", "WAVE", "-d", "LEI16", m4a, decoded]);
      expect(readFileSync(decoded).length).toBeGreaterThan(samples * 2 * 0.95);
    } finally {
      folder.cleanup();
    }
  });
});
