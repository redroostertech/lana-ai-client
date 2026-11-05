import type { LanaServer } from "./lanaServer.js";
import type { LanaUser } from "./lanaUser.js";

/**
 * A signed-in LANA session: the bearer token, when it ends, the server and the person.
 * Kept only in the KeyVault (`lana.session`). Never log one: use `describeSession`.
 */
export interface LanaAccountSession {
  readonly token: string;
  readonly sessionID: string | null;
  readonly expiresAt: Date;
  readonly server: LanaServer;
  readonly user: LanaUser;
}

export function replacingToken(session: LanaAccountSession, token: string, expiresAt: Date): LanaAccountSession {
  return { ...session, token, expiresAt };
}

/** Ids and dates only, never the token or email. */
export function describeSession(session: LanaAccountSession): string {
  return `LanaAccountSession(user: ${session.user.id}, expires: ${session.expiresAt.toISOString()})`;
}

/** The vault item: JSON with sorted keys and ISO 8601 dates, like Swift's `SecretAccountSessionStore`. */
export function encodeSession(session: LanaAccountSession): Uint8Array {
  const value = {
    expiresAt: session.expiresAt.toISOString().replace(/\.\d{3}Z$/, "Z"),
    server: {
      baseURL: session.server.baseURL,
      domain: session.server.domain,
      organizationID: session.server.organizationID,
      organizationName: session.server.organizationName,
    },
    sessionID: session.sessionID,
    token: session.token,
    user: { ...session.user },
  };
  return new TextEncoder().encode(JSON.stringify(sortKeys(value)));
}

/** Null for an unreadable item (an older shape); the person signs in again. */
export function decodeSession(data: Uint8Array): LanaAccountSession | null {
  try {
    const object = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(data)) as Record<string, unknown>;
    const server = object["server"] as Record<string, unknown>;
    const user = object["user"] as Record<string, unknown>;
    const expiresAt = new Date(String(object["expiresAt"]));
    if (typeof object["token"] !== "string" || Number.isNaN(expiresAt.getTime())) return null;
    if (typeof server?.["baseURL"] !== "string" || typeof user?.["id"] !== "string" || typeof user["email"] !== "string") return null;
    return {
      token: object["token"],
      sessionID: optionalText(object["sessionID"]),
      expiresAt,
      server: {
        baseURL: server["baseURL"],
        organizationID: optionalText(server["organizationID"]),
        organizationName: optionalText(server["organizationName"]),
        ...(typeof server["domain"] === "string" ? { domain: server["domain"] } : {}),
      },
      user: {
        id: user["id"],
        email: user["email"],
        firstName: optionalText(user["firstName"]),
        lastName: optionalText(user["lastName"]),
        organizationID: optionalText(user["organizationID"]),
        timezone: optionalText(user["timezone"]),
        mustChangePassword: user["mustChangePassword"] === true,
      },
    };
  } catch {
    return null;
  }
}

function optionalText(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, entry]) => [key, sortKeys(entry)]),
  );
}
