import {
  actionPermissions, bodyLabelOf, draftRowStatusOf, fieldsProblem, kindOfType, listActions, normalizeListQuery, originLabelOf, paramsFromFields,
  rowStatusOf, searchFacets, titleLabelOf, typeTitleOf, type ActionListItem, type ActionListQuery,
} from "@lana/core/actions";
import { parseLanaId, type LanaId } from "@lana/core/ids";
import { bodyOf, displayTitleOf, speakerDisplayName, type MeetingRecord } from "@lana/core/intent";
import type { JsonValue } from "@lana/core/json";
import { StoreError, type GatewayStore, type StoredAction, type StoredClipDraft } from "@lana/core/store";
import { describeAuditEntry, type AuditNames } from "../../../shared/auditDisplay.js";
import type {
  ActionDetail, ActionFields, ActionListRequest, ActionPage, ActionPhase, ActionsApi, InboxApi, MatterHit, NewActionDraft, ProposedAction, Result,
} from "../../../shared/api.js";
import type { MainLog } from "../../log.js";
import type { ResolvedTarget } from "./actionRecords.js";
import { decodeStoredResolution, encodeStoredResolution } from "./storedResolution.js";

const QUOTE_LIMIT = 600;

/**
 * What the action page shows for running, decided by the run side (the LANA executors).
 * The pages service never runs anything itself.
 */
export interface RunGate {
  phase: ActionPhase;
  canRun: boolean;
  /** "Create task on 00042 Acme Logistics". */
  runTitle: string;
  runBlockReason: string | null;
  canUndo: boolean;
  lanaURL: string | null;
  /** The last run or undo problem, in plain words. */
  actionError: string | null;
}

/** Runs and undoes actions on LANA. Stream B's LANA executors implement it. */
export interface ActionRunner {
  run(action: StoredAction): Promise<Result<null>>;
  undo(action: StoredAction): Promise<Result<null>>;
  gate(action: StoredAction): RunGate;
}

/** What the inbox event carries: actions waiting (tray, summary line) and unread ones (the badge). */
export interface InboxCounts {
  readonly pending: number;
  readonly unread: number;
}

export interface ActionPagesDependencies {
  readonly store: GatewayStore;
  readonly runner: () => ActionRunner;
  /** Background drafts: shown as waiting or drafting rows; starting points are flagged. */
  readonly drafts?: Pick<{ open(): StoredClipDraft[]; isStartingPoint(id: string): boolean }, "open" | "isStartingPoint">;
  /** "computer". */
  readonly deviceNoun: string;
  /** Called after any change, with the counts. */
  readonly onChange: (counts: InboxCounts) => void;
  readonly log: MainLog;
}

/** The matter kept in the resolution (target.regarding), as the page shows it. */
export function matterOf(resolution: Uint8Array | null): MatterHit | null {
  const regarding = decodeStoredResolution(resolution)?.target.regarding;
  return regarding === undefined || regarding.kind !== "matter" ? null : { id: regarding.id, label: regarding.displayName, detail: null };
}

/** The resolution after the person chose (or cleared) the matter; recipients stay, a stale plan and result go. */
export function resolutionWithMatter(previous: Uint8Array | null, matter: MatterHit | null): Uint8Array | null {
  const before = decodeStoredResolution(previous)?.target;
  const target: ResolvedTarget = {
    regarding: matter === null ? undefined : { kind: "matter", id: matter.id, displayName: matter.label },
    assignee: before?.assignee,
    recipients: before?.recipients ?? [],
  };
  if (target.regarding === undefined && target.assignee === undefined && target.recipients.length === 0) return null;
  return encodeStoredResolution({ target });
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
 * The Inbox list and the action pages over the store: list, open, add by hand, save,
 * soft delete and restore. Run and undo go to the injected `ActionRunner`. Rules are in
 * core (`@lana/core/actions`); this maps them to the bridge. Logs ids and counts only.
 */
export class ActionPagesService implements ActionsApi {
  readonly inbox: InboxApi;

  constructor(private readonly deps: ActionPagesDependencies) {
    this.inbox = {
      pendingCount: async () => this.pendingCount(),
      unreadCount: async () => this.unreadCount(),
      list: async () => this.proposed(),
    };
  }

  /** Unread actions, not deleted, any type or status: the Inbox badge. */
  unreadCount(): number {
    try {
      return this.deps.store.actions.unreadCount();
    } catch {
      return 0;
    }
  }

  counts(): InboxCounts {
    return { pending: this.pendingCount(), unread: this.unreadCount() };
  }

  /** Actions waiting for the person (to review, failed or stopped, not deleted, runnable types) and drafts on their way. */
  pendingCount(): number {
    try {
      const open = this.deps.store.actions.list({ status: ["review", "failed", "interrupted"], kind: ["task", "note", "email"] }).length;
      return open + (this.deps.drafts?.open().filter((draft) => draft.kind !== "decision" && draft.status !== "ready").length ?? 0);
    } catch {
      return 0;
    }
  }

  // MARK: - ActionsApi

  async list(request: ActionListRequest): Promise<Result<ActionPage>> {
    const query = normalizeListQuery(request);
    try {
      const items = this.items(query);
      const page = listActions(items, query);
      return { ok: true, value: { ...page, rows: page.rows.map(({ detail: _detail, ...row }) => row), facets: searchFacets(items) } };
    } catch {
      this.deps.log.error("actions.list_failed");
      return this.storeProblem();
    }
  }

  async get(id: string): Promise<Result<ActionDetail>> {
    const actionID = parseLanaId(String(id), "intent");
    if (actionID === null) return this.missing();
    try {
      return { ok: true, value: this.detail(actionID) };
    } catch (error) {
      return this.failed(error);
    }
  }

  async create(draft: NewActionDraft): Promise<Result<ActionDetail>> {
    const kind = draft?.kind === "note" ? "note" : draft?.kind === "task" ? "task" : null;
    if (kind === null) return this.invalid("Choose a task or a note.");
    const fields = this.fields(draft);
    const problem = fieldsProblem(kind, fields);
    if (problem !== null) return this.invalid(problem);
    let meetingID: LanaId | null = null;
    if (draft.meetingID !== null && draft.meetingID !== undefined && String(draft.meetingID) !== "") {
      meetingID = parseLanaId(String(draft.meetingID), "meeting");
      if (meetingID === null || !this.deps.store.meetings.list().some((meeting) => meeting.id === meetingID)) return this.invalid("That meeting is no longer on this " + this.deps.deviceNoun + ".");
    }
    try {
      const stored = this.deps.store.actions.createManual({
        params: paramsFromFields(kind, fields, null),
        meetingID,
        resolution: resolutionWithMatter(null, this.matter(draft.matter)),
      });
      this.deps.log.info("actions.created_manually", { action: stored.id, linked: meetingID !== null });
      this.changed();
      return { ok: true, value: this.detail(stored.id) };
    } catch (error) {
      return this.failed(error);
    }
  }

  async save(id: string, input: ActionFields): Promise<Result<ActionDetail>> {
    const actionID = parseLanaId(String(id), "intent");
    if (actionID === null) return this.missing();
    try {
      const current = this.deps.store.actions.get(actionID);
      const kind = kindOfType(current.type);
      const permissions = actionPermissions({ kind, status: current.status, deleted: current.deletedAt !== null });
      if (!permissions.isEditable || kind === "unsupported") return this.invalid("This action can no longer be edited.");
      const fields = this.fields(input);
      const problem = fieldsProblem(kind, fields);
      if (problem !== null) return this.invalid(problem);
      const matter = kind === "email" ? matterOf(current.resolution) : this.matter(input?.matter);
      this.deps.store.actions.save(actionID, paramsFromFields(kind, fields, current.params), resolutionWithMatter(current.resolution, matter));
      this.deps.log.info("actions.saved", { action: actionID });
      this.changed();
      return { ok: true, value: this.detail(actionID) };
    } catch (error) {
      return this.failed(error);
    }
  }

  async run(id: string): Promise<Result<ActionDetail>> {
    return this.withRunner(id, (runner, action) => runner.run(action));
  }

  async undo(id: string): Promise<Result<ActionDetail>> {
    return this.withRunner(id, (runner, action) => runner.undo(action));
  }

  async remove(id: string): Promise<Result<ActionDetail>> {
    return this.mark(id, true);
  }

  async restore(id: string): Promise<Result<ActionDetail>> {
    return this.mark(id, false);
  }

  async markRead(id: string): Promise<Result<null>> {
    const actionID = parseLanaId(String(id), "intent");
    if (actionID === null) return this.missing();
    try {
      const before = this.deps.store.actions.get(actionID);
      if (before.seenAt !== null) return { ok: true, value: null };
      this.deps.store.actions.markRead(actionID);
      this.changed();
      return { ok: true, value: null };
    } catch (error) {
      return this.failed(error);
    }
  }

  async markAllRead(): Promise<Result<null>> {
    try {
      const marked = this.deps.store.actions.markAllRead();
      this.deps.log.info("actions.marked_all_read", { actions: marked });
      if (marked > 0) this.changed();
      return { ok: true, value: null };
    } catch (error) {
      return this.failed(error);
    }
  }

  // MARK: - Detail

  /** The page for one action, with its run gate and history. */
  detail(id: LanaId): ActionDetail {
    const { store } = this.deps;
    const stored = store.actions.get(id);
    const record = this.meeting(stored.meetingID);
    const kind = kindOfType(stored.type);
    const params = stored.params;
    const gate = this.deps.runner().gate(stored);
    const deleted = stored.deletedAt !== null;
    const permissions = actionPermissions({ kind, status: stored.status, deleted });
    const speakers = new Map(record?.speakers.map((speaker) => [speaker.id, speakerDisplayName(speaker)]) ?? []);
    const raw = params.type === "unsupported" && params.raw !== null && typeof params.raw === "object" && !Array.isArray(params.raw) ? (params.raw as Record<string, JsonValue>) : null;
    const fields: ActionFields =
      params.type === "note.log" ? { title: params.note.subject, body: params.note.body, dueDate: null, matter: matterOf(stored.resolution) }
        : params.type === "task.create" ? { title: params.task.title, body: params.task.detail, dueDate: params.task.dueDate ?? null, matter: matterOf(stored.resolution) }
          : params.type === "email.draft" ? { title: params.email.subject, body: params.email.body, dueDate: null, matter: matterOf(stored.resolution) }
            : { title: displayTitleOf(params), body: "", dueDate: null, matter: null };
    const spoken = params.type === "note.log" ? params.note.regarding?.name : params.type === "task.create" ? params.task.regarding?.name : undefined;
    const origin = stored.origin;
    return {
      id: stored.id,
      kind,
      typeTitle: typeTitleOf(kind),
      titleLabel: titleLabelOf(kind),
      bodyLabel: bodyLabelOf(kind),
      fields,
      spokenMatter: spoken ?? null,
      origin,
      originLabel: originLabelOf(origin, record?.title ?? null),
      meetingID: stored.meetingID,
      meetingTitle: record?.title ?? null,
      evidence: stored.evidence.map((item, index) => ({
        id: index,
        speaker: speakers.get(item.speaker) ?? item.speaker,
        quote: [...item.quote].slice(0, QUOTE_LIMIT).join(""),
        start: item.tStart,
        end: item.tEnd,
      })),
      status: rowStatusOf(stored.status, kind),
      phase: kind === "unsupported" ? { kind: "unsupported" } : gate.phase,
      createdAt: stored.createdAt.toISOString(),
      updatedAt: stored.updatedAt.toISOString(),
      deletedAt: stored.deletedAt?.toISOString() ?? null,
      isEditable: permissions.isEditable,
      canRun: !deleted && kind !== "unsupported" && gate.canRun,
      runTitle: gate.runTitle,
      runBlockReason: deleted ? "Restore this action to run it." : gate.runBlockReason,
      canUndo: !deleted && gate.canUndo,
      canDelete: permissions.canDelete,
      canRestore: permissions.canRestore,
      deleteNote: permissions.deleteNote,
      lanaURL: gate.lanaURL,
      unsupportedFields: raw === null ? [] : Object.keys(raw).sort().map((key) => {
        const words = key.replaceAll("_", " ");
        return { label: words.charAt(0).toUpperCase() + words.slice(1), value: describe(raw[key] ?? null) };
      }),
      startingPoint: rowStatusOf(stored.status, kind) === "review" && this.deps.drafts?.isStartingPoint(stored.id) === true,
      actionError: gate.actionError,
      history: this.history(stored, record),
      unread: stored.seenAt === null,
    };
  }

  // MARK: - Private

  /**
   * Every row on the deleted or the live side, plus open action drafts on the live side. Only
   * the deleted flag goes to SQL: the search suggestions need every meeting and matter on that
   * side, and `listActions` applies the other filters.
   */
  private items(query: ActionListQuery): ActionListItem[] {
    const { store } = this.deps;
    const titles = new Map(store.meetings.list().map((meeting) => [meeting.id as string, meeting.title]));
    const items: ActionListItem[] = store.actions.list({ status: [], kind: [], deleted: query.filters.deleted }).map((stored) => ({
      id: stored.id,
      kind: kindOfType(stored.type),
      title: displayTitleOf(stored.params),
      detail: bodyOf(stored.params),
      meetingID: stored.meetingID,
      meetingTitle: stored.meetingID === null ? null : (titles.get(stored.meetingID) ?? null),
      matter: matterOf(stored.resolution),
      status: rowStatusOf(stored.status, kindOfType(stored.type)),
      origin: stored.origin,
      createdAt: stored.createdAt.toISOString(),
      updatedAt: stored.updatedAt.toISOString(),
      deletedAt: stored.deletedAt?.toISOString() ?? null,
      unread: stored.seenAt === null,
    }));
    if (query.filters.deleted !== true) {
      for (const draft of this.deps.drafts?.open() ?? []) {
        if (draft.kind === "decision" || draft.status === "ready") continue;
        const record = this.meeting(draft.meetingID);
        const question = draft.questionID === undefined ? null : (record?.notes.keyPoints.find((point) => point.id === draft.questionID)?.text ?? null);
        items.push({
          id: draft.id,
          kind: null,
          title: question ?? "Action from a clip",
          detail: "",
          meetingID: draft.meetingID,
          meetingTitle: titles.get(draft.meetingID) ?? null,
          matter: null,
          status: draftRowStatusOf(draft.status),
          origin: "draft",
          createdAt: draft.createdAt.toISOString(),
          updatedAt: draft.createdAt.toISOString(),
          deletedAt: null,
          unread: false,
        });
      }
    }
    return items;
  }

  private history(stored: StoredAction, record: MeetingRecord | null): ActionDetail["history"] {
    const names: AuditNames = {
      meetings: new Map(record === null ? [] : [[record.id, record.title]]),
      devices: new Map(),
      actions: new Map([[stored.id, displayTitleOf(stored.params)]]),
    };
    return this.deps.store.actions.history(stored.id).map((entry) => {
      let detail: Record<string, string> = {};
      try {
        detail = JSON.parse(entry.detail) as Record<string, string>;
      } catch {
        detail = {};
      }
      return {
        seq: entry.seq,
        at: entry.at.toISOString(),
        event: entry.event,
        sentence: describeAuditEntry({ at: entry.at, event: entry.event, subject: entry.subject, detail }, names).sentence,
      };
    });
  }

  private meeting(id: LanaId | null): MeetingRecord | null {
    if (id === null) return null;
    try {
      return this.deps.store.meetings.get(id);
    } catch {
      return null;
    }
  }

  private fields(input: Partial<ActionFields> | undefined): { title: string; body: string; dueDate: string | null } {
    return {
      title: typeof input?.title === "string" ? input.title : "",
      body: typeof input?.body === "string" ? input.body : "",
      dueDate: typeof input?.dueDate === "string" && input.dueDate !== "" ? input.dueDate : null,
    };
  }

  /** A matter from the bridge, checked: an id and a label, nothing else is kept. */
  private matter(input: unknown): MatterHit | null {
    if (input === null || typeof input !== "object") return null;
    const value = input as Record<string, unknown>;
    const id = typeof value["id"] === "string" ? value["id"].trim() : "";
    const label = typeof value["label"] === "string" ? value["label"].trim() : "";
    if (id === "" || label === "") return null;
    return { id: id.slice(0, 200), label: label.slice(0, 300), detail: null };
  }

  private async withRunner(id: string, act: (runner: ActionRunner, action: StoredAction) => Promise<Result<null>>): Promise<Result<ActionDetail>> {
    const actionID = parseLanaId(String(id), "intent");
    if (actionID === null) return this.missing();
    try {
      const action = this.deps.store.actions.get(actionID);
      if (action.deletedAt !== null) return this.invalid("Restore this action to run it.");
      const outcome = await act(this.deps.runner(), action);
      this.changed();
      if (!outcome.ok) return outcome;
      return { ok: true, value: this.detail(actionID) };
    } catch (error) {
      return this.failed(error);
    }
  }

  private async mark(id: string, deleted: boolean): Promise<Result<ActionDetail>> {
    const actionID = parseLanaId(String(id), "intent");
    if (actionID === null) return this.missing();
    try {
      const current = this.deps.store.actions.get(actionID);
      const permissions = actionPermissions({ kind: kindOfType(current.type), status: current.status, deleted: current.deletedAt !== null });
      if (deleted && !permissions.canDelete) return this.invalid(current.deletedAt !== null ? "This action is already deleted." : "This action is running. Wait for it to finish.");
      if (!deleted && !permissions.canRestore) return this.invalid("This action is not deleted.");
      if (deleted) this.deps.store.actions.remove(actionID);
      else this.deps.store.actions.restore(actionID);
      this.deps.log.info(deleted ? "actions.deleted" : "actions.restored", { action: actionID });
      this.changed();
      return { ok: true, value: this.detail(actionID) };
    } catch (error) {
      return this.failed(error);
    }
  }

  private proposed(): Result<ProposedAction[]> {
    try {
      const { store } = this.deps;
      const titles = new Map(store.meetings.list().map((meeting) => [meeting.id as string, meeting.title]));
      return {
        ok: true,
        value: store.actions.list({ status: ["review", "failed", "interrupted"], kind: [] }).map((stored) => {
          const kind = kindOfType(stored.type);
          return {
            id: stored.id,
            meetingID: stored.meetingID ?? "",
            meetingTitle: stored.meetingID === null ? "" : (titles.get(stored.meetingID) ?? ""),
            kind,
            title: displayTitleOf(stored.params),
            destination: kind === "unsupported" ? stored.type : "LANA",
            status: stored.status === "failed" ? "failed" : matterOf(stored.resolution) === null && kind !== "email" ? "needsChoice" : "ready",
          };
        }),
      };
    } catch {
      return this.storeProblem();
    }
  }

  private failed<T>(error: unknown): Result<T> {
    if (error instanceof StoreError && error.kind === "notFound") return this.missing();
    if (error instanceof StoreError && error.kind === "notEditable") return this.invalid("This action can no longer be changed.");
    this.deps.log.error("actions.change_failed", { code: error instanceof StoreError ? error.kind : "unknown" });
    return { ok: false, error: { code: "store", message: `LANA could not save this change on this ${this.deps.deviceNoun}. Try again.` } };
  }

  private storeProblem<T>(): Result<T> {
    return { ok: false, error: { code: "store", message: `LANA could not read the inbox on this ${this.deps.deviceNoun}.` } };
  }

  private invalid<T>(message: string): Result<T> {
    return { ok: false, error: { code: "invalid", message } };
  }

  private missing<T>(): Result<T> {
    return { ok: false, error: { code: "notFound", message: `That action is no longer on this ${this.deps.deviceNoun}.` } };
  }

  private changed(): void {
    this.deps.onChange(this.counts());
  }
}
