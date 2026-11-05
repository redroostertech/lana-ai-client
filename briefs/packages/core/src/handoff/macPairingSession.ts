import type { DeviceIdentity } from "../crypto/deviceIdentity.js";
import type { DevicePublicKeys } from "../crypto/devicePublicKeys.js";
import { p256PublicKeyFromX963 } from "../crypto/p256.js";
import type { PairingInvitation } from "../crypto/pairingInvitation.js";
import { shortCode, transportPsk, verifyPhoneProof } from "../crypto/pairingMath.js";
import { lanaIdKind } from "../ids/lanaId.js";
import { HandoffError } from "./errors.js";
import { expectMessage, type FrameChannel } from "./frameChannel.js";
import { SILENT_LOG, type HandoffLog } from "./log.js";
import { SYSTEM_CLOCK, type Clock, type PairingPresenter } from "./ports.js";
import type { PairingSink } from "../store/interfaces.js";

/** Swift waits 120 s for the phone's request and 180 s for its decision. */
export const PAIRING_REQUEST_TIMEOUT_MS = 120_000;
export const PAIRING_DECISION_TIMEOUT_MS = 180_000;

export interface MacPairingDependencies {
  readonly identity: DeviceIdentity;
  readonly invitation: PairingInvitation;
  readonly presenter: PairingPresenter;
  readonly sink: PairingSink;
  readonly clock?: Clock;
  readonly log?: HandoffLog;
  readonly requestTimeoutMs?: number;
  readonly decisionTimeoutMs?: number;
}

/**
 * Mac side of first-time pairing (Swift `MacPairingSession`). One instance per
 * invitation; the invitation is burned on the first attempt, successful or not.
 */
export class MacPairingSession {
  private used = false;
  private readonly clock: Clock;
  private readonly log: HandoffLog;

  constructor(private readonly deps: MacPairingDependencies) {
    this.clock = deps.clock ?? SYSTEM_CLOCK;
    this.log = deps.log ?? SILENT_LOG;
  }

  get invitation(): PairingInvitation {
    return this.deps.invitation;
  }

  /** Resolves to the newly paired phone's keys, already stored (and audited by the store) with its transport key. Always closes the channel. */
  async run(channel: FrameChannel): Promise<DevicePublicKeys> {
    if (this.used) {
      channel.close();
      throw new HandoffError("pairing_rejected", "invitation already used");
    }
    this.used = true;
    const abort = new AbortController();
    try {
      return await this.pair(channel, abort.signal);
    } catch (error) {
      abort.abort();
      if (error instanceof HandoffError) {
        await channel.send({ message: { type: "failure", payload: { code: "pairing_rejected", detail: "Pairing cancelled" } }, body: new Uint8Array() }).catch(() => undefined);
      }
      const code = error instanceof HandoffError ? error.code : "internal";
      this.log.notice("pairing.mac.ended", { code });
      throw error;
    } finally {
      channel.close();
    }
  }

  private async pair(channel: FrameChannel, signal: AbortSignal): Promise<DevicePublicKeys> {
    const { identity, invitation } = this.deps;
    if (this.clock.now().getTime() > invitation.expiresAt.getTime()) throw new HandoffError("pairing_rejected", "invitation expired");
    const { payload: request } = await expectMessage(channel, this.deps.requestTimeoutMs ?? PAIRING_REQUEST_TIMEOUT_MS, "pair_request");
    const phone = request.phone;
    if (!verifyPhoneProof(request.proof, invitation, phone) || lanaIdKind(phone.deviceID) !== "device" || !validKey(phone.signingKey) || !validKey(phone.agreementKey)) {
      throw new HandoffError("pairing_rejected", "bad proof");
    }
    const code = shortCode(invitation, phone);

    // The person at the Mac and the phone answer concurrently, as Swift's `async let`.
    const macAnswer = this.deps.presenter.confirmCode(code, phone, signal).catch(() => false);
    const { payload: decision } = await expectMessage(channel, this.deps.decisionTimeoutMs ?? PAIRING_DECISION_TIMEOUT_MS, "pair_decision");
    if (!(await macAnswer)) throw new HandoffError("pairing_rejected", "declined on Mac");
    if (!decision.accepted) throw new HandoffError("pairing_rejected", "declined on phone");

    const psk = transportPsk(identity, phone, identity.publicKeys.deviceID, phone.deviceID);
    await this.deps.sink.pairDevice(phone, psk);
    await channel.send({ message: { type: "pair_complete", payload: identity.publicKeys }, body: new Uint8Array() });
    this.log.info("pairing.mac.paired", { phone: phone.deviceID });
    return phone;
  }
}

function validKey(x963: Uint8Array): boolean {
  try {
    p256PublicKeyFromX963(x963);
    return true;
  } catch {
    return false;
  }
}
