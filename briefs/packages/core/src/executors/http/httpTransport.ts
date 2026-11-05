import { HTTPError } from "./httpError.js";

/** One request as the executors send it. Headers and body may hold a bearer token or note text: never log them. */
export interface HTTPRequest {
  readonly method: string;
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body?: Uint8Array | undefined;
}

/** A completed exchange as the transport returns it. Non-2xx statuses resolve. */
export interface HTTPExchange {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: Uint8Array;
}

/**
 * The single seam every network call in the executors goes through (Swift `HTTPTransport`).
 * Tests swap in a fake that records requests and scripts responses. Throws on a network
 * failure; any HTTP status resolves.
 */
export interface HTTPTransport {
  send(request: HTTPRequest): Promise<HTTPExchange>;
}

/** Same as URLSession's default request timeout. */
const REQUEST_TIMEOUT_MS = 60_000;

/**
 * Production transport over the platform `fetch` (Node and Electron main). No cookie jar
 * and no cache, like the ephemeral URLSession the Mac app uses. Redirects are followed as
 * URLSession does; fetch drops Authorization on a cross-origin redirect.
 */
export const fetchHTTPTransport: HTTPTransport = {
  async send(request: HTTPRequest): Promise<HTTPExchange> {
    const init: RequestInit = {
      method: request.method,
      headers: request.headers,
      redirect: "follow",
      cache: "no-store",
      credentials: "omit",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    };
    // A copy backed by a plain ArrayBuffer, which is what BodyInit accepts under the DOM typings too.
    if (request.body !== undefined) init.body = new Uint8Array(request.body);
    let response: Response;
    try {
      response = await fetch(request.url, init);
    } catch (error) {
      throw HTTPError.transport(error instanceof Error ? error.name : "unknown");
    }
    const headers: Record<string, string> = {};
    response.headers.forEach((value, name) => {
      headers[name] = value;
    });
    return { status: response.status, headers, body: new Uint8Array(await response.arrayBuffer()) };
  },
};
