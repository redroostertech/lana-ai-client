import { LanaAccountError } from "./lanaAccountError.js";
import type { HttpTransport } from "./httpTransport.js";
import { authEndpoint, type LanaServer } from "./lanaServer.js";

/**
 * The HTTP layer under `LanaAccountService` (Swift `LanaAuthClient`): one function per
 * LANA endpoint, building the request and decoding the reply. Maps nothing to user
 * words; the service does that. Request bodies hold passwords and codes, so nothing here
 * is ever logged.
 */

/** A reply outside 2xx: the status and LANA's `error.message` (or the directory's `error`). */
export class AuthFailure extends Error {
  override readonly name = "AuthFailure";
  constructor(readonly status: number, readonly serverMessage: string | null) {
    super(`HTTP ${status}`);
  }
}

export interface DiscoveryReply {
  readonly status: string | null;
  /** The firm's domain on record at the directory. */
  readonly domain: string | null;
  /** Ids of the apps turned on for the organization (`enabled_apps[].id`). */
  readonly enabledAppIDs: readonly string[];
  readonly server: { readonly orgID: string | null; readonly orgName: string | null } | null;
  readonly discovery: { readonly staticIP: string | null; readonly port: string | null; readonly isSecureSSL: boolean | null } | null;
}

export interface LoginReply {
  readonly token: string;
  readonly user: {
    readonly id: string;
    readonly email: string;
    readonly firstName: string | null;
    readonly lastName: string | null;
    readonly organizationId: string | null;
    readonly timezone: string | null;
    readonly mustChangePassword: boolean | null;
  };
  readonly session: { readonly id: string | null; readonly expiresAt: string | null } | null;
}

export interface RefreshReply {
  readonly token: string;
  readonly expiresAt: string | null;
}

export const DIRECTORY_URL = "https://www.redroostertec.com/lana-ai/v1/discovery";
const TIMEOUT_MS = 20_000;

export class LanaAuthClient {
  constructor(private readonly transport: HttpTransport, private readonly directoryURL: string = DIRECTORY_URL) {}

  /** POST {directory} {org_id, domain}. */
  async discover(organizationID: string, domain: string): Promise<DiscoveryReply> {
    const object = await this.sendJson(this.directoryURL, { org_id: organizationID, domain });
    const server = asRecord(object["server"]);
    const location = asRecord(object["discovery"]);
    return {
      status: asText(object["status"]),
      domain: asText(object["domain"]),
      enabledAppIDs: enabledAppIDs(object["enabled_apps"]),
      server: server === null ? null : { orgID: asText(server["org_id"]), orgName: asText(server["org_name"]) },
      discovery: location === null ? null : {
        staticIP: asText(location["static_ip"]),
        // The directory sends the port as a number or a string.
        port: looseString(location["port"]),
        isSecureSSL: typeof location["is_secure_ssl"] === "boolean" ? location["is_secure_ssl"] : null,
      },
    };
  }

  /** POST /api/v1/auth/login {email, password, mfa_token?}. */
  async login(server: LanaServer, email: string, password: string, mfaToken: string | null): Promise<LoginReply> {
    const body: Record<string, string> = { email, password };
    if (mfaToken !== null) body["mfa_token"] = mfaToken;
    const object = await this.sendJson(authEndpoint(server, "login"), body);
    const token = object["token"];
    const user = asRecord(object["user"]);
    if (typeof token !== "string" || user === null || typeof user["email"] !== "string") throw new LanaAccountError("invalidResponse");
    const session = asRecord(object["session"]);
    return {
      token,
      user: {
        id: looseString(user["id"]) ?? "",
        email: user["email"],
        firstName: asText(user["firstName"]),
        lastName: asText(user["lastName"]),
        organizationId: looseString(user["organizationId"]),
        timezone: asText(user["timezone"]),
        mustChangePassword: typeof user["mustChangePassword"] === "boolean" ? user["mustChangePassword"] : null,
      },
      session: session === null ? null : { id: looseString(session["id"]), expiresAt: asText(session["expiresAt"]) },
    };
  }

  /** POST /api/v1/auth/refresh with the bearer token. */
  async refresh(server: LanaServer, token: string): Promise<RefreshReply> {
    const object = await this.sendJson(authEndpoint(server, "refresh"), {}, token);
    if (typeof object["token"] !== "string") throw new LanaAccountError("invalidResponse");
    return { token: object["token"], expiresAt: asText(object["expiresAt"]) };
  }

  /** POST /api/v1/auth/logout with the bearer token. The reply body is ignored. */
  async logout(server: LanaServer, token: string): Promise<void> {
    await this.sendRaw(authEndpoint(server, "logout"), {}, token);
  }

  /** POST /api/v1/auth/activate {activation_code, password}. */
  async activate(server: LanaServer, code: string, password: string): Promise<void> {
    await this.sendRaw(authEndpoint(server, "activate"), { activation_code: code, password });
  }

  /**
   * POST /api/v1/auth/request-password-reset {email}. The reply body is never read: for
   * admins it can carry a reset token and link, which this app must not touch.
   */
  async requestPasswordReset(server: LanaServer, email: string): Promise<void> {
    await this.sendRaw(authEndpoint(server, "request-password-reset"), { email });
  }

  // Private

  private async sendJson(url: string, body: Record<string, string>, bearer?: string): Promise<Record<string, unknown>> {
    const text = await this.sendRaw(url, body, bearer);
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new LanaAccountError("invalidResponse");
    }
    const object = asRecord(parsed);
    if (object === null) throw new LanaAccountError("invalidResponse");
    return object;
  }

  /** The body of a 2xx reply; `AuthFailure` otherwise; `network` when nothing answered. */
  private async sendRaw(url: string, body: Record<string, string>, bearer?: string): Promise<string> {
    const headers: Record<string, string> = { "Content-Type": "application/json", Accept: "application/json" };
    if (bearer !== undefined) headers["Authorization"] = `Bearer ${bearer}`;
    let response;
    try {
      response = await this.transport.send({ url, method: "POST", headers, body: sortedJson(body), timeoutMs: TIMEOUT_MS });
    } catch {
      throw new LanaAccountError("network");
    }
    if (response.status < 200 || response.status > 299) throw new AuthFailure(response.status, errorMessage(response.body));
    return response.body;
  }
}

/**
 * The ids in discovery's `enabled_apps`: an array of objects such as
 * `{ id: "lana-works", label: "LanaWorks", ... }`. Elements that are not objects or have no
 * string id are skipped.
 */
export function enabledAppIDs(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const ids: string[] = [];
  for (const element of value) {
    const id = asRecord(element)?.["id"];
    if (typeof id === "string") ids.push(id);
  }
  return ids;
}

/** LANA sends `{error: {message}}`; the directory sends `{error: "..."}`. */
function errorMessage(body: string): string | null {
  let object: Record<string, unknown> | null;
  try {
    object = asRecord(JSON.parse(body));
  } catch {
    return null;
  }
  if (object === null) return null;
  const error = object["error"];
  const nested = asRecord(error);
  if (nested !== null && typeof nested["message"] === "string") return nested["message"];
  if (typeof error === "string") return error;
  return typeof object["message"] === "string" ? object["message"] : null;
}

function sortedJson(body: Record<string, string>): string {
  return JSON.stringify(Object.fromEntries(Object.entries(body).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))));
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function asText(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

/** Ids arrive as strings (UUIDs) or numbers depending on the deployment. */
function looseString(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isInteger(value)) return String(value);
  return null;
}
