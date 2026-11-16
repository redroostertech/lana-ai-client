import { describe, expect, it } from "vitest";
import { correctVocabulary, recognizedWords, soundKey, syllables, type TranscribedWord } from "../../src/recording/meetingVocabulary.js";
import { mergeSpeakers } from "../../src/recording/diarizationMerge.js";

// Port of the Swift MeetingVocabularyTests (Nov 13) plus the firm word list. Synthetic words only.
const SURE = 0.95;
const UNSURE = 0.3;
const word = (text: string, confidence: number | undefined, start = 0): TranscribedWord => ({ text, start, end: start + 0.4, confidence });
const texts = (words: readonly TranscribedWord[]): string[] => words.map((item) => item.text);

describe("meeting vocabulary rules (Swift MeetingVocabulary)", () => {
  it("matches the misheard pairs by sound", () => {
    expect(soundKey("senses")).toBe(soundKey("census"));
    expect(soundKey("Asian")).toBe(soundKey("agent"));
    expect(soundKey("Ben")).not.toBe(soundKey("Dan"));
    expect(syllables("sense")).toBe(1);
    expect(syllables("census")).toBe(2);
  });

  it("replaces an unsure word with a confident meeting term, keeping times and the original", () => {
    const words = [word("employee", SURE), word("census,", SURE), word("give", SURE), word("me", SURE), word("your", SURE), word("senses,", UNSURE, 9)];
    const corrected = correctVocabulary(words);
    expect(corrected[5]).toEqual({ text: "census,", start: 9, end: 9.4, confidence: UNSURE, recognizedText: "senses," });
    expect(corrected.slice(0, 5)).toEqual(words.slice(0, 5));
  });

  it("leaves confident and unknown words alone and never invents a term", () => {
    const sure = [word("census", SURE), word("senses", SURE)];
    expect(correctVocabulary(sure)).toEqual(sure);
    const unknown = [word("census", SURE), word("senses", undefined)];
    expect(correctVocabulary(unknown)).toEqual(unknown);
    const unsure = [word("census", UNSURE), word("senses", UNSURE)];
    expect(correctVocabulary(unsure)).toEqual(unsure);
  });

  it("lets a meeting's own usage win, and never touches short or one-syllable words", () => {
    const own = [word("census", SURE), word("senses", SURE), word("senses", UNSURE)];
    expect(correctVocabulary(own)).toEqual(own);
    const short = [word("sense", SURE), word("sense", SURE), word("since", UNSURE), word("Dan", SURE), word("Ben", UNSURE)];
    expect(correctVocabulary(short)).toEqual(short);
  });

  it("fixes acronyms one letter off, keeping the plural, and leaves ambiguous ones", () => {
    expect(texts(correctVocabulary([word("PEO", SURE), word("PEO", SURE), word("PELs.", UNSURE), word("PO", UNSURE)]))).toEqual(["PEO", "PEO", "PEOs.", "PEO"]);
    const ambiguous = [word("PEO", SURE), word("PEA", SURE), word("PEL", UNSURE)];
    expect(correctVocabulary(ambiguous)).toEqual(ambiguous);
  });

  it("capitalizes at a sentence start only", () => {
    const words = [word("agent", SURE), word("agent", SURE), word("done.", SURE), word("Asian", UNSURE), word("this", SURE), word("Asian", UNSURE)];
    expect(texts(correctVocabulary(words))).toEqual(["agent", "agent", "done.", "Agent", "this", "agent"]);
  });
});

describe("the firm's word list", () => {
  it("counts a firm term as confident evidence that beats the meeting's own spelling", () => {
    const words = [word("our", SURE), word("Lately", SURE), word("account", SURE), word("Leadley", UNSURE, 3)];
    const corrected = correctVocabulary(words, { firm: [{ term: "Leadli" }] });
    expect(corrected[3]!.text).toBe("Leadli");
    expect(corrected[3]!.recognizedText).toBe("Leadley");
    // A confident word stays as heard.
    expect(correctVocabulary([word("Leadley", SURE)], { firm: [{ term: "Leadli" }] })[0]!.text).toBe("Leadley");
  });

  it("replaces a spelling the firm listed, of up to three words, whatever the confidence", () => {
    const words = [word("Open", SURE, 0), word("lead", SURE, 1), word("lease,", SURE, 2), word("then", SURE, 3), word("Action", SURE, 4), word("step.", SURE, 5)];
    const corrected = correctVocabulary(words, { firm: [{ term: "Leadli", alsoHeardAs: ["lead lease"] }, { term: "Actionstep", alsoHeardAs: ["action step"] }] });
    expect(texts(corrected)).toEqual(["Open", "Leadli,", "then", "Actionstep."]);
    expect(corrected[1]).toMatchObject({ start: 1, end: 2.4, recognizedText: "lead lease," });
  });
});

describe("words from the recognizer's tokens", () => {
  it("joins sub-word tokens into words with the lowest token confidence", () => {
    const words = recognizedWords({ tokens: [" em", "ployee", " sen", "ses", "."], timestamps: [0, 0.2, 0.6, 0.8, 0.95], ys_log_probs: [Math.log(0.9), Math.log(0.7), Math.log(0.4), Math.log(0.95), 0] }, 10, 11.2);
    expect(texts(words)).toEqual(["employee", "senses."]);
    expect(words.map((item) => item.start)).toEqual([10, 10.6]);
    expect(words.map((item) => Number(item.confidence!.toFixed(3)))).toEqual([0.7, 0.4]);
    expect(words.at(-1)!.end).toBe(11.2);
  });

  it("keeps the recognizer's line on merged lines that were corrected", () => {
    const merged = mergeSpeakers([
      { start: 0, end: 1, text: "census census", recognizedText: "census senses", mic: 0, system: 0 },
      { start: 5, end: 6, text: "Thanks.", mic: 0, system: 0 },
    ], [{ start: 0, end: 1, speaker: 0 }, { start: 4.9, end: 6, speaker: 1 }]);
    expect(merged.transcript).toEqual([
      { speaker: "S1", start: 0, end: 1, text: "census census", recognizedText: "census senses" },
      { speaker: "S2", start: 5, end: 6, text: "Thanks." },
    ]);
  });
});
