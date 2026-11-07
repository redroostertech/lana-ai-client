import { randomUUID } from "node:crypto";
import type { DeviceIdentity } from "../crypto/deviceIdentity.js";
import { randomBytes } from "../crypto/random.js";
import type { DevicePublicKeys } from "../crypto/devicePublicKeys.js";
import type { OpenedBundle } from "../handoff/bundleOpener.js";
import { BonjourAdvertiser, gatewayServiceName, type Advertisement, type MdnsResponder } from "../handoff/discovery.js";
import { HandoffError } from "../handoff/errors.js";
import type { AccountInfo } from "../handoff/accountInfo.js";
import type { FrameChannel } from "../handoff/frameChannel.js";
import { SILENT_LOG, type HandoffLog } from "../handoff/log.js";
import { MacHandoffSession } from "../handoff/macHandoffSession.js";
import { SYSTEM_CLOCK, type ChallengePresenter, type Clock, type ToneOutput } from "../handoff/ports.js";
import type { Receipt } from "../handoff/receipt.js";
import { wakeValue } from "../handoff/wake.js";
import { fromHex, toHex } from "../bytes/hex.js";
import { HANDOFF_TLS, HandoffListener, type SocketFrameChannel } from "../handoff/tlsTransport.js";
import type { LanaId } from "../ids/lanaId.js";
import type { KeyVault } from "../keys/keyVault.js";
import { GatewayStore } from "../store/gatewayStore.js";
import type { BundleSink, RecordSync } from "../store/interfaces.js";
import type { SyncSnooze } from "../handoff/syncSnooze.js";
import type { CancelSendStatus } from "../store/sharedRecordRepository.js";
import type { AttestationRecord } from "../store/types.js";
import { GatewayEmitter, type GatewayEventMap, type GatewayStatus, type HandoffEvent, type PairingState } from "./events.js";
import { handoffSettingsPolicy, loadHandoffSettings, saveHandoffSettings, type HandoffSettings } from "./handoffSettings.js";
import { PAIRING_MESSAGES, PairingCoordinator } from "./pairingCoordinator.js";
import { revokeAllLeases, revokePhoneLeases, StoreLeaseAuthority } from "./backgroundUpdates.js";
import { wakeServiceUuid } from "../crypto/proximityUuid.js";

export interface GatewayOptions {
  /** Folder for the store (`gateway.sqlite`, `audio/`, `staging/`), for example `<userData>/Lana`. */
  readonly directory: string;
  /** The OS keystore vault: Mac identity and store data key (`createSealedFileKeyVault` with `safeStorageSealer`). */
  readonly vault: KeyVault;
  /** The Mac's name for a new identity (the phone shows it). Ignored once the identity exists. */
  readonly displayName: string;
  /** The speaker. In Electron, a `ToneBridge` to the renderer's Web Audio. */
  readonly tone: ToneOutput;
  readonly clock?: Clock;
  /** Ids and states only. */
  readonly log?: HandoffLog;
  /** Bind address; undefined listens on every interface (the phone reaches the Mac over the LAN). */
  readonly host?: string;
  /** Fixed port; 0 or undefined lets the system choose. */
  readonly port?: number;
  /** `false` turns Bonjour off (tests, cross test by port). Otherwise an mDNS responder factory, default `bonjour-service`. */
  readonly bonjour?: false | (() => MdnsResponder);
  /** How long a Mac approval prompt waits for the person before declining. Default: the policy's message timeout. */
  readonly approvalTimeoutMs?: number;
  /** Pairing invitation lifetime. Default five minutes. */
  readonly pairingLifetimeMs?: number;
}

export type GatewayOpenErrorKind = "identity" | "store";

/** Startup failures with the copy the app shows (Swift `BootstrapError`). */
export class GatewayOpenError extends Error {
  override readonly name = "GatewayOpenError";
  constructor(readonly kind: GatewayOpenErrorKind) {
    super(
      kind === "identity"
        ? "LANA could not create its identity on this computer. Check that the system keystore is available."
        : "LANA could not open its encrypted store. The keystore key may be missing or the data folder may be unreadable.",
    );
  }
}

const LISTENER_FAILED = "Could not open the network listener. Check that another copy of LANA is not running.";
const STOP_GRACE_MS = 2_000;

interface PendingApproval {
  readonly handoffId: string;
  readonly resolve: (approved: boolean) => void;
}

/**
 * The desktop gateway service (Swift `HandoffGateway` plus the pairing flow and the
 * parts of `GatewayDependencies` that start them): opens the Mac identity and the
 * encrypted store, runs ONE TLS-PSK listener whose keys are looked up per handshake
 * (each paired phone's transport key, or the open pairing invitation's key), advertises
 * `Lana-<id>` while any phone is paired and `Lana-Pair-<id>` while an invitation is open,
 * and runs a `MacHandoffSession` per connection with the firm's settings as policy.
 *
 * No Electron imports: the main process subscribes with `on` and forwards events over IPC,
 * and calls the answer methods when the renderer replies.
 */
export class HandoffGateway {
  readonly serviceName: string;
  private readonly emitter = new GatewayEmitter<GatewayEventMap>();
  private readonly clock: Clock;
  private readonly log: HandoffLog;
  private readonly pairingFlow: PairingCoordinator;
  private readonly channels = new Set<FrameChannel>();
  private readonly approvals = new Map<string, PendingApproval>();
  private listener: HandoffListener | undefined;
  private advertiser: BonjourAdvertiser | undefined;
  private gatewayAdvertisement: Advertisement | undefined;
  private wakeTxt: Readonly<Record<string, string>> = {};
  /**
   * Each phone's current wake nonce and the queue it stands for. The same queue keeps the
   * same nonce across sessions that end without delivering it, so the phone can tell a new
   * send from the same one seen again (its automatic sync backs off per flag).
   */
  private readonly wakeNonces = new Map<string, { readonly queue: string; readonly nonce: string }>();
  private currentStatus: GatewayStatus = { state: "stopped" };
  private port = 0;
  private activeTransfers = 0;
  private closed = false;
  private accountInfo: () => AccountInfo | null = () => null;

  private constructor(readonly identity: DeviceIdentity, readonly store: GatewayStore, private readonly options: GatewayOptions) {
    this.clock = options.clock ?? SYSTEM_CLOCK;
    this.log = options.log ?? SILENT_LOG;
    this.serviceName = gatewayServiceName(identity.publicKeys.deviceID);
    this.pairingFlow = new PairingCoordinator({
      identity,
      sink: store,
      clock: this.clock,
      log: this.log,
      lifetimeMs: options.pairingLifetimeMs,
      advertise: (name) => this.advertise(name),
      onState: (state) => this.emitter.emit("pairing", state),
      onPaired: () => this.pairingsChanged(),
    });
  }

  /** Opens the vault's Mac identity (created once) and the store sealed with the vault's data key. Does not listen yet. */
  static async open(options: GatewayOptions): Promise<HandoffGateway> {
    let identity: DeviceIdentity;
    try {
      identity = await options.vault.macIdentity(options.displayName);
    } catch {
      throw new GatewayOpenError("identity");
    }
    let store: GatewayStore;
    try {
      store = await GatewayStore.open({ directory: options.directory, keys: options.vault, ...(options.clock === undefined ? {} : { clock: options.clock }) });
    } catch {
      throw new GatewayOpenError("store");
    }
    return new HandoffGateway(identity, store, options);
  }

  // Events

  /** `gatewayStatus`, `pairing`, `handoff`, `meetingReceived`. Returns the unsubscribe function. */
  on<K extends keyof GatewayEventMap>(name: K, listener: (value: GatewayEventMap[K]) => void): () => void {
    return this.emitter.on(name, listener);
  }

  /**
   * Where each session reads the signed-in LANA account it shows on the phone (display
   * only, protocol 3). Return null while signed out.
   */
  setAccountInfoSource(source: () => AccountInfo | null): void {
    this.accountInfo = source;
  }

  get status(): GatewayStatus {
    return this.currentStatus;
  }

  get pairing(): PairingState {
    return this.pairingFlow.state;
  }

  // Lifecycle

  /** Opens the listener and the Bonjour advertisement. Safe to call again while running. */
  async start(): Promise<GatewayStatus> {
    if (this.closed) throw new GatewayOpenError("store");
    if (this.listener !== undefined) return this.currentStatus;
    this.setStatus({ state: "starting" });
    const listener = new HandoffListener({
      psks: (identity) => this.resolvePsk(identity),
      log: this.log,
      ...(this.options.host === undefined ? {} : { host: this.options.host }),
      ...(this.options.port === undefined ? {} : { port: this.options.port }),
    });
    try {
      this.port = await listener.start((channel) => this.handle(channel));
    } catch (error) {
      this.log.error("gateway.listener_failed", { reason: error instanceof HandoffError ? (error.detail ?? error.code) : "unknown" });
      return this.setStatus({ state: "failed", reason: "listener_unavailable", message: LISTENER_FAILED });
    }
    this.listener = listener;
    if (this.options.bonjour !== false) this.advertiser = new BonjourAdvertiser(this.options.bonjour, this.log);
    this.refreshAdvertisement();
    this.emitter.emit("wakeChanged", { flaggedPhones: this.wakeNonces.size });
    const status = this.listeningStatus();
    this.log.info("gateway.listening", { port: this.port, pairings: status.state === "listening" ? status.pairedDevices : 0 });
    return this.setStatus(status);
  }

  /** Cancels pairing, declines open prompts, withdraws Bonjour, closes live connections and the listener. */
  async stop(): Promise<void> {
    this.pairingFlow.cancel();
    for (const approval of [...this.approvals.values()]) approval.resolve(false);
    const listener = this.listener;
    this.listener = undefined;
    const advertisement = this.gatewayAdvertisement;
    this.gatewayAdvertisement = undefined;
    const advertiser = this.advertiser;
    this.advertiser = undefined;
    await advertisement?.stop().catch(() => undefined);
    await advertiser?.stop().catch(() => undefined);
    for (const channel of [...this.channels]) channel.close();
    if (listener !== undefined) await Promise.race([listener.stop(), delay(STOP_GRACE_MS)]);
    this.emitter.emit("wakeChanged", { flaggedPhones: 0 });
    if (this.currentStatus.state !== "stopped") {
      this.log.info("gateway.stopped");
      this.setStatus({ state: "stopped" });
    }
  }

  /** Stops and closes the store. The gateway cannot be started again. */
  async close(): Promise<void> {
    if (this.closed) return;
    await this.stop();
    this.closed = true;
    this.store.close();
  }

  // Pairing

  /** Shows a new invitation (QR text, five minute expiry, single use) on the running listener. */
  beginPairing(): PairingState {
    if (this.listener === undefined) {
      const failed: PairingState = { state: "failed", reason: "not_running", message: PAIRING_MESSAGES.not_running };
      this.emitter.emit("pairing", failed);
      return failed;
    }
    return this.pairingFlow.begin();
  }

  /** The person's answer to "Does your phone show this code?". */
  answerPairingCode(matches: boolean): void {
    this.pairingFlow.answer(matches);
  }

  /** Closes the invitation (or clears a finished one) and returns the panel to idle. */
  cancelPairing(): void {
    this.pairingFlow.cancel();
  }

  /** Revokes a phone: its key stops working at the next handshake. */
  async revokeDevice(deviceID: LanaId): Promise<void> {
    await this.store.revokeDevice(deviceID);
    await revokePhoneLeases(this.store.settings, this.store, deviceID, this.clock.now());
    await this.pairingsChanged();
  }

  /** Refreshes the status and the handoff advertisement after pairings change (Swift `pairingsChanged`). */
  async pairingsChanged(): Promise<void> {
    if (this.listener === undefined) return;
    this.refreshAdvertisement();
    this.setStatus(this.listeningStatus());
  }

  // Handoffs

  /** The person's answer to an `approval_requested` event. Unknown ids are ignored. */
  answerApproval(handoffId: string, approved: boolean): void {
    this.approvals.get(handoffId)?.resolve(approved);
  }

  handoffSettings(): HandoffSettings {
    return loadHandoffSettings(this.store.settings);
  }

  /** Applies to the next connection, as Swift reads the settings per connection. */
  saveHandoffSettings(settings: HandoffSettings): void {
    saveHandoffSettings(this.store.settings, settings);
  }

  // Private

  private resolvePsk(identity: string): Uint8Array | undefined {
    if (identity === HANDOFF_TLS.pairingIdentity) return this.pairingFlow.pskFor();
    try {
      return this.store.devices.transportPsks().find((entry) => entry.identity === identity)?.key;
    } catch {
      this.log.error("gateway.psk_lookup_failed");
      return undefined;
    }
  }

  private async handle(channel: SocketFrameChannel): Promise<void> {
    if (channel.peerIdentity === HANDOFF_TLS.pairingIdentity) {
      this.channels.add(channel);
      try {
        await this.pairingFlow.handle(channel);
      } finally {
        this.channels.delete(channel);
      }
      return;
    }
    const handoffId = randomUUID();
    const settings = this.handoffSettings();
    const policy = handoffSettingsPolicy(settings);
    const emit = (event: HandoffEvent): void => this.emitter.emit("handoff", event);
    const session = new MacHandoffSession({
      identity: this.identity,
      trust: this.store,
      tone: new CountingTone(this.options.tone, (play) => emit({ type: "tone", handoffId, play })),
      presenter: new GatewayChallengePresenter(handoffId, emit, (phone) => this.requestApproval(handoffId, phone, this.options.approvalTimeoutMs ?? policy.messageTimeoutMs)),
      sink: new ReportingSink(this.store, (opened, attestation, updated) =>
        this.emitter.emit("meetingReceived", {
          updated,
          handoffId,
          bundleId: opened.manifest.bundleID,
          meetingId: opened.meeting.id,
          phoneDeviceId: opened.manifest.phoneDeviceID,
          intents: opened.meeting.intents.length,
          quarantinedIntents: opened.rejectedIntents.length,
          audioParts: opened.audio.length,
          method: attestation.method,
          tonePlays: attestation.tonePlays,
          latencyMs: attestation.latencyMs,
        }),
      ),
      records: this.recordSync(),
      account: () => this.accountInfo(),
      snooze: (phone, snooze) => this.snoozed(phone, snooze),
      leases: new StoreLeaseAuthority({ identity: this.identity, settings: this.store.settings, trust: this.store, audit: this.store, clock: this.clock }),
      clock: this.clock,
      policy,
      log: this.log,
    });
    this.channels.add(channel);
    this.activeTransfers += 1;
    this.setStatus(this.listeningStatus());
    emit({ type: "started", handoffId, phoneDeviceId: channel.peerIdentity ?? null });
    this.log.info("gateway.handoff.started", { handoff: handoffId, ...(channel.peerIdentity === undefined ? {} : { phone: channel.peerIdentity }) });
    try {
      const bundles = await session.run(channel);
      emit({ type: "finished", handoffId, bundles });
      this.log.info("gateway.handoff.finished", { handoff: handoffId, bundles });
    } catch (error) {
      const code = error instanceof HandoffError ? error.code : "internal";
      emit({ type: "failed", handoffId, code });
      this.log.notice("gateway.handoff.ended_early", { handoff: handoffId, code });
    } finally {
      this.approvals.get(handoffId)?.resolve(false);
      this.channels.delete(channel);
      this.activeTransfers -= 1;
      if (this.listener !== undefined) this.setStatus(this.listeningStatus());
      // A queued meeting may have gone out: lower its wake flag.
      if (Object.keys(this.wakeTxt).length > 0) this.refreshWake();
    }
  }

  private requestApproval(handoffId: string, phone: DevicePublicKeys, timeoutMs: number): Promise<boolean> {
    this.approvals.get(handoffId)?.resolve(false);
    return new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => finish(false), timeoutMs);
      const finish = (approved: boolean): void => {
        if (this.approvals.get(handoffId)?.resolve !== finish) return;
        clearTimeout(timer);
        this.approvals.delete(handoffId);
        this.log.info("gateway.handoff.approval", { handoff: handoffId, approved });
        resolve(approved);
      };
      this.approvals.set(handoffId, { handoffId, resolve: finish });
      this.emitter.emit("handoff", { type: "approval_requested", handoffId, phoneDeviceId: phone.deviceID, phoneName: phone.displayName });
    });
  }

  // Shared records: desktop to phone

  /**
   * "Send to phone": queues the meeting for that phone and raises its wake flag. The
   * meeting goes out in the phone's next session (the phone still opens every session).
   */
  sendToPhone(meetingID: LanaId, phoneDeviceID: LanaId): void {
    this.store.shared.queueForPhone(meetingID, phoneDeviceID);
    this.refreshWake();
  }

  /**
   * "Cancel send": takes the meeting off that phone's queue and lowers its wake flag once
   * nothing is left for it. A meeting a session is delivering right now is not touched
   * (`delivering`); one cancelled before its turn in a session is skipped there.
   */
  cancelSend(meetingID: LanaId, phoneDeviceID: LanaId): CancelSendStatus {
    const status = this.store.shared.cancelQueued(meetingID, phoneDeviceID);
    this.log.info("gateway.send_cancel", { meeting: meetingID, phone: phoneDeviceID, status });
    if (status === "cancelled") this.refreshWake();
    return status;
  }

  /** The wake flags in the gateway's TXT record, one per phone with something queued. */
  get wakeRecord(): Readonly<Record<string, string>> {
    return this.wakeTxt;
  }

  /** Sign out: every background lease issued so far is refused from now on. */
  async revokeLeasesOnSignOut(): Promise<void> {
    await revokeAllLeases(this.store.settings, this.store, "signed_out", this.clock.now());
  }

  /**
   * The BLE wake service UUIDs to advertise at `at`: one per phone with something queued, for
   * that UTC day. Empty while the listener is stopped. The app's BLE helper advertises them.
   */
  bleWakeUuids(at: Date = this.clock.now()): string[] {
    if (this.listener === undefined || this.wakeNonces.size === 0) return [];
    try {
      return this.store.devices.transportPsks().filter((entry) => this.wakeNonces.has(entry.identity)).map((entry) => wakeServiceUuid(entry.key, at));
    } catch {
      this.log.error("gateway.ble_wake_failed");
      return [];
    }
  }

  /** The current wake nonce (hex) for a phone with something queued, or null. */
  wakeNonce(phoneDeviceID: string): string | null {
    return this.wakeNonces.get(phoneDeviceID)?.nonce ?? null;
  }

  /**
   * Recomputes the wake flags and re-advertises when they change. A phone keeps its nonce
   * while its queue is the same; a changed queue (a new send) gets a fresh one.
   */
  private refreshWake(): void {
    const flags: Record<string, string> = {};
    const flagged = new Set<string>();
    let index = 0;
    try {
      for (const entry of this.store.devices.transportPsks()) {
        const queue = this.store.shared.queue(entry.identity);
        if (queue.length === 0) continue;
        const key = [...queue].sort().join(",");
        const known = this.wakeNonces.get(entry.identity);
        const nonce = known !== undefined && known.queue === key ? known.nonce : toHex(randomBytes(8));
        this.wakeNonces.set(entry.identity, { queue: key, nonce });
        flagged.add(entry.identity);
        flags[`w${index}`] = wakeValue(entry.key, this.identity.publicKeys.deviceID, fromHex(nonce));
        index += 1;
      }
    } catch {
      this.log.error("gateway.wake_failed");
      return;
    }
    for (const phone of [...this.wakeNonces.keys()]) if (!flagged.has(phone)) this.wakeNonces.delete(phone);
    // Unchanged flags: no re-advertisement (the phone would see the same thing again).
    if (sameRecord(flags, this.wakeTxt)) return;
    this.wakeTxt = flags;
    this.log.info("gateway.wake", { flagged: index });
    this.emitter.emit("wakeChanged", { flaggedPhones: index });
    if (this.gatewayAdvertisement !== undefined) {
      const advertisement = this.gatewayAdvertisement;
      this.gatewayAdvertisement = undefined;
      void advertisement.stop().catch(() => undefined);
    }
    this.refreshAdvertisement();
  }

  /**
   * "Not now" from a phone (`sync_snooze`, verified by the session): while the flag it
   * answered is still this phone's current one, its queue is dropped ("Not now on <phone name>"),
   * the flag comes down, and the window refreshes. A stale nonce (a newer send since) changes
   * nothing: the newer send keeps its own flag.
   */
  private async snoozed(phone: DevicePublicKeys, snooze: SyncSnooze): Promise<void> {
    const current = this.wakeNonce(phone.deviceID);
    if (current === null || current !== snooze.wakeNonce) {
      this.log.info("gateway.snooze_stale", { phone: phone.deviceID });
      return;
    }
    const dropped = this.store.shared.snoozedByPhone(phone, snooze.snoozedAt);
    this.log.info("gateway.snoozed", { phone: phone.deviceID, meetings: dropped.length });
    this.refreshWake();
    if (dropped.length > 0) this.emitter.emit("recordsChanged", { phoneDeviceId: phone.deviceID, meetingIds: dropped, reason: "snoozed" });
  }

  /** The store as the session's record sync, telling the window when a queued meeting is declined or taken. */
  private recordSync(): RecordSync {
    const store = this.store;
    const changed = (phone: DevicePublicKeys, meetingID: string, reason: "declined" | "delivered"): void => {
      this.refreshWake();
      this.emitter.emit("recordsChanged", { phoneDeviceId: phone.deviceID, meetingIds: [meetingID], reason });
    };
    return {
      outgoingRecords: (phone, listed) => store.outgoingRecords(phone, listed),
      recordAcknowledged: async (phone, update, ack) => {
        const queued = store.shared.queue(phone.deviceID).includes(update.meetingID);
        await store.recordAcknowledged(phone, update, ack);
        if (queued) changed(phone, update.meetingID, "delivered");
      },
      recordDeclined: async (phone, update, decline) => {
        await store.recordDeclined(phone, update, decline);
        changed(phone, update.meetingID, "declined");
      },
      beginDelivery: (phone, meetingID) => store.beginDelivery(phone, meetingID),
      endDelivery: (phone, meetingID) => store.endDelivery(phone, meetingID),
    };
  }

  /** Advertises `Lana-<id>` on the listener port while any phone is paired. */
  private refreshAdvertisement(): void {
    if (this.advertiser === undefined || this.listener === undefined) return;
    const paired = this.pairedCount() > 0;
    if (paired && this.gatewayAdvertisement === undefined) {
      this.gatewayAdvertisement = this.advertiser.advertise(this.serviceName, this.port, { ...this.wakeTxt });
    } else if (!paired && this.gatewayAdvertisement !== undefined) {
      const advertisement = this.gatewayAdvertisement;
      this.gatewayAdvertisement = undefined;
      void advertisement.stop().catch(() => undefined);
    }
  }

  /** Pairing advertisement on the same listener; returns its withdraw function. */
  private advertise(serviceName: string): () => Promise<void> {
    if (this.advertiser === undefined) return () => Promise.resolve();
    const advertisement = this.advertiser.advertise(serviceName, this.port);
    return () => advertisement.stop();
  }

  private pairedCount(): number {
    try {
      return this.store.devices.list().length;
    } catch {
      return 0;
    }
  }

  private listeningStatus(): GatewayStatus {
    return { state: "listening", port: this.port, serviceName: this.serviceName, pairedDevices: this.pairedCount(), activeTransfers: this.activeTransfers };
  }

  private setStatus(status: GatewayStatus): GatewayStatus {
    this.currentStatus = status;
    this.emitter.emit("gatewayStatus", status);
    return status;
  }
}

/** Counts plays per connection for the UI, then plays through the shell's speaker. */
class CountingTone implements ToneOutput {
  private plays = 0;
  constructor(private readonly output: ToneOutput, private readonly onPlay: (play: number) => void) {}

  play(samples: Float32Array, sampleRate: number): Promise<void> {
    this.plays += 1;
    this.onPlay(this.plays);
    return this.output.play(samples, sampleRate);
  }
}

/** The proximity challenge as events: QR fallback, Mac approval, dismiss. */
class GatewayChallengePresenter implements ChallengePresenter {
  constructor(
    private readonly handoffId: string,
    private readonly emit: (event: HandoffEvent) => void,
    private readonly approve: (phone: DevicePublicKeys) => Promise<boolean>,
  ) {}

  async showQr(text: string): Promise<void> {
    this.emit({ type: "qr", handoffId: this.handoffId, qrText: text });
  }

  requestApproval(phone: DevicePublicKeys): Promise<boolean> {
    return this.approve(phone);
  }

  async dismiss(): Promise<void> {
    this.emit({ type: "dismissed", handoffId: this.handoffId });
  }
}

/** The store as the session's sink, reporting each stored meeting after it commits. */
class ReportingSink implements BundleSink {
  constructor(private readonly store: GatewayStore, private readonly onStored: (opened: OpenedBundle, attestation: AttestationRecord, updated: boolean) => void) {}

  existingReceipt(bundleID: LanaId): Promise<Receipt | null> {
    return this.store.existingReceipt(bundleID);
  }

  storedParts(bundleID: LanaId): Promise<Map<number, Uint8Array>> {
    return this.store.storedParts(bundleID);
  }

  storePart(bundleID: LanaId, index: number, ciphertext: Uint8Array): Promise<void> {
    return this.store.storePart(bundleID, index, ciphertext);
  }

  async complete(opened: OpenedBundle, receipt: Receipt, attestation: AttestationRecord): Promise<void> {
    // A later bundle for a meeting already here merges into the shared record.
    const updated = this.store.meetings.exists(opened.meeting.id);
    await this.store.complete(opened, receipt, attestation);
    this.onStored(opened, attestation, updated);
  }
}

function sameRecord(a: Readonly<Record<string, string>>, b: Readonly<Record<string, string>>): boolean {
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((key) => b[key] === a[key]);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms).unref());
}
