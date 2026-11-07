import {
  askTurnsFromSaved, decodeSavedAskTurns, encodeSavedAskTurns, savedFromTurns,
  clipPassage, type AnswerDraft, type AskAnswer, type AskTurn, type MeetingAskService, type Passage,
} from "@lana/core/ask";
import { parseLanaId, type LanaId } from "@lana/core/ids";
import type { GatewayStore } from "@lana/core/store";
import { randomUUID } from "node:crypto";
import type {
  AskApi, AskCitation, AskConversation, AskPinnedClip, AskDraft, AskExchange, AskScope, AskThreadSummary, LanaEvent, PlatformInfo, Result,
} from "../../../shared/api.js";
import type { MainLog } from "../../log.js";
import { buildCitations, citationTitle } from "./askCitations.js";

export const ASK_FAILED = "LANA could not search your meetings. Try again.";
export const SUGGESTION_LABEL = "A suggestion, not something said in your meetings. Check it before relying on it.";
const STARTERS = {
  clip: ["What does this part mean?", "What should we do about this?", "Who needs to act on this?"],
  all: ["What deadlines came up this week?", "What did we promise clients?", "What is still open?"],
  meeting: ["What deadlines came up?", "What is still open?", "What should we do next?"],
} as const;

type Outcome =
  | { kind: "thinking" }
  | { kind: "answered"; answer: AskAnswer; citations: AskCitation[] }
  | { kind: "failed"; message: string };

interface Exchange {
  id: number;
  question: string;
  outcome: Outcome;
}

interface Conversation {
  key: string;
  scope: AskScope;
  threadID: string | null;
  exchanges: Exchange[];
  pending: { id: number; controller: AbortController } | null;
  draft: AskDraft | null;
  /** The clip this conversation is about, read first. */
  pinned: { meetingID: LanaId; clipID: string } | null;
}

export interface AskServiceOptions {
  readonly store: GatewayStore;
  readonly asking: MeetingAskService;
  readonly platform: PlatformInfo;
  readonly emit: (event: LanaEvent) => void;
  readonly log: MainLog;
  /** Signed in and LANA Briefs on for the organization; no question is answered otherwise. */
  readonly allowed: () => boolean;
}

/** Plain status line shown in place of, or above, the answer (Swift `AskExchange.message`). */
export function statusMessage(answer: AskAnswer, deviceNoun: string): string | null {
  switch (answer.status) {
    case "answered":
      return null;
    case "notFound":
      return "I could not find that in your meetings.";
    case "suggested":
      return SUGGESTION_LABEL;
    case "declined":
      return "The on-device model would not answer that. Here are the closest passages.";
    case "passagesOnly":
      return answer.reason === "modelNotReady"
        ? "The LANA model is not downloaded yet, so here are the closest passages."
        : `The on-device model is not available on this ${deviceNoun}, so here are the closest passages.`;
  }
}

/**
 * Ask in real mode (Swift `AskViewModel` over `MeetingAskService`): one conversation per
 * key (`screen`, `meeting:<id>`), answers streamed as drafts in the order the model writes
 * them, citations as chips, and every answered conversation saved sealed in the store's
 * Ask threads. Questions and answers are never logged and never written to the audit log.
 */
export class AskService implements AskApi {
  private readonly conversations = new Map<string, Conversation>();
  private nextID = 1;

  constructor(private readonly options: AskServiceOptions) {}

  // MARK: - AskApi

  async conversation(key: string): Promise<AskConversation> {
    return this.view(this.conversationFor(String(key)));
  }

  /** Changes which meetings the next question searches. The conversation stays (as on the Mac). */
  async setScope(key: string, scope: AskScope): Promise<AskConversation> {
    const conversation = this.conversationFor(String(key));
    const next = this.validScope(scope);
    if (!sameScope(next, conversation.scope)) {
      this.stop(conversation);
      conversation.scope = next;
    }
    return this.publish(conversation);
  }

  async send(key: string, rawQuestion: string): Promise<AskConversation> {
    const conversation = this.conversationFor(String(key));
    const question = String(rawQuestion).trim();
    if (question.length === 0 || conversation.pending !== null || !this.options.allowed()) return this.view(conversation);
    const history = this.history(conversation);
    const id = this.nextID++;
    const controller = new AbortController();
    conversation.exchanges.push({ id, question, outcome: { kind: "thinking" } });
    conversation.pending = { id, controller };
    conversation.draft = null;
    const scope = conversation.scope;
    void this.answer(conversation, id, question, history, scope, controller);
    return this.publish(conversation);
  }

  async newConversation(key: string): Promise<AskConversation> {
    const conversation = this.conversationFor(String(key));
    this.stop(conversation);
    conversation.exchanges = [];
    conversation.threadID = null;
    conversation.pinned = null;
    return this.publish(conversation);
  }

  /** A new conversation about a saved clip of one meeting (Swift `AskChatsViewModel.newChat(about:)`), or no pin. */
  async pinClip(key: string, clip: { meetingID: string; clipID: string } | null): Promise<AskConversation> {
    const conversation = this.conversationFor(String(key));
    if (clip === null) {
      conversation.pinned = null;
      return this.publish(conversation);
    }
    const meetingID = parseLanaId(String(clip?.meetingID), "meeting");
    if (meetingID === null) return this.view(conversation);
    this.stop(conversation);
    conversation.exchanges = [];
    conversation.threadID = null;
    conversation.scope = { kind: "meeting", meetingID };
    conversation.pinned = { meetingID, clipID: String(clip.clipID) };
    return this.publish(conversation);
  }

  /** Reopens a saved conversation in its own scope, ready to continue. */
  async openThread(key: string, threadID: string): Promise<AskConversation> {
    const conversation = this.conversationFor(String(key));
    const stored = this.options.store.ask.get(String(threadID));
    if (stored === null) return this.view(conversation);
    let turns: AskTurn[];
    try {
      const dates = new Map(this.options.store.meetings.list().map((meeting) => [meeting.id, meeting.startedAt] as const));
      turns = askTurnsFromSaved(decodeSavedAskTurns(stored.turns), dates);
    } catch {
      this.options.log.notice("ask.thread_unreadable");
      return this.view(conversation);
    }
    this.stop(conversation);
    const scope: AskScope = stored.meetingID === null ? { kind: "all" } : { kind: "meeting", meetingID: stored.meetingID };
    conversation.scope = scope;
    conversation.threadID = stored.id;
    conversation.exchanges = turns.map((turn) => ({
      id: this.nextID++,
      question: turn.question,
      outcome: { kind: "answered", answer: turn.answer, citations: this.citations(turn.answer, scope) },
    }));
    return this.publish(conversation);
  }

  async threads(): Promise<Result<AskThreadSummary[]>> {
    try {
      return { ok: true, value: this.summaries() };
    } catch {
      this.options.log.error("ask.threads_failed");
      return { ok: false, error: { code: "storeFailed", message: "Saved conversations could not be read." } };
    }
  }

  async deleteThread(id: string): Promise<Result<AskThreadSummary[]>> {
    this.options.store.ask.delete(String(id));
    for (const conversation of this.conversations.values()) {
      if (conversation.threadID !== id) continue;
      this.stop(conversation);
      conversation.threadID = null;
      conversation.exchanges = [];
      this.publish(conversation);
    }
    return { ok: true, value: this.publishThreads() };
  }

  async cancel(key: string): Promise<void> {
    const conversation = this.conversations.get(String(key));
    if (conversation === undefined || conversation.pending === null) return;
    this.stop(conversation);
    this.publish(conversation);
  }

  // MARK: - Public

  /** Settings cleared every saved conversation: conversations on screen start over. */
  historyCleared(): void {
    for (const conversation of this.conversations.values()) {
      if (conversation.threadID === null) continue;
      this.stop(conversation);
      conversation.threadID = null;
      conversation.exchanges = [];
      this.publish(conversation);
    }
    this.publishThreads();
  }

  /** A saved conversation was added elsewhere (a talk ended). */
  threadsChanged(): void {
    this.publishThreads();
  }

  /** "All meetings" or the meeting's title. */
  scopeTitle(scope: AskScope): string {
    if (scope.kind === "all") return "All meetings";
    return this.options.store.meetings.list().find((meeting) => meeting.id === scope.meetingID)?.title ?? "This meeting";
  }

  /** Chips for an answer over `scope`: meeting titles show only when the conversation spans several. */
  citations(answer: AskAnswer, scope: AskScope | "always"): AskCitation[] {
    const namesMeeting = scope === "always" || (scope.kind === "all" && this.options.store.meetings.list().length > 1);
    return buildCitations(answer, namesMeeting, this.options.store.meetings);
  }

  /** Saves answered turns as a new or existing sealed thread. Returns its id. Never logged. */
  save(threadID: string | null, scope: AskScope, turns: readonly AskTurn[]): string | null {
    if (turns.length === 0) return null;
    const id = threadID ?? randomUUID().toLowerCase();
    const meetingID = scope.kind === "meeting" ? parseLanaId(scope.meetingID, "meeting") : null;
    this.options.store.ask.save(id, meetingID, encodeSavedAskTurns(savedFromTurns(turns, citationTitle)));
    return id;
  }

  // MARK: - Private

  private async answer(conversation: Conversation, id: number, question: string, history: AskTurn[], scope: AskScope, controller: AbortController): Promise<void> {
    let outcome: Outcome;
    try {
      const pinned = this.pinnedPassage(conversation);
      const answer = await this.options.asking.ask(question, coreScope(scope), {
        history,
        ...(pinned === undefined ? {} : { pinned: [pinned] }),
        signal: controller.signal,
        onDraft: (draft) => this.showDraft(conversation, id, draft),
      });
      if (controller.signal.aborted) return;
      outcome = { kind: "answered", answer, citations: this.citations(answer, scope) };
      this.options.log.info("ask.answered", { status: answer.status, citations: answer.citations.length });
    } catch (error) {
      if (controller.signal.aborted) return;
      this.options.log.error("ask.failed", { kind: error instanceof Error ? error.name : "unknown" });
      outcome = { kind: "failed", message: ASK_FAILED };
    }
    if (conversation.pending?.id !== id) return;
    const exchange = conversation.exchanges.find((item) => item.id === id);
    if (exchange === undefined) return;
    exchange.outcome = outcome;
    conversation.pending = null;
    conversation.draft = null;
    if (outcome.kind === "answered") {
      try {
        conversation.threadID = this.save(conversation.threadID, conversation.scope, this.history(conversation));
        this.publishThreads();
      } catch {
        this.options.log.error("ask.save_failed");
      }
    }
    this.publish(conversation);
  }

  /** The pinned clip as a passage of the meeting as it stands now; undefined when gone. */
  private pinnedPassage(conversation: Conversation): Passage | undefined {
    const pin = conversation.pinned;
    if (pin === null) return undefined;
    try {
      const meeting = this.options.store.meetings.get(pin.meetingID);
      const clip = meeting.clips.find((item) => item.id === pin.clipID);
      return clip === undefined ? undefined : clipPassage(clip, meeting);
    } catch {
      return undefined;
    }
  }

  private showDraft(conversation: Conversation, id: number, draft: AnswerDraft): void {
    if (conversation.pending?.id !== id) return;
    const suggestion = draft.kind === "suggestion";
    conversation.draft = { exchangeID: id, text: draft.text, kind: draft.kind ?? "unknown", label: suggestion ? SUGGESTION_LABEL : null };
    this.publish(conversation);
  }

  private history(conversation: Conversation): AskTurn[] {
    return conversation.exchanges.flatMap((exchange) => (exchange.outcome.kind === "answered" ? [{ question: exchange.question, answer: exchange.outcome.answer }] : []));
  }

  private stop(conversation: Conversation): void {
    conversation.pending?.controller.abort();
    conversation.pending = null;
    conversation.draft = null;
    conversation.exchanges = conversation.exchanges.filter((exchange) => exchange.outcome.kind !== "thinking");
  }

  private validScope(scope: AskScope): AskScope {
    if (scope?.kind === "meeting" && typeof scope.meetingID === "string" && parseLanaId(scope.meetingID, "meeting") !== null) return { kind: "meeting", meetingID: scope.meetingID };
    return { kind: "all" };
  }

  private conversationFor(key: string): Conversation {
    let conversation = this.conversations.get(key);
    if (conversation === undefined) {
      const meetingID = key.startsWith("meeting:") ? key.slice("meeting:".length) : null;
      conversation = { key, scope: this.validScope(meetingID === null ? { kind: "all" } : { kind: "meeting", meetingID }), threadID: null, exchanges: [], pending: null, draft: null, pinned: null };
      this.conversations.set(key, conversation);
    }
    return conversation;
  }

  private view(conversation: Conversation): AskConversation {
    const noun = this.options.platform.deviceNoun;
    const exchanges: AskExchange[] = conversation.exchanges.map((exchange) => ({
      id: exchange.id,
      question: exchange.question,
      outcome: exchange.outcome.kind === "answered"
        ? {
          kind: "answered",
          status: exchange.outcome.answer.status,
          statusMessage: statusMessage(exchange.outcome.answer, noun),
          text: exchange.outcome.answer.text,
          citations: exchange.outcome.citations,
        }
        : exchange.outcome,
    }));
    return {
      key: conversation.key,
      scope: conversation.scope,
      scopeTitle: this.scopeTitle(conversation.scope),
      threadID: conversation.threadID,
      exchanges,
      draft: conversation.draft,
      starters: [...(conversation.pinned !== null ? STARTERS.clip : conversation.scope.kind === "all" ? STARTERS.all : STARTERS.meeting)],
      pinned: this.pinnedView(conversation),
    };
  }

  private pinnedView(conversation: Conversation): AskPinnedClip | null {
    const passage = this.pinnedPassage(conversation);
    const pin = conversation.pinned;
    return pin === null || passage === undefined ? null : { meetingID: pin.meetingID, clipID: pin.clipID, start: passage.start, end: passage.end, text: passage.text };
  }

  private publish(conversation: Conversation): AskConversation {
    const view = this.view(conversation);
    this.options.emit({ type: "ask", conversation: view });
    return view;
  }

  private summaries(): AskThreadSummary[] {
    return this.options.store.ask.list().flatMap((stored) => {
      try {
        const saved = decodeSavedAskTurns(stored.turns);
        const first = saved.turns[0];
        if (first === undefined) return [];
        return [{ id: stored.id, meetingID: stored.meetingID, title: first.question, updatedAt: (stored.updatedAt ?? new Date(0)).toISOString(), questionCount: saved.turns.length }];
      } catch {
        return [];
      }
    });
  }

  private publishThreads(): AskThreadSummary[] {
    let threads: AskThreadSummary[] = [];
    try {
      threads = this.summaries();
    } catch {
      this.options.log.error("ask.threads_failed");
    }
    this.options.emit({ type: "askThreads", threads });
    return threads;
  }
}

export function coreScope(scope: AskScope): { readonly kind: "all" } | { readonly kind: "meeting"; readonly id: LanaId } {
  if (scope.kind === "all") return { kind: "all" };
  const id = parseLanaId(scope.meetingID, "meeting");
  return id === null ? { kind: "all" } : { kind: "meeting", id };
}

function sameScope(a: AskScope, b: AskScope): boolean {
  return a.kind === b.kind && (a.kind === "all" || (b.kind === "meeting" && a.meetingID === b.meetingID));
}
