import { fromUtf8, utf8 } from "../../src/bytes/index.js";
import {
  ClioClient, RateLimitConfiguration, RateLimitedClient, RetryPolicy,
  type AccessTokenProvider, type HTTPExchange, type HTTPRequest, type HTTPTransport, type Sleeper,
} from "../../src/executors/index.js";
import { ManualClock } from "./storeRig.js";

export interface Reply {
  readonly status: number;
  readonly json?: string;
  readonly headers?: Readonly<Record<string, string>>;
  /** Throw this instead of answering (a network failure). */
  readonly fail?: Error;
  readonly delayMs?: number;
}

interface Route {
  readonly method: string;
  readonly fragment: string;
  readonly replies: Reply[];
}

/**
 * Records every request and answers from scripted routes (Swift `FakeTransport`). The last
 * reply on a route repeats; unmatched requests get a 404.
 */
export class FakeTransport implements HTTPTransport {
  readonly requests: HTTPRequest[] = [];
  private readonly routes: Route[] = [];

  on(method: string, fragment: string, ...replies: Reply[]): void {
    this.routes.push({ method, fragment, replies });
  }

  sent(method: string, fragment: string): HTTPRequest[] {
    return this.requests.filter((request) => request.method === method && request.url.includes(fragment));
  }

  get urls(): string[] {
    return this.requests.map((request) => request.url);
  }

  get methods(): string[] {
    return this.requests.map((request) => request.method);
  }

  async send(request: HTTPRequest): Promise<HTTPExchange> {
    this.requests.push(request);
    const route = this.routes.find((candidate) => candidate.method === request.method && request.url.includes(candidate.fragment));
    let reply: Reply = { status: 404 };
    if (route !== undefined) {
      reply = route.replies[0] ?? reply;
      if (route.replies.length > 1) route.replies.shift();
    }
    if (reply.delayMs !== undefined) await new Promise((resolve) => setTimeout(resolve, reply.delayMs));
    if (reply.fail !== undefined) throw reply.fail;
    return { status: reply.status, headers: reply.headers ?? {}, body: utf8(reply.json ?? "{}") };
  }
}

export function bodyText(request: HTTPRequest | undefined): string {
  return request?.body === undefined ? "" : fromUtf8(request.body);
}

/** Records waits and moves the manual clock instead of sleeping. */
export class FakeSleeper implements Sleeper {
  readonly sleeps: number[] = [];
  constructor(private readonly clock: ManualClock) {}

  async sleep(seconds: number): Promise<void> {
    this.sleeps.push(seconds);
    this.clock.advance(seconds);
  }
}

export const staticTokens: AccessTokenProvider = { accessToken: async () => "test-access-token" };

export class Harness {
  readonly clock = new ManualClock();
  readonly transport = new FakeTransport();
  readonly sleeper = new FakeSleeper(this.clock);
  readonly client: RateLimitedClient;

  constructor(rateLimit: RateLimitConfiguration = new RateLimitConfiguration(1000, 60)) {
    this.client = new RateLimitedClient({
      transport: this.transport,
      rateLimit,
      retryPolicy: new RetryPolicy({ maxAttempts: 3, baseDelay: 1, maxDelay: 8, jitter: () => 0.5 }),
      clock: this.clock,
      sleeper: this.sleeper,
    });
  }

  get clio(): ClioClient {
    return new ClioClient({ region: "us", client: this.client, tokens: staticTokens });
  }
}

export const EMPTY_LIST = '{"data":[],"meta":{"paging":{}}}';
