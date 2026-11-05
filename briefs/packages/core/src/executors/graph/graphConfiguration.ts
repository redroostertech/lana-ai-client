import type { OAuthConfiguration } from "../oauth/oauthConfiguration.js";

/** Microsoft Graph constants (Swift `GraphConfiguration`). Drafts only: this module has no send endpoint. */
export const GraphConfiguration = {
  host: "graph.microsoft.com",
  baseURL: "https://graph.microsoft.com/v1.0",
  scopes: ["offline_access", "User.Read", "Mail.ReadWrite"] as readonly string[],
  authority: "https://login.microsoftonline.com/organizations",
  /**
   * Fixed namespace GUID for Lana's single-value extended property. Never change it:
   * dedupe of existing drafts (made by either app) depends on it.
   */
  propertyNamespace: "8b3f6c2e-5d4a-4e91-a7c3-1f0e9d2b6a58",
  intentPropertyID: "String {8b3f6c2e-5d4a-4e91-a7c3-1f0e9d2b6a58} Name LanaIntentId",

  /** Public client: PKCE, no secret. */
  oauthConfiguration(clientID: string, redirectURI: string): OAuthConfiguration {
    return {
      authorizeURL: `${GraphConfiguration.authority}/oauth2/v2.0/authorize`,
      tokenURL: `${GraphConfiguration.authority}/oauth2/v2.0/token`,
      clientID,
      clientSecret: undefined,
      redirectURI,
      scopes: GraphConfiguration.scopes,
    };
  },
} as const;
