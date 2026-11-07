/** One request to the firm's LANA server. Headers hold the bearer token and bodies hold note text: never log either. */
export interface LanaRequest {
  readonly method: "GET" | "POST" | "DELETE";
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body?: string | undefined;
  readonly timeoutMs: number;
}

export interface LanaReply {
  readonly status: number;
  readonly body: string;
}

/** Throws on a network failure or timeout (no answer); any HTTP status resolves. */
export interface LanaTransport {
  send(request: LanaRequest): Promise<LanaReply>;
}

/**
 * The real transport over the platform `fetch` (Node and Electron main). No cookies, no
 * cache, and no redirects, so the bearer token only ever goes to the signed-in server.
 */
export const fetchLanaTransport: LanaTransport = {
  async send(request: LanaRequest): Promise<LanaReply> {
    const response = await fetch(request.url, {
      method: request.method,
      headers: request.headers,
      ...(request.body === undefined ? {} : { body: request.body }),
      redirect: "error",
      cache: "no-store",
      credentials: "omit",
      signal: AbortSignal.timeout(request.timeoutMs),
    });
    return { status: response.status, body: await response.text() };
  },
};
