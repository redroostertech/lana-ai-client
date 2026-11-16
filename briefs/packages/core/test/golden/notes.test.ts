import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { AVAILABLE, BackendError } from "../../src/ask/backend.js";
import type { LanaId } from "../../src/ids/lanaId.js";
import { encodeIntent, encodeNotes, encodeSetAside, type Speaker, type TranscriptSegment } from "../../src/intent/index.js";
import { canonicalString } from "../../src/json/canonical.js";
import { LanaDate } from "../../src/json/lanaDate.js";
import { parseJson } from "../../src/json/parse.js";
import { utf8 } from "../../src/bytes/index.js";
import type { TextModel, TextModelRequest } from "../../src/runtime/index.js";
import { workflowDefinition } from "../../src/runtime/index.js";
import {
  chunkPromptText, MeetingSummarizer, NOTES_MAX_RESPONSE_TOKENS, NOTES_SCHEMA, normalizeText, notesInstructions, notesPrompt, parseNotes, RuntimeNotesBackend,
  isLogistics, promiseAction, resolveDueText, textSimilarity, TranscriptChunker, validateNotes, type TokenCounter,
} from "../../src/summarizer/index.js";
import { golden } from "./fixtures.js";

interface Segment { speaker: string; start: number; end: number; text: string }
interface NotesGolden {
  schema: string;
  maximum_response_tokens: number;
  meeting_id: string;
  now: string;
  speakers: Array<{ id: string; name: string | null }>;
  transcript: Segment[];
  long_segment: Segment[];
  normalize: Array<{ text: string; normalized: string }>;
  similarity: Array<{ a: string; b: string; similarity: number }>;
  instructions: { standard: string; neutral: string };
  chunk_cases: Array<{ name: string; target: number; max: number; chunks: Array<{ index: number; estimated_tokens: number; segments: Segment[]; prompt_text: string }> }>;
  prompts: Array<{ phrasing: "standard" | "neutral"; summary: string; prompt: string }>;
  replies: Array<{ reply: string; valid: boolean; reason?: string; points: Array<{ kind: string; text: string; lines: number[] }>; candidates: unknown[]; summary: string; set_aside?: string; tables?: unknown[] }>;
  due_words?: Array<{ words: string; meeting_start: string; date: string | null }>;
  due_calendar_time_zone?: string;
  promises?: Array<{ text: string; lines: number[]; decided_by: string | null; logistics: boolean; action: unknown }>;
  vocabulary_prompt?: string;
  meetings: Array<{
    name: string; target: number; max: number;
    steps: Array<{ reply?: string; error?: string; code?: string }>;
    calls: Array<{ instructions: string; prompt: string }>;
    notes: string; intents: string[]; dropped: number; retried: number; chunk_count: number;
    skipped: Array<{ index: number; start: number; end: number }>;
  }>;
}

const fixture = golden<NotesGolden>("notes");
const now = LanaDate.parse(fixture.now)!;
const meetingID = fixture.meeting_id as LanaId;
const speakers: Speaker[] = fixture.speakers.map((speaker) => (speaker.name === null ? { id: speaker.id } : { id: speaker.id, name: speaker.name }));
const transcript: TranscriptSegment[] = fixture.transcript;

/** Swift `WordCounter` in the test target: whitespace-separated words. */
const words: TokenCounter = { tokenCount: (text) => text.split(/[\s\u0085​]+/u).filter((word) => word !== "").length };

/** Swift `ScriptedTextModel`: replays replies and errors in order and records every call. */
class ScriptedModel implements TextModel {
  readonly modelID = "scripted";
  readonly calls: Array<{ instructions: string; prompt: string }> = [];
  constructor(private readonly steps: NotesGolden["meetings"][number]["steps"]) {}
  async availability() {
    return AVAILABLE;
  }
  async respond(request: TextModelRequest): Promise<string> {
    this.calls.push({ instructions: request.instructions, prompt: request.prompt });
    const step = this.steps[this.calls.length - 1];
    if (step === undefined) throw BackendError.failed("script_exhausted");
    if (step.reply !== undefined) return step.reply;
    throw step.error === "refused" ? BackendError.refused() : BackendError.failed(step.code ?? "other");
  }
}

/** A canonical intent without its id (Swift makes random ones). */
function withoutID(json: string): string {
  const value = parseJson(utf8(json)) as Record<string, unknown>;
  return canonicalString({ ...value, id: "" } as never);
}

describe("note writer golden vectors (Swift NotesGoldenVectorExportTests)", () => {
  it("runs the same notes.chunk.v1 workflow as the Swift bundle", () => {
    const swift = JSON.parse(readFileSync(fileURLToPath(new URL("../../../../fixtures/workflows/notes.chunk.v1.json", import.meta.url)), "utf8")) as unknown;
    expect(workflowDefinition("notes.chunk.v1")).toEqual(swift);
    const questions = JSON.parse(readFileSync(fileURLToPath(new URL("../../../../fixtures/workflows/notes.questions.v1.json", import.meta.url)), "utf8")) as unknown;
    expect(workflowDefinition("notes.questions.v1")).toEqual(questions);
    expect(NOTES_SCHEMA).toBe(fixture.schema);
    expect(NOTES_MAX_RESPONSE_TOKENS).toBe(fixture.maximum_response_tokens);
  });

  it("folds text and measures similarity like TextNormalizer", () => {
    for (const item of fixture.normalize) expect(normalizeText(item.text), item.text).toBe(item.normalized);
    for (const item of fixture.similarity) expect(textSimilarity(item.a, item.b)).toBeCloseTo(item.similarity, 12);
  });

  it("chunks transcripts like TranscriptChunker", () => {
    const sources: Record<string, Segment[]> = { default: transcript, small: transcript, long_segment: [transcript[0]!, fixture.long_segment[0]!, transcript[1]!] };
    for (const item of fixture.chunk_cases) {
      const chunks = new TranscriptChunker({ targetTokens: item.target, maxTokens: item.max }, words).chunk(sources[item.name]!);
      expect(chunks.map((chunk) => chunk.estimatedTokens), item.name).toEqual(item.chunks.map((chunk) => chunk.estimated_tokens));
      chunks.forEach((chunk, index) => {
        const expected = item.chunks[index]!;
        expect(chunk.segments.map((segment) => segment.text), `${item.name} ${index}`).toEqual(expected.segments.map((segment) => segment.text));
        expect(chunk.segments.map((segment) => [segment.start, segment.end])).toEqual(expected.segments.map((segment) => [segment.start, segment.end]).map(([a, b]) => [expect.closeTo(a!, 9), expect.closeTo(b!, 9)]));
        expect(chunkPromptText(chunk)).toBe(expected.prompt_text);
      });
    }
  });

  it("writes the same instructions and prompts, and validates and parses replies alike", () => {
    expect(notesInstructions("standard")).toBe(fixture.instructions.standard);
    expect(notesInstructions("neutralReformulation")).toBe(fixture.instructions.neutral);
    const small = new TranscriptChunker({ targetTokens: 30, maxTokens: 45 }, words).chunk(transcript);
    expect(notesPrompt({ chunk: small[0]!, runningSummary: "", speakers, phrasing: "standard" })).toBe(fixture.prompts[0]!.prompt);
    expect(notesPrompt({ chunk: small[1]!, runningSummary: "Earlier things.", speakers: [{ id: "S1" }], phrasing: "neutralReformulation" })).toBe(fixture.prompts[1]!.prompt);
    const whole = { index: 0, segments: transcript, estimatedTokens: 0 };
    for (const item of fixture.replies) {
      const validation = validateNotes(item.reply);
      expect(validation.valid, item.reply).toBe(item.valid);
      if (!validation.valid) expect(validation.reason).toBe(item.reason);
      const parsed = parseNotes(item.reply, whole);
      expect(parsed.points.map((point) => ({ kind: point.kind, text: point.text, lines: [...point.lines], decided_by: point.decidedBy ?? null }))).toEqual(item.points);
      expect(parsed.runningSummary).toBe(item.summary);
      if (item.set_aside !== undefined) {
        // One part per ASIDE line, first to last cited line, in reply order, without speakers.
        const parts = (parsed.asides ?? []).map((aside) => {
          const cited = aside.lines.map((line) => whole.segments[line - 1]!);
          return { start: Math.min(...cited.map((segment) => segment.start)), end: Math.max(...cited.map((segment) => segment.end)), reason: aside.reason };
        });
        expect(canonicalString(parts.map((part) => encodeSetAside(part))), item.reply).toBe(item.set_aside);
      }
      if (item.tables !== undefined) expect(parsed.tables ?? [], item.reply).toEqual(item.tables);
      expect(parsed.candidates.map((candidate) => ({
        type: candidate.type, title: candidate.title, body: candidate.body, due_date: candidate.dueDate ?? null, due_text: candidate.dueText ?? null, assignee_hint: candidate.assigneeHint ?? null,
        regarding_name: candidate.regardingName ?? null, confidence: candidate.confidence,
        evidence: candidate.evidence.map((quote) => ({ speaker: quote.speaker, t_start: quote.tStart, t_end: quote.tEnd, quote: quote.quote })),
      }))).toEqual(item.candidates);
    }
  });

  it("resolves spoken due words like DueDateResolver (in the export's time zone)", () => {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (fixture.due_words === undefined || zone !== fixture.due_calendar_time_zone) return;
    for (const item of fixture.due_words) expect(resolveDueText(item.words, LanaDate.parse(item.meeting_start)!) ?? null, item.words).toBe(item.date);
  });

  it("checks decisions for promises and meeting setup like PromiseCheck", () => {
    const whole = { index: 0, segments: transcript, estimatedTokens: 0 };
    for (const item of fixture.promises ?? []) {
      const point = { kind: "decision" as const, text: item.text, lines: item.lines, ...(item.decided_by === null ? {} : { decidedBy: item.decided_by }) };
      expect(isLogistics(point), item.text).toBe(item.logistics);
      const action = promiseAction(point, whole);
      expect(action === undefined ? null : {
        type: action.type, title: action.title, body: action.body, due_date: action.dueDate ?? null, due_text: action.dueText ?? null, assignee_hint: action.assigneeHint ?? null,
        regarding_name: action.regardingName ?? null, confidence: action.confidence,
        evidence: action.evidence.map((quote) => ({ speaker: quote.speaker, t_start: quote.tStart, t_end: quote.tEnd, quote: quote.quote })),
      }, item.text).toEqual(item.action);
    }
  });

  it("names the firm's terms in the prompt like NotesFormat", () => {
    if (fixture.vocabulary_prompt === undefined) return;
    const whole = { index: 0, segments: transcript, estimatedTokens: 0 };
    expect(notesPrompt({ chunk: whole, runningSummary: "", speakers, phrasing: "standard", vocabulary: ["Acme Logistics", "Pemberton", "Warehousely"] })).toBe(fixture.vocabulary_prompt);
  });

  it("summarizes whole meetings like MeetingSummarizer over RuntimeNotesBackend", async () => {
    for (const meeting of fixture.meetings) {
      const model = new ScriptedModel(meeting.steps);
      const summarizer = new MeetingSummarizer(new RuntimeNotesBackend(model, undefined, words), { targetTokens: meeting.target, maxTokens: meeting.max });
      const result = await summarizer.summarize({ transcript, speakers, meetingID, now });
      expect(model.calls, meeting.name).toEqual(meeting.calls);
      expect(canonicalString(encodeNotes(result.notes)), meeting.name).toBe(meeting.notes);
      expect(result.intents.map((intent) => withoutID(canonicalString(encodeIntent(intent))))).toEqual(meeting.intents.map(withoutID));
      expect(result.intents.every((intent) => intent.id.startsWith("int_") && intent.status === "proposed")).toBe(true);
      expect({ dropped: result.droppedIntentCount, retried: result.retriedChunkCount, chunks: result.chunkCount }).toEqual({ dropped: meeting.dropped, retried: meeting.retried, chunks: meeting.chunk_count });
      expect(result.skippedChunks.map((chunk) => ({ index: chunk.index, start: chunk.startTime, end: chunk.endTime }))).toEqual(meeting.skipped);
    }
  });
});
