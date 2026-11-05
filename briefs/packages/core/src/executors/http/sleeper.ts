/** Waiting is injected so rate limiting and backoff are testable without real delays. */
export interface Sleeper {
  sleep(seconds: number): Promise<void>;
}

/** Real timers, rounded up to the millisecond (Swift `TaskSleeper`). */
export const timerSleeper: Sleeper = {
  sleep(seconds: number): Promise<void> {
    if (!(seconds > 0)) return Promise.resolve();
    return new Promise((resolve) => setTimeout(resolve, Math.ceil(seconds * 1000)));
  },
};
