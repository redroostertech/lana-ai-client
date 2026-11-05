import type { StatusText } from "../../../shared/api.js";
import type { MainLog } from "../../log.js";

/** The helper process as the advertiser sees it: JSON lines in and out. */
export interface BleHelperProcess {
  write(line: string): void;
  onLine(listener: (line: string) => void): void;
  onExit(listener: () => void): void;
  kill(): void;
}

/** Bluetooth as the helper reports it. */
export type BleWakeState = "unavailable" | "starting" | "powered_on" | "powered_off" | "unauthorized" | "unsupported" | "resetting" | "unknown";

export interface BleWakeAdvertiserOptions {
  /** The wake UUIDs to advertise now (one per phone with something queued, for this UTC day). */
  readonly uuids: (at: Date) => readonly string[];
  /** Subscribes to "the queued phones changed"; returns the unsubscribe function. */
  readonly onWakeChanged: (listener: () => void) => () => void;
  /** Starts the helper, or null when this platform or build has none. */
  readonly spawn: () => BleHelperProcess | null;
  readonly now?: () => Date;
  readonly onStatus?: () => void;
  readonly log: MainLog;
}

/**
 * BLE wake on the desktop (docs/ARCHITECTURE.md, "Background delivery"): advertises each paired
 * phone's daily wake UUID while something is queued for it, through the signed helper
 * (`native/macos/ble-wake-helper`). Nothing is advertised while nothing is queued; the helper
 * starts on the first wake and is told to quit on `stop` (app quit). Keys never reach the
 * helper: it receives only the derived UUIDs. A timer re-derives the UUIDs at UTC midnight.
 */
export class BleWakeAdvertiser {
  private helper: BleHelperProcess | null = null;
  private unsubscribe: (() => void) | null = null;
  private midnight: NodeJS.Timeout | null = null;
  private advertised: readonly string[] = [];
  private state: BleWakeState = "starting";
  private onAir = 0;
  private helperMissing = false;

  constructor(private readonly options: BleWakeAdvertiserOptions) {}

  start(): void {
    if (this.unsubscribe !== null) return;
    this.unsubscribe = this.options.onWakeChanged(() => this.refresh());
    this.refresh();
  }

  /** Stops advertising and lets the helper exit. */
  stop(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    if (this.midnight !== null) clearTimeout(this.midnight);
    this.midnight = null;
    if (this.helper !== null) {
      this.send({ cmd: "quit" });
      const helper = this.helper;
      this.helper = null;
      setTimeout(() => helper.kill(), 1_000).unref();
    }
    this.advertised = [];
  }

  /** Re-derives the UUIDs and tells the helper when they changed. */
  refresh(): void {
    const now = (this.options.now ?? (() => new Date()))();
    const uuids = [...this.options.uuids(now)].sort();
    this.scheduleMidnight(now, uuids.length > 0);
    if (sameList(uuids, this.advertised)) return;
    this.advertised = uuids;
    if (uuids.length === 0) {
      if (this.helper !== null) this.send({ cmd: "stop" });
      this.options.log.info("ble_wake.stopped");
      return;
    }
    if (!this.ensureHelper()) return;
    this.send({ cmd: "advertise", uuids });
    this.options.log.info("ble_wake.advertise", { phones: uuids.length });
  }

  /** The Settings line under Receiving. */
  status(): StatusText {
    if (this.helperMissing || this.state === "unavailable") return { text: "Not available on this computer", tone: "neutral" };
    if (this.state === "unauthorized") return { text: "Allow Bluetooth for LANA in System Settings", tone: "warning" };
    if (this.state === "powered_off") return { text: "Off", tone: "warning" };
    if (this.advertised.length > 0 && this.onAir > 0) return { text: this.onAir === 1 ? "Waking your phone" : `Waking ${this.onAir} phones`, tone: "good" };
    return { text: "On", tone: "neutral" };
  }

  private ensureHelper(): boolean {
    if (this.helper !== null) return true;
    const helper = this.options.spawn();
    if (helper === null) {
      this.helperMissing = true;
      this.options.log.notice("ble_wake.helper_unavailable");
      this.options.onStatus?.();
      return false;
    }
    this.helper = helper;
    helper.onLine((line) => this.received(line));
    helper.onExit(() => {
      if (this.helper !== helper) return;
      this.helper = null;
      this.onAir = 0;
      this.state = "starting";
      // Exited on its own: start again at the next change.
      this.advertised = [];
      this.options.log.notice("ble_wake.helper_exited");
      this.options.onStatus?.();
    });
    return true;
  }

  private received(line: string): void {
    let event: { event?: unknown; state?: unknown; count?: unknown };
    try {
      event = JSON.parse(line) as typeof event;
    } catch {
      return;
    }
    if (event.event === "state" && typeof event.state === "string") {
      this.state = event.state as BleWakeState;
      this.options.log.info("ble_wake.state", { state: this.state });
    } else if (event.event === "advertising" && typeof event.count === "number") {
      this.onAir = event.count;
    } else if (event.event === "error") {
      this.options.log.notice("ble_wake.helper_error");
    }
    this.options.onStatus?.();
  }

  private send(command: Record<string, unknown>): void {
    try {
      this.helper?.write(`${JSON.stringify(command)}\n`);
    } catch {
      this.options.log.notice("ble_wake.write_failed");
    }
  }

  /** While anything is advertised, re-derive at the next UTC midnight (the UUIDs change daily). */
  private scheduleMidnight(now: Date, active: boolean): void {
    if (this.midnight !== null) clearTimeout(this.midnight);
    this.midnight = null;
    if (!active) return;
    const next = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1) + 1_000;
    this.midnight = setTimeout(() => this.refresh(), next - now.getTime());
    this.midnight.unref();
  }
}

function sameList(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}
