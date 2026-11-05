import { failureMessage } from "@lana/core/connectors";
import { parseLanaId, type LanaId } from "@lana/core/ids";
import { displayTitleOf, isValidEmail, speakerDisplayName, type EntityHint, type IntentParams, type IntentStatus, type MeetingRecord } from "@lana/core/intent";
import type { JsonValue } from "@lana/core/json";
import { AUDIT_EVENTS, EDITABLE_STATUSES, StoreError, type GatewayStore, type StoredIntent } from "@lana/core/store";
import type { ClipDraftQueue } from "../../gateway/clipDraftQueue.js";
import type {
  ActionCard, ActionDraft, ActionKind, ActionPhase, DraftCard, InboxApi, InboxMeeting, ProposedAction,
  RecipientRow, RecipientState, Result, TargetChoice, TargetState,
} from "../../../shared/api.js";
import type { MainLog } from "../../log.js";
import { NOT_ENTITLED_MESSAGE } from "../../gateway/accessMessages.js";
import { toApiMethod } from "../../gateway/meetingsBridge.js";
import {
  ActionServiceError, connectorNameFor, executorFor,
  type ActionPlan, type ActionService, type ExecutionResult, type ResolvedEntity, type ResolvedTarget, type Resolution, type TargetCandidate,
} from "./actionService.js";
import { decodeStoredResolution, encodeStoredResolution } from "./storedResolution.js";

/** Statuses that appear on the inbox; executed ones only while they can be undone (Swift `InboxViewModel`). */
const VISIBLE_STATUSES: readonly IntentStatus[] = ["transferred", "resolved", "confirmed", "failed", "executed"];
const AMBIGUOUS_LIMIT = 3;
const SEARCH_LIMIT = 8;
const QUOTE_LIMIT = 600;

export interface ActionsDependencies {
  readonly store: GatewayStore;
  readonly service: () => ActionService;
  /** LANA's background drafts, shown and counted with the cards. */
  readonly drafts?: Pick<ClipDraftQueue, "open" | "card" | "count" | "isStartingPoint">;
  readonly isSignedIn: () => boolean;
  /** LANA Briefs is on for the organization (LANA discovery's `enabled_apps`). */
  readonly isEntitled: () => boolean;
  /** "computer". */
  readonly deviceNoun: string;
  /** Called after any change, with the count of actions waiting. */
  readonly onChange: (pending: number) => void;
  readonly log: MainLog;
  readonly now?: () => Date;
}

interface Row {
  readonly id: number;
  hint: EntityHint;
  state: RecipientState;
}

interface Card {
  readonly id: LanaId;
  readonly meetingID: LanaId;
  stored: StoredIntent;
  readonly speakers: Map<string, string>;
  phase: ActionPhase;
  target: TargetState;
  rows: Row[];
  /** Records offered on this card (resolver, search), by choice id, so a pick maps back to an entity. */
  readonly offered: Map<string, { choice: TargetChoice; entity: ResolvedEntity }>;
  plan: ActionPlan | null;
  planProblem: string | null;
  actionError: string | null;
  result: ExecutionResult | null;
}

/** The message for a stored failure code (Swift `ActionFailure.message(forCode:)`). */
export { failureMessage };

function kindOf(type: string): ActionKind {
  return type === "note.log" ? "note" : type === "task.create" ? "task" : type === "email.draft" ? "email" : "unsupported";
}

/** Swift `TargetChoice(candidate:)`: matters as number and client, contacts by name. */
export function choiceFor(candidate: TargetCandidate, reasons: readonly string[] = []): { choice: TargetChoice; entity: ResolvedEntity } {
  const isMatter = candidate.kind === "matter";
  let displayName = candidate.name;
  if (isMatter) {
    const client = candidate.clientName ?? candidate.name;
    displayName = candidate.displayNumber ? `${candidate.displayNumber} ${client}` : candidate.clientName ? `${candidate.clientName}: ${candidate.name}` : candidate.name;
  }
  const detail = isMatter
    ? [candidate.name || null, candidate.clientName ? `Client: ${candidate.clientName}` : null].filter(Boolean).join(". ")
    : (candidate.email ?? (candidate.kind === "company" ? "Company" : "Person"));
  const entity: ResolvedEntity = { kind: isMatter ? "matter" : "contact", id: candidate.id, displayName };
  return { entity, choice: { id: `${entity.kind}:${entity.id}`, kind: entity.kind === "matter" ? "matter" : "contact", displayName, detail, email: candidate.email ?? null, reasons: [...reasons] } };
}

function describe(value: JsonValue): string {
  if (value === null) return "None";
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (Array.isArray(value)) return value.map(describe).join(", ");
  const object = value as Record<string, JsonValue>;
  return Object.keys(object).sort().map((key) => `${key}: ${describe(object[key] ?? null)}`).join(", ");
}

/**
 * The action cards over the real store (Swift `InboxViewModel` and `ActionCardViewModel`):
 * intents with their status history and resolutions, target resolution and search,
 * edits saved through the store, and confirm, undo and dismiss. Nothing runs without a
 * confirm on that one card. Running goes through `ActionService` (the executors).
 */
export class ActionsService {
  readonly inbox: InboxApi;
  private readonly cards = new Map<string, Card>();
  private readonly now: () => Date;

  constructor(private readonly deps: ActionsDependencies) {
    this.now = deps.now ?? (() => new Date());
    this.inbox = {
      pendingCount: async () => this.pendingCount(),
      unreadCount: async () => this.deps.store.actions.unreadCount(),
      list: async () => this.proposedActions(),
    };
  }

  /** Actions waiting for the person (open, failed or interrupted, never the unsupported ones) and drafts on their way. */
  pendingCount(): number {
    try {
      const actions = this.deps.store.intents.list({ statuses: ["transferred", "resolved", "confirmed", "failed"] }).filter((stored) => executorFor(stored.intent.type) !== null).length;
      return actions + (this.deps.drafts?.count() ?? 0);
    } catch {
      return 0;
    }
  }

  // MARK: - ActionsApi

  async sections(): Promise<Result<InboxMeeting[]>> {
    const { store } = this.deps;
    try {
      const sections: InboxMeeting[] = [];
      const now = this.now();
      const openDrafts = this.deps.drafts?.open() ?? [];
      for (const summary of store.meetings.list()) {
        const visible = store.intents.list({ statuses: VISIBLE_STATUSES, meetingID: summary.id }).filter((stored) => this.isVisible(stored, now));
        const meetingDrafts = openDrafts.filter((draft) => draft.meetingID === summary.id);
        if (visible.length === 0 && meetingDrafts.length === 0) continue;
        const record = store.meetings.get(summary.id);
        const drafts: DraftCard[] = meetingDrafts.map((draft) => this.deps.drafts!.card(draft, record, openDrafts));
        visible.sort((a, b) => a.intent.createdAt.getTime() - b.intent.createdAt.getTime() || (a.intent.id < b.intent.id ? -1 : 1));
        const cards: ActionCard[] = [];
        for (const stored of visible) {
          const card = this.makeCard(stored, record);
          await this.prepare(card);
          this.cards.set(card.id, card);
          cards.push(this.view(card));
        }
        sections.push({
          id: summary.id,
          title: record.title,
          startedAt: record.startedAt.toISOString(),
          durationSeconds: record.durationSeconds,
          attestationMethod: toApiMethod(summary.attestationMethod, summary.origin),
          gaps: record.notes.gaps.map((gap) => ({ start: gap.start, end: gap.end, reason: gap.reason === "refused" ? "refused" : "failed" })),
          cards,
          drafts,
        });
      }
      return { ok: true, value: sections };
    } catch {
      this.deps.log.error("actions.sections_failed");
      return { ok: false, error: { code: "store", message: `LANA could not open its store on this ${this.deps.deviceNoun}. Restart LANA; if this keeps happening, check the keystore.` } };
    }
  }

  async choose(id: string, choiceID: string): Promise<Result<ActionCard>> {
    return this.withCard(id, async (card) => {
      const offered = card.offered.get(String(choiceID));
      if (offered === undefined) return "That record is no longer offered. Search again.";
      card.target = { kind: "resolved", choice: offered.choice, chosenByPerson: true };
      await this.persistResolution(card, "user");
      await this.refreshPlan(card);
      return null;
    });
  }

  async changeTarget(id: string): Promise<Result<ActionCard>> {
    return this.withCard(id, async (card) => {
      card.target = { kind: "noMatch" };
      card.plan = null;
      return null;
    });
  }

  async search(id: string, text: string): Promise<Result<TargetChoice[]>> {
    const card = this.cards.get(String(id));
    if (card === undefined) return this.missing();
    const query = String(text).trim();
    if (query === "") return { ok: true, value: [] };
    try {
      const service = this.deps.service();
      const found = [...(await service.search(query, "matter"))];
      if (card.stored.intent.type === "note.log") found.push(...(await service.search(query, "contact")));
      return { ok: true, value: found.slice(0, SEARCH_LIMIT).map((candidate) => this.offer(card, candidate).choice) };
    } catch {
      return { ok: false, error: { code: "search", message: "Search is not available right now." } };
    }
  }

  async chooseRecipient(id: string, rowID: number, choiceID: string): Promise<Result<ActionCard>> {
    return this.withCard(id, async (card) => {
      const row = card.rows.find((item) => item.id === Number(rowID));
      const offered = card.offered.get(String(choiceID));
      if (row === undefined || offered?.choice.email == null) return "That contact has no email address.";
      row.state = { kind: "resolved", address: offered.choice.email, name: offered.entity.displayName, reason: `Chosen on this ${this.deps.deviceNoun}` };
      await this.persistResolution(card, "user");
      await this.refreshPlan(card);
      return null;
    });
  }

  async submitRecipient(id: string, rowID: number, entry: string): Promise<Result<{ card: ActionCard; results: TargetChoice[] }>> {
    const card = this.cards.get(String(id));
    const row = card?.rows.find((item) => item.id === Number(rowID));
    if (card === undefined || row === undefined) return this.missing();
    const text = String(entry).trim();
    if (text === "") return { ok: true, value: { card: this.view(card), results: [] } };
    if (isValidEmail(text)) {
      // The typed address becomes the hint's email, saved as an edit (Swift does it on save).
      const edited = await this.applyEdit(card, { ...card.stored.intent.params }, row.id, text);
      if (edited !== null) return { ok: false, error: { code: "invalid", message: edited } };
      const updated = card.rows.find((item) => item.id === row.id);
      if (updated !== undefined) updated.state = { kind: "resolved", address: text, name: updated.hint.name || text, reason: `Typed on this ${this.deps.deviceNoun}` };
      await this.persistResolution(card, "user");
      await this.refreshPlan(card);
      this.changed();
      return { ok: true, value: { card: this.view(card), results: [] } };
    }
    let results: TargetChoice[] = [];
    try {
      results = (await this.deps.service().search(text, "contact")).filter((candidate) => candidate.email).slice(0, SEARCH_LIMIT).map((candidate) => this.offer(card, candidate).choice);
    } catch {
      card.actionError = "Search is not available right now.";
    }
    return { ok: true, value: { card: this.view(card), results } };
  }

  async saveEdits(id: string, draft: ActionDraft): Promise<Result<ActionCard>> {
    return this.withCard(id, async (card) => {
      if (!this.isEditable(card)) return "This action can no longer be edited.";
      const title = String(draft?.title ?? "");
      if (title.trim() === "") return `Add a ${this.titleLabel(card).toLowerCase()}.`;
      const params = card.stored.intent.params;
      const body = String(draft?.body ?? "");
      let next: IntentParams;
      switch (params.type) {
        case "note.log":
          next = { type: "note.log", note: { ...params.note, subject: title, body } };
          break;
        case "task.create": {
          const due = typeof draft?.dueDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(draft.dueDate) ? draft.dueDate : undefined;
          next = { type: "task.create", task: { ...params.task, title, detail: body, dueDate: due } };
          break;
        }
        case "email.draft":
          next = { type: "email.draft", email: { ...params.email, subject: title, body } };
          break;
        case "unsupported":
          return "This action can no longer be edited.";
      }
      return this.applyEdit(card, next, null, null);
    });
  }

  async confirm(id: string): Promise<Result<ActionCard>> {
    const card = this.cards.get(String(id));
    if (card === undefined) return this.missing();
    await this.refreshPlan(card);
    const blocked = this.confirmBlockReason(card);
    if (blocked !== null || card.plan === null) return { ok: false, error: { code: "blocked", message: blocked ?? "Preparing the request." } };
    const plan = card.plan;
    const { store } = this.deps;
    const service = this.deps.service();
    card.actionError = null;
    try {
      if (card.stored.intent.status === "transferred") card.stored = store.intents.transition(card.id, "resolved", "user");
      if (card.stored.intent.status === "resolved" || card.stored.intent.status === "failed") {
        card.stored = store.intents.transition(card.id, "confirmed", "user", { plan_hash: plan.planHash });
      }
      const result = await service.execute(plan, store.ledger);
      card.stored = store.intents.transition(card.id, "executed", "system", { external_id: result.externalID, executor: plan.executor });
      store.intents.setResolution(card.id, encodeStoredResolution({ target: this.currentTarget(card), planHash: plan.planHash, result }));
      card.stored = store.intents.get(card.id);
      await store.appendAudit(AUDIT_EVENTS.actionExecuted, card.id, {
        executor: plan.executor, external_id: result.externalID, deduplicated: String(result.deduplicated), plan_hash: plan.planHash,
      });
      card.result = result;
      card.phase = { kind: "executed", externalID: result.externalID, deduplicated: result.deduplicated, undoExpiresAt: result.undo.expiresAt.toISOString() };
      this.deps.log.info("actions.executed", { intent: card.id, executor: plan.executor, deduplicated: result.deduplicated });
    } catch (error) {
      const failure = this.failure(error);
      if (card.stored.intent.status === "confirmed") {
        try {
          card.stored = store.intents.transition(card.id, "failed", "system", { reason: failure.code });
        } catch {
          // The card keeps its status; the audit below still records the failure.
        }
      }
      await store.appendAudit(AUDIT_EVENTS.actionFailed, card.id, { reason: failure.code, executor: plan.executor }).catch(() => undefined);
      card.phase = { kind: "failed", reason: failure.message };
      this.deps.log.notice("actions.failed", { intent: card.id, code: failure.code });
    }
    this.changed();
    return { ok: true, value: this.view(card) };
  }

  async undo(id: string): Promise<Result<ActionCard>> {
    const card = this.cards.get(String(id));
    if (card === undefined) return this.missing();
    if (!this.deps.isSignedIn()) return { ok: false, error: { code: "signedOut", message: `Sign in to LANA on this ${this.deps.deviceNoun} to run actions.` } };
    if (!this.deps.isEntitled()) return { ok: false, error: { code: "notEntitled", message: NOT_ENTITLED_MESSAGE } };
    const result = card.result;
    if (card.phase.kind !== "executed" || result === null || result.undo.expiresAt.getTime() < this.now().getTime()) {
      return { ok: false, error: { code: "undoClosed", message: "The undo window has closed." } };
    }
    try {
      await this.deps.service().undo(result.undo);
      card.stored = this.deps.store.intents.transition(card.id, "undone", "user", { external_id: result.externalID });
      await this.deps.store.appendAudit(AUDIT_EVENTS.actionUndone, card.id, { executor: result.undo.executor, external_id: result.externalID });
      card.phase = { kind: "undone" };
      card.actionError = null;
    } catch (error) {
      card.actionError = error instanceof ActionServiceError && error.code === "not_connected" ? "Reconnect the service in Connections to undo." : this.failure(error).message;
      return { ok: false, error: { code: "undoFailed", message: card.actionError } };
    }
    this.changed();
    return { ok: true, value: this.view(card) };
  }

  async dismiss(id: string): Promise<Result<ActionCard>> {
    return this.withCard(id, async (card) => {
      if (!this.canDismiss(card)) return "This action can no longer be dismissed.";
      card.stored = this.deps.store.intents.transition(card.id, "dismissed", "user");
      card.phase = { kind: "dismissed" };
      this.deps.log.info("actions.dismissed", { intent: card.id });
      return null;
    });
  }

  // MARK: - Private: loading

  private isVisible(stored: StoredIntent, now: Date): boolean {
    if (stored.intent.status !== "executed") return true;
    const result = decodeStoredResolution(stored.resolution)?.result;
    return result !== undefined && now.getTime() <= result.undo.expiresAt.getTime();
  }

  private makeCard(stored: StoredIntent, record: MeetingRecord): Card {
    const params = stored.intent.params;
    return {
      id: stored.intent.id,
      meetingID: record.id,
      stored,
      speakers: new Map(record.speakers.map((speaker) => [speaker.id, speakerDisplayName(speaker)])),
      phase: { kind: "review" },
      target: { kind: "notRequired" },
      rows: params.type === "email.draft" ? params.email.to.map((hint, index) => ({ id: index, hint, state: { kind: "resolving" } })) : [],
      offered: new Map(),
      plan: null,
      planProblem: null,
      actionError: null,
      result: null,
    };
  }

  /** Swift `ActionCardViewModel.prepare`. */
  private async prepare(card: Card): Promise<void> {
    if (executorFor(card.stored.intent.type) === null) {
      card.phase = { kind: "unsupported" };
      card.target = { kind: "notRequired" };
      return;
    }
    const saved = decodeStoredResolution(card.stored.resolution);
    switch (card.stored.intent.status) {
      case "executed":
        if (saved !== null) this.apply(card, saved.target);
        if (saved?.result !== undefined) {
          card.result = saved.result;
          card.phase = { kind: "executed", externalID: saved.result.externalID, deduplicated: saved.result.deduplicated, undoExpiresAt: saved.result.undo.expiresAt.toISOString() };
        }
        return;
      case "undone":
        card.phase = { kind: "undone" };
        return;
      case "dismissed":
        card.phase = { kind: "dismissed" };
        return;
      case "confirmed":
        card.phase = { kind: "interrupted" };
        break;
      case "failed": {
        const reason = this.deps.store.intents.history(card.id).filter((event) => event.to === "failed").at(-1)?.detail["reason"];
        card.phase = { kind: "failed", reason: failureMessage(reason) };
        break;
      }
      default:
        card.phase = { kind: "review" };
    }
    if (saved !== null) this.apply(card, saved.target);
    if (!this.isSettled(card)) await this.resolveTargets(card);
    await this.refreshPlan(card);
  }

  private apply(card: Card, target: ResolvedTarget): void {
    if (this.requiresTarget(card)) {
      if (target.regarding !== undefined) {
        const entity = target.regarding;
        const choice: TargetChoice = { id: `${entity.kind}:${entity.id}`, kind: entity.kind === "matter" ? "matter" : "contact", displayName: entity.displayName, detail: null, email: null, reasons: [] };
        card.offered.set(choice.id, { choice, entity });
        card.target = { kind: "resolved", choice, chosenByPerson: true };
      }
    } else {
      card.target = { kind: "notRequired" };
    }
    target.recipients.forEach((recipient, index) => {
      const row = card.rows[index];
      if (row !== undefined && recipient.address !== null) row.state = { kind: "resolved", address: recipient.address, name: recipient.displayName, reason: "Chosen earlier" };
    });
  }

  private async resolveTargets(card: Card): Promise<void> {
    const service = this.deps.service();
    const regarding = this.regardingHint(card);
    if (this.requiresTarget(card)) {
      if (regarding === undefined) {
        card.target = { kind: "noMatch" };
      } else {
        const query: EntityHint = card.stored.intent.type === "task.create" ? { kind: "matter", name: regarding.name } : regarding;
        try {
          card.target = this.targetState(card, await service.resolve(query));
        } catch {
          card.target = { kind: "failed", message: "Could not search records right now. Search below to choose." };
        }
      }
    } else {
      card.target = { kind: "notRequired" };
    }
    for (const row of card.rows) {
      if (row.state.kind === "resolved") continue;
      row.state = await this.recipientState(card, row.hint);
    }
    if (this.isSettled(card)) await this.persistResolution(card, "system");
  }

  private targetState(card: Card, resolution: Resolution): TargetState {
    switch (resolution.kind) {
      case "match":
        return { kind: "resolved", choice: this.offer(card, resolution.candidate, resolution.reasons).choice, chosenByPerson: false };
      case "ambiguous":
        return { kind: "ambiguous", choices: resolution.candidates.slice(0, AMBIGUOUS_LIMIT).map((item) => this.offer(card, item.candidate, item.reasons).choice) };
      case "noMatch":
        return { kind: "noMatch" };
    }
  }

  private async recipientState(card: Card, hint: EntityHint): Promise<RecipientState> {
    if (hint.email !== undefined && isValidEmail(hint.email)) {
      return { kind: "resolved", address: hint.email, name: hint.name === "" ? hint.email : hint.name, reason: "Address said in the meeting" };
    }
    let resolution: Resolution;
    try {
      resolution = await this.deps.service().resolve({ kind: "contact", name: hint.name });
    } catch {
      return { kind: "unresolved" };
    }
    switch (resolution.kind) {
      case "match":
        return resolution.candidate.email
          ? { kind: "resolved", address: resolution.candidate.email, name: resolution.candidate.name, reason: resolution.reasons[0] ?? "Matched" }
          : { kind: "unresolved" };
      case "ambiguous": {
        const choices = resolution.candidates.filter((item) => item.candidate.email).slice(0, AMBIGUOUS_LIMIT).map((item) => this.offer(card, item.candidate, item.reasons).choice);
        return choices.length === 0 ? { kind: "unresolved" } : { kind: "ambiguous", choices };
      }
      case "noMatch":
        return { kind: "unresolved" };
    }
  }

  private offer(card: Card, candidate: TargetCandidate, reasons: readonly string[] = []): { choice: TargetChoice; entity: ResolvedEntity } {
    const offered = choiceFor(candidate, reasons);
    card.offered.set(offered.choice.id, offered);
    return offered;
  }

  // MARK: - Private: persistence

  /** Swift `persistResolution`: saves the settled target and moves transferred to resolved. */
  private async persistResolution(card: Card, actor: "user" | "system"): Promise<void> {
    if (!this.isSettled(card)) return;
    const { store } = this.deps;
    try {
      store.intents.setResolution(card.id, encodeStoredResolution({ target: this.currentTarget(card) }));
      const detail = { target: this.currentTarget(card).regarding?.kind ?? "recipients" };
      const status = card.stored.intent.status;
      if (status === "transferred" || (status === "resolved" && actor === "user")) store.intents.transition(card.id, "resolved", actor, detail);
      card.stored = store.intents.get(card.id);
    } catch (error) {
      card.actionError = this.failure(error).message;
    }
    this.changed();
  }

  /** Saves new params (and a typed address on row `rowID`), keeping a settled target. */
  private async applyEdit(card: Card, params: IntentParams, rowID: number | null, address: string | null): Promise<string | null> {
    if (!this.isEditable(card)) return "This action can no longer be edited.";
    let next = params;
    if (next.type === "email.draft" && rowID !== null && address !== null) {
      next = { type: "email.draft", email: { ...next.email, to: next.email.to.map((hint, index) => (index === rowID ? { ...hint, email: address } : hint)) } };
    }
    try {
      const settled = this.isSettled(card);
      card.stored = this.deps.store.intents.updateParams(card.id, next);
      if (next.type === "email.draft") next.email.to.forEach((hint, index) => {
        const row = card.rows[index];
        if (row !== undefined) row.hint = hint;
      });
      // The store clears the resolution on edit; the target the person settled still stands.
      if (settled) {
        this.deps.store.intents.setResolution(card.id, encodeStoredResolution({ target: this.currentTarget(card) }));
        card.stored = this.deps.store.intents.get(card.id);
      }
      card.actionError = null;
      await this.refreshPlan(card);
      return null;
    } catch (error) {
      return this.failure(error).message;
    }
  }

  private async refreshPlan(card: Card): Promise<void> {
    card.plan = null;
    card.planProblem = null;
    if (!["review", "failed", "interrupted"].includes(card.phase.kind) || !this.isSettled(card)) return;
    try {
      const outcome = await this.deps.service().plan(card.stored.intent, this.currentTarget(card));
      if (outcome.ok) card.plan = outcome.plan;
      else card.planProblem = outcome.message;
    } catch (error) {
      card.planProblem = this.failure(error).message;
    }
  }

  // MARK: - Private: rules

  private currentTarget(card: Card): ResolvedTarget {
    const regarding = card.target.kind === "resolved" ? card.offered.get(card.target.choice.id)?.entity : undefined;
    return {
      regarding,
      recipients: card.rows.map((row) =>
        row.state.kind === "resolved"
          ? { hint: row.hint, address: row.state.address, displayName: row.state.name }
          : { hint: row.hint, address: null, displayName: row.hint.name }),
    };
  }

  private regardingHint(card: Card): EntityHint | undefined {
    const params = card.stored.intent.params;
    switch (params.type) {
      case "note.log":
        return params.note.regarding;
      case "task.create":
        return params.task.regarding;
      case "email.draft":
        return params.email.regarding;
      case "unsupported":
        return undefined;
    }
  }

  private requiresTarget(card: Card): boolean {
    return card.stored.intent.type === "note.log" || card.stored.intent.type === "task.create";
  }

  private isSettled(card: Card): boolean {
    if (this.requiresTarget(card)) return card.target.kind === "resolved";
    if (card.stored.intent.type === "email.draft") return card.rows.length > 0 && card.rows.every((row) => row.state.kind === "resolved");
    return true;
  }

  private isEditable(card: Card): boolean {
    return (card.phase.kind === "review" || card.phase.kind === "failed") && EDITABLE_STATUSES.has(card.stored.intent.status);
  }

  private canDismiss(card: Card): boolean {
    return ["review", "failed", "unsupported"].includes(card.phase.kind) && EDITABLE_STATUSES.has(card.stored.intent.status);
  }

  private titleLabel(card: Card): string {
    return card.stored.intent.type === "task.create" ? "Task" : "Subject";
  }

  /** Swift `confirmBlockReason`, in the same order. */
  private confirmBlockReason(card: Card): string | null {
    if (!["review", "failed", "interrupted"].includes(card.phase.kind)) return null;
    if (!this.deps.isSignedIn()) return `Sign in to LANA on this ${this.deps.deviceNoun} to run actions.`;
    if (!this.deps.isEntitled()) return NOT_ENTITLED_MESSAGE;
    if (this.requiresTarget(card) && card.target.kind !== "resolved") {
      return card.stored.intent.type === "task.create" ? "Choose the matter for this task." : "Choose the matter or contact for this note.";
    }
    if (card.stored.intent.type === "email.draft") {
      const missing = card.rows.filter((row) => row.state.kind !== "resolved").length;
      if (card.rows.length === 0) return "Add a recipient.";
      if (missing > 0) return missing === 1 ? "One recipient needs an email address." : `${missing} recipients need email addresses.`;
    }
    if (card.planProblem !== null) return card.planProblem;
    if (card.plan === null) return "Preparing the request.";
    return null;
  }

  private confirmTitle(card: Card): string {
    const target = card.target.kind === "resolved" ? card.target.choice.displayName : null;
    switch (card.stored.intent.type) {
      case "note.log":
        return target ? `Add note to ${target}` : "Add note";
      case "task.create":
        return target ? `Create task on ${target}` : "Create task";
      case "email.draft": {
        const names = card.rows.flatMap((row) => (row.state.kind === "resolved" ? [row.state.name] : []));
        const first = names[0];
        if (first === undefined) return "Save draft";
        return names.length > 1 ? `Save draft to ${first} and ${names.length - 1} more` : `Save draft to ${first}`;
      }
      default:
        return "Not available";
    }
  }

  private failure(error: unknown): { code: string; message: string } {
    if (error instanceof ActionServiceError) return { code: error.code, message: error.message };
    if (error instanceof StoreError) return { code: "store", message: `LANA could not save this change on this ${this.deps.deviceNoun}. Try again.` };
    return { code: "unknown", message: "Something went wrong. Try again." };
  }

  // MARK: - Private: presentation

  private view(card: Card): ActionCard {
    const intent = card.stored.intent;
    const params = intent.params;
    const type = kindOf(intent.type);
    const draft: ActionDraft =
      params.type === "note.log" ? { title: params.note.subject, body: params.note.body, dueDate: null }
        : params.type === "task.create" ? { title: params.task.title, body: params.task.detail, dueDate: params.task.dueDate ?? null }
          : params.type === "email.draft" ? { title: params.email.subject, body: params.email.body, dueDate: null }
            : { title: displayTitleOf(params), body: "", dueDate: null };
    const raw = params.type === "unsupported" && params.raw !== null && typeof params.raw === "object" && !Array.isArray(params.raw) ? (params.raw as Record<string, JsonValue>) : null;
    const plan = ["review", "failed", "interrupted"].includes(card.phase.kind) && card.plan !== null && this.confirmBlockReason(card) === null
      ? { method: card.plan.method, url: card.plan.url, body: card.plan.body, planHash: card.plan.planHash }
      : null;
    const rows: RecipientRow[] = card.rows.map((row) => ({ id: row.id, name: row.hint.name, state: row.state }));
    return {
      id: card.id,
      meetingID: card.meetingID,
      type,
      typeTitle: { note: "Log a note", task: "Create a task", email: "Draft an email", unsupported: "Needs a newer LANA" }[type],
      destinationLabel: type === "email" ? "Outlook draft, not sent" : type === "unsupported" ? intent.type : "Clio",
      titleLabel: this.titleLabel(card),
      bodyLabel: type === "task" ? "Details" : type === "email" ? "Message" : "Note",
      draft,
      phase: card.phase,
      target: card.target,
      spokenTarget: this.requiresTarget(card) ? (this.regardingHint(card)?.name ?? null) : null,
      recipients: rows,
      evidence: intent.evidence.map((item, index) => ({
        id: index,
        speaker: card.speakers.get(item.speaker) ?? item.speaker,
        quote: [...item.quote].slice(0, QUOTE_LIMIT).join(""),
        start: item.tStart,
        end: item.tEnd,
      })),
      unsupportedFields: raw === null ? [] : Object.keys(raw).sort().map((key) => {
        const words = key.replaceAll("_", " ");
        return { label: words.charAt(0).toUpperCase() + words.slice(1), value: describe(raw[key] ?? null) };
      }),
      plan,
      isEditable: this.isEditable(card),
      canDismiss: this.canDismiss(card),
      confirmTitle: this.confirmTitle(card),
      confirmBlockReason: this.confirmBlockReason(card),
      actionError: card.actionError,
      startingPoint: card.phase.kind === "review" && this.deps.drafts?.isStartingPoint(card.id) === true,
    };
  }

  private proposedActions(): Result<ProposedAction[]> {
    try {
      const { store } = this.deps;
      const now = this.now();
      const titles = new Map(store.meetings.list().map((meeting) => [meeting.id, meeting.title]));
      return {
        ok: true,
        value: store.intents.list({ statuses: VISIBLE_STATUSES }).filter((stored) => this.isVisible(stored, now)).map((stored) => {
          const intent = stored.intent;
          const status: ProposedAction["status"] = intent.status === "executed" ? "executed" : intent.status === "failed" ? "failed"
            : stored.resolution === null && executorFor(intent.type) !== null ? "needsChoice" : "ready";
          return {
            id: intent.id,
            meetingID: intent.meetingID,
            meetingTitle: titles.get(intent.meetingID) ?? "",
            kind: kindOf(intent.type),
            title: displayTitleOf(intent.params),
            destination: executorFor(intent.type) === null ? intent.type : connectorNameFor(intent.type) === "Clio" ? "Clio" : "Outlook",
            status,
          };
        }),
      };
    } catch {
      return { ok: false, error: { code: "store", message: `LANA could not read the inbox on this ${this.deps.deviceNoun}.` } };
    }
  }

  private async withCard(id: string, change: (card: Card) => Promise<string | null>): Promise<Result<ActionCard>> {
    const card = this.cards.get(String(id));
    if (card === undefined || parseLanaId(String(id), "intent") === null) return this.missing();
    let problem: string | null;
    try {
      problem = await change(card);
    } catch (error) {
      problem = this.failure(error).message;
    }
    if (problem !== null) return { ok: false, error: { code: "invalid", message: problem } };
    this.changed();
    return { ok: true, value: this.view(card) };
  }

  private missing<T>(): Result<T> {
    return { ok: false, error: { code: "notFound", message: `That action is no longer on this ${this.deps.deviceNoun}.` } };
  }

  private changed(): void {
    this.deps.onChange(this.pendingCount());
  }
}
