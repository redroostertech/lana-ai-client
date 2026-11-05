import {
  AccountManager, isAccountError, isSecureServer, LanaAccountError, parseServerAddress, serverHost,
  type AccountErrorKind, type LanaAccountService, type LanaAccountSession, type LanaServer as CoreServer, type LanaUser as CoreUser,
} from "@lana/core/account";
import type { AccountInfo } from "@lana/core/handoff";
import type { AccountApi, AccountState, AppError, LanaServer, LanaUser, Result, SignInOutcome } from "../../shared/api.js";
import type { MainLog } from "../log.js";
import { organizationText } from "../../shared/organization.js";

export function toApiServer(server: CoreServer): LanaServer {
  return {
    baseURL: server.baseURL,
    host: serverHost(server),
    organizationID: server.organizationID ?? "",
    organizationName: server.organizationName ?? "",
    domain: server.domain ?? "",
    isSecure: isSecureServer(server),
  };
}

export function toApiUser(user: CoreUser): LanaUser {
  return { id: user.id, email: user.email, firstName: user.firstName ?? "", lastName: user.lastName ?? "", mustChangePassword: user.mustChangePassword };
}

/**
 * What the paired phone shows for the signed-in account: display fields only, never the
 * token. The organization is its name and id; the server's host is not sent (the wire
 * field stays, empty, so phones already paired keep reading the message).
 */
export function toAccountInfo(session: LanaAccountSession): AccountInfo {
  return {
    name: `${session.user.firstName ?? ""} ${session.user.lastName ?? ""}`.trim(),
    email: session.user.email,
    organization: organizationText(session.server),
    serverHost: "",
  };
}

/** The renderer sends a server back; only its address and names are trusted, re-parsed here. */
export function fromApiServer(server: LanaServer | null | undefined): CoreServer | null {
  if (server === null || server === undefined || typeof server.baseURL !== "string") return null;
  const text = (value: unknown): string | null => (typeof value === "string" && value !== "" ? value : null);
  return parseServerAddress(server.baseURL, { organizationID: text(server.organizationID), organizationName: text(server.organizationName), domain: text(server.domain) });
}

export function accountAppError(kind: AccountErrorKind): AppError {
  return { code: kind, message: new LanaAccountError(kind).message };
}

function failure<T>(error: unknown, log: MainLog, step: string): Result<T> {
  if (error instanceof LanaAccountError) {
    log.notice("account.step_failed", { step, error: error.kind });
    return { ok: false, error: accountAppError(error.kind) };
  }
  log.error("account.step_failed", { step, error: error instanceof Error ? error.name : "unknown" });
  return { ok: false, error: accountAppError("invalidResponse") };
}

/**
 * The account bridge over the real `AccountManager` and `LanaAccountService`: the same
 * steps as the Mac sign-in flow. A successful sign-in is held in memory until the
 * renderer finishes the success mark (`completeSignIn`), then saved to the vault and the
 * gateway starts.
 */
export class AccountBridge implements AccountApi {
  private pending: LanaAccountSession | null = null;

  constructor(private readonly manager: AccountManager, private readonly service: LanaAccountService, private readonly log: MainLog) {}

  /** The manager's state in the bridge's shape. */
  snapshot(): AccountState {
    const state = this.manager.state;
    const lastServer = this.manager.lastServer === null ? null : toApiServer(this.manager.lastServer);
    switch (state.kind) {
      case "restoring":
        return { kind: "restoring" };
      case "signedOut":
        return { kind: "signedOut", reason: state.reason, lastServer };
      case "signedIn":
        return { kind: "signedIn", user: toApiUser(state.session.user), server: toApiServer(state.session.server) };
    }
  }

  async state(): Promise<AccountState> {
    return this.snapshot();
  }

  async discover(input: { organizationID: string; domain: string }): Promise<Result<LanaServer>> {
    try {
      const server = await this.service.discover(String(input?.organizationID ?? ""), String(input?.domain ?? ""));
      this.log.info("account.discovered", { secure: isSecureServer(server) });
      return { ok: true, value: toApiServer(server) };
    } catch (error) {
      return failure(error, this.log, "discover");
    }
  }

  async useServerAddress(address: string): Promise<Result<LanaServer>> {
    const server = parseServerAddress(String(address ?? ""));
    if (server === null) return { ok: false, error: accountAppError("invalidServerAddress") };
    this.log.info("account.server_address", { secure: isSecureServer(server) });
    return { ok: true, value: toApiServer(server) };
  }

  async signIn(input: { server: LanaServer; email: string; password: string; mfaCode?: string }): Promise<Result<SignInOutcome>> {
    const server = fromApiServer(input?.server);
    if (server === null) return { ok: false, error: accountAppError("invalidServerAddress") };
    const code = typeof input.mfaCode === "string" && input.mfaCode !== "" ? input.mfaCode : null;
    try {
      const session = await this.service.signIn(server, String(input.email ?? ""), String(input.password ?? ""), code);
      this.pending = session;
      this.log.info("account.credentials_accepted", { user: session.user.id });
      return { ok: true, value: { kind: "signedIn", user: toApiUser(session.user) } };
    } catch (error) {
      if (isAccountError(error, "mfaRequired")) {
        this.log.info("account.mfa_required");
        return { ok: true, value: { kind: "mfaRequired" } };
      }
      return failure(error, this.log, "sign_in");
    }
  }

  async completeSignIn(): Promise<Result<AccountState>> {
    const session = this.pending;
    this.pending = null;
    if (session === null) return { ok: false, error: accountAppError("sessionExpired") };
    try {
      await this.manager.didSignIn(session);
    } catch (error) {
      this.log.error("account.save_failed", { error: error instanceof Error ? error.name : "unknown" });
      return { ok: false, error: { code: "keystore", message: "LANA could not save your session in this computer's keystore. Try again." } };
    }
    return { ok: true, value: this.snapshot() };
  }

  async activate(input: { server: LanaServer; code: string; password: string }): Promise<Result<null>> {
    const server = fromApiServer(input?.server);
    if (server === null) return { ok: false, error: accountAppError("invalidServerAddress") };
    try {
      await this.service.activate(server, String(input.code ?? ""), String(input.password ?? ""));
      this.log.info("account.activated");
      return { ok: true, value: null };
    } catch (error) {
      return failure(error, this.log, "activate");
    }
  }

  async requestPasswordReset(input: { server: LanaServer; email: string }): Promise<Result<null>> {
    const server = fromApiServer(input?.server);
    if (server === null) return { ok: false, error: accountAppError("invalidServerAddress") };
    try {
      await this.service.requestPasswordReset(server, String(input.email ?? ""));
      return { ok: true, value: null };
    } catch (error) {
      return failure(error, this.log, "password_reset");
    }
  }

  async signOut(): Promise<AccountState> {
    this.pending = null;
    await this.manager.signOut();
    return this.snapshot();
  }
}
