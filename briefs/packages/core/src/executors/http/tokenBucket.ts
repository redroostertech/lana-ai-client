import type { Clock } from "../../handoff/ports.js";
import type { Sleeper } from "./sleeper.js";

/** Requests per interval (seconds) with a burst (Swift `RateLimitConfiguration`). */
export class RateLimitConfiguration {
  readonly requests: number;
  readonly interval: number;
  readonly burst: number;

  constructor(requests: number, interval: number, burst?: number) {
    this.requests = Math.max(1, requests);
    this.interval = Math.max(0.001, interval);
    this.burst = Math.max(1, burst ?? requests);
  }

  /** Clio Manage peak-hours limit, per access token. */
  static readonly clio = new RateLimitConfiguration(50, 60);
  /** Microsoft Graph Outlook limits are far higher; this keeps the gateway polite. */
  static readonly graph = new RateLimitConfiguration(120, 60);
}

/**
 * Token-bucket limiter (Swift `TokenBucket`). Clio allows about 50 requests per minute per
 * access token, so the Clio default refills 50 tokens every 60 seconds with a burst of 50.
 */
export class TokenBucket {
  private readonly capacity: number;
  private readonly refillPerSecond: number;
  private tokens: number;
  private lastRefill: number;

  constructor(configuration: RateLimitConfiguration, private readonly clock: Clock, private readonly sleeper: Sleeper) {
    this.capacity = configuration.burst;
    this.refillPerSecond = configuration.requests / configuration.interval;
    this.tokens = configuration.burst;
    this.lastRefill = clock.now().getTime();
  }

  /** Takes one token, waiting for a refill when the bucket is empty. */
  async acquire(): Promise<void> {
    for (;;) {
      this.refill();
      if (this.tokens >= 1) {
        this.tokens -= 1;
        return;
      }
      await this.sleeper.sleep((1 - this.tokens) / this.refillPerSecond);
    }
  }

  private refill(): void {
    const now = this.clock.now().getTime();
    const elapsed = Math.max(0, (now - this.lastRefill) / 1000);
    this.tokens = Math.min(this.capacity, this.tokens + elapsed * this.refillPerSecond);
    this.lastRefill = now;
  }
}
