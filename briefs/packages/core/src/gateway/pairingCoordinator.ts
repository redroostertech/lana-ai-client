import type { DeviceIdentity } from "../crypto/deviceIdentity.js";
import type { DevicePublicKeys } from "../crypto/devicePublicKeys.js";
import { invitationQrString, makePairingInvitation, pairingPsk, type PairingInvitation } from "../crypto/pairingInvitation.js";
import { pairingServiceName } from "../handoff/discovery.js";
import { HandoffError } from "../handoff/errors.js";
import type { FrameChannel } from "../handoff/frameChannel.js";
import type { HandoffLog } from "../handoff/log.js";
import { MacPairingSession } from "../handoff/macPairingSession.js";
import type { Clock, PairingPresenter } from "../handoff/ports.js";
import type { PairingSink } from "../store/interfaces.js";
import type { PairingFailureReason, PairingState } from "./events.js";

/** Swift `PairingInvitation.make`: five minutes. */
export const PAIRING_LIFETIME_MS = 300_000;

/** UI copy, as `PairingViewModel`. */
export const PAIRING_MESSAGES: Readonly<Record<PairingFailureReason, string>> = Object.freeze({
  not_running: "LANA is not listening on this computer. Start the gateway, then pair again.",
  listener_unavailable: "LANA could not open a pairing connection on this computer. Check the network and try again.",
  declined_on_mac: "Pairing cancelled on this computer.",
  phone_cancelled: "The phone cancelled or the connection dropped. Start pairing again.",
  connection_failed: "The pairing connection failed. Start again.",
});

/** Cancelled phone during code confirmation has its own copy in Swift. */
const PHONE_CANCELLED_WHILE_CONFIRMING = "The phone cancelled pairing. Start again.";

export interface PairingCoordinatorDependencies {
  readonly identity: DeviceIdentity;
  readonly sink: PairingSink;
  readonly clock: Clock;
  readonly log: HandoffLog;
  /** Advertises the pairing service on the gateway's listener; returns the withdraw function. */
  readonly advertise: (serviceName: string) => () => Promise<void>;
  readonly onState: (state: PairingState) => void;
  /** After a pairing is stored: refresh the listener status and the handoff advertisement. */
  readonly onPaired: (phoneDeviceId: string) => Promise<void>;
  readonly lifetimeMs?: number | undefined;
}

interface Flow {
  readonly invitation: PairingInvitation;
  readonly psk: Uint8Array;
  readonly session: MacPairingSession;
  readonly withdraw: () => Promise<void>;
  /** The phone connected; the invitation is burned. */
  connected: boolean;
  expiry: NodeJS.Timeout | undefined;
  confirmation: ((matches: boolean) => void) | undefined;
}

/**
 * First-time pairing on the gateway's single listener (Swift `PairingViewModel`): a QR
 * invitation valid for five minutes and one connection, the pairing service advertised
 * while it is open, and the six-digit code the person confirms.
 */
export class PairingCoordinator implements PairingPresenter {
  private flow: Flow | undefined;
  private current: PairingState = { state: "idle" };

  constructor(private readonly deps: PairingCoordinatorDependencies) {}

  get state(): PairingState {
    return this.current;
  }

  /** Shows a new invitation, replacing any open one. */
  begin(): PairingState {
    this.end();
    const { identity, clock } = this.deps;
    const invitation = makePairingInvitation(identity.publicKeys, pairingServiceName(), clock.now(), this.deps.lifetimeMs ?? PAIRING_LIFETIME_MS);
    let withdraw: () => Promise<void>;
    try {
      withdraw = this.deps.advertise(invitation.serviceName);
    } catch {
      this.deps.log.error("gateway.pairing.advertise_failed");
      return this.fail("listener_unavailable");
    }
    const flow: Flow = {
      invitation,
      psk: pairingPsk(invitation),
      session: new MacPairingSession({ identity, invitation, presenter: this, sink: this.deps.sink, clock, log: this.deps.log }),
      withdraw,
      connected: false,
      expiry: undefined,
      confirmation: undefined,
    };
    this.flow = flow;
    const remaining = Math.max(0, invitation.expiresAt.getTime() - clock.now().getTime());
    flow.expiry = setTimeout(() => this.expire(flow), remaining);
    flow.expiry.unref?.();
    this.deps.log.info("gateway.pairing.begun", { expiresInMs: remaining });
    return this.set({ state: "waiting", qrText: invitationQrString(invitation), serviceName: invitation.serviceName, expiresAtMs: invitation.expiresAt.getTime() });
  }

  /** The pairing PSK while the invitation is shown, unused and unexpired; otherwise the handshake is refused. */
  pskFor(): Uint8Array | undefined {
    const flow = this.flow;
    if (flow === undefined || flow.connected || this.current.state !== "waiting") return undefined;
    if (this.deps.clock.now().getTime() > flow.invitation.expiresAt.getTime()) return undefined;
    return flow.psk;
  }

  /** Runs the pairing session on a connection that presented the pairing PSK. */
  async handle(channel: FrameChannel): Promise<void> {
    const flow = this.flow;
    if (flow === undefined || flow.connected || this.current.state !== "waiting") {
      channel.close();
      return;
    }
    flow.connected = true;
    try {
      const phone = await flow.session.run(channel);
      if (flow !== this.flow) return;
      this.set({ state: "paired", phoneDeviceId: phone.deviceID, phoneName: phone.displayName });
      this.deps.log.info("gateway.pairing.paired", { phone: phone.deviceID });
      this.end();
      await this.deps.onPaired(phone.deviceID);
    } catch (error) {
      this.deps.log.notice("gateway.pairing.ended", { code: error instanceof HandoffError ? error.code : "internal" });
      if (flow !== this.flow) return;
      // The state moved on while the session ran (confirming, saving).
      switch (this.current.state as PairingState["state"]) {
        case "saving":
          this.fail("phone_cancelled");
          break;
        case "confirming":
          this.set({ state: "failed", reason: "phone_cancelled", message: PHONE_CANCELLED_WHILE_CONFIRMING });
          break;
        case "waiting":
          this.fail("connection_failed");
          break;
        default:
          break;
      }
      this.end();
    }
  }

  /** `PairingPresenter`: shows the code and waits for `answer`. */
  confirmCode(code: string, phone: DevicePublicKeys, signal: AbortSignal): Promise<boolean> {
    const flow = this.flow;
    if (flow === undefined) return Promise.resolve(false);
    clearTimeout(flow.expiry);
    flow.expiry = undefined;
    const answer = new Promise<boolean>((resolve) => {
      flow.confirmation = resolve;
      signal.addEventListener("abort", () => {
        if (flow.confirmation === resolve) flow.confirmation = undefined;
        resolve(false);
      });
    });
    // After the answer is wired, so a listener may answer synchronously.
    this.set({ state: "confirming", code, phoneDeviceId: phone.deviceID, phoneName: phone.displayName });
    return answer;
  }

  /** The person's answer to "Does your phone show this code?". Ignored unless confirming. */
  answer(matches: boolean): void {
    const flow = this.flow;
    if (flow === undefined || this.current.state !== "confirming") return;
    const phoneDeviceId = this.current.phoneDeviceId;
    if (matches) this.set({ state: "saving", phoneDeviceId });
    else this.fail("declined_on_mac");
    const pending = flow.confirmation;
    flow.confirmation = undefined;
    pending?.(matches);
  }

  /** Closes the invitation in any state and returns to idle. */
  cancel(): void {
    this.end();
    if (this.current.state !== "idle") this.set({ state: "idle" });
  }

  private expire(flow: Flow): void {
    if (flow !== this.flow || this.current.state !== "waiting") return;
    this.deps.log.info("gateway.pairing.expired");
    this.set({ state: "expired" });
    this.end();
  }

  /** Forgets the flow, declines a pending code and withdraws the advertisement. The state is left for the UI. */
  private end(): void {
    const flow = this.flow;
    if (flow === undefined) return;
    this.flow = undefined;
    clearTimeout(flow.expiry);
    const pending = flow.confirmation;
    flow.confirmation = undefined;
    pending?.(false);
    void flow.withdraw().catch(() => undefined);
  }

  private fail(reason: PairingFailureReason): PairingState {
    return this.set({ state: "failed", reason, message: PAIRING_MESSAGES[reason] });
  }

  private set(state: PairingState): PairingState {
    this.current = state;
    this.deps.onState(state);
    return state;
  }
}
