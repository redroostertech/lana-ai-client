import { BackendError, isAbortError, type BackendAvailability, throwIfAborted } from "../ask/backend.js";
import type { LanaId } from "../ids/lanaId.js";
import { makeLanaId } from "../ids/lanaId.js";
import { assembleIntent } from "../intent/intentAssembler.js";
import type { Intent } from "../intent/intent.js";
import type { KeyPoint, KeyPointKind, KeyPointPrecision, SourceSpan } from "../intent/keyPoint.js";
import { overlapsSetAside, segmentSetAside, speakerDisplayName, type SetAsidePart, type Speaker, type TranscriptSegment } from "../intent/meetingParts.js";
import { titleOf } from "../intent/params.js";
import { splitLines } from "../runtime/answerFormat.js";
import { trimSpaces } from "../runtime/formatLine.js";
import type { ModelOutputValidation } from "../runtime/kernel.js";
import { graphemes } from "../text/graphemes.js";
import { INTENT_LIMITS } from "../intent/validator.js";
import { groundQuotes } from "./evidenceGrounder.js";
import { stems, verifiedLines } from "./lineMatcher.js";
import { finishCandidate, isLogistics, promiseAction, PROMISE_MODALS, PROMISE_VERBS, SPOKEN_WHEN } from "./meetingSummarizer.js";
import { notesInstructions, parseNotes, quoteOf, validateNotes, type ChunkExtraction, type ChunkPhrasing, type QuotedCandidate } from "./notesFormat.js";
import { capInTurn, DEFAULT_SUMMARY_LIMITS, isDuplicate, spansFor, unionSpans, type SummaryLimits } from "./summaryReducer.js";
import { applyQuestionCheck, planQuestionCheck, type QuestionCheckRequest, type QuestionResolution } from "./questionCheck.js";
import { textSimilarity } from "./textNormalizer.js";
import { chunkEnd, chunkPromptText, chunkStart, HEURISTIC_TOKENS, segmentAtLine, TranscriptChunker, type ChunkBudget, type TokenCounter, type TranscriptChunk } from "./transcriptChunk.js";

/**
 * Find more notes (contract `find-more/contract.md`, kept in step with the phone's Swift):
 * a second, deeper pass over a meeting whose notes exist. Each smaller part is asked only for
 * what the notes miss, with the items already there listed so they are not repeated. Every
 * suggestion passes the notes' own checks; nothing changes the notes until the person adds it.
 */

/** Half the normal chunk budget, so the model has room to go deeper. */
export const FIND_MORE_CHUNK_BUDGET: ChunkBudget = { targetTokens: 750, maxTokens: 1_000 };
export const FIND_MORE_MAX_SUGGESTIONS = 15;
export const FIND_MORE_SCHEMA = "lana.notes.more.v1";
export const FIND_MORE_MAX_RESPONSE_TOKENS = 1_200;
/** Known items with a source this close to a part are listed in its prompt. */
const NEAR_SECONDS = 60;
const MAX_KNOWN = 30;
const MAX_KNOWN_CHARACTERS = 200;
/** Suggested questions go through the open question check this many to a call (as in the notes). */
const MAX_CHECKED_QUESTIONS = 6;
/** A suggestion whose content words are at least this share of one known item's is a rewording of it. */
const COVERED_SHARE = 0.5;
/** ...with at least this many tokens in common. */
const COVERED_MIN_SHARED = 3;
/** With every figure already in that item, this share is enough. */
const COVERED_FIGURE_SHARE = 0.4;

export const FIND_MORE_RULES = "These notes were written once already. Find what they missed in this transcript part: "
  + "specifics (amounts, dates, names, reasons, risks), commitments and open questions. "
  + "Never repeat or reword an item listed under Already in the notes. "
  + "Write a question only when no line in this part answers it. "
  + "Write no SUMMARY line and no ASIDE line. If nothing is missing, reply NONE.";

export type SuggestionKind = KeyPointKind | "task";

/** An item the notes already hold (or a dismissed suggestion): listed in the prompt and never suggested again. */
export interface FindMoreKnown {
  readonly kind: SuggestionKind;
  /** The point's text, or the task's title. */
  readonly text: string;
  readonly sources: readonly SourceSpan[];
}

/** One suggestion, waiting for the person: a key point of `kind`, or a task carrying its proposed `intent`. */
export interface FindMoreSuggestion {
  readonly id: string;
  readonly kind: SuggestionKind;
  readonly text: string;
  readonly sources: readonly SourceSpan[];
  readonly precision: KeyPointPrecision;
  readonly decidedBy?: string | undefined;
  readonly intent?: Intent | undefined;
}

/** A suggestion while a run works on it: its part, and for an answered question the answer alone. */
type Found = FindMoreSuggestion & { chunk: number; answer?: string };

export interface FindMoreRequest {
  readonly chunk: TranscriptChunk;
  readonly speakers: readonly Speaker[];
  readonly phrasing: ChunkPhrasing;
  readonly known: readonly FindMoreKnown[];
  readonly vocabulary?: readonly string[];
}

/** The model side (RuntimeNotesBackend runs `notes.more.v1`). */
export interface FindMoreBackend {
  readonly modelID: string;
  readonly tokenCounter: TokenCounter;
  availability(): Promise<BackendAvailability>;
  findMore(request: FindMoreRequest, signal?: AbortSignal): Promise<ChunkExtraction>;
  /** The notes' open question check (`notes.questions.v1`); without it suggested questions are kept as written. */
  checkOpenQuestions?(request: QuestionCheckRequest, signal?: AbortSignal): Promise<QuestionResolution[]>;
}

export interface FindMoreOptions {
  readonly transcript: readonly TranscriptSegment[];
  readonly speakers: readonly Speaker[];
  readonly meetingID: LanaId;
  readonly now: Date;
  readonly meetingStart?: Date;
  readonly vocabulary?: readonly string[];
  readonly keyPoints: readonly KeyPoint[];
  /** The meeting's actions, dismissed ones left out. */
  readonly actions: readonly Intent[];
  readonly dismissed: readonly FindMoreKnown[];
  readonly setAside: readonly SetAsidePart[];
  /** Called as each part finishes: part n of total. */
  readonly progress?: (part: number, of: number) => void;
  readonly signal?: AbortSignal;
  readonly intentID?: () => LanaId;
  readonly suggestionID?: () => string;
}

export interface FindMoreResult {
  readonly suggestions: FindMoreSuggestion[];
  readonly chunkCount: number;
  /** Parts the model failed or declined; they add nothing. */
  readonly skippedChunks: number;
  readonly modelID: string;
}

export class FindMoreUnavailableError extends Error {
  constructor(readonly availability: BackendAvailability) {
    super("find_more_unavailable");
    this.name = "FindMoreUnavailableError";
  }
}

const LABEL: Record<SuggestionKind, string> = { summary: "Key point", decision: "Decision", open_question: "Question", task: "Task" };

export function findMoreInstructions(phrasing: ChunkPhrasing): string {
  return `${notesInstructions(phrasing)} ${FIND_MORE_RULES}`;
}

export function findMorePrompt(request: FindMoreRequest): string {
  const parts: string[] = [];
  const named = request.speakers.filter((speaker) => speaker.name !== undefined);
  if (named.length > 0) parts.push(`Speakers: ${named.map((speaker) => `${speaker.id} is ${speakerDisplayName(speaker)}`).join(", ")}.`);
  const vocabulary = (request.vocabulary ?? []).map(trimSpaces).filter((term) => term !== "");
  if (vocabulary.length > 0) parts.push(`Spell these names exactly: ${vocabulary.join(", ")}.`);
  if (request.known.length > 0) parts.push(`Already in the notes, do not repeat:\n${request.known.map((item) => `- ${LABEL[item.kind]}: ${knownText(item.text)}`).join("\n")}`);
  parts.push(`Transcript part ${request.chunk.index + 1}:\n${chunkPromptText(request.chunk)}`);
  return parts.join("\n\n");
}

/** Known items with a source within 60 s of the part, in time order, at most 30, each cut to 200 characters. */
export function knownForChunk(chunk: TranscriptChunk, items: readonly FindMoreKnown[]): FindMoreKnown[] {
  const low = chunkStart(chunk) - NEAR_SECONDS;
  const high = chunkEnd(chunk) + NEAR_SECONDS;
  const first = (item: FindMoreKnown) => Math.min(...item.sources.map((span) => span.start));
  return items
    .filter((item) => item.sources.some((span) => span.end >= low && span.start <= high))
    .map((item, index) => ({ item, index }))
    .sort((a, b) => first(a.item) - first(b.item) || a.index - b.index)
    .slice(0, MAX_KNOWN)
    .map(({ item }) => ({ ...item, text: knownText(item.text) }));
}

function knownText(text: string): string {
  const flat = text.replace(/[|\r\n\u2028\u2029]+/gu, " ").replace(/ {2,}/gu, " ").trim();
  return graphemes(flat).slice(0, MAX_KNOWN_CHARACTERS).join("");
}

const NONE = /^none\.?$/iu;

/** A reply that is only NONE is a valid empty reply; otherwise the notes validator decides. */
export function validateFindMore(reply: string): ModelOutputValidation {
  if (NONE.test(reply.trim())) return { valid: true, parsed: {} };
  return validateNotes(reply);
}

/** The notes parser, with SUMMARY, ASIDE, TABLE and ROW lines ignored. */
export function parseFindMore(reply: string, chunk: TranscriptChunk, speakers: readonly Speaker[]): ChunkExtraction {
  if (NONE.test(reply.trim())) return { points: [], candidates: [], runningSummary: "" };
  const kept = splitLines(reply).filter((line) => !/^(SUMMARY|ASIDE|TABLE|ROW):/iu.test(trimSpaces(line))).join("\n");
  const parsed = parseNotes(kept, chunk, speakers);
  return { points: parsed.points, candidates: parsed.candidates, runningSummary: "" };
}

/** Find more notes over one meeting (Swift `NoteFinder`). */
export class NoteFinder {
  private readonly chunker: TranscriptChunker;

  constructor(private readonly backend: FindMoreBackend, budget: ChunkBudget = FIND_MORE_CHUNK_BUDGET, private readonly limits: SummaryLimits = DEFAULT_SUMMARY_LIMITS) {
    this.chunker = new TranscriptChunker(budget, backend.tokenCounter ?? HEURISTIC_TOKENS);
  }

  async find(options: FindMoreOptions): Promise<FindMoreResult> {
    const availability = await this.backend.availability();
    if (!availability.available) throw new FindMoreUnavailableError(availability);
    const setAside = options.setAside;
    const visible = options.transcript.filter((segment) => segment.text.trim() !== "" && !segmentSetAside(segment, setAside));
    const chunks = this.chunker.chunk(visible);
    const people = meetingPeople(options.speakers, options.transcript);
    const known: FindMoreKnown[] = [
      ...options.keyPoints.map((point) => ({ kind: point.kind, text: point.text, sources: point.sources })),
      ...options.actions.map((intent) => ({ kind: "task" as const, text: titleOf(intent.params), sources: intent.evidence.map((item) => ({ start: item.tStart, end: item.tEnd })) })),
      ...options.dismissed,
    ];
    const outside = (start: number, end: number) => !overlapsSetAside(start, end, setAside, 0.5);
    const found: Array<Found> = [];
    let skipped = 0;
    const start = options.meetingStart ?? options.now;
    const nextID = options.suggestionID ?? (() => `more-${Math.random().toString(16).slice(2, 10)}`);
    for (const chunk of chunks) {
      throwIfAborted(options.signal);
      const extraction = await this.extract(chunk, knownForChunk(chunk, known), options);
      if (extraction === undefined) {
        skipped += 1;
        options.progress?.(chunk.index + 1, chunks.length);
        continue;
      }
      const candidates: QuotedCandidate[] = [...extraction.candidates];
      for (const point of extraction.points) {
        if (isLogistics(point)) continue;
        const cited = [...new Set(verifiedLines(point.text, point.lines, chunk.segments))].sort((a, b) => a - b).flatMap((line) => {
          const segment = segmentAtLine(chunk, line);
          return segment === undefined ? [] : [segment];
        });
        const text = point.text.trim();
        // A key point or decision that is a person's commitment is a task with that owner (Amendments 5 and 6).
        const commitment = point.kind === "open_question" ? undefined : commitmentAction(text, cited, people);
        if (commitment !== undefined) {
          candidates.push(commitment);
          continue;
        }
        const promise = point.kind === "decision" ? promiseAction(point, chunk) : undefined;
        if (promise !== undefined) {
          candidates.push(promise);
          continue;
        }
        if (cited.length === 0) continue;
        const sources = spansFor(cited);
        if (!sources.every((span) => outside(span.start, span.end))) continue;
        // A reported question ("Omar asks who...") is not a key point (Amendment 6).
        if (REPORTED_QUESTION.test(text)) continue;
        const kind = checkedKind(point.kind, text);
        const decided = kind === "decision" && point.decidedBy !== undefined ? { decidedBy: point.decidedBy } : {};
        found.push({ id: nextID(), kind, text, sources, precision: "exact", chunk: chunk.index, ...decided });
      }
      for (const raw of candidates) {
        const candidate = taskShape(finishCandidate(raw, options.speakers, start), people);
        if (candidate === undefined) continue;
        const grounding = groundQuotes(candidate.evidence, chunk.segments, options.speakers);
        const result = assembleIntent(candidate, grounding, options.meetingID, options.now, options.intentID?.() ?? makeLanaId("intent", options.now));
        if (!result.ok) continue;
        const intent = result.intent;
        if (!intent.evidence.every((item) => outside(item.tStart, item.tEnd))) continue;
        const sources = spansFor(intent.evidence.map((item) => ({ speaker: item.speaker, start: item.tStart, end: item.tEnd, text: item.quote })));
        found.push({ id: nextID(), kind: "task", text: titleOf(intent.params), sources, precision: "exact", intent, chunk: chunk.index });
      }
      options.progress?.(chunk.index + 1, chunks.length);
    }
    // Every suggested question is checked, six to a call (the notes' check size).
    let checked = found;
    const questions = found.filter((item) => item.kind === "open_question");
    for (let first = 0; first < questions.length; first += MAX_CHECKED_QUESTIONS) {
      const batch = new Set(questions.slice(first, first + MAX_CHECKED_QUESTIONS).map((item) => item.id));
      const others = checked.filter((item) => item.kind !== "open_question" || !batch.has(item.id));
      const result = await this.checkQuestions(checked.filter((item) => batch.has(item.id)), visible, options, nextID);
      checked = [...others, ...result].sort((a, b) => a.chunk - b.chunk || (a.sources[0]?.start ?? 0) - (b.sources[0]?.start ?? 0));
    }
    const fresh: Array<Found> = [];
    for (const suggestion of checked) {
      if (this.repeats(suggestion, options, fresh)) continue;
      fresh.push(suggestion);
    }
    const suggestions = capInTurn(fresh, FIND_MORE_MAX_SUGGESTIONS)
      .map(({ chunk: _chunk, answer: _answer, ...suggestion }) => suggestion)
      .map((suggestion, index) => ({ suggestion, index }))
      .sort((a, b) => (a.suggestion.sources[0]?.start ?? 0) - (b.suggestion.sources[0]?.start ?? 0) || a.index - b.index)
      .map(({ suggestion }) => suggestion);
    return { suggestions, chunkCount: chunks.length, skippedChunks: skipped, modelID: this.backend.modelID };
  }

  /**
   * The notes' open question check on the suggested questions, reading from each question's own
   * cited lines on: an answered question becomes the answer (a key point, checked like any
   * other), a question asked twice is kept once. A failed check keeps the questions as written.
   */
  private async checkQuestions(found: Array<Found>, transcript: readonly TranscriptSegment[], options: FindMoreOptions, nextID: () => string): Promise<Array<Found>> {
    if (this.backend.checkOpenQuestions === undefined || !found.some((item) => item.kind === "open_question")) return found;
    const drafts = found.map((item) => ({
      kind: item.kind === "task" ? ("summary" as const) : item.kind,
      text: item.text,
      // Anchored at the start of the cited lines, so a line that answers its own question counts.
      sources: item.kind === "open_question" ? [{ start: item.sources[0]!.start, end: item.sources[0]!.start }] : item.sources,
      precision: item.precision,
      chunk: item.chunk,
    }));
    const plan = planQuestionCheck(drafts, transcript, options.speakers, this.backend.tokenCounter ?? HEURISTIC_TOKENS, MAX_CHECKED_QUESTIONS);
    if (plan === undefined) return found;
    throwIfAborted(options.signal);
    let resolutions: QuestionResolution[];
    try {
      resolutions = await this.backend.checkOpenQuestions(plan.request, options.signal);
    } catch (error) {
      if (isAbortError(error) || options.signal?.aborted === true) throw error;
      return found;
    }
    const applied = applyQuestionCheck(resolutions, plan, drafts);
    // Answered questions are replaced in place; repeats of an answered question are removed.
    const kept = new Set<object>(applied);
    const removed = new Set(plan.drafts.filter((group) => !kept.has(drafts[group[0]!]!)).flatMap((group) => group.slice(1)));
    const out: Array<Found> = [];
    let index = 0;
    for (const [offset, item] of found.entries()) {
      if (removed.has(offset)) continue;
      const next = applied[index++];
      if (next === undefined) break;
      if (next === drafts[offset]) {
        out.push(item);
        continue;
      }
      if (next.sources.some((span) => overlapsSetAside(span.start, span.end, options.setAside, 0.5))) continue;
      // The question stays with its answer, so the key point reads on its own (Amendment 5).
      const text = answeredText(item.text, next.text);
      if (text === undefined) continue;
      out.push({ id: nextID(), kind: "summary", text, answer: next.text.trim(), sources: unionSpans(item.sources, next.sources), precision: "exact", chunk: item.chunk });
    }
    return out;
  }

  /** Whether it matches a note or action already there, a dismissed suggestion, or an earlier suggestion. */
  private repeats(suggestion: FindMoreSuggestion, options: FindMoreOptions, earlier: readonly FindMoreSuggestion[]): boolean {
    const similarText = (left: string, right: string, threshold: number) => textSimilarity(left, right) >= threshold;
    const known = [
      ...options.keyPoints.map((point) => point.text), ...options.actions.map((intent) => titleOf(intent.params)),
      ...options.dismissed.map((item) => item.text), ...earlier.map((item) => item.text),
    ];
    // An answered question is compared by its answer (Amendment 6).
    if (covered((suggestion as { answer?: string }).answer ?? suggestion.text, known)) return true;
    if (suggestion.kind === "task") {
      const intent = suggestion.intent!;
      if (options.actions.some((action) => isDuplicate(action, intent, this.limits))) return true;
      if (options.dismissed.some((item) => item.kind === "task" && similarText(item.text, suggestion.text, this.limits.titleSimilarityThreshold))) return true;
      return earlier.some((item) => item.intent !== undefined && isDuplicate(item.intent, intent, this.limits));
    }
    const threshold = this.limits.noteSimilarityThreshold;
    return options.keyPoints.some((point) => point.kind === suggestion.kind && similarText(point.text, suggestion.text, threshold))
      || options.dismissed.some((item) => item.kind === suggestion.kind && similarText(item.text, suggestion.text, threshold))
      || earlier.some((item) => item.kind === suggestion.kind && similarText(item.text, suggestion.text, threshold));
  }

  /** One part, retried once with the neutral phrasing when the model declines; undefined when it fails. */
  private async extract(chunk: TranscriptChunk, known: readonly FindMoreKnown[], options: FindMoreOptions): Promise<ChunkExtraction | undefined> {
    for (const phrasing of ["standard", "neutralReformulation"] as ChunkPhrasing[]) {
      throwIfAborted(options.signal);
      try {
        const vocabulary = options.vocabulary ?? [];
        const request: FindMoreRequest = vocabulary.length === 0 ? { chunk, speakers: options.speakers, phrasing, known } : { chunk, speakers: options.speakers, phrasing, known, vocabulary };
        return await this.backend.findMore(request, options.signal);
      } catch (error) {
        if (isAbortError(error) || options.signal?.aborted === true) throw error;
        const failure = error instanceof BackendError ? error : BackendError.failed(error instanceof Error ? error.name : "unknown");
        if (phrasing !== "standard" || !failure.isRetryableWithReformulation) return undefined;
      }
    }
    return undefined;
  }
}

/**
 * True when the text is a rewording of one known item, of any kind: at least 60% of its content
 * words and figures are in that item, or every figure it holds is there and at least 40% overall.
 */
export function covered(text: string, known: readonly string[]): boolean {
  const figures = figuresOf(text);
  const wanted = new Set([...stems(text), ...figures]);
  if (wanted.size === 0) return false;
  return known.some((item) => {
    const itemFigures = figuresOf(item);
    const have = new Set([...stems(item), ...itemFigures]);
    let shared = 0;
    for (const token of wanted) if (have.has(token)) shared += 1;
    const share = shared / wanted.size;
    if (share >= COVERED_SHARE && shared >= COVERED_MIN_SHARED) return true;
    return figures.size > 0 && [...figures].every((figure) => itemFigures.has(figure)) && share >= COVERED_FIGURE_SHARE;
  });
}

/** The numbers in a text, written without separators ("410,000" is "410000"). */
function figuresOf(text: string): Set<string> {
  return new Set([...text.matchAll(/\p{N}+(?:[.,]\p{N}+)*/gu)].map((match) => match[0].replace(/,/gu, "")));
}

/**
 * The kind checks (contract Amendment 4), the same entries on the phone: a question must read as
 * one, and a decision must not say the matter is unsettled.
 */
export const FIND_MORE_KIND_WORDS = {
  /** A question has a "?" or starts with one of these words. */
  questionWords: ["who", "what", "when", "where", "why", "how", "which", "will", "would", "can", "could", "should", "is", "are", "do", "does", "did", "has", "have", "whether"],
  /** A decision holding one of these phrases (whole words, any case; words split on any non-letter) is not settled. */
  unsettled: ["undecided", "not decided", "not yet decided", "remains open", "still open", "to be decided", "pending", "depends on"],
  /** Nor is one with "until" followed later by one of these words. */
  untilWords: ["consulted", "confirms"],
} as const;

/** The kind a suggested point keeps after the kind checks. */
export function checkedKind(kind: KeyPointKind, text: string): KeyPointKind {
  const words = text.toLowerCase();
  if (kind === "open_question") {
    const first = /^[^\p{L}]*(\p{L}+)/u.exec(words)?.[1] ?? "";
    return words.includes("?") || (FIND_MORE_KIND_WORDS.questionWords as readonly string[]).includes(first) ? kind : "summary";
  }
  if (kind === "decision") {
    const has = (phrase: string) => new RegExp(`(^|[^\\p{L}])${phrase.replace(/ /gu, "[^\\p{L}]+")}($|[^\\p{L}])`, "u").test(words);
    const until = /(^|[^\p{L}])until([^\p{L}].*)$/u.exec(words)?.[2] ?? "";
    const laterWord = FIND_MORE_KIND_WORDS.untilWords.some((word) => new RegExp(`(^|[^\\p{L}])${word}($|[^\\p{L}])`, "u").test(until));
    if (FIND_MORE_KIND_WORDS.unsettled.some(has) || laterWord) return "open_question";
  }
  return kind;
}

/**
 * Amendment 6 word lists, the same entries on the phone. Words that open an answer and add
 * nothing; phrases that make an answer about the conversation, not the matter; prefixes a model
 * puts before an owner; verbs a task title may start with.
 */
export const FIND_MORE_ANSWER_WORDS = {
  openers: ["yes", "no", "probably", "maybe", "likely", "possibly", "definitely", "correct", "right", "sure", "ok", "okay"],
  aboutTheTalk: ["is discussed", "was discussed", "are discussed", "were discussed", "is noted", "was noted", "is mentioned", "was mentioned", "is raised", "was raised", "the speakers agree", "the speakers discuss", "the speakers note", "they discuss"],
  ownerPrefixes: ["client", "matter", "company", "owner", "regarding", "who"],
  /** A stand-alone answer may not start with one of these (Amendment 7): it needs its question. */
  leadingWords: ["i", "you", "he", "she", "it", "we", "they", "them", "this", "that", "these", "those", "but", "and", "so", "because", "also"],
  /** After a wh-word these start a subject, so the line is not a real question ("When the decision will be made"). */
  subjectStarts: ["the", "a", "an", "this", "that", "these", "those", "his", "her", "their", "our", "my", "your", "its", "he", "she", "they", "we", "i", "you", "it"],
  taskVerbs: [...PROMISE_VERBS.split("|"), "ask", "arrange", "bring", "collect", "complete", "contact", "decide", "discuss", "find", "gather", "line up", "list", "meet", "notify", "obtain", "open", "order", "pay", "publish", "redo", "request", "return", "set", "sign", "submit", "talk", "tell", "transfer", "assign", "deed", "fund", "hire", "keep", "let", "make", "mail", "print", "register", "renew", "research", "sell", "buy", "verify", "visit"],
} as const;

const MAX_ANSWERED_CHARACTERS = 300;
const ALONE_MIN_WORDS = 6;
const MONTHS_AND_DAYS = new Set(["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]);

/**
 * An answered question as one key point (Amendments 5 and 6): the answer alone when, without a
 * leading "Yes," or "Probably,", it is a sentence of 6 or more words; otherwise "<question>?
 * <answer>" (a "Whether" question turned into "Is ...?" when that is simple, else no key point).
 * Undefined when the answer is about the conversation itself.
 */
export function answeredText(question: string, answer: string): string | undefined {
  const aboutTheTalk = (text: string) => {
    const lower = ` ${text.toLowerCase().replace(/[.,?!;]/gu, " ")} `;
    return FIND_MORE_ANSWER_WORDS.aboutTheTalk.some((phrase) => lower.includes(` ${phrase} `));
  };
  if (aboutTheTalk(answer) || aboutTheTalk(question)) return undefined;
  let said = answer.trim();
  const opener = new RegExp(`^(?:${FIND_MORE_ANSWER_WORDS.openers.join("|")})\\b[,.!]?\\s*`, "iu");
  while (opener.test(said)) said = said.replace(opener, "");
  const sentence = said.charAt(0).toUpperCase() + said.slice(1);
  const firstWord = (said.split(/[\s,]+/u)[0] ?? "").toLowerCase();
  const standsAlone = said !== "" && /[.!]$/u.test(sentence) && sentence.split(/\s+/u).length >= ALONE_MIN_WORDS
    && !(FIND_MORE_ANSWER_WORDS.leadingWords as readonly string[]).includes(firstWord);
  if (standsAlone) return firstSentenceWithin(sentence);
  // Otherwise the answer as said, after a real question (Amendment 7).
  const asked = askedForm(question);
  if (asked === undefined) return undefined;
  const original = answer.trim();
  const reply = original.charAt(0).toUpperCase() + original.slice(1);
  const joined = `${asked} ${reply}`;
  if (graphemes(joined).length <= MAX_ANSWERED_CHARACTERS) return joined;
  return `${asked} ${firstSentence(reply)}`;
}

function firstSentence(text: string): string {
  return /^.*?[.!?](?=\s|$)/u.exec(text)?.[0] ?? text;
}

function firstSentenceWithin(text: string): string {
  return graphemes(text).length <= MAX_ANSWERED_CHARACTERS ? text : firstSentence(text);
}

/**
 * The question as a real question with one "?" (Amendment 7): it starts with a question word and,
 * after a wh-word, goes on with a verb, not a subject ("When the decision will be made" is not
 * one). A "Whether X is Y" question becomes "Is X Y?" when X is 1 to 5 words. Else undefined.
 */
function askedForm(question: string): string | undefined {
  let base = question.trim().replace(/[.!\s]+$/u, "").replace(/\?+$/u, "");
  if (/^whether\b/iu.test(base)) {
    const whether = /^whether\s+(.+?)\s+(is|are|was|were|has|have|can|will|should|does|do)\s+(.+)$/iu.exec(base);
    if (whether === null || whether[1]!.split(/\s+/u).length > 5) return undefined;
    const verb = whether[2]!.toLowerCase();
    base = `${verb.charAt(0).toUpperCase()}${verb.slice(1)} ${whether[1]} ${whether[3]}`;
  }
  const words = base.split(/\s+/u).map((word) => word.toLowerCase().replace(/[^\p{L}']/gu, ""));
  const first = words[0] ?? "";
  if (!(FIND_MORE_KIND_WORDS.questionWords as readonly string[]).includes(first) || first === "whether" || words.length < 2) return undefined;
  if ((WH_WORDS as readonly string[]).includes(first) && (FIND_MORE_ANSWER_WORDS.subjectStarts as readonly string[]).includes(words[1]!)) return undefined;
  return `${base.charAt(0).toUpperCase()}${base.slice(1)}?`;
}

const WH_WORDS = ["who", "what", "when", "where", "why", "how", "which"] as const;

/** "Omar asks who will update the forms": a reported question, not a key point. */
const REPORTED_QUESTION = /^\p{Lu}[\p{L}'\u2019-]*(?:\s+\p{Lu}[\p{L}'\u2019-]*)?\s+(?:asks|asked)\s+(?:if|whether|who|what|when|how|about)\b/u;

/** Words that start a sentence but never name the person who commits. */
export const FIND_MORE_NOT_NAMES = ["The", "We", "They", "He", "She", "It", "This", "That", "These", "Those", "Each", "Both", "Everyone", "Everybody", "Someone", "Nobody", "No", "Our", "Their", "His", "Her", "I", "You", "Who", "All"] as const;

/**
 * The people of a meeting, lowercased: each speaker's name (whole, first and last word) and every
 * capitalized word inside a transcript line that is not the first word of a sentence, a month or
 * a day, or one of the not-names.
 */
export function meetingPeople(speakers: readonly Speaker[], transcript: readonly TranscriptSegment[]): Set<string> {
  const out = new Set<string>();
  for (const speaker of speakers) {
    if (speaker.name === undefined || speaker.name.trim() === "") continue;
    const words = speaker.name.trim().split(/\s+/u);
    out.add(speaker.name.trim().toLowerCase());
    out.add(words[0]!.toLowerCase());
    out.add(words.at(-1)!.toLowerCase());
  }
  for (const segment of transcript) {
    for (const match of segment.text.matchAll(/(?<![.!?]\s)(?<!^)(?<=\s)(\p{Lu}[\p{Ll}'\u2019-]+)/gu)) {
      const word = match[1]!.replace(/['\u2019]s$/u, "");
      if (MONTHS_AND_DAYS.has(word) || (FIND_MORE_NOT_NAMES as readonly string[]).includes(word)) continue;
      out.add(word.toLowerCase());
    }
    for (const match of segment.text.matchAll(/\b(?:Mr|Ms|Mrs|Dr)\.?\s+(\p{Lu}[\p{Ll}'\u2019-]+)/gu)) out.add(match[1]!.toLowerCase());
  }
  return out;
}

function isPerson(name: string, people: ReadonlySet<string>): boolean {
  const trimmed = name.trim();
  if (/^S\d+$/u.test(trimmed)) return true;
  if (people.has(trimmed.toLowerCase())) return true;
  const words = trimmed.split(/\s+/u).filter((word) => !/^(?:mr|ms|mrs|dr)\.?$/iu.test(word));
  return words.length > 0 && words.length <= 3 && words.every((word) => /^\p{Lu}/u.test(word) && people.has(word.toLowerCase()));
}

const COMMITMENT_MODALS = `${PROMISE_MODALS}|to`;
const COMMITMENT_NAME = "S\\d+|\\p{Lu}[\\p{L}'\u2019-]*(?:\\s+\\p{Lu}[\\p{L}'\u2019-]*)?";
/** A promise verb after the name: any name. */
const COMMITMENT = new RegExp(`^(${COMMITMENT_NAME})\\s+(?:${COMMITMENT_MODALS})\\s+((?:\\w+\\s+){0,2}?(?:${PROMISE_VERBS})\\b.*)$`, "u");
/** Any verb after the name: only a person of the meeting, or I or we (Amendment 6). */
const COMMITMENT_ANY = new RegExp(`^(${COMMITMENT_NAME})\\s+(?:will|'ll|\u2019ll|is going to|are going to|am going to)\\s+(\\p{Ll}[\\p{L}-]*\\b.*)$`, "u");
const COMMITMENT_CONFIDENCE = 0.6;

/**
 * A key point or decision that is a commitment ("Priya will prepare the deed", "Omar to send the
 * form by Friday"; any verb when the name is a person of the meeting, or I or we with a speaker):
 * the task, titled by the verb phrase (up to "because", "since", "so that" or ";"), owned by that
 * person (I or we: the cited speaker), its quotes from the cited lines. Undefined for anything else.
 */
export function commitmentAction(text: string, cited: readonly TranscriptSegment[], people: ReadonlySet<string> = new Set()): QuotedCandidate | undefined {
  if (cited.length === 0) return undefined;
  const trimmed = text.trim();
  let match = COMMITMENT.exec(trimmed);
  let owner = match?.[1];
  const firstPerson = /^(I|We)\s/u.exec(trimmed)?.[1];
  if (match === null || owner === undefined || (FIND_MORE_NOT_NAMES as readonly string[]).includes(owner.split(/\s+/u)[0]!)) {
    const any = COMMITMENT_ANY.exec(trimmed);
    const name = any?.[1];
    if (any === null || name === undefined) return undefined;
    if (firstPerson !== undefined && name.split(/\s+/u)[0] === firstPerson) owner = cited[0]!.speaker;
    else if (!(FIND_MORE_NOT_NAMES as readonly string[]).includes(name.split(/\s+/u)[0]!) && isPerson(name, people)) owner = name;
    else return undefined;
    match = any;
  }
  const phrase = match[2]!.split(/\s+(?:because|since|so that)\s|;/u)[0]!.replace(/[.,\s]+$/u, "");
  const title = phrase.charAt(0).toUpperCase() + phrase.slice(1);
  const spoken = SPOKEN_WHEN.exec(trimmed)?.[0];
  return {
    type: "task.create",
    title: graphemes(title).slice(0, INTENT_LIMITS.maxTitle).join(""),
    body: trimmed,
    ...(spoken === undefined ? {} : { dueText: spoken }),
    assigneeHint: owner,
    recipients: [],
    confidence: COMMITMENT_CONFIDENCE,
    evidence: cited.map((segment) => quoteOf(segment, trimmed)),
  };
}

/**
 * A task's owner and title (Amendment 6): the owner is a speaker or a person of the meeting
 * ("client:" style prefixes removed), else empty; the title starts with a capital and a verb
 * (taken from a cited line where the owner says what they will do, if missing), else no task.
 */
export function taskShape(candidate: QuotedCandidate, people: ReadonlySet<string>): QuotedCandidate | undefined {
  if (candidate.type !== "task.create") return candidate;
  let owner = candidate.assigneeHint?.trim();
  if (owner !== undefined) {
    owner = owner.replace(new RegExp(`^(?:${FIND_MORE_ANSWER_WORDS.ownerPrefixes.join("|")})\\s*:\\s*`, "iu"), "").trim();
    if (owner === "" || !isPerson(owner, people)) owner = undefined;
  }
  let title = candidate.title.trim();
  const first = title.split(/\s+/u)[0]?.toLowerCase() ?? "";
  const verbs = FIND_MORE_ANSWER_WORDS.taskVerbs as readonly string[];
  if (!verbs.includes(first) && !verbs.some((verb) => verb.includes(" ") && title.toLowerCase().startsWith(`${verb} `))) {
    const who = owner === undefined ? "I" : `(?:I|${owner.split(/\s+/u)[0]})`;
    const said = candidate.evidence.map((item) => item.quote).join(" ");
    const verb = new RegExp(`\\b${who}\\s*(?:'ll|\u2019ll|\\s+will|\\s+am going to|\\s+is going to|\\s+can)\\s+(\\p{Ll}+)`, "u").exec(said)?.[1];
    if (verb === undefined || !verbs.includes(verb)) return undefined;
    title = `${verb} ${title.charAt(0).toLowerCase()}${title.slice(1)}`;
  }
  // A one-word title says nothing (Amendment 7).
  if (title.split(/\s+/u).filter((word) => word !== "").length < 2) return undefined;
  title = title.charAt(0).toUpperCase() + title.slice(1);
  return { ...candidate, title, assigneeHint: owner };
}
