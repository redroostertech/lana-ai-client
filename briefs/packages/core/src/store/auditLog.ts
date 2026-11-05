import { concatBytes } from "../bytes/concat.js";
import { utf8 } from "../bytes/utf8.js";
import { sha256Hex } from "../crypto/digest.js";
import { canonicalEncode, canonicalString } from "../json/canonical.js";
import type { JsonObject } from "../json/jsonValue.js";
import { LanaDate } from "../json/lanaDate.js";
import { integer, text, type Database } from "./database.js";
import { parseStoredDate } from "./storedDate.js";

/**
 * Audit events. All but `entitlement.changed` match Swift `AuditEvent`. Entries this build no
 * longer writes (such as `license.changed` from earlier builds) stay in the chain and verify.
 */
export const AUDIT_EVENTS = {
  devicePaired: "device.paired",
  deviceRevoked: "device.revoked",
  bundleReceived: "bundle.received",
  intentQuarantined: "intent.quarantined",
  intentTransition: "intent.transition",
  intentEdited: "intent.edited",
  actionExecuted: "action.executed",
  actionFailed: "action.failed",
  actionUndone: "action.undone",
  connectorLinked: "connector.linked",
  connectorUnlinked: "connector.unlinked",
  audioPurged: "audio.purged",
  meetingUpdated: "meeting.updated",
  /** A meeting recorded on this computer was stored: `{audio_parts, consent}`. Subject the meeting id. */
  meetingRecorded: "meeting.recorded",
  /** LANA wrote the notes for a meeting recorded here: `{key_points, intents}`. Subject the meeting id. */
  meetingNotesWritten: "meeting.notes_written",
  meetingQueued: "meeting.queued",
  recordUpdateSent: "record.update_sent",
  recordConflictResolved: "record.conflict_resolved",
  recordSendDeclined: "record.send_declined",
  recordSendCancelled: "record.send_cancelled",
  recordSendSnoozed: "record.send_snoozed",
  leaseIssued: "handoff.lease_issued",
  leasedSession: "handoff.leased_session",
  leasesRevoked: "handoff.leases_revoked",
  /** LANA Briefs turned on or off for the organization: `{state: "enabled" | "disabled"}`, subject the organization id. */
  entitlementChanged: "entitlement.changed",
  /** LANA drafting in the background: `{draft_id, kind}`, then `drafted` and `intent_id` when ready. Subject the meeting id. */
  draftRequested: "draft.requested",
  draftReady: "draft.ready",
  draftCancelled: "draft.cancelled",
  draftAdded: "draft.added",
  /** The Inbox (desktop only). Subject the action id; detail ids, types and states only. */
  actionCreatedManually: "action.created_manually",
  actionSaved: "action.saved",
  actionDeleted: "action.deleted",
  actionRestored: "action.restored",
  /** Ran on LANA: `{lana_id}`. Undone on LANA is `actionUndone` with `{lana_id}`. */
  actionRan: "action.ran",
} as const;
export type AuditEvent = (typeof AUDIT_EVENTS)[keyof typeof AUDIT_EVENTS];

/** Non-sensitive audit detail: ids, types, states, methods. Never note text. */
export type AuditDetail = Readonly<Record<string, string>>;

/** One tamper-evident record. `hash = SHA-256(prev_hash | at | event | subject | detail)`. */
export interface AuditEntry {
  readonly seq: number;
  readonly at: Date;
  readonly event: string;
  readonly subject: string;
  /** Canonical JSON of the detail object, as stored and hashed. */
  readonly detail: string;
  readonly prevHash: string;
  readonly hash: string;
}

export interface AuditVerification {
  readonly entries: number;
  /** First sequence number whose hash does not match, null when the chain is intact. */
  readonly brokenAt: number | null;
  readonly isIntact: boolean;
}

export const AUDIT_GENESIS = "0".repeat(64);

/** Swift `AuditEntry.computeHash`: lowercase hex SHA-256 of the fields joined by `|`. */
export function auditHash(prev: string, at: Date, event: string, subject: string, detail: string): string {
  return sha256Hex(utf8([prev, LanaDate.format(at), event, subject, detail].join("|")));
}

/** Swift `AuditWriter.verify`: walks from the genesis hash, stopping at the first break. */
export function verifyAuditChain(entries: readonly AuditEntry[]): AuditVerification {
  let prev = AUDIT_GENESIS;
  for (const entry of entries) {
    const expected = auditHash(prev, entry.at, entry.event, entry.subject, entry.detail);
    if (entry.prevHash !== prev || entry.hash !== expected) {
      return { entries: entries.length, brokenAt: entry.seq, isIntact: false };
    }
    prev = entry.hash;
  }
  return { entries: entries.length, brokenAt: null, isIntact: true };
}

/** `AuditEntry` as Swift's `Codable` conformance writes it. */
export function encodeAuditEntry(entry: AuditEntry): JsonObject {
  return {
    seq: entry.seq,
    at: LanaDate.format(entry.at),
    event: entry.event,
    subject: entry.subject,
    detail: entry.detail,
    prev_hash: entry.prevHash,
    hash: entry.hash,
  };
}

/**
 * JSON Lines export of the full chain plus a trailer with the head hash, byte
 * identical to `GatewayStore.exportAudit`, so an auditor can re-verify it with SHA-256.
 */
export function exportAuditLines(entries: readonly AuditEntry[]): Uint8Array {
  const newline = Uint8Array.of(0x0a);
  const lines: Uint8Array[] = [];
  for (const entry of entries) lines.push(canonicalEncode(encodeAuditEntry(entry)), newline);
  const trailer = {
    head: entries.at(-1)?.hash ?? AUDIT_GENESIS,
    entries: String(entries.length),
    intact: String(verifyAuditChain(entries).isIntact),
  };
  lines.push(canonicalEncode(trailer), newline);
  return concatBytes(...lines);
}

// MARK: - SQL

/** Appends one record inside the caller's transaction (Swift `AuditWriter.append`). */
export function appendAuditRecord(db: Database, event: AuditEvent, subject: string, detail: AuditDetail, at: Date): void {
  const detailJson = canonicalString(detail);
  const head = db.get("SELECT hash FROM audit_log ORDER BY seq DESC LIMIT 1");
  const prev = head === undefined ? AUDIT_GENESIS : text(head, "hash");
  const hash = auditHash(prev, at, event, subject, detailJson);
  db.run("INSERT INTO audit_log (at, event, subject, detail, prev_hash, hash) VALUES (?, ?, ?, ?, ?, ?)",
    LanaDate.format(at), event, subject, detailJson, prev, hash);
}

/** Entries with `seq > after`, oldest first. A negative limit means no limit. */
export function readAuditEntries(db: Database, after = 0, limit = -1): AuditEntry[] {
  return db.all("SELECT * FROM audit_log WHERE seq > ? ORDER BY seq LIMIT ?", after, limit).map((row) => ({
    seq: integer(row, "seq"),
    at: parseStoredDate(text(row, "at")),
    event: text(row, "event"),
    subject: text(row, "subject"),
    detail: text(row, "detail"),
    prevHash: text(row, "prev_hash"),
    hash: text(row, "hash"),
  }));
}
