import type { RateLimitedClient } from "../http/rateLimitedClient.js";
import type { HTTPResponse } from "../http/httpResponse.js";
import type { AccessTokenProvider } from "../oauth/tokenStore.js";
import { schemeAndHost } from "../url.js";
import { ExecutorError } from "./executorError.js";
import { makePlannedRequest, plannedToHTTP, type PlannedRequest } from "./plannedRequest.js";

/**
 * Rate-limited client plus a bearer token source, pinned to one host so a paging link or
 * undo token can never send a token elsewhere (Swift `AuthorizedHTTPClient`).
 */
export class AuthorizedHTTPClient {
  readonly allowedHost: string;

  constructor(readonly client: RateLimitedClient, readonly tokens: AccessTokenProvider, allowedHost: string) {
    this.allowedHost = allowedHost.toLowerCase();
  }

  async send(planned: PlannedRequest): Promise<HTTPResponse> {
    const target = schemeAndHost(planned.url);
    if (target === null || target.scheme !== "https" || target.host !== this.allowedHost) throw ExecutorError.untrustedHost();
    const token = await this.tokens.accessToken();
    return this.client.send(plannedToHTTP(planned, token));
  }

  get(url: string): Promise<HTTPResponse> {
    return this.send(makePlannedRequest("GET", url, { Accept: "application/json" }));
  }

  async delete(url: string): Promise<void> {
    const response = await this.send(makePlannedRequest("DELETE", url, { Accept: "application/json" }));
    if (response.status === 404) return;
    response.requireSuccess(this.client.clock.now());
  }
}
