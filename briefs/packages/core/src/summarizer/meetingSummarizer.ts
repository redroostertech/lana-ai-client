import { BackendError, isAbortError, type BackendAvailability, throwIfAborted } from "../ask/backend.js";
import type { LanaId } from "../ids/lanaId.js";
import { makeLanaId } from "../ids/lanaId.js";
import { assembleIntent } from "../intent/intentAssembler.js";
import type { Intent } from "../intent/intent.js";
import { overlapsSetAside, segmentSetAside, speakerDisplayName, type MeetingNotes, type NotesGap, type NotesTable, type SetAsidePart, type Speaker, type TranscriptSegment } from "../intent/meetingParts.js";
import type { SourceSpan } from "../intent/keyPoint.js";
import { resolveDueText } from "./dueDates.js";
import { groundQuotes } from "./evidenceGrounder.js";
import { verifiedLines } from "./lineMatcher.js";
import { quoteOf, type ChunkExtraction, type ChunkPhrasing, type ChunkRequest, type ExtractedPoint, type QuotedCandidate } from "./notesFormat.js";
import { applyQuestionCheck, planQuestionCheck, type QuestionCheckRequest, type QuestionResolution } from "./questionCheck.js";
import { normalizeText } from "./textNormalizer.js";
import { DEFAULT_SUMMARY_LIMITS, reduceIntents, reduceKeyPoints, spansFor, unionSpans, type DraftPoint, type SummaryLimits } from "./summaryReducer.js";
import { chunkEnd, chunkStart, DEFAULT_CHUNK_BUDGET, segmentAtLine, TranscriptChunker, type ChunkBudget, type TokenCounter, type TranscriptChunk, HEURISTIC_TOKENS } from "./transcriptChunk.js";

/** One model that turns a chunk into an extraction (Swift `LanguageModelBackend`). */
export interface NotesBackend {
  readonly modelID: string;
  readonly tokenCounter: TokenCounter;
  availability(): Promise<BackendAvailability>;
  extract(request: ChunkRequest, signal?: AbortSignal): Promise<ChunkExtraction>;
  /** Which open questions the given later lines answer (one call). A backend without it leaves every question open. */
  checkOpenQuestions?(request: QuestionCheckRequest, signal?: AbortSignal): Promise<QuestionResolution[]>;
}

/** The person's own choices about set-aside parts, kept across re-runs. */
export interface SetAsideChoices {
  /** Parts the person restored: a detected part overlapping one of these is not set aside again. */
  readonly restored: readonly { readonly start: number; readonly end: number }[];
  /** Ranges the person set aside themselves. */
  readonly added: readonly SetAsidePart[];
}

export interface SkippedChunk {
  readonly index: number;
  readonly startTime: number;
  readonly endTime: number;
  readonly reason: BackendError;
}

/** Swift `SummaryResult`. */
export interface SummaryResult {
  readonly notes: MeetingNotes;
  /** Grounded, validated, de-duplicated intents, all `proposed`. */
  readonly intents: Intent[];
  readonly droppedIntentCount: number;
  readonly skippedChunks: SkippedChunk[];
  readonly retriedChunkCount: number;
  readonly chunkCount: number;
  readonly modelID: string;
}

export class SummarizerUnavailableError extends Error {
  constructor(readonly availability: BackendAvailability) {
    super("summarizer_unavailable");
    this.name = "SummarizerUnavailableError";
  }
}

export interface SummarizeOptions {
  readonly transcript: readonly TranscriptSegment[];
  readonly speakers: readonly Speaker[];
  readonly meetingID: LanaId;
  readonly now: Date;
  /** 0 to 1 as chunks finish. */
  readonly progress?: (fraction: number) => void;
  readonly signal?: AbortSignal;
  /** Tests: the ids new intents get (Swift makes random ones). */
  readonly intentID?: () => LanaId;
  /** When the meeting started: spoken due dates ("tonight") resolve against it. Defaults to `now`. */
  readonly meetingStart?: Date;
  /** The firm's word list: names the notes spell exactly. */
  readonly vocabulary?: readonly string[];
  readonly setAsideChoices?: SetAsideChoices;
}

/** Set-aside rules shared with the phone (contract): shorter detected parts are ignored; closer same-reason parts join. */
const MIN_SET_ASIDE_SECONDS = 20;
const SET_ASIDE_JOIN_GAP = 5;
const MAX_CHECKED_QUESTIONS = 6;
const PROMISE_CONFIDENCE = 0.6;

/** A decision that is meeting setup, not meeting content. */
const LOGISTICS = /\b(screen ?shar\w*|share (my|the|your|his|her) screen|screen is (now )?(visible|showing|shared)|can (you|everyone|everybody) (see|hear)|audio|microphones?|mute|unmute|camera|browser|permissions?|refresh\w*|zoom link|meeting link|teams link|reconnect\w*|join(ed|ing)? the (call|meeting))\b/iu;
/** A decision that is someone's promise to do something: an action. */
const PROMISE = /\b(will|'ll|\u2019ll|is going to|are going to|am going to|agrees? to|agreed to|offer(s|ed)? to|commit(s|ted)? to|promise(s|d)? to|volunteer(s|ed)? to)\s+(\w+\s+){0,2}?(send|draft|email|e-mail|call|share|map|create|prepare|review|follow|write|schedule|update|upload|move|forward|provide|set up|look|check|get|put|build|draw|copy|reach|circle|loop|book|file|confirm|finish|start|run|pull|add|fix|deliver)\b/iu;
/** Words for when inside a promise. */
const SPOKEN_WHEN = /\b(tonight|today|tomorrow( morning| night)?|this (morning|afternoon|evening|week)|(by )?(the )?end of (the )?(day|week)|(by |this |next )?(monday|tuesday|wednesday|thursday|friday|saturday|sunday))\b/iu;

/**
 * On-device notes and intents for one meeting, map-reduce (Swift `MeetingSummarizer`).
 * Map: each chunk in a fresh model call with a short running summary of what came before;
 * every point cites transcript lines, every action's quotes are copied from cited lines and
 * grounded, then checked by the intent validator. Reduce: merged, de-duplicated and capped.
 * A refused chunk is retried once with a neutral phrasing, then skipped and recorded as a gap;
 * it never fails the whole meeting.
 */
export class MeetingSummarizer {
  private readonly chunker: TranscriptChunker;

  constructor(private readonly backend: NotesBackend, budget: ChunkBudget = DEFAULT_CHUNK_BUDGET, private readonly limits: SummaryLimits = DEFAULT_SUMMARY_LIMITS) {
    this.chunker = new TranscriptChunker(budget, backend.tokenCounter ?? HEURISTIC_TOKENS);
  }

  async summarize(options: SummarizeOptions): Promise<SummaryResult> {
    const availability = await this.backend.availability();
    if (!availability.available) throw new SummarizerUnavailableError(availability);
    const chunks = this.chunker.chunk(options.transcript);
    const points: DraftPoint[] = [];
    const intents: Intent[] = [];
    const skipped: SkippedChunk[] = [];
    const asides: SetAsidePart[] = [];
    const tables: DraftTable[] = [];
    let dropped = 0;
    let retried = 0;
    let runningSummary = "";
    const start = options.meetingStart ?? options.now;
    for (const chunk of chunks) {
      throwIfAborted(options.signal);
      const outcome = await this.extract(chunk, runningSummary, options.speakers, options.vocabulary ?? [], options.signal);
      if (outcome.retried) retried += 1;
      if (outcome.extraction === undefined) {
        if (outcome.failure !== undefined) skipped.push({ index: chunk.index, startTime: chunkStart(chunk), endTime: chunkEnd(chunk), reason: outcome.failure });
        options.progress?.((chunk.index + 1) / chunks.length);
        continue;
      }
      const extraction = outcome.extraction;
      const candidates: QuotedCandidate[] = [...extraction.candidates];
      for (const point of extraction.points) {
        if (point.kind !== "summary" && LOGISTICS.test(point.text)) continue;
        const promise = point.kind === "decision" ? promiseAction(point, chunk) : undefined;
        if (promise !== undefined) candidates.push(promise);
        else points.push(attributePoint(point, chunk));
      }
      for (const raw of candidates) {
        const candidate = finishCandidate(raw, options.speakers, start);
        const grounding = groundQuotes(candidate.evidence, chunk.segments, options.speakers);
        const result = assembleIntent(candidate, grounding, options.meetingID, options.now, options.intentID?.() ?? makeLanaId("intent", options.now));
        if (result.ok) intents.push(result.intent);
        else dropped += 1;
      }
      for (const aside of extraction.asides ?? []) {
        const cited = aside.lines.flatMap((line) => {
          const segment = segmentAtLine(chunk, line);
          return segment === undefined ? [] : [segment];
        });
        if (cited.length === 0) continue;
        asides.push({ start: Math.min(...cited.map((segment) => segment.start)), end: Math.max(...cited.map((segment) => segment.end)), reason: aside.reason });
      }
      for (const table of extraction.tables ?? []) {
        const rows = table.rows.map((row) => ({
          cells: [...row.cells],
          sources: spansFor(row.lines.flatMap((line) => {
            const segment = segmentAtLine(chunk, line);
            return segment === undefined ? [] : [segment];
          })),
        }));
        const existing = tables.find((item) => normalizeText(item.title) === normalizeText(table.title) && item.columns.length === table.columns.length);
        if (existing !== undefined) existing.rows.push(...rows);
        else tables.push({ title: table.title, columns: [...table.columns], rows });
      }
      runningSummary = this.cap(outcome.extraction.runningSummary);
      options.progress?.((chunk.index + 1) / chunks.length);
    }
    const setAside = finalSetAside(asides, options.setAsideChoices, options.transcript);
    const outside = (sources: readonly SourceSpan[]): boolean => !sources.some((span) => overlapsSetAside(span.start, span.end, setAside, 0.5));
    const kept = points.filter((point) => outside(point.sources));
    const keptIntents = intents.filter((intent) => !intent.evidence.some((item) => overlapsSetAside(item.tStart, item.tEnd, setAside, 0.5)));
    dropped += intents.length - keptIntents.length;
    const checked = await this.checkOpenQuestions(kept, options.transcript.filter((segment) => !segmentSetAside(segment, setAside)), options.speakers, options.signal);
    const merged = reduceIntents(keptIntents, this.limits);
    const gaps: NotesGap[] = skipped.map((chunk) => ({
      start: chunk.startTime,
      end: chunk.endTime,
      reason: chunk.reason.kind === "refused" || chunk.reason.kind === "guardrailViolation" ? "refused" : "model_error",
    }));
    const notesTables: NotesTable[] = tables.flatMap((table) => {
      const rows = table.rows.filter((row) => outside(row.sources));
      if (rows.length === 0) return [];
      return [{ title: table.title, columns: table.columns, rows: rows.map((row) => row.cells), sources: rows.reduce<SourceSpan[]>((all, row) => unionSpans(all, row.sources), []) }];
    });
    const reduced = reduceKeyPoints(checked, gaps, this.limits);
    return {
      notes: {
        ...reduced,
        ...(setAside.length === 0 ? {} : { setAside }),
        ...(notesTables.length === 0 ? {} : { tables: notesTables }),
      },
      intents: merged.intents,
      droppedIntentCount: dropped + merged.capped,
      skippedChunks: skipped,
      retriedChunkCount: retried,
      chunkCount: chunks.length,
      modelID: this.backend.modelID,
    };
  }

  /**
   * Swift `checkOpenQuestions` (Nov 13): asks once whether later lines answered any question a
   * chunk left open. A refusal or failure keeps every question open; only cancellation propagates.
   */
  private async checkOpenQuestions(points: DraftPoint[], transcript: readonly TranscriptSegment[], speakers: readonly Speaker[], signal?: AbortSignal): Promise<DraftPoint[]> {
    if (this.backend.checkOpenQuestions === undefined) return points;
    const plan = planQuestionCheck(points, transcript, speakers, this.backend.tokenCounter ?? HEURISTIC_TOKENS, MAX_CHECKED_QUESTIONS);
    if (plan === undefined) return points;
    throwIfAborted(signal);
    try {
      return applyQuestionCheck(await this.backend.checkOpenQuestions(plan.request, signal), plan, points);
    } catch (error) {
      if (isAbortError(error) || signal?.aborted === true) throw error;
      return points;
    }
  }

  private async extract(chunk: TranscriptChunk, runningSummary: string, speakers: readonly Speaker[], vocabulary: readonly string[], signal?: AbortSignal): Promise<{ extraction?: ChunkExtraction; failure?: BackendError; retried: boolean }> {
    let retried = false;
    let failure: BackendError | undefined;
    for (const phrasing of ["standard", "neutralReformulation"] as ChunkPhrasing[]) {
      throwIfAborted(signal);
      try {
        const request: ChunkRequest = vocabulary.length === 0 ? { chunk, runningSummary, speakers, phrasing } : { chunk, runningSummary, speakers, phrasing, vocabulary };
        return { extraction: await this.backend.extract(request, signal), retried };
      } catch (error) {
        if (isAbortError(error) || signal?.aborted === true) throw error;
        failure = error instanceof BackendError ? error : BackendError.failed(error instanceof Error ? error.name : "unknown");
        if (phrasing !== "standard" || !failure.isRetryableWithReformulation) return { failure, retried };
        retried = true;
      }
    }
    return { ...(failure === undefined ? {} : { failure }), retried };
  }

  /** Caps the carried summary at `runningSummaryTokens`, cutting at a word. */
  private cap(summary: string): string {
    let text = summary.replace(/^[\s\u0085​]+|[\s\u0085​]+$/gu, "");
    while (text !== "" && this.backend.tokenCounter.tokenCount(text) > this.limits.runningSummaryTokens) {
      const words = text.split(" ").filter((word) => word !== "");
      words.splice(words.length - Math.min(Math.max(1, Math.floor(words.length / 10)), words.length));
      text = words.join(" ");
    }
    return text;
  }
}

/**
 * A point's cited lines as exact spans. With no valid citation the point keeps the whole
 * chunk as an approximate source rather than being pinned to the wrong moment.
 */
export function attributePoint(point: ExtractedPoint, chunk: TranscriptChunk): DraftPoint {
  const lines = verifiedLines(point.text, point.lines, chunk.segments);
  const cited = [...new Set(lines)].sort((a, b) => a - b).flatMap((line) => {
    const segment = segmentAtLine(chunk, line);
    return segment === undefined ? [] : [segment];
  });
  const decided = point.kind === "decision" && point.decidedBy !== undefined ? { decidedBy: point.decidedBy } : {};
  if (cited.length === 0) return { kind: point.kind, text: point.text, sources: [{ start: chunkStart(chunk), end: chunkEnd(chunk) }], precision: "approximate", ...decided };
  const invented = lines.some((line) => segmentAtLine(chunk, line) === undefined);
  return { kind: point.kind, text: point.text, sources: spansFor(cited), precision: invented ? "approximate" : "exact", ...decided };
}

interface DraftTable {
  readonly title: string;
  readonly columns: string[];
  readonly rows: Array<{ cells: string[]; sources: SourceSpan[] }>;
}

/** A decision that reads as someone's promise ("Omar will send..."): the action it really is. */
export function promiseAction(point: ExtractedPoint, chunk: TranscriptChunk): QuotedCandidate | undefined {
  if (!PROMISE.test(point.text)) return undefined;
  const lines = verifiedLines(point.text, point.lines, chunk.segments);
  const cited = lines.flatMap((line) => {
    const segment = segmentAtLine(chunk, line);
    return segment === undefined ? [] : [segment];
  });
  if (cited.length === 0) return undefined;
  const title = point.text.replace(/[.]+$/u, "");
  const spoken = SPOKEN_WHEN.exec(point.text)?.[0];
  return {
    type: "task.create",
    title: title.length > 200 ? title.slice(0, 200) : title,
    body: point.text,
    ...(spoken === undefined ? {} : { dueText: spoken }),
    assigneeHint: point.decidedBy ?? cited[0]!.speaker,
    recipients: [],
    confidence: PROMISE_CONFIDENCE,
    evidence: cited.map((segment) => quoteOf(segment, point.text)),
  };
}

/** The owner as the speaker's name when the model wrote a label, and a spoken date resolved against the meeting start. */
function finishCandidate(candidate: QuotedCandidate, speakers: readonly Speaker[], meetingStart: Date): QuotedCandidate {
  let assigneeHint = candidate.assigneeHint;
  const label = assigneeHint === undefined ? null : /^s(\d+)$/iu.exec(assigneeHint.trim());
  if (label !== null) {
    const speaker = speakers.find((item) => item.id === `S${label[1]}`);
    assigneeHint = speaker === undefined ? `S${label[1]}` : speakerDisplayName(speaker);
  }
  if (candidate.type !== "task.create") return { ...candidate, assigneeHint, dueText: undefined };
  const dueDate = candidate.dueDate ?? (candidate.dueText === undefined ? undefined : resolveDueText(candidate.dueText, meetingStart));
  return { ...candidate, assigneeHint, dueDate };
}

/**
 * The meeting's set-aside parts (contract): detected ranges joined when they overlap or are
 * under 5 seconds apart with the same reason, shorter than 20 seconds dropped, any the person
 * restored dropped, then the person's own ranges added; sorted, non-overlapping, with the
 * speakers heard in each.
 */
export function finalSetAside(detected: readonly SetAsidePart[], choices: SetAsideChoices | undefined, transcript: readonly TranscriptSegment[]): SetAsidePart[] {
  const joined = joinParts(detected, SET_ASIDE_JOIN_GAP, true)
    .filter((part) => part.end - part.start >= MIN_SET_ASIDE_SECONDS)
    .filter((part) => !(choices?.restored ?? []).some((restored) => Math.min(part.end, restored.end) - Math.max(part.start, restored.start) > 1));
  const all = joinParts([...joined, ...(choices?.added ?? []).filter((part) => part.end > part.start)], 0, false);
  return all.map((part) => {
    const speakers = [...new Set(transcript.filter((segment) => segmentSetAside(segment, [part])).map((segment) => segment.speaker))].sort();
    return speakers.length === 0 ? { start: part.start, end: part.end, reason: part.reason } : { start: part.start, end: part.end, reason: part.reason, speakers };
  });
}

/** Sorted parts with overlaps joined (and, when `sameReasonGap` is set, near parts of one reason). The longer part's reason wins. */
function joinParts(parts: readonly SetAsidePart[], gap: number, sameReasonOnly: boolean): SetAsidePart[] {
  const out: SetAsidePart[] = [];
  for (const part of [...parts].sort((a, b) => a.start - b.start || a.end - b.end)) {
    const last = out.at(-1);
    const near = last !== undefined && gap > 0 && part.start - last.end < gap && (!sameReasonOnly || part.reason === last.reason);
    if (last !== undefined && (part.start < last.end || near)) {
      const reason = part.end - part.start > last.end - last.start ? part.reason : last.reason;
      out[out.length - 1] = { start: last.start, end: Math.max(last.end, part.end), reason };
    } else {
      out.push({ start: part.start, end: part.end, reason: part.reason });
    }
  }
  return out;
}
