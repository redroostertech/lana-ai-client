import { fromBase64Url } from "../../src/bytes/index.js";
import { phoneProof, shortCode, type DevicePublicKeys, type PairingInvitation, type SoftwareIdentity } from "../../src/crypto/index.js";
import {
  attestationSignedBytes, expectMessage, HandoffError, verifyReceipt, type AccountInfoUpdate, type AttestationMethod, type BundleManifest,
  type ChallengePresenter, type Clock, type FrameChannel, type HandoffMessage, type OpenedBundle, type PairingPresenter, type Receipt, type RecordUpdate,
  type SharedMeeting, type ToneOutput, type BackgroundLeaseGrant,
} from "../../src/handoff/index.js";
import type { AttestationRecord, BundleSink, PairingSink, TransportPsk, TrustStore } from "../../src/store/index.js";
import type { LanaId } from "../../src/ids/index.js";
import { decodeAlignedBurst } from "./toneDecode.js";

export class MemoryTrust implements TrustStore, PairingSink {
  readonly psks = new Map<string, Uint8Array>();
  constructor(readonly phones: DevicePublicKeys[] = []) {}
  async pinnedPhone(deviceID: string): Promise<DevicePublicKeys | null> {
    return this.phones.find((phone) => phone.deviceID === deviceID) ?? null;
  }
  async pairDevice(phone: DevicePublicKeys, transportPsk: Uint8Array): Promise<void> {
    this.phones.push(phone);
    this.psks.set(phone.deviceID, transportPsk);
  }
  async transportPsks(): Promise<TransportPsk[]> {
    return [...this.psks].map(([identity, key]) => ({ identity, key }));
  }
}

export class MemorySink implements BundleSink {
  readonly parts = new Map<LanaId, Map<number, Uint8Array>>();
  readonly receipts = new Map<LanaId, Receipt>();
  readonly completed: { opened: OpenedBundle; attestation: AttestationRecord }[] = [];
  storeCalls = 0;
  async existingReceipt(bundleID: LanaId): Promise<Receipt | null> {
    return this.receipts.get(bundleID) ?? null;
  }
  async storedParts(bundleID: LanaId): Promise<Map<number, Uint8Array>> {
    return new Map(this.parts.get(bundleID));
  }
  async storePart(bundleID: LanaId, index: number, ciphertext: Uint8Array): Promise<void> {
    this.storeCalls += 1;
    this.preload(bundleID, index, ciphertext);
  }
  async complete(opened: OpenedBundle, receipt: Receipt, attestation: AttestationRecord): Promise<void> {
    this.receipts.set(opened.manifest.bundleID, receipt);
    this.completed.push({ opened, attestation });
  }
  preload(bundleID: LanaId, index: number, data: Uint8Array): void {
    const parts = this.parts.get(bundleID) ?? new Map<number, Uint8Array>();
    parts.set(index, data);
    this.parts.set(bundleID, parts);
  }
}

/** The air between speaker and microphone: keeps every burst played, or drops them when muted. */
export class Air implements ToneOutput {
  muted = false;
  plays = 0;
  private pending: ((samples: Float32Array | undefined) => void)[] = [];
  private bursts: Float32Array[] = [];
  async play(samples: Float32Array, sampleRate: number): Promise<void> {
    if (sampleRate !== 48_000) throw new Error("unexpected sample rate");
    this.plays += 1;
    const heard = this.muted ? undefined : samples;
    const waiter = this.pending.shift();
    if (waiter !== undefined) waiter(heard);
    else if (heard !== undefined) this.bursts.push(heard);
  }
  /** What the phone's microphone picks up within `timeoutMs`. */
  listen(timeoutMs = 500): Promise<Float32Array | undefined> {
    const ready = this.bursts.shift();
    if (ready !== undefined) return Promise.resolve(ready);
    return new Promise((resolve) => {
      const waiter = (samples: Float32Array | undefined): void => {
        clearTimeout(timer);
        resolve(samples);
      };
      const timer = setTimeout(() => {
        this.pending = this.pending.filter((entry) => entry !== waiter);
        resolve(undefined);
      }, timeoutMs);
      this.pending.push(waiter);
    });
  }
}

export class FakePresenter implements ChallengePresenter {
  approve = true;
  qr: string | undefined;
  approvals = 0;
  dismissals = 0;
  async showQr(text: string): Promise<void> {
    this.qr = text;
  }
  async requestApproval(): Promise<boolean> {
    this.approvals += 1;
    return this.approve;
  }
  async dismiss(): Promise<void> {
    this.dismissals += 1;
  }
}

export class FakePairingPresenter implements PairingPresenter {
  readonly codes: string[] = [];
  aborted = false;
  constructor(private readonly answer: boolean | (() => Promise<boolean>) = true) {}
  async confirmCode(code: string, _phone: DevicePublicKeys, signal: AbortSignal): Promise<boolean> {
    this.codes.push(code);
    signal.addEventListener("abort", () => (this.aborted = true));
    return typeof this.answer === "boolean" ? this.answer : this.answer();
  }
}

export class FakeClock implements Clock {
  constructor(public ms = Date.parse("2026-11-01T12:00:00.000Z")) {}
  now(): Date {
    return new Date(this.ms);
  }
  advance(ms: number): void {
    this.ms += ms;
  }
}

export interface ScriptedBundle {
  readonly manifest: BundleManifest;
  readonly parts: Uint8Array[];
}

export interface PhoneScript {
  readonly identity: SoftwareIdentity;
  readonly mac: DevicePublicKeys;
  readonly bundles: ScriptedBundle[];
  readonly air: Air;
  readonly presenter: FakePresenter;
  readonly acousticAttempts?: number;
  readonly fallback?: AttestationMethod;
  /** Runs before the attestation is sent (clock tricks). */
  readonly beforeAttest?: () => void;
  /** Highest protocol the phone offers (2: shared records, 3: account info). Absent means 1. */
  readonly maxProtocolVersion?: number;
  /** Protocol 2: the meetings the phone lists in `sync_request`. */
  readonly listed?: readonly SharedMeeting[];
  /**
   * Protocol 2: the phone's answer to a `sync_update` once all its parts arrived (`sync_ack`
   * or `sync_decline`). Without it an update is a protocol error.
   */
  readonly answerUpdate?: (update: RecordUpdate, parts: Uint8Array[]) => Promise<HandoffMessage>;
}

export interface PhoneResult {
  readonly method: AttestationMethod;
  readonly delivered: LanaId[];
  readonly sentParts: number;
  /** The version the Mac chose (1 when the challenge named none). */
  readonly version: number;
  /** Protocol 2 and up: message types the Mac sent after `sync_request`, through `sync_done`. */
  readonly syncMessages: string[];
  readonly accountInfo: AccountInfoUpdate[];
  /** Protocol 5: every `background_lease` grant the Mac sent. */
  readonly leaseGrants: BackgroundLeaseGrant[];
}

/**
 * A TypeScript stand-in for the Swift `PhoneHandoffSession`, step for step, so the Mac
 * session can be tested in process. The cross test drives the Mac with the real Swift code.
 */
export async function runScriptedPhone(channel: FrameChannel, script: PhoneScript): Promise<PhoneResult> {
  const timeout = 5_000;
  try {
    await channel.send({
      message: { type: "hello", payload: { protocolVersion: 1, deviceID: script.identity.publicKeys.deviceID, appVersion: "1.0", maxProtocolVersion: script.maxProtocolVersion } },
      body: new Uint8Array(),
    });
    const { payload: challenge } = await expectMessage(channel, timeout, "challenge");
    const version = Math.min(challenge.protocolVersion ?? 1, script.maxProtocolVersion ?? 1);
    const method = await attest(channel, script, challenge.sessionID, challenge.methods, challenge.nonceBytes);
    const delivered: LanaId[] = [];
    let sentParts = 0;
    for (const bundle of script.bundles) {
      await channel.send({ message: { type: "offer", payload: bundle.manifest }, body: new Uint8Array() });
      const { message } = await channel.receive(timeout);
      let receipt: Receipt;
      if (message.type === "receipt") {
        receipt = message.payload;
      } else if (message.type === "resume") {
        const have = new Set(message.payload.haveParts);
        for (const part of bundle.manifest.parts) {
          if (have.has(part.index)) continue;
          const header = { bundleID: bundle.manifest.bundleID, index: part.index };
          await channel.send({ message: { type: "part", payload: header }, body: bundle.parts[part.index] as Uint8Array });
          sentParts += 1;
          await expectMessage(channel, timeout, "part_ack", (ack) => ack.bundleID === header.bundleID && ack.index === header.index);
        }
        receipt = (await expectMessage(channel, timeout, "receipt")).payload;
      } else if (message.type === "failure") {
        throw new HandoffError("peer_failed", message.payload.detail, message.payload.code);
      } else {
        throw new HandoffError("unexpected_message", message.type);
      }
      if (!verifyReceipt(receipt, bundle.manifest, script.mac)) throw new HandoffError("receipt_invalid");
      delivered.push(bundle.manifest.bundleID);
    }
    const syncMessages: string[] = [];
    const accountInfo: AccountInfoUpdate[] = [];
    const leaseGrants: BackgroundLeaseGrant[] = [];
    if (version >= 2) {
      await channel.send({ message: { type: "sync_request", payload: { meetings: [...(script.listed ?? [])] } }, body: new Uint8Array() });
      for (;;) {
        const { message, body } = await channel.receive(timeout);
        syncMessages.push(message.type);
        if (message.type === "sync_done") break;
        if (message.type === "sync_update" && script.answerUpdate !== undefined) {
          const update = message.payload;
          const parts = [body];
          for (let index = 1; index < update.parts.length; index += 1) {
            parts.push((await expectMessage(channel, timeout, "sync_part", (header) => header.bundleID === update.updateID && header.index === index)).body);
            syncMessages.push("sync_part");
          }
          await channel.send({ message: await script.answerUpdate(update, parts), body: new Uint8Array() });
        } else if (message.type === "account_info") accountInfo.push(message.payload);
        else if (message.type === "background_lease") leaseGrants.push(message.payload);
        else if (message.type === "failure") throw new HandoffError("peer_failed", message.payload.detail, message.payload.code);
        else throw new HandoffError("unexpected_message", message.type);
      }
    }
    await channel.send({ message: { type: "done" }, body: new Uint8Array() });
    return { method, delivered, sentParts, version, syncMessages, accountInfo, leaseGrants };
  } catch (error) {
    if (!(error instanceof HandoffError && error.code === "peer_failed")) {
      await channel.send({ message: { type: "failure", payload: { code: "internal", detail: "Phone stopped the transfer" } }, body: new Uint8Array() }).catch(() => undefined);
    }
    throw error;
  } finally {
    channel.close();
  }
}

async function attest(channel: FrameChannel, script: PhoneScript, sessionID: string, methods: readonly AttestationMethod[], nonceBytes: number): Promise<AttestationMethod> {
  const sendAttestation = async (nonce: Uint8Array, method: AttestationMethod): Promise<AttestationMethod> => {
    script.beforeAttest?.();
    const signature = script.identity.sign(attestationSignedBytes(sessionID, nonce, channel.channelBinding, method));
    await channel.send({ message: { type: "attest", payload: { sessionID, method, nonce, signature } }, body: new Uint8Array() });
    return (await expectMessage(channel, 5_000, "attested")).payload.method;
  };
  if (methods.includes("acoustic")) {
    for (let attempt = 0; attempt < (script.acousticAttempts ?? 2); attempt += 1) {
      const heard = script.air.listen();
      await channel.send({ message: { type: "listening", payload: { sessionID } }, body: new Uint8Array() });
      const samples = await heard;
      const nonce = samples === undefined ? undefined : decodeAlignedBurst(samples, nonceBytes);
      if (nonce !== undefined) return sendAttestation(nonce, "acoustic");
    }
  }
  const preferred = script.fallback ?? "qr";
  const method = methods.includes(preferred) ? preferred : (methods.find((entry) => entry !== "acoustic") ?? "mac_approval");
  await channel.send({ message: { type: "fallback", payload: { method, reason: "tone not detected" } }, body: new Uint8Array() });
  if (method === "qr") {
    await expectMessage(channel, 5_000, "qr_shown", (ref) => ref.sessionID === sessionID);
    const url = new URL(script.presenter.qr ?? "");
    if (url.searchParams.get("s") !== sessionID) throw new HandoffError("attestation_failed", "QR code is for another session");
    return sendAttestation(fromBase64Url(url.searchParams.get("n") ?? "") as Uint8Array, "qr");
  }
  if (method === "mac_approval") return (await expectMessage(channel, 10_000, "attested")).payload.method;
  throw new HandoffError("attestation_failed", "no fallback available");
}

/** A TypeScript stand-in for the Swift `PhonePairingSession`. */
export async function runScriptedPhonePairing(channel: FrameChannel, identity: SoftwareIdentity, invitation: PairingInvitation, accept: boolean): Promise<{ mac: DevicePublicKeys; code: string }> {
  const code = shortCode(invitation, identity.publicKeys);
  try {
    await channel.send({ message: { type: "pair_request", payload: { phone: identity.publicKeys, proof: phoneProof(invitation, identity.publicKeys) } }, body: new Uint8Array() });
    await channel.send({ message: { type: "pair_decision", payload: { accepted: accept } }, body: new Uint8Array() });
    if (!accept) throw new HandoffError("pairing_rejected", "declined on phone");
    const { payload: mac } = await expectMessage(channel, 5_000, "pair_complete");
    if (mac.deviceID !== invitation.mac.deviceID) throw new HandoffError("pairing_rejected", "Mac keys changed during pairing");
    return { mac, code };
  } finally {
    channel.close();
  }
}
