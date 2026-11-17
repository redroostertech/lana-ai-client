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
import { covered, knownNear, knownText, NOT_NAMES, type KnownItem, type SuggestionKind } from "../state/known.js";
import type { MeetingState } from "../state/meetingState.js";
import { INTENT_LIMITS } from "../intent/validator.js";
import { groundQuotes } from "./evidenceGrounder.js";
import { stems, verifiedLines } from "./lineMatcher.js";
import { checkDueYear, checkYears } from "./yearCheck.js";
import { namesForLabels } from "./labelNames.js";
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
/** Suggested questions go through the open question check this many to a call (as in the notes). */
const MAX_CHECKED_QUESTIONS = 6;
export const FIND_MORE_RULES = "These notes were written once already. Find what they missed in this transcript part: "
  + "specifics (amounts, dates, names, reasons, risks), commitments and open questions. "
  + "Never repeat or reword an item listed under Already in the notes. "
  + "Write a question only when no line in this part answers it. "
  + "Write no SUMMARY line and no ASIDE line. If nothing is missing, reply NONE.";

export type { SuggestionKind } from "../state/known.js";
/** An item the notes already hold (or a dismissed suggestion): listed in the prompt and never suggested again. */
export type FindMoreKnown = KnownItem;

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
  /** The meeting as every step sees it: visible lines, known items, repeats, people, set-aside parts. */
  readonly state: MeetingState;
  readonly now: Date;
  /** Spoken due dates resolve against it. Defaults to the meeting's start. */
  readonly meetingStart?: Date;
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

/** Known items for one part: within 60 s of it, in time order, at most 30 (the meeting state rule). */
export function knownForChunk(chunk: TranscriptChunk, items: readonly FindMoreKnown[]): FindMoreKnown[] {
  return knownNear(items, chunkStart(chunk), chunkEnd(chunk));
}

/** Words that start a sentence but never name the person who commits (the meeting state list). */
export const FIND_MORE_NOT_NAMES = NOT_NAMES;

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
    const { state } = options;
    // The visible lines (set-aside parts and blank lines left out) are what the model reads.
    const visible: TranscriptSegment[] = state.visibleTranscript.map(({ index: _index, ...segment }) => segment);
    const chunks = this.chunker.chunk(visible);
    const people = state.people;
    const outside = (start: number, end: number) => state.isVisible(start, end);
    const found: Array<Found> = [];
    let skipped = 0;
    const start = options.meetingStart ?? state.startedAt;
    const nextID = options.suggestionID ?? (() => `more-${Math.random().toString(16).slice(2, 10)}`);
    for (const chunk of chunks) {
      throwIfAborted(options.signal);
      const extraction = await this.extract(chunk, state.known(chunkStart(chunk), chunkEnd(chunk)), options);
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
        // Years the cited lines never said (Amendment 8).
        const checkedText = checkYears(text, cited.map((line) => line.text).join(" "), start);
        if (checkedText === undefined) continue;
        const kind = checkedKind(point.kind, checkedText);
        const decided = kind === "decision" && point.decidedBy !== undefined ? { decidedBy: point.decidedBy } : {};
        found.push({ id: nextID(), kind, text: namesForLabels(checkedText, state.speakers), sources, precision: "exact", chunk: chunk.index, ...decided });
      }
      for (const raw of candidates) {
        const shaped = taskShape(finishCandidate(raw, state.speakers, start), people, state.nameForms);
        // Years the cited lines never said (Amendment 8): fixed in a date, else no task; the due date in the year said or nearest the meeting.
        const quotes = shaped === undefined ? "" : shaped.evidence.map((item) => item.quote).join(" ");
        const titleChecked = shaped === undefined ? undefined : checkYears(shaped.title, quotes, start);
        // Speaker labels become names in the title, detail and owner (Amendment 9).
        const named = (value: string | undefined) => (value === undefined ? undefined : namesForLabels(value, state.speakers));
        const candidate = shaped === undefined || titleChecked === undefined ? undefined
          : {
            ...shaped, title: namesForLabels(titleChecked, state.speakers), body: named(shaped.body) ?? shaped.body, assigneeHint: named(shaped.assigneeHint),
            ...(shaped.dueDate === undefined ? {} : { dueDate: checkDueYear(shaped.dueDate, quotes, start) }),
          };
        if (candidate === undefined) continue;
        const grounding = groundQuotes(candidate.evidence, chunk.segments, state.speakers);
        const result = assembleIntent(candidate, grounding, state.id, options.now, options.intentID?.() ?? makeLanaId("intent", options.now));
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
    const plan = planQuestionCheck(drafts, transcript, options.state.speakers, this.backend.tokenCounter ?? HEURISTIC_TOKENS, MAX_CHECKED_QUESTIONS);
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
      if (!next.sources.every((span) => options.state.isVisible(span.start, span.end))) continue;
      // The question stays with its answer, so the key point reads on its own (Amendment 5).
      const written = answeredText(item.text, next.text);
      const text = written === undefined ? undefined : namesForLabels(written, options.state.speakers);
      if (text === undefined) continue;
      out.push({ id: nextID(), kind: "summary", text, answer: next.text.trim(), sources: unionSpans(item.sources, next.sources), precision: "exact", chunk: item.chunk });
    }
    return out;
  }

  /**
   * Whether it repeats the meeting (the state's shared rule: notes, actions, waiting, dismissed
   * and removed suggestions) or an earlier suggestion of this run (the same rules).
   */
  private repeats(suggestion: Found, options: FindMoreOptions, earlier: readonly Found[]): boolean {
    const compareText = suggestion.answer ?? suggestion.text;
    if (options.state.isRepeat(suggestion.text, suggestion.kind, { compareText, ...(suggestion.intent === undefined ? {} : { intent: suggestion.intent }) })) return true;
    if (covered(compareText, earlier.map((item) => item.text))) return true;
    const similarText = (left: string, right: string, threshold: number) => textSimilarity(left, right) >= threshold;
    if (suggestion.kind === "task") return earlier.some((item) => item.intent !== undefined && isDuplicate(item.intent, suggestion.intent!, this.limits));
    return earlier.some((item) => item.kind === suggestion.kind && similarText(item.text, suggestion.text, this.limits.noteSimilarityThreshold));
  }

  /** One part, retried once with the neutral phrasing when the model declines; undefined when it fails. */
  private async extract(chunk: TranscriptChunk, known: readonly FindMoreKnown[], options: FindMoreOptions): Promise<ChunkExtraction | undefined> {
    for (const phrasing of ["standard", "neutralReformulation"] as ChunkPhrasing[]) {
      throwIfAborted(options.signal);
      try {
        const vocabulary = options.state.vocabulary;
        const speakers = options.state.speakers;
        const request: FindMoreRequest = vocabulary.length === 0 ? { chunk, speakers, phrasing, known } : { chunk, speakers, phrasing, known, vocabulary };
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
  /** Words between a verb and a name that add no object ("check with Leila"). */
  nameJoiners: ["with", "to", "for", "and", "the", "a", "an", "on", "up"],
  /** Verbs whose object is the person (Amendment 8): "Call Dana" is a task, "Check Omar" is not. */
  contactVerbs: ["call", "email", "e-mail", "text", "message", "phone", "meet", "ask", "tell", "remind", "contact", "notify", "thank", "invite", "visit", "pay"],
  /** A stand-alone answer may not start with one of these (Amendment 7): it needs its question. */
  leadingWords: ["i", "you", "he", "she", "it", "we", "they", "them", "this", "that", "these", "those", "but", "and", "so", "because", "also"],
  /** After a wh-word these start a subject, so the line is not a real question ("When the decision will be made"). */
  subjectStarts: ["the", "a", "an", "this", "that", "these", "those", "his", "her", "their", "our", "my", "your", "its", "he", "she", "they", "we", "i", "you", "it"],
  taskVerbs: [...PROMISE_VERBS.split("|"), "ask", "arrange", "bring", "collect", "complete", "contact", "decide", "discuss", "find", "gather", "line up", "list", "meet", "notify", "obtain", "open", "order", "pay", "publish", "redo", "request", "return", "set", "sign", "submit", "talk", "tell", "transfer", "assign", "deed", "fund", "hire", "keep", "let", "make", "mail", "print", "register", "renew", "research", "sell", "buy", "verify", "visit"],
} as const;

const MAX_ANSWERED_CHARACTERS = 300;
const ALONE_MIN_WORDS = 6;


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
  if (match === null || owner === undefined || (NOT_NAMES as readonly string[]).includes(owner.split(/\s+/u)[0]!)) {
    const any = COMMITMENT_ANY.exec(trimmed);
    const name = any?.[1];
    if (any === null || name === undefined) return undefined;
    if (firstPerson !== undefined && name.split(/\s+/u)[0] === firstPerson) owner = cited[0]!.speaker;
    else if (!(NOT_NAMES as readonly string[]).includes(name.split(/\s+/u)[0]!) && isPerson(name, people)) owner = name;
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
export function taskShape(candidate: QuotedCandidate, people: ReadonlySet<string>, nameForms: ReadonlyMap<string, string> = new Map()): QuotedCandidate | undefined {
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
    // A person's name keeps its capital (Amendment 8); any other first word goes lowercase after the verb.
    const firstWord = title.split(/\s+/u)[0] ?? "";
    title = people.has(firstWord.toLowerCase()) ? `${verb} ${title}` : `${verb} ${title.charAt(0).toLowerCase()}${title.slice(1)}`;
  }
  // A one-word title says nothing (Amendment 7).
  if (title.split(/\s+/u).filter((word) => word !== "").length < 2) return undefined;
  // Names as the meeting writes them (Amendment 8).
  title = title.split(/(\s+)/u).map((word) => {
    const bare = word.replace(/[.,;:!?]+$/u, "");
    const form = people.has(bare.toLowerCase()) ? (nameForms.get(bare.toLowerCase()) ?? `${bare.charAt(0).toUpperCase()}${bare.slice(1)}`) : bare;
    return form + word.slice(bare.length);
  }).join("");
  title = title.charAt(0).toUpperCase() + title.slice(1);
  // Verb plus only names, with no object ("Check Omar", "Check with Leila"), says nothing, unless the verb is reaching the person (Amendment 8).
  const words = title.toLowerCase().replace(/[.,;:!?]/gu, "").split(/\s+/u).filter((word) => word !== "");
  const rest = words.slice(1).filter((word) => !(FIND_MORE_ANSWER_WORDS.nameJoiners as readonly string[]).includes(word));
  if (rest.length > 0 && rest.every((word) => people.has(word)) && !(FIND_MORE_ANSWER_WORDS.contactVerbs as readonly string[]).includes(words[0]!)) return undefined;
  return { ...candidate, title, assigneeHint: owner };
}
