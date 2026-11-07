import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BACKGROUND_UPDATE_KEYS } from "@lana/core/gateway";
import type { PlatformInfo, VoiceDownload } from "../src/shared/api.js";
import { BleWakeAdvertiser, type BleHelperProcess } from "../src/main/services/bleWake/bleWakeAdvertiser.js";
import { PreferencesService } from "../src/main/services/preferencesService.js";
import { openRealRig, RecordingLog, type RealRig } from "./support/realRig.js";

const platform: PlatformInfo = { os: "mac", deviceNoun: "computer", appVersion: "0.1.0", isDemo: false, features: { ask: false, talk: false } };

/** A helper process that records what main sends and answers like the Swift helper. */
class FakeHelper implements BleHelperProcess {
  readonly sent: Record<string, unknown>[] = [];
  private line: (line: string) => void = () => undefined;
  private exit: () => void = () => undefined;
  killed = false;
  write(line: string): void {
    const command = JSON.parse(line) as Record<string, unknown>;
    this.sent.push(command);
    if (command.cmd === "advertise") this.line(JSON.stringify({ event: "advertising", count: (command.uuids as unknown[]).length }));
    if (command.cmd === "stop") this.line(JSON.stringify({ event: "advertising", count: 0 }));
  }
  onLine(listener: (line: string) => void): void {
    this.line = listener;
  }
  onExit(listener: () => void): void {
    this.exit = listener;
  }
  kill(): void {
    this.killed = true;
  }
  say(event: Record<string, unknown>): void {
    this.line(JSON.stringify(event));
  }
  die(): void {
    this.exit();
  }
}

describe("BleWakeAdvertiser", () => {
  let uuids: string[];
  let changed: () => void;
  let spawned: FakeHelper[];
  let advertiser: BleWakeAdvertiser;
  let now: Date;
  beforeEach(() => {
    vi.useFakeTimers();
    uuids = [];
    spawned = [];
    now = new Date("2026-11-01T23:59:00.000Z");
    advertiser = new BleWakeAdvertiser({
      uuids: () => uuids,
      onWakeChanged: (listener) => ((changed = listener), () => undefined),
      spawn: () => {
        const helper = new FakeHelper();
        spawned.push(helper);
        return helper;
      },
      now: () => now,
      log: new RecordingLog(),
    });
  });
  afterEach(() => vi.useRealTimers());

  it("starts the helper only when something is queued, and stops advertising when the queue empties", () => {
    advertiser.start();
    expect(spawned).toHaveLength(0);
    uuids = ["B-UUID", "A-UUID"];
    changed();
    expect(spawned).toHaveLength(1);
    expect(spawned[0]?.sent).toEqual([{ cmd: "advertise", uuids: ["A-UUID", "B-UUID"] }]);
    spawned[0]?.say({ event: "state", state: "powered_on" });
    expect(advertiser.status()).toEqual({ text: "Waking 2 phones", tone: "good" });
    // Same list: nothing sent again.
    changed();
    expect(spawned[0]?.sent).toHaveLength(1);
    uuids = [];
    changed();
    expect(spawned[0]?.sent.at(-1)).toEqual({ cmd: "stop" });
    expect(advertiser.status()).toEqual({ text: "On", tone: "neutral" });
  });

  it("re-derives the daily UUIDs at UTC midnight and quits the helper on stop", () => {
    advertiser.start();
    uuids = ["DAY-1"];
    changed();
    uuids = ["DAY-2"];
    now = new Date("2026-11-02T00:00:02.000Z");
    vi.advanceTimersByTime(61_000);
    expect(spawned[0]?.sent.map((command) => command.uuids ?? command.cmd)).toEqual([["DAY-1"], ["DAY-2"]]);
    advertiser.stop();
    expect(spawned[0]?.sent.at(-1)).toEqual({ cmd: "quit" });
    vi.advanceTimersByTime(1_000);
    expect(spawned[0]?.killed).toBe(true);
  });

  it("reports Bluetooth off or not allowed, and a helper that exits is started again on the next change", () => {
    advertiser.start();
    uuids = ["A"];
    changed();
    spawned[0]?.say({ event: "state", state: "unauthorized" });
    expect(advertiser.status().tone).toBe("warning");
    spawned[0]?.die();
    uuids = ["A", "B"];
    changed();
    expect(spawned).toHaveLength(2);
  });

  it("says Bluetooth wake is unavailable when there is no helper", () => {
    const none = new BleWakeAdvertiser({ uuids: () => ["A"], onWakeChanged: () => () => undefined, spawn: () => null, log: new RecordingLog() });
    none.start();
    expect(none.status()).toEqual({ text: "Not available on this computer", tone: "neutral" });
  });
});

describe("Background updates preference (real store)", () => {
  let rig: RealRig;
  beforeEach(async () => {
    rig = await openRealRig();
  });
  afterEach(() => rig.cleanup());

  function preferences() {
    return new PreferencesService({
      voice: { download: () => ({ kind: "needed" }) as VoiceDownload, sizeText: () => "", start: () => undefined, remove: async () => undefined },
      store: rig.store,
      platform,
      gatewayStatus: async () => ({ listener: { kind: "listening" }, receiving: false }),
      pairedPhones: async () => 1,
      bluetooth: () => ({ text: "Waking your phone", tone: "good" }),
      emit: () => undefined,
      log: rig.log,
    });
  }

  it("is off by default with 8 hour leases, and turning it off revokes leases with an audit row", async () => {
    const service = preferences();
    const initial = await service.get();
    expect(initial.backgroundUpdates).toEqual({ enabled: false, leaseHours: 8, leaseHourChoices: [1, 4, 8, 24] });
    expect(initial.bluetooth).toEqual({ text: "Waking your phone", tone: "good" });
    expect((await service.setBackgroundUpdates({ enabled: true, leaseHours: 24 })).preferences.backgroundUpdates).toMatchObject({ enabled: true, leaseHours: 24 });
    expect((await service.setBackgroundUpdates({ leaseHours: 3 })).preferences.backgroundUpdates.leaseHours).toBe(24);
    const off = await service.setBackgroundUpdates({ enabled: false });
    expect(off.preferences.backgroundUpdates.enabled).toBe(false);
    expect(off.message).toBe("Background updates are off. Paired phones can no longer use their leases.");
    expect(rig.store.settings.get(BACKGROUND_UPDATE_KEYS.revokedAt)).not.toBeNull();
    expect((await rig.store.auditEntries()).map((entry) => entry.event)).toContain("handoff.leases_revoked");
  });
});
