import { describe, expect, it } from "vitest";
import { clusterOf, mergeSpeakers, sourceOf, type HeardSegment } from "../../src/recording/index.js";

const line = (start: number, end: number, text: string, mic: number, system: number): HeardSegment => ({ start, end, text, mic, system });

describe("speaker labels from the diarizer and the channels", () => {
  it("reads a line's channel only when one is clearly louder", () => {
    expect(sourceOf({ mic: 0.2, system: 0.01 })).toBe("mic");
    expect(sourceOf({ mic: 0.01, system: 0.2 })).toBe("system");
    expect(sourceOf({ mic: 0.1, system: 0.08 })).toBe("mixed");
    expect(sourceOf({ mic: 0.001, system: 0.0005 })).toBe("mixed");
    expect(clusterOf({ start: 1, end: 3 }, [{ start: 0, end: 1.5, speaker: 4 }, { start: 1.5, end: 3, speaker: 7 }])).toBe(7);
    expect(clusterOf({ start: 5, end: 6 }, [{ start: 0, end: 1, speaker: 4 }])).toBeNull();
  });

  it("makes the mic speaker S1 and numbers the others in order of first speaking", () => {
    const merged = mergeSpeakers(
      [
        line(0, 2, "Hi everyone.", 0.01, 0.2),
        line(3, 5, "Thanks for joining.", 0.2, 0.01),
        line(6, 8, "Happy to be here.", 0.01, 0.2),
        line(9, 11, "One question.", 0.01, 0.3),
      ],
      [{ start: 0, end: 2, speaker: 5 }, { start: 3, end: 5, speaker: 0 }, { start: 6, end: 8, speaker: 2 }, { start: 9, end: 11, speaker: 5 }],
    );
    expect(merged.transcript.map((segment) => segment.speaker)).toEqual(["S2", "S1", "S3", "S2"]);
    expect(merged.speakers).toEqual([{ id: "S1" }, { id: "S2" }, { id: "S3" }]);
  });

  it("trusts the mic over a diarizer that merged the local person into a remote cluster", () => {
    const merged = mergeSpeakers(
      [line(0, 2, "Remote talks.", 0.01, 0.2), line(3, 5, "Local answers.", 0.2, 0.01), line(6, 8, "Remote again.", 0.01, 0.2)],
      [{ start: 0, end: 8, speaker: 1 }],
    );
    expect(merged.transcript.map((segment) => segment.speaker)).toEqual(["S2", "S1", "S2"]);
  });

  it("keeps a remote line remote when the diarizer put it with the local person", () => {
    const merged = mergeSpeakers(
      [line(0, 2, "Local.", 0.3, 0.01), line(3, 5, "Local more.", 0.3, 0.01), line(6, 8, "Remote.", 0.01, 0.3)],
      [{ start: 0, end: 8, speaker: 0 }],
    );
    expect(merged.transcript.map((segment) => segment.speaker)).toEqual(["S1", "S2"]);
    expect(merged.transcript[0]?.text).toBe("Local. Local more.");
  });

  it("falls back to the diarizer alone when one channel was silent the whole time", () => {
    const merged = mergeSpeakers(
      [line(0, 2, "A one.", 0.2, 0), line(3, 5, "B one.", 0.2, 0), line(6, 8, "A two.", 0.2, 0)],
      [{ start: 0, end: 2, speaker: 3 }, { start: 3, end: 5, speaker: 1 }, { start: 6, end: 8, speaker: 3 }],
    );
    expect(merged.transcript.map((segment) => segment.speaker)).toEqual(["S1", "S2", "S1"]);
  });

  it("joins close lines of one speaker, but not past the line cap or a long pause", () => {
    const merged = mergeSpeakers(
      [line(0, 10, "a", 0.2, 0), line(10.5, 20, "b", 0.2, 0), line(20.5, 31, "c", 0.2, 0), line(40, 41, "d", 0.2, 0), line(41.2, 41.9, "  ", 0.2, 0)],
      [],
    );
    expect(merged.transcript.map((segment) => [segment.start, segment.end, segment.text])).toEqual([[0, 20, "a b"], [20.5, 31, "c"], [40, 41, "d"]]);
    expect(merged.speakers).toEqual([{ id: "S1" }]);
  });
});
