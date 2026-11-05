import type { OAuthConfiguration } from "../oauth/oauthConfiguration.js";

export const CLIO_REGIONS = ["us", "ca", "eu", "au"] as const;
/**
 * Clio Manage data region. Tokens are region-bound, so the region is stored with them
 * (`OAuthTokens.region`) and every API and OAuth URL derives from it.
 */
export type ClioRegion = (typeof CLIO_REGIONS)[number];

const HOSTS: Readonly<Record<ClioRegion, string>> = { us: "app.clio.com", ca: "ca.app.clio.com", eu: "eu.app.clio.com", au: "au.app.clio.com" };

export function clioHost(region: ClioRegion): string {
  return HOSTS[region];
}

export function clioBaseURL(region: ClioRegion): string {
  return `https://${HOSTS[region]}`;
}

export function parseClioRegion(raw: string | null | undefined): ClioRegion | undefined {
  return (CLIO_REGIONS as readonly string[]).includes(raw ?? "") ? (raw as ClioRegion) : undefined;
}

/**
 * Clio documents `/oauth/authorize` and `/oauth/token` on app.clio.com; the other regions
 * follow the same paths on their own host.
 */
export function clioOAuthConfiguration(region: ClioRegion, clientID: string, clientSecret: string | undefined, redirectURI: string): OAuthConfiguration {
  return {
    authorizeURL: `${clioBaseURL(region)}/oauth/authorize`,
    tokenURL: `${clioBaseURL(region)}/oauth/token`,
    clientID,
    clientSecret,
    redirectURI,
    scopes: [],
    region,
  };
}
