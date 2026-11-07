import type { LanaId } from "../ids/lanaId.js";
import type { MeetingRecord } from "../intent/meeting.js";
import type { IntentEvent, MeetingSummary, StoredIntent } from "../store/types.js";
import { actionHistoryPassage } from "./actionHistory.js";
import { AskEngine, type AnswerBackend, type AskAnswer, type AskEngineOptions, type AskOptions } from "./askEngine.js";
import { PassageBuilder, type Passage } from "./passage.js";
import { PassageIndex } from "./passageIndex.js";

/** What Ask reads from the gateway store (implemented by `GatewayStore`'s repositories). */
export interface AskMeetingSource {
  /** Meeting summaries, newest first. */
  meetings(): MeetingSummary[] | Promise<MeetingSummary[]>;
  meeting(id: LanaId): MeetingRecord | Promise<MeetingRecord>;
  intents(meetingID: LanaId | null): StoredIntent[] | Promise<StoredIntent[]>;
  history(intentID: LanaId): IntentEvent[] | Promise<IntentEvent[]>;
}

/** One meeting, or every meeting on this computer. */
export type AskScope = { readonly kind: "all" } | { readonly kind: "meeting"; readonly id: LanaId };

/**
 * Builds the passage index from the decrypted meetings in the store and answers through
 * `AskEngine` (Swift `MeetingAskService`, NotesMac). Before each question it compares the
 * store's meeting ids with the indexed ones and rebuilds when they differ. Each question
 * also carries the current history of every proposed action. Passages live in memory only.
 */
export class MeetingAskService {
  private passages = new Map<LanaId, Passage[]>();
  private summaries = new Map<LanaId, MeetingSummary>();
  private indexed = false;

  constructor(
    private readonly source: AskMeetingSource,
    private readonly backend: AnswerBackend,
    private readonly options: AskEngineOptions & { readonly builder?: PassageBuilder; readonly timeZone?: string } = {},
  ) {}

  async ask(question: string, scope: AskScope, options: AskOptions = {}): Promise<AskAnswer> {
    return (await this.engine(scope)).ask(question, options);
  }

  /** An engine over `scope`'s passages plus its action history. Talk builds one per conversation. */
  async engine(scope: AskScope): Promise<AskEngine> {
    const ids = await this.refreshedIndex();
    const meetingIDs = scope.kind === "all" ? ids : [scope.id];
    const extra = await this.historyPassages(scope);
    const index = new PassageIndex([...meetingIDs.flatMap((id) => this.passages.get(id) ?? []), ...extra]);
    return new AskEngine(index, this.backend, this.options);
  }

  /** Drops a meeting's passages, for example after its scratch-pad notes changed. */
  meetingChanged(id: LanaId): void {
    this.passages.delete(id);
    this.indexed = false;
  }

  get indexedMeetings(): number {
    return this.passages.size;
  }

  /** Passages describing each action's lifecycle for `scope`. */
  async historyPassages(scope: AskScope): Promise<Passage[]> {
    const result: Passage[] = [];
    for (const stored of await this.source.intents(scope.kind === "all" ? null : scope.id)) {
      const summary = this.summaries.get(stored.intent.meetingID);
      if (summary === undefined) continue;
      const events = await this.source.history(stored.intent.id);
      result.push(actionHistoryPassage(stored, events, summary.title, summary.startedAt, this.options.timeZone));
    }
    return result;
  }

  /** Meeting ids newest first, with every meeting's passages built. */
  private async refreshedIndex(): Promise<LanaId[]> {
    const meetings = await this.source.meetings();
    const ids = meetings.map((meeting) => meeting.id);
    this.summaries = new Map();
    for (const meeting of meetings) if (!this.summaries.has(meeting.id)) this.summaries.set(meeting.id, meeting);
    if (this.indexed && setEquals(ids, [...this.passages.keys()])) return ids;
    const builder = this.options.builder ?? new PassageBuilder();
    const next = new Map<LanaId, Passage[]>();
    for (const id of ids) {
      next.set(id, this.passages.get(id) ?? builder.passages(await this.source.meeting(id)));
    }
    this.passages = next;
    this.indexed = true;
    return ids;
  }
}

function setEquals(a: readonly string[], b: readonly string[]): boolean {
  const left = new Set(a);
  const right = new Set(b);
  return left.size === right.size && [...left].every((value) => right.has(value));
}

/** `AskMeetingSource` over a `GatewayStore`. */
export function storeAskSource(store: {
  readonly meetings: { list(): MeetingSummary[]; get(id: LanaId): MeetingRecord };
  readonly intents: { list(filter?: { readonly meetingID?: LanaId }): StoredIntent[]; history(id: LanaId): IntentEvent[] };
}): AskMeetingSource {
  return {
    meetings: () => store.meetings.list(),
    meeting: (id) => store.meetings.get(id),
    intents: (meetingID) => store.intents.list(meetingID === null ? {} : { meetingID }),
    history: (id) => store.intents.history(id),
  };
}
