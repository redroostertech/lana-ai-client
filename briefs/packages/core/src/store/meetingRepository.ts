import { ATTESTATION_METHODS, type AttestationMethod } from "../handoff/messages.js";
import { parseLanaId, type LanaId } from "../ids/lanaId.js";
import { decodeMeeting, type MeetingRecord } from "../intent/meeting.js";
import type { TranscriptClip } from "../intent/transcriptClip.js";
import { USER_NOTE_MAX_LENGTH, type UserNote } from "../intent/userNote.js";
import { LanaDate } from "../json/lanaDate.js";
import { graphemes } from "../text/graphemes.js";
import { appendAuditRecord, AUDIT_EVENTS } from "./auditLog.js";
import { blob, integer, optionalText, text } from "./database.js";
import { StoreError } from "./errors.js";
import type { SharedRecordRepository } from "./sharedRecordRepository.js";
import type { StoreContext } from "./storeContext.js";
import { parseStoredDate } from "./storedDate.js";
import type { AudioPart, MeetingSummary } from "./types.js";

const OPEN_STATUSES = "'transferred', 'resolved', 'confirmed', 'failed'";
const SECONDS_PER_DAY = 86_400;

/** Received meetings: list, full record recall, clips, scratch-pad notes and audio. */
export class MeetingRepository {
  constructor(private readonly ctx: StoreContext, private readonly shared: SharedRecordRepository) {}

  /** Newest first, with the count of intents still waiting on the person and of unread actions. */
  list(): MeetingSummary[] {
    return this.ctx.db.all(`SELECT m.*,
        (SELECT COUNT(*) FROM intent i WHERE i.meeting_id = m.id AND i.status IN (${OPEN_STATUSES})) AS open_intents,
        (SELECT COUNT(*) FROM intent i WHERE i.meeting_id = m.id AND i.seen_at IS NULL AND i.deleted_at IS NULL)
          + (SELECT COUNT(*) FROM manual_action a WHERE a.meeting_id = m.id AND a.seen_at IS NULL AND a.deleted_at IS NULL) AS unread_actions,
        (SELECT COUNT(*) FROM meeting_audio a WHERE a.meeting_id = m.id AND a.purged_at IS NULL) AS audio_parts
      FROM meeting m ORDER BY m.started_at DESC`).map((row) => {
      const record = this.openRecord(text(row, "id"), blob(row, "sealed_record"));
      const method = text(row, "attestation_method");
      return {
        id: record.id,
        title: record.title,
        startedAt: record.startedAt,
        durationSeconds: record.durationSeconds,
        receivedAt: parseStoredDate(optionalText(row, "received_at")),
        attestationMethod: (ATTESTATION_METHODS as readonly string[]).includes(method) ? (method as AttestationMethod) : "mac_approval",
        origin: text(row, "origin") === "computer" ? "computer" : "phone",
        openIntents: integer(row, "open_intents"),
        unreadActions: integer(row, "unread_actions"),
        audioAvailable: integer(row, "audio_parts") > 0,
      };
    });
  }

  /** Whether the meeting is stored (no decryption). */
  exists(id: LanaId): boolean {
    return this.ctx.db.get("SELECT id FROM meeting WHERE id = ?", id) !== undefined;
  }

  /** The full record: transcript, notes, intents as received, clips and user notes. */
  get(id: LanaId): MeetingRecord {
    const row = this.ctx.db.get("SELECT sealed_record FROM meeting WHERE id = ?", id);
    if (row === undefined) throw StoreError.notFound(id);
    return this.openRecord(id, blob(row, "sealed_record"));
  }

  clips(id: LanaId): readonly TranscriptClip[] {
    return this.get(id).clips;
  }

  /** Replaces the person's scratch-pad notes, stamped as a desktop change of the shared record. */
  updateUserNotes(id: LanaId, notes: readonly UserNote[]): void {
    const userNotes = notes.map((note) => ({ ...note, text: prefixGraphemes(note.text, USER_NOTE_MAX_LENGTH) }));
    this.shared.edit(id, (record) => ({ ...record, userNotes }), "meeting.notes_edited");
  }

  audioParts(id: LanaId): AudioPart[] {
    return this.ctx.db.all("SELECT idx, name, byte_count FROM meeting_audio WHERE meeting_id = ? AND purged_at IS NULL ORDER BY idx", id)
      .map((row) => ({ index: integer(row, "idx"), name: text(row, "name"), byteCount: integer(row, "byte_count") }));
  }

  /** Decrypted audio for playback (for example the clip behind an evidence quote). */
  audioData(id: LanaId, index: number): Uint8Array {
    const sealed = this.ctx.files.read(this.ctx.files.audioPath(id, index));
    if (sealed === null) throw StoreError.notFound(`audio ${id} ${index}`);
    return this.ctx.sealer.open(sealed, `audio|${id}|${index}`);
  }

  /** Retention: deletes audio for meetings received more than `days` ago. Transcripts stay. */
  purgeAudio(olderThanDays: number): number {
    const at = this.ctx.now();
    const cutoff = LanaDate.format(at.getTime() - olderThanDays * SECONDS_PER_DAY * 1_000);
    const { db, files } = this.ctx;
    return db.write(() => {
      const rows = db.all(`SELECT a.meeting_id, a.idx FROM meeting_audio a JOIN meeting m ON m.id = a.meeting_id
        WHERE a.purged_at IS NULL AND m.received_at < ?`, cutoff);
      for (const row of rows) {
        const meetingID = text(row, "meeting_id");
        const index = integer(row, "idx");
        if (parseLanaId(meetingID) !== null) files.remove(files.audioPath(meetingID, index));
        db.run("UPDATE meeting_audio SET purged_at = ? WHERE meeting_id = ? AND idx = ?", LanaDate.format(at), meetingID, index);
      }
      if (rows.length > 0) {
        appendAuditRecord(db, AUDIT_EVENTS.audioPurged, "retention", { parts: String(rows.length), days: String(olderThanDays) }, at);
      }
      return rows.length;
    });
  }

  private openRecord(id: string, sealed: Uint8Array): MeetingRecord {
    const context = `meeting|${id}`;
    const value = this.ctx.sealer.openJson(sealed, context);
    try {
      return decodeMeeting(value);
    } catch {
      throw StoreError.corrupt(context);
    }
  }
}

/** Swift `String(text.prefix(n))`: the first `n` grapheme clusters. */
function prefixGraphemes(value: string, count: number): string {
  if (value.length <= count) return value;
  return graphemes(value).slice(0, count).join("");
}
