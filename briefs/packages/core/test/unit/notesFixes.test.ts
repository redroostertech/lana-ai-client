import { describe, expect, it } from "vitest";
import { AVAILABLE } from "../../src/ask/backend.js";
import type { LanaId } from "../../src/ids/lanaId.js";
import { decodeNotes, encodeNotes, type Speaker, type TranscriptSegment } from "../../src/intent/index.js";
import type { TextModel, TextModelRequest } from "../../src/runtime/index.js";
import { MeetingSummarizer, notesInstructions, notesPrompt, parseNotes, RuntimeNotesBackend, type TokenCounter } from "../../src/summarizer/index.js";
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
    const model = new Scripted([reply, checkReply]);
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

  it("ignores a set-aside stretch shorter than 20 seconds, and one the person restored", async () => {
    const short = await run("ASIDE: logistics | L2\nSUMMARY: x");
    expect(short.result.notes.setAside ?? []).toEqual([]);
    const restored = await run("ASIDE: phone_call | L5, L7\nSUMMARY: x", { setAsideChoices: { restored: [{ start: 33, end: 75 }], added: [] } });
    expect(restored.result.notes.setAside ?? []).toEqual([]);
    const added = await run("SUMMARY: x", { setAsideChoices: { restored: [], added: [{ start: 41, end: 60, reason: "other_matter" }] } });
    expect(added.result.notes.setAside).toEqual([{ start: 41, end: 60, reason: "other_matter", speakers: ["S3"] }]);
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
    expect(model.calls).toHaveLength(2);
    expect(model.calls[1]!.prompt).toContain("Q1: Who approves the vendor contract?");
    expect(result.notes.keyPoints).toEqual([
      expect.objectContaining({ kind: "summary", text: "The controller approves every vendor contract.", sources: [{ start: 100, end: 108, speaker: "S1" }] }),
    ]);
  });

  it("passes the firm's word list to every chunk prompt", async () => {
    const { model } = await run("SUMMARY: x", { vocabulary: ["Leadli"] });
    expect(model.calls[0]!.prompt).toContain("Spell these names exactly: Leadli.");
  });
});
