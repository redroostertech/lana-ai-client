/**
 * The firm's LANA server this computer signs in to: found through the hosted directory
 * from an Organization ID and domain, or typed as a full address under Advanced
 * (Swift `LanaServer`).
 */
export interface LanaServer {
  /** Origin plus optional path, no trailing slash, for example `https://lana.firm.com:8443`. */
  readonly baseURL: string;
  readonly organizationID: string | null;
  readonly organizationName: string | null;
  /**
   * The firm's domain as the directory knows it, kept so the app can run discovery again to
   * recheck the organization's apps. Absent for servers typed under Advanced.
   */
  readonly domain?: string | null;
}

/** False for plain http: the password would cross the network unencrypted. */
export function isSecureServer(server: LanaServer): boolean {
  return server.baseURL.toLowerCase().startsWith("https://");
}

export function serverHost(server: LanaServer): string {
  try {
    return new URL(server.baseURL).host;
  } catch {
    return server.baseURL;
  }
}

/** The firm's name when the directory gave one, otherwise the server's host. */
export function serverDisplayName(server: LanaServer): string {
  if (server.organizationName !== null && server.organizationName !== "") return server.organizationName;
  return serverHost(server);
}

/**
 * A full server address typed under Advanced. Only http and https with a host are
 * accepted; trailing slashes are dropped.
 */
export function parseServerAddress(
  raw: string,
  details: { organizationID?: string | null; organizationName?: string | null; domain?: string | null } = {},
): LanaServer | null {
  const trimmed = raw.trim();
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  const scheme = url.protocol.toLowerCase();
  if ((scheme !== "http:" && scheme !== "https:") || url.hostname === "") return null;
  if (url.username !== "" || url.password !== "") return null;
  let text = `${url.protocol}//${url.host}${url.pathname}`;
  while (text.endsWith("/")) text = text.slice(0, -1);
  const domain = bareDomain(details.domain ?? "");
  return { baseURL: text, organizationID: details.organizationID ?? null, organizationName: details.organizationName ?? null, ...(domain === "" ? {} : { domain }) };
}

/** "harlow-reyes.com" from a bare domain or one typed with a scheme, port or path. */
/** LANA's hosted naming: a firm's server domain is `<organization id>.lanaai.io`, the
 *  same default the LANA AI client uses when only the Organization ID is given. */
export const HOSTED_DOMAIN_SUFFIX = "lanaai.io";

/** The domain sent to discovery: the custom domain when one is given, otherwise the
 *  hosted default for the organization. */
export function firmDomain(organizationID: string, customDomain: string): string {
  const custom = bareDomain(customDomain);
  if (custom !== "") return custom;
  const orgID = organizationID.trim().toLowerCase();
  return orgID === "" ? "" : `${orgID}.${HOSTED_DOMAIN_SUFFIX}`;
}

export function bareDomain(raw: string): string {
  let domain = raw.trim().toLowerCase();
  for (const prefix of ["https://", "http://"]) {
    if (domain.startsWith(prefix)) domain = domain.slice(prefix.length);
  }
  const colon = domain.indexOf(":");
  if (colon >= 0) domain = domain.slice(0, colon);
  const slash = domain.indexOf("/");
  if (slash >= 0) domain = domain.slice(0, slash);
  return domain;
}

/** `<base>/api/v1/auth/<path>`. */
export function authEndpoint(server: LanaServer, path: string): string {
  return `${server.baseURL}/api/v1/auth/${path}`;
}
