import type { HandoffGateway } from "@lana/core/gateway";
import { parseLanaId, type LanaId } from "@lana/core/ids";
import {
  decodeIntent, removingClip, savingClip, titleOf,
  type MeetingRecord, type RecordConflict, type TranscriptClip as CoreClip,
} from "@lana/core/intent";
import { randomUUID } from "node:crypto";
import type { JsonValue } from "@lana/core/json";
import { EDITABLE_STATUSES, StoreError } from "@lana/core/store";
import type {
  CancelSendView, ConflictChoiceView, DraftCard, DraftKind, LanaEvent, RecordConflictView, RecordsApi, Result, SharedRecordView, TranscriptClip,
} from "../../shared/api.js";
import type { MainLog } from "../log.js";
import type { DraftDiagnosticsSink } from "../services/draftDiagnostics.js";
import { ClipDraftQueue, type ClipDrafting } from "./clipDraftQueue.js";

const NOT_FOUND = { code: "notFound", message: "That meeting is no longer on this computer." } as const;
const STORE_FAILED = { code: "store", message: "LANA could not save this change to its encrypted store." } as const;
const MAX_TITLE = 200;
const MAX_LINE = 10_000;

/** Bad input from the window (a range with no line, an unknown draft). Never carries content. */
class InvalidRecordInput extends Error {
  constructor(readonly userMessage: string) {
    super("invalid");
  }
}

export type { ClipDrafting };

/**
 * The shared meeting record on this computer (docs/ARCHITECTURE.md, "Shared meeting
 * record"): conflicts to reconcile, "Send to phone", and edits made here (title, speaker
 * names, transcript lines). Every change is stamped by the store and goes to the phone in
 * its next sync. Content goes to the window only, never to logs.
 */
export class RecordsService implements RecordsApi {
  /** LANA's background drafts; they land in the Inbox. */
  readonly drafting: ClipDraftQueue;
  private inboxChanged: () => void = () => undefined;

  constructor(
    private readonly gateway: Pick<HandoffGateway, "store" | "sendToPhone" | "cancelSend">,
    private readonly emit: (event: LanaEvent) => void,
    private readonly log: MainLog,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.drafting = new ClipDraftQueue({
      store: gateway.store,
      log,
      now,
      onMeetingChanged: (id) => this.emit({ type: "meetingChanged", meetingID: id }),
      onInboxChanged: () => this.inboxChanged(),
    });
  }

  /** The LANA model's drafter, once the models are set up. Without one every draft settles on its starting point. */
  useDrafter(drafter: ClipDrafting, diagnostics: Pick<DraftDiagnosticsSink, "outcome"> | null = null): void {
    this.drafting.useDrafter(drafter, diagnostics);
  }

  /** Called when drafts change what the Inbox counts. */
  onInboxChanged(listener: () => void): void {
    this.inboxChanged = listener;
  }

  async state(meetingID: string): Promise<Result<SharedRecordView>> {
    return this.run(meetingID, (id) => this.view(id, this.gateway.store.shared.current(id)));
  }

  async resolve(meetingID: string, unit: string, choice: ConflictChoiceView): Promise<Result<SharedRecordView>> {
    return this.run(meetingID, (id) => {
      const kind = choice?.kind === "phone" || choice?.kind === "desktop" ? choice.kind : "edited";
      const text = kind === "edited" ? String((choice as { text?: unknown }).text ?? "").slice(0, MAX_LINE) : "";
      const record = this.gateway.store.shared.resolve(id, String(unit), kind === "edited" ? { kind, text } : { kind });
      this.changed(id, "records.resolved");
      return this.view(id, record);
    });
  }

  async sendToPhone(meetingID: string, phoneID: string): Promise<Result<SharedRecordView>> {
    return this.run(meetingID, (id) => {
      const phone = parseLanaId(String(phoneID), "device");
      if (phone === null || !this.gateway.store.devices.list().some((device) => device.keys.deviceID === phone)) throw StoreError.notFound(String(phoneID));
      this.gateway.sendToPhone(id, phone);
      this.log.info("records.queued", { meeting: id, phone });
      return this.view(id, this.gateway.store.shared.current(id));
    });
  }

  async cancelSend(meetingID: string, phoneID: string): Promise<Result<CancelSendView>> {
    return this.run(meetingID, (id) => {
      const phone = parseLanaId(String(phoneID), "device");
      if (phone === null) throw StoreError.notFound(String(phoneID));
      const status = this.gateway.cancelSend(id, phone);
      this.log.info("records.send_cancel", { meeting: id, phone, status });
      return { status, record: this.view(id, this.gateway.store.shared.current(id)) };
    });
  }

  async rename(meetingID: string, title: string): Promise<Result<null>> {
    const trimmed = String(title).trim().slice(0, MAX_TITLE);
    if (trimmed === "") return { ok: false, error: { code: "invalid", message: "Add a title." } };
    return this.edit(meetingID, (record) => ({ ...record, title: trimmed }));
  }

  async renameSpeaker(meetingID: string, speakerID: string, name: string): Promise<Result<null>> {
    const trimmed = String(name).trim().slice(0, MAX_TITLE);
    return this.edit(meetingID, (record) => ({
      ...record,
      speakers: record.speakers.map((speaker) => (speaker.id === String(speakerID) ? { ...speaker, name: trimmed === "" ? undefined : trimmed } : speaker)),
    }));
  }

  async correctLine(meetingID: string, index: number, text: string): Promise<Result<null>> {
    const trimmed = String(text).trim().slice(0, MAX_LINE);
    if (trimmed === "") return { ok: false, error: { code: "invalid", message: "A line cannot be empty." } };
    return this.edit(meetingID, (record) => ({
      ...record,
      transcript: record.transcript.map((segment, offset) => (offset === Number(index) ? { ...segment, text: trimmed } : segment)),
    }));
  }

  // MARK: - Clips

  async saveClip(meetingID: string, first: number, last: number): Promise<Result<TranscriptClip>> {
    return this.run(meetingID, (id) => {
      const clip = this.clip(id, first, last);
      this.changed(id, "records.clip_saved");
      return { id: clip.id, start: clip.start, end: clip.end };
    });
  }

  async removeClip(meetingID: string, clipID: string): Promise<Result<null>> {
    return this.run(meetingID, (id) => {
      this.gateway.store.shared.edit(id, (record) => ({ ...record, clips: removingClip(record.clips, String(clipID)) }));
      this.changed(id, "records.clip_removed");
      return null;
    });
  }

  async requestDraft(meetingID: string, kind: DraftKind, first: number, last: number, questionID?: string): Promise<Result<DraftCard>> {
    return this.run(meetingID, (id) => {
      const draftKind = kind === "decision" ? "decision" : "action";
      const [low, high] = range(first, last);
      const question = questionID === undefined || questionID === null ? undefined : String(questionID);
      const record = this.gateway.store.shared.current(id);
      if (question !== undefined && (draftKind !== "action" || !record.notes.keyPoints.some((point) => point.id === question && point.kind === "open_question"))) {
        throw new InvalidRecordInput("That open question is no longer on this meeting.");
      }
      const clip = this.clip(id, low, high);
      this.changed(id, "records.clip_saved");
      const draft = this.drafting.request({ meetingID: id, kind: question === undefined ? draftKind : "question", firstLine: low, lastLine: high, clipID: clip.id, questionID: question });
      return this.drafting.card(draft, this.gateway.store.shared.current(id));
    });
  }

  async drafts(meetingID: string): Promise<Result<DraftCard[]>> {
    return this.run(meetingID, (id) => {
      const record = this.gateway.store.shared.current(id);
      const all = this.drafting.open();
      return all.filter((draft) => draft.meetingID === id).map((draft) => this.drafting.card(draft, record, all));
    });
  }

  async cancelDraft(draftID: string): Promise<Result<null>> {
    return this.drafting.cancel(String(draftID)) ? { ok: true, value: null } : { ok: false, error: { code: "notFound", message: "That draft is no longer open." } };
  }

  async addDecision(draftID: string, decision: string): Promise<Result<null>> {
    const value = text(decision, MAX_LINE);
    if (value.trim() === "") return { ok: false, error: { code: "invalid", message: "Write what was decided." } };
    try {
      const added = this.drafting.addDecision(String(draftID), value);
      return added === null ? { ok: false, error: { code: "notFound", message: "That draft is no longer open." } } : { ok: true, value: null };
    } catch {
      this.log.error("records.decision_failed");
      return { ok: false, error: STORE_FAILED };
    }
  }

  // MARK: - Private

  /** Saves the clip through the shared record, so it syncs. */
  private clip(id: LanaId, first: number, last: number): CoreClip {
    const [low, high] = range(first, last);
    let saved: CoreClip | undefined;
    this.gateway.store.shared.edit(id, (record) => {
      const result = savingClip(record.clips, record.transcript, low, high, randomUUID().toLowerCase(), this.now());
      if (result === undefined) throw new InvalidRecordInput("Pick at least one line.");
      saved = result.clip;
      return { ...record, clips: result.clips };
    });
    if (saved === undefined) throw new InvalidRecordInput("Pick at least one line.");
    return saved;
  }

  private async edit(meetingID: string, change: (record: MeetingRecord) => MeetingRecord): Promise<Result<null>> {
    return this.run(meetingID, (id) => {
      this.gateway.store.shared.edit(id, change);
      this.changed(id, "records.edited");
      return null;
    });
  }

  private changed(id: LanaId, event: string): void {
    this.log.info(event, { meeting: id });
    this.emit({ type: "meetingChanged", meetingID: id });
  }

  private async run<T>(meetingID: string, work: (id: LanaId) => T): Promise<Result<T>> {
    const id = parseLanaId(String(meetingID), "meeting");
    if (id === null) return { ok: false, error: NOT_FOUND };
    try {
      return { ok: true, value: work(id) };
    } catch (error) {
      if (error instanceof InvalidRecordInput) return { ok: false, error: { code: "invalid", message: error.userMessage } };
      if (error instanceof StoreError && error.kind === "notFound") return { ok: false, error: NOT_FOUND };
      if (error instanceof StoreError && error.kind === "notEditable") {
        return { ok: false, error: { code: "notEditable", message: "This action already ran or was dismissed here, so only this computer's version can be kept." } };
      }
      this.log.error("records.failed", { meeting: id });
      return { ok: false, error: STORE_FAILED };
    }
  }

  private view(id: LanaId, record: MeetingRecord): SharedRecordView {
    const store = this.gateway.store;
    const shared = new Set(store.devices.list().map((device) => device.keys.deviceID).filter((phone) => store.shared.isSharedWith(id, phone)));
    const declined = new Map(store.shared.declined(id).map((entry) => [entry.phoneDeviceID, entry.declinedAt.toISOString()] as const));
    const snoozed = new Map(store.shared.snoozed(id).map((entry) => [entry.phoneDeviceID, entry.snoozedAt.toISOString()] as const));
    const synced = store.shared.lastSynced(id);
    return {
      meetingID: id,
      revision: record.sync?.revision ?? 0,
      conflicts: (record.sync?.conflicts ?? []).map((conflict) => conflictView(record, conflict, (intentID) => {
        try {
          return EDITABLE_STATUSES.has(store.intents.get(intentID as LanaId).intent.status);
        } catch {
          return false;
        }
      })),
      phones: store.devices.list().map((device) => ({
        id: device.keys.deviceID,
        name: device.keys.displayName,
        shared: shared.has(device.keys.deviceID),
        queued: store.shared.queue(device.keys.deviceID).includes(id),
        declinedAt: declined.get(device.keys.deviceID) ?? null,
        snoozedAt: snoozed.get(device.keys.deviceID) ?? null,
        lastSyncedAt: synced.get(device.keys.deviceID)?.toISOString() ?? null,
      })),
    };
  }
}

/** A conflict as the window shows it: what it is and each side's text. */
export function conflictView(record: MeetingRecord, conflict: RecordConflict, actionEditable: (intentID: string) => boolean): RecordConflictView {
  const [prefix = "", key = ""] = splitUnit(conflict.unit);
  const object = (value: JsonValue): Record<string, JsonValue> | null => (value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, JsonValue>) : null);
  const field = (value: JsonValue, name: string): string | null => {
    if (value === null) return null;
    const found = object(value)?.[name];
    return typeof found === "string" ? found : found === undefined || found === null ? "" : String(found);
  };
  const speakerName = (id: string) => record.speakers.find((speaker) => speaker.id === id)?.name ?? id;
  switch (prefix) {
    case "title":
      return base("title", "Title", typeof conflict.phone === "string" ? conflict.phone : null, typeof conflict.desktop === "string" ? conflict.desktop : null, true);
    case "speaker":
      return base("speaker", `Name of ${key}`, conflict.phone === null ? null : (field(conflict.phone, "name") ?? ""), conflict.desktop === null ? null : (field(conflict.desktop, "name") ?? ""), true);
    case "segment": {
      const speaker = field(conflict.desktop ?? conflict.phone, "speaker") ?? "";
      return base("line", `Transcript line ${Number(key) + 1} (${speakerName(speaker)})`, field(conflict.phone, "text"), field(conflict.desktop, "text"), true);
    }
    case "note":
      return base("note", "One of your notes", field(conflict.phone, "text"), field(conflict.desktop, "text"), true);
    case "keypoint":
      return base("keyPoint", "Key point", field(conflict.phone, "text"), field(conflict.desktop, "text"), false);
    case "clip":
      return base("clip", "Clip", conflict.phone === null ? null : "Clipped", conflict.desktop === null ? null : "Clipped", false);
    case "intent": {
      const title = (value: JsonValue): string | null => {
        if (value === null) return null;
        try {
          const intent = decodeIntent(value);
          return `${titleOf(intent.params)} (${intent.status})`;
        } catch {
          return "Action";
        }
      };
      return { ...base("action", "Action", title(conflict.phone), title(conflict.desktop), false), phoneAllowed: actionEditable(key) };
    }
    default:
      return base("other", "Change", conflict.phone === null ? null : "Changed", conflict.desktop === null ? null : "Changed", false);
  }

  function base(kind: RecordConflictView["kind"], label: string, phone: string | null, desktop: string | null, editable: boolean): RecordConflictView {
    return { unit: conflict.unit, kind, label, phone, desktop, editable, phoneAllowed: true };
  }
}

/** Two line indices from the window, in order. */
function range(first: number, last: number): [number, number] {
  const a = Math.trunc(Number(first));
  const b = Math.trunc(Number(last));
  if (!Number.isFinite(a) || !Number.isFinite(b)) throw new InvalidRecordInput("Pick at least one line.");
  return [Math.min(a, b), Math.max(a, b)];
}

function text(value: unknown, max: number): string {
  return String(value ?? "").slice(0, max);
}

function splitUnit(unit: string): [string, string] {
  const slash = unit.indexOf("/");
  return slash < 0 ? [unit, ""] : [unit.slice(0, slash), unit.slice(slash + 1)];
}
