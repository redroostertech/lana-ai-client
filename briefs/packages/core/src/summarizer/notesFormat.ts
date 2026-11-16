import type { CandidateIntent, CandidateIntentType } from "../intent/candidateIntent.js";
import type { KeyPointKind } from "../intent/keyPoint.js";
import { SET_ASIDE_REASONS, speakerDisplayName, type SetAsideReason, type Speaker, type TranscriptSegment } from "../intent/meetingParts.js";
import { INTENT_LIMITS } from "../intent/validator.js";
import { isCalendarDate } from "../intent/validatorRules.js";
import { splitLines } from "../runtime/answerFormat.js";
import { formatLineValue, trimSpaces } from "../runtime/formatLine.js";
import type { ModelOutputValidation } from "../runtime/kernel.js";
import { isLetter, isNumber } from "../ask/tokenizer.js";
import { graphemes } from "../text/graphemes.js";
import { excerpt, verifiedLines } from "./lineMatcher.js";
import { normalizeText } from "./textNormalizer.js";
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
  /** For a decision: the speaker label of who decided, when the model named a speaker. */
  readonly decidedBy?: string | undefined;
}

/** A spoken list as the model wrote it: one row per item, each citing chunk lines. */
export interface ExtractedTable {
  readonly title: string;
  readonly columns: readonly string[];
  readonly rows: readonly { readonly cells: readonly string[]; readonly lines: readonly number[] }[];
}

/** A stretch of this chunk that is not part of the meeting, from its first to its last cited line. */
export interface ExtractedAside {
  readonly reason: SetAsideReason;
  readonly lines: readonly number[];
}

/** Raw model output for one chunk (Swift `ChunkExtraction`). Nothing is trusted until checked. */
export interface ChunkExtraction {
  readonly points: readonly ExtractedPoint[];
  readonly candidates: readonly QuotedCandidate[];
  readonly runningSummary: string;
  readonly tables?: readonly ExtractedTable[];
  readonly asides?: readonly ExtractedAside[];
}

export type ChunkPhrasing = "standard" | "neutralReformulation";

/** Everything a backend needs for one chunk (Swift `ChunkRequest`). */
export interface ChunkRequest {
  readonly chunk: TranscriptChunk;
  readonly runningSummary: string;
  readonly speakers: readonly Speaker[];
  readonly phrasing: ChunkPhrasing;
  /** The firm's word list: names the notes must spell exactly. */
  readonly vocabulary?: readonly string[];
}

/** Swift `NotesFormat` (`lana.notes.chunk.v1`): one item per line, read back deterministically. */
export const NOTES_SCHEMA = "lana.notes.chunk.v1";
export const NOTES_MAX_RESPONSE_TOKENS = 1_200;
const MAX_POINTS = 12;
const MAX_ACTIONS = 5;
const MAX_LINES_PER_ITEM = 4;
const MAX_TABLES = 3;
const MAX_ROWS = 20;
const MAX_COLUMNS = 8;
const MODEL_CONFIDENCE = 0.7;
/** An action whose line numbers were left out is matched to the line it repeats; it counts for less. */
const MATCHED_CONFIDENCE = 0.5;
/** Words of at least this many characters count toward that match, and at least three must be shared. */
const MATCH_WORD_LENGTH = 4;
const MINIMUM_SHARED_WORDS = 3;

/**
 * The example texts in `FORMAT`. A small model sometimes repeats the format back; an item
 * whose text is one of these is the example, not a note, and is dropped.
 */
const PLACEHOLDERS = [
  "One short sentence about what was discussed.",
  "One short sentence about a decision clearly made.",
  "One short sentence about a question still unanswered at the end of this part.",
  "Short title",
  "Short table title",
  "first value; second value; third value",
];

const FORMAT = "Each transcript line looks like: L4 S1 [12.0-15.5]: text. "
  + "Reply with one item per line and nothing else, in exactly this format:\n"
  + `POINT: summary | L7, L8 | ${PLACEHOLDERS[0]}\n`
  + `POINT: decision | L12 | S2 | ${PLACEHOLDERS[1]}\n`
  + `POINT: question | L3 | ${PLACEHOLDERS[2]}\n`
  + `ACTION: task | L10 | ${PLACEHOLDERS[3]} | One sentence of detail | when | who will do it | client, matter or company, or none\n`
  + `TABLE: ${PLACEHOLDERS[4]} | First column; Second column; Third column\n`
  + `ROW: ${PLACEHOLDERS[4]} | L14 | ${PLACEHOLDERS[5]}\n`
  + "ASIDE: phone_call | L20, L31\n"
  + "SUMMARY: Two or three sentences summarizing the meeting so far.\n"
  + "The L numbers are the numbers of the transcript lines that contain each item, not a count "
  + "of your items: cite the line where it was said, not the line before or after it. "
  + "Never put a | inside a sentence. "
  + "Write at most 12 points. Keep every amount, percentage, count and duration that was said, "
  + "written as numbers (750 dollars, 3 percent, 160 cases, two weeks). "
  + "A decision is a choice the speakers agreed on, or one stated by the person who has the say, "
  + "about the work discussed. After its L numbers, write the speaker label or name of who decided, or both. "
  + "These are not decisions: setting up the meeting (screen sharing, audio, links, permissions), "
  + "a plan a person already had before the meeting, and a request. "
  + "A promise to do something is an ACTION, not a decision. "
  + "Leave out a question when a later line in this part answers it. "
  + "Write an ACTION for each thing someone will do after this point: a speaker says they will do "
  + "something, a speaker asks or tells another person to do something, or they agree on a next "
  + "step. Use task (someone must do something), note (record something in the file) or email "
  + "(someone asked for an email). For who, write the speaker label or name of the person who "
  + "will do it. For when, write a calendar date YYYY-MM-DD only if one was said; otherwise the "
  + "speaker's own words for when (tonight, this week, by Friday); otherwise none. "
  + "When a speaker goes through a list (products, prices, steps, a schedule), write one TABLE line "
  + "with its columns separated by ; and then one ROW line per item with the same number of values. "
  + "Write an ASIDE line for a stretch that is not part of this meeting, citing its first and last line: "
  + "phone_call (someone takes a phone call), side_conversation (talk with someone who is not in the meeting), "
  + "logistics (getting audio, screens or links working), other_matter (a different client, case or matter). "
  + "Write no point, action or row from an ASIDE stretch.";

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
  const vocabulary = (request.vocabulary ?? []).map(trimSpaces).filter((term) => term !== "");
  if (vocabulary.length > 0) parts.push(`Spell these names exactly: ${vocabulary.join(", ")}.`);
  if (request.runningSummary !== "") parts.push(`Earlier in the meeting: ${request.runningSummary}`);
  parts.push(`Transcript part ${request.chunk.index + 1}:\n${chunkPromptText(request.chunk)}`);
  return parts.join("\n\n");
}

/** The kernel's output validator: a reply with no recognisable line is unreadable. */
export function validateNotes(reply: string): ModelOutputValidation {
  const recognised = splitLines(reply).some((raw) => {
    const line = trimSpaces(raw);
    return LABELS.some((label) => formatLineValue(label, line) !== undefined);
  });
  return recognised ? { valid: true, parsed: {} } : { valid: false, reason: "no_recognised_lines" };
}

const LABELS = ["POINT:", "ACTION:", "SUMMARY:", "TABLE:", "ROW:", "ASIDE:"];

/**
 * Reads a reply against its chunk. Strict: a field never carries a raw `|`; a point with the
 * fields of an action is read as an action; any other malformed line is dropped. A point or
 * action citing no line of this chunk is dropped. `speakers` lets a decision name who decided.
 */
export function parseNotes(reply: string, chunk: TranscriptChunk, speakers: readonly Speaker[] = []): ChunkExtraction {
  const points: ExtractedPoint[] = [];
  const candidates: QuotedCandidate[] = [];
  const tables: Array<{ title: string; columns: string[]; rows: Array<{ cells: string[]; lines: number[] }> }> = [];
  const asides: ExtractedAside[] = [];
  let runningSummary = "";
  const addAction = (action: QuotedCandidate | undefined): void => {
    if (action !== undefined && candidates.length < MAX_ACTIONS) candidates.push(action);
  };
  for (const raw of splitLines(reply)) {
    const line = trimSpaces(raw);
    const summary = formatLineValue("SUMMARY:", line);
    if (summary !== undefined) {
      runningSummary = summary;
      continue;
    }
    const pointBody = formatLineValue("POINT:", line);
    if (pointBody !== undefined) {
      const parts = splitFields(pointBody);
      if (parts.length === 6 || parts.length === 7) {
        addAction(actionFrom(["task", ...parts.slice(1)], chunk));
      } else if (points.length < MAX_POINTS) {
        const point = parsePoint(parts, chunk, speakers);
        if (point !== undefined) points.push(point);
      }
      continue;
    }
    const actionBody = formatLineValue("ACTION:", line);
    if (actionBody !== undefined) {
      addAction(actionFrom(splitFields(actionBody), chunk));
      continue;
    }
    const tableBody = formatLineValue("TABLE:", line);
    if (tableBody !== undefined) {
      const parts = splitFields(tableBody);
      const columns = parts.length === 2 ? cells(parts[1]!) : [];
      if (parts.length === 2 && parts[0] !== "" && !isPlaceholder(parts[0]!) && columns.length >= 2 && columns.length <= MAX_COLUMNS
        && tables.length < MAX_TABLES && !tables.some((table) => sameTitle(table.title, parts[0]!))) {
        tables.push({ title: parts[0]!, columns, rows: [] });
      }
      continue;
    }
    const rowBody = formatLineValue("ROW:", line);
    if (rowBody !== undefined) {
      const parts = splitFields(rowBody);
      const table = tables.find((item) => sameTitle(item.title, parts[0] ?? ""));
      if (table === undefined) continue;
      let lines: number[];
      let values: string[];
      if (parts.length === 3 && citedLines(parts[1]!, chunk).length > 0) {
        if (isPlaceholder(parts[2]!)) continue;
        lines = citedLines(parts[1]!, chunk);
        values = cells(parts[2]!);
      } else {
        // No line numbers: the cells as written (split by | or ;), cited to the line they repeat.
        values = parts.length === 2 ? cells(parts[1]!) : parts.slice(1);
        const repeated = bestLine(values.join(" "), chunk, 2);
        lines = repeated === undefined ? [] : [chunk.segments.indexOf(repeated) + 1];
      }
      if (lines.length === 0 || values.length === 0 || values.length > table.columns.length || table.rows.length >= MAX_ROWS) continue;
      while (values.length < table.columns.length) values.push("");
      table.rows.push({ cells: values, lines });
      continue;
    }
    const asideBody = formatLineValue("ASIDE:", line);
    if (asideBody !== undefined) {
      const parts = splitFields(asideBody);
      const reason = parts[0]?.toLowerCase() ?? "";
      // A description after the lines ("| Someone takes a call") is ignored.
      const lines = parts.length >= 2 ? citedLines(parts[1]!, chunk, Number.MAX_SAFE_INTEGER) : [];
      if ((SET_ASIDE_REASONS as readonly string[]).includes(reason) && lines.length > 0) asides.push({ reason: reason as SetAsideReason, lines });
    }
  }
  return { points, candidates, runningSummary, tables: tables.filter((table) => table.rows.length > 0), asides };
}

/** Every `|`-separated field, trimmed, without a field label the model copied ("when: tonight"). */
function splitFields(body: string): string[] {
  return body.split("|").map(trimSpaces).map((field) => field.replace(/^(when|who|due|owner|detail|title|lines|regarding)\s*:\s*/iu, ""));
}

/** A field naming a speaker: `S2` or "Speaker 2". */
function isSpeakerLabel(text: string): boolean {
  return /^(s|speaker\s*)\d+$/iu.test(trimSpaces(text));
}

/** A when field: none, a calendar date, or words a due date resolves from. */
function isWhenField(text: string): boolean {
  const value = trimSpaces(text).toLowerCase();
  return value === "" || value === "none" || isCalendarDate(value)
    || /^(by |before |on |until |this |next |end of |the end of )?(today|tonight|tomorrow|eod|cob|this week|next week|week|(the )?end of (the )?(day|week|month)|monday|tuesday|wednesday|thursday|friday|saturday|sunday|morning|afternoon|evening|asap|soon|next month|this month)\b/u.test(value);
}

/**
 * Action shapes small models write instead of the format, read as the format's seven fields:
 * the kind left out with the title first (`title | lines | detail | when | who | regarding`),
 * who written before the title (`task | lines | S2 | title | when | who`), and five fields
 * (`task | lines | title | when or detail | who`).
 */
function actionShape(parts: readonly string[], chunk: TranscriptChunk): string[] {
  const typed = ACTION_TYPES[(parts[0] ?? "").toLowerCase()] !== undefined;
  const cites = parts.length > 1 && citedLines(parts[1]!, chunk).length > 0;
  if (!typed && cites && (parts.length === 6 || parts.length === 7)) {
    if (isSpeakerLabel(parts[2]!)) return ["task", parts[1]!, parts[0]!, parts[3]!, parts[4]!, parts[2]!, parts[5] ?? "none"];
    return ["task", parts[1]!, parts[0]!, parts[2]!, parts[3]!, parts[4]!, parts[5]!];
  }
  if (typed && cites && parts.length >= 5 && parts.length <= 7 && isSpeakerLabel(parts[2]!)) {
    const rest = parts.slice(3);
    const title = rest[0] ?? "";
    const when = rest.find((field, index) => index > 0 && isWhenField(field)) ?? "none";
    return [parts[0]!, parts[1]!, title, "", when, parts[2]!, "none"];
  }
  if (!typed && cites && parts.length === 4) return ["task", parts[1]!, parts[0]!, parts[3]!, "none", "none", "none"];
  if (typed && cites && parts.length === 5) {
    return isWhenField(parts[3]!)
      ? [parts[0]!, parts[1]!, parts[2]!, "", parts[3]!, parts[4]!, "none"]
      : [parts[0]!, parts[1]!, parts[2]!, parts[3]!, "none", parts[4]!, "none"];
  }
  return [...parts];
}

/** `a; b; c` as trimmed values (empty values kept in place, a trailing empty one dropped). */
function cells(text: string): string[] {
  const values = text.split(";").map(trimSpaces);
  if (values.length > 0 && values.at(-1) === "") values.pop();
  return values;
}

function sameTitle(left: string, right: string): boolean {
  return normalizeText(left) === normalizeText(right);
}

/** Line numbers that exist in this chunk, in order, without repeats, at most `limit`. */
function citedLines(text: string, chunk: TranscriptChunk, limit = MAX_LINES_PER_ITEM): number[] {
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
    if (out.length === limit) break;
  }
  return out;
}

/** Who decided, as a speaker label: `S2`, a speaker's name, or nothing for "both" and the like. */
function decider(text: string, speakers: readonly Speaker[]): { valid: boolean; label?: string } {
  const cleaned = trimSpaces(text).replace(/[.]$/u, "");
  const lowered = cleaned.toLowerCase();
  if (["both", "everyone", "all", "none", "unknown", "both speakers", "the speakers", "the group", "the team"].includes(lowered)) return { valid: true };
  const label = /^s(\d+)$/iu.exec(cleaned);
  if (label !== null) return { valid: true, label: `S${label[1]}` };
  const wanted = normalizeText(cleaned);
  if (wanted === "") return { valid: false };
  for (const speaker of speakers) {
    if (speaker.name === undefined) continue;
    const name = normalizeText(speaker.name);
    if (name === "") continue;
    if (name === wanted || name.split(" ")[0] === wanted) return { valid: true, label: speaker.id };
  }
  return { valid: false };
}

/**
 * The point's kind. Small models often write a topic where the kind goes ("fees"): a topic
 * naming a decision or a question is that kind, any other topic is a key point.
 */
function pointKind(field: string): KeyPointKind {
  const value = field.toLowerCase();
  if (value === "decision" || /\bdecision|\bdecided\b/u.test(value)) return "decision";
  if (value === "question" || /\bquestion/u.test(value)) return "open_question";
  return "summary";
}

function parsePoint(parts: readonly string[], chunk: TranscriptChunk, speakers: readonly Speaker[]): ExtractedPoint | undefined {
  const kind = pointKind(parts[0] ?? "");
  let text: string;
  let decidedBy: string | undefined;
  if (parts.length === 3) {
    text = parts[2]!;
  } else if (parts.length === 4 && kind === "decision") {
    const who = decider(parts[2]!, speakers);
    if (!who.valid) return undefined;
    decidedBy = who.label;
    text = parts[3]!;
  } else {
    return undefined;
  }
  const lines = citedLines(parts[1]!, chunk);
  if (text === "" || lines.length === 0 || isPlaceholder(text)) return undefined;
  return decidedBy === undefined ? { kind, text, lines } : { kind, text, lines, decidedBy };
}

/**
 * An action from its fields: `type | lines | title | detail | when | who | regarding`. Six
 * fields that start with line numbers are an action without `regarding`; six that do not are
 * the line-number-less form `type | title | detail | when | who | regarding` (Nov 13).
 */
function actionFrom(input: readonly string[], chunk: TranscriptChunk): QuotedCandidate | undefined {
  let parts = actionShape(input, chunk);
  if (parts.length === 6) {
    if (citedLines(parts[1]!, chunk).length === 0) return matchedAction(parts, chunk);
    parts = [...parts, "none"];
  }
  if (parts.length !== 7 || parts[2] === "" || isPlaceholder(parts[2]!)) return undefined;
  const type = ACTION_TYPES[parts[0]!.toLowerCase()];
  const about = `${parts[2]} ${parts[3]}`;
  const lines = verifiedLines(about, citedLines(parts[1]!, chunk), chunk.segments);
  if (type === undefined || lines.length === 0) return undefined;
  const evidence = lines.flatMap((line) => {
    const segment = segmentAtLine(chunk, line);
    return segment === undefined ? [] : [quoteOf(segment, about)];
  });
  return { type, title: parts[2]!, body: parts[3]!, ...when(parts[4]!), assigneeHint: optionalField(parts[5]!), recipients: [], regardingName: optionalField(parts[6]!), confidence: MODEL_CONFIDENCE, evidence };
}

const ACTION_TYPES: Record<string, CandidateIntentType> = { task: "task.create", note: "note.log", email: "email.draft" };

/** A calendar date as the due date; any other words as the spoken due text. */
function when(field: string): { dueDate?: string; dueText?: string } {
  const value = optionalField(field);
  if (value === undefined) return {};
  return isCalendarDate(value) ? { dueDate: value } : { dueText: value };
}

/**
 * Small models often leave out the line numbers: `ACTION: task | title | detail | date | who | regarding`.
 * The action is kept only when its title and detail clearly repeat one line of the chunk,
 * which becomes its evidence (quoted word for word, never typed by the model).
 */
function matchedAction(parts: readonly string[], chunk: TranscriptChunk): QuotedCandidate | undefined {
  if (parts[1] === "" || isPlaceholder(parts[1]!)) return undefined;
  const type = ACTION_TYPES[parts[0]!.toLowerCase()];
  const segment = type === undefined ? undefined : bestLine(`${parts[1]} ${parts[2]}`, chunk);
  if (type === undefined || segment === undefined) return undefined;
  return {
    type,
    title: parts[1]!,
    body: parts[2]!,
    ...when(parts[3]!),
    assigneeHint: optionalField(parts[4]!),
    recipients: [],
    regardingName: optionalField(parts[5]!),
    confidence: MATCHED_CONFIDENCE,
    evidence: [quoteOf(segment, `${parts[1]} ${parts[2]}`)],
  };
}

/** Evidence copied from `segment`, cut to the sentences about the action when the line is too long to quote (Nov 13). */
export function quoteOf(segment: TranscriptSegment, about: string): CandidateQuote {
  return { speaker: segment.speaker, tStart: segment.start, tEnd: segment.end, quote: excerpt(segment.text, about, INTENT_LIMITS.maxQuote) };
}

/** The chunk line sharing the most longer words with `text` (at least three), earliest on a tie. */
function bestLine(text: string, chunk: TranscriptChunk, minimum = MINIMUM_SHARED_WORDS): TranscriptSegment | undefined {
  const wanted = matchWords(text);
  let best: { segment: TranscriptSegment; shared: number } | undefined;
  for (const segment of chunk.segments) {
    let shared = 0;
    for (const word of matchWords(segment.text)) if (wanted.has(word)) shared += 1;
    if (shared >= minimum && shared > (best?.shared ?? 0)) best = { segment, shared };
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

function isPlaceholder(text: string): boolean {
  const wanted = trimSpaces(text).toLowerCase();
  return PLACEHOLDERS.some((placeholder) => placeholder.toLowerCase() === wanted);
}

const EMPTY_FIELDS = new Set(["none", "not specified", "unspecified", "not stated", "not said", "n/a", "na", "tbd", "unknown", "nobody", "no one"]);

function optionalField(field: string): string | undefined {
  const trimmed = trimSpaces(field);
  return trimmed === "" || EMPTY_FIELDS.has(trimmed.toLowerCase().replace(/[.]$/u, "")) ? undefined : trimmed;
}
