import { join } from "node:path";
import type { DevicePublicKeys } from "../crypto/devicePublicKeys.js";
import type { OpenedBundle } from "../handoff/bundleOpener.js";
import type { Receipt } from "../handoff/receipt.js";
import type { SharedMeeting } from "../handoff/messages.js";
import type { RecordAck, RecordDecline, RecordUpdate } from "../handoff/recordUpdate.js";
import type { LanaId } from "../ids/lanaId.js";
import type { DataKeyProvider } from "../keys/dataKeyProvider.js";
import { ActionRepository } from "./actionRepository.js";
import { AskRepository } from "./askRepository.js";
import type { AuditDetail, AuditEntry, AuditEvent, AuditVerification } from "./auditLog.js";
import { AuditRepository } from "./auditRepository.js";
import { BundleRepository } from "./bundleRepository.js";
import { Database } from "./database.js";
import { DeviceRepository } from "./deviceRepository.js";
import { FieldSealer } from "./fieldSealer.js";
import { migrate } from "./gatewaySchema.js";
import { IntentRepository } from "./intentRepository.js";
import type { AuditSink, AuditTrail, BundleSink, DeviceDirectory, OutgoingRecord, PairingSink, RecordSync, TrustStore } from "./interfaces.js";
import { LedgerRepository } from "./ledgerRepository.js";
import { LocalMeetingRepository } from "./localMeetingRepository.js";
import { MeetingRepository } from "./meetingRepository.js";
import { MirrorRepository } from "./mirrorRepository.js";
import { OutboxRepository } from "./outboxRepository.js";
import { SettingsRepository } from "./settingsRepository.js";
import { ClipDraftRepository } from "./clipDraftRepository.js";
import { SharedRecordRepository } from "./sharedRecordRepository.js";
import { StoreContext } from "./storeContext.js";
import { StoreFiles } from "./storeFiles.js";
import { SYSTEM_CLOCK, type AttestationRecord, type PairedDevice, type StoreClock, type TransportPsk } from "./types.js";

export const STORE_DATABASE_FILE = "gateway.sqlite";

export interface GatewayStoreOptions {
  /** Folder for `gateway.sqlite`, `audio/` and `staging/`. Created if missing. */
  readonly directory: string;
  readonly keys: DataKeyProvider;
  readonly clock?: StoreClock;
}

/**
 * The gateway's system of record (Swift `GatewayStore`): paired phones, received
 * meetings, intent state machines, the idempotency ledger, the audit chain and the
 * outbox. Every state change and its audit record commit in one transaction.
 * Sensitive columns and audio files are sealed with the data key; ids, dates and
 * statuses stay in clear so they can be indexed, exactly as in the Swift store.
 */
export class GatewayStore implements TrustStore, BundleSink, RecordSync, PairingSink, AuditSink, AuditTrail, DeviceDirectory {
  readonly devices: DeviceRepository;
  readonly meetings: MeetingRepository;
  readonly bundles: BundleRepository;
  readonly intents: IntentRepository;
  readonly ledger: LedgerRepository;
  readonly audit: AuditRepository;
  readonly outbox: OutboxRepository;
  readonly mirror: MirrorRepository;
  readonly ask: AskRepository;
  readonly settings: SettingsRepository;
  /** Shared meeting records: the desktop copy, edits, conflicts, phone merges and sends. */
  readonly shared: SharedRecordRepository;
  /** Drafts LANA writes in the background (desktop only). */
  readonly clipDrafts: ClipDraftRepository;
  /** Every action, from the phone or added by hand, with soft delete (desktop only). */
  readonly actions: ActionRepository;
  /** Meetings recorded on this computer (desktop only). */
  readonly local: LocalMeetingRepository;

  private constructor(private readonly ctx: StoreContext) {
    this.devices = new DeviceRepository(ctx);
    this.intents = new IntentRepository(ctx);
    this.shared = new SharedRecordRepository(ctx, this.intents);
    this.meetings = new MeetingRepository(ctx, this.shared);
    this.bundles = new BundleRepository(ctx, this.shared);
    this.ledger = new LedgerRepository(ctx);
    this.audit = new AuditRepository(ctx);
    this.outbox = new OutboxRepository(ctx);
    this.mirror = new MirrorRepository(ctx);
    this.ask = new AskRepository(ctx);
    this.settings = new SettingsRepository(ctx);
    this.clipDrafts = new ClipDraftRepository(ctx);
    this.actions = new ActionRepository(ctx, this.intents);
    this.local = new LocalMeetingRepository(ctx, this.shared);
  }

  /**
   * Seals bytes with the store's data key (AAD `lana.gateway|<context>`), for state that
   * lives next to the store, such as a recording in progress.
   */
  seal(data: Uint8Array, context: string): Uint8Array {
    return this.ctx.sealer.seal(data, context);
  }

  open(data: Uint8Array, context: string): Uint8Array {
    return this.ctx.sealer.open(data, context);
  }

  /** The store's folder (`gateway.sqlite`, `audio/`, `staging/`). */
  get directory(): string {
    return this.ctx.files.directory;
  }

  /** Opens (creating and migrating if needed) the store. Fails if the data key is unavailable. */
  static async open(options: GatewayStoreOptions): Promise<GatewayStore> {
    const sealer = new FieldSealer(await options.keys.dataKey());
    const files = new StoreFiles(options.directory);
    const db = new Database(join(options.directory, STORE_DATABASE_FILE));
    try {
      migrate(db);
    } catch (error) {
      db.close();
      throw error;
    }
    return new GatewayStore(new StoreContext(db, sealer, files, options.clock ?? SYSTEM_CLOCK));
  }

  close(): void {
    this.ctx.db.close();
  }

  // MARK: - TrustStore, PairingSink, DeviceDirectory

  async pinnedPhone(deviceID: string): Promise<DevicePublicKeys | null> {
    return this.devices.pinnedPhone(deviceID);
  }

  async pairDevice(phone: DevicePublicKeys, transportPsk: Uint8Array): Promise<void> {
    this.devices.pair(phone, transportPsk);
  }

  async transportPsks(): Promise<TransportPsk[]> {
    return this.devices.transportPsks();
  }

  async pairedDevices(includeRevoked = false): Promise<PairedDevice[]> {
    return this.devices.list(includeRevoked);
  }

  async revokeDevice(deviceID: LanaId): Promise<void> {
    this.devices.revoke(deviceID);
  }

  // MARK: - BundleSink

  async existingReceipt(bundleID: LanaId): Promise<Receipt | null> {
    return this.bundles.existingReceipt(bundleID);
  }

  async storedParts(bundleID: LanaId): Promise<Map<number, Uint8Array>> {
    return this.bundles.storedParts(bundleID);
  }

  async storePart(bundleID: LanaId, index: number, ciphertext: Uint8Array): Promise<void> {
    this.bundles.storePart(bundleID, index, ciphertext);
  }

  async complete(opened: OpenedBundle, receipt: Receipt, attestation: AttestationRecord): Promise<void> {
    this.bundles.complete(opened, receipt, attestation);
  }

  // MARK: - RecordSync

  async outgoingRecords(phone: DevicePublicKeys, listed: readonly SharedMeeting[]): Promise<OutgoingRecord[]> {
    return this.shared.outgoing(phone, listed);
  }

  async recordAcknowledged(phone: DevicePublicKeys, update: RecordUpdate, ack: RecordAck): Promise<void> {
    this.shared.acknowledged(phone, update, ack);
  }

  async recordDeclined(phone: DevicePublicKeys, update: RecordUpdate, decline: RecordDecline): Promise<void> {
    this.shared.declinedByPhone(phone, update, decline);
  }

  async beginDelivery(phone: DevicePublicKeys, meetingID: LanaId): Promise<boolean> {
    return this.shared.beginDelivery(phone.deviceID, meetingID);
  }

  async endDelivery(phone: DevicePublicKeys, meetingID: LanaId): Promise<void> {
    this.shared.endDelivery(phone.deviceID, meetingID);
  }

  // MARK: - AuditSink, AuditTrail

  async appendAudit(event: AuditEvent, subject: string, detail: AuditDetail = {}): Promise<void> {
    this.audit.append(event, subject, detail);
  }

  async auditEntries(after = 0, limit = -1): Promise<AuditEntry[]> {
    return this.audit.entries(after, limit);
  }

  async verifyAudit(): Promise<AuditVerification> {
    return this.audit.verify();
  }

  async exportAudit(): Promise<Uint8Array> {
    return this.audit.export();
  }
}
