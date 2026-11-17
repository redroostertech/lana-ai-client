import { describe, expect, it } from "vitest";
import { AVAILABLE } from "../../src/ask/backend.js";
import type { LanaId } from "../../src/ids/lanaId.js";
import type { Intent, KeyPoint, MeetingRecord, SetAsidePart, Speaker, TranscriptSegment } from "../../src/intent/index.js";
import { localMeetingRecord } from "../../src/recording/index.js";
import { buildMeetingState } from "../../src/state/index.js";
import { titleOf } from "../../src/intent/index.js";
import type { TextModel, TextModelRequest } from "../../src/runtime/index.js";
import { workflowDefinition } from "../../src/runtime/index.js";
import {
  FIND_MORE_CHUNK_BUDGET, FIND_MORE_MAX_SUGGESTIONS, FIND_MORE_RULES, findMoreInstructions, findMorePrompt, knownForChunk, NoteFinder, notesInstructions,
  answeredText, checkDueYear, checkYears, checkedKind, commitmentAction, covered, meetingPeople, taskShape, FIND_MORE_KIND_WORDS, parseFindMore, RuntimeNotesBackend, validateFindMore, type FindMoreKnown, type TokenCounter,
} from "../../src/summarizer/index.js";

// Synthetic meeting text only.
const transcript: TranscriptSegment[] = [
  { speaker: "S1", start: 0, end: 8, text: "Welcome. Today we review the onboarding plan for the Harbor account." },
  { speaker: "S2", start: 8, end: 16, text: "The setup fee is 1,200 dollars and the monthly fee is 300." },
  { speaker: "S1", start: 16, end: 25, text: "The main risk is that the data export from the old system takes three weeks." },
  { speaker: "S2", start: 25, end: 33, text: "I'll send you the draft checklist tonight and copy Priya on the email." },
  { speaker: "S1", start: 33, end: 41, text: "Hold on, my other line is ringing, I need to take this call." },
  { speaker: "S3", start: 41, end: 70, text: "Hi, it's about the dentist appointment on Thursday, can you move it?" },
  { speaker: "S1", start: 70, end: 78, text: "Okay, sorry about that, I'm back. The pilot starts on the bronze plan." },
  { speaker: "S2", start: 78, end: 86, text: "Who signs the vendor contract on your side?" },
];
const speakers: Speaker[] = [{ id: "S1", name: "Dana Reyes" }, { id: "S2", name: "Omar Haddad" }, { id: "S3" }];
const meetingID = "mtg_01JCQ7A1B2C3D4E5F6G7H8J9KM" as LanaId;
const words: TokenCounter = { tokenCount: (text) => text.split(/\s+/u).filter((word) => word !== "").length };
const existing: KeyPoint[] = [
  { id: "kp-1", kind: "summary", text: "The team reviewed the onboarding plan for the Harbor account.", sources: [{ start: 0, end: 8, speaker: "S1" }], precision: "exact" },
];

class Scripted implements TextModel {
  readonly modelID = "scripted";
  readonly calls: TextModelRequest[] = [];
  constructor(private readonly replies: string[]) {}
  async availability() {
    return AVAILABLE;
  }
  async respond(request: TextModelRequest): Promise<string> {
    this.calls.push(request);
    return this.replies[this.calls.length - 1] ?? "NONE";
  }
}

let ids = 0;
interface Scenario {
  readonly transcript?: TranscriptSegment[];
  readonly keyPoints?: KeyPoint[];
  readonly actions?: Intent[];
  readonly dismissed?: FindMoreKnown[];
  readonly setAside?: SetAsidePart[];
  readonly progress?: (part: number, of: number) => void;
}

/** The find options over a meeting state built from synthetic parts. */
const options = (extra: Scenario = {}): Parameters<NoteFinder["find"]>[0] => {
  const record: MeetingRecord = {
    ...localMeetingRecord({
      id: meetingID, title: "Harbor intake", startedAt: new Date("2026-11-16T14:00:00Z"), durationSeconds: 90,
      consent: { method: "verbal_announced", confirmedBy: [], confirmedAt: new Date("2026-11-16T14:00:00Z") },
      userNotes: [], appVersion: "0.1.0", speakers, transcript: extra.transcript ?? transcript,
    }),
  };
  const withNotes: MeetingRecord = { ...record, notes: { keyPoints: extra.keyPoints ?? existing, gaps: [], setAside: extra.setAside ?? [{ start: 33, end: 70, reason: "phone_call" }] } };
  const state = buildMeetingState({ record: withNotes, actions: extra.actions ?? [], vocabulary: [], waiting: [], dismissed: extra.dismissed ?? [], removed: [] });
  return {
    state,
    now: new Date("2026-11-16T15:00:00Z"),
    meetingStart: new Date("2026-11-16T14:00:00Z"),
    intentID: () => `int_01JCQ7A1B2C3D4E5F6G7H8J9${String(ids++).padStart(2, "0")}` as LanaId,
    ...(extra.progress === undefined ? {} : { progress: extra.progress }),
  };
};

function finder(model: TextModel, budget = { targetTokens: 1_000, maxTokens: 2_000 }): NoteFinder {
  return new NoteFinder(new RuntimeNotesBackend(model, undefined, words), budget);
}

describe("Find more notes: the prompt", () => {
  it("is the notes instructions plus the find more rules", () => {
    expect(findMoreInstructions("standard")).toBe(`${notesInstructions("standard")} ${FIND_MORE_RULES}`);
    expect(FIND_MORE_RULES).toContain("Write a question only when no line in this part answers it. Write no SUMMARY line and no ASIDE line. If nothing is missing, reply NONE.");
  });

  it("lists what is already in the notes, then the part, with no earlier summary", () => {
    const known: FindMoreKnown[] = [
      { kind: "summary", text: "The plan | was reviewed\nagain", sources: [{ start: 0, end: 8 }] },
      { kind: "task", text: "Send the checklist", sources: [{ start: 25, end: 33 }] },
    ];
    const prompt = findMorePrompt({ chunk: { index: 1, segments: transcript.slice(0, 2), estimatedTokens: 0 }, speakers, phrasing: "standard", known, vocabulary: ["Harbor"] });
    expect(prompt).toContain("Speakers: S1 is Dana Reyes, S2 is Omar Haddad.");
    expect(prompt).toContain("Spell these names exactly: Harbor.");
    expect(prompt).toContain("Already in the notes, do not repeat:\n- Key point: The plan was reviewed again\n- Task: Send the checklist");
    expect(prompt).toContain("Transcript part 2:\nL1 S1");
    expect(prompt).not.toContain("Earlier in the meeting");
  });

  it("leaves the list out when nothing is known", () => {
    const prompt = findMorePrompt({ chunk: { index: 0, segments: transcript.slice(0, 1), estimatedTokens: 0 }, speakers: [], phrasing: "standard", known: [] });
    expect(prompt).not.toContain("Already in the notes");
  });

  it("takes known items within 60 seconds of the part, in time order, at most 30, cut to 200 characters", () => {
    const chunk = { index: 0, segments: [{ speaker: "S1", start: 300, end: 320, text: "A line." }], estimatedTokens: 0 };
    const items: FindMoreKnown[] = [
      { kind: "decision", text: "Late", sources: [{ start: 379, end: 390 }] },
      { kind: "summary", text: "Near before", sources: [{ start: 200, end: 241 }] },
      { kind: "summary", text: "Far before", sources: [{ start: 100, end: 239 }] },
      { kind: "open_question", text: "x".repeat(250), sources: [{ start: 310, end: 312 }] },
      { kind: "summary", text: "Far after", sources: [{ start: 381, end: 400 }] },
    ];
    const known = knownForChunk(chunk, items);
    expect(known.map((item) => item.text.slice(0, 11))).toEqual(["Near before", "x".repeat(11), "Late"]);
    expect(known[1]!.text).toHaveLength(200);
    const many = Array.from({ length: 40 }, (_, index) => ({ kind: "summary" as const, text: `Item ${index}`, sources: [{ start: 300 + index, end: 301 + index }] }));
    expect(knownForChunk(chunk, many)).toHaveLength(30);
  });

  it("uses half the normal chunk budget and caps at 15", () => {
    expect(FIND_MORE_CHUNK_BUDGET).toEqual({ targetTokens: 750, maxTokens: 1_000 });
    expect(FIND_MORE_MAX_SUGGESTIONS).toBe(15);
  });

  it("reads NONE as a valid empty reply and ignores SUMMARY, ASIDE and TABLE lines", () => {
    expect(validateFindMore("NONE").valid).toBe(true);
    expect(validateFindMore("none.").valid).toBe(true);
    expect(validateFindMore("I could not find anything").valid).toBe(false);
    const chunk = { index: 0, segments: transcript, estimatedTokens: 0 };
    expect(parseFindMore("NONE", chunk, speakers).points).toEqual([]);
    const parsed = parseFindMore("SUMMARY: x\nASIDE: phone_call | L5, L6\nTABLE: Fees | Item; Amount\nROW: Fees | L2 | Setup; 1,200\nPOINT: summary | L2 | The setup fee is 1,200 dollars.", chunk, speakers);
    expect(parsed.points).toHaveLength(1);
    expect(parsed.asides ?? []).toEqual([]);
    expect(parsed.tables ?? []).toEqual([]);
    expect(parsed.runningSummary).toBe("");
  });

  it("runs the notes.more.v1 workflow", async () => {
    const model = new Scripted(["NONE"]);
    await finder(model).find(options());
    expect(model.calls).toHaveLength(1);
    expect(model.calls[0]!.instructions).toContain(FIND_MORE_RULES);
    expect(model.calls[0]!.prompt).toContain("Already in the notes, do not repeat:\n- Key point: The team reviewed the onboarding plan for the Harbor account.");
    expect(workflowDefinition("notes.more.v1").states[0]).toMatchObject({ id: "extract", temperature: 0.2, output_schema: "lana.notes.more.v1" });
  });
});

describe("Find more notes: suggestions", () => {
  it("never sends set-aside lines to the model and never cites them", async () => {
    const model = new Scripted(["POINT: summary | L5 | The caller asked to move a dentist appointment.\nPOINT: summary | L2 | The setup fee is 1,200 dollars and the monthly fee is 300."]);
    const result = await finder(model).find(options());
    expect(model.calls[0]!.prompt).not.toContain("dentist");
    expect(model.calls[0]!.prompt).not.toContain("other line is ringing");
    for (const suggestion of result.suggestions) {
      for (const span of suggestion.sources) expect(span.end <= 33 || span.start >= 70).toBe(true);
    }
    expect(result.suggestions.map((item) => item.text)).toContain("The setup fee is 1,200 dollars and the monthly fee is 300.");
  });

  it("drops a suggestion that repeats a note, a dismissed one, or another suggestion", async () => {
    const model = new Scripted([[
      "POINT: summary | L1 | The team reviewed the onboarding plan for the Harbor account.",
      "POINT: summary | L3 | The main risk is a data export that takes three weeks.",
      "POINT: summary | L2 | The setup fee is 1,200 dollars and the monthly fee is 300.",
      "POINT: summary | L2 | The setup fee is 1,200 dollars and the monthly fee is 300.",
    ].join("\n")]);
    const result = await finder(model).find(options({ dismissed: [{ kind: "summary", text: "The main risk is a data export that takes three weeks.", sources: [{ start: 16, end: 25 }] }] }));
    expect(result.suggestions.map((item) => item.text)).toEqual(["The setup fee is 1,200 dollars and the monthly fee is 300."]);
    expect(model.calls[0]!.prompt).toContain("- Key point: The main risk is a data export that takes three weeks.");
  });

  it("makes a promise a task, drops logistics, and drops a point citing no real line", async () => {
    const model = new Scripted([[
      "POINT: decision | L4 | S2 | Omar will send the draft checklist tonight.",
      "POINT: decision | L5 | S1 | Screen sharing is set up for the call.",
      "POINT: summary | L40 | A point citing a line that does not exist.",
      // Set-aside lines are not sent, so the part numbers its lines without them.
      "POINT: question | L6 | Who signs the vendor contract is still open.",
    ].join("\n")]);
    const result = await finder(model).find(options());
    const task = result.suggestions.find((item) => item.kind === "task");
    expect(task?.intent).toBeDefined();
    expect(titleOf(task!.intent!.params)).toBe("Send the draft checklist tonight");
    expect(task!.intent!.status).toBe("proposed");
    expect(result.suggestions.map((item) => item.kind).sort()).toEqual(["open_question", "task"]);
  });

  it("drops a task that matches an action the meeting already has, or a dismissed task", async () => {
    const reply = "ACTION: task | L4 | Send the draft checklist | Omar sends the checklist | tonight | S2 | none";
    const first = await finder(new Scripted([reply])).find(options());
    expect(first.suggestions).toHaveLength(1);
    const again = await finder(new Scripted([reply])).find(options({ actions: [first.suggestions[0]!.intent!] }));
    expect(again.suggestions).toEqual([]);
    const dismissed = await finder(new Scripted([reply])).find(options({ dismissed: [{ kind: "task", text: "Send the draft checklist", sources: [{ start: 25, end: 33 }] }] }));
    expect(dismissed.suggestions).toEqual([]);
  });

  it("keeps at most 15, taken in turn from each part with figures first", async () => {
    const word = (index: number, part: number) => `${String.fromCharCode(97 + (index % 26))}${String.fromCharCode(97 + Math.floor(index / 26))}${String.fromCharCode(97 + part)}word`;
    const long: TranscriptSegment[] = Array.from({ length: 40 }, (_, index) => ({ speaker: "S1", start: index * 10, end: index * 10 + 9, text: `${word(index, 0)} ${word(index, 1)} ${word(index, 2)}.` }));
    // Echoes one point per line of the part; the last line's point carries a figure (its start time).
    const echo: TextModel = {
      modelID: "echo",
      availability: async () => AVAILABLE,
      respond: async (request) => {
        const lines = [...request.prompt.matchAll(/^L(\d+) S1 \[(\d+)[^\]]*\]: (.*)$/gmu)];
        return lines.map((match, index) => `POINT: summary | L${match[1]} | ${match[3]!.replace(/\.$/u, "")}${index === lines.length - 1 ? ` costs ${match[2]} dollars` : ""}.`).join("\n");
      },
    };
    const result = await finder(echo, { targetTokens: 60, maxTokens: 80 }).find(options({ transcript: long, keyPoints: [], setAside: [] }));
    expect(result.chunkCount).toBeGreaterThan(3);
    expect(result.suggestions).toHaveLength(15);
    expect(result.suggestions.filter((item) => /costs \d+ dollars/u.test(item.text)).length).toBe(Math.min(result.chunkCount, 15));
    const starts = result.suggestions.map((item) => item.sources[0]!.start);
    expect([...starts].sort((a, b) => a - b)).toEqual(starts);
  });

  it("drops a rewording of a note, of any kind", async () => {
    expect(covered("The onboarding plan for the Harbor account was reviewed.", [existing[0]!.text])).toBe(true);
    expect(covered("The setup fee is 1,200 dollars.", [existing[0]!.text])).toBe(false);
    // Same figures, other words: a rewording of the note that already holds them.
    const house = "The house, bought for 410,000 dollars and worth 780,000 dollars, goes into the trust.";
    expect(covered("The house was purchased for 410,000 dollars and is currently valued at about 780,000.", [house])).toBe(true);
    expect(covered("The roof estimate for the house is 9,000 dollars.", [house])).toBe(false);
    const model = new Scripted(["POINT: decision | L1 | S1 | The Harbor account onboarding plan is reviewed today.\nPOINT: summary | L2 | The setup fee is 1,200 dollars and the monthly fee is 300."]);
    const result = await finder(model).find(options());
    expect(result.suggestions.map((item) => item.text)).toEqual(["The setup fee is 1,200 dollars and the monthly fee is 300."]);
  });

  it("checks suggested questions against the lines from where they were asked: an answered one becomes its answer, then is checked like any note", async () => {
    const model = new Scripted([
      "POINT: question | L2 | What the setup fee and monthly fee are.\nPOINT: question | L6 | Who signs the vendor contract on their side.",
      "Q1: answered | 2 | The setup fee is 1,200 dollars and the monthly fee is 300 dollars.\nQ2: open",
    ]);
    const result = await finder(model).find(options());
    expect(model.calls).toHaveLength(2);
    expect(model.calls[1]!.prompt).toContain("The setup fee is 1,200 dollars and the monthly fee is 300.");
    expect(result.suggestions.map((item) => [item.kind, item.text])).toEqual([
      ["summary", "The setup fee is 1,200 dollars and the monthly fee is 300 dollars."],
      ["open_question", "Who signs the vendor contract on their side."],
    ]);
    // Answered by a line the notes already cover: the answer is a rewording and is dropped.
    const known = await finder(new Scripted([
      "POINT: question | L1 | What the team reviewed today.",
      "Q1: answered | 1 | The team reviewed the onboarding plan for the Harbor account.",
    ])).find(options());
    expect(known.suggestions).toEqual([]);
  });

  it("checks every suggested question, six to a call", async () => {
    const word = (index: number, part: number) => `${String.fromCharCode(97 + index)}${String.fromCharCode(97 + part)}zword`;
    const asked = (index: number) => `Which ${word(index, 0)} ${word(index, 1)} ${word(index, 2)}`;
    const lines: TranscriptSegment[] = Array.from({ length: 8 }, (_, index) => ({ speaker: "S2", start: index * 10, end: index * 10 + 8, text: `${asked(index)}?` }));
    const reply = lines.map((_, index) => `POINT: question | L${index + 1} | ${asked(index)}.`).join("\n");
    const model = new Scripted([reply, "Q1: open", "Q1: open"]);
    const result = await finder(model).find(options({ transcript: lines, keyPoints: [], setAside: [] }));
    expect(model.calls.filter((call) => call.prompt.includes("Questions:"))).toHaveLength(2);
    expect(model.calls[1]!.prompt).toContain("Q6:");
    expect(model.calls[2]!.prompt).toContain("Q2:");
    expect(model.calls[2]!.prompt).not.toContain("Q3:");
    expect(result.suggestions).toHaveLength(8);
  });

  it("keeps a question only when it reads as one, and a decision only when it is settled", async () => {
    expect(checkedKind("open_question", "The current value of the house is 780,000 dollars.")).toBe("summary");
    expect(checkedKind("open_question", "Who signs the vendor contract")).toBe("open_question");
    expect(checkedKind("open_question", "Whether the tenant must agree.")).toBe("open_question");
    expect(checkedKind("open_question", "The fee for the notary?")).toBe("open_question");
    expect(checkedKind("decision", "Guardian for Yasmin remains undecided until Leila is consulted.")).toBe("open_question");
    expect(checkedKind("decision", "The deed waits until the client confirms the address.")).toBe("open_question");
    expect(checkedKind("decision", "Approval is pending the board vote.")).toBe("open_question");
    expect(checkedKind("decision", "The start date depends on financing.")).toBe("open_question");
    expect(checkedKind("decision", "The venue is not-decided yet.")).toBe("open_question");
    expect(checkedKind("decision", "The pilot starts on the bronze plan.")).toBe("decision");
    expect(checkedKind("decision", "Spending is capped until December.")).toBe("decision");
    expect(checkedKind("summary", "Nothing is decided?")).toBe("summary");
    expect(FIND_MORE_KIND_WORDS.unsettled).toContain("not yet decided");
    const model = new Scripted(["POINT: question | L2 | The setup fee is 1,200 dollars and the monthly fee is 300.\nPOINT: decision | L5 | S1 | The pilot plan remains open until the client confirms."]);
    const result = await finder(model).find(options());
    expect(result.suggestions.map((item) => [item.kind, item.decidedBy])).toEqual([["summary", undefined], ["open_question", undefined]]);
  });

  it("writes an answered question as its answer alone when that reads on its own, else with the question (Amendments 5 and 6)", async () => {
    expect(answeredText("Whether the house is held as joint tenants.", "Yes, the house is held as joint tenants in both names.")).toBe("The house is held as joint tenants in both names.");
    expect(answeredText("Whether the house is held as joint tenants.", "Yes.")).toBe("Is the house held as joint tenants? Yes.");
    expect(answeredText("Who signs?", "The controller.")).toBe("Who signs? The controller.");
    expect(answeredText("Whether the family that owns the lake house in the north is willing to sell.", "Probably.")).toBeUndefined();
    expect(answeredText("Whether Nadia serves as guardian is discussed.", "The speakers agree Nadia serves.")).toBeUndefined();
    expect(answeredText("Who signs?", "It was noted, and the speakers agree.")).toBeUndefined();
    const long = `The controller signs every vendor contract. ${"Every contract over a set amount also goes to the board for a second review. ".repeat(4)}`;
    expect(answeredText("Who signs?", long)).toBe("The controller signs every vendor contract.");
    const model = new Scripted([
      "POINT: question | L6 | Who signs the vendor contract on their side.",
      "Q1: answered | 1 | The vendor contract signer.",
    ]);
    const result = await finder(model).find(options());
    const answered = result.suggestions.find((item) => item.kind === "summary")!;
    expect(answered.text).toBe("Who signs the vendor contract on their side? The vendor contract signer.");
    expect(answered.sources[0]!.start).toBe(78);
    expect("answer" in answered).toBe(false);
  });

  it("drops a reported question", async () => {
    const result = await finder(new Scripted(["POINT: summary | L6 | Omar asks who signs the vendor contract on their side."])).find(options());
    expect(result.suggestions).toEqual([]);
  });

  it("makes a key point that is a named person's commitment a task with that owner", async () => {
    const cited = [transcript[3]!];
    expect(commitmentAction("Omar will send the draft checklist tonight.", cited)).toMatchObject({ type: "task.create", title: "Send the draft checklist tonight", assigneeHint: "Omar", dueText: "tonight" });
    expect(commitmentAction("Priya to prepare the deed by Friday.", cited)).toMatchObject({ title: "Prepare the deed by Friday", assigneeHint: "Priya", dueText: "by Friday" });
    expect(commitmentAction("S2 is going to send the checklist.", cited)?.assigneeHint).toBe("S2");
    expect(commitmentAction("The team will review the plan.", cited)).toBeUndefined();
    expect(commitmentAction("We will send the checklist.", cited)?.assigneeHint).toBe("S2");
    expect(commitmentAction("Omar likes the bronze plan.", cited)).toBeUndefined();
    const model = new Scripted(["POINT: summary | L4 | Omar will send the draft checklist tonight."]);
    const result = await finder(model).find(options());
    expect(result.suggestions).toHaveLength(1);
    const task = result.suggestions[0]!;
    expect(task.kind).toBe("task");
    expect(task.intent?.params.type === "task.create" && task.intent.params.task.assigneeHint).toBe("Omar");
  });

  it("takes a commitment from a decision with any verb when a person of the meeting makes it, and shapes task owners and titles (Amendment 6)", async () => {
    const people = meetingPeople(speakers, transcript);
    expect(people.has("omar")).toBe(true);
    expect(people.has("priya")).toBe(true);
    const cited = [transcript[3]!];
    expect(commitmentAction("Omar will submit the forms himself because the plan only takes his forms.", cited, people)).toMatchObject({ title: "Submit the forms himself", assigneeHint: "Omar" });
    expect(commitmentAction("Zed will submit the forms.", cited, people)).toBeUndefined();
    const base = { type: "task.create" as const, body: "", recipients: [], confidence: 0.7, evidence: [{ speaker: "S3", tStart: 0, tEnd: 1, quote: "I will send you an inventory worksheet tonight." }] };
    expect(taskShape({ ...base, title: "inventory worksheet", assigneeHint: "Priya Shah" }, new Set(["priya", "shah", "priya shah"]))).toMatchObject({ title: "Send inventory worksheet", assigneeHint: "Priya Shah" });
    expect(taskShape({ ...base, title: "Prepare the deed", assigneeHint: "client: Omar and Leila" }, people)?.assigneeHint).toBeUndefined();
    expect(taskShape({ ...base, title: "Prepare the deed", assigneeHint: "client: Omar" }, people)?.assigneeHint).toBe("Omar");
    expect(taskShape({ ...base, title: "the paperwork", evidence: [{ speaker: "S1", tStart: 0, tEnd: 1, quote: "Someone handles the paperwork." }] }, people)).toBeUndefined();
    const result = await finder(new Scripted(["POINT: decision | L4 | S2 | Omar will email the draft checklist tonight."])).find(options());
    expect(result.suggestions.map((item) => [item.kind, item.text])).toEqual([["task", "Email the draft checklist tonight"]]);
  });

  it("drops a rewording that shares half its words and at least three with one note", () => {
    expect(covered("Half payment now and half at signing is agreed.", ["The fee is 3,200 dollars, with half paid now and half at signing."])).toBe(false);
    expect(covered("The team reviewed the Harbor plan today.", [existing[0]!.text])).toBe(true);
    expect(covered("Harbor plan.", [existing[0]!.text])).toBe(false);
  });

  it("uses the question form when a stand-alone answer starts with a pronoun or connective, and only a real question (Amendment 7)", () => {
    expect(answeredText("Who submits the beneficiary forms?", "You submit them, since the plan only takes forms from the owner.")).toBe("Who submits the beneficiary forms? You submit them, since the plan only takes forms from the owner.");
    expect(answeredText("Where were the directives made?", "They were created in Illinois in 2012.")).toBe("Where were the directives made? They were created in Illinois in 2012.");
    expect(answeredText("Should the trust own the brokerage account?", "Probably yes, but I want to see the statement first.")).toBe("Should the trust own the brokerage account? Probably yes, but I want to see the statement first.");
    expect(answeredText("When the guardian decision will be made.", "The guardian decision is open until next Friday.")).toBe("The guardian decision is open until next Friday.");
    expect(answeredText("When the guardian decision will be made.", "It stays open.")).toBeUndefined();
    expect(answeredText("Whether the venue that the client prefers for the long signing is booked.", "It is.")).toBeUndefined();
    expect(answeredText("Whether the house is held as joint tenants.", "It is held in both names, as joint tenants.")).toBe("Is the house held as joint tenants? It is held in both names, as joint tenants.");
  });

  it("drops a task title under two words", () => {
    const base = { type: "task.create" as const, body: "", recipients: [], confidence: 0.7, evidence: [{ speaker: "S2", tStart: 0, tEnd: 1, quote: "Thanks." }] };
    expect(taskShape({ ...base, title: "Email", assigneeHint: "Omar" }, new Set(["omar"]))).toBeUndefined();
    expect(taskShape({ ...base, title: "Email Priya", assigneeHint: "Omar" }, new Set(["omar"]))?.title).toBe("Email Priya");
  });

  it("keeps a person's name as the meeting writes it in a task title, and drops verb plus name with no object (Amendment 8)", () => {
    const people = new Set(["omar", "priya", "leila"]);
    const forms = new Map([["omar", "Omar"], ["priya", "Priya"], ["leila", "Leila"]]);
    const base = { type: "task.create" as const, body: "", recipients: [], confidence: 0.7, evidence: [{ speaker: "S2", tStart: 0, tEnd: 1, quote: "I will check with Leila tonight and confirm the date with Priya." }] };
    expect(taskShape({ ...base, title: "Omar", assigneeHint: "Omar" }, people, forms)).toBeUndefined();
    expect(taskShape({ ...base, title: "Leila about the date", assigneeHint: "Omar" }, people, forms)?.title).toBe("Check Leila about the date");
    expect(taskShape({ ...base, title: "Confirm the date with priya", assigneeHint: "Omar" }, people, forms)?.title).toBe("Confirm the date with Priya");
    expect(taskShape({ ...base, title: "Check with Leila", assigneeHint: "Omar" }, people, forms)).toBeUndefined();
    expect(taskShape({ ...base, title: "Email Priya", assigneeHint: "Omar" }, people, forms)?.title).toBe("Email Priya");
  });

  it("never keeps a year the cited lines did not say (Amendment 8)", () => {
    const start = new Date(2026, 10, 16, 10, 0);
    expect(checkYears("The signing is aimed for December 9, 2024.", "We are aiming to sign on December 9, if Leila can come.", start)).toBe("The signing is aimed for December 9, 2026.");
    expect(checkYears("Due 9 January 2024.", "Due January 9.", start)).toBe("Due 9 January 2027.");
    expect(checkYears("They bought the house in 2014.", "We bought it in 2014 for 410,000 dollars.", start)).toBe("They bought the house in 2014.");
    expect(checkYears("The return covers 2023.", "The return covers last year.", start)).toBeUndefined();
    expect(checkDueYear("2024-12-09", "We sign on December 9.", start)).toBe("2026-12-09");
    expect(checkDueYear("2027-01-09", "We sign on January 9, 2027.", start)).toBe("2027-01-09");
    expect(checkDueYear("2026-11-20", "By Friday.", start)).toBe("2026-11-20");
  });

  it("writes speaker names, not labels, in suggestions and task owners (Amendment 9)", async () => {
    const model = new Scripted(["POINT: decision | L2 | S2 | S2 and S1 agree the setup fee is 1,200 dollars.\nACTION: task | L4 | Send the draft checklist to S1 | Send it tonight | tonight | S3 | none"]);
    const result = await finder(model).find(options());
    const texts = result.suggestions.map((item) => item.text);
    expect(texts).toContain("Omar Haddad and Dana Reyes agree the setup fee is 1,200 dollars.");
    const task = result.suggestions.find((item) => item.kind === "task")!;
    expect(task.text).toBe("Send the draft checklist to Dana Reyes");
    expect(task.intent?.params.type === "task.create" && task.intent.params.task.assigneeHint).toBe("Speaker 3");
    expect(result.suggestions.find((item) => item.kind === "decision")?.decidedBy).toBe("S2");
  });

  it("says nothing new with an empty list", async () => {
    const result = await finder(new Scripted(["NONE"])).find(options());
    expect(result.suggestions).toEqual([]);
    expect(result.chunkCount).toBe(1);
  });

  it("reports progress as part n of total", async () => {
    const seen: string[] = [];
    await finder(new Scripted(["NONE"])).find(options({ progress: (part, of) => seen.push(`${part}/${of}`) }));
    expect(seen).toEqual(["1/1"]);
  });
});
