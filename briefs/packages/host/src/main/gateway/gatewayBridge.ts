import type { GatewayStatus as CoreStatus, HandoffEvent, HandoffGateway, PairingState as CorePairing, ToneBridge } from "@lana/core/gateway";
import { parseLanaId } from "@lana/core/ids";
import type {
  DevicesApi, GatewayStatus, HandoffApi, HandoffView, LanaEvent, PairedDevice, PairingState, Result, ToneApi,
} from "../../shared/api.js";
import type { MainLog } from "../log.js";

/** How long a finished or failed handoff stays on screen before the prompt closes itself. */
const OUTCOME_VISIBLE_MS = 6_000;

const HANDOFF_FAILED = "The meeting did not arrive. The phone keeps it and tries again.";
const HANDOFF_DECLINED = "The phone was not approved, so the meeting stayed on it.";

export function toApiPairing(state: CorePairing): PairingState {
  switch (state.state) {
    case "idle":
      return { kind: "idle" };
    case "waiting":
      return { kind: "showingCode", qrText: state.qrText, serviceName: state.serviceName, expiresAt: new Date(state.expiresAtMs).toISOString() };
    case "confirming":
      return { kind: "confirming", code: state.code, phoneName: state.phoneName };
    case "saving":
      return { kind: "saving" };
    case "paired":
      return { kind: "paired", phoneName: state.phoneName };
    case "expired":
      return { kind: "expired" };
    case "failed":
      return { kind: "failed", message: state.message };
  }
}

export function toApiGatewayStatus(status: CoreStatus, signedIn: boolean): GatewayStatus {
  if (!signedIn) return { listener: { kind: "signedOut" }, receiving: false };
  switch (status.state) {
    case "stopped":
      return { listener: { kind: "stopped" }, receiving: false };
    case "starting":
      return { listener: { kind: "starting" }, receiving: false };
    case "failed":
      return { listener: { kind: "failed", message: status.message }, receiving: false };
    case "listening":
      return { listener: status.pairedDevices === 0 ? { kind: "waitingForPairing" } : { kind: "listening" }, receiving: status.activeTransfers > 0 };
  }
}

/**
 * Devices, pairing, handoff prompts and the tone bridge over the real `HandoffGateway`,
 * plus the sign-in gate: the gateway listens only while someone is signed in to the LANA
 * client, and signing out stops it at once.
 */
export class GatewayBridge implements DevicesApi {
  private view: HandoffView = { kind: "idle" };
  private outcomeTimer: NodeJS.Timeout | null = null;
  private gate: Promise<void> = Promise.resolve();
  readonly handoff: HandoffApi;
  readonly tone: ToneApi;

  constructor(
    private readonly gateway: HandoffGateway,
    /** The client's session (the only one): the gateway listens only while it is signed in. */
    private readonly session: { readonly isSignedIn: boolean; addObserver(observer: (signedIn: boolean) => void): () => void },
    private readonly toneBridge: ToneBridge,
    private readonly emit: (event: LanaEvent) => void,
    private readonly log: MainLog,
  ) {
    gateway.on("gatewayStatus", () => this.emitStatus());
    gateway.on("pairing", (state) => this.emit({ type: "pairing", state: toApiPairing(state) }));
    gateway.on("handoff", (event) => this.onHandoff(event));
    gateway.on("meetingReceived", (meeting) => {
      this.log.info("gateway.meeting_received", {
        handoff: meeting.handoffId, bundle: meeting.bundleId, meeting: meeting.meetingId, phone: meeting.phoneDeviceId,
        updated: meeting.updated, intents: meeting.intents, quarantined: meeting.quarantinedIntents, audio_parts: meeting.audioParts, method: meeting.method,
        tone_plays: meeting.tonePlays, latency_ms: meeting.latencyMs,
      });
      // A later bundle for a meeting already here merged into it: refresh, no "received" sheet.
      this.emit(meeting.updated ? { type: "meetingChanged", meetingID: meeting.meetingId } : { type: "meetingReceived", meetingID: meeting.meetingId });
    });
    // Declined, "Not now" or delivered on the phone: the meeting's Send to phone state changed.
    gateway.on("recordsChanged", (change) => {
      this.log.info("gateway.records_changed", { phone: change.phoneDeviceId, reason: change.reason, meetings: change.meetingIds.length });
      for (const meetingID of change.meetingIds) this.emit({ type: "recordsChanged", meetingID });
    });
    session.addObserver((signedIn) => void this.applyGate(signedIn));

    this.handoff = {
      state: async () => this.view,
      answerApproval: async (handoffId: string, approved: boolean) => {
        if (this.view.kind === "approval" && this.view.handoffId === handoffId) {
          this.gateway.answerApproval(handoffId, approved === true);
          this.setView({ kind: "receiving", handoffId });
        }
        return this.view;
      },
      dismiss: async () => {
        if (this.view.kind === "received" || this.view.kind === "failed") this.setView({ kind: "idle" });
        return this.view;
      },
    };
    this.tone = {
      played: async (id: string) => this.toneBridge.played(String(id)),
      failed: async (id: string) => {
        this.log.notice("tone.renderer_failed");
        this.toneBridge.failed(String(id));
      },
    };
  }

  /**
   * Starts or stops the listener to match the session (the client runs Briefs only while the
   * firm has it). Calls run one after another.
   */
  applyGate(open: boolean): Promise<void> {
    this.gate = this.gate.then(async () => {
      if (open && this.session.isSignedIn) {
        const status = await this.gateway.start();
        this.log.info("gateway.gate_open", { state: status.state });
      } else if (!this.session.isSignedIn) {
        this.toneBridge.cancelAll();
        await this.gateway.stop();
        this.setView({ kind: "idle" });
        this.log.info("gateway.gate_closed");
      }
      this.emitStatus();
    }).catch((error: unknown) => {
      this.log.error("gateway.gate_failed", { error: error instanceof Error ? error.name : "unknown" });
    });
    return this.gate;
  }

  // DevicesApi

  async list(): Promise<Result<PairedDevice[]>> {
    try {
      const devices = await this.gateway.store.pairedDevices();
      return {
        ok: true,
        value: devices.map((device) => ({ id: device.keys.deviceID, displayName: device.keys.displayName, pairedAt: device.pairedAt.toISOString() })),
      };
    } catch {
      this.log.error("devices.list_failed");
      return { ok: false, error: { code: "store", message: "LANA could not read the paired phones." } };
    }
  }

  async revoke(id: string): Promise<Result<null>> {
    const deviceID = parseLanaId(String(id), "device");
    if (deviceID === null) return { ok: false, error: { code: "notFound", message: "That phone is no longer paired." } };
    try {
      await this.gateway.revokeDevice(deviceID);
      this.log.info("devices.revoked", { device: deviceID });
      return { ok: true, value: null };
    } catch {
      return { ok: false, error: { code: "notFound", message: "That phone is no longer paired." } };
    }
  }

  async pairingState(): Promise<PairingState> {
    return toApiPairing(this.gateway.pairing);
  }

  async startPairing(): Promise<PairingState> {
    if (!this.session.isSignedIn) return { kind: "failed", message: "Sign in to LANA before pairing a phone." };
    this.log.info("pairing.start");
    return toApiPairing(this.gateway.beginPairing());
  }

  async cancelPairing(): Promise<PairingState> {
    this.gateway.cancelPairing();
    return toApiPairing(this.gateway.pairing);
  }

  async answerPairing(matches: boolean): Promise<PairingState> {
    this.gateway.answerPairingCode(matches === true);
    return toApiPairing(this.gateway.pairing);
  }

  async resetPairing(): Promise<PairingState> {
    this.gateway.cancelPairing();
    return toApiPairing(this.gateway.pairing);
  }

  async gatewayStatus(): Promise<GatewayStatus> {
    return toApiGatewayStatus(this.gateway.status, this.session.isSignedIn);
  }

  // Private

  private emitStatus(): void {
    this.emit({ type: "gateway", status: toApiGatewayStatus(this.gateway.status, this.session.isSignedIn) });
  }

  private onHandoff(event: HandoffEvent): void {
    this.log.info("gateway.handoff_event", {
      handoff: event.handoffId,
      type: event.type,
      ...(event.type === "tone" ? { play: event.play } : {}),
      ...(event.type === "finished" ? { bundles: event.bundles } : {}),
      ...(event.type === "failed" ? { code: event.code } : {}),
    });
    switch (event.type) {
      case "started":
      case "dismissed":
        return this.setView({ kind: "receiving", handoffId: event.handoffId });
      case "tone":
        return this.setView({ kind: "tone", handoffId: event.handoffId, play: event.play });
      case "qr":
        return this.setView({ kind: "qr", handoffId: event.handoffId, qrText: event.qrText });
      case "approval_requested":
        return this.setView({ kind: "approval", handoffId: event.handoffId, phoneName: event.phoneName });
      case "finished":
        if (event.bundles === 0) return this.setView({ kind: "idle" });
        return this.setOutcome({ kind: "received", handoffId: event.handoffId, bundles: event.bundles });
      case "failed":
        return this.setOutcome({ kind: "failed", handoffId: event.handoffId, message: event.code === "attestation_failed" ? HANDOFF_DECLINED : HANDOFF_FAILED });
    }
  }

  private setOutcome(view: HandoffView): void {
    this.setView(view);
    this.outcomeTimer = setTimeout(() => {
      if (this.view === view) this.setView({ kind: "idle" });
    }, OUTCOME_VISIBLE_MS);
  }

  private setView(view: HandoffView): void {
    if (this.outcomeTimer !== null) {
      clearTimeout(this.outcomeTimer);
      this.outcomeTimer = null;
    }
    this.view = view;
    this.emit({ type: "handoff", view });
  }
}
