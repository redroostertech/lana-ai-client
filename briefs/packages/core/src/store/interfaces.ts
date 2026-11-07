import type { DevicePublicKeys } from "../crypto/devicePublicKeys.js";
import type { OpenedBundle } from "../handoff/bundleOpener.js";
import type { Receipt } from "../handoff/receipt.js";
import type { SharedMeeting } from "../handoff/messages.js";
import type { RecordAck, RecordDecline, RecordUpdate } from "../handoff/recordUpdate.js";
import type { MeetingRecord } from "../intent/meeting.js";
import type { LanaId } from "../ids/lanaId.js";
import type { AuditDetail, AuditEntry, AuditEvent, AuditVerification } from "./auditLog.js";
import type { AttestationRecord, PairedDevice, TransportPsk } from "./types.js";

/** Looks up phones this Mac has paired with (Swift `TrustStore`). Used by the handoff session. */
export interface TrustStore {
  pinnedPhone(deviceID: string): Promise<DevicePublicKeys | null>;
}

/** Where received bundles go (Swift `BundleSink`). Implemented by the gateway store. */
export interface BundleSink {
  /** Receipt for a bundle already fully stored, so a repeat offer is answered idempotently. */
  existingReceipt(bundleID: LanaId): Promise<Receipt | null>;
  /** Parts already on disk from an interrupted transfer, by index. */
  storedParts(bundleID: LanaId): Promise<Map<number, Uint8Array>>;
  storePart(bundleID: LanaId, index: number, ciphertext: Uint8Array): Promise<void>;
  /** Persists the opened meeting, its intents and the receipt atomically. */
  complete(opened: OpenedBundle, receipt: Receipt, attestation: AttestationRecord): Promise<void>;
}

/** A record the desktop sends to a phone in a protocol 2 session. */
export interface OutgoingRecord {
  readonly record: MeetingRecord;
  /** Audio for a meeting the phone does not hold; empty otherwise. */
  readonly audio: readonly { readonly name: string; readonly data: Uint8Array }[];
  /** Queued with "Send to phone" and new to the phone (it did not list it). */
  readonly queued?: boolean;
}

/** Shared meeting records, desktop side (protocol 2). Implemented by the gateway store. */
export interface RecordSync {
  /**
   * The records to send for a phone's `sync_request`: listed meetings shared with it whose
   * desktop copy differs, and meetings queued for it ("Send to phone") that it did not list.
   * Each carries its new revision, already kept by the store.
   */
  outgoingRecords(phone: DevicePublicKeys, listed: readonly SharedMeeting[]): Promise<OutgoingRecord[]>;
  /** The phone verified, applied and acknowledged an update. */
  recordAcknowledged(phone: DevicePublicKeys, update: RecordUpdate, ack: RecordAck): Promise<void>;
  /** The person declined a meeting sent to the phone (`sync_decline`, reason `declined`). */
  recordDeclined(phone: DevicePublicKeys, update: RecordUpdate, decline: RecordDecline): Promise<void>;
  /**
   * Right before a queued meeting's `sync_update`: false when it is no longer queued (the
   * send was cancelled). Otherwise it is marked as being delivered until `endDelivery`.
   */
  beginDelivery(phone: DevicePublicKeys, meetingID: LanaId): Promise<boolean>;
  /** The delivery ended: acknowledged, declined, or the session stopped. */
  endDelivery(phone: DevicePublicKeys, meetingID: LanaId): Promise<void>;
}

/** Records pairings once the six-digit code is confirmed. Used by the pairing session. */
export interface PairingSink {
  pairDevice(phone: DevicePublicKeys, transportPsk: Uint8Array): Promise<void>;
  /** Transport keys for every active pairing, for the TLS-PSK listener. */
  transportPsks(): Promise<TransportPsk[]>;
}

/** Appends to the tamper-evident audit chain. Detail holds ids and states, never content. */
export interface AuditSink {
  appendAudit(event: AuditEvent, subject: string, detail?: AuditDetail): Promise<void>;
}

/** The audit screen: entries, verification and the auditor export. */
export interface AuditTrail {
  auditEntries(after?: number, limit?: number): Promise<AuditEntry[]>;
  verifyAudit(): Promise<AuditVerification>;
  exportAudit(): Promise<Uint8Array>;
}

/** The devices screen. */
export interface DeviceDirectory {
  pairedDevices(includeRevoked?: boolean): Promise<PairedDevice[]>;
  revokeDevice(deviceID: LanaId): Promise<void>;
}
