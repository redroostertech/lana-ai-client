import { BackendError, isAbortError, type BackendAvailability, throwIfAborted } from "../ask/backend.js";
import type { LanaId } from "../ids/lanaId.js";
import { makeLanaId } from "../ids/lanaId.js";
import { assembleIntent } from "../intent/intentAssembler.js";
import type { Intent } from "../intent/intent.js";
import type { MeetingNotes, NotesGap, Speaker, TranscriptSegment } from "../intent/meetingParts.js";
import { groundQuotes } from "./evidenceGrounder.js";
import type { ChunkExtraction, ChunkPhrasing, ChunkRequest, ExtractedPoint } from "./notesFormat.js";
import { DEFAULT_SUMMARY_LIMITS, reduceIntents, reduceKeyPoints, spansFor, type DraftPoint, type SummaryLimits } from "./summaryReducer.js";
import { chunkEnd, chunkStart, DEFAULT_CHUNK_BUDGET, segmentAtLine, TranscriptChunker, type ChunkBudget, type TokenCounter, type TranscriptChunk, HEURISTIC_TOKENS } from "./transcriptChunk.js";

/** One model that turns a chunk into an extraction (Swift `LanguageModelBackend`). */
export interface NotesBackend {
  readonly modelID: string;
  readonly tokenCounter: TokenCounter;
  availability(): Promise<BackendAvailability>;
  extract(request: ChunkRequest, signal?: AbortSignal): Promise<ChunkExtraction>;
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
}

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
    let dropped = 0;
    let retried = 0;
    let runningSummary = "";
    for (const chunk of chunks) {
      throwIfAborted(options.signal);
      const outcome = await this.extract(chunk, runningSummary, options.speakers, options.signal);
      if (outcome.retried) retried += 1;
      if (outcome.extraction === undefined) {
        if (outcome.failure !== undefined) skipped.push({ index: chunk.index, startTime: chunkStart(chunk), endTime: chunkEnd(chunk), reason: outcome.failure });
        options.progress?.((chunk.index + 1) / chunks.length);
        continue;
      }
      points.push(...outcome.extraction.points.map((point) => attributePoint(point, chunk)));
      for (const candidate of outcome.extraction.candidates) {
        const grounding = groundQuotes(candidate.evidence, chunk.segments, options.speakers);
        const result = assembleIntent(candidate, grounding, options.meetingID, options.now, options.intentID?.() ?? makeLanaId("intent", options.now));
        if (result.ok) intents.push(result.intent);
        else dropped += 1;
      }
      runningSummary = this.cap(outcome.extraction.runningSummary);
      options.progress?.((chunk.index + 1) / chunks.length);
    }
    const merged = reduceIntents(intents, this.limits);
    const gaps: NotesGap[] = skipped.map((chunk) => ({
      start: chunk.startTime,
      end: chunk.endTime,
      reason: chunk.reason.kind === "refused" || chunk.reason.kind === "guardrailViolation" ? "refused" : "model_error",
    }));
    return {
      notes: reduceKeyPoints(points, gaps, this.limits),
      intents: merged.intents,
      droppedIntentCount: dropped + merged.capped,
      skippedChunks: skipped,
      retriedChunkCount: retried,
      chunkCount: chunks.length,
      modelID: this.backend.modelID,
    };
  }

  private async extract(chunk: TranscriptChunk, runningSummary: string, speakers: readonly Speaker[], signal?: AbortSignal): Promise<{ extraction?: ChunkExtraction; failure?: BackendError; retried: boolean }> {
    let retried = false;
    let failure: BackendError | undefined;
    for (const phrasing of ["standard", "neutralReformulation"] as ChunkPhrasing[]) {
      throwIfAborted(signal);
      try {
        return { extraction: await this.backend.extract({ chunk, runningSummary, speakers, phrasing }, signal), retried };
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
  const cited = [...new Set(point.lines)].sort((a, b) => a - b).flatMap((line) => {
    const segment = segmentAtLine(chunk, line);
    return segment === undefined ? [] : [segment];
  });
  if (cited.length === 0) return { kind: point.kind, text: point.text, sources: [{ start: chunkStart(chunk), end: chunkEnd(chunk) }], precision: "approximate" };
  const invented = point.lines.some((line) => segmentAtLine(chunk, line) === undefined);
  return { kind: point.kind, text: point.text, sources: spansFor(cited), precision: invented ? "approximate" : "exact" };
}
