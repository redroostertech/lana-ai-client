/** How long shutdown waits for calls in flight before closing the store anyway. */
export const SHUTDOWN_DRAIN_MS = 2_000;

/** What a call made after shutdown began resolves to, instead of touching a closing store. */
export const SHUTTING_DOWN = { ok: false, error: { code: "shuttingDown", message: "LANA Briefs is closing." } } as const;
export type ShuttingDown = typeof SHUTTING_DOWN;

/**
 * Orders shutdown in the main process: once `close` is called no new work starts (IPC calls
 * and derived pushes resolve to `SHUTTING_DOWN`), and `drain` waits for the work already in
 * flight, so the store is closed only after the last call that reads it has finished.
 */
export class ShutdownGate {
  private closing = false;
  private readonly inFlight = new Set<Promise<unknown>>();

  get isClosing(): boolean {
    return this.closing;
  }

  /** Runs `work` unless shutdown began. A late call, or a call that fails while closing, resolves to `SHUTTING_DOWN`. */
  run<T>(work: () => Promise<T> | T): Promise<T | ShuttingDown> {
    if (this.closing) return Promise.resolve(SHUTTING_DOWN);
    const call = (async () => {
      try {
        return await work();
      } catch (error) {
        if (this.closing) return SHUTTING_DOWN;
        throw error;
      }
    })();
    this.inFlight.add(call);
    void call.then(
      () => this.inFlight.delete(call),
      () => this.inFlight.delete(call),
    );
    return call;
  }

  /** Stops new work. Safe to call twice. */
  close(): void {
    this.closing = true;
  }

  /** Resolves once every call started before `close` settled, or after `timeoutMs`. */
  async drain(timeoutMs: number): Promise<void> {
    if (this.inFlight.size === 0) return;
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<void>((resolve) => {
      timer = setTimeout(resolve, timeoutMs);
    });
    const settled = Promise.allSettled([...this.inFlight]).then(() => undefined);
    await Promise.race([settled, timeout]);
    clearTimeout(timer);
  }
}
