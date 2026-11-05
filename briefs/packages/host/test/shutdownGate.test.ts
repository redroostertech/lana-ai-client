import { describe, expect, it } from "vitest";
import { SHUTTING_DOWN, ShutdownGate } from "../src/main/shutdownGate.js";

/** A store that, like better-sqlite3, throws once closed. */
class ClosingStore {
  open = true;
  list(): string[] {
    if (!this.open) throw new Error("database is not open");
    return ["thread"];
  }
}

describe("ordered shutdown", () => {
  it("drains a call in flight before the store closes, and answers later calls with shutting down", async () => {
    const gate = new ShutdownGate();
    const store = new ClosingStore();
    let release: () => void = () => undefined;
    const slowStatus = new Promise<void>((resolve) => (release = resolve));
    // PreferencesService.get: awaits the gateway status, then reads the store.
    const inFlight = gate.run(async () => {
      await slowStatus;
      return store.list();
    });

    gate.close();
    const late = gate.run(async () => store.list());
    const drained = gate.drain(1_000);
    release();
    await drained;
    store.open = false;

    await expect(inFlight).resolves.toEqual(["thread"]);
    await expect(late).resolves.toBe(SHUTTING_DOWN);
  });

  it("turns a call that fails because the store closed under it into shutting down, never a rejection", async () => {
    const gate = new ShutdownGate();
    const store = new ClosingStore();
    let release: () => void = () => undefined;
    const call = gate.run(async () => {
      await new Promise<void>((resolve) => (release = resolve));
      return store.list();
    });
    gate.close();
    await gate.drain(10);
    store.open = false;
    release();
    await expect(call).resolves.toBe(SHUTTING_DOWN);
  });

  it("still reports real failures while running", async () => {
    const gate = new ShutdownGate();
    await expect(gate.run(async () => Promise.reject(new Error("boom")))).rejects.toThrow("boom");
    await expect(gate.run(() => 2)).resolves.toBe(2);
    await gate.drain(10);
  });
});
