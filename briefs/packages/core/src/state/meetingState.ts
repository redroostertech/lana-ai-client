import type { LanaId } from "../ids/lanaId.js";
import type { Intent } from "../intent/intent.js";
import type { KeyPoint, KeyPointKind, SourceSpan } from "../intent/keyPoint.js";
import type { MeetingRecord } from "../intent/meeting.js";
import { overlapsSetAside, segmentSetAside, type NotesTable, type SetAsidePart, type Speaker, type TranscriptSegment } from "../intent/meetingParts.js";
import { titleOf } from "../intent/params.js";
import type { UserNote } from "../intent/userNote.js";
import { DEFAULT_SUMMARY_LIMITS, isDuplicate, type SummaryLimits } from "../summarizer/summaryReducer.js";
import type { FindMoreSuggestion } from "../summarizer/findMore.js";
import { textSimilarity } from "../summarizer/textNormalizer.js";
import { covered, knownNear, meetingNameForms, meetingPeople, type KnownItem, type SuggestionKind } from "./known.js";

/** Who wrote a key point, from its id: an added Find more suggestion, a person's clip, else LANA's notes. */
export type ItemOrigin = "model" | "person" | "find_more";

export interface StateKeyPoint extends KeyPoint {
  readonly origin: ItemOrigin;
}

/** A line of the transcript with its index, as every step reads it. */
export interface VisibleLine extends TranscriptSegment {
  readonly index: number;
}

/** What a meeting state is built from (the store loader fills it; tests pass it directly). */
export interface MeetingStateInput {
  readonly record: MeetingRecord;
  /** Every action of the meeting in the store, dismissed ones included. */
  readonly actions: readonly Intent[];
  readonly vocabulary: readonly string[];
  readonly waiting: readonly FindMoreSuggestion[];
  readonly dismissed: readonly KnownItem[];
  /** Key points the person removed on this computer. */
  readonly removed: readonly KnownItem[];
  /** Ids of dismissed actions LANA put away itself (writing the notes again), not the person: never "rejected". */
  readonly systemDismissed?: ReadonlySet<string>;
  readonly limits?: SummaryLimits;
}

/**
 * One meeting as every AI step sees it (meeting state contract, scratchpad/meeting-state/contract.md):
 * a read-only snapshot plus the derived views the steps share. Never calls a model. `version`
 * changes whenever the record's clocks or the local suggestion lists change.
 */
export interface MeetingState {
  readonly id: LanaId;
  readonly version: string;
  readonly title: string;
  readonly startedAt: Date;
  readonly speakers: readonly Speaker[];
  readonly transcript: readonly TranscriptSegment[];
  readonly vocabulary: readonly string[];
  readonly setAside: readonly SetAsidePart[];
  /** Lines with words outside every set-aside part, with their index. */
  readonly visibleTranscript: readonly VisibleLine[];
  readonly keyPoints: readonly StateKeyPoint[];
  readonly tables: readonly NotesTable[];
  readonly userNotes: readonly UserNote[];
  /** The record's actions (as the phone sees them). */
  readonly recordActions: readonly Intent[];
  /** Actions in the store that are not dismissed. */
  readonly actions: readonly Intent[];
  /** Actions the person dismissed (LANA's own put-aways on a rewrite are not counted). */
  readonly dismissedActions: readonly Intent[];
  readonly waiting: readonly FindMoreSuggestion[];
  readonly dismissed: readonly KnownItem[];
  readonly removed: readonly KnownItem[];
  readonly notesModel: string;
  /** People of the meeting, lowercased (speaker names and names said in the lines). */
  readonly people: ReadonlySet<string>;
  /** How the meeting writes each person's name (lowercased key, written form). */
  readonly nameForms: ReadonlyMap<string, string>;
  /** Everything already known: key points, actions, waiting, dismissed and removed suggestions. */
  readonly knownItems: readonly KnownItem[];
  /** Known items near a stretch, for a prompt (within 60 s, time order, at most 30). */
  known(start: number, end: number): KnownItem[];
  /** Whether a stretch is outside every set-aside part (overlap of more than half a second counts as inside). */
  isVisible(start: number, end: number): boolean;
  /** Whether a text repeats what is known (contract rules). `compareText` is used for the rewording rule when given. */
  isRepeat(text: string, kind: SuggestionKind, options?: { readonly intent?: Intent; readonly compareText?: string }): boolean;
  /** Whether an action repeats one the meeting has (the reducer's duplicate rule) or a task suggestion (title similarity). */
  repeatsAction(intent: Intent): boolean;
  /** Whether a text matches something the person removed or dismissed: a rewrite of the notes never brings it back. */
  isRejected(text: string, kind: SuggestionKind, intent?: Intent): boolean;
}

const KEY_POINT_KINDS_TEXT: Record<KeyPointKind, true> = { summary: true, decision: true, open_question: true };

function originOf(point: KeyPoint): ItemOrigin {
  if (point.id.startsWith("kp-more-")) return "find_more";
  if (point.id.startsWith("kp-clip-")) return "person";
  return "model";
}

function actionKnown(intent: Intent): KnownItem {
  return { kind: "task", text: titleOf(intent.params), sources: intent.evidence.map((item) => ({ start: item.tStart, end: item.tEnd })) };
}

function suggestionKnown(item: FindMoreSuggestion): KnownItem {
  return { kind: item.kind, text: item.text, sources: item.sources };
}

/** The visible view every step shares: set-aside parts, the lines outside them (with words), and the span test. */
export interface VisibleView {
  readonly setAside: readonly SetAsidePart[];
  readonly visibleTranscript: readonly VisibleLine[];
  isVisible(start: number, end: number): boolean;
}

/** The visible view of a record (Ask, Talk, exports and the state all use this one rule). */
export function visibleView(record: Pick<MeetingRecord, "transcript" | "notes">): VisibleView {
  const setAside = record.notes.setAside ?? [];
  return {
    setAside,
    visibleTranscript: record.transcript.flatMap((segment, index) => (segment.text.trim() !== "" && !segmentSetAside(segment, setAside) ? [{ ...segment, index }] : [])),
    isVisible: (start, end) => !overlapsSetAside(start, end, setAside, 0.5),
  };
}

/** A meeting state from its parts (pure: the same input always gives the same state). */
export function buildMeetingState(input: MeetingStateInput): MeetingState {
  const { record } = input;
  const limits = input.limits ?? DEFAULT_SUMMARY_LIMITS;
  const view = visibleView(record);
  const setAside = view.setAside;
  const visibleTranscript = view.visibleTranscript;
  const keyPoints = record.notes.keyPoints.map((point) => ({ ...point, origin: originOf(point) }));
  const actions = input.actions.filter((intent) => intent.status !== "dismissed");
  const dismissedActions = input.actions.filter((intent) => intent.status === "dismissed" && !(input.systemDismissed?.has(intent.id) ?? false));
  // The order matters for prompts: key points, actions, then the suggestion lists (as Find more always listed them).
  const knownItems: KnownItem[] = [
    ...record.notes.keyPoints.map((point) => ({ kind: point.kind as SuggestionKind, text: point.text, sources: point.sources })),
    ...actions.map(actionKnown),
    ...input.dismissed,
    ...input.waiting.map(suggestionKnown),
    ...input.removed,
  ];
  const suggestionLists: KnownItem[] = [...input.dismissed, ...input.waiting.map(suggestionKnown), ...input.removed];
  const knownTexts = [...record.notes.keyPoints.map((point) => point.text), ...actions.map((intent) => titleOf(intent.params)), ...suggestionLists.map((item) => item.text)];
  const rejected: KnownItem[] = [...input.dismissed, ...input.removed];
  const similar = (left: string, right: string, threshold: number) => textSimilarity(left, right) >= threshold;
  const version = stateVersion(record, input);
  return {
    id: record.id,
    version,
    title: record.title,
    startedAt: record.startedAt,
    speakers: record.speakers,
    transcript: record.transcript,
    vocabulary: input.vocabulary,
    setAside,
    visibleTranscript,
    keyPoints,
    tables: record.notes.tables ?? [],
    userNotes: record.userNotes,
    recordActions: record.intents,
    actions,
    dismissedActions,
    waiting: input.waiting,
    dismissed: input.dismissed,
    removed: input.removed,
    notesModel: record.provenance.notesModel,
    people: meetingPeople(record.speakers, record.transcript),
    nameForms: meetingNameForms(record.speakers, record.transcript),
    knownItems,
    known: (start, end) => knownNear(knownItems, start, end),
    isVisible: view.isVisible,
    isRepeat(text, kind, options = {}) {
      if (covered(options.compareText ?? text, knownTexts)) return true;
      if (kind === "task") {
        const intent = options.intent;
        if (intent !== undefined && actions.some((action) => isDuplicate(action, intent, limits))) return true;
        return suggestionLists.some((item) => item.kind === "task" && similar(item.text, text, limits.titleSimilarityThreshold));
      }
      const threshold = limits.noteSimilarityThreshold;
      return record.notes.keyPoints.some((point) => point.kind === kind && similar(point.text, text, threshold))
        || suggestionLists.some((item) => item.kind === kind && similar(item.text, text, threshold));
    },
    repeatsAction(intent) {
      return actions.some((action) => isDuplicate(action, intent, limits))
        || suggestionLists.some((item) => item.kind === "task" && similar(item.text, titleOf(intent.params), limits.titleSimilarityThreshold));
    },
    isRejected(text, kind, intent) {
      if (kind === "task" && intent !== undefined && dismissedActions.some((action) => isDuplicate(action, intent, limits))) return true;
      const threshold = kind === "task" ? limits.titleSimilarityThreshold : limits.noteSimilarityThreshold;
      if (rejected.some((item) => item.kind === kind && similar(item.text, text, threshold))) return true;
      return covered(text, rejected.filter((item) => (item.kind === "task") === (kind === "task")).map((item) => item.text));
    },
  };
}

/** The record's unit clocks and the local lists, as a short stable string. */
function stateVersion(record: MeetingRecord, input: MeetingStateInput): string {
  const clocks = Object.entries(record.sync?.clock ?? {}).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([unit, clock]) => `${unit}:${clock.phone}.${clock.desktop}`).join(",");
  const local = `${input.waiting.length}/${input.dismissed.length}/${input.removed.length}/${input.actions.map((intent) => `${intent.id}:${intent.status}`).join(",")}`;
  let hash = 2166136261;
  for (const character of `${clocks}|${local}`) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619) >>> 0;
  return hash.toString(16).padStart(8, "0");
}

export function isKeyPointKind(kind: SuggestionKind): kind is KeyPointKind {
  return kind in KEY_POINT_KINDS_TEXT;
}

export type { SourceSpan };
