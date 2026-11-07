import type { CandidateIntent, CandidateIntentType } from "../intent/candidateIntent.js";
import type { KeyPointKind } from "../intent/keyPoint.js";
import { speakerDisplayName, type Speaker } from "../intent/meetingParts.js";
import { splitLines } from "../runtime/answerFormat.js";
import { formatLineValue, trimSpaces } from "../runtime/formatLine.js";
import type { ModelOutputValidation } from "../runtime/kernel.js";
import { isLetter, isNumber } from "../ask/tokenizer.js";
import { graphemes } from "../text/graphemes.js";
import { chunkPromptText, segmentAtLine, type TranscriptChunk } from "./transcriptChunk.js";

/** A quote the action stands on, copied from a cited line (never typed by the model). */
export interface CandidateQuote {
  readonly speaker: string;
  readonly tStart: number;
  readonly tEnd: number;
  readonly quote: string;
}

/** A proposed action with its quotes, before grounding (Swift `CandidateIntent` with evidence). */
export interface QuotedCandidate extends CandidateIntent {
  readonly evidence: readonly CandidateQuote[];
}

/** A key point as the model wrote it, citing chunk lines (1-based). Unverified. */
export interface ExtractedPoint {
  readonly kind: KeyPointKind;
  readonly text: string;
  readonly lines: readonly number[];
}

/** Raw model output for one chunk (Swift `ChunkExtraction`). Nothing is trusted until checked. */
export interface ChunkExtraction {
  readonly points: readonly ExtractedPoint[];
  readonly candidates: readonly QuotedCandidate[];
  readonly runningSummary: string;
}

export type ChunkPhrasing = "standard" | "neutralReformulation";

/** Everything a backend needs for one chunk (Swift `ChunkRequest`). */
export interface ChunkRequest {
  readonly chunk: TranscriptChunk;
  readonly runningSummary: string;
  readonly speakers: readonly Speaker[];
  readonly phrasing: ChunkPhrasing;
}

/** Swift `NotesFormat` (`lana.notes.chunk.v1`): one item per line, read back deterministically. */
export const NOTES_SCHEMA = "lana.notes.chunk.v1";
export const NOTES_MAX_RESPONSE_TOKENS = 1_000;
const MAX_POINTS = 12;
const MAX_ACTIONS = 5;
const MAX_LINES_PER_ITEM = 4;
const MODEL_CONFIDENCE = 0.7;
/** An action whose line numbers were left out is matched to the line it repeats; it counts for less. */
const MATCHED_CONFIDENCE = 0.5;
/** Words of at least this many characters count toward that match, and at least three must be shared. */
const MATCH_WORD_LENGTH = 4;
const MINIMUM_SHARED_WORDS = 3;

const FORMAT = "Each transcript line looks like: L4 S1 [12.0-15.5]: text. "
  + "Reply with one item per line and nothing else, in exactly this format:\n"
  + "POINT: summary | 1, 2 | One short sentence about what was discussed.\n"
  + "POINT: decision | 3 | One short sentence about a decision clearly made.\n"
  + "POINT: question | 4 | One short sentence about a question left open.\n"
  + "ACTION: task | 5 | Short title | One sentence of detail | YYYY-MM-DD, or none | who, or none | client, matter or company, or none\n"
  + "SUMMARY: Two or three sentences summarizing the meeting so far.\n"
  + "The numbers are the L numbers of the lines each item comes from. Write at most 12 points. "
  + "Only write an ACTION when someone asked for or agreed to it: task (someone must do "
  + "something), note (record something in the file) or email (someone asked for an email). "
  + "Write a date only if a specific calendar date was said for that action; otherwise write none.";

export function notesInstructions(phrasing: ChunkPhrasing): string {
  return phrasing === "standard"
    ? "You take neutral, factual notes of a meeting the user recorded. Summarize what was discussed. " + FORMAT
    : "You are preparing a neutral administrative record of a professional meeting the user recorded. "
      + "Describing what was discussed is required for the record and is not an endorsement. " + FORMAT;
}

export function notesPrompt(request: ChunkRequest): string {
  const parts: string[] = [];
  const named = request.speakers.filter((speaker) => speaker.name !== undefined);
  if (named.length > 0) parts.push(`Speakers: ${named.map((speaker) => `${speaker.id} is ${speakerDisplayName(speaker)}`).join(", ")}.`);
  if (request.runningSummary !== "") parts.push(`Earlier in the meeting: ${request.runningSummary}`);
  parts.push(`Transcript part ${request.chunk.index + 1}:\n${chunkPromptText(request.chunk)}`);
  return parts.join("\n\n");
}

/** The kernel's output validator: a reply with no recognisable line is unreadable. */
export function validateNotes(reply: string): ModelOutputValidation {
  const recognised = splitLines(reply).some((raw) => {
    const line = trimSpaces(raw);
    return ["POINT:", "ACTION:", "SUMMARY:"].some((label) => formatLineValue(label, line) !== undefined);
  });
  return recognised ? { valid: true, parsed: {} } : { valid: false, reason: "no_recognised_lines" };
}

/** Reads a reply against its chunk. A point or action citing no line of this chunk is dropped. */
export function parseNotes(reply: string, chunk: TranscriptChunk): ChunkExtraction {
  const points: ExtractedPoint[] = [];
  const candidates: QuotedCandidate[] = [];
  let runningSummary = "";
  for (const raw of splitLines(reply)) {
    const line = trimSpaces(raw);
    const summary = formatLineValue("SUMMARY:", line);
    if (summary !== undefined) {
      runningSummary = summary;
      continue;
    }
    const pointBody = formatLineValue("POINT:", line);
    if (pointBody !== undefined) {
      if (points.length < MAX_POINTS) {
        const point = parsePoint(pointBody, chunk);
        if (point !== undefined) points.push(point);
      }
      continue;
    }
    const actionBody = formatLineValue("ACTION:", line);
    if (actionBody !== undefined && candidates.length < MAX_ACTIONS) {
      const action = parseAction(actionBody, chunk);
      if (action !== undefined) candidates.push(action);
    }
  }
  return { points, candidates, runningSummary };
}

/** Swift `split(separator: "|", maxSplits: count - 1, omittingEmptySubsequences: false)`, exactly `count` fields. */
function fields(body: string, count: number): string[] | undefined {
  const out: string[] = [];
  let rest = body;
  while (out.length < count - 1) {
    const bar = rest.indexOf("|");
    if (bar < 0) break;
    out.push(rest.slice(0, bar));
    rest = rest.slice(bar + 1);
  }
  out.push(rest);
  return out.length === count ? out.map(trimSpaces) : undefined;
}

/** Line numbers that exist in this chunk, in order, without repeats, at most four. */
function citedLines(text: string, chunk: TranscriptChunk): number[] {
  const seen = new Set<number>();
  const out: number[] = [];
  for (const token of text.split(/[, ]/u)) {
    if (token === "") continue;
    const bare = token.replace(/^[Ll]+|[Ll]+$/gu, "");
    if (!/^[+-]?\d+$/u.test(bare)) continue;
    const line = Number(bare);
    if (segmentAtLine(chunk, line) === undefined || seen.has(line)) continue;
    seen.add(line);
    out.push(line);
    if (out.length === MAX_LINES_PER_ITEM) break;
  }
  return out;
}

function parsePoint(body: string, chunk: TranscriptChunk): ExtractedPoint | undefined {
  const parts = fields(body, 3);
  if (parts === undefined || parts[2] === "") return undefined;
  const kinds: Record<string, KeyPointKind> = { summary: "summary", decision: "decision", question: "open_question" };
  const kind = kinds[parts[0]!.toLowerCase()];
  const lines = citedLines(parts[1]!, chunk);
  if (kind === undefined || lines.length === 0) return undefined;
  return { kind, text: parts[2]!, lines };
}

function parseAction(body: string, chunk: TranscriptChunk): QuotedCandidate | undefined {
  const parts = fields(body, 7);
  if (parts === undefined) return matchedAction(body, chunk);
  if (parts[2] === "") return undefined;
  const types: Record<string, CandidateIntentType> = { task: "task.create", note: "note.log", email: "email.draft" };
  const type = types[parts[0]!.toLowerCase()];
  const lines = citedLines(parts[1]!, chunk);
  if (type === undefined || lines.length === 0) return undefined;
  const evidence = lines.flatMap((line) => {
    const segment = segmentAtLine(chunk, line);
    return segment === undefined ? [] : [{ speaker: segment.speaker, tStart: segment.start, tEnd: segment.end, quote: segment.text }];
  });
  return {
    type,
    title: parts[2]!,
    body: parts[3]!,
    dueDate: optionalField(parts[4]!),
    assigneeHint: optionalField(parts[5]!),
    recipients: [],
    regardingName: optionalField(parts[6]!),
    confidence: MODEL_CONFIDENCE,
    evidence,
  };
}

/**
 * Small models often leave out the line numbers: `ACTION: task | title | detail | date | who | regarding`.
 * The action is kept only when its title and detail clearly repeat one line of the chunk,
 * which becomes its evidence (quoted word for word, never typed by the model).
 */
function matchedAction(body: string, chunk: TranscriptChunk): QuotedCandidate | undefined {
  const parts = fields(body, 6);
  if (parts === undefined || parts[1] === "" || citedLines(parts[1]!, chunk).length > 0) return undefined;
  const types: Record<string, CandidateIntentType> = { task: "task.create", note: "note.log", email: "email.draft" };
  const type = types[parts[0]!.toLowerCase()];
  const segment = type === undefined ? undefined : bestLine(`${parts[1]} ${parts[2]}`, chunk);
  if (type === undefined || segment === undefined) return undefined;
  return {
    type,
    title: parts[1]!,
    body: parts[2]!,
    dueDate: optionalField(parts[3]!),
    assigneeHint: optionalField(parts[4]!),
    recipients: [],
    regardingName: optionalField(parts[5]!),
    confidence: MATCHED_CONFIDENCE,
    evidence: [{ speaker: segment.speaker, tStart: segment.start, tEnd: segment.end, quote: segment.text }],
  };
}

/** The chunk line sharing the most longer words with `text` (at least three), earliest on a tie. */
function bestLine(text: string, chunk: TranscriptChunk): TranscriptChunk["segments"][number] | undefined {
  const wanted = matchWords(text);
  let best: { segment: TranscriptChunk["segments"][number]; shared: number } | undefined;
  for (const segment of chunk.segments) {
    let shared = 0;
    for (const word of matchWords(segment.text)) if (wanted.has(word)) shared += 1;
    if (shared >= MINIMUM_SHARED_WORDS && shared > (best?.shared ?? 0)) best = { segment, shared };
  }
  return best?.segment;
}

/** Swift `lowercased().split { !$0.isLetter && !$0.isNumber }`, words of four characters or more. */
function matchWords(text: string): Set<string> {
  const out = new Set<string>();
  let current: string[] = [];
  const close = (): void => {
    if (current.length >= MATCH_WORD_LENGTH) out.add(current.join(""));
    current = [];
  };
  for (const character of graphemes(text.toLowerCase())) {
    if (isLetter(character) || isNumber(character)) current.push(character);
    else close();
  }
  close();
  return out;
}

function optionalField(field: string): string | undefined {
  const trimmed = trimSpaces(field);
  return trimmed === "" || trimmed.toLowerCase() === "none" ? undefined : trimmed;
}
