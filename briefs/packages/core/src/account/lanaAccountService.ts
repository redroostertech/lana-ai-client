import { graphemeCount } from "../text/graphemes.js";
import { fetchTransport, type HttpTransport } from "./httpTransport.js";
import { AuthFailure, LanaAuthClient } from "./lanaAuthClient.js";
import { LanaAccountError, type AccountErrorKind } from "./lanaAccountError.js";
import { replacingToken, type LanaAccountSession } from "./lanaAccountSession.js";
import { bareDomain, type LanaServer, firmDomain } from "./lanaServer.js";

/** A server found through the directory, with the apps turned on for its organization. */
export interface DiscoveredServer extends LanaServer {
  readonly enabledAppIDs: readonly string[];
}

export const PASSWORD_MINIMUM_LENGTH = 8;
/** A missing or unreadable expiry gets this lifetime so the refresh loop still runs. */
export const FALLBACK_SESSION_LIFETIME_MS = 12 * 60 * 60 * 1_000;

/**
 * Signing in to the person's existing LANA platform account (Swift `LanaAccountService`).
 * There is no sign-up: a firm admin creates the account and the person activates it once.
 */
export interface LanaAccountService {
  /** Finds the firm's server from its Organization ID and domain, and the organization's apps. */
  discover(organizationID: string, domain: string): Promise<DiscoveredServer>;
  /** Throws `mfaRequired` when the account has MFA on and no code was given. */
  signIn(server: LanaServer, email: string, password: string, mfaCode: string | null): Promise<LanaAccountSession>;
  /** First-time activation with the code from the firm admin. */
  activate(server: LanaServer, code: string, password: string): Promise<void>;
  /** Asks LANA to notify the firm admin. Returns nothing, whatever the server says. */
  requestPasswordReset(server: LanaServer, email: string): Promise<void>;
  /** A fresh token for the same session. Throws `sessionExpired` when LANA refuses. */
  refresh(session: LanaAccountSession): Promise<LanaAccountSession>;
  /** Ends the session on the server. */
  signOut(session: LanaAccountSession): Promise<void>;
}

/** The real service over HTTP(S): maps each endpoint's replies to `LanaAccountError` (Swift `URLSessionLanaAccountService`). */
export class HttpLanaAccountService implements LanaAccountService {
  private readonly client: LanaAuthClient;
  private readonly now: () => Date;

  constructor(options: { readonly transport?: HttpTransport; readonly directoryURL?: string; readonly now?: () => Date } = {}) {
    this.client = new LanaAuthClient(options.transport ?? fetchTransport, options.directoryURL);
    this.now = options.now ?? (() => new Date());
  }

  async discover(organizationID: string, domain: string): Promise<DiscoveredServer> {
    const orgID = organizationID.trim().toLowerCase();
    // A blank domain means LANA's hosted default, as in the LANA AI client.
    const bare = firmDomain(orgID, domain);
    if (orgID === "" || bare === "") throw new LanaAccountError("organizationDetailsInvalid");
    let reply;
    try {
      reply = await this.client.discover(orgID, bare);
    } catch (error) {
      if (!(error instanceof AuthFailure)) throw error;
      switch (error.status) {
        case 400: throw new LanaAccountError("organizationDetailsInvalid");
        case 404: throw new LanaAccountError("organizationNotFound");
        case 429: throw new LanaAccountError("rateLimited");
        default: throw new LanaAccountError("directoryUnavailable");
      }
    }
    if (reply.status !== "healthy") throw new LanaAccountError("organizationNotFound");
    const host = reply.discovery?.staticIP?.trim() ?? "";
    const port = reply.discovery?.port ?? "";
    if (host === "" || port === "") throw new LanaAccountError("invalidResponse");
    const scheme = reply.discovery?.isSecureSSL === true ? "https" : "http";
    let url: URL;
    try {
      url = new URL(`${scheme}://${host}:${port}`);
    } catch {
      throw new LanaAccountError("invalidResponse");
    }
    return {
      baseURL: `${url.protocol}//${url.host}`,
      organizationID: reply.server?.orgID ?? orgID,
      organizationName: reply.server?.orgName ?? null,
      domain: bareDomain(reply.domain ?? "") || bare,
      enabledAppIDs: reply.enabledAppIDs,
    };
  }

  async signIn(server: LanaServer, email: string, password: string, mfaCode: string | null): Promise<LanaAccountSession> {
    let reply;
    try {
      reply = await this.client.login(server, email.trim(), password, mfaCode);
    } catch (error) {
      if (!(error instanceof AuthFailure)) throw error;
      throw new LanaAccountError(loginError(error, mfaCode !== null));
    }
    if (reply.token === "" || reply.user.id === "") throw new LanaAccountError("invalidResponse");
    return {
      token: reply.token,
      sessionID: reply.session?.id ?? null,
      expiresAt: this.expiry(reply.session?.expiresAt ?? null),
      server,
      user: {
        id: reply.user.id,
        email: reply.user.email,
        firstName: reply.user.firstName,
        lastName: reply.user.lastName,
        organizationID: reply.user.organizationId,
        timezone: reply.user.timezone,
        mustChangePassword: reply.user.mustChangePassword ?? false,
      },
    };
  }

  async activate(server: LanaServer, code: string, password: string): Promise<void> {
    if (graphemeCount(password) < PASSWORD_MINIMUM_LENGTH) throw new LanaAccountError("passwordTooShort");
    try {
      await this.client.activate(server, code.trim(), password);
    } catch (error) {
      if (!(error instanceof AuthFailure)) throw error;
      throw new LanaAccountError(activationError(error));
    }
  }

  async requestPasswordReset(server: LanaServer, email: string): Promise<void> {
    try {
      await this.client.requestPasswordReset(server, email.trim());
    } catch (error) {
      // Any answer from the server gets the same neutral confirmation, so the screen
      // never reveals whether an account exists. Only "no answer" is reported.
      if (!(error instanceof AuthFailure)) throw error;
    }
  }

  async refresh(session: LanaAccountSession): Promise<LanaAccountSession> {
    let reply;
    try {
      reply = await this.client.refresh(session.server, session.token);
    } catch (error) {
      if (!(error instanceof AuthFailure)) throw error;
      switch (error.status) {
        case 401:
        case 403: throw new LanaAccountError("sessionExpired");
        case 429: throw new LanaAccountError("rateLimited");
        default: throw new LanaAccountError("serverUnavailable");
      }
    }
    if (reply.token === "") throw new LanaAccountError("invalidResponse");
    return replacingToken(session, reply.token, this.expiry(reply.expiresAt));
  }

  async signOut(session: LanaAccountSession): Promise<void> {
    try {
      await this.client.logout(session.server, session.token);
    } catch (error) {
      if (!(error instanceof AuthFailure)) throw error;
      // Already ended on the server: signed out either way.
      if (error.status === 401) return;
      throw new LanaAccountError("serverUnavailable");
    }
  }

  /** ISO 8601 with or without fractional seconds, else the fallback lifetime. */
  expiry(raw: string | null): Date {
    if (raw !== null && ISO_INTERNET_DATE.test(raw)) {
      const ms = Date.parse(raw);
      if (!Number.isNaN(ms)) return new Date(ms);
    }
    return new Date(this.now().getTime() + FALLBACK_SESSION_LIFETIME_MS);
  }
}

const ISO_INTERNET_DATE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:?\d{2})$/;

function loginError(failure: AuthFailure, sentCode: boolean): AccountErrorKind {
  const message = failure.serverMessage?.toLowerCase() ?? "";
  switch (failure.status) {
    case 400:
      // Schema failures (a short password, a malformed code) say nothing useful.
      return sentCode && message.includes("mfa") ? "invalidMFACode" : "invalidCredentials";
    case 401:
    case 403:
      if (message.includes("mfa token required")) return "mfaRequired";
      if (message.includes("invalid mfa")) return "invalidMFACode";
      if (message.includes("not active")) return "accountInactive";
      return "invalidCredentials";
    case 429:
      return "rateLimited";
    default:
      return "serverUnavailable";
  }
}

function activationError(failure: AuthFailure): AccountErrorKind {
  const message = failure.serverMessage?.toLowerCase() ?? "";
  switch (failure.status) {
    case 400:
      if (message.includes("already been used")) return "activationCodeUsed";
      if (message.includes("expired")) return "activationCodeExpired";
      if (message.includes("already activated")) return "alreadyActivated";
      if (message.includes("cannot be used")) return "activationCodeRejected";
      if (message.includes("validation")) return "passwordTooShort";
      return "invalidActivationCode";
    case 404:
      return "invalidActivationCode";
    case 429:
      return "rateLimited";
    default:
      return "serverUnavailable";
  }
}
