import { randomUUID } from "node:crypto";
import { toBase64Url } from "../bytes/base64.js";
import { bytesEqualConstantTime } from "../bytes/concat.js";
import type { DeviceIdentity } from "../crypto/deviceIdentity.js";
import { verifyDeviceSignature, type DevicePublicKeys } from "../crypto/devicePublicKeys.js";
import { randomBytes } from "../crypto/random.js";
import { LanaDate } from "../json/lanaDate.js";
import { modulateTone } from "../tone/toneModulator.js";
import { STANDARD_TONE } from "../tone/toneConfiguration.js";
import { issueAccountInfoUpdate, type AccountInfo } from "./accountInfo.js";
import { attestationSignedBytes } from "./attestation.js";
import type { BundleManifest } from "./bundleManifest.js";
import { checkPart, openBundle, verifyManifest } from "./bundleOpener.js";
import { HandoffError } from "./errors.js";
import { expectMessage, type FrameChannel } from "./frameChannel.js";
import { SILENT_LOG, type HandoffLog } from "./log.js";
import { DEFAULT_MAC_HANDOFF_POLICY, HANDOFF_ACCOUNT_INFO_VERSION, recordDecisionTimeoutMs, HANDOFF_PROTOCOL_VERSION, HANDOFF_SHARED_RECORD_VERSION, HANDOFF_SNOOZE_VERSION, HANDOFF_BACKGROUND_LEASE_VERSION, NONCE_BYTES, type MacHandoffPolicy } from "./macHandoffPolicy.js";
import type { AttestationMethod, Failure } from "./messages.js";
import { SYSTEM_CLOCK, type ChallengePresenter, type Clock, type ToneOutput } from "./ports.js";
import { issueReceipt } from "./receipt.js";
import { issueRecordUpdate, verifyRecordAck, verifyRecordDecline } from "./recordUpdate.js";
import { verifySyncSnooze, type SyncSnooze } from "./syncSnooze.js";
import { checkLeaseSession, type LeaseAuthority, type LeaseSession } from "./backgroundLease.js";
import type { BundleSink, OutgoingRecord, RecordSync, TrustStore } from "../store/interfaces.js";
import type { AttestationRecord } from "../store/types.js";

export interface MacHandoffDependencies {
  readonly identity: DeviceIdentity;
  readonly trust: TrustStore;
  readonly tone: ToneOutput;
  readonly presenter: ChallengePresenter;
  readonly sink: BundleSink;
  /** Shared meeting records (protocol 2). Without it the session stays on protocol 1. */
  readonly records?: RecordSync;
  /**
   * The LANA account signed in on this desktop, display only (protocol 3). Null while signed
   * out: nothing is sent and the phone keeps what it last received.
   */
  readonly account?: () => AccountInfo | null | Promise<AccountInfo | null>;
  /**
   * "Not now" on the phone (protocol 4, `sync_snooze`), already verified: take down what is
   * queued for this phone for that wake flag. Without it the session stays on protocol 3.
   */
  readonly snooze?: (phone: DevicePublicKeys, snooze: SyncSnooze) => Promise<void>;
  /**
   * Background leases (protocol 5): issues a lease after a tone or QR attested session and
   * admits leased, receive-only sessions. Without it the session stays on protocol 4.
   */
  readonly leases?: LeaseAuthority;
  readonly clock?: Clock;
  readonly policy?: MacHandoffPolicy;
  readonly log?: HandoffLog;
}

/** `attest` result for a session that was only "Not now" (`sync_snooze`). */
const SNOOZED = Symbol("snoozed");

/** `attest` result for a background session admitted on its lease (receive only). */
interface Leased {
  readonly leased: LeaseSession;
}

/** `lananotes://attest?s=<session>&n=<base64url nonce>`, the QR fallback the phone scans. */
export function attestationQrText(sessionID: string, nonce: Uint8Array): string {
  return `lananotes://attest?s=${sessionID}&n=${toBase64Url(nonce)}`;
}

/** What the phone is told when the Mac stops a handoff (Swift `MacHandoffSession.failure(for:)`). */
export function handoffFailure(error: HandoffError): Failure {
  switch (error.code) {
    case "unknown_device":
      return { code: "unknown_device", detail: "This phone is not paired with this Mac" };
    case "protocol_version":
      return { code: "protocol_version", detail: "Update LANA Briefs" };
    case "attestation_failed":
      return { code: "attestation_failed", detail: error.detail ?? "" };
    case "bundle_rejected":
      return { code: "bundle_rejected", detail: error.detail ?? "" };
    default:
      return { code: "internal", detail: "Transfer stopped" };
  }
}

/**
 * Runs one handoff connection on the Mac (Swift `MacHandoffSession`): hello, proximity
 * challenge, then any number of bundle transfers, each ending with a signed receipt.
 */
export class MacHandoffSession {
  private readonly clock: Clock;
  private readonly policy: MacHandoffPolicy;
  private readonly log: HandoffLog;

  constructor(private readonly deps: MacHandoffDependencies) {
    this.clock = deps.clock ?? SYSTEM_CLOCK;
    this.policy = deps.policy ?? DEFAULT_MAC_HANDOFF_POLICY;
    this.log = deps.log ?? SILENT_LOG;
  }

  /** Resolves to the number of bundles received. Always closes the channel. */
  async run(channel: FrameChannel): Promise<number> {
    let phone: DevicePublicKeys | undefined;
    try {
      const handshake = await this.handshake(channel);
      phone = handshake.phone;
      const attestation = await this.attest(channel, phone, handshake.version);
      await this.deps.presenter.dismiss();
      // "Not now": nothing was proven and nothing is exchanged.
      if (attestation === SNOOZED) return 0;
      // A background session on a lease: receive only, nothing accepted from the phone.
      if ("leased" in attestation) return await this.receiveLeased(channel, phone, handshake.version);
      return await this.receiveBundles(channel, phone, attestation, handshake.version);
    } catch (error) {
      if (error instanceof HandoffError) {
        await this.deps.presenter.dismiss();
        await channel.send({ message: { type: "failure", payload: handoffFailure(error) }, body: new Uint8Array() }).catch(() => undefined);
        this.log.error("handoff.mac.ended", { code: error.code, ...(phone === undefined ? {} : { phone: phone.deviceID }) });
      }
      throw error;
    } finally {
      channel.close();
    }
  }

  private async handshake(channel: FrameChannel): Promise<{ phone: DevicePublicKeys; version: number }> {
    const { payload: hello } = await expectMessage(channel, this.policy.messageTimeoutMs, "hello");
    if (hello.protocolVersion !== HANDOFF_PROTOCOL_VERSION) throw new HandoffError("protocol_version");
    // The PSK already proved which phone this is; the hello must agree with it.
    if (channel.peerIdentity !== undefined && hello.deviceID !== channel.peerIdentity) throw new HandoffError("unknown_device");
    const phone = await this.deps.trust.pinnedPhone(hello.deviceID);
    if (phone === null) throw new HandoffError("unknown_device");
    // Protocol 2 and up only when the phone offers it and this gateway keeps shared records.
    const offered = hello.maxProtocolVersion ?? HANDOFF_PROTOCOL_VERSION;
    const highest = this.deps.snooze === undefined ? HANDOFF_ACCOUNT_INFO_VERSION : this.deps.leases === undefined ? HANDOFF_SNOOZE_VERSION : HANDOFF_BACKGROUND_LEASE_VERSION;
    const version = this.deps.records === undefined ? HANDOFF_PROTOCOL_VERSION : Math.max(HANDOFF_PROTOCOL_VERSION, Math.min(offered, highest));
    return { phone, version };
  }

  private async attest(channel: FrameChannel, phone: DevicePublicKeys, version: number): Promise<AttestationRecord | typeof SNOOZED | Leased> {
    const policy = this.policy;
    const sessionID = randomUUID().toUpperCase();
    const nonce = randomBytes(NONCE_BYTES);
    const issuedAt = this.clock.now().getTime();
    await send(channel, {
      type: "challenge",
      payload: { sessionID, methods: [...policy.allowedMethods], nonceBytes: nonce.length, protocolVersion: version > HANDOFF_PROTOCOL_VERSION ? version : undefined },
    });

    let plays = 0;
    let lastEmission = issuedAt;
    for (;;) {
      const { message } = await channel.receive(policy.messageTimeoutMs);
      switch (message.type) {
        case "listening": {
          if (message.payload.sessionID !== sessionID || !policy.allowedMethods.includes("acoustic")) throw new HandoffError("unexpected_message", message.type);
          if (plays >= policy.maxTonePlays) throw new HandoffError("attestation_failed", "too many tone attempts");
          plays += 1;
          await this.deps.tone.play(modulateTone(nonce), STANDARD_TONE.sampleRate);
          lastEmission = this.clock.now().getTime();
          this.log.info("handoff.mac.tone_played", { plays });
          break;
        }
        case "fallback": {
          const method = message.payload.method;
          if (!policy.allowedMethods.includes(method)) throw new HandoffError("unexpected_message", message.type);
          if (method === "qr") {
            await this.deps.presenter.showQr(attestationQrText(sessionID, nonce));
            lastEmission = this.clock.now().getTime();
            await send(channel, { type: "qr_shown", payload: { sessionID } });
            break;
          }
          if (method === "mac_approval") {
            if (!(await this.deps.presenter.requestApproval(phone))) throw new HandoffError("attestation_failed", "declined on Mac");
            return this.finishAttestation(channel, sessionID, phone, "mac_approval", 0, plays);
          }
          throw new HandoffError("unexpected_message", "fallback to acoustic");
        }
        case "attest": {
          const attestation = message.payload;
          const now = this.clock.now().getTime();
          if (attestation.sessionID !== sessionID) throw new HandoffError("attestation_failed", "wrong session");
          if ((attestation.method !== "acoustic" && attestation.method !== "qr") || !policy.allowedMethods.includes(attestation.method)) {
            throw new HandoffError("attestation_failed", "method not allowed");
          }
          if (now - issuedAt > policy.nonceLifetimeMs) throw new HandoffError("attestation_failed", "nonce expired");
          const latency = now - lastEmission;
          if (latency > policy.maxResponseMs) throw new HandoffError("attestation_failed", "response too slow");
          if (!bytesEqualConstantTime(attestation.nonce, nonce)) throw new HandoffError("attestation_failed", "nonce mismatch");
          const signed = attestationSignedBytes(sessionID, nonce, channel.channelBinding, attestation.method);
          if (!verifyDeviceSignature(phone, attestation.signature, signed)) throw new HandoffError("attestation_failed", "bad signature");
          if (policy.requireMacConfirmation && !(await this.deps.presenter.requestApproval(phone))) {
            throw new HandoffError("attestation_failed", "declined on Mac");
          }
          return this.finishAttestation(channel, sessionID, phone, attestation.method, Math.trunc(latency), plays);
        }
        case "sync_snooze": {
          // Protocol 4: no presence proof needed, it only takes this phone's queue down.
          if (version < HANDOFF_SNOOZE_VERSION || this.deps.snooze === undefined) throw new HandoffError("unexpected_message", message.type);
          if (!verifySyncSnooze(message.payload, sessionID, this.deps.identity.publicKeys.deviceID, phone)) throw new HandoffError("attestation_failed", "bad snooze");
          await this.deps.snooze(phone, message.payload);
          await send(channel, { type: "sync_done" });
          this.log.info("handoff.mac.snoozed", { phone: phone.deviceID });
          return SNOOZED;
        }
        case "lease_session":
          return this.admitLease(channel, phone, version, sessionID, message.payload);
        case "failure":
          throw new HandoffError("peer_failed", message.payload.detail, message.payload.code);
        default:
          throw new HandoffError("unexpected_message", message.type);
      }
    }
  }

  /**
   * Protocol 5: a background session presents its lease instead of a presence proof. The lease
   * must verify (phone and Mac signatures, this session, scope, expiry) and pass the desktop's
   * policy (setting on, phone paired, not revoked). A refusal is audited and ends the session.
   */
  private async admitLease(channel: FrameChannel, phone: DevicePublicKeys, version: number, sessionID: string, presented: LeaseSession): Promise<Leased> {
    const leases = this.deps.leases;
    if (version < HANDOFF_BACKGROUND_LEASE_VERSION || leases === undefined) throw new HandoffError("unexpected_message", "lease_session");
    const rejection = checkLeaseSession(presented, { sessionID, mac: this.deps.identity.publicKeys, phone, now: this.clock.now() }) ?? (await leases.admit(phone, presented.lease));
    if (rejection !== null) {
      await leases.finished(phone, { result: "rejected", reason: rejection, listed: 0, updatesSent: 0, updatesAcknowledged: 0 });
      this.log.notice("handoff.mac.lease_rejected", { phone: phone.deviceID, reason: rejection });
      throw new HandoffError("attestation_failed", `lease ${rejection}`);
    }
    await send(channel, { type: "lease_accepted", payload: { sessionID } });
    this.log.info("handoff.mac.lease_accepted", { phone: phone.deviceID });
    return { leased: presented };
  }

  /**
   * A leased background session: one `sync_request`, then updates to meetings already shared
   * with this phone and listed by it (never queued sends, which need the person's Accept), the
   * account, `sync_done`. No bundles, no declines: anything but `sync_request`, `sync_ack` and
   * `done` ends the session.
   */
  private async receiveLeased(channel: FrameChannel, phone: DevicePublicKeys, version: number): Promise<number> {
    const leases = this.deps.leases as LeaseAuthority;
    const counts = { listed: 0, updatesSent: 0, updatesAcknowledged: 0 };
    try {
      let requested = false;
      for (;;) {
        const { message } = await channel.receive(this.policy.messageTimeoutMs);
        switch (message.type) {
          case "done":
            await leases.finished(phone, { result: "completed", ...counts });
            return 0;
          case "sync_request": {
            const records = this.deps.records;
            if (requested || records === undefined) throw new HandoffError("unexpected_message", message.type);
            requested = true;
            counts.listed = message.payload.meetings.length;
            await this.sendRecords(channel, phone, records, message.payload.meetings, version, { leased: counts });
            break;
          }
          case "offer":
            throw new HandoffError("bundle_rejected", "not allowed in a background session");
          case "failure":
            throw new HandoffError("peer_failed", message.payload.detail, message.payload.code);
          default:
            throw new HandoffError("unexpected_message", message.type);
        }
      }
    } catch (error) {
      await leases.finished(phone, { result: "failed", reason: error instanceof HandoffError ? error.code : "internal", ...counts }).catch(() => undefined);
      throw error;
    }
  }

  private async finishAttestation(
    channel: FrameChannel,
    sessionID: string,
    phone: DevicePublicKeys,
    method: AttestationMethod,
    latencyMs: number,
    plays: number,
  ): Promise<AttestationRecord> {
    await send(channel, { type: "attested", payload: { sessionID, method, latencyMs } });
    this.log.info("handoff.mac.attested", { method, latencyMs, phone: phone.deviceID });
    return {
      sessionID,
      phoneDeviceID: phone.deviceID,
      method,
      latencyMs,
      attestedAt: new Date(LanaDate.milliseconds(this.clock.now())),
      tonePlays: plays,
    };
  }

  private async receiveBundles(channel: FrameChannel, phone: DevicePublicKeys, attestation: AttestationRecord, version: number): Promise<number> {
    let count = 0;
    for (;;) {
      const { message } = await channel.receive(this.policy.messageTimeoutMs);
      switch (message.type) {
        case "done":
          return count;
        case "offer": {
          const manifest = message.payload;
          verifyManifest(manifest, phone, this.deps.identity.publicKeys);
          const existing = await this.deps.sink.existingReceipt(manifest.bundleID);
          if (existing !== null) {
            await send(channel, { type: "receipt", payload: existing });
            this.log.info("handoff.mac.duplicate_offer", { bundle: manifest.bundleID });
          } else {
            await this.receiveBundle(channel, manifest, attestation);
          }
          count += 1;
          break;
        }
        case "sync_request": {
          const records = this.deps.records;
          if (version < HANDOFF_SHARED_RECORD_VERSION || records === undefined) throw new HandoffError("unexpected_message", message.type);
          await this.sendRecords(channel, phone, records, message.payload.meetings, version, { method: attestation.method });
          break;
        }
        case "failure":
          throw new HandoffError("peer_failed", message.payload.detail, message.payload.code);
        default:
          throw new HandoffError("unexpected_message", message.type);
      }
    }
  }

  /** Protocol 2: each desktop copy the phone needs, sealed to its key, then `sync_done`. */
  private async sendRecords(
    channel: FrameChannel,
    phone: DevicePublicKeys,
    records: RecordSync,
    listed: Parameters<RecordSync["outgoingRecords"]>[1],
    version: number,
    session: { readonly method: AttestationMethod } | { readonly leased: { updatesSent: number; updatesAcknowledged: number } },
  ): Promise<void> {
    const leased = "leased" in session ? session.leased : null;
    for (const outgoing of await records.outgoingRecords(phone, listed)) {
      // A leased session never offers a meeting the phone does not hold (only the person can accept one).
      if (leased !== null && outgoing.queued === true) continue;
      // A queued meeting new to the phone goes only if it is still queued at its turn (a
      // cancel may have landed since `sync_request`); from here a cancel answers "delivering".
      if (outgoing.queued === true && !(await records.beginDelivery(phone, outgoing.record.id))) {
        this.log.info("handoff.mac.record_skipped", { meeting: outgoing.record.id, state: "cancelled" });
        continue;
      }
      try {
        if (leased !== null) leased.updatesSent += 1;
        await this.sendRecord(channel, phone, records, outgoing, leased !== null);
        if (leased !== null) leased.updatesAcknowledged += 1;
      } finally {
        if (outgoing.queued === true) await records.endDelivery(phone, outgoing.record.id);
      }
    }
    if (version >= HANDOFF_ACCOUNT_INFO_VERSION) await this.sendAccount(channel, phone);
    // Protocol 5: a session proven by tone or QR renews the lease (or clears it when the setting is off).
    if (version >= HANDOFF_BACKGROUND_LEASE_VERSION && "method" in session && (session.method === "acoustic" || session.method === "qr")) await this.sendLease(channel, phone);
    await send(channel, { type: "sync_done" });
  }

  /**
   * One `sync_update` and its parts, then the phone's `sync_ack` or `sync_decline`. A meeting
   * the phone does not hold waits for the person there (the phone's 45 s decision window),
   * so the answer gets `recordDecisionTimeoutMs` rather than the message timeout.
   */
  private async sendRecord(channel: FrameChannel, phone: DevicePublicKeys, records: RecordSync, outgoing: OutgoingRecord, leased = false): Promise<void> {
    const { update, parts } = await issueRecordUpdate({ record: outgoing.record, audio: outgoing.audio, phone, mac: this.deps.identity, at: this.clock.now() });
    await channel.send({ message: { type: "sync_update", payload: update }, body: parts[0] as Uint8Array });
    for (let index = 1; index < parts.length; index += 1) {
      await channel.send({ message: { type: "sync_part", payload: { bundleID: update.updateID, index } }, body: parts[index] as Uint8Array });
    }
    const { message } = await channel.receive(recordDecisionTimeoutMs(this.policy));
    switch (message.type) {
      case "sync_ack": {
        const ack = message.payload;
        if (!verifyRecordAck(ack, update, phone)) throw new HandoffError("receipt_invalid", "record ack");
        await records.recordAcknowledged(phone, update, ack);
        this.log.info("handoff.mac.record_sent", { meeting: update.meetingID, revision: update.revision, parts: parts.length, inSync: ack.contentHash === update.contentHash });
        return;
      }
      case "sync_decline": {
        // Nothing is accepted from a phone in a background session, declines included.
        if (leased) throw new HandoffError("unexpected_message", message.type);
        const decline = message.payload;
        if (!verifyRecordDecline(decline, update, phone)) throw new HandoffError("receipt_invalid", "record decline");
        // "later": no answer on the phone. It stays queued and is not offered again this session.
        if (decline.reason === "declined") await records.recordDeclined(phone, update, decline);
        this.log.info("handoff.mac.record_declined", { meeting: update.meetingID, reason: decline.reason });
        return;
      }
      case "failure":
        throw new HandoffError("peer_failed", message.payload.detail, message.payload.code);
      default:
        throw new HandoffError("unexpected_message", message.type);
    }
  }

  /** Protocol 5: a fresh lease, or an empty grant when background updates are off. No answer is expected. */
  private async sendLease(channel: FrameChannel, phone: DevicePublicKeys): Promise<void> {
    const lease = (await this.deps.leases?.issue(phone)) ?? null;
    await send(channel, { type: "background_lease", payload: lease === null ? {} : { lease } });
    this.log.info("handoff.mac.lease_sent", { phone: phone.deviceID, granted: lease !== null });
  }

  /** Protocol 3: the signed-in account, sealed to the phone. No answer is expected. */
  private async sendAccount(channel: FrameChannel, phone: DevicePublicKeys): Promise<void> {
    const account = await this.deps.account?.();
    if (account === null || account === undefined) return;
    const update = await issueAccountInfoUpdate({ account, phone, mac: this.deps.identity, at: this.clock.now() });
    await send(channel, { type: "account_info", payload: update });
    this.log.info("handoff.mac.account_sent", { phone: phone.deviceID });
  }

  private async receiveBundle(channel: FrameChannel, manifest: BundleManifest, attestation: AttestationRecord): Promise<void> {
    const total = manifest.parts.length;
    const parts = new Map<number, Uint8Array>();
    for (const [index, data] of await this.deps.sink.storedParts(manifest.bundleID)) {
      const part = manifest.parts[index];
      if (Number.isInteger(index) && part !== undefined && checkPart(data, part)) parts.set(index, data);
    }
    await send(channel, { type: "resume", payload: { bundleID: manifest.bundleID, haveParts: [...parts.keys()].sort((a, b) => a - b) } });
    while (parts.size < total) {
      const { payload: header, body } = await expectMessage(channel, this.policy.messageTimeoutMs, "part");
      const part = header.bundleID === manifest.bundleID ? manifest.parts[header.index] : undefined;
      if (part === undefined || !Number.isInteger(header.index) || header.index < 0) throw new HandoffError("bundle_rejected", "unexpected part");
      if (!checkPart(body, part)) throw new HandoffError("bundle_rejected", `part ${header.index} hash mismatch`);
      await this.deps.sink.storePart(manifest.bundleID, header.index, body);
      parts.set(header.index, body);
      await send(channel, { type: "part_ack", payload: header });
    }
    const ordered = manifest.parts.map((_, index) => parts.get(index) as Uint8Array);
    const opened = await openBundle(manifest, ordered, this.deps.identity);
    const receipt = issueReceipt(manifest, this.deps.identity, this.clock.now());
    await this.deps.sink.complete(opened, receipt, attestation);
    await send(channel, { type: "receipt", payload: receipt });
    this.log.info("handoff.mac.bundle_received", { bundle: manifest.bundleID, parts: total, rejectedIntents: opened.rejectedIntents.length });
  }
}

function send(channel: FrameChannel, message: Parameters<FrameChannel["send"]>[0]["message"]): Promise<void> {
  return channel.send({ message, body: new Uint8Array() });
}
