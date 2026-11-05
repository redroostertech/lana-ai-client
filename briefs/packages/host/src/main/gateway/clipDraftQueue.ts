import type { LanaId } from "@lana/core/ids";
import {
  addingDecision, clipDecision, clipFallbackAction, clipIntent, clipIntentIssues, clipQuestionFallbackAction, linesBetween, transcriptClip,
  type CandidateIntent, type Intent, type MeetingRecord, type Speaker, type TranscriptSegment,
} from "@lana/core/intent";
import type { ClipDrafter } from "@lana/core/runtime";
import type { ClipDraftRequest, GatewayStore, StoredClipDraft } from "@lana/core/store";
import { randomUUID } from "node:crypto";
import type { DraftCard, DraftState } from "../../shared/api.js";
import type { MainLog } from "../log.js";
import type { DraftDiagnosticsSink } from "../services/draftDiagnostics.js";

/** What drafts actions, decisions and open questions' follow-up tasks (core `ClipDrafter`). */
export type ClipDrafting = Pick<ClipDrafter, "action" | "decision" | "questionAction">;

/** The starting point for a decision LANA could not draft: the clip's words. */
const MAX_DECISION_START = 600;

/** Statuses that keep an action's draft open: the card is still waiting for the person. */
const OPEN_INTENT_STATUSES = new Set(["proposed", "transferred", "resolved", "failed"]);

export interface ClipDraftQueueDependencies {
  readonly store: Pick<GatewayStore, "clipDrafts" | "shared" | "intents">;
  readonly log: MainLog;
  /** A meeting changed (a draft queued, started, finished or was cancelled). */
  readonly onMeetingChanged: (meetingID: LanaId) => void;
  /** The Inbox count may have changed. */
  readonly onInboxChanged: () => void;
  readonly now?: () => Date;
}

/**
 * LANA's background drafts (clip.draft.v1): queued in the store so
 * they survive a restart, drafted one at a time on the shared model, and settled in the
 * Inbox. An action becomes a proposed action card (the starting point when LANA could not
 * draft it); a decision waits on its draft card for the person to add it. Nothing is added
 * to the meeting or run without the person. Owned by the main process, so leaving the page
 * never stops a draft. Logs and audit carry ids and states only.
 */
export class ClipDraftQueue {
  private drafter: ClipDrafting | null = null;
  /** The opt-in drafting diagnostic (`LANA_DRAFT_DIAGNOSTICS=1`): how each draft settled, sizes and states only. */
  private diagnostics: Pick<DraftDiagnosticsSink, "outcome"> | null = null;
  private running: { readonly id: string; readonly controller: AbortController } | null = null;
  private pumping: Promise<void> | null = null;
  private stopped = false;
  private readonly now: () => Date;

  constructor(private readonly deps: ClipDraftQueueDependencies) {
    this.now = deps.now ?? (() => new Date());
  }

  /** The LANA model's drafter. Without one every draft settles on its starting point. */
  useDrafter(drafter: ClipDrafting, diagnostics: Pick<DraftDiagnosticsSink, "outcome"> | null = null): void {
    this.drafter = drafter;
    this.diagnostics = diagnostics;
  }

  /** At launch: puts back a draft cut off by quitting, then works through the queue. */
  start(): void {
    const requeued = this.deps.store.clipDrafts.requeueInterrupted();
    if (requeued > 0) this.deps.log.info("drafts.resumed", { drafts: requeued });
    this.kick();
  }

  /** Stops drafting (quit). The draft on the model goes back to the queue at the next launch. */
  stop(): void {
    this.stopped = true;
    this.running?.controller.abort();
  }

  /** Waits for the queue to go quiet (tests). */
  async idle(): Promise<void> {
    while (this.pumping !== null) await this.pumping;
  }

  /** Queues a draft and starts drafting if the model is free. The same open question is queued once. */
  request(request: ClipDraftRequest): StoredClipDraft {
    const { clipDrafts } = this.deps.store;
    if (request.questionID !== undefined) {
      const existing = clipDrafts.list().find((draft) => draft.meetingID === request.meetingID && draft.questionID === request.questionID && draft.status !== "ready");
      if (existing !== undefined) return existing;
    }
    const draft = clipDrafts.add(randomUUID().toLowerCase(), request);
    this.deps.log.info("drafts.requested", { draft: draft.id, meeting: draft.meetingID, kind: draft.kind });
    this.changed(draft.meetingID);
    this.kick();
    return draft;
  }

  /** Stops a waiting or drafting draft, or dismisses a drafted decision. False when there is none. */
  cancel(id: string): boolean {
    const draft = this.deps.store.clipDrafts.get(id);
    if (draft === null || (draft.status === "ready" && draft.kind !== "decision")) return false;
    if (this.running?.id === id) this.running.controller.abort();
    this.deps.store.clipDrafts.cancel(id);
    this.deps.log.info("drafts.cancelled", { draft: id, meeting: draft.meetingID, status: draft.status });
    this.changed(draft.meetingID);
    return true;
  }

  /** Adds a drafted decision, as the person edited it, to the meeting's key points. */
  addDecision(id: string, text: string): StoredClipDraft | null {
    const { store } = this.deps;
    const draft = store.clipDrafts.get(id);
    if (draft === null || draft.kind !== "decision" || draft.status !== "ready") return null;
    store.shared.edit(draft.meetingID, (record) => {
      const lines = linesBetween(record.transcript, draft.firstLine, draft.lastLine);
      const clip = record.clips.find((item) => item.id === draft.clipID) ?? transcriptClip(draft.clipID, lines[0]?.start ?? 0, lines.at(-1)?.end ?? 0, this.now());
      const point = clipDecision(text, clip, lines);
      return { ...record, notes: { ...record.notes, keyPoints: addingDecision(record.notes.keyPoints, point, text) } };
    });
    store.clipDrafts.added(id);
    this.deps.log.info("drafts.decision_added", { draft: id, meeting: draft.meetingID });
    this.changed(draft.meetingID);
    return draft;
  }

  /** Drafts still open, in queue order: waiting, drafting, or a decision to add. Ready actions are cards. */
  open(meetingID?: LanaId): StoredClipDraft[] {
    this.forgetSettled();
    return this.deps.store.clipDrafts.list().filter((draft) => (meetingID === undefined || draft.meetingID === meetingID) && !(draft.status === "ready" && draft.kind !== "decision"));
  }

  /** What the Inbox counts: every open draft. */
  count(): number {
    return this.open().length;
  }

  /** True when this proposed action is LANA's starting point rather than its draft. */
  isStartingPoint(intentID: string): boolean {
    return this.deps.store.clipDrafts.forIntent(intentID)?.drafted === false;
  }

  /** The draft as the Inbox and the meeting show it. */
  card(draft: StoredClipDraft, record: MeetingRecord, all: readonly StoredClipDraft[] = this.open()): DraftCard {
    const lines = linesBetween(record.transcript, draft.firstLine, draft.lastLine);
    const question = draft.questionID === undefined ? null : (record.notes.keyPoints.find((point) => point.id === draft.questionID)?.text ?? null);
    const waiting = all.filter((item) => item.status !== "ready");
    const state: DraftState = draft.status === "ready"
      ? { kind: "ready", text: draft.text ?? "", drafted: draft.drafted === true }
      : draft.status === "drafting" ? { kind: "drafting" } : { kind: "waiting", ahead: waiting.findIndex((item) => item.id === draft.id) };
    return {
      id: draft.id,
      meetingID: draft.meetingID,
      meetingTitle: record.title,
      kind: draft.kind === "decision" ? "decision" : "action",
      question,
      questionID: draft.questionID ?? null,
      start: lines[0]?.start ?? 0,
      end: lines.at(-1)?.end ?? 0,
      state,
    };
  }

  // MARK: - Private

  private kick(): void {
    if (this.pumping !== null || this.stopped) return;
    this.pumping = this.pump().finally(() => {
      this.pumping = null;
    });
  }

  private async pump(): Promise<void> {
    for (;;) {
      if (this.stopped) return;
      const draft = this.deps.store.clipDrafts.startNext();
      if (draft === null) return;
      this.changed(draft.meetingID);
      const controller = new AbortController();
      this.running = { id: draft.id, controller };
      try {
        await this.draft(draft, controller.signal);
      } catch {
        // Cancelled, quit, or the meeting went away: the draft is already settled or requeued.
        this.deps.log.info("drafts.stopped", { draft: draft.id, cancelled: controller.signal.aborted });
      } finally {
        this.running = null;
      }
      this.changed(draft.meetingID);
    }
  }

  private async draft(draft: StoredClipDraft, signal: AbortSignal): Promise<void> {
    const { store } = this.deps;
    const record = store.shared.current(draft.meetingID);
    const lines = linesBetween(record.transcript, draft.firstLine, draft.lastLine);
    if (lines.length === 0) {
      store.clipDrafts.cancel(draft.id);
      return;
    }
    const question = draft.questionID === undefined ? undefined : record.notes.keyPoints.find((point) => point.id === draft.questionID)?.text;
    const started = this.now().getTime();
    if (draft.kind === "decision") {
      const text = await this.attempt(() => this.drafter?.decision(lines, record.speakers, signal));
      if (!this.stillWanted(draft.id, signal)) return;
      const start = [...lines.map((line) => line.text).join(" ")].slice(0, MAX_DECISION_START).join("");
      store.clipDrafts.readyDecision(draft.id, text ?? start, text !== undefined);
      this.diagnostics?.outcome({ draft: draft.id, kind: draft.kind, parsed: text !== undefined, drafted: text !== undefined, issues: [], ms: this.now().getTime() - started });
      this.deps.log.info("drafts.ready", { draft: draft.id, kind: draft.kind, drafted: text !== undefined, ms: this.now().getTime() - started });
      return;
    }
    const candidate = await this.attempt(() => this.candidate(question, lines, record.speakers, signal));
    if (!this.stillWanted(draft.id, signal)) return;
    const fallback = question === undefined ? clipFallbackAction(lines) : clipQuestionFallbackAction(question, lines);
    const drafted = candidate === undefined ? undefined : clipIntent(candidate, lines, draft.meetingID, this.now());
    const intent: Intent | undefined = drafted ?? clipIntent(fallback, lines, draft.meetingID, this.now());
    if (intent === undefined) {
      store.clipDrafts.cancel(draft.id);
      this.deps.log.error("drafts.no_intent", { draft: draft.id });
      return;
    }
    store.shared.addAction(draft.meetingID, intent);
    store.clipDrafts.readyAction(draft.id, intent.id, drafted !== undefined);
    this.diagnostics?.outcome({
      draft: draft.id, kind: draft.kind, parsed: candidate !== undefined, drafted: drafted !== undefined,
      issues: candidate !== undefined && drafted === undefined ? clipIntentIssues(candidate, lines, draft.meetingID, this.now()) : [],
      ms: this.now().getTime() - started,
    });
    this.deps.log.info("drafts.ready", { draft: draft.id, kind: draft.kind, drafted: drafted !== undefined, type: intent.type, ms: this.now().getTime() - started });
  }

  private candidate(question: string | undefined, lines: readonly TranscriptSegment[], speakers: readonly Speaker[], signal: AbortSignal): Promise<CandidateIntent | undefined> | undefined {
    if (this.drafter === null) return undefined;
    return question === undefined ? this.drafter.action(lines, speakers, signal) : this.drafter.questionAction(question, lines, speakers, signal);
  }

  /** The model's draft, or undefined when it could not write one. A cancel rejects. */
  private async attempt<T>(work: () => Promise<T | undefined> | undefined): Promise<T | undefined> {
    try {
      return await work();
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") throw error;
      if (this.running?.controller.signal.aborted === true) throw error;
      return undefined;
    }
  }

  /** False when the draft was cancelled or the app is quitting while it was on the model. */
  private stillWanted(id: string, signal: AbortSignal): boolean {
    return !signal.aborted && this.deps.store.clipDrafts.get(id)?.status === "drafting";
  }

  /** Action drafts whose card the person settled (confirmed, dismissed, undone) are forgotten. */
  private forgetSettled(): void {
    const { store } = this.deps;
    for (const draft of store.clipDrafts.list()) {
      if (draft.status !== "ready" || draft.intentID === null) continue;
      let status: string | undefined;
      try {
        status = store.intents.get(draft.intentID).intent.status;
      } catch {
        status = undefined;
      }
      if (status === undefined || !OPEN_INTENT_STATUSES.has(status)) store.clipDrafts.forget(draft.id);
    }
  }

  private changed(meetingID: LanaId): void {
    this.deps.onMeetingChanged(meetingID);
    this.deps.onInboxChanged();
  }
}
