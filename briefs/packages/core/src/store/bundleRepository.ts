import { encodeManifest } from "../handoff/bundleManifest.js";
import type { OpenedBundle } from "../handoff/bundleOpener.js";
import { decodeReceipt, encodeReceipt, type Receipt } from "../handoff/receipt.js";
import type { LanaId } from "../ids/lanaId.js";
import { encodeIntent, transitioned } from "../intent/intent.js";
import { encodeMeeting } from "../intent/meeting.js";
import { canonicalString } from "../json/canonical.js";
import { LanaDate } from "../json/lanaDate.js";
import { parseJson } from "../json/parse.js";
import { appendAuditRecord, AUDIT_EVENTS } from "./auditLog.js";
import { text } from "./database.js";
import { appendIntentEvent } from "./intentRepository.js";
import { enqueueOutbox } from "./outboxRepository.js";
import type { SharedRecordRepository } from "./sharedRecordRepository.js";
import type { StoreContext } from "./storeContext.js";
import type { AttestationRecord } from "./types.js";

/**
 * Received bundles (Swift `GatewayStore: BundleSink`): staged parts for resume,
 * then one transaction that stores the meeting, its intents, the receipt and the audit.
 */
export class BundleRepository {
  constructor(private readonly ctx: StoreContext, private readonly shared: SharedRecordRepository) {}

  /** Receipt for a bundle already fully stored, so a repeat offer is answered idempotently. */
  existingReceipt(bundleID: LanaId): Receipt | null {
    const row = this.ctx.db.get("SELECT receipt FROM bundle_receipt WHERE bundle_id = ?", bundleID);
    return row === undefined ? null : decodeReceipt(parseJson(text(row, "receipt")));
  }

  /** Parts already on disk from an interrupted transfer, by index. */
  storedParts(bundleID: LanaId): Map<number, Uint8Array> {
    return this.ctx.files.stagedParts(bundleID);
  }

  /** Parts are still HPKE-protected ciphertext; staging them needs no extra sealing. */
  storePart(bundleID: LanaId, index: number, ciphertext: Uint8Array): void {
    this.ctx.files.writeProtected(this.ctx.files.stagingPath(bundleID, index), ciphertext);
  }

  /** Persists the opened meeting, its intents and the receipt atomically, then clears staging. */
  complete(opened: OpenedBundle, receipt: Receipt, attestation: AttestationRecord): void {
    const { db, sealer, files } = this.ctx;
    const meeting = opened.meeting;
    const bundleID = opened.manifest.bundleID;
    const at = this.ctx.now();
    if (db.get("SELECT id FROM meeting WHERE id = ?", meeting.id) !== undefined) {
      this.update(opened, receipt, attestation);
      return;
    }
    // Audio first: if the transaction fails, orphan files are harmless and overwritten on retry.
    opened.audio.forEach((audio, offset) => {
      files.writeProtected(files.audioPath(meeting.id, offset), sealer.seal(audio.data, `audio|${meeting.id}|${offset}`));
    });
    db.write(() => {
      db.run(`INSERT INTO meeting (id, bundle_id, phone_device_id, started_at, duration_seconds, received_at, attestation_method, attestation_latency_ms, sealed_record)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        meeting.id, bundleID, opened.manifest.phoneDeviceID, LanaDate.format(meeting.startedAt), meeting.durationSeconds,
        LanaDate.format(at), attestation.method, attestation.latencyMs, sealer.sealJson(encodeMeeting(meeting), `meeting|${meeting.id}`));
      opened.audio.forEach((audio, offset) => {
        db.run("INSERT INTO meeting_audio (meeting_id, idx, name, file_name, byte_count) VALUES (?, ?, ?, ?, ?)",
          meeting.id, offset, audio.name, files.audioFileName(meeting.id, offset), audio.data.length);
      });
      for (const proposal of meeting.intents) {
        const stored = proposal.status === "proposed" ? transitioned(proposal, "transferred") : proposal;
        db.run("INSERT INTO intent (id, meeting_id, type, status, idempotency_key, sealed_intent, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
          stored.id, meeting.id, stored.type, stored.status, stored.idempotencyKey,
          sealer.sealJson(encodeIntent(stored), `intent|${stored.id}`), LanaDate.format(at));
        appendIntentEvent(db, stored.id, "proposed", stored.status, "phone", { bundle_id: bundleID }, at);
      }
      for (const rejected of opened.rejectedIntents) {
        appendAuditRecord(db, AUDIT_EVENTS.intentQuarantined, rejected.intent.id,
          { meeting_id: meeting.id, issues: rejected.issues.map((issue) => issue.field).join(",") }, at);
      }
      db.run("INSERT INTO bundle_receipt (bundle_id, receipt, manifest, received_at) VALUES (?, ?, ?, ?)",
        receipt.bundleID, canonicalString(encodeReceipt(receipt)), canonicalString(encodeManifest(opened.manifest)), LanaDate.format(at));
      appendAuditRecord(db, AUDIT_EVENTS.bundleReceived, bundleID, {
        meeting_id: meeting.id,
        phone_device_id: opened.manifest.phoneDeviceID,
        attestation_method: attestation.method,
        attestation_latency_ms: String(attestation.latencyMs),
        tone_plays: String(attestation.tonePlays),
        intents: String(meeting.intents.length),
        quarantined: String(opened.rejectedIntents.length),
        audio_parts: String(opened.audio.length),
      }, at);
      enqueueOutbox(db, "meeting.received", { meeting_id: meeting.id, intents: String(meeting.intents.length) }, at);
    });
    files.clearStaging(bundleID);
  }

  /** A later bundle for a meeting already here (shared record): merged, receipted, audited. */
  private update(opened: OpenedBundle, receipt: Receipt, attestation: AttestationRecord): void {
    const { db, sealer, files } = this.ctx;
    const meeting = opened.meeting;
    const bundleID = opened.manifest.bundleID;
    const at = this.ctx.now();
    const hasAudio = db.get("SELECT COUNT(*) AS n FROM meeting_audio WHERE meeting_id = ?", meeting.id);
    const addAudio = opened.audio.length > 0 && Number(hasAudio?.["n"] ?? 0) === 0;
    if (addAudio) {
      opened.audio.forEach((audio, offset) => {
        files.writeProtected(files.audioPath(meeting.id, offset), sealer.seal(audio.data, `audio|${meeting.id}|${offset}`));
      });
    }
    db.write(() => {
      const merged = this.shared.mergeIncoming(opened);
      if (addAudio) {
        opened.audio.forEach((audio, offset) => {
          db.run("INSERT INTO meeting_audio (meeting_id, idx, name, file_name, byte_count) VALUES (?, ?, ?, ?, ?)",
            meeting.id, offset, audio.name, files.audioFileName(meeting.id, offset), audio.data.length);
        });
      }
      db.run("UPDATE meeting SET bundle_id = ? WHERE id = ?", bundleID, meeting.id);
      const known = new Set(merged.intents.map((intent) => intent.id));
      for (const rejected of opened.rejectedIntents) {
        if (known.has(rejected.intent.id)) continue;
        appendAuditRecord(db, AUDIT_EVENTS.intentQuarantined, rejected.intent.id,
          { meeting_id: meeting.id, issues: rejected.issues.map((issue) => issue.field).join(",") }, at);
      }
      db.run("INSERT INTO bundle_receipt (bundle_id, receipt, manifest, received_at) VALUES (?, ?, ?, ?)",
        receipt.bundleID, canonicalString(encodeReceipt(receipt)), canonicalString(encodeManifest(opened.manifest)), LanaDate.format(at));
      appendAuditRecord(db, AUDIT_EVENTS.meetingUpdated, bundleID, {
        meeting_id: meeting.id,
        phone_device_id: opened.manifest.phoneDeviceID,
        attestation_method: attestation.method,
        revision: String(merged.sync?.revision ?? 0),
        conflicts: String(merged.sync?.conflicts.length ?? 0),
      }, at);
      enqueueOutbox(db, "meeting.updated", { meeting_id: meeting.id }, at);
    });
    files.clearStaging(bundleID);
  }
}
