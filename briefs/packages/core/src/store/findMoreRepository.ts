import { fromBase64, toBase64 } from "../bytes/index.js";
import type { LanaId } from "../ids/lanaId.js";
import { decodeIntent, encodeIntent } from "../intent/intent.js";
import { validateIntent } from "../intent/validator.js";
import { decodeSourceSpan, encodeSourceSpan, KEY_POINT_KINDS, type KeyPoint, type KeyPointPrecision } from "../intent/keyPoint.js";
import type { JsonObject, JsonValue } from "../json/index.js";
import { LanaDate } from "../json/lanaDate.js";
import type { FindMoreKnown, FindMoreSuggestion, SuggestionKind } from "../summarizer/findMore.js";
import { appendAuditRecord, AUDIT_EVENTS } from "./auditLog.js";
import { text } from "./database.js";
import { StoreError } from "./errors.js";
import type { SharedRecordRepository } from "./sharedRecordRepository.js";
import type { StoreContext } from "./storeContext.js";
import { parseStoredDate } from "./storedDate.js";

/** One meeting's Find more state on this device. */
export interface FindMoreState {
  /** Waiting for the person, oldest first. */
  readonly suggestions: readonly FindMoreSuggestion[];
  /** Never suggested again for this meeting. */
  readonly dismissed: readonly FindMoreKnown[];
  /** Key points the person removed on this computer: a rewrite of the notes never brings them back. */
  readonly removed: readonly FindMoreKnown[];
  /** The last finished run: when, and how many suggestions it found. */
  readonly lastRun: { readonly at: Date; readonly found: number } | null;
}

const KEY_PREFIX = "find_more.v1|";
const KINDS: readonly SuggestionKind[] = [...KEY_POINT_KINDS, "task"];

/**
 * Find more notes on this device (contract): pending suggestions and dismissed ones, per
 * meeting, in a sealed setting row (meeting content), never in the shared record and never
 * synced. Adding a suggestion goes through the shared record like a hand edit, so it reaches
 * the phone in its next sync. Audit records carry ids and counts only. A meeting that is gone
 * has no state.
 */
export class FindMoreRepository {
  constructor(private readonly ctx: StoreContext, private readonly shared: SharedRecordRepository) {}

  state(id: LanaId): FindMoreState {
    if (this.ctx.db.get("SELECT id FROM meeting WHERE id = ?", id) === undefined) return { suggestions: [], dismissed: [], removed: [], lastRun: null };
    return this.read(id);
  }

  /** A finished run: its suggestions join those still waiting. */
  saveRun(id: LanaId, found: readonly FindMoreSuggestion[]): FindMoreState {
    return this.change(id, (state) => {
      appendAuditRecord(this.ctx.db, AUDIT_EVENTS.findMoreRan, id, { found: String(found.length) }, this.ctx.now());
      return { ...state, suggestions: [...state.suggestions, ...found], lastRun: { at: this.ctx.now(), found: found.length } };
    });
  }

  /**
   * Adds the suggestions to the meeting: key points into the record's notes, tasks into the
   * Inbox and the record (as an action made here). Unknown ids are skipped. Returns how many were added.
   */
  add(id: LanaId, suggestionIDs: readonly string[]): number {
    return this.ctx.db.write(() => {
      const state = this.read(id);
      // A task that no longer passes the validator stays in the list (the person can dismiss it); the rest are added.
      const wanted = state.suggestions.filter((item) => suggestionIDs.includes(item.id) && (item.kind !== "task" || (item.intent !== undefined && item.intent.meetingID === id && validateIntent(item.intent).length === 0)));
      if (wanted.length === 0) return 0;
      const points: KeyPoint[] = wanted.filter((item) => item.kind !== "task").map((item) => ({
        id: `kp-more-${randomHex()}`,
        kind: item.kind as KeyPoint["kind"],
        text: item.text,
        sources: item.sources,
        precision: item.precision,
        ...(item.kind === "decision" && item.decidedBy !== undefined ? { decidedBy: item.decidedBy } : {}),
      }));
      if (points.length > 0) this.shared.edit(id, (record) => ({ ...record, notes: { ...record.notes, keyPoints: [...record.notes.keyPoints, ...points] } }));
      for (const item of wanted) if (item.kind === "task" && item.intent !== undefined) this.shared.addAction(id, item.intent);
      this.write(id, { ...state, suggestions: state.suggestions.filter((item) => !wanted.includes(item)) });
      appendAuditRecord(this.ctx.db, AUDIT_EVENTS.findMoreAdded, id, { added: String(wanted.length) }, this.ctx.now());
      return wanted.length;
    });
  }

  /** Dismisses the suggestions: they leave the list and are never suggested again here. Returns how many. */
  dismiss(id: LanaId, suggestionIDs: readonly string[]): number {
    return this.ctx.db.write(() => {
      const state = this.read(id);
      const gone = state.suggestions.filter((item) => suggestionIDs.includes(item.id));
      if (gone.length === 0) return 0;
      this.write(id, {
        ...state,
        suggestions: state.suggestions.filter((item) => !suggestionIDs.includes(item.id)),
        dismissed: [...state.dismissed, ...gone.map((item) => ({ kind: item.kind, text: item.text, sources: item.sources }))],
      });
      appendAuditRecord(this.ctx.db, AUDIT_EVENTS.findMoreDismissed, id, { dismissed: String(gone.length) }, this.ctx.now());
      return gone.length;
    });
  }

  /**
   * Removes a key point through the shared record (it syncs like any edit) and remembers it on
   * this computer, so a rewrite of the notes never brings it back. False when it is not there.
   */
  removeKeyPoint(id: LanaId, pointID: string): boolean {
    return this.ctx.db.write(() => {
      const point = this.shared.current(id).notes.keyPoints.find((item) => item.id === pointID);
      if (point === undefined) return false;
      this.shared.edit(id, (record) => ({ ...record, notes: { ...record.notes, keyPoints: record.notes.keyPoints.filter((item) => item.id !== pointID) } }));
      const state = this.read(id);
      this.write(id, { ...state, removed: [...state.removed, { kind: point.kind, text: point.text, sources: point.sources }] });
      return true;
    });
  }

  /** Key points a phone copy removed, learned in the sync merge: remembered like the person's own removals (no repeats). */
  learnRemoved(id: LanaId, points: readonly KeyPoint[]): void {
    this.ctx.db.write(() => {
      const state = this.read(id);
      const removed = [...state.removed];
      for (const point of points) {
        if (removed.some((item) => item.kind === point.kind && item.text === point.text)) continue;
        removed.push({ kind: point.kind, text: point.text, sources: point.sources });
      }
      if (removed.length !== state.removed.length) this.write(id, { ...state, removed });
    });
  }

  // MARK: - Private

  private change(id: LanaId, body: (state: FindMoreState) => FindMoreState): FindMoreState {
    return this.ctx.db.write(() => {
      if (this.ctx.db.get("SELECT id FROM meeting WHERE id = ?", id) === undefined) throw StoreError.notFound(id);
      const next = body(this.read(id));
      this.write(id, next);
      return next;
    });
  }

  private read(id: LanaId): FindMoreState {
    const key = `${KEY_PREFIX}${id}`;
    const stored = this.ctx.db.get("SELECT value FROM setting WHERE key = ?", key);
    if (stored === undefined) return { suggestions: [], dismissed: [], removed: [], lastRun: null };
    const bytes = fromBase64(text(stored, "value"));
    if (bytes === null) throw StoreError.corrupt(key);
    const value = this.ctx.sealer.openJson(bytes, `setting|${key}`);
    if (value === null || typeof value !== "object" || Array.isArray(value)) throw StoreError.corrupt(key);
    const object = value as JsonObject;
    const list = (field: string): JsonObject[] => (Array.isArray(object[field]) ? (object[field] as JsonValue[]).filter((item): item is JsonObject => item !== null && typeof item === "object" && !Array.isArray(item)) : []);
    const raw = object["last_run"];
    const run = raw !== null && typeof raw === "object" && !Array.isArray(raw) ? (raw as JsonObject) : null;
    const lastRun = run !== null && typeof run["at"] === "string" ? { at: parseStoredDate(run["at"]), found: Number(run["found"] ?? 0) } : null;
    return { suggestions: list("suggestions").map(decodeSuggestion), dismissed: list("dismissed").map(decodeKnown), removed: list("removed").map(decodeKnown), lastRun };
  }

  private write(id: LanaId, state: FindMoreState): void {
    const key = `${KEY_PREFIX}${id}`;
    const value: JsonObject = {
      suggestions: state.suggestions.map(encodeSuggestion),
      dismissed: state.dismissed.map((item) => ({ kind: item.kind, text: item.text, sources: item.sources.map(encodeSourceSpan) })),
      removed: state.removed.map((item) => ({ kind: item.kind, text: item.text, sources: item.sources.map(encodeSourceSpan) })),
      last_run: state.lastRun === null ? null : { at: LanaDate.format(state.lastRun.at), found: state.lastRun.found },
    };
    const sealed = toBase64(this.ctx.sealer.sealJson(value, `setting|${key}`));
    this.ctx.db.run("INSERT INTO setting (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", key, sealed);
  }
}

function encodeSuggestion(item: FindMoreSuggestion): JsonObject {
  return {
    id: item.id, kind: item.kind, text: item.text, sources: item.sources.map(encodeSourceSpan), precision: item.precision,
    decided_by: item.decidedBy ?? null, intent: item.intent === undefined ? null : encodeIntent(item.intent),
  };
}

function kindOf(value: JsonValue | undefined): SuggestionKind {
  const kind = KINDS.find((item) => item === value);
  if (kind === undefined) throw StoreError.corrupt("find more kind");
  return kind;
}

function decodeSuggestion(object: JsonObject): FindMoreSuggestion {
  const sources = Array.isArray(object["sources"]) ? object["sources"].map((span, index) => decodeSourceSpan(span, `sources[${index}]`)) : [];
  const decided = typeof object["decided_by"] === "string" ? { decidedBy: object["decided_by"] } : {};
  const intent = object["intent"] === null || object["intent"] === undefined ? {} : { intent: decodeIntent(object["intent"]) };
  return {
    id: String(object["id"]), kind: kindOf(object["kind"]), text: String(object["text"] ?? ""), sources,
    precision: (object["precision"] === "approximate" ? "approximate" : "exact") as KeyPointPrecision, ...decided, ...intent,
  };
}

function decodeKnown(object: JsonObject): FindMoreKnown {
  const sources = Array.isArray(object["sources"]) ? object["sources"].map((span, index) => decodeSourceSpan(span, `sources[${index}]`)) : [];
  return { kind: kindOf(object["kind"]), text: String(object["text"] ?? ""), sources };
}

function randomHex(): string {
  const bytes = new Uint8Array(4);
  globalThis.crypto.getRandomValues(bytes);
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
