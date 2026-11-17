import type { LanaId } from "../ids/lanaId.js";
import type { Intent } from "../intent/intent.js";
import type { KeyPoint } from "../intent/keyPoint.js";
import type { MeetingNotes } from "../intent/meetingParts.js";
import { titleOf } from "../intent/params.js";
import { loadVocabulary } from "../gateway/vocabularySettings.js";
import type { GatewayStore } from "../store/gatewayStore.js";
import type { FindMoreSuggestion } from "../summarizer/findMore.js";
import { buildMeetingState, type MeetingState } from "./meetingState.js";

/**
 * Who proposes a change: LANA's notes, a person (taken as given), Find more, or a clip draft (a
 * person asked, LANA drafted: checked like LANA's).
 */
export type ChangeOrigin = "model" | "person" | "find_more" | "clip";

/** A change to a meeting, written through the shared record (or the local suggestion lists). */
export type MeetingChange =
  /** Key points to add (a person's are taken as given; LANA's and Find more's are checked). */
  | { readonly kind: "addKeyPoints"; readonly points: readonly KeyPoint[] }
  /** One action made here (a clip draft): to the Inbox and the record. */
  | { readonly kind: "addAction"; readonly intent: Intent }
  | { readonly kind: "editKeyPoint"; readonly pointID: string; readonly text: string }
  | { readonly kind: "removeKeyPoint"; readonly pointID: string }
  /** A Find more run's result: suggestions wait for the person. */
  | { readonly kind: "suggest"; readonly suggestions: readonly FindMoreSuggestion[] }
  | { readonly kind: "acceptSuggestions"; readonly suggestionIDs: readonly string[] }
  | { readonly kind: "dismissSuggestions"; readonly suggestionIDs: readonly string[] }
  /** LANA's notes for a meeting recorded here (written or written again), with their actions. */
  | { readonly kind: "notes"; readonly notes: MeetingNotes; readonly intents: readonly Intent[]; readonly notesModel: string };

export interface ProposeResult {
  readonly state: MeetingState;
  /** Items written. */
  readonly applied: number;
  /** Items the shared checks left out (set aside, no citation, a repeat, or something the person rejected). */
  readonly dropped: number;
}

type StateStore = Pick<GatewayStore, "shared" | "intents" | "findMore" | "settings" | "local">;

/**
 * Meeting states over the gateway store: `load` builds the snapshot every AI step reads, and
 * `propose` is the one write path. It applies the shared checks, then writes through the
 * existing paths (store.shared.edit and addAction for the record, so sync and conflicts work
 * as before; the sealed local lists for Find more). Never calls a model.
 */
export class MeetingStates {
  constructor(private readonly store: StateStore) {}

  load(id: LanaId): MeetingState {
    const local = this.store.findMore.state(id);
    const actions = this.store.intents.list({ meetingID: id }).map((stored) => stored.intent);
    // A dismissal by LANA itself (the notes written again) is not the person rejecting the action.
    const systemDismissed = new Set(actions.filter((intent) => intent.status === "dismissed" && this.store.intents.history(intent.id).at(-1)?.actor === "system").map((intent) => intent.id));
    return buildMeetingState({
      record: this.store.shared.current(id),
      actions,
      systemDismissed,
      vocabulary: loadVocabulary(this.store.settings).map((entry) => entry.term),
      waiting: local.suggestions,
      dismissed: local.dismissed,
      removed: local.removed,
    });
  }

  propose(id: LanaId, changes: readonly MeetingChange[], origin: ChangeOrigin): ProposeResult {
    let applied = 0;
    let dropped = 0;
    for (const change of changes) {
      const state = this.load(id);
      switch (change.kind) {
        case "addKeyPoints": {
          const kept = change.points.filter((point) => passes(state, point.sources, point.text, point.kind, origin));
          dropped += change.points.length - kept.length;
          // A point with the id of one already there replaces it (a clip's decision added again).
          const ids = new Set(kept.map((point) => point.id));
          if (kept.length > 0) this.store.shared.edit(id, (record) => ({ ...record, notes: { ...record.notes, keyPoints: [...record.notes.keyPoints.filter((point) => !ids.has(point.id)), ...kept] } }));
          applied += kept.length;
          break;
        }
        case "addAction": {
          const spans = change.intent.evidence.map((item) => ({ start: item.tStart, end: item.tEnd }));
          if (!passes(state, spans, titleOf(change.intent.params), "task", origin, change.intent)) {
            dropped += 1;
            break;
          }
          this.store.shared.addAction(id, change.intent);
          applied += 1;
          break;
        }
        case "editKeyPoint": {
          if (!state.keyPoints.some((point) => point.id === change.pointID)) {
            dropped += 1;
            break;
          }
          this.store.shared.edit(id, (record) => ({ ...record, notes: { ...record.notes, keyPoints: record.notes.keyPoints.map((point) => (point.id === change.pointID ? { ...point, text: change.text } : point)) } }));
          applied += 1;
          break;
        }
        case "removeKeyPoint":
          if (this.store.findMore.removeKeyPoint(id, change.pointID)) applied += 1;
          else dropped += 1;
          break;
        case "suggest": {
          const kept = change.suggestions.filter((item) => item.sources.every((span) => state.isVisible(span.start, span.end)));
          dropped += change.suggestions.length - kept.length;
          this.store.findMore.saveRun(id, kept);
          applied += kept.length;
          break;
        }
        case "acceptSuggestions":
          applied += this.store.findMore.add(id, change.suggestionIDs);
          break;
        case "dismissSuggestions":
          applied += this.store.findMore.dismiss(id, change.suggestionIDs);
          break;
        case "notes": {
          // A rewrite never brings back what the person removed or dismissed.
          const keyPoints = change.notes.keyPoints.filter((point) => !state.isRejected(point.text, point.kind));
          const intents = change.intents.filter((intent) => !state.isRejected(titleOf(intent.params), "task", intent));
          dropped += change.notes.keyPoints.length - keyPoints.length + change.intents.length - intents.length;
          applied += keyPoints.length + this.store.local.applyNotes(id, { ...change.notes, keyPoints }, intents, change.notesModel).length;
          break;
        }
      }
    }
    return { state: this.load(id), applied, dropped };
  }
}

/**
 * The shared checks for an added item: cited, every span outside the set-aside parts, and unless
 * a person wrote it as given, not a repeat and not something the person removed or dismissed.
 */
function passes(state: MeetingState, spans: readonly { start: number; end: number }[], text: string, kind: KeyPoint["kind"] | "task", origin: ChangeOrigin, intent?: Intent): boolean {
  if (spans.length === 0 || !spans.every((span) => state.isVisible(span.start, span.end))) return false;
  if (origin === "person") return true;
  // A clip's action is the person asking for a task from those lines: it may restate a key point
  // (a question's follow-up does), so only another action or a rejected one counts against it.
  if (origin === "clip" && intent !== undefined) return !state.repeatsAction(intent) && !state.isRejected(text, kind, intent);
  const options = intent === undefined ? {} : { intent };
  return !state.isRepeat(text, kind, options) && !state.isRejected(text, kind, intent);
}
