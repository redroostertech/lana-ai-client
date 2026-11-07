import type { DevicePublicKeys } from "../crypto/devicePublicKeys.js";
import type { OpenedBundle } from "../handoff/bundleOpener.js";
import type { SharedMeeting } from "../handoff/messages.js";
import type { RecordAck, RecordDecline, RecordUpdate } from "../handoff/recordUpdate.js";
import type { LanaId } from "../ids/lanaId.js";
import { decodeIntent, encodeIntent, transitioned, type Intent } from "../intent/intent.js";
import { validateIntent } from "../intent/validator.js";
import { decodeMeeting, encodeMeeting, type MeetingRecord } from "../intent/meeting.js";
import { contentHash, reconcileRecords, resolveUnit, stampRecord } from "../intent/meetingMerge.js";
import { EMPTY_SYNC, type ActionOutcome, type RecordConflict } from "../intent/meetingSync.js";
import { normalizedRecord } from "../intent/recordUnits.js";
import { canonicalString } from "../json/canonical.js";
import type { JsonValue } from "../json/jsonValue.js";
import { LanaDate } from "../json/lanaDate.js";
import { appendAuditRecord, AUDIT_EVENTS } from "./auditLog.js";
import { blob, integer, optionalText, text } from "./database.js";
import { StoreError } from "./errors.js";
import { appendIntentEvent, EDITABLE_STATUSES, type IntentRepository } from "./intentRepository.js";
import type { OutgoingRecord } from "./interfaces.js";
import { enqueueOutbox } from "./outboxRepository.js";
import type { StoreContext } from "./storeContext.js";
import { DISTANT_PAST, parseStoredDate } from "./storedDate.js";

const SHARED_PHONES_KEY = "shared_record.phones.";
const QUEUE_KEY = "shared_record.queue.";
const DECLINED_KEY = "shared_record.declined.";
const SNOOZED_KEY = "shared_record.snoozed.";

/** A phone that declined a meeting sent to it ("Declined on <phone name>"). */
export interface SendDeclined {
  readonly phoneDeviceID: string;
  readonly phoneName: string;
  readonly declinedAt: Date;
}

/** A phone that said "Not now" to a meeting sent to it ("Not now on <phone name>"). */
export interface SendSnoozed {
  readonly phoneDeviceID: string;
  readonly phoneName: string;
  readonly snoozedAt: Date;
}

interface PhoneEntry {
  readonly phoneDeviceID: string;
  readonly phoneName: string;
  readonly at: Date;
}

/** What "Cancel send" did: taken off the queue, too late (a session is delivering it), or nothing queued. */
export type CancelSendStatus = "cancelled" | "delivering" | "not_queued";

/** The person's choice for a conflict on the desktop. */
export type ConflictChoice =
  | { readonly kind: "phone" }
  | { readonly kind: "desktop" }
  /** An edited value for a text unit: title, speaker name, transcript line or note text. */
  | { readonly kind: "edited"; readonly text: string };

/**
 * The desktop side of the shared meeting record (docs/ARCHITECTURE.md, "Shared meeting
 * record"). The desktop's copy is the stored record with the Inbox's actions and outcomes
 * folded in; every desktop change is stamped (`stampRecord`). Phone bundles for a meeting
 * already here are merged, never inserted twice. The Inbox stays authoritative for actions.
 */
export class SharedRecordRepository {
  /** `<phone>|<meeting>` pairs a session is sending now (this process only). */
  private readonly delivering = new Set<string>();

  constructor(private readonly ctx: StoreContext, private readonly intents: IntentRepository) {}

  // MARK: - The desktop copy

  /** The desktop's current copy: stored record plus Inbox actions and outcomes, stamped and kept. */
  current(id: LanaId): MeetingRecord {
    return this.ctx.db.write(() => this.refresh(id));
  }

  /** Applies a desktop edit (title, speaker names, transcript lines, notes), stamped as the desktop's. */
  edit(id: LanaId, change: (record: MeetingRecord) => MeetingRecord, outboxEvent = "meeting.edited"): MeetingRecord {
    return this.ctx.db.write(() => {
      const current = this.refresh(id);
      const next = stampRecord(current, change(current), "desktop");
      this.persist(id, next);
      enqueueOutbox(this.ctx.db, outboxEvent, { meeting_id: id }, this.ctx.now());
      return next;
    });
  }

  /**
   * Adds an action the person made here (from a clip) to the Inbox and the record. It is
   * validated like every received action and waits in the Inbox to be confirmed; the record
   * stamps it as the desktop's, so it syncs to the phone.
   */
  addAction(id: LanaId, intent: Intent): MeetingRecord {
    return this.ctx.db.write(() => {
      this.refresh(id);
      if (intent.meetingID !== id || validateIntent(intent).length > 0) throw StoreError.corrupt("action");
      if (this.ctx.db.get("SELECT id FROM intent WHERE id = ?", intent.id) !== undefined) throw StoreError.corrupt("action exists");
      const at = this.ctx.now();
      const accepted = intent.status === "proposed" ? transitioned(intent, "transferred") : intent;
      this.ctx.db.run("INSERT INTO intent (id, meeting_id, type, status, idempotency_key, sealed_intent, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
        accepted.id, id, accepted.type, accepted.status, accepted.idempotencyKey, this.ctx.sealer.sealJson(encodeIntent(accepted), `intent|${accepted.id}`), LanaDate.format(at));
      appendIntentEvent(this.ctx.db, accepted.id, "proposed", accepted.status, "user", { source: "clip" }, at);
      const next = this.refresh(id);
      enqueueOutbox(this.ctx.db, "meeting.edited", { meeting_id: id }, at);
      return next;
    });
  }

  /** Units both sides changed, waiting for the person. */
  conflicts(id: LanaId): readonly RecordConflict[] {
    return this.current(id).sync?.conflicts ?? [];
  }

  /** Settles one conflict; the choice becomes the next revision and syncs back. */
  resolve(id: LanaId, unit: string, choice: ConflictChoice): MeetingRecord {
    return this.ctx.db.write(() => {
      const current = this.refresh(id);
      const conflict = current.sync?.conflicts.find((item) => item.unit === unit);
      if (conflict === undefined) throw StoreError.notFound(`conflict ${unit}`);
      let value: JsonValue = choice.kind === "phone" ? conflict.phone : conflict.desktop;
      if (choice.kind === "edited") value = editedValue(unit, conflict, choice.text, this.ctx.now());
      if (unit.startsWith("intent/") && choice.kind !== "desktop") value = this.applyPhoneAction(id, unit, conflict);
      const resolved = resolveUnit(current, unit, value, "desktop");
      this.persist(id, resolved);
      appendAuditRecord(this.ctx.db, AUDIT_EVENTS.recordConflictResolved, id, { unit: unit.split("/")[0] ?? unit, choice: choice.kind }, this.ctx.now());
      return resolved;
    });
  }

  // MARK: - Phones

  /** Whether `phoneID` may send or receive this meeting: it delivered it, or it was sent there. */
  isSharedWith(id: LanaId, phoneID: string): boolean {
    const row = this.ctx.db.get("SELECT phone_device_id FROM meeting WHERE id = ?", id);
    if (row === undefined) return false;
    // A meeting recorded on this computer has no phone of origin; it is shared once sent.
    return optionalText(row, "phone_device_id") === phoneID || this.sharedPhones(id).includes(phoneID);
  }

  /** "Send to phone": the meeting goes to `phoneID` in its next session. */
  queueForPhone(id: LanaId, phoneID: LanaId): void {
    this.ctx.db.write(() => {
      if (this.ctx.db.get("SELECT id FROM meeting WHERE id = ?", id) === undefined) throw StoreError.notFound(id);
      const queue = this.queue(phoneID);
      if (!queue.includes(id)) this.setList(`${QUEUE_KEY}${phoneID}`, [...queue, id]);
      this.clearDeclined(id, phoneID);
      this.clearSnoozed(id, phoneID);
      appendAuditRecord(this.ctx.db, AUDIT_EVENTS.meetingQueued, id, { phone_device_id: phoneID }, this.ctx.now());
    });
  }

  /**
   * "Cancel send": takes the meeting off `phoneID`'s queue, unless a session is delivering it
   * right now (an update is never stopped midway).
   */
  cancelQueued(id: LanaId, phoneID: string): CancelSendStatus {
    if (this.delivering.has(deliveryKey(phoneID, id))) return "delivering";
    return this.ctx.db.write(() => {
      const queue = this.queue(phoneID);
      if (!queue.includes(id)) return "not_queued";
      this.setList(`${QUEUE_KEY}${phoneID}`, queue.filter((item) => item !== id));
      appendAuditRecord(this.ctx.db, AUDIT_EVENTS.recordSendCancelled, id, { phone_device_id: phoneID }, this.ctx.now());
      return "cancelled";
    });
  }

  /** Phones that declined this meeting, oldest first. */
  declined(id: string): SendDeclined[] {
    return this.declinedEntries(id);
  }

  /** Phones that said "Not now" to this meeting, oldest first. */
  snoozed(id: string): SendSnoozed[] {
    return this.entries(SNOOZED_KEY, id).map((entry) => ({ phoneDeviceID: entry.phoneDeviceID, phoneName: entry.phoneName, snoozedAt: entry.at }));
  }

  /**
   * "Not now" on the phone (`sync_snooze`): every meeting queued for it leaves the queue and
   * shows "Not now on <phone>"; nothing is shared. Returns the meetings dropped.
   */
  snoozedByPhone(phone: DevicePublicKeys, snoozedAt: Date): string[] {
    return this.ctx.db.write(() => {
      const queue = this.queue(phone.deviceID).filter((id) => !this.delivering.has(deliveryKey(phone.deviceID, id)));
      if (queue.length === 0) return [];
      const remaining = this.queue(phone.deviceID).filter((id) => !queue.includes(id));
      this.setList(`${QUEUE_KEY}${phone.deviceID}`, remaining);
      for (const id of queue) {
        const entries = this.entries(SNOOZED_KEY, id).filter((entry) => entry.phoneDeviceID !== phone.deviceID);
        this.setEntries(SNOOZED_KEY, id, [...entries, { phoneDeviceID: phone.deviceID, phoneName: phone.displayName, at: snoozedAt }]);
        appendAuditRecord(this.ctx.db, AUDIT_EVENTS.recordSendSnoozed, id, { phone_device_id: phone.deviceID }, this.ctx.now());
      }
      return queue;
    });
  }

  /**
   * When this meeting last reached each phone, by phone device id: its latest update sent
   * there, or when that phone handed it off. Phones it never reached are absent.
   */
  lastSynced(id: string): Map<string, Date> {
    const out = new Map<string, Date>();
    const keep = (phoneID: string, at: Date) => {
      const earlier = out.get(phoneID);
      if (at.getTime() > DISTANT_PAST.getTime() && (earlier === undefined || at > earlier)) out.set(phoneID, at);
    };
    const origin = this.ctx.db.get("SELECT phone_device_id, received_at FROM meeting WHERE id = ?", id);
    const originPhone = origin === undefined ? null : optionalText(origin, "phone_device_id");
    if (origin !== undefined && originPhone !== null) keep(originPhone, parseStoredDate(optionalText(origin, "received_at")));
    for (const row of this.ctx.db.all("SELECT at, detail FROM audit_log WHERE event = ? AND subject = ?", AUDIT_EVENTS.recordUpdateSent, id)) {
      try {
        const phoneID: unknown = (JSON.parse(text(row, "detail")) as Record<string, unknown>).phone_device_id;
        if (typeof phoneID === "string") keep(phoneID, parseStoredDate(optionalText(row, "at")));
      } catch {
        // A detail that is not JSON names no phone.
      }
    }
    return out;
  }

  /** Whether a session is sending this meeting to `phoneID` right now. */
  isDelivering(id: string, phoneID: string): boolean {
    return this.delivering.has(deliveryKey(phoneID, id));
  }

  /** Meetings waiting to go to `phoneID`. */
  queue(phoneID: string): string[] {
    return this.list(`${QUEUE_KEY}${phoneID}`);
  }

  // MARK: - Protocol 2

  /** Records a phone's `sync_request` calls for (see `RecordSync.outgoingRecords`). */
  outgoing(phone: DevicePublicKeys, listed: readonly SharedMeeting[]): OutgoingRecord[] {
    const out: OutgoingRecord[] = [];
    const listedIDs = new Set<string>();
    for (const meeting of listed) {
      listedIDs.add(meeting.meetingID);
      if (!this.isSharedWith(meeting.meetingID, phone.deviceID)) continue;
      const record = this.current(meeting.meetingID);
      if (contentHash(record) !== meeting.contentHash) out.push({ record, audio: [] });
    }
    for (const id of this.queue(phone.deviceID)) {
      if (listedIDs.has(id) || this.ctx.db.get("SELECT id FROM meeting WHERE id = ?", id) === undefined) continue;
      out.push({ record: this.current(id as LanaId), audio: this.audio(id as LanaId), queued: true });
    }
    return out;
  }

  /** The phone applied an update: it now shares the meeting, and the queue entry is done. */
  acknowledged(phone: DevicePublicKeys, update: RecordUpdate, ack: RecordAck): void {
    this.ctx.db.write(() => {
      const id = update.meetingID;
      const phones = this.sharedPhones(id);
      if (!phones.includes(phone.deviceID)) this.setList(`${SHARED_PHONES_KEY}${id}`, [...phones, phone.deviceID]);
      const queue = this.queue(phone.deviceID);
      if (queue.includes(id)) this.setList(`${QUEUE_KEY}${phone.deviceID}`, queue.filter((item) => item !== id));
      this.clearDeclined(id, phone.deviceID);
      this.clearSnoozed(id, phone.deviceID);
      appendAuditRecord(this.ctx.db, AUDIT_EVENTS.recordUpdateSent, id, {
        phone_device_id: phone.deviceID,
        update_id: update.updateID,
        revision: String(update.revision),
        phone_revision: String(ack.revision),
        in_sync: String(ack.contentHash === update.contentHash),
        parts: String(update.parts.length),
      }, this.ctx.now());
    });
  }

  /**
   * The person declined a meeting sent to the phone: it leaves that phone's queue and the
   * meeting shows "Declined on <phone>". It is not shared with that phone.
   */
  declinedByPhone(phone: DevicePublicKeys, update: RecordUpdate, decline: RecordDecline): void {
    this.ctx.db.write(() => {
      const id = update.meetingID;
      const queue = this.queue(phone.deviceID);
      if (queue.includes(id)) this.setList(`${QUEUE_KEY}${phone.deviceID}`, queue.filter((item) => item !== id));
      const entries = this.declinedEntries(id).filter((entry) => entry.phoneDeviceID !== phone.deviceID);
      this.setDeclined(id, [...entries, { phoneDeviceID: phone.deviceID, phoneName: phone.displayName, declinedAt: decline.declinedAt }]);
      appendAuditRecord(this.ctx.db, AUDIT_EVENTS.recordSendDeclined, id, { phone_device_id: phone.deviceID, update_id: update.updateID }, this.ctx.now());
    });
  }

  /** Right before a queued meeting's update: still queued? Then it is being delivered. */
  beginDelivery(phoneID: string, id: string): boolean {
    if (!this.queue(phoneID).includes(id)) return false;
    this.delivering.add(deliveryKey(phoneID, id));
    return true;
  }

  endDelivery(phoneID: string, id: string): void {
    this.delivering.delete(deliveryKey(phoneID, id));
  }

  /**
   * A phone bundle for a meeting already stored: merged, never inserted twice. Called inside
   * the bundle transaction. New action ids are inserted as `transferred`; an edit the phone
   * made to an action the Inbox can no longer change becomes a conflict, never a silent revert.
   */
  mergeIncoming(opened: OpenedBundle): MeetingRecord {
    const { db } = this.ctx;
    const id = opened.meeting.id;
    const phoneID = opened.manifest.phoneDeviceID;
    if (!this.isSharedWith(id, phoneID)) throw StoreError.corrupt("meeting belongs to another phone");
    const at = this.ctx.now();
    const local = this.refresh(id);
    let merged = reconcileRecords(local, opened.meeting, "desktop");
    const stored = new Map(this.intents.list({ meetingID: id }).map((item) => [item.intent.id, item.intent] as const));
    const extraConflicts: RecordConflict[] = [];
    const kept = new Map<string, Intent>();
    for (const intent of merged.intents) {
      const existing = stored.get(intent.id);
      if (existing === undefined) {
        const accepted = intent.status === "proposed" ? transitioned(intent, "transferred") : intent;
        db.run("INSERT INTO intent (id, meeting_id, type, status, idempotency_key, sealed_intent, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
          accepted.id, id, accepted.type, accepted.status, accepted.idempotencyKey, this.ctx.sealer.sealJson(encodeIntent(accepted), `intent|${accepted.id}`), LanaDate.format(at));
        appendIntentEvent(db, accepted.id, "proposed", accepted.status, "phone", { bundle_id: opened.manifest.bundleID }, at);
        continue;
      }
      const edited = canonicalString(encodeIntent({ ...intent, status: existing.status })) !== canonicalString(encodeIntent(existing));
      if (!edited) continue;
      if (EDITABLE_STATUSES.has(existing.status) && intent.type === existing.type) {
        // An update from the phone needs the person: the action reads unread again.
        db.run("UPDATE intent SET sealed_intent = ?, resolution = NULL, updated_at = ?, seen_at = NULL WHERE id = ?",
          this.ctx.sealer.sealJson(encodeIntent({ ...existing, params: intent.params }), `intent|${intent.id}`), LanaDate.format(at), intent.id);
        appendAuditRecord(db, AUDIT_EVENTS.intentEdited, intent.id, { type: intent.type, actor: "phone" }, at);
      } else {
        // The Inbox can no longer change it: the desktop's version stays, and the person sees both.
        const unit = `intent/${intent.id}`;
        kept.set(intent.id, existing);
        // A new conflict needs the person; the same one sent again on a later sync does not.
        if (!(local.sync?.conflicts ?? []).some((conflict) => conflict.unit === unit)) db.run("UPDATE intent SET seen_at = NULL WHERE id = ?", intent.id);
        extraConflicts.push({ unit, phone: encodeIntent(intent) as JsonValue, desktop: encodeIntent(existing) as JsonValue, clock: merged.sync?.clock[unit] ?? { phone: 0, desktop: 0 } });
      }
    }
    if (extraConflicts.length > 0) {
      const sync = merged.sync ?? EMPTY_SYNC;
      const units = new Set(extraConflicts.map((conflict) => conflict.unit));
      merged = {
        ...merged,
        intents: merged.intents.map((intent) => kept.get(intent.id) ?? intent),
        sync: { ...sync, conflicts: [...sync.conflicts.filter((conflict) => !units.has(conflict.unit)), ...extraConflicts].sort((a, b) => (a.unit < b.unit ? -1 : 1)) },
      };
    }
    this.persist(id, merged);
    // Fold the Inbox's state back in, so the stored copy is the desktop's current one.
    return this.refresh(id);
  }

  // MARK: - Private

  private refresh(id: LanaId): MeetingRecord {
    const row = this.ctx.db.get("SELECT sealed_record FROM meeting WHERE id = ?", id);
    if (row === undefined) throw StoreError.notFound(id);
    const opened = this.open(id, blob(row, "sealed_record"));
    const stored = opened.sync === undefined ? normalizedRecord({ ...opened, sync: { ...EMPTY_SYNC, revision: 1 } }) : opened;
    const actions = this.intents.list({ meetingID: id });
    const outcomes = actions.flatMap((item) => {
      const outcome = item.intent.status === "executed" ? outcomeFrom(item.intent, item.resolution) : null;
      return outcome === null ? [] : [outcome];
    });
    const composed: MeetingRecord = {
      ...stored,
      intents: actions.map((item) => item.intent),
      sync: { ...(stored.sync ?? EMPTY_SYNC), outcomes },
    };
    const next = stampRecord(stored, composed, "desktop");
    if (canonicalString(encodeMeeting(next)) !== canonicalString(encodeMeeting(opened))) this.persist(id, next);
    return next;
  }

  /** Choosing the phone's version of an action: only while the Inbox can still change it. */
  private applyPhoneAction(id: LanaId, unit: string, conflict: RecordConflict): JsonValue {
    const intentID = unit.slice("intent/".length) as LanaId;
    const existing = this.intents.get(intentID).intent;
    if (conflict.phone === null || !EDITABLE_STATUSES.has(existing.status)) throw StoreError.notEditable(existing.status);
    const phoneIntent = decodeIntent(conflict.phone);
    if (phoneIntent.type !== existing.type || phoneIntent.meetingID !== id) throw StoreError.corrupt("cannot change intent type");
    const updated: Intent = { ...existing, params: phoneIntent.params };
    this.ctx.db.run("UPDATE intent SET sealed_intent = ?, resolution = NULL, updated_at = ? WHERE id = ?",
      this.ctx.sealer.sealJson(encodeIntent(updated), `intent|${intentID}`), LanaDate.format(this.ctx.now()), intentID);
    appendAuditRecord(this.ctx.db, AUDIT_EVENTS.intentEdited, intentID, { type: updated.type, actor: "user" }, this.ctx.now());
    return encodeIntent(updated) as JsonValue;
  }

  private persist(id: LanaId, record: MeetingRecord): void {
    this.ctx.db.run("UPDATE meeting SET sealed_record = ? WHERE id = ?", this.ctx.sealer.sealJson(encodeMeeting(record), `meeting|${id}`), id);
  }

  private open(id: string, sealed: Uint8Array): MeetingRecord {
    const context = `meeting|${id}`;
    const value = this.ctx.sealer.openJson(sealed, context);
    try {
      return decodeMeeting(value);
    } catch {
      throw StoreError.corrupt(context);
    }
  }

  private audio(id: LanaId): { name: string; data: Uint8Array }[] {
    return this.ctx.db.all("SELECT idx, name FROM meeting_audio WHERE meeting_id = ? AND purged_at IS NULL ORDER BY idx", id).flatMap((row) => {
      const index = integer(row, "idx");
      const sealed = this.ctx.files.read(this.ctx.files.audioPath(id, index));
      return sealed === null ? [] : [{ name: text(row, "name"), data: this.ctx.sealer.open(sealed, `audio|${id}|${index}`) }];
    });
  }

  private declinedEntries(id: string): SendDeclined[] {
    return this.entries(DECLINED_KEY, id).map((entry) => ({ phoneDeviceID: entry.phoneDeviceID, phoneName: entry.phoneName, declinedAt: entry.at }));
  }

  private setDeclined(id: string, entries: readonly SendDeclined[]): void {
    this.setEntries(DECLINED_KEY, id, entries.map((entry) => ({ phoneDeviceID: entry.phoneDeviceID, phoneName: entry.phoneName, at: entry.declinedAt })));
  }

  /** Per-phone markers on a meeting (declined, snoozed), stored as `{phone_device_id, phone_name, <prefix>_at}`. */
  private entries(prefix: string, id: string): PhoneEntry[] {
    const row = this.ctx.db.get("SELECT value FROM setting WHERE key = ?", `${prefix}${id}`);
    if (row === undefined) return [];
    const atField = prefix === DECLINED_KEY ? "declined_at" : "snoozed_at";
    try {
      const parsed: unknown = JSON.parse(text(row, "value"));
      if (!Array.isArray(parsed)) return [];
      return parsed.flatMap((item: unknown) => {
        const entry = item as Record<string, unknown>;
        const stamp = entry[atField];
        if (typeof entry.phone_device_id !== "string" || typeof stamp !== "string") return [];
        const at = new Date(stamp);
        return Number.isNaN(at.getTime()) ? [] : [{ phoneDeviceID: entry.phone_device_id, phoneName: typeof entry.phone_name === "string" ? entry.phone_name : "", at }];
      });
    } catch {
      return [];
    }
  }

  private setEntries(prefix: string, id: string, entries: readonly PhoneEntry[]): void {
    const key = `${prefix}${id}`;
    if (entries.length === 0) {
      this.ctx.db.run("DELETE FROM setting WHERE key = ?", key);
      return;
    }
    const atField = prefix === DECLINED_KEY ? "declined_at" : "snoozed_at";
    const value = entries.map((entry) => ({ phone_device_id: entry.phoneDeviceID, phone_name: entry.phoneName, [atField]: LanaDate.format(entry.at) }));
    this.ctx.db.run("INSERT INTO setting (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", key, JSON.stringify(value));
  }

  /** A new send to that phone, or its ack, replaces an earlier "Not now". */
  private clearSnoozed(id: string, phoneID: string): void {
    const entries = this.entries(SNOOZED_KEY, id);
    if (entries.some((entry) => entry.phoneDeviceID === phoneID)) this.setEntries(SNOOZED_KEY, id, entries.filter((entry) => entry.phoneDeviceID !== phoneID));
  }

  /** A new send to that phone, or its ack, replaces an earlier decline. */
  private clearDeclined(id: string, phoneID: string): void {
    const entries = this.declinedEntries(id);
    if (entries.some((entry) => entry.phoneDeviceID === phoneID)) this.setDeclined(id, entries.filter((entry) => entry.phoneDeviceID !== phoneID));
  }

  private sharedPhones(id: string): string[] {
    return this.list(`${SHARED_PHONES_KEY}${id}`);
  }

  private list(key: string): string[] {
    const row = this.ctx.db.get("SELECT value FROM setting WHERE key = ?", key);
    if (row === undefined) return [];
    try {
      const parsed: unknown = JSON.parse(text(row, "value"));
      return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
    } catch {
      return [];
    }
  }

  private setList(key: string, values: readonly string[]): void {
    this.ctx.db.run("INSERT INTO setting (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", key, JSON.stringify(values));
  }
}

function deliveryKey(phoneID: string, id: string): string {
  return `${phoneID}|${id}`;
}

/** Where an executed action landed, read from the stored resolution (`StoredResolution` JSON). */
function outcomeFrom(intent: Intent, resolution: Uint8Array | null): ActionOutcome | null {
  if (resolution === null) return null;
  try {
    const value = JSON.parse(new TextDecoder().decode(resolution)) as {
      target?: { regarding?: { displayName?: string }; recipients?: { displayName?: string }[] };
      result?: { web_url?: string; undo?: { executor?: string } };
    };
    if (value.result === undefined) return null;
    const executor = value.result.undo?.executor ?? "";
    const destination = executor.startsWith("graph.") ? "Outlook" : "Clio";
    const recipients = (value.target?.recipients ?? []).map((item) => item.displayName ?? "").filter((name) => name !== "");
    const recordName = value.target?.regarding?.displayName ?? (recipients.length > 0 ? recipients.join(", ") : undefined);
    return { intentID: intent.id, destination, recordName, recordURL: value.result.web_url };
  } catch {
    return null;
  }
}

/** The value for an edited choice on a text unit. */
function editedValue(unit: string, conflict: RecordConflict, edited: string, now: Date): JsonValue {
  const kind = unit.split("/")[0];
  const base = (conflict.desktop ?? conflict.phone) as Record<string, JsonValue> | string | null;
  if (kind === "title") return edited;
  if (base === null || typeof base !== "object") throw StoreError.corrupt("cannot edit this change");
  switch (kind) {
    case "note":
      return { ...base, text: edited, updated_at: LanaDate.format(now) };
    case "segment":
      return { ...base, text: edited };
    case "speaker":
      return { ...base, name: edited.trim() === "" ? undefined : edited.trim() } as JsonValue;
    default:
      throw StoreError.corrupt("cannot edit this change");
  }
}
