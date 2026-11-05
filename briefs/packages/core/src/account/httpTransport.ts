/** One HTTP exchange, as the account client needs it. Bodies hold secrets: never log them. */
export interface HttpRequest {
  readonly url: string;
  readonly method: "POST";
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
  readonly timeoutMs: number;
}

export interface HttpResponse {
  readonly status: number;
  readonly body: string;
}

/** Throws on a network failure (no answer); any HTTP status resolves. */
export interface HttpTransport {
  send(request: HttpRequest): Promise<HttpResponse>;
}

/** The real transport over the platform `fetch` (Node and Electron main). No cookies, no redirects to other origins. */
export const fetchTransport: HttpTransport = {
  async send(request: HttpRequest): Promise<HttpResponse> {
    const response = await fetch(request.url, {
      method: request.method,
      headers: request.headers,
      body: request.body,
      redirect: "error",
      signal: AbortSignal.timeout(request.timeoutMs),
    });
    return { status: response.status, body: await response.text() };
  },
};
