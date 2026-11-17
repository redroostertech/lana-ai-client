import { describe, expect, it } from "vitest";
import { AVAILABLE } from "../../src/ask/backend.js";
import type { LanaId } from "../../src/ids/lanaId.js";
import { decodeNotes, encodeNotes, type Speaker, type TranscriptSegment } from "../../src/intent/index.js";
import type { TextModel, TextModelRequest } from "../../src/runtime/index.js";
import { finalSetAside, MeetingSummarizer, notesInstructions, notesPrompt, parseNotes, RuntimeNotesBackend, type TokenCounter } from "../../src/summarizer/index.js";
import { resolveDueText } from "../../src/summarizer/dueDates.js";

// Synthetic meeting text only.
const transcript: TranscriptSegment[] = [
  { speaker: "S1", start: 0, end: 8, text: "Welcome. Today we review the onboarding plan for the Harbor account." },
  { speaker: "S2", start: 8, end: 15, text: "Can everyone see my screen? Let me refresh the browser." },
  { speaker: "S1", start: 15, end: 24, text: "Yes, I can see it now. The setup fee is 1,200 dollars and the monthly fee is 300." },
  { speaker: "S2", start: 24, end: 33, text: "I'll send you the draft checklist tonight and copy Priya on the email." },
  { speaker: "S1", start: 33, end: 41, text: "Hold on, my other line is ringing, I need to take this call." },
  { speaker: "S3", start: 41, end: 60, text: "Hi, it's about the dentist appointment on Thursday, can you move it?" },
  { speaker: "S1", start: 60, end: 75, text: "Sure, move it to Friday morning. Okay, sorry about that, I'm back." },
  { speaker: "S2", start: 75, end: 84, text: "So we agree the pilot starts with the bronze plan at 150 a month." },
  { speaker: "S1", start: 84, end: 92, text: "Agreed, the pilot starts on the bronze plan." },
  { speaker: "S2", start: 92, end: 100, text: "Who approves the vendor contract?" },
  { speaker: "S1", start: 100, end: 108, text: "Our controller approves every vendor contract." },
];
const chunk = { index: 0, segments: transcript, estimatedTokens: 0 };
const speakers: Speaker[] = [{ id: "S1", name: "Dana Reyes" }, { id: "S2", name: "Omar Haddad" }, { id: "S3" }];
const meetingID = "mtg_01JCQ7A1B2C3D4E5F6G7H8J9KM" as LanaId;
const words: TokenCounter = { tokenCount: (text) => text.split(/\s+/u).filter((word) => word !== "").length };

class Scripted implements TextModel {
  readonly modelID = "scripted";
  readonly calls: TextModelRequest[] = [];
  constructor(private readonly replies: string[]) {}
  async availability() {
    return AVAILABLE;
  }
  async respond(request: TextModelRequest): Promise<string> {
    this.calls.push(request);
    return this.replies[this.calls.length - 1] ?? "SUMMARY: nothing";
  }
}

describe("strict parsing of the notes reply", () => {
  it("never keeps a point whose text holds raw | fields", () => {
    const parsed = parseNotes([
      "POINT: summary | L1 | The plan was reviewed | none | Dana | Harbor | none",
      "POINT: question | L10 | Who approves contracts | The meeting left this open",
      "POINT: summary | L3 | The setup fee is 1,200 dollars and the monthly fee is 300.",
    ].join("\n"), chunk);
    for (const point of parsed.points) expect(point.text).not.toContain("|");
    expect(parsed.points.map((point) => point.text)).toEqual(["The setup fee is 1,200 dollars and the monthly fee is 300."]);
  });

  it("reads a point line with action fields as an action", () => {
    const parsed = parseNotes("POINT: decision | L4 | Send the draft checklist | Omar sends it tonight | none | S2 | Harbor", chunk);
    expect(parsed.points).toEqual([]);
    expect(parsed.candidates).toHaveLength(1);
    expect(parsed.candidates[0]).toMatchObject({ type: "task.create", title: "Send the draft checklist", assigneeHint: "S2", regardingName: "Harbor" });
  });

  it("keeps who decided on a decision, and drops a decision whose third field is not a person", () => {
    const parsed = parseNotes([
      "POINT: decision | L8, L9 | S1 | The pilot starts on the bronze plan at 150 a month.",
      "POINT: decision | L8 | Move to bronze | The team agreed to reduce cost",
      "POINT: decision | L9 | both | Pilot on bronze.",
    ].join("\n"), chunk);
    expect(parsed.points).toEqual([
      { kind: "decision", text: "The pilot starts on the bronze plan at 150 a month.", lines: [8, 9], decidedBy: "S1" },
      { kind: "decision", text: "Pilot on bronze.", lines: [9] },
    ]);
  });

  it("keeps the spoken words for when, and a calendar date as the date", () => {
    const parsed = parseNotes([
      "ACTION: task | L4 | Send draft checklist | Omar sends the draft checklist and copies Priya | tonight | S2 | Harbor",
      "ACTION: email | L4 | Email Priya | Copy Priya on the checklist email | 2026-11-20 | S2 | none",
    ].join("\n"), chunk);
    expect(parsed.candidates[0]).toMatchObject({ dueText: "tonight", assigneeHint: "S2" });
    expect(parsed.candidates[0]!.dueDate).toBeUndefined();
    expect(parsed.candidates[1]).toMatchObject({ dueDate: "2026-11-20" });
    expect(parsed.candidates[1]!.dueText).toBeUndefined();
  });

  it("reads tables, rows and set-aside lines", () => {
    const parsed = parseNotes([
      "TABLE: Fees | Item; Amount",
      "ROW: Fees | L3 | Setup fee; 1,200 dollars",
      "ROW: Fees | L3 | Monthly fee; 300",
      "ROW: Fees | L3 | Too; many; cells",
      "ROW: Unknown table | L3 | a; b",
      "ASIDE: phone_call | L5, L7",
      "ASIDE: lunch_break | L5, L7",
      "ASIDE: logistics | L2",
    ].join("\n"), chunk);
    expect(parsed.tables).toEqual([{ title: "Fees", columns: ["Item", "Amount"], rows: [{ cells: ["Setup fee", "1,200 dollars"], lines: [3] }, { cells: ["Monthly fee", "300"], lines: [3] }] }]);
    expect(parsed.asides).toEqual([{ reason: "phone_call", lines: [5, 7] }, { reason: "logistics", lines: [2] }]);
  });

  it("drops the format's own example text when the model repeats it", () => {
    const parsed = parseNotes("POINT: summary | L1 | One short sentence about what was discussed.\nACTION: task | L4 | Short title | One sentence of detail | none | S2 | none", chunk);
    expect(parsed.points).toEqual([]);
    expect(parsed.candidates).toEqual([]);
  });

  it("reads a six-field action with line numbers as an action without regarding (Nov 13)", () => {
    const parsed = parseNotes("ACTION: task | L4 | Send draft checklist | Omar sends the checklist | none | S2", chunk);
    expect(parsed.candidates[0]).toMatchObject({ title: "Send draft checklist", assigneeHint: "S2" });
    expect(parsed.candidates[0]!.regardingName).toBeUndefined();
  });

  it("moves an action citation to the line that says it (Nov 13 LineMatcher)", () => {
    const parsed = parseNotes("ACTION: task | L1 | Send draft checklist tonight | Send the draft checklist tonight and copy Priya on the email | none | S2 | none", chunk);
    expect(parsed.candidates[0]!.evidence.map((quote) => quote.tStart)).toEqual([24]);
  });
});

describe("notes instructions and prompt", () => {
  it("define decisions narrowly, route promises to actions, keep figures and describe set-aside parts", () => {
    const text = notesInstructions("standard");
    expect(text).toContain("A promise to do something is an ACTION, not a decision.");
    expect(text).toContain("screen sharing");
    expect(text).toContain("Keep every amount, percentage, count and duration");
    expect(text).toContain("ASIDE: phone_call | L20, L31");
    expect(text).toContain("TABLE:");
    expect(text).not.toMatch(/[–—]/u);
  });

  it("tells the model the firm's spellings", () => {
    const prompt = notesPrompt({ chunk, runningSummary: "", speakers, phrasing: "standard", vocabulary: ["Leadli", "Actionstep"] });
    expect(prompt).toContain("Spell these names exactly: Leadli, Actionstep.");
    expect(notesPrompt({ chunk, runningSummary: "", speakers, phrasing: "standard" })).not.toContain("Spell these names");
  });
});

describe("relative due dates", () => {
  const start = new Date(2026, 10, 11, 15, 4); // Wednesday, November 11, 2026, local time
  it("resolves the words people use against the meeting start", () => {
    expect(resolveDueText("tonight", start)).toBe("2026-11-11");
    expect(resolveDueText("by end of day", start)).toBe("2026-11-11");
    expect(resolveDueText("tomorrow", start)).toBe("2026-11-12");
    expect(resolveDueText("by Friday", start)).toBe("2026-11-13");
    expect(resolveDueText("Monday", start)).toBe("2026-11-16");
    expect(resolveDueText("next Wednesday", start)).toBe("2026-11-18");
    expect(resolveDueText("this week", start)).toBe("2026-11-13");
    expect(resolveDueText("soon", start)).toBeUndefined();
    expect(resolveDueText("next month", start)).toBeUndefined();
  });
});

describe("whole meeting notes", () => {
  async function run(reply: string, extra: Partial<Parameters<MeetingSummarizer["summarize"]>[0]> = {}, checkReply = "Q1: open") {
    const model = new Scripted(extra.fixedSetAside === undefined ? [reply, "NONE", checkReply] : [reply, checkReply]);
    const summarizer = new MeetingSummarizer(new RuntimeNotesBackend(model, undefined, words), { targetTokens: 4000, maxTokens: 6000 });
    let id = 0;
    const result = await summarizer.summarize({
      transcript, speakers, meetingID, now: new Date(2026, 10, 11, 16, 0), meetingStart: new Date(2026, 10, 11, 15, 4),
      intentID: () => `int_01JCQ7A1B2C3D4E5F6G7H8J9K${"MNPQRSTVWX"[id++]}` as LanaId, ...extra,
    });
    return { result, model };
  }

  it("turns a promise filed as a decision into an action with an owner and a due date", async () => {
    const { result } = await run("POINT: decision | L4 | S2 | Omar will send the draft checklist tonight and copy Priya.\nSUMMARY: Checklist.");
    expect(result.notes.keyPoints.filter((point) => point.kind === "decision")).toEqual([]);
    expect(result.intents).toHaveLength(1);
    const params = result.intents[0]!.params;
    expect(params.type).toBe("task.create");
    if (params.type !== "task.create") return;
    expect(params.task.assigneeHint).toBe("Omar Haddad");
    expect(params.task.dueText).toBe("tonight");
    expect(params.task.dueDate).toBe("2026-11-11");
  });

  it("drops meeting setup filed as a decision", async () => {
    const { result } = await run("POINT: decision | L2, L3 | S1 | The screen is now visible after refreshing the browser.\nSUMMARY: Setup.");
    expect(result.notes.keyPoints).toEqual([]);
  });

  it("keeps who decided as a speaker label", async () => {
    const { result } = await run("POINT: decision | L8, L9 | Dana Reyes | The pilot starts on the bronze plan at 150 a month.\nSUMMARY: Pilot.");
    expect(result.notes.keyPoints[0]).toMatchObject({ kind: "decision", decidedBy: "S1" });
  });

  it("resolves an action's spoken date and names its owner", async () => {
    const { result } = await run("ACTION: task | L4 | Send draft checklist | Omar sends the checklist and copies Priya | tonight | S2 | Harbor\nSUMMARY: x");
    const params = result.intents[0]!.params;
    if (params.type !== "task.create") throw new Error("task expected");
    expect(params.task).toMatchObject({ dueDate: "2026-11-11", dueText: "tonight", assigneeHint: "Omar Haddad" });
  });

  it("sets aside a phone call and drops what cites it", async () => {
    const { result } = await run([
      "ASIDE: phone_call | L5, L7",
      "POINT: summary | L6 | A dentist appointment moves to Friday.",
      "ACTION: task | L7 | Move the appointment | Move the dentist appointment to Friday | none | S1 | none",
      "POINT: summary | L3 | The setup fee is 1,200 dollars and the monthly fee is 300.",
      "SUMMARY: x",
    ].join("\n"));
    expect(result.notes.setAside).toEqual([{ start: 33, end: 75, reason: "phone_call", speakers: ["S1", "S3"] }]);
    expect(result.notes.keyPoints.map((point) => point.text)).toEqual(["The setup fee is 1,200 dollars and the monthly fee is 300."]);
    expect(result.intents).toEqual([]);
  });

  it("ignores a set-aside stretch shorter than 20 seconds", async () => {
    const short = await run("ASIDE: logistics | L2\nSUMMARY: x");
    expect(short.result.notes.setAside ?? []).toEqual([]);
  });

  it("on a rewrite keeps the person's reviewed parts exactly, never shows their lines to the model, and ignores model asides", async () => {
    const fixed = await run("ASIDE: logistics | L1, L3\nPOINT: summary | L3 | The setup fee is 1,200 dollars and the monthly fee is 300.\nSUMMARY: x", {
      fixedSetAside: [{ start: 33, end: 75, reason: "phone_call", speakers: ["S1", "S3"] }],
    });
    expect(fixed.result.notes.setAside).toEqual([{ start: 33, end: 75, reason: "phone_call", speakers: ["S1", "S3"] }]);
    expect(fixed.model.calls[0]!.prompt).not.toContain("dentist");
    expect(fixed.model.calls[0]!.prompt).not.toContain("other line");
    expect(fixed.result.notes.keyPoints.map((point) => point.text)).toEqual(["The setup fee is 1,200 dollars and the monthly fee is 300."]);
    const restored = await run("ASIDE: phone_call | L5, L7\nSUMMARY: x", { fixedSetAside: [] });
    expect(restored.result.notes.setAside ?? []).toEqual([]);
  });

  it("builds tables with their sources", async () => {
    const { result } = await run("TABLE: Fees | Item; Amount\nROW: Fees | L3 | Setup fee; 1,200 dollars\nROW: fees | L3 | Monthly fee; 300\nSUMMARY: x");
    expect(result.notes.tables).toEqual([{ title: "Fees", columns: ["Item", "Amount"], rows: [["Setup fee", "1,200 dollars"], ["Monthly fee", "300"]], sources: [{ start: 15, end: 24, speaker: "S1" }] }]);
    const encoded = encodeNotes(result.notes);
    expect(decodeNotes(encoded, "notes").tables).toEqual(result.notes.tables);
  });

  it("turns a question answered later in the meeting into a key point (Nov 13 open question check)", async () => {
    const { result, model } = await run(
      "POINT: question | L10 | Who approves the vendor contract?\nSUMMARY: x",
      {},
      "Q1: answered | 1 | The controller approves every vendor contract.",
    );
    expect(model.calls).toHaveLength(3);
    expect(model.calls[2]!.prompt).toContain("Q1: Who approves the vendor contract?");
    expect(result.notes.keyPoints).toEqual([
      expect.objectContaining({ kind: "summary", text: "The controller approves every vendor contract.", sources: [{ start: 100, end: 108, speaker: "S1" }] }),
    ]);
  });

  it("passes the firm's word list to every chunk prompt", async () => {
    const { model } = await run("SUMMARY: x", { vocabulary: ["Leadli"] });
    expect(model.calls[0]!.prompt).toContain("Spell these names exactly: Leadli.");
  });
});

describe("Ask passages sent to LANA", () => {
  it("leave out set-aside lines and anything citing them", async () => {
    const { PassageBuilder } = await import("../../src/ask/index.js");
    const { localMeetingRecord } = await import("../../src/recording/index.js");
    const base = localMeetingRecord({
      id: meetingID, title: "Synthetic", startedAt: new Date(2026, 10, 11), durationSeconds: 108,
      consent: { method: "verbal_announced", confirmedBy: [], confirmedAt: new Date(2026, 10, 11) }, userNotes: [], appVersion: "0.1.0", speakers, transcript,
    });
    const record = {
      ...base,
      notes: {
        keyPoints: [
          { id: "kp-1", kind: "summary" as const, text: "A dentist appointment moves.", sources: [{ start: 41, end: 60, speaker: "S3" }], precision: "exact" as const },
          { id: "kp-2", kind: "summary" as const, text: "Fees were set.", sources: [{ start: 15, end: 24, speaker: "S1" }], precision: "exact" as const },
        ],
        gaps: [],
        setAside: [{ start: 33, end: 75, reason: "phone_call" as const }],
      },
    };
    const passages = new PassageBuilder(30, 0).passages(record);
    const text = passages.map((passage) => passage.text).join("\n");
    expect(text).not.toContain("dentist");
    expect(text).not.toContain("other line");
    expect(text).toContain("Fees were set.");
    expect(text).toContain("bronze plan");
  });
});

describe("a pinned clip in Ask", () => {
  it("leaves out set-aside lines", async () => {
    const { clipPassage } = await import("../../src/ask/clipPassage.js");
    const { localMeetingRecord } = await import("../../src/recording/index.js");
    const base = localMeetingRecord({
      id: meetingID, title: "Synthetic", startedAt: new Date(2026, 10, 11), durationSeconds: 108,
      consent: { method: "verbal_announced", confirmedBy: [], confirmedAt: new Date(2026, 10, 11) }, userNotes: [], appVersion: "0.1.0", speakers, transcript,
    });
    const record = { ...base, notes: { keyPoints: [], gaps: [], setAside: [{ start: 33, end: 75, reason: "phone_call" as const }] } };
    const passage = clipPassage({ id: "c1", start: 24, end: 84, createdAt: new Date(2026, 10, 11) }, record);
    expect(passage?.text).toContain("draft checklist");
    expect(passage?.text).not.toContain("dentist");
  });
});

describe("action and row shapes small models write (seen on a real meeting, synthetic text here)", () => {
  it("reads an action whose kind was left out and its title written first", () => {
    const parsed = parseNotes("ACTION: send revised schedule | L4 | Omar sends the revised schedule and copies Priya | tonight | S2 | none", chunk);
    expect(parsed.candidates[0]).toMatchObject({ type: "task.create", title: "send revised schedule", body: "Omar sends the revised schedule and copies Priya", dueText: "tonight", assigneeHint: "S2" });
  });

  it("reads an action with who written before the title", () => {
    const parsed = parseNotes("ACTION: task | L4 | S2 | Send the revised schedule tonight | tonight | S2", chunk);
    expect(parsed.candidates[0]).toMatchObject({ title: "Send the revised schedule tonight", assigneeHint: "S2", dueText: "tonight" });
  });

  it("reads a five-field action as title, when or detail, and who", () => {
    expect(parseNotes("ACTION: task | L4 | Send the revised schedule | none | Omar Haddad", chunk).candidates[0]).toMatchObject({ title: "Send the revised schedule", assigneeHint: "Omar Haddad" });
    const detail = parseNotes("ACTION: task | L4 | Send the revised schedule | Omar sends it and copies Priya | S2", chunk).candidates[0]!;
    expect(detail).toMatchObject({ body: "Omar sends it and copies Priya", assigneeHint: "S2" });
    expect(detail.dueText).toBeUndefined();
  });

  it("drops field labels the model copies from the format", () => {
    const parsed = parseNotes("ACTION: task | L4 | Send the revised schedule | Omar sends it | when: tonight | who: S2 | none", chunk);
    expect(parsed.candidates[0]).toMatchObject({ dueText: "tonight", assigneeHint: "S2" });
  });

  it("reads a row written with | between cells and no line numbers, citing the line it repeats", () => {
    const parsed = parseNotes("TABLE: Fees | Item; Amount\nROW: Fees | Setup fee | 1,200 dollars\nROW: Fees | Unrelated words | nothing here", chunk);
    expect(parsed.tables).toEqual([{ title: "Fees", columns: ["Item", "Amount"], rows: [{ cells: ["Setup fee", "1,200 dollars"], lines: [3] }] }]);
  });
});

describe("point and action shapes, round two (synthetic)", () => {
  it("reads a point whose kind was written as a topic as a key point, or by the kind its topic names", () => {
    const parsed = parseNotes([
      "POINT: fees | L3 | The setup fee is 1,200 dollars and the monthly fee is 300.",
      "POINT: open question on approvals | L10 | Who approves the vendor contract?",
    ].join("\n"), chunk);
    expect(parsed.points).toEqual([
      { kind: "summary", text: "The setup fee is 1,200 dollars and the monthly fee is 300.", lines: [3] },
      { kind: "open_question", text: "Who approves the vendor contract?", lines: [10] },
    ]);
  });

  it("reads an action with no kind and who before the detail, and treats 'not specified' as none", () => {
    const parsed = parseNotes("ACTION: send revised schedule | L4 | S2 | Send the revised schedule and copy Priya | not specified | none", chunk);
    expect(parsed.candidates[0]).toMatchObject({ title: "send revised schedule", body: "Send the revised schedule and copy Priya", assigneeHint: "S2" });
    expect(parsed.candidates[0]!.dueText).toBeUndefined();
  });
});

describe("the set-aside check (notes.aside.v1)", () => {
  it("asks once per part what is not part of the meeting and sets those stretches aside", async () => {
    // The notes mark only the middle of the call (L6); the check finds all of it (L5 to L7), and the guard keeps it because they overlap.
    // The notes range alone is under 20 s: it still backs the checked part, because the guard runs before the 20 s drop.
    const replies = ["ASIDE: phone_call | L6\nPOINT: summary | L6 | A dentist appointment moves to Friday.\nPOINT: summary | L3 | The setup fee is 1,200 dollars and the monthly fee is 300.\nSUMMARY: Onboarding fees.", "ASIDE: phone_call | L5-L7"];
    const model = new Scripted(replies);
    const summarizer = new MeetingSummarizer(new RuntimeNotesBackend(model, undefined, words), { targetTokens: 4000, maxTokens: 6000 });
    const result = await summarizer.summarize({ transcript, speakers, meetingID, now: new Date(2026, 10, 11, 16, 0) });
    expect(model.calls[1]!.instructions).toContain("not part of this meeting");
    expect(model.calls[1]!.prompt).toContain("The meeting is about: Onboarding fees.");
    expect(result.notes.setAside).toEqual([{ start: 33, end: 75, reason: "phone_call", speakers: ["S1", "S3"] }]);
    expect(result.notes.keyPoints.map((point) => point.text)).toEqual(["The setup fee is 1,200 dollars and the monthly fee is 300."]);
  });

  it("reads NONE and junk as nothing set aside, and is skipped on a rewrite", async () => {
    const { parseAsideCheck } = await import("../../src/summarizer/asideCheck.js");
    expect(parseAsideCheck("NONE", chunk)).toEqual([]);
    expect(parseAsideCheck("ASIDE: lunch | L2\nsomething else", chunk)).toEqual([]);
    expect(parseAsideCheck("ASIDE: other_matter | L5, L6, L7", chunk)).toEqual([{ reason: "other_matter", lines: [5, 6, 7] }]);
    const model = new Scripted(["SUMMARY: x"]);
    await new MeetingSummarizer(new RuntimeNotesBackend(model, undefined, words), { targetTokens: 4000, maxTokens: 6000 })
      .summarize({ transcript, speakers, meetingID, now: new Date(), fixedSetAside: [] });
    expect(model.calls).toHaveLength(1);
  });
});

describe("rules adopted from the phone's real-meeting rerun (synthetic)", () => {
  const visitorTranscript: TranscriptSegment[] = [
    { speaker: "S1", start: 0, end: 300, text: "We go over the onboarding schedule for the Harbor account." },
    { speaker: "S2", start: 300, end: 600, text: "The setup fee is 1,200 dollars and the monthly fee is 300." },
    { speaker: "S3", start: 600, end: 615, text: "Sorry to interrupt, quick one about the Lopez file." },
    { speaker: "S3", start: 615, end: 640, text: "The petition for the Lopez estate needs the new heirs listed." },
    { speaker: "S1", start: 640, end: 900, text: "Thanks. Back to the schedule, kickoff is in December." },
  ];

  it("sets aside a visitor: more than 2 speakers, 20 s or more but under 5% of talk, within 5 minutes", async () => {
    const model = new Scripted(["SUMMARY: Onboarding.", "NONE"]);
    const result = await new MeetingSummarizer(new RuntimeNotesBackend(model, undefined, words), { targetTokens: 4000, maxTokens: 6000 })
      .summarize({ transcript: visitorTranscript, speakers, meetingID, now: new Date() });
    expect(result.notes.setAside).toEqual([{ start: 600, end: 640, reason: "other_matter", speakers: ["S3"] }]);
  });

  it("keeps a spoken due word only when the cited lines say it, and makes snake_case titles readable", async () => {
    const reply = [
      "ACTION: task | L2 | map_payment_timelines | Map the payment timelines | this week | S2 | none",
      "ACTION: task | L4 | Send revised schedule | Send it and copy Priya | tonight | S2 | none",
      "SUMMARY: x",
    ].join("\n");
    const model = new Scripted([reply, "NONE"]);
    const result = await new MeetingSummarizer(new RuntimeNotesBackend(model, undefined, words), { targetTokens: 4000, maxTokens: 6000 })
      .summarize({ transcript, speakers, meetingID, now: new Date(2026, 10, 11, 16), meetingStart: new Date(2026, 10, 11, 15, 4) });
    const tasks = result.intents.map((intent) => (intent.params.type === "task.create" ? intent.params.task : undefined));
    expect(tasks[0]).toMatchObject({ title: "Map payment timelines" });
    expect(tasks[0]!.dueText).toBeUndefined();
    expect(tasks[0]!.dueDate).toBeUndefined();
    expect(tasks[1]).toMatchObject({ dueText: "tonight", dueDate: "2026-11-11" });
  });

  it("treats screen access trouble as meeting setup", async () => {
    const model = new Scripted(["POINT: decision | L2 | S2 | They gave access to the screen so it shows.\nSUMMARY: x", "NONE"]);
    const result = await new MeetingSummarizer(new RuntimeNotesBackend(model, undefined, words), { targetTokens: 4000, maxTokens: 6000 })
      .summarize({ transcript, speakers, meetingID, now: new Date() });
    expect(result.notes.keyPoints).toEqual([]);
  });
});

describe("rules from the desktop rerun, round two (synthetic)", () => {
  it("names the owner from a first-person promise in the cited line when the model wrote none", async () => {
    const model = new Scripted(["ACTION: task | L4 | Send revised schedule | Send it and copy Priya | tonight | none | none\nSUMMARY: x", "NONE"]);
    const result = await new MeetingSummarizer(new RuntimeNotesBackend(model, undefined, words), { targetTokens: 4000, maxTokens: 6000 })
      .summarize({ transcript, speakers, meetingID, now: new Date() });
    const params = result.intents[0]!.params;
    expect(params.type === "task.create" && params.task.assigneeHint).toBe("Omar Haddad");
  });

  it("joins set-aside parts of any reason less than 30 seconds apart", () => {
    const parts = finalSetAside([
      { start: 100, end: 130, reason: "phone_call" },
      { start: 150, end: 240, reason: "side_conversation" },
      { start: 300, end: 330, reason: "phone_call" },
    ], []);
    expect(parts).toEqual([{ start: 100, end: 240, reason: "side_conversation" }, { start: 300, end: 330, reason: "phone_call" }]);
  });

  it("keeps more key points for a longer meeting: three per part, at least twelve", async () => {
    const { reduceKeyPoints, DEFAULT_SUMMARY_LIMITS } = await import("../../src/summarizer/summaryReducer.js");
    const drafts = Array.from({ length: 30 }, (_, index) => ({ kind: "summary" as const, text: `Point number ${index} about topic ${index * 7}`, sources: [{ start: index * 60, end: index * 60 + 10 }], precision: "exact" as const }));
    expect(reduceKeyPoints(drafts, [], DEFAULT_SUMMARY_LIMITS).keyPoints).toHaveLength(12);
    expect(reduceKeyPoints(drafts, [], DEFAULT_SUMMARY_LIMITS, 9).keyPoints).toHaveLength(27);
  });
});

describe("set-aside guard (lana-app-93 decision, synthetic)", () => {
  // S1 and S2 talk most; S3 is lightly heard (under 5% of talk) inside 600 to 640.
  const guardTranscript: TranscriptSegment[] = [
    { speaker: "S1", start: 0, end: 300, text: "We go over the onboarding schedule for the Harbor account." },
    { speaker: "S2", start: 300, end: 600, text: "The setup fee is 1,200 dollars and the monthly fee is 300." },
    { speaker: "S3", start: 600, end: 615, text: "Sorry to interrupt, a quick one about another file." },
    { speaker: "S1", start: 615, end: 640, text: "Okay, thanks." },
    { speaker: "S1", start: 640, end: 900, text: "Back to the schedule, kickoff is in December." },
    { speaker: "S2", start: 900, end: 1200, text: "The silver plan is three payments over about six weeks." },
  ];
  async function summarize(notesReply: string, checkReply: string) {
    const model = new Scripted([notesReply, checkReply]);
    const result = await new MeetingSummarizer(new RuntimeNotesBackend(model, undefined, words), { targetTokens: 4000, maxTokens: 6000 })
      .summarize({ transcript: guardTranscript, speakers, meetingID, now: new Date() });
    return result.notes.setAside ?? [];
  }

  it("drops a checked part that no ASIDE line backs and no lightly heard speaker talks in", async () => {
    expect(await summarize("SUMMARY: Onboarding.", "ASIDE: phone_call | L5-L6")).toEqual([]);
  });

  it("keeps a checked part that overlaps an ASIDE line from the notes", async () => {
    expect(await summarize("ASIDE: phone_call | L6\nSUMMARY: Onboarding.", "ASIDE: phone_call | L5-L6")).toEqual([{ start: 640, end: 1200, reason: "phone_call", speakers: ["S1", "S2"] }]);
  });

  it("keeps a checked part a lightly heard speaker talks in", async () => {
    const parts = await summarize("SUMMARY: Onboarding.", "ASIDE: other_matter | L3-L4");
    expect(parts).toEqual([{ start: 600, end: 640, reason: "other_matter", speakers: ["S1", "S3"] }]);
  });

  it("moves a time word written as the owner to the due words, and the owner falls back", async () => {
    const model = new Scripted(["ACTION: task | L4 | Send revised schedule | Send it and copy Priya | none | tonight | none\nSUMMARY: x", "NONE"]);
    const result = await new MeetingSummarizer(new RuntimeNotesBackend(model, undefined, words), { targetTokens: 4000, maxTokens: 6000 })
      .summarize({ transcript, speakers, meetingID, now: new Date(2026, 10, 11, 16), meetingStart: new Date(2026, 10, 11, 15, 4) });
    const params = result.intents[0]!.params;
    if (params.type !== "task.create") throw new Error("task expected");
    expect(params.task).toMatchObject({ assigneeHint: "Omar Haddad", dueText: "tonight", dueDate: "2026-11-11" });
  });
});

describe("set-aside guard boundaries (synthetic)", () => {
  const lines: TranscriptSegment[] = [
    { speaker: "S1", start: 0, end: 500, text: "Main speaker." },
    { speaker: "S2", start: 500, end: 990, text: "Second speaker." },
    { speaker: "S3", start: 990, end: 1000, text: "Light speaker." },
    { speaker: "S4", start: 1000, end: 1008, text: "   " },
  ];
  it("needs a real overlap, a light line at least half inside, and ignores blank lines", async () => {
    const { guardCheckedParts } = await import("../../src/summarizer/meetingSummarizer.js");
    const notes = [{ start: 100, end: 200, reason: "phone_call" as const }];
    expect(guardCheckedParts([{ start: 200, end: 300, reason: "phone_call" }], notes, lines)).toEqual([]);
    expect(guardCheckedParts([{ start: 199, end: 300, reason: "phone_call" }], notes, lines)).toHaveLength(1);
    expect(guardCheckedParts([{ start: 996, end: 1100, reason: "other_matter" }], [], lines)).toEqual([]);
    expect(guardCheckedParts([{ start: 995, end: 1100, reason: "other_matter" }], [], lines)).toHaveLength(1);
    expect(guardCheckedParts([{ start: 1000, end: 1100, reason: "other_matter" }], [], lines)).toEqual([]);
  });
});

describe("time word as owner, more cases (synthetic)", () => {
  /** A backend whose candidate carries a blank due text and "tonight" as the owner. */
  async function finishBlank() {
    const backend = {
      modelID: "fake", tokenCounter: words, availability: async () => AVAILABLE,
      extract: async (request: { chunk: typeof chunk }) => ({
        points: [], runningSummary: "",
        candidates: [{ type: "task.create" as const, title: "Send revised schedule", body: "Send it", dueText: "  ", assigneeHint: " tonight ", recipients: [], confidence: 0.7,
          evidence: [{ speaker: "S2", tStart: 24, tEnd: 33, quote: request.chunk.segments[3]!.text }] }],
      }),
    };
    const result = await new MeetingSummarizer(backend as never, { targetTokens: 4000, maxTokens: 6000 })
      .summarize({ transcript, speakers, meetingID, now: new Date(2026, 10, 11, 16), meetingStart: new Date(2026, 10, 11, 15, 4) });
    const params = result.intents[0]!.params;
    return params.type === "task.create" ? params.task : undefined;
  }
  async function task(action: string) {
    const model = new Scripted([`${action}\nSUMMARY: x`, "NONE"]);
    const result = await new MeetingSummarizer(new RuntimeNotesBackend(model, undefined, words), { targetTokens: 4000, maxTokens: 6000 })
      .summarize({ transcript, speakers, meetingID, now: new Date(2026, 10, 11, 16), meetingStart: new Date(2026, 10, 11, 15, 4) });
    return result.intents[0]!.params;
  }
  it("keeps due words already written, leaves unresolved words and names as the owner", async () => {
    const kept = await task("ACTION: task | L4 | Send revised schedule | Send it | tonight | tomorrow | none");
    expect(kept.type === "task.create" && kept.task).toMatchObject({ dueText: "tonight", assigneeHint: "Omar Haddad" });
    const vague = await task("ACTION: task | L4 | Send revised schedule | Send it | none | next month | none");
    expect(vague.type === "task.create" && vague.task.assigneeHint).toBe("next month");
    const blank = await finishBlank();
    expect(blank).toMatchObject({ dueText: "tonight" });
    const named = await task("ACTION: task | L4 | Send revised schedule | Send it | none | Priya | none");
    expect(named.type === "task.create" && named.task.assigneeHint).toBe("Priya");
  });
});

describe("rules from the 9B bench rerun (synthetic)", () => {
  it("reads an ASIDE line with a description after its lines", () => {
    const parsed = parseNotes("ASIDE: phone_call | L5, L6, L7 | Someone takes a call about a dentist visit.", chunk);
    expect(parsed.asides).toEqual([{ reason: "phone_call", lines: [5, 6, 7] }]);
  });

  it("reads a four-field action with the kind left out (title, lines, short title, detail); a kind with too few fields stays dropped", () => {
    expect(parseNotes("ACTION: send revised schedule | L4 | Schedule | Omar will send the revised schedule tonight", chunk).candidates[0])
      .toMatchObject({ type: "task.create", title: "send revised schedule", body: "Omar will send the revised schedule tonight" });
    expect(parseNotes("ACTION: task | L4 | Send revised schedule | Omar sends it and copies Priya", chunk).candidates).toEqual([]);
  });

  it("keeps key points from every part when there are more than the cap, taking them in turn from each part", async () => {
    const { reduceKeyPoints, DEFAULT_SUMMARY_LIMITS } = await import("../../src/summarizer/summaryReducer.js");
    // Part 0 has 20 points, part 1 has 2; the cap for 2 parts is 12.
    const drafts = [
      ...Array.from({ length: 20 }, (_, index) => ({ kind: "summary" as const, text: `Early point ${index} topic ${index * 13}`, sources: [{ start: index, end: index + 1 }], precision: "exact" as const, chunk: 0 })),
      { kind: "summary" as const, text: "The guardianship fee is 3,500 dollars.", sources: [{ start: 100, end: 101 }], precision: "exact" as const, chunk: 1 },
      { kind: "summary" as const, text: "The probate deposit is 750 dollars.", sources: [{ start: 102, end: 103 }], precision: "exact" as const, chunk: 1 },
    ];
    const kept = reduceKeyPoints(drafts, [], DEFAULT_SUMMARY_LIMITS, 2).keyPoints.map((point) => point.text);
    expect(kept).toHaveLength(12);
    expect(kept).toContain("The guardianship fee is 3,500 dollars.");
    expect(kept).toContain("The probate deposit is 750 dollars.");
  });
});

describe("set-aside guard clarifications (synthetic)", () => {
  it("lets a lightly heard speaker back a check in a 2-person meeting, and no one is light when there is no talk", async () => {
    const { guardCheckedParts } = await import("../../src/summarizer/meetingSummarizer.js");
    const two: TranscriptSegment[] = [
      { speaker: "S1", start: 0, end: 990, text: "Main speaker." },
      { speaker: "S2", start: 990, end: 1000, text: "Brief." },
    ];
    expect(guardCheckedParts([{ start: 980, end: 1100, reason: "side_conversation" }], [], two)).toHaveLength(1);
    const silent: TranscriptSegment[] = [{ speaker: "S1", start: 5, end: 5, text: "Zero length." }];
    expect(guardCheckedParts([{ start: 0, end: 10, reason: "phone_call" }], [], silent)).toEqual([]);
  });
});

describe("set-aside guard: overlap only (synthetic)", () => {
  it("keeps a checked part that overlaps or sits inside a notes ASIDE range; a near miss or a zero-length part is dropped", async () => {
    const { guardCheckedParts } = await import("../../src/summarizer/meetingSummarizer.js");
    const lines: TranscriptSegment[] = [{ speaker: "S1", start: 0, end: 500, text: "Main." }, { speaker: "S2", start: 500, end: 1000, text: "Other." }];
    const notes = [{ start: 100, end: 200, reason: "phone_call" as const }];
    expect(guardCheckedParts([{ start: 120, end: 150, reason: "phone_call" }], notes, lines)).toHaveLength(1);
    expect(guardCheckedParts([{ start: 50, end: 300, reason: "phone_call" }], notes, lines)).toHaveLength(1);
    expect(guardCheckedParts([{ start: 199.5, end: 260, reason: "phone_call" }], notes, lines)).toHaveLength(1);
    expect(guardCheckedParts([{ start: 205, end: 260, reason: "phone_call" }], notes, lines)).toEqual([]);
    expect(guardCheckedParts([{ start: 150, end: 150, reason: "phone_call" }], notes, lines)).toEqual([]);
  });
});

describe("key point cap with answered questions (synthetic)", () => {
  it("keeps the turn-taking when a point has no part number, and an answered question keeps its part", async () => {
    const { reduceKeyPoints, DEFAULT_SUMMARY_LIMITS } = await import("../../src/summarizer/summaryReducer.js");
    const { applyQuestionCheck } = await import("../../src/summarizer/questionCheck.js");
    const drafts = [
      ...Array.from({ length: 20 }, (_, index) => ({ kind: "summary" as const, text: `Early point ${index} topic ${index * 13}`, sources: [{ start: index, end: index + 1 }], precision: "exact" as const, chunk: 0 })),
      { kind: "summary" as const, text: "Answered without a part number.", sources: [{ start: 50, end: 51 }], precision: "exact" as const },
      { kind: "summary" as const, text: "The guardianship fee is 3,500 dollars.", sources: [{ start: 100, end: 101 }], precision: "exact" as const, chunk: 1 },
    ];
    expect(reduceKeyPoints(drafts, [], DEFAULT_SUMMARY_LIMITS, 2).keyPoints.map((point) => point.text)).toContain("The guardianship fee is 3,500 dollars.");
    const question = { kind: "open_question" as const, text: "Who approves the contract?", sources: [{ start: 92, end: 100 }], precision: "exact" as const, chunk: 3 };
    const plan = { drafts: [[0]], request: { questions: [question.text], speakers: [], lines: { index: 0, estimatedTokens: 0, segments: [{ speaker: "S1", start: 100, end: 108, text: "Our controller approves every contract." }] } } };
    const answered = applyQuestionCheck([{ question: 0, answer: "The controller approves every contract.", lines: [1] }], plan, [question]);
    expect(answered[0]).toMatchObject({ kind: "summary", chunk: 3 });
  });
});

describe("key point cap prefers figures within a part (synthetic)", () => {
  it("takes a part's points that hold numbers first", async () => {
    const { reduceKeyPoints, DEFAULT_SUMMARY_LIMITS } = await import("../../src/summarizer/summaryReducer.js");
    const point = (text: string, start: number, chunk: number) => ({ kind: "summary" as const, text, sources: [{ start, end: start + 1 }], precision: "exact" as const, chunk });
    const drafts = [
      ...["alpha", "bravo", "charlie", "delta", "echo", "foxtrot", "golf", "hotel", "india", "juliet", "kilo", "lima", "mike", "november", "oscar", "papa"]
        .map((word, index) => point(`Early talk about the ${word} project and its ${word} owners.`, index, 0)),
      point("Payment structure for estates was described in detail.", 100, 1),
      point("Payment structure for guardianships was described next.", 101, 1),
      point("Payment structure for trusts was described after that.", 101.5, 1),
      point("The guardianship fee is 3,500 dollars.", 102, 1),
    ];
    // Cap 12 over 2 parts with 16 and 4 points: part 1 gets at most its turns, and the figure is among them.
    const kept = reduceKeyPoints(drafts, [], { ...DEFAULT_SUMMARY_LIMITS, maxSummaryBullets: 4 }, 1).keyPoints.map((item) => item.text);
    expect(kept).toHaveLength(4);
    expect(kept).toContain("The guardianship fee is 3,500 dollars.");
  });
});

describe("parts set aside by hand (synthetic)", () => {
  it("carry by: person on the wire (omitted for LANA's), and keep it through joins", async () => {
    const { encodeSetAside, decodeSetAside } = await import("../../src/intent/meetingParts.js");
    const { canonicalString } = await import("../../src/json/canonical.js");
    expect(canonicalString(encodeSetAside({ start: 1, end: 30, reason: "other_matter", by: "person" }))).toBe('{"by":"person","end":30,"reason":"other_matter","start":1}');
    expect(canonicalString(encodeSetAside({ start: 1, end: 30, reason: "other_matter" }))).toBe('{"end":30,"reason":"other_matter","start":1}');
    expect(decodeSetAside({ start: 1, end: 30, reason: "other_matter", by: "person" }, "p")).toMatchObject({ by: "person" });
    expect(() => decodeSetAside({ start: 1, end: 30, reason: "other_matter", by: "robot" }, "p")).toThrow();
    const { addingSetAside, normalizeSetAside } = await import("../../src/summarizer/meetingSummarizer.js");
    expect(addingSetAside([{ start: 0, end: 40, reason: "phone_call" }], { start: 30, end: 60, reason: "other_matter", by: "person" }, [])).toEqual([{ start: 0, end: 60, reason: "phone_call", by: "person" }]);
    expect(normalizeSetAside([{ start: 0, end: 40, reason: "phone_call", by: "person" }, { start: 10, end: 20, reason: "logistics" }])).toEqual([{ start: 0, end: 40, reason: "phone_call", by: "person" }]);
  });
});

describe("Amendment 7 in the notes", () => {
  it("drops a line that copies a format placeholder loosely", () => {
    const parsed = parseNotes([
      "POINT: summary | L3 | One short sentence about whether the setup fee covers training.",
      "POINT: question | L10 | One short sentence about a question still open: who approves.",
      "POINT: summary | L3 | The setup fee is 1,200 dollars and the monthly fee is 300.",
    ].join("\n"), chunk);
    expect(parsed.points.map((point) => point.text)).toEqual(["The setup fee is 1,200 dollars and the monthly fee is 300."]);
  });

  it("reads a POINT whose kind is a set-aside reason as an ASIDE line, never a key point", () => {
    const parsed = parseNotes([
      "POINT: phone call | L5, L7 | Dana takes a call about a dentist appointment.",
      "POINT: side_conversation | L6 | A side chat.",
      "POINT: other matter | L6 | Another client.",
      "POINT: logistics | L2 | Screen sharing.",
      "POINT: background | L1 | The meeting opens.",
    ].join("\n"), chunk);
    expect(parsed.asides).toEqual([
      { reason: "phone_call", lines: [5, 7] },
      { reason: "side_conversation", lines: [6] },
      { reason: "other_matter", lines: [6] },
      { reason: "logistics", lines: [2] },
    ]);
    expect(parsed.points.map((point) => [point.kind, point.text])).toEqual([["summary", "The meeting opens."]]);
  });
});

