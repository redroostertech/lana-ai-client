import { existsSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { invitationQrString, makePairingInvitation, pairingPsk, sha256Hex, SoftwareIdentity, type DevicePublicKeys } from "../../src/crypto/index.js";
import {
  BonjourAdvertiser, gatewayServiceName, HANDOFF_TLS, HandoffError, HandoffListener, MacHandoffSession, MacPairingSession, pairingServiceName,
  type Advertisement, type ChallengePresenter, type HandoffLog, type OpenedBundle, type PairingPresenter, type Receipt, type ToneOutput,
} from "../../src/handoff/index.js";
import type { AttestationRecord, BundleSink, PairingSink, TransportPsk, TrustStore } from "../../src/store/index.js";
import type { LanaId } from "../../src/ids/index.js";
import { toneSamplesLittleEndian } from "../../src/tone/index.js";

/**
 * The TypeScript Mac for the Swift cross-implementation test
 * (`CrossImplementationSessionTests`). Everything is real (TLS-PSK on localhost, the Mac
 * pairing and handoff sessions, HPKE bundle opening, receipt signing) except the people
 * and the speaker, which are files in `dir`:
 *
 * - `peer.json`: ports, service names and the pairing QR text, written when ready.
 * - `pair-code.txt`: the six-digit code the Mac showed (auto-confirmed in test mode).
 * - `tone-N.f32`: each tone burst "played", little-endian Float32 at 48 kHz.
 * - `qr-N.txt`: each attestation QR code "shown".
 * - `received.json`: what the Mac opened (ids, counts, hashes; no content).
 * - `sessions.json`: how each handoff connection ended.
 * - `stop`: create it to stop the peer.
 */
export interface TsMacPeer {
  readonly finished: Promise<void>;
  stop(): Promise<void>;
}

export async function startTsMacPeer(options: { dir: string; bonjour: boolean; log: HandoffLog }): Promise<TsMacPeer> {
  const { dir, log } = options;
  const mac = SoftwareIdentity.generate("TS Mac");
  const trust = new PeerTrust();
  const invitation = makePairingInvitation(mac.publicKeys, pairingServiceName(), new Date());
  const files = new PeerFiles(dir);

  const pairingSession = new MacPairingSession({ identity: mac, invitation, presenter: files, sink: trust, log });
  const pairingListener = new HandoffListener({ psks: (identity) => (identity === HANDOFF_TLS.pairingIdentity ? pairingPsk(invitation) : undefined), log });
  const pairingPort = await pairingListener.start(async (channel) => {
    const phone = await pairingSession.run(channel);
    files.write("paired.json", { phone_device_id: phone.deviceID });
  });

  const sink = new PeerSink(files);
  const handoffListener = new HandoffListener({ psks: (identity) => trust.psks.get(identity), log });
  const handoffPort = await handoffListener.start(async (channel) => {
    const session = new MacHandoffSession({ identity: mac, trust, tone: files, presenter: files, sink, log });
    try {
      const received = await session.run(channel);
      files.appendSession({ result: "ok", bundles: received });
    } catch (error) {
      files.appendSession({ result: "failed", code: error instanceof HandoffError ? error.code : "internal" });
      throw error;
    }
  });

  const advertisements: Advertisement[] = [];
  const advertiser = new BonjourAdvertiser(undefined, log);
  if (options.bonjour) {
    advertisements.push(advertiser.advertise(invitation.serviceName, pairingPort), advertiser.advertise(gatewayServiceName(mac.publicKeys.deviceID), handoffPort));
  }

  files.write("peer.json", {
    mac_device_id: mac.publicKeys.deviceID,
    pairing_port: pairingPort,
    handoff_port: handoffPort,
    pairing_service: invitation.serviceName,
    gateway_service: gatewayServiceName(mac.publicKeys.deviceID),
    invitation_qr: invitationQrString(invitation),
    bonjour: options.bonjour,
  });
  log.info("peer.ready", { pairingPort, handoffPort, bonjour: options.bonjour });

  let resolveFinished: () => void = () => undefined;
  const finished = new Promise<void>((resolve) => (resolveFinished = resolve));
  const watcher = setInterval(() => {
    if (existsSync(join(dir, "stop"))) void stop();
  }, 100);
  let stopped = false;
  async function stop(): Promise<void> {
    if (stopped) return;
    stopped = true;
    clearInterval(watcher);
    await Promise.all(advertisements.map((advertisement) => advertisement.stop()));
    await advertiser.stop();
    await Promise.race([Promise.all([pairingListener.stop(), handoffListener.stop()]), new Promise((resolve) => setTimeout(resolve, 2_000))]);
    resolveFinished();
  }
  return { finished, stop };
}

class PeerTrust implements TrustStore, PairingSink {
  readonly phones = new Map<string, DevicePublicKeys>();
  readonly psks = new Map<string, Uint8Array>();
  async pinnedPhone(deviceID: string): Promise<DevicePublicKeys | null> {
    return this.phones.get(deviceID) ?? null;
  }
  async transportPsks(): Promise<TransportPsk[]> {
    return [...this.psks].map(([identity, key]) => ({ identity, key }));
  }
  async pairDevice(phone: DevicePublicKeys, transportPsk: Uint8Array): Promise<void> {
    this.phones.set(phone.deviceID, phone);
    this.psks.set(phone.deviceID, transportPsk);
  }
}

class PeerFiles implements ToneOutput, ChallengePresenter, PairingPresenter {
  private tones = 0;
  private qrs = 0;
  private readonly sessions: unknown[] = [];

  constructor(private readonly dir: string) {}

  write(name: string, value: unknown): void {
    this.writeBytes(name, Buffer.from(`${JSON.stringify(value, null, 2)}\n`));
  }

  /** Write then rename, so the Swift side never reads a half-written file. */
  writeBytes(name: string, data: Uint8Array): void {
    const temporary = join(this.dir, `.${name}.tmp`);
    writeFileSync(temporary, data);
    renameSync(temporary, join(this.dir, name));
  }

  appendSession(entry: unknown): void {
    this.sessions.push(entry);
    this.write("sessions.json", this.sessions);
  }

  async play(samples: Float32Array): Promise<void> {
    this.tones += 1;
    this.writeBytes(`tone-${this.tones}.f32`, toneSamplesLittleEndian(samples));
  }

  async showQr(text: string): Promise<void> {
    this.qrs += 1;
    this.writeBytes(`qr-${this.qrs}.txt`, Buffer.from(text));
  }

  async requestApproval(): Promise<boolean> {
    return true;
  }

  async dismiss(): Promise<void> {}

  /** Test mode: the person at the Mac confirms. The code is written so the phone side can compare. */
  async confirmCode(code: string): Promise<boolean> {
    this.writeBytes("pair-code.txt", Buffer.from(code));
    return true;
  }
}

class PeerSink implements BundleSink {
  private readonly receipts = new Map<LanaId, Receipt>();
  private readonly parts = new Map<LanaId, Map<number, Uint8Array>>();
  private readonly received: unknown[] = [];

  constructor(private readonly files: PeerFiles) {}

  async existingReceipt(bundleID: LanaId): Promise<Receipt | null> {
    return this.receipts.get(bundleID) ?? null;
  }

  async storedParts(bundleID: LanaId): Promise<Map<number, Uint8Array>> {
    return new Map(this.parts.get(bundleID));
  }

  async storePart(bundleID: LanaId, index: number, ciphertext: Uint8Array): Promise<void> {
    const parts = this.parts.get(bundleID) ?? new Map<number, Uint8Array>();
    parts.set(index, ciphertext);
    this.parts.set(bundleID, parts);
  }

  async complete(opened: OpenedBundle, receipt: Receipt, attestation: AttestationRecord): Promise<void> {
    this.receipts.set(opened.manifest.bundleID, receipt);
    this.received.push({
      bundle_id: opened.manifest.bundleID,
      meeting_id: opened.meeting.id,
      intents: opened.meeting.intents.length,
      rejected_intents: opened.rejectedIntents.length,
      audio_sha256: opened.audio.map((part) => sha256Hex(part.data)),
      method: attestation.method,
      tone_plays: attestation.tonePlays,
      latency_ms: attestation.latencyMs,
    });
    this.files.write("received.json", this.received);
  }
}
