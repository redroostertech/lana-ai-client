import { appendFileSync, readdirSync, readFileSync, truncateSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { utf8 } from "../../src/bytes/index.js";
import { mixChannels, packFrames, packPcm, RecordingJournal, rms, softClip, unpackFrames, unpackPcm } from "../../src/recording/index.js";
import { FieldSealer } from "../../src/store/index.js";
import { temporaryDirectory } from "../support/storeRig.js";

const sealer = new FieldSealer(new Uint8Array(32).fill(3));
let folder: { path: string; cleanup: () => void };
beforeEach(() => (folder = temporaryDirectory("journal")));
afterEach(() => folder.cleanup());

describe("recording journal (chunked, encrypted, crash safe)", () => {
  it("round trips records, metadata and the scratch pad, and never writes clear text", () => {
    const journal = RecordingJournal.create(folder.path, "mtg_A", sealer);
    journal.append("aac", packFrames([new Uint8Array([1, 2]), new Uint8Array([3])]));
    journal.append("aac", packFrames([new Uint8Array([4])]));
    journal.append("pcm", utf8("secret words heard in the meeting"));
    journal.writeMeta({ title: "Client intake", state: "recording" });
    journal.writeNotes([{ text: "call back" }]);
    journal.close();
    expect(journal.read("aac").flatMap(unpackFrames).map((frame) => [...frame])).toEqual([[1, 2], [3], [4]]);
    expect(journal.readMeta()).toEqual({ title: "Client intake", state: "recording" });
    expect(journal.readNotes()).toEqual([{ text: "call back" }]);
    for (const name of readdirSync(join(folder.path, "mtg_A"))) {
      const raw = readFileSync(join(folder.path, "mtg_A", name)).toString("latin1");
      expect(raw).not.toContain("secret");
      expect(raw).not.toContain("Client intake");
      expect(raw).not.toContain("call back");
    }
    expect(RecordingJournal.list(folder.path)).toEqual(["mtg_A"]);
  });

  it("keeps every whole record after a crash mid-write and appends after them", () => {
    const journal = RecordingJournal.create(folder.path, "mtg_B", sealer);
    for (let index = 0; index < 5; index += 1) journal.append("pcm", new Uint8Array([index, index, index, index]));
    journal.close();
    const path = join(folder.path, "mtg_B", "pcm.journal");
    const size = readFileSync(path).length;
    truncateSync(path, size - 7);
    const reopened = RecordingJournal.reopen(folder.path, "mtg_B", sealer);
    expect(reopened.read("pcm").map((record) => record[0])).toEqual([0, 1, 2, 3]);
    reopened.append("pcm", new Uint8Array([9, 9, 9, 9]));
    reopened.close();
    expect(RecordingJournal.reopen(folder.path, "mtg_B", sealer).read("pcm").map((record) => record[0])).toEqual([0, 1, 2, 3, 9]);
  });

  it("stops at a record that does not open, and refuses records moved between recordings", () => {
    const a = RecordingJournal.create(folder.path, "mtg_C", sealer);
    a.append("aac", new Uint8Array([1]));
    a.append("aac", new Uint8Array([2]));
    a.close();
    // Garbage appended after a crash is ignored.
    appendFileSync(join(folder.path, "mtg_C", "aac.journal"), Buffer.from([0, 0, 0, 9, 1, 2, 3, 4, 5, 6, 7, 8, 9]));
    expect(RecordingJournal.reopen(folder.path, "mtg_C", sealer).read("aac").map((record) => record[0])).toEqual([1, 2]);
    // The same bytes under another recording's id do not open.
    const b = RecordingJournal.create(folder.path, "mtg_D", sealer);
    b.close();
    writeFileSync(join(folder.path, "mtg_D", "aac.journal"), readFileSync(join(folder.path, "mtg_C", "aac.journal")));
    expect(RecordingJournal.reopen(folder.path, "mtg_D", sealer).read("aac")).toEqual([]);
    // A different key opens nothing.
    expect(RecordingJournal.reopen(folder.path, "mtg_C", new FieldSealer(new Uint8Array(32).fill(4))).read("aac")).toEqual([]);
  });

  it("removes itself once the meeting is stored", () => {
    const journal = RecordingJournal.create(folder.path, "mtg_E", sealer);
    journal.append("pcm", new Uint8Array(4));
    journal.remove();
    expect(RecordingJournal.list(folder.path)).toEqual([]);
  });
});

describe("transcription audio", () => {
  it("packs both channels as 16-bit and back", () => {
    const mic = Float32Array.from([0, 0.5, -0.5, 1, -1]);
    const system = Float32Array.from([0.25, -0.25, 0, 0.75, 0]);
    const out = unpackPcm([packPcm({ mic: mic.slice(0, 2), system: system.slice(0, 2) }), packPcm({ mic: mic.slice(2), system: system.slice(2) })]);
    expect([...out.mic].map((value) => Math.round(value * 100) / 100)).toEqual([0, 0.5, -0.5, 1, -1]);
    expect([...out.system].map((value) => Math.round(value * 100) / 100)).toEqual([0.25, -0.25, 0, 0.75, 0]);
    expect(() => packPcm({ mic, system: system.slice(1) })).toThrow();
  });

  it("mixes without hard clipping and pads the shorter channel", () => {
    expect(softClip(0.5)).toBe(0.5);
    expect(softClip(2)).toBeLessThan(1);
    expect(softClip(-2)).toBeGreaterThan(-1);
    expect(softClip(0.9)).toBeGreaterThan(0.8);
    const mixed = mixChannels({ mic: Float32Array.from([0.2, 0.9]), system: Float32Array.from([0.3, 0.9, 0.1]) });
    expect(mixed.length).toBe(3);
    expect(mixed[0]).toBeCloseTo(0.5);
    expect(mixed[1]).toBeLessThan(1);
    expect(mixed[2]).toBeCloseTo(0.1);
    expect(rms(Float32Array.from([1, -1, 1, -1]))).toBe(1);
    expect(rms(new Float32Array(0))).toBe(0);
  });
});
