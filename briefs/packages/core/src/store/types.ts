import type { DevicePublicKeys } from "../crypto/devicePublicKeys.js";
import type { AttestationMethod } from "../handoff/messages.js";
import type { LanaId } from "../ids/lanaId.js";
import type { Intent } from "../intent/intent.js";
import type { IntentStatus } from "../intent/intentStatus.js";

/** Time source, so tests control "now" (Swift `LanaClock`). */
export interface StoreClock {
  now(): Date;
}

export const SYSTEM_CLOCK: StoreClock = { now: () => new Date() };

/** Who moved an intent (Swift `GatewayStore.Actor`). */
export const ACTORS = ["phone", "user", "system"] as const;
export type Actor = (typeof ACTORS)[number];

/** How presence was proven for one session (Swift `AttestationRecord`). */
export interface AttestationRecord {
  readonly sessionID: string;
  readonly phoneDeviceID: LanaId;
  readonly method: AttestationMethod;
  readonly latencyMs: number;
  readonly attestedAt: Date;
  readonly tonePlays: number;
}

export interface PairedDevice {
  readonly keys: DevicePublicKeys;
  readonly pairedAt: Date;
  readonly revokedAt: Date | null;
}

/** Transport key for one active pairing, for the TLS-PSK listener. */
export interface TransportPsk {
  readonly identity: string;
  readonly key: Uint8Array;
}

/** Where a stored meeting was recorded. */
export type MeetingOrigin = "phone" | "computer";

export interface MeetingSummary {
  readonly id: LanaId;
  readonly title: string;
  readonly startedAt: Date;
  readonly durationSeconds: number;
  readonly receivedAt: Date;
  /** How the phone proved it was here. Meaningless for a meeting recorded on this computer. */
  readonly attestationMethod: AttestationMethod;
  /** `phone`: handed off from a paired phone. `computer`: recorded on this computer (no phone, no attestation). */
  readonly origin: MeetingOrigin;
  /** Intents still waiting on the person: transferred, resolved, confirmed or failed. */
  readonly openIntents: number;
  /** Actions on this meeting the person has not read (both tables, not deleted). */
  readonly unreadActions: number;
  readonly audioAvailable: boolean;
}

export interface AudioPart {
  readonly index: number;
  readonly name: string;
  readonly byteCount: number;
}

/** An intent as the gateway sees it: the phone's proposal plus local state. */
export interface StoredIntent {
  readonly intent: Intent;
  /** Opaque resolution produced by the executors. Sealed at rest. */
  readonly resolution: Uint8Array | null;
  readonly updatedAt: Date;
}

export interface IntentEvent {
  readonly seq: number;
  readonly intentID: LanaId;
  readonly from: IntentStatus | null;
  readonly to: IntentStatus;
  readonly actor: Actor;
  readonly detail: Readonly<Record<string, string>>;
  readonly at: Date;
}

export const LEDGER_STATUSES = ["pending", "completed", "failed"] as const;
export type LedgerStatus = (typeof LEDGER_STATUSES)[number];

/** Idempotency ledger row (Swift `LedgerRecord`). */
export interface LedgerRecord {
  readonly key: string;
  readonly planHash: string;
  readonly status: LedgerStatus;
  readonly result: string | null;
  readonly error: string | null;
  readonly attempts: number;
}

export interface OutboxEvent {
  readonly seq: number;
  readonly event: string;
  readonly payload: Readonly<Record<string, string>>;
  readonly createdAt: Date;
}

export const MIRROR_KINDS = ["matter", "contact", "user"] as const;
export type MirrorKind = (typeof MIRROR_KINDS)[number];

/** Local mirror of a firm entity, for offline candidate search. */
export interface MirrorEntity {
  readonly source: string;
  readonly externalID: string;
  readonly kind: MirrorKind;
  readonly name: string;
  readonly email?: string | undefined;
  readonly displayNumber?: string | undefined;
  readonly clientName?: string | undefined;
}

/** A saved Ask conversation. Turns are opaque to the store and sealed at rest. */
export interface StoredAskThread {
  readonly id: string;
  /** Null when the thread asks across all meetings. */
  readonly meetingID: LanaId | null;
  readonly turns: Uint8Array;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}
