import { describe, expect, it } from "vitest";
import type { AskAnswer, AskTurn } from "../../src/ask/index.js";
import {
  cardinal, codeWords, Endpointing, graphemeToPhoneme, normalizeForSpeech, ordinal, Phonemizer, prepareSpokenText, spokenForm,
  spokenSentences, TalkSession, TurnTaker, yearWords, resample,
  type TalkAnswerer, type TalkHearing, type TalkListener, type TalkSnapshot, type TalkSpeaker,
} from "../../src/talk/index.js";

const answered: AskAnswer = { status: "answered", text: "December 2 in Atlanta.", citations: [] };

describe("Turn-taking rules", () => {
  it("runs a full turn", () => {
    const rules = new TurnTaker();
    expect(rules.handle({ kind: "start" })).toEqual([{ kind: "startListening" }]);
    expect(rules.handle({ kind: "speechStarted" })).toEqual([]);
    rules.handle({ kind: "partial", text: "when is the" });
    expect(rules.phase).toEqual({ kind: "hearing", partial: "when is the" });
    expect(rules.handle({ kind: "endOfTurn", text: "When is the Solberg deposition?" })).toEqual([{ kind: "ask", question: "When is the Solberg deposition?", history: [] }]);
    expect(rules.handle({ kind: "answered", answer: answered })).toEqual([{ kind: "speak", text: "December 2 in Atlanta." }]);
    expect(rules.handle({ kind: "finishedSpeaking" })).toEqual([]);
    expect(rules.phase).toEqual({ kind: "listening" });
    expect(rules.exchanges).toEqual([{ question: "When is the Solberg deposition?", answer: answered, interrupted: false }]);
  });

  it("silences Lana on barge-in and marks the exchange", () => {
    const rules = new TurnTaker();
    rules.handle({ kind: "start" });
    rules.handle({ kind: "endOfTurn", text: "When is the deposition?" });
    rules.handle({ kind: "answered", answer: answered });
    expect(rules.handle({ kind: "speechStarted" })).toEqual([{ kind: "stopSpeaking" }]);
    expect(rules.phase).toEqual({ kind: "hearing", partial: "" });
    expect(rules.exchanges[rules.exchanges.length - 1]?.interrupted).toBe(true);
    // The speaker's late "finished" callback must not knock us out of hearing.
    expect(rules.handle({ kind: "finishedSpeaking" })).toEqual([]);
    expect(rules.phase).toEqual({ kind: "hearing", partial: "" });
  });

  it("cancels the answer when the person keeps talking, and ignores it later", () => {
    const rules = new TurnTaker();
    rules.handle({ kind: "start" });
    rules.handle({ kind: "endOfTurn", text: "When is the deposition?" });
    expect(rules.handle({ kind: "speechStarted" })).toEqual([{ kind: "cancelAnswer" }]);
    expect(rules.handle({ kind: "answered", answer: answered })).toEqual([]);
    expect(rules.exchanges).toEqual([]);
  });

  it("treats noise as no turn", () => {
    const rules = new TurnTaker();
    rules.handle({ kind: "start" });
    rules.handle({ kind: "speechStarted" });
    expect(rules.handle({ kind: "endOfTurn", text: "uh" })).toEqual([]);
    expect(rules.phase).toEqual({ kind: "listening" });
  });

  it("carries recent history with follow-ups", () => {
    const rules = new TurnTaker();
    rules.historyTurns = 2;
    rules.handle({ kind: "start" });
    for (const question of ["First question?", "Second question?", "Third question?"]) {
      rules.handle({ kind: "endOfTurn", text: question });
      rules.handle({ kind: "answered", answer: answered });
      rules.handle({ kind: "finishedSpeaking" });
    }
    const [effect] = rules.handle({ kind: "endOfTurn", text: "And then?" });
    expect(effect?.kind === "ask" ? effect.history.map((turn) => turn.question) : []).toEqual(["Second question?", "Third question?"]);
  });

  it("stops from every phase", () => {
    const speaking = new TurnTaker();
    speaking.handle({ kind: "start" });
    speaking.handle({ kind: "endOfTurn", text: "Question here?" });
    speaking.handle({ kind: "answered", answer: answered });
    expect(speaking.handle({ kind: "stop" })).toEqual([{ kind: "stopSpeaking" }, { kind: "stopListening" }]);
    const thinking = new TurnTaker();
    thinking.handle({ kind: "start" });
    thinking.handle({ kind: "endOfTurn", text: "Question here?" });
    expect(thinking.handle({ kind: "stop" })).toEqual([{ kind: "cancelAnswer" }, { kind: "stopListening" }]);
    expect(new TurnTaker().handle({ kind: "stop" })).toEqual([]);
  });

  it("speaks a failed answer and never reads citations or guesses", () => {
    const rules = new TurnTaker();
    rules.handle({ kind: "start" });
    rules.handle({ kind: "endOfTurn", text: "Hard question?" });
    expect(rules.handle({ kind: "answerFailed" })).toEqual([{ kind: "speak", text: "Sorry, I could not work that out. Try asking another way." }]);
    expect(spokenForm({ status: "notFound", text: "", citations: [] })).toBe("I could not find that in your meetings.");
    expect(spokenForm({ status: "suggested", text: "Try this.", citations: [] })).toBe("Here is a suggestion, not something said in the meeting. Try this.");
    expect(spokenForm({ status: "declined", text: "", citations: [] })).toBe("I would rather not answer that one, but the closest passages are on screen.");
    expect(spokenForm({ status: "passagesOnly", reason: "appleIntelligenceNotEnabled", text: "", citations: [] })).toContain("Apple Intelligence is off");
    expect(spokenForm({ status: "passagesOnly", reason: "modelNotReady", text: "", citations: [] })).toBe("The answer model is not downloaded yet, so I can only show the closest passages on screen.");
  });
});

class FakeListener implements TalkListener {
  stopped = false;
  private sink: ((hearing: TalkHearing) => void) | undefined;
  async start(onHearing: (hearing: TalkHearing) => void): Promise<void> {
    this.sink = onHearing;
  }
  async stop(): Promise<void> {
    this.stopped = true;
    this.sink = undefined;
  }
  hear(hearing: TalkHearing): void {
    this.sink?.(hearing);
  }
}

class FakeSpeaker implements TalkSpeaker {
  readonly spoken: string[] = [];
  stops = 0;
  private release: (() => void) | undefined;
  speak(text: string): Promise<void> {
    this.spoken.push(text);
    return new Promise((resolve) => {
      this.release = resolve;
    });
  }
  async stop(): Promise<void> {
    this.stops += 1;
    this.finish();
  }
  finish(): void {
    this.release?.();
    this.release = undefined;
  }
}

const fakeAnswerer = (delayMs: number): TalkAnswerer => ({
  answer: (question: string, _history: readonly AskTurn[], signal: AbortSignal) => new Promise<AskAnswer>((resolve, reject) => {
    const timer = setTimeout(() => resolve({ status: "answered", text: `Answer to ${question}`, citations: [] }), delayMs);
    signal.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(new Error("aborted"));
    });
  }),
});

async function waitFor(session: TalkSession, predicate: (snapshot: TalkSnapshot) => boolean, timeout = 2_000): Promise<boolean> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (predicate(session.snapshot)) return true;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  return false;
}

describe("Talk session", () => {
  it("answers out loud, then listens again", async () => {
    const listener = new FakeListener();
    const speaker = new FakeSpeaker();
    const session = new TalkSession(listener, speaker, fakeAnswerer(10));
    const phases: string[] = [];
    session.onSnapshot((snapshot) => phases.push(snapshot.phase.kind));
    await session.start();
    listener.hear({ kind: "speechStarted" });
    listener.hear({ kind: "endOfTurn", text: "When is the deposition?" });
    expect(await waitFor(session, (s) => s.phase.kind === "speaking")).toBe(true);
    expect(speaker.spoken).toEqual(["Answer to When is the deposition?"]);
    speaker.finish();
    expect(await waitFor(session, (s) => s.phase.kind === "listening")).toBe(true);
    expect(phases).toEqual(["listening", "hearing", "thinking", "speaking", "listening"]);
  });

  it("stops the voice at once on barge-in", async () => {
    const listener = new FakeListener();
    const speaker = new FakeSpeaker();
    const session = new TalkSession(listener, speaker, fakeAnswerer(5));
    await session.start();
    listener.hear({ kind: "endOfTurn", text: "When is the deposition?" });
    expect(await waitFor(session, (s) => s.phase.kind === "speaking")).toBe(true);
    listener.hear({ kind: "speechStarted" });
    expect(await waitFor(session, (s) => s.phase.kind === "hearing")).toBe(true);
    expect(speaker.stops).toBe(1);
    expect(session.snapshot.exchanges[0]?.interrupted).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(session.snapshot.phase).toEqual({ kind: "hearing", partial: "" });
  });

  it("ends everything on stop, dropping a slow answer", async () => {
    const listener = new FakeListener();
    const speaker = new FakeSpeaker();
    const session = new TalkSession(listener, speaker, fakeAnswerer(5_000));
    await session.start();
    listener.hear({ kind: "endOfTurn", text: "A slow question?" });
    expect(await waitFor(session, (s) => s.phase.kind === "thinking")).toBe(true);
    await session.stop();
    expect(session.snapshot.phase).toEqual({ kind: "idle" });
    expect(listener.stopped).toBe(true);
    expect(speaker.spoken).toEqual([]);
  });

  it("speaks the failure line when answering fails", async () => {
    const listener = new FakeListener();
    const speaker = new FakeSpeaker();
    const session = new TalkSession(listener, speaker, { answer: async () => { throw new Error("model"); } });
    await session.start();
    listener.hear({ kind: "endOfTurn", text: "Anything?" });
    expect(await waitFor(session, (s) => s.phase.kind === "speaking")).toBe(true);
    expect(speaker.spoken).toEqual(["Sorry, I could not work that out. Try asking another way."]);
  });
});

describe("End of turn detection", () => {
  it("starts a turn after real speech and ends it after silence", () => {
    const endpoint = new Endpointing();
    endpoint.speechStarted(0);
    expect(endpoint.tick(0.1)).toBeUndefined();
    expect(endpoint.tick(0.3)).toBe("turnStarted");
    expect(endpoint.speechEnded(1.5)).toBeUndefined();
    expect(endpoint.tick(1.9)).toBeUndefined();
    expect(endpoint.tick(2.3)).toBe("turnEnded");
  });

  it("does not cut the person off at a mid-sentence pause", () => {
    const endpoint = new Endpointing();
    endpoint.speechStarted(0);
    expect(endpoint.speechEnded(1.0)).toBe("turnStarted");
    endpoint.speechStarted(1.4);
    expect(endpoint.tick(2.2)).toBeUndefined();
    expect(endpoint.speechEnded(3.0)).toBeUndefined();
    expect(endpoint.tick(3.8)).toBe("turnEnded");
  });

  it("ignores a cough", () => {
    const endpoint = new Endpointing();
    endpoint.speechStarted(0);
    expect(endpoint.speechEnded(0.1)).toBeUndefined();
    expect(endpoint.tick(1.0)).toBeUndefined();
    expect(endpoint.isTracking).toBe(false);
    endpoint.speechStarted(2);
    expect(endpoint.tick(2.3)).toBe("turnStarted");
  });
});

describe("Spoken text", () => {
  it("removes labels and quotes and splits long text at sentence ends", () => {
    expect(prepareSpokenText("He said “yes” [P2]. Then \"no\" (P10) ,  ok")).toBe("He said yes. Then no, ok");
    expect(spokenSentences("Dr. Solberg testifies. Then we file.", 10)).toEqual(["Dr. Solberg testifies.", "Then we file."]);
    expect(spokenSentences("One. Two. Three.")).toEqual(["One. Two. Three."]);
  });

  it("reads numbers as words", () => {
    expect(cardinal(0)).toBe("zero");
    expect(cardinal(1_205)).toBe("one thousand two hundred five");
    expect(cardinal(3_000_017n)).toBe("three million seventeen");
    expect(ordinal(2)).toBe("second");
    expect(ordinal(21)).toBe("twenty first");
    expect(ordinal(40)).toBe("fortieth");
    expect(ordinal(112)).toBe("one hundred twelfth");
    expect([yearWords(2026), yearWords(1900), yearWords(2005), yearWords(2000), yearWords(1907)]).toEqual(["twenty twenty six", "nineteen hundred", "two thousand five", "two thousand", "nineteen oh seven"]);
  });

  it.each([
    ["Call Ngozi Okonkwo-Zyxtrel about matter 2026-0147.", "Call Ngozi Okonkwo-Zyxtrel about matter twenty twenty six zero one four seven."],
    ["Depose Dr. Solberg on Dec. 2nd, 2026 at 9:30 a.m.", "Depose Doctor Solberg on December second, twenty twenty six at nine thirty A M"],
    ["Due 2026-11-25 or 11/25/26.", "Due November twenty fifth, twenty twenty six or November twenty fifth, twenty twenty six."],
    ["Pay $1,250.50, $3 million and $1.", "Pay one thousand two hundred fifty dollars and fifty cents, three million dollars and one dollar."],
    ["Up 15% to 3.5 hours at 10:05 and 4:00.", "Up fifteen percent to three point five hours at ten oh five and four o'clock."],
    ["Case 12-cv-0345, form W-9, exhibit A2 and P1.", "Case twelve C V zero three four five, form W nine, exhibit A two and P one."],
    ["Smith & Jones v. Acme, No. 7, room #12.", "Smith and Jones versus Acme, number seven, room number twelve."],
    ["1,204 deliveries since 1998, 42 boxes and 123456789 units.", "one thousand two hundred four deliveries since nineteen ninety eight, forty two boxes and one hundred twenty three million four hundred fifty six thousand seven hundred eighty nine units."],
  ])("normalizes %s", (input, expected) => {
    expect(normalizeForSpeech(input)).toBe(expected);
  });

  it("reads codes group by group", () => {
    expect(codeWords("2026-0147")).toBe("twenty twenty six zero one four seven");
    expect(codeWords("555-123-4567")).toBe("five five five one two three forty five sixty seven");
  });

  it("turns any letters into sounds with stress", () => {
    expect(graphemeToPhoneme("Ngozi")).toBe("ˌɪnɡˈOzi");
    expect(graphemeToPhoneme("Okonkwo")).toBe("ˈOkənkwO");
    expect(graphemeToPhoneme("Zyxtrel")).toBe("zˈɪkstɹəl");
    expect(graphemeToPhoneme("Kline")).toBe("klˈIn");
    expect(graphemeToPhoneme("123")).toBe("");
  });

  it("resamples by the rate ratio", () => {
    expect(resample(new Float32Array([0, 1, 0, 1]), 32_000, 16_000)).toEqual(new Float32Array([0, 0]));
    expect(resample(new Float32Array(480), 48_000, 16_000)).toHaveLength(160);
  });
});

describe("Phonemizer: no word is lost", () => {
  // A tiny lexicon in Kokoro's format, so this runs without the model files.
  const phonemizer = Phonemizer.fromLexiconText([
    "call k ˈ ɔ l", "about ə b ˈ W t", "matter m ˈ æ ɾ ə ɹ", "twenty t w ˈ ɛ n t i", "six s ˈ ɪ k s", "zero z ˈ ɪ ɹ O", "one w ˈ ʌ n",
    "four f ˈ ɔ ɹ", "seven s ˈ ɛ v ə n", "c s ˈ i", "l ˈ ɛ l", "delivery d ə l ˈ ɪ v ə ɹ i", "shah ʃ ˈ ɑ",
  ].join("\n"));

  it("maps every word of the matter sentence to sounds", () => {
    const result = phonemizer.sentence("Call Ngozi Okonkwo-Zyxtrel about matter 2026-0147.");
    expect(result.words.map((w) => w.word)).toEqual(["Call", "Ngozi", "Okonkwo", "Zyxtrel", "about", "matter", "twenty", "twenty", "six", "zero", "one", "four", "seven"]);
    expect(result.words.every((w) => w.phonemes.length > 0)).toBe(true);
    expect(result.words.filter((w) => w.source === "rules").map((w) => w.word)).toEqual(["Ngozi", "Okonkwo", "Zyxtrel"]);
    expect(result.phonemes).toBe("kˈɔl ˌɪnɡˈOzi ˈOkənkwO zˈɪkstɹəl əbˈWt mˈæɾəɹ twˈɛnti twˈɛnti sˈɪks zˈɪɹO wˈʌn fˈɔɹ sˈɛvən.");
  });

  it("spells acronyms, inflects known words and adds possessives", () => {
    expect(phonemizer.words("LLC")).toEqual([{ word: "LLC", phonemes: "ˈɛl ˈɛl sˈi", source: "spelled" }]);
    expect(phonemizer.words("deliveries")[0]).toEqual({ word: "deliveries", phonemes: "dəlˈɪvəɹiz", source: "lexicon" });
    expect(phonemizer.words("Shah's")[0]?.phonemes).toBe("ʃˈɑz");
    expect(phonemizer.sentence("a").phonemes).toBe("ɐ");
  });
});
