import { SYSTEM_CLOCK, type Clock } from "../../handoff/ports.js";
import { SILENT_LOG, type HandoffLog } from "../../handoff/log.js";
import { HTTPError } from "./httpError.js";
import { HTTPResponse } from "./httpResponse.js";
import type { HTTPRequest, HTTPTransport } from "./httpTransport.js";
import { RetryPolicy } from "./retryPolicy.js";
import { timerSleeper, type Sleeper } from "./sleeper.js";
import { TokenBucket, type RateLimitConfiguration } from "./tokenBucket.js";

export interface RateLimitedClientOptions {
  readonly transport: HTTPTransport;
  readonly rateLimit: RateLimitConfiguration;
  readonly retryPolicy?: RetryPolicy;
  readonly clock?: Clock;
  readonly sleeper?: Sleeper;
  readonly log?: HandoffLog;
}

/** True for an error that means the caller gave up (an aborted signal), which is never retried. */
function isCancellation(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

/**
 * Wraps a transport with a token bucket and retry (Swift `RateLimitedClient`). Only
 * idempotent methods are retried here, on 429 (honoring Retry-After), 5xx and transport
 * failures. A POST is sent at most once per call: executors decide whether a create may
 * be resent, and only after a marker search proves the first attempt did not land.
 */
export class RateLimitedClient {
  readonly retryPolicy: RetryPolicy;
  readonly sleeper: Sleeper;
  readonly clock: Clock;
  private readonly transport: HTTPTransport;
  private readonly bucket: TokenBucket;
  private readonly log: HandoffLog;

  constructor(options: RateLimitedClientOptions) {
    this.transport = options.transport;
    this.retryPolicy = options.retryPolicy ?? new RetryPolicy();
    this.clock = options.clock ?? SYSTEM_CLOCK;
    this.sleeper = options.sleeper ?? timerSleeper;
    this.log = options.log ?? SILENT_LOG;
    this.bucket = new TokenBucket(options.rateLimit, this.clock, this.sleeper);
  }

  async send(request: HTTPRequest): Promise<HTTPResponse> {
    const method = request.method.length > 0 ? request.method : "GET";
    const retryable = RetryPolicy.isIdempotent(method);
    let attempt = 1;
    for (;;) {
      await this.bucket.acquire();
      let response: HTTPResponse | undefined;
      let failure: HTTPError | undefined;
      try {
        response = new HTTPResponse(await this.transport.send(request));
      } catch (error) {
        if (error instanceof HTTPError) failure = error;
        else if (isCancellation(error)) throw error;
        else failure = HTTPError.transport(error instanceof Error ? error.name : "unknown");
      }

      let retryAfter: number | undefined;
      if (response !== undefined) {
        const status = response.status;
        if (!retryable || attempt >= this.retryPolicy.maxAttempts || !(status === 429 || (status >= 500 && status <= 599))) return response;
        retryAfter = response.retryAfter(this.clock.now());
        if (retryAfter !== undefined && retryAfter > this.retryPolicy.maxRetryAfter) return response;
      } else if (failure !== undefined) {
        if (!retryable || attempt >= this.retryPolicy.maxAttempts || !failure.isRetryable) throw failure;
        retryAfter = undefined;
      }
      const delay = this.retryPolicy.delay(attempt, retryAfter);
      this.log.info("http.retry", { method, attempt: attempt + 1, delay });
      await this.sleeper.sleep(delay);
      attempt += 1;
    }
  }
}
