import type { LanaId } from "../ids/lanaId.js";
import type { DevicePublicKeys } from "../crypto/devicePublicKeys.js";
import type { BundleManifest } from "./bundleManifest.js";
import type { FailureCode } from "./errors.js";
import type { Receipt } from "./receipt.js";
import type { AccountInfoUpdate } from "./accountInfo.js";
import type { RecordAck, RecordDecline, RecordUpdate } from "./recordUpdate.js";
import type { SyncSnooze } from "./syncSnooze.js";
import type { BackgroundLeaseGrant, LeaseSession } from "./backgroundLease.js";

export const ATTESTATION_METHODS = ["acoustic", "qr", "mac_approval"] as const;
/** How presence was proven for a session. */
export type AttestationMethod = (typeof ATTESTATION_METHODS)[number];

// Payload field names are the Swift property names: these structs have no CodingKeys,
// so their wire keys are camelCase (`deviceID`, `sessionID`), unlike the records.

export interface Hello {
  /** Always the base version (1). */
  readonly protocolVersion: number;
  readonly deviceID: LanaId;
  readonly appVersion: string;
  /** Highest version the phone speaks (2: shared meeting records). Absent means 1. */
  readonly maxProtocolVersion?: number | undefined;
}

export interface Challenge {
  readonly sessionID: string;
  readonly methods: readonly AttestationMethod[];
  readonly nonceBytes: number;
  /** The version the Mac chose, when above 1. */
  readonly protocolVersion?: number | undefined;
}

/** One meeting the phone holds that is shared with this Mac (Swift `SharedMeeting`). */
export interface SharedMeeting {
  readonly meetingID: LanaId;
  readonly revision: number;
  readonly contentHash: string;
}

export interface SyncRequest {
  readonly meetings: readonly SharedMeeting[];
}

export interface FallbackRequest {
  readonly method: AttestationMethod;
  readonly reason: string;
}

export interface Attestation {
  readonly sessionID: string;
  readonly method: AttestationMethod;
  readonly nonce: Uint8Array;
  readonly signature: Uint8Array;
}

export interface AttestationResult {
  readonly sessionID: string;
  readonly method: AttestationMethod;
  readonly latencyMs: number;
}

export interface BundleResume {
  readonly bundleID: LanaId;
  readonly haveParts: readonly number[];
}

export interface PartHeader {
  readonly bundleID: LanaId;
  readonly index: number;
}

export interface Failure {
  readonly code: FailureCode;
  readonly detail: string;
}

export interface PairRequest {
  readonly phone: DevicePublicKeys;
  readonly proof: Uint8Array;
}

export interface PairDecision {
  readonly accepted: boolean;
}

export interface SessionRef {
  readonly sessionID: string;
}

/** Every protocol message. On the wire: `{"payload": ..., "type": ...}`. */
export type HandoffMessage =
  | { readonly type: "hello"; readonly payload: Hello }
  | { readonly type: "challenge"; readonly payload: Challenge }
  /** Phone is capturing audio; the Mac should play the tone now. */
  | { readonly type: "listening"; readonly payload: SessionRef }
  | { readonly type: "fallback"; readonly payload: FallbackRequest }
  /** Mac is showing the nonce as a QR code. */
  | { readonly type: "qr_shown"; readonly payload: SessionRef }
  | { readonly type: "attest"; readonly payload: Attestation }
  | { readonly type: "attested"; readonly payload: AttestationResult }
  | { readonly type: "offer"; readonly payload: BundleManifest }
  | { readonly type: "resume"; readonly payload: BundleResume }
  | { readonly type: "part"; readonly payload: PartHeader }
  | { readonly type: "part_ack"; readonly payload: PartHeader }
  | { readonly type: "receipt"; readonly payload: Receipt }
  | { readonly type: "done" }
  | { readonly type: "failure"; readonly payload: Failure }
  | { readonly type: "pair_request"; readonly payload: PairRequest }
  | { readonly type: "pair_decision"; readonly payload: PairDecision }
  | { readonly type: "pair_complete"; readonly payload: DevicePublicKeys }
  /** Protocol 2: the phone's shared meetings, after its offers. */
  | { readonly type: "sync_request"; readonly payload: SyncRequest }
  /** Protocol 2: the desktop's copy of one record; the frame body is the sealed record. */
  | { readonly type: "sync_update"; readonly payload: RecordUpdate }
  /** Protocol 2: one audio part of a record update (frame body). */
  | { readonly type: "sync_part"; readonly payload: PartHeader }
  | { readonly type: "sync_ack"; readonly payload: RecordAck }
  /** Protocol 2: instead of `sync_ack`, the phone did not take a meeting it does not hold. */
  | { readonly type: "sync_decline"; readonly payload: RecordDecline }
  /** Protocol 3: the desktop's LANA account, display only, sealed to the phone, before `sync_done`. */
  | { readonly type: "account_info"; readonly payload: AccountInfoUpdate }
  | { readonly type: "sync_done" }
  /** Protocol 4: instead of `listening`, the person said "Not now"; the desktop answers `sync_done`. */
  | { readonly type: "sync_snooze"; readonly payload: SyncSnooze }
  /** Protocol 5: after a tone or QR attested session, before `sync_done`: a fresh lease, or none (setting off). */
  | { readonly type: "background_lease"; readonly payload: BackgroundLeaseGrant }
  /** Protocol 5: instead of `listening`, a background session presents its lease (receive only). */
  | { readonly type: "lease_session"; readonly payload: LeaseSession }
  /** Protocol 5: the desktop accepted the lease; the phone sends `sync_request` next. */
  | { readonly type: "lease_accepted"; readonly payload: SessionRef };

export type HandoffMessageType = HandoffMessage["type"];
