import { HandoffError } from "./errors.js";
import type { Frame } from "./frame.js";

interface Waiter {
  resolve(frame: Frame): void;
  reject(error: Error): void;
  timer: ReturnType<typeof setTimeout> | undefined;
}

/**
 * Hands decoded frames to `receive` calls in order. A receive that times out leaves the
 * queue intact, so the next receive still gets the next frame (Swift cancels the read task).
 */
export class FrameQueue {
  private readonly frames: Frame[] = [];
  private readonly waiters: Waiter[] = [];
  private failure: Error | undefined;

  push(frame: Frame): void {
    const waiter = this.waiters.shift();
    if (waiter === undefined) {
      this.frames.push(frame);
      return;
    }
    if (waiter.timer !== undefined) clearTimeout(waiter.timer);
    waiter.resolve(frame);
  }

  /** Ends the queue: frames already queued are still delivered, then `error` for every later receive. */
  fail(error: Error): void {
    if (this.failure !== undefined) return;
    this.failure = error;
    for (const waiter of this.waiters.splice(0)) {
      if (waiter.timer !== undefined) clearTimeout(waiter.timer);
      waiter.reject(error);
    }
  }

  get failed(): boolean {
    return this.failure !== undefined;
  }

  next(timeoutMs?: number): Promise<Frame> {
    const queued = this.frames.shift();
    if (queued !== undefined) return Promise.resolve(queued);
    if (this.failure !== undefined) return Promise.reject(this.failure);
    return new Promise<Frame>((resolve, reject) => {
      const waiter: Waiter = { resolve, reject, timer: undefined };
      if (timeoutMs !== undefined) {
        waiter.timer = setTimeout(() => {
          const index = this.waiters.indexOf(waiter);
          if (index >= 0) this.waiters.splice(index, 1);
          reject(new HandoffError("timed_out"));
        }, timeoutMs);
      }
      this.waiters.push(waiter);
    });
  }
}
