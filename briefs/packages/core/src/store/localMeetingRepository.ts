import type { LanaId } from "../ids/lanaId.js";
import { encodeIntent, transitioned, type Intent } from "../intent/intent.js";
import { encodeMeeting, type MeetingRecord } from "../intent/meeting.js";
import type { MeetingNotes } from "../intent/meetingParts.js";
import { validateIntent } from "../intent/validator.js";
import { LanaDate } from "../json/lanaDate.js";
import { appendAuditRecord, AUDIT_EVENTS } from "./auditLog.js";
import { StoreError } from "./errors.js";
import { appendIntentEvent } from "./intentRepository.js";
import { enqueueOutbox } from "./outboxRepository.js";
import type { SharedRecordRepository } from "./sharedRecordRepository.js";
import type { StoreContext } from "./storeContext.js";

/** Stored in `meeting.attestation_method` for a meeting recorded here: no phone proved anything. */
export const LOCAL_ATTESTATION = "none";

/** One finished audio part of a meeting recorded here, in the store's format (AAC in M4A). */
export interface LocalAudioPart {
  readonly name: string;
  readonly data: Uint8Array;
}

/**
 * Meetings recorded on this computer (desktop only): stored in the same `meeting` table as
 * handed-off meetings with origin `computer`, no phone and no attestation, so the shared
 * record, the Inbox, replay, Ask and Send to phone treat them like any other meeting.
 */
export class LocalMeetingRepository {
  constructor(private readonly ctx: StoreContext, private readonly shared: SharedRecordRepository) {}

  /** Stores a finished recording: sealed audio, then the record in one transaction. */
  insert(record: MeetingRecord, audio: readonly LocalAudioPart[]): void {
    const { db, sealer, files } = this.ctx;
    if (record.intents.length > 0) throw StoreError.corrupt("local meeting intents");
    if (db.get("SELECT id FROM meeting WHERE id = ?", record.id) !== undefined) throw StoreError.corrupt("meeting exists");
    const at = this.ctx.now();
    // Audio first: if the transaction fails, orphan files are harmless and overwritten on retry.
    audio.forEach((part, index) => files.writeProtected(files.audioPath(record.id, index), sealer.seal(part.data, `audio|${record.id}|${index}`)));
    db.write(() => {
      db.run(`INSERT INTO meeting (id, bundle_id, phone_device_id, started_at, duration_seconds, received_at, attestation_method, attestation_latency_ms, sealed_record, origin)
        VALUES (?, ?, NULL, ?, ?, ?, ?, 0, ?, 'computer')`,
        record.id, record.id, LanaDate.format(record.startedAt), record.durationSeconds, LanaDate.format(at), LOCAL_ATTESTATION,
        sealer.sealJson(encodeMeeting(record), `meeting|${record.id}`));
      audio.forEach((part, index) => {
        db.run("INSERT INTO meeting_audio (meeting_id, idx, name, file_name, byte_count) VALUES (?, ?, ?, ?, ?)",
          record.id, index, part.name, files.audioFileName(record.id, index), part.data.length);
      });
      appendAuditRecord(db, AUDIT_EVENTS.meetingRecorded, record.id, { audio_parts: String(audio.length), consent: record.consent.method }, at);
      enqueueOutbox(db, "meeting.recorded", { meeting_id: record.id }, at);
    });
  }

  /** Whether `id` was recorded on this computer. */
  isLocal(id: string): boolean {
    const row = this.ctx.db.get("SELECT origin FROM meeting WHERE id = ?", id);
    return row !== undefined && row["origin"] === "computer";
  }

  /**
   * LANA's notes for a meeting recorded here: key points into the record (stamped as the
   * desktop's change, so they sync), and each proposed action into the Inbox, validated like
   * every action from a phone. Returns the actions added.
   */
  applyNotes(id: LanaId, notes: MeetingNotes, intents: readonly Intent[], notesModel: string): Intent[] {
    if (!this.isLocal(id)) throw StoreError.notFound(id);
    const { db, sealer } = this.ctx;
    return db.write(() => {
      const at = this.ctx.now();
      const added: Intent[] = [];
      for (const proposal of intents) {
        if (proposal.meetingID !== id || validateIntent(proposal).length > 0) continue;
        if (db.get("SELECT id FROM intent WHERE id = ?", proposal.id) !== undefined) continue;
        const stored = proposal.status === "proposed" ? transitioned(proposal, "transferred") : proposal;
        db.run("INSERT INTO intent (id, meeting_id, type, status, idempotency_key, sealed_intent, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
          stored.id, id, stored.type, stored.status, stored.idempotencyKey, sealer.sealJson(encodeIntent(stored), `intent|${stored.id}`), LanaDate.format(at));
        appendIntentEvent(db, stored.id, "proposed", stored.status, "system", { source: "recorded_here" }, at);
        added.push(stored);
      }
      this.shared.edit(id, (record) => ({ ...record, notes, provenance: { ...record.provenance, notesModel } }), "meeting.notes_written");
      appendAuditRecord(db, AUDIT_EVENTS.meetingNotesWritten, id, { key_points: String(notes.keyPoints.length), intents: String(added.length) }, at);
      return added;
    });
  }
}
