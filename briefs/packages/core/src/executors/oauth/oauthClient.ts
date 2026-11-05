import { toBase64Url } from "../../bytes/base64.js";
import { fromUtf8, utf8 } from "../../bytes/utf8.js";
import { randomBytes } from "../../crypto/random.js";
import { SILENT_LOG, type HandoffLog } from "../../handoff/log.js";
import { SYSTEM_CLOCK, type Clock } from "../../handoff/ports.js";
import type { OAuthTokens } from "../../keys/oauthTokens.js";
import { HTTPError } from "../http/httpError.js";
import type { HTTPExchange, HTTPTransport } from "../http/httpTransport.js";
import { queryItems, withQuery } from "../url.js";
import { formEncode } from "./formEncoding.js";
import type { OAuthConfiguration } from "./oauthConfiguration.js";
import { OAuthError } from "./oauthError.js";
import { PKCE } from "./pkce.js";
import type { AccessTokenProvider, TokenStore } from "./tokenStore.js";

/**
 * The interactive step, supplied by the app shell: open `authorizeURL` in the system
 * browser and resolve with the redirect URL that came back through the custom protocol
 * (`lananotes-auth://oauth/...`). Reject to cancel.
 */
export type AuthorizationPresenter = (authorizeURL: string) => Promise<string>;

export interface OAuthClientOptions {
  readonly configuration: OAuthConfiguration;
  readonly account: string;
  readonly store: TokenStore;
  readonly transport: HTTPTransport;
  readonly clock?: Clock;
  readonly log?: HandoffLog;
}

function parseObject(body: Uint8Array): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(fromUtf8(body));
    return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/**
 * OAuth 2.0 authorization code + PKCE (S256) for one provider account (Swift `OAuthClient`).
 *
 * The shell opens `authorizationURL()` and passes the redirect to `handleCallback(url)`,
 * or hands `authorize` a presenter that does both. `accessToken()` refreshes 60 seconds
 * before expiry; concurrent callers share one refresh. A rejected refresh token clears the
 * stored tokens and surfaces `reauthorizationRequired`.
 */
export class OAuthClient implements AccessTokenProvider {
  static readonly refreshLeeway = 60;

  readonly configuration: OAuthConfiguration;
  readonly account: string;
  private readonly store: TokenStore;
  private readonly transport: HTTPTransport;
  private readonly clock: Clock;
  private readonly log: HandoffLog;
  private readonly pending = new Map<string, PKCE>();
  private refreshTask: Promise<OAuthTokens> | undefined;

  constructor(options: OAuthClientOptions) {
    this.configuration = options.configuration;
    this.account = options.account;
    this.store = options.store;
    this.transport = options.transport;
    this.clock = options.clock ?? SYSTEM_CLOCK;
    this.log = options.log ?? SILENT_LOG;
  }

  /** A fresh authorize URL with a new state and PKCE challenge. */
  authorizationURL(): string {
    const state = toBase64Url(randomBytes(24));
    const pkce = PKCE.generate();
    this.pending.set(state, pkce);
    const items: [string, string][] = [
      ["response_type", "code"],
      ["client_id", this.configuration.clientID],
      ["redirect_uri", this.configuration.redirectURI],
      ["state", state],
      ["code_challenge", pkce.challenge],
      ["code_challenge_method", PKCE.method],
    ];
    if (this.configuration.scopes.length > 0) items.push(["scope", this.configuration.scopes.join(" ")]);
    return withQuery(this.configuration.authorizeURL, items);
  }

  /** The whole interactive flow: authorize URL, the shell's presenter, then the code exchange. */
  async authorize(present: AuthorizationPresenter): Promise<OAuthTokens> {
    const callback = await present(this.authorizationURL());
    return this.handleCallback(callback);
  }

  /** Validates state, exchanges the code and stores the tokens. */
  async handleCallback(url: string): Promise<OAuthTokens> {
    const items = queryItems(url) ?? [];
    const value = (name: string): string | undefined => items.find((item) => item.name === name)?.value;
    const state = value("state");
    if (state === undefined) throw OAuthError.stateMismatch();
    const pkce = this.pending.get(state);
    if (pkce === undefined) throw this.pending.size === 0 ? OAuthError.noPendingAuthorization() : OAuthError.stateMismatch();
    this.pending.clear();
    const error = value("error");
    if (error !== undefined) throw OAuthError.authorizationDenied(error);
    const code = value("code");
    if (code === undefined || code.length === 0) throw OAuthError.missingCode();

    const form: [string, string][] = [
      ["grant_type", "authorization_code"],
      ["code", code],
      ["redirect_uri", this.configuration.redirectURI],
      ["client_id", this.configuration.clientID],
      ["code_verifier", pkce.verifier],
    ];
    if (this.configuration.clientSecret !== undefined) form.push(["client_secret", this.configuration.clientSecret]);
    const tokens = await this.requestTokens(form, undefined);
    await this.store.save(tokens, this.account);
    this.log.info("oauth.authorized", { account: this.account });
    return tokens;
  }

  async accessToken(): Promise<string> {
    const tokens = await this.store.load(this.account);
    if (tokens === null) throw OAuthError.notAuthorized();
    if ((tokens.expiresAt.getTime() - this.clock.now().getTime()) / 1000 > OAuthClient.refreshLeeway) return tokens.accessToken;
    return (await this.refreshed(tokens)).accessToken;
  }

  storedTokens(): Promise<OAuthTokens | null> {
    return this.store.load(this.account);
  }

  async signOut(): Promise<void> {
    this.refreshTask = undefined;
    await this.store.delete(this.account);
  }

  private async refreshed(tokens: OAuthTokens): Promise<OAuthTokens> {
    if (this.refreshTask !== undefined) return this.refreshTask;
    if (tokens.refreshToken === undefined) {
      await this.store.delete(this.account);
      throw OAuthError.reauthorizationRequired();
    }
    const task = this.performRefresh(tokens.refreshToken);
    this.refreshTask = task;
    try {
      return await task;
    } finally {
      if (this.refreshTask === task) this.refreshTask = undefined;
    }
  }

  private async performRefresh(refreshToken: string): Promise<OAuthTokens> {
    const form: [string, string][] = [
      ["grant_type", "refresh_token"],
      ["refresh_token", refreshToken],
      ["client_id", this.configuration.clientID],
    ];
    if (this.configuration.clientSecret !== undefined) form.push(["client_secret", this.configuration.clientSecret]);
    if (this.configuration.scopes.length > 0) form.push(["scope", this.configuration.scopes.join(" ")]);
    try {
      const tokens = await this.requestTokens(form, refreshToken);
      await this.store.save(tokens, this.account);
      this.log.info("oauth.refreshed", { account: this.account });
      return tokens;
    } catch (error) {
      if (error instanceof OAuthError && error.reason.kind === "tokenEndpoint" && error.reason.error === "invalid_grant") {
        await this.store.delete(this.account);
        this.log.notice("oauth.refresh_rejected", { account: this.account });
        throw OAuthError.reauthorizationRequired();
      }
      throw error;
    }
  }

  private async requestTokens(form: readonly (readonly [string, string])[], previousRefreshToken: string | undefined): Promise<OAuthTokens> {
    let exchange: HTTPExchange;
    try {
      exchange = await this.transport.send({
        method: "POST",
        url: this.configuration.tokenURL,
        headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
        body: utf8(formEncode(form)),
      });
    } catch (error) {
      if (error instanceof HTTPError) throw error;
      throw HTTPError.transport(error instanceof Error ? error.name : "unknown");
    }
    const body = parseObject(exchange.body);
    if (exchange.status < 200 || exchange.status > 299) {
      const code = body !== null && typeof body["error"] === "string" ? body["error"] : undefined;
      throw OAuthError.tokenEndpoint(exchange.status, code);
    }
    const access = body?.["access_token"];
    const refresh = body?.["refresh_token"];
    const expiresIn = body?.["expires_in"];
    const scope = body?.["scope"];
    const optionalString = (value: unknown): boolean => value === undefined || value === null || typeof value === "string";
    if (
      body === null || typeof access !== "string" || access.length === 0 || !optionalString(refresh) || !optionalString(scope) ||
      !(expiresIn === undefined || expiresIn === null || (typeof expiresIn === "number" && Number.isInteger(expiresIn)))
    ) {
      throw OAuthError.malformedTokenResponse();
    }
    const lifetime = typeof expiresIn === "number" ? expiresIn : 3600;
    return {
      accessToken: access,
      refreshToken: typeof refresh === "string" ? refresh : previousRefreshToken,
      expiresAt: new Date(Math.round(this.clock.now().getTime() + lifetime * 1000)),
      scope: typeof scope === "string" ? scope : undefined,
      region: this.configuration.region,
    };
  }
}
