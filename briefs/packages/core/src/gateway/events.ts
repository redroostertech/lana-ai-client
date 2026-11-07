import type { AttestationMethod } from "../handoff/messages.js";

// Events the gateway emits for the app shell. Everything here is plain data (strings,
// numbers, booleans), so the Electron main process can forward it over IPC unchanged.
// Phone names and the pairing code appear only where the person has to see them; the
// gateway never logs them.

/** The listener, as the menu bar and Settings see it (Swift `ListenerStatus`). */
export type GatewayStatus =
  | { readonly state: "stopped" }
  | { readonly state: "starting" }
  | {
      readonly state: "listening";
      readonly port: number;
      /** Bonjour name of the handoff service, `Lana-` plus six characters of the Mac id. */
      readonly serviceName: string;
      /** Active pairings. Zero means "waiting for a paired phone". */
      readonly pairedDevices: number;
      /** Handoff connections in progress. */
      readonly activeTransfers: number;
    }
  | { readonly state: "failed"; readonly reason: "listener_unavailable"; readonly message: string };

export type PairingFailureReason = "not_running" | "listener_unavailable" | "declined_on_mac" | "phone_cancelled" | "connection_failed";

/** The pairing panel (Swift `PairingViewModel.ViewState`). */
export type PairingState =
  | { readonly state: "idle" }
  | {
      /** The QR code is up and the pairing service is advertised. */
      readonly state: "waiting";
      /** Text to render as the QR code (`lananotes://pair?d=...`). */
      readonly qrText: string;
      readonly serviceName: string;
      /** Epoch milliseconds; the UI shows the countdown. */
      readonly expiresAtMs: number;
    }
  | {
      /** "Does your phone show this code?" Answer with `answerPairingCode`. */
      readonly state: "confirming";
      readonly code: string;
      readonly phoneDeviceId: string;
      readonly phoneName: string;
    }
  | { readonly state: "saving"; readonly phoneDeviceId: string }
  | { readonly state: "paired"; readonly phoneDeviceId: string; readonly phoneName: string }
  | { readonly state: "expired" }
  | { readonly state: "failed"; readonly reason: PairingFailureReason; readonly message: string };

/** One handoff connection, step by step. `handoffId` is local to this run of the gateway. */
export type HandoffEvent =
  | { readonly type: "started"; readonly handoffId: string; readonly phoneDeviceId: string | null }
  | { readonly type: "tone"; readonly handoffId: string; readonly play: number }
  | {
      /** QR fallback: show `qrText` as a QR code until `dismissed`. */
      readonly type: "qr";
      readonly handoffId: string;
      readonly qrText: string;
    }
  | {
      /** The person at the Mac approves this phone. Answer with `answerApproval`. */
      readonly type: "approval_requested";
      readonly handoffId: string;
      readonly phoneDeviceId: string;
      readonly phoneName: string;
    }
  | { readonly type: "dismissed"; readonly handoffId: string }
  | { readonly type: "finished"; readonly handoffId: string; readonly bundles: number }
  | { readonly type: "failed"; readonly handoffId: string; readonly code: string };

/** A meeting stored and receipted. Ids and counts only. */
export interface MeetingReceived {
  readonly handoffId: string;
  /** True when the bundle updated a meeting already here (shared record) instead of adding one. */
  readonly updated: boolean;
  readonly bundleId: string;
  readonly meetingId: string;
  readonly phoneDeviceId: string;
  readonly intents: number;
  readonly quarantinedIntents: number;
  readonly audioParts: number;
  readonly method: AttestationMethod;
  readonly tonePlays: number;
  readonly latencyMs: number;
}

/**
 * A phone changed what is queued for it: it declined a meeting sent to it, said "Not now"
 * (snoozed), or took one. The window refreshes those meetings' Send to phone state. Ids only.
 */
export interface RecordsChanged {
  readonly phoneDeviceId: string;
  readonly meetingIds: readonly string[];
  readonly reason: "declined" | "snoozed" | "delivered";
}

export interface GatewayEventMap {
  gatewayStatus: GatewayStatus;
  pairing: PairingState;
  handoff: HandoffEvent;
  meetingReceived: MeetingReceived;
  recordsChanged: RecordsChanged;
  /** The phones with something queued changed (or the gateway stopped): re-read `bleWakeUuids`. Counts only. */
  wakeChanged: { readonly flaggedPhones: number };
}

export type GatewayEventName = keyof GatewayEventMap;

/** A small typed emitter. A throwing listener never breaks the gateway or other listeners. */
export class GatewayEmitter<Events extends object = GatewayEventMap> {
  private readonly listeners = new Map<keyof Events, Set<(value: never) => void>>();

  /** Subscribes; returns the unsubscribe function. */
  on<K extends keyof Events>(name: K, listener: (value: Events[K]) => void): () => void {
    const set = this.listeners.get(name) ?? new Set();
    set.add(listener as (value: never) => void);
    this.listeners.set(name, set);
    return () => {
      set.delete(listener as (value: never) => void);
    };
  }

  emit<K extends keyof Events>(name: K, value: Events[K]): void {
    for (const listener of [...(this.listeners.get(name) ?? [])]) {
      try {
        (listener as (value: Events[K]) => void)(value);
      } catch {
        // Listeners are UI forwarding; their failures are theirs.
      }
    }
  }
}
