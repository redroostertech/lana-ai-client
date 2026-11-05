const IDEMPOTENT = new Set(["GET", "HEAD", "PUT", "DELETE", "OPTIONS"]);

export interface RetryPolicyOptions {
  readonly maxAttempts?: number;
  readonly baseDelay?: number;
  readonly maxDelay?: number;
  readonly maxRetryAfter?: number;
  /** A value in [0, 1). Injected so tests are deterministic. */
  readonly jitter?: () => number;
}

/** Exponential backoff with jitter (Swift `RetryPolicy`). Times are in seconds. */
export class RetryPolicy {
  readonly maxAttempts: number;
  readonly baseDelay: number;
  readonly maxDelay: number;
  /** Longest Retry-After the client will wait out; anything longer is returned to the caller. */
  readonly maxRetryAfter: number;
  readonly jitter: () => number;

  constructor(options: RetryPolicyOptions = {}) {
    this.maxAttempts = Math.max(1, options.maxAttempts ?? 4);
    this.baseDelay = options.baseDelay ?? 1;
    this.maxDelay = options.maxDelay ?? 30;
    this.maxRetryAfter = options.maxRetryAfter ?? 120;
    this.jitter = options.jitter ?? Math.random;
  }

  /** Delay before attempt `attempt + 1`. Retry-After from the server wins over backoff. */
  delay(afterAttempt: number, retryAfter: number | undefined): number {
    if (retryAfter !== undefined) return retryAfter;
    const exponential = Math.min(this.maxDelay, this.baseDelay * 2 ** Math.max(0, afterAttempt - 1));
    return exponential * (0.5 + 0.5 * this.jitter());
  }

  static isIdempotent(method: string): boolean {
    return IDEMPOTENT.has(method.toUpperCase());
  }
}
