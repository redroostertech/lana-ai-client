/** Static description of one OAuth 2.0 authorization code + PKCE provider (Swift `OAuthConfiguration`). */
export interface OAuthConfiguration {
  readonly authorizeURL: string;
  readonly tokenURL: string;
  readonly clientID: string;
  /** Confidential clients only (Clio). Microsoft public clients use PKCE with no secret. */
  readonly clientSecret?: string | undefined;
  readonly redirectURI: string;
  readonly scopes: readonly string[];
  /** Region tag stamped onto stored tokens for region-bound providers (Clio). */
  readonly region?: string | undefined;
}

/** The custom protocol the desktop app registers, as the Mac app's URL scheme. */
export const OAUTH_CALLBACK_SCHEME = "lananotes-auth";
export const CLIO_REDIRECT_URI = "lananotes-auth://oauth/clio";
export const MICROSOFT_REDIRECT_URI = "lananotes-auth://oauth/microsoft";

/** Token store accounts, the same names the Mac app uses (`Connector.rawValue`). */
export const CONNECTOR_ACCOUNTS = { clio: "clio", microsoft: "microsoft" } as const;
export type ConnectorAccount = (typeof CONNECTOR_ACCOUNTS)[keyof typeof CONNECTOR_ACCOUNTS];
