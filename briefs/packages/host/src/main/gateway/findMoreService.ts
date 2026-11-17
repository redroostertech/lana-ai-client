import { parseLanaId, type LanaId } from "@lana/core/ids";
import type { TextModel } from "@lana/core/runtime";
import { StoreError, type GatewayStore } from "@lana/core/store";
import { MeetingStates } from "@lana/core/state";
import { FindMoreUnavailableError, NoteFinder, RuntimeNotesBackend, type FindMoreSuggestion } from "@lana/core/summarizer";
import type { FindMoreApi, FindMoreSuggestionView, FindMoreView, LanaEvent, Result } from "../../shared/api.js";
import type { MainLog } from "../log.js";
import { actionFacts } from "./meetingsBridge.js";

const NOT_FOUND = { code: "notFound", message: "That meeting is no longer on this computer." } as const;
const NOTES_BUSY = { code: "busy", message: "LANA is writing this meeting's notes. Try again when it finishes." } as const;
const RUN_BUSY = { code: "busy", message: "LANA is finding more notes for another meeting. Try again when it finishes." } as const;
const STORE_FAILED = { code: "store", message: "LANA could not save this change to its encrypted store." } as const;

type Outcome = "ready" | "failed" | "unavailable";

export interface FindMoreServiceOptions {
  readonly store: GatewayStore;
  /** The LANA model on this computer (the larger model; it may read meetings recorded on the phone). */
  readonly model: TextModel;
  readonly emit: (event: LanaEvent) => void;
  readonly log: MainLog;
  /** Whether LANA is writing this meeting's notes right now (Find more waits). */
  readonly notesBusy: (meetingID: string) => boolean;
}

/**
 * Find more notes on this computer (contract `find-more/contract.md`): one run at a time in
 * the background on the LANA model, for any meeting here, recorded on this computer or on the
 * phone. Suggestions wait in the store on this device; adding one goes through the shared
 * record like a hand edit, so the phone gets it in its next sync. Logs carry ids and counts only.
 */
export class FindMoreService implements FindMoreApi {
  private running: { readonly id: LanaId; part: number; of: number } | null = null;
  /** The last run's outcome per meeting, while the app runs. */
  private readonly outcomes = new Map<string, Outcome>();
  private work: Promise<void> = Promise.resolve();
  private readonly states: MeetingStates;

  constructor(private readonly options: FindMoreServiceOptions) {
    this.states = new MeetingStates(options.store);
  }

  /** Resolves when the run in progress settles (tests). */
  idle(): Promise<void> {
    return this.work;
  }

  async state(meetingID: string): Promise<Result<FindMoreView>> {
    return this.run(meetingID, (id) => this.view(id));
  }

  async start(meetingID: string): Promise<Result<FindMoreView>> {
    const id = parseLanaId(String(meetingID), "meeting");
    if (id === null || !this.options.store.meetings.exists(id)) return { ok: false, error: NOT_FOUND };
    if (this.options.notesBusy(id)) return { ok: false, error: NOTES_BUSY };
    if (this.running !== null) return { ok: false, error: this.running.id === id ? { code: "busy", message: "LANA is already finding more notes for this meeting." } : RUN_BUSY };
    const record = this.options.store.shared.current(id);
    if (record.transcript.length === 0) return { ok: false, error: { code: "empty", message: "This meeting has no transcript yet, so there is nothing to read again." } };
    this.running = { id, part: 0, of: 0 };
    this.work = this.find(id).finally(() => {
      this.running = null;
    });
    return { ok: true, value: this.view(id) };
  }

  async add(meetingID: string, suggestionIDs: string[]): Promise<Result<FindMoreView>> {
    return this.change(meetingID, suggestionIDs, (id, ids) => {
      const added = this.states.propose(id, [{ kind: "acceptSuggestions", suggestionIDs: ids }], "person").applied;
      this.options.log.info("find_more.added", { meeting: id, added });
      if (added > 0) this.options.emit({ type: "meetingChanged", meetingID: id });
    });
  }

  async dismiss(meetingID: string, suggestionIDs: string[]): Promise<Result<FindMoreView>> {
    return this.change(meetingID, suggestionIDs, (id, ids) => {
      const dismissed = this.states.propose(id, [{ kind: "dismissSuggestions", suggestionIDs: ids }], "person").applied;
      this.options.log.info("find_more.dismissed", { meeting: id, dismissed });
    });
  }

  // MARK: - Private

  private async find(id: LanaId): Promise<void> {
    const { store, log } = this.options;
    this.publish(id);
    let outcome: Outcome = "ready";
    try {
      // The meeting as every step sees it: known items (notes, actions, waiting, dismissed and removed suggestions), repeats, people, visible lines.
      const state = this.states.load(id);
      const result = await new NoteFinder(new RuntimeNotesBackend(this.options.model)).find({
        state,
        now: new Date(),
        progress: (part, of) => {
          if (this.running?.id !== id) return;
          this.running.part = part;
          this.running.of = of;
          this.publish(id);
        },
      });
      this.states.propose(id, [{ kind: "suggest", suggestions: result.suggestions }], "find_more");
      log.info("find_more.ran", { meeting: id, found: result.suggestions.length, chunks: result.chunkCount, skipped: result.skippedChunks });
    } catch (error) {
      if (error instanceof FindMoreUnavailableError) {
        outcome = "unavailable";
        log.notice("find_more.unavailable", { meeting: id });
      } else {
        outcome = "failed";
        log.error("find_more.failed", { meeting: id, kind: error instanceof Error ? error.name : "unknown" });
      }
    }
    this.outcomes.set(id, outcome);
    this.running = null;
    this.publish(id);
  }

  private publish(id: LanaId): void {
    try {
      this.options.emit({ type: "findMore", view: this.view(id) });
    } catch {
      this.options.log.error("find_more.publish_failed", { meeting: id });
    }
  }

  private view(id: LanaId): FindMoreView {
    const state = this.options.store.findMore.state(id);
    const running = this.running?.id === id ? this.running : null;
    return {
      meetingID: id,
      status: running !== null ? "running" : (this.outcomes.get(id) ?? (state.lastRun === null ? "idle" : "ready")),
      part: running?.part ?? 0,
      of: running?.of ?? 0,
      suggestions: state.suggestions.map(suggestionView),
      lastRun: state.lastRun === null ? null : { at: state.lastRun.at.toISOString(), found: state.lastRun.found },
    };
  }

  private async change(meetingID: string, suggestionIDs: unknown, work: (id: LanaId, ids: string[]) => void): Promise<Result<FindMoreView>> {
    const ids = Array.isArray(suggestionIDs) ? suggestionIDs.filter((item): item is string => typeof item === "string") : [];
    return this.run(meetingID, (id) => {
      work(id, ids);
      return this.view(id);
    });
  }

  private async run<T>(meetingID: string, work: (id: LanaId) => T): Promise<Result<T>> {
    const id = parseLanaId(String(meetingID), "meeting");
    if (id === null || !this.options.store.meetings.exists(id)) return { ok: false, error: NOT_FOUND };
    try {
      return { ok: true, value: work(id) };
    } catch (error) {
      if (error instanceof StoreError && error.kind === "notFound") return { ok: false, error: NOT_FOUND };
      this.options.log.error("find_more.store_failed", { meeting: id });
      return { ok: false, error: STORE_FAILED };
    }
  }
}

function suggestionView(item: FindMoreSuggestion): FindMoreSuggestionView {
  const facts = item.intent === undefined ? { owner: null, dueDate: null, dueText: null } : actionFacts(item.intent.params);
  return {
    id: item.id,
    kind: item.kind === "open_question" ? "openQuestion" : item.kind,
    text: item.text,
    ...facts,
    decidedBy: item.decidedBy ?? null,
    start: Math.min(...item.sources.map((span) => span.start)),
    end: Math.max(...item.sources.map((span) => span.end)),
  };
}
