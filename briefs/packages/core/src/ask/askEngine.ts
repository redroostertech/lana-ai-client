import type { MeetingRecord } from "../intent/meeting.js";
import { graphemes } from "../text/graphemes.js";
import { trimWhitespace } from "../text/whitespace.js";
import { SILENT_LOG, type HandoffLog } from "../handoff/log.js";
import { BackendError, throwIfAborted, type BackendAvailability, type UnavailableReason } from "./backend.js";
import { estimateTokens, PassageBuilder, type Passage } from "./passage.js";
import { PassageIndex } from "./passageIndex.js";
import { normalizeLabels } from "./passageLabel.js";

export const ASK_STATUSES = ["answered", "notFound", "suggested", "declined", "passagesOnly"] as const;
/**
 * `answered`: from the cited passages. `notFound`: the meetings do not cover it.
 * `suggested`: advice that may use general knowledge, always shown labelled as a
 * suggestion. `declined`: the model refused; passages are still shown.
 * `passagesOnly`: no model; best matching passages only.
 */
export type AskStatus = (typeof ASK_STATUSES)[number];

export interface AskAnswer {
  readonly status: AskStatus;
  /** Set for `passagesOnly`. */
  readonly reason?: UnavailableReason | undefined;
  /** Answer text; empty for `passagesOnly`. */
  readonly text: string;
  /** Passages the answer rests on, or the best matches when there is no answer. */
  readonly citations: readonly Passage[];
}

/** One question and the engine's answer, kept so follow-ups have context. */
export interface AskTurn {
  readonly question: string;
  readonly answer: AskAnswer;
}

export interface LabelledPassage {
  readonly label: string;
  readonly heading: string;
  readonly text: string;
}

/** What the engine sends a model: the question, labelled passages and recent turns. */
export interface AnswerRequest {
  readonly question: string;
  readonly passages: readonly LabelledPassage[];
  /** Earlier questions with shortened answers, oldest first. */
  readonly history: readonly { readonly question: string; readonly answer: string }[];
}

export type ModelAnswerKind = "fact" | "suggestion";

export interface ModelAnswer {
  readonly answerable: boolean;
  readonly answer: string;
  /** Passage labels such as `P2`. */
  readonly citations: readonly string[];
  readonly kind: ModelAnswerKind;
}

/**
 * The answer as it is being written, before it is checked. Replaced by the final
 * `AskAnswer`, which may differ (a fact the passages do not support is never kept).
 */
export interface AnswerDraft {
  /** Undefined until the model has said whether this is a fact or a suggestion. */
  readonly kind: ModelAnswerKind | undefined;
  readonly text: string;
}

export type AnswerDraftHandler = (draft: AnswerDraft) => void;

export interface AnswerOptions {
  readonly onDraft?: AnswerDraftHandler | undefined;
  readonly signal?: AbortSignal | undefined;
}

/** A language model that answers from supplied passages only. */
export interface AnswerBackend {
  readonly modelID: string;
  availability(): Promise<BackendAvailability>;
  /** Backends that cannot stream report nothing until they finish. */
  answer(request: AnswerRequest, options?: AnswerOptions): Promise<ModelAnswer>;
}

/** Tokens of passage text per question and the other limits (Swift `AskEngine.Budget`). */
export interface AskBudget {
  readonly passageTokens: number;
  readonly maxPassages: number;
  readonly historyTurns: number;
  readonly historyAnswerCharacters: number;
  readonly maxQuestionCharacters: number;
}

export const DEFAULT_ASK_BUDGET: AskBudget = {
  passageTokens: 1_900,
  maxPassages: 8,
  historyTurns: 3,
  historyAnswerCharacters: 360,
  maxQuestionCharacters: 500,
};

export interface AskOptions {
  readonly history?: readonly AskTurn[] | undefined;
  /** Passages the person chose to ask about (a clip); always read first. */
  readonly pinned?: readonly Passage[] | undefined;
  /** The answer as the model writes it. The returned answer is the checked one to keep. */
  readonly onDraft?: AnswerDraftHandler | undefined;
  readonly signal?: AbortSignal | undefined;
}

export interface AskEngineOptions {
  readonly budget?: Partial<AskBudget> | undefined;
  readonly log?: HandoffLog | undefined;
}

/** Swift `String(text.prefix(n))` over grapheme clusters. */
export function prefixCharacters(text: string, count: number): string {
  const characters = graphemes(text);
  return characters.length <= count ? text : characters.slice(0, count).join("");
}

export { trimWhitespace };

/**
 * Question answering over one or more meetings, entirely on this machine. Each question
 * is a fresh model session, so the engine retrieves the passages that matter, fits them
 * to a budget, carries a short history and verifies every citation the model returns.
 */
export class AskEngine {
  private readonly budget: AskBudget;
  private readonly log: HandoffLog;

  constructor(private readonly index: PassageIndex, private readonly backend: AnswerBackend, options: AskEngineOptions = {}) {
    this.budget = { ...DEFAULT_ASK_BUDGET, ...options.budget };
    this.log = options.log ?? SILENT_LOG;
  }

  /**
   * @param extraPassages history the caller knows about, such as action status changes
   *   ("created in Clio on Nov 2"), so questions about what happened later are answered.
   */
  static forMeetings(
    meetings: readonly MeetingRecord[], backend: AnswerBackend,
    options: AskEngineOptions & { readonly extraPassages?: readonly Passage[]; readonly builder?: PassageBuilder } = {},
  ): AskEngine {
    const builder = options.builder ?? new PassageBuilder();
    return new AskEngine(new PassageIndex([...meetings.flatMap((meeting) => builder.passages(meeting)), ...(options.extraPassages ?? [])]), backend, options);
  }

  async ask(rawQuestion: string, options: AskOptions = {}): Promise<AskAnswer> {
    const history = options.history ?? [];
    const pinned = options.pinned ?? [];
    const question = prefixCharacters(trimWhitespace(rawQuestion), this.budget.maxQuestionCharacters);
    if (question.length === 0) return { status: "notFound", text: "", citations: [] };

    // Follow-ups like "and when is it due?" carry few terms; borrow the last question's.
    const recent = history.slice(Math.max(0, history.length - this.budget.historyTurns));
    const retrievalQuery = [question, ...recent.slice(-1).map((turn) => turn.question)].join(" ");
    const availability = await this.backend.availability();
    if (!availability.available) {
      // No model to read with: show the best word matches themselves.
      const found = this.index.search(retrievalQuery, this.budget.maxPassages * 2).map((hit) => hit.passage).filter((passage) => !overlaps(passage, pinned));
      const matches = this.select([...pinned, ...found]);
      return { status: "passagesOnly", reason: availability.reason, text: "", citations: matches.slice(0, 3) };
    }
    const selected = this.withPinned(pinned, this.context(retrievalQuery));
    if (selected.length === 0) return { status: "notFound", text: "", citations: [] };

    const pinnedIDs = new Set(pinned.map((passage) => passage.id));
    const multipleMeetings = new Set(selected.map((passage) => passage.meetingID)).size > 1;
    const labelled: LabelledPassage[] = selected.map((passage, offset) => {
      const heading = passageHeading(passage, multipleMeetings);
      return {
        label: `P${offset + 1}`,
        heading: pinnedIDs.has(passage.id) ? `${heading}, the part the person is asking about` : heading,
        text: passage.text,
      };
    });
    const request: AnswerRequest = {
      question,
      passages: labelled,
      history: recent.map((turn) => ({ question: turn.question, answer: prefixCharacters(turn.answer.text, this.budget.historyAnswerCharacters) })),
    };

    let model: ModelAnswer;
    try {
      throwIfAborted(options.signal);
      model = await this.backend.answer(request, { onDraft: options.onDraft, signal: options.signal });
    } catch (error) {
      if (error instanceof BackendError && error.isRetryableWithReformulation) {
        return { status: "declined", text: "", citations: selected.slice(0, 3) };
      }
      throw error;
    }

    // Only labels we actually supplied count; anything else is a hallucinated citation.
    const byLabel = new Map(labelled.map((passage, offset) => [passage.label, selected[offset]!]));
    const seen = new Set<string>();
    const cited: Passage[] = [];
    for (const label of normalizeLabels(model.citations)) {
      const passage = byLabel.get(label);
      if (passage === undefined || seen.has(passage.id)) continue;
      seen.add(passage.id);
      cited.push(passage);
    }
    const text = trimWhitespace(model.answer);
    if (model.kind === "suggestion" && model.answerable && text.length > 0) {
      // Advice may go beyond what was said; it is always shown labelled as a suggestion.
      return { status: "suggested", text, citations: cited };
    }
    if (!model.answerable || text.length === 0 || cited.length === 0) {
      // Counts only: never the question, the answer or the passages.
      this.log.notice("ask.not_found", {
        answerable: model.answerable, text: text.length > 0, labels: model.citations.length, verified: cited.length, passages: labelled.length,
      });
      return { status: "notFound", text: "", citations: [] };
    }
    return { status: "answered", text, citations: cited };
  }

  /**
   * The passages the model reads. A meeting that fits the budget is read whole, so a
   * broad question works even when it shares no words with the transcript. Otherwise the
   * best word matches; and when nothing matches, the key points and actions.
   */
  private context(query: string): Passage[] {
    // Meetings oldest first; within a meeting, the order the builder wrote them.
    const everything = this.index.all
      .map((passage, offset) => ({ passage, offset }))
      .sort((a, b) => (a.passage.meetingDate.getTime() - b.passage.meetingDate.getTime()) || (a.offset - b.offset))
      .map((entry) => entry.passage);
    const cost = everything.reduce((sum, passage) => sum + passageCost(passage), 0);
    if (cost <= this.budget.passageTokens) return everything;
    const ranked = this.select(this.index.search(query, this.budget.maxPassages * 2).map((hit) => hit.passage));
    if (ranked.length > 0) return ranked;
    return this.select(everything.filter((passage) => passage.kind === "keyPoint" || passage.kind === "action"));
  }

  /** The pinned passages first, then the rest that does not repeat them, within the budget. */
  private withPinned(pinned: readonly Passage[], context: readonly Passage[]): Passage[] {
    if (pinned.length === 0) return [...context];
    let spent = 0;
    const result: Passage[] = [];
    for (const passage of [...pinned, ...context.filter((candidate) => !overlaps(candidate, pinned))]) {
      const cost = passageCost(passage);
      if (result.length > 0 && spent + cost > this.budget.passageTokens) continue;
      spent += cost;
      result.push(passage);
    }
    return result;
  }

  /** Keeps passages in score order until the token budget is spent. */
  private select(ranked: readonly Passage[]): Passage[] {
    let used = 0;
    const chosen: Passage[] = [];
    for (const passage of ranked) {
      const cost = passageCost(passage);
      if (used + cost > this.budget.passageTokens) continue;
      used += cost;
      chosen.push(passage);
      if (chosen.length === this.budget.maxPassages) break;
    }
    return chosen;
  }
}

/** A transcript passage the pinned clip already covers. */
function overlaps(passage: Passage, pinned: readonly Passage[]): boolean {
  return pinned.some((clip) => clip.id === passage.id
    || (clip.kind === "transcript" && passage.kind === "transcript" && passage.start >= clip.start && passage.end <= clip.end));
}

function passageCost(passage: Passage): number {
  return estimateTokens(passage.text) + 12;
}

export function passageHeading(passage: Passage, multipleMeetings: boolean): string {
  let place: string;
  switch (passage.kind) {
    case "transcript":
      place = `transcript ${clock(passage.start)} to ${clock(passage.end)}`;
      break;
    case "keyPoint":
      place = `AI note from ${clock(passage.start)}`;
      break;
    case "userNote":
      place = passage.start > 0 ? `the lawyer's own note at ${clock(passage.start)}` : "the lawyer's own note";
      break;
    case "action":
      place = `action from ${clock(passage.start)}`;
      break;
  }
  return multipleMeetings ? `${passage.meetingTitle}, ${place}` : place;
}

/** `m:ss`, or `h:mm:ss` from an hour. */
export function clock(seconds: number): string {
  const total = Math.max(0, Math.trunc(seconds));
  const two = (value: number): string => String(value).padStart(2, "0");
  return total >= 3_600
    ? `${Math.floor(total / 3_600)}:${two(Math.floor((total % 3_600) / 60))}:${two(total % 60)}`
    : `${Math.floor(total / 60)}:${two(total % 60)}`;
}
