import { describe, expect, it } from "vitest";
import {
  ACCOUNT_ERROR_MESSAGES, AccountManager, bareDomain, decodeSession, describeSession, encodeSession, HttpLanaAccountService,
  LanaAccountError, MemoryAccountSessionStore, parseServerAddress, VaultAccountSessionStore,
  type AccountErrorKind, type HttpRequest, type HttpResponse, type HttpTransport, type LanaAccountSession, type LanaServer, type Sleeper,
} from "../../src/account/index.js";
import { utf8 } from "../../src/bytes/index.js";
import { createInMemoryKeyVault, SECRET_ACCOUNTS } from "../../src/keys/index.js";

/** Answers each request from a script and records what was sent. */
class FakeTransport implements HttpTransport {
  readonly requests: HttpRequest[] = [];
  constructor(private readonly answer: (request: HttpRequest) => HttpResponse | "offline") {}
  async send(request: HttpRequest): Promise<HttpResponse> {
    this.requests.push(request);
    const reply = this.answer(request);
    if (reply === "offline") throw new TypeError("fetch failed");
    return reply;
  }
  get last(): HttpRequest {
    const request = this.requests.at(-1);
    if (request === undefined) throw new Error("no request");
    return request;
  }
}

const json = (status: number, body: unknown): HttpResponse => ({ status, body: JSON.stringify(body) });
const lanaError = (status: number, message: string): HttpResponse => json(status, { success: false, error: { message } });
const NOW = new Date("2026-11-01T12:00:00.000Z");
const SERVER: LanaServer = { baseURL: "http://localhost:8080", organizationID: null, organizationName: null };

function service(answer: (request: HttpRequest) => HttpResponse | "offline") {
  const transport = new FakeTransport(answer);
  return { transport, service: new HttpLanaAccountService({ transport, directoryURL: "https://directory.test/v1/discovery", now: () => NOW }) };
}

async function kindOf(promise: Promise<unknown>): Promise<AccountErrorKind | "resolved" | "other"> {
  try {
    await promise;
    return "resolved";
  } catch (error) {
    return error instanceof LanaAccountError ? error.kind : "other";
  }
}

const loginReply = {
  success: true,
  token: "tok-1",
  user: { id: 42, email: "person@firm.test", firstName: "Alicia", lastName: "Reyes", organizationId: 7, timezone: "America/New_York", mustChangePassword: true },
  session: { id: 99, expiresAt: "2026-11-02T00:00:00.123Z" },
};

function session(overrides: Partial<LanaAccountSession> = {}): LanaAccountSession {
  return {
    token: "tok-1",
    sessionID: "99",
    expiresAt: new Date(NOW.getTime() + 60 * 60 * 1_000),
    server: SERVER,
    user: { id: "42", email: "person@firm.test", firstName: "Alicia", lastName: null, organizationID: "7", timezone: null, mustChangePassword: false },
    ...overrides,
  };
}

describe("LanaServer", () => {
  it("parses typed server addresses like the Mac app", () => {
    expect(parseServerAddress(" http://localhost:8080/ ")).toEqual({ baseURL: "http://localhost:8080", organizationID: null, organizationName: null });
    expect(parseServerAddress("https://lana.firm.com/base//")?.baseURL).toBe("https://lana.firm.com/base");
    expect(parseServerAddress("ftp://lana.firm.com")).toBeNull();
    expect(parseServerAddress("lana.firm.com")).toBeNull();
    expect(parseServerAddress("")).toBeNull();
  });

  it("reduces a domain to its bare form", () => {
    expect(bareDomain(" HTTPS://Harlow-Reyes.com:443/path ")).toBe("harlow-reyes.com");
    expect(bareDomain("harlow-reyes.com")).toBe("harlow-reyes.com");
  });
});

describe("Account service: discovery", () => {
  it("finds the server and sends the trimmed, lowercased organization", async () => {
    const { service: accounts, transport } = service(() => json(200, { status: "healthy", server: { org_id: "harlow", org_name: "Harlow Reyes LLP" }, discovery: { static_ip: " 10.0.0.5 ", port: 8443, is_secure_ssl: true } }));
    const server = await accounts.discover("  Harlow ", "https://harlow-reyes.com/");
    expect(server).toEqual({ baseURL: "https://10.0.0.5:8443", organizationID: "harlow", organizationName: "Harlow Reyes LLP", domain: "harlow-reyes.com", enabledAppIDs: [] });
    expect(transport.last.url).toBe("https://directory.test/v1/discovery");
    expect(transport.last.body).toBe('{"domain":"harlow-reyes.com","org_id":"harlow"}');
    expect(transport.last.headers).toMatchObject({ "Content-Type": "application/json", Accept: "application/json" });
  });

  it("uses http when the directory says the server is not secure and accepts a string port", async () => {
    const { service: accounts } = service(() => json(200, { status: "healthy", discovery: { static_ip: "10.0.0.5", port: "8080" } }));
    expect(await accounts.discover("harlow", "harlow.com")).toEqual({ baseURL: "http://10.0.0.5:8080", organizationID: "harlow", organizationName: null, domain: "harlow.com", enabledAppIDs: [] });
  });

  it("maps every directory answer", async () => {
    const cases: [HttpResponse | "offline", AccountErrorKind][] = [
      [json(400, { error: "bad" }), "organizationDetailsInvalid"],
      [json(404, { error: "Organization not found" }), "organizationNotFound"],
      [json(429, {}), "rateLimited"],
      [json(503, {}), "directoryUnavailable"],
      [json(200, { status: "unhealthy" }), "organizationNotFound"],
      [json(200, { status: "healthy", discovery: { port: 8080 } }), "invalidResponse"],
      [{ status: 200, body: "<html>" }, "invalidResponse"],
      ["offline", "network"],
    ];
    for (const [reply, kind] of cases) {
      const { service: accounts } = service(() => reply);
      expect(await kindOf(accounts.discover("harlow", "harlow.com"))).toBe(kind);
    }
    const { service: accounts, transport } = service(() => json(200, {}));
    expect(await kindOf(accounts.discover(" ", "harlow.com"))).toBe("organizationDetailsInvalid");
    expect(transport.requests).toHaveLength(0);
  });
});

describe("Account service: sign in", () => {
  it("signs in, reading loose ids and fractional dates", async () => {
    const { service: accounts, transport } = service(() => json(200, loginReply));
    const result = await accounts.signIn(SERVER, "  person@firm.test ", "pw", null);
    expect(result).toEqual({
      token: "tok-1",
      sessionID: "99",
      expiresAt: new Date("2026-11-02T00:00:00.123Z"),
      server: SERVER,
      user: { id: "42", email: "person@firm.test", firstName: "Alicia", lastName: "Reyes", organizationID: "7", timezone: "America/New_York", mustChangePassword: true },
    });
    expect(transport.last.url).toBe("http://localhost:8080/api/v1/auth/login");
    expect(JSON.parse(transport.last.body)).toEqual({ email: "person@firm.test", password: "pw" });
    expect(transport.last.headers["Authorization"]).toBeUndefined();
  });

  it("sends the MFA code and gives a fallback lifetime without an expiry", async () => {
    const { service: accounts, transport } = service(() => json(200, { ...loginReply, session: undefined }));
    const result = await accounts.signIn(SERVER, "person@firm.test", "pw", "123456");
    expect(transport.last.body).toBe('{"email":"person@firm.test","mfa_token":"123456","password":"pw"}');
    expect(result.expiresAt).toEqual(new Date(NOW.getTime() + 12 * 60 * 60 * 1_000));
    expect(result.sessionID).toBeNull();
  });

  it("maps login failures by status and server message", async () => {
    const cases: [HttpResponse | "offline", string | null, AccountErrorKind][] = [
      [lanaError(401, "MFA token required"), null, "mfaRequired"],
      [lanaError(401, "Invalid MFA token"), "000000", "invalidMFACode"],
      [lanaError(403, "Account is not active"), null, "accountInactive"],
      [lanaError(401, "Invalid credentials"), null, "invalidCredentials"],
      [lanaError(400, "Validation failed: mfa_token"), "12", "invalidMFACode"],
      [lanaError(400, "Validation failed: mfa_token"), null, "invalidCredentials"],
      [lanaError(400, "Validation failed"), "123456", "invalidCredentials"],
      [json(429, {}), null, "rateLimited"],
      [json(500, {}), null, "serverUnavailable"],
      [json(200, { token: "", user: { id: 1, email: "a@b" } }), null, "invalidResponse"],
      [json(200, { token: "t", user: { email: "a@b" } }), null, "invalidResponse"],
      [json(200, { token: "t" }), null, "invalidResponse"],
      ["offline", null, "network"],
    ];
    for (const [reply, code, kind] of cases) {
      const { service: accounts } = service(() => reply);
      expect(await kindOf(accounts.signIn(SERVER, "person@firm.test", "pw", code))).toBe(kind);
    }
  });
});

describe("Account service: activation and password reset", () => {
  it("activates with the trimmed code", async () => {
    const { service: accounts, transport } = service(() => json(200, { success: true }));
    await accounts.activate(SERVER, " ABC123 ", "long enough");
    expect(transport.last.url).toBe("http://localhost:8080/api/v1/auth/activate");
    expect(JSON.parse(transport.last.body)).toEqual({ activation_code: "ABC123", password: "long enough" });
  });

  it("refuses a short password before calling the server", async () => {
    const { service: accounts, transport } = service(() => json(200, {}));
    expect(await kindOf(accounts.activate(SERVER, "ABC", "short"))).toBe("passwordTooShort");
    expect(transport.requests).toHaveLength(0);
  });

  it("maps activation failures", async () => {
    const cases: [HttpResponse, AccountErrorKind][] = [
      [lanaError(400, "Activation code has already been used"), "activationCodeUsed"],
      [lanaError(400, "Activation code has expired"), "activationCodeExpired"],
      [lanaError(400, "Account is already activated"), "alreadyActivated"],
      [lanaError(400, "This code cannot be used"), "activationCodeRejected"],
      [lanaError(400, "Validation error"), "passwordTooShort"],
      [lanaError(400, "Invalid activation code"), "invalidActivationCode"],
      [json(404, {}), "invalidActivationCode"],
      [json(429, {}), "rateLimited"],
      [json(502, {}), "serverUnavailable"],
    ];
    for (const [reply, kind] of cases) {
      const { service: accounts } = service(() => reply);
      expect(await kindOf(accounts.activate(SERVER, "ABC", "long enough"))).toBe(kind);
    }
  });

  it("gives the same answer to every server reply on password reset, and reports only no answer", async () => {
    for (const reply of [json(200, { resetToken: "never read" }), json(404, {}), json(429, {}), json(500, {})]) {
      const { service: accounts, transport } = service(() => reply);
      await expect(accounts.requestPasswordReset(SERVER, " person@firm.test ")).resolves.toBeUndefined();
      expect(transport.last.url).toBe("http://localhost:8080/api/v1/auth/request-password-reset");
      expect(transport.last.body).toBe('{"email":"person@firm.test"}');
    }
    const { service: offline } = service(() => "offline");
    expect(await kindOf(offline.requestPasswordReset(SERVER, "person@firm.test"))).toBe("network");
  });
});

describe("Account service: refresh and sign out", () => {
  it("refreshes with the bearer token", async () => {
    const { service: accounts, transport } = service(() => json(200, { token: "tok-2", expiresAt: "2026-11-03T00:00:00Z" }));
    const fresh = await accounts.refresh(session());
    expect(fresh).toEqual({ ...session(), token: "tok-2", expiresAt: new Date("2026-11-03T00:00:00Z") });
    expect(transport.last.url).toBe("http://localhost:8080/api/v1/auth/refresh");
    expect(transport.last.headers["Authorization"]).toBe("Bearer tok-1");
    expect(transport.last.body).toBe("{}");
  });

  it("maps refresh failures", async () => {
    const cases: [HttpResponse | "offline", AccountErrorKind][] = [
      [json(401, {}), "sessionExpired"],
      [json(403, {}), "sessionExpired"],
      [json(429, {}), "rateLimited"],
      [json(500, {}), "serverUnavailable"],
      [json(200, { token: "" }), "invalidResponse"],
      ["offline", "network"],
    ];
    for (const [reply, kind] of cases) {
      const { service: accounts } = service(() => reply);
      expect(await kindOf(accounts.refresh(session()))).toBe(kind);
    }
  });

  it("treats a 401 on logout as signed out and other failures as unavailable", async () => {
    expect(await kindOf(service(() => json(200, {})).service.signOut(session()))).toBe("resolved");
    expect(await kindOf(service(() => json(401, {})).service.signOut(session()))).toBe("resolved");
    expect(await kindOf(service(() => json(500, {})).service.signOut(session()))).toBe("serverUnavailable");
    const { service: accounts, transport } = service(() => json(204, {}));
    await accounts.signOut(session());
    expect(transport.last.url).toBe("http://localhost:8080/api/v1/auth/logout");
    expect(transport.last.headers["Authorization"]).toBe("Bearer tok-1");
  });
});

describe("Account errors", () => {
  it("carry the Mac app's copy", () => {
    expect(new LanaAccountError("invalidCredentials").message).toBe("That email and password do not match a LANA account.");
    expect(ACCOUNT_ERROR_MESSAGES.network).toBe("LANA could not reach the server. Check this computer's connection and try again.");
    for (const message of Object.values(ACCOUNT_ERROR_MESSAGES)) expect(message).not.toMatch(/[–—]/);
  });
});

describe("Session storage", () => {
  it("round trips through the vault as lana.session and never describes the token", async () => {
    const vault = createInMemoryKeyVault();
    const store = new VaultAccountSessionStore(vault);
    expect(await store.load()).toBeNull();
    await store.save(session());
    expect(await vault.secret(SECRET_ACCOUNTS.lanaSession)).not.toBeNull();
    expect(await store.load()).toEqual(session());
    expect(describeSession(session())).not.toContain("tok-1");
    expect(describeSession(session())).not.toContain("person@firm.test");
    await store.clear();
    expect(await vault.secret(SECRET_ACCOUNTS.lanaSession)).toBeNull();
  });

  it("drops an unreadable item", async () => {
    const vault = createInMemoryKeyVault();
    await vault.setSecret(SECRET_ACCOUNTS.lanaSession, utf8('{"old":"shape"}'));
    expect(await new VaultAccountSessionStore(vault).load()).toBeNull();
    expect(await vault.secret(SECRET_ACCOUNTS.lanaSession)).toBeNull();
  });

  it("writes sorted keys and whole-second ISO dates", () => {
    const text = new TextDecoder().decode(encodeSession(session({ expiresAt: new Date("2026-11-01T13:00:00.000Z") })));
    expect(text.startsWith('{"expiresAt":"2026-11-01T13:00:00Z","server":{"baseURL"')).toBe(true);
    expect(decodeSession(utf8(text))?.expiresAt).toEqual(new Date("2026-11-01T13:00:00Z"));
  });
});

/** A sleeper the test releases by hand. */
class ManualSleeper {
  readonly waits: number[] = [];
  private release: (() => void) | null = null;
  readonly sleep: Sleeper = (ms, signal) =>
    new Promise((resolve, reject) => {
      this.waits.push(ms);
      this.release = resolve;
      signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
    });
  wake(): void {
    const release = this.release;
    this.release = null;
    release?.();
  }
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

function manager(answer: (request: HttpRequest) => HttpResponse | "offline", stored: LanaAccountSession | null = null, clock = { ms: NOW.getTime() }) {
  const transport = new FakeTransport(answer);
  const sessions = new MemoryAccountSessionStore();
  sessions.session = stored;
  const sleeper = new ManualSleeper();
  const now = () => new Date(clock.ms);
  const accounts = new AccountManager({ service: new HttpLanaAccountService({ transport, now }), sessions, now, sleep: sleeper.sleep });
  const flags: boolean[] = [];
  accounts.addObserver((signedIn) => flags.push(signedIn));
  return { accounts, sessions, transport, sleeper, flags, clock };
}

describe("Account manager", () => {
  it("restores nothing as not signed in", async () => {
    const { accounts, flags } = manager(() => json(200, {}));
    expect(accounts.state).toEqual({ kind: "restoring" });
    await accounts.restore();
    expect(accounts.state).toEqual({ kind: "signedOut", reason: "notSignedIn" });
    expect(flags).toEqual([]);
  });

  it("restores an expired session as expired, keeping the server for the next sign in", async () => {
    const { accounts, sessions } = manager(() => json(200, {}), session({ expiresAt: new Date(NOW.getTime() - 1) }));
    await accounts.restore();
    expect(accounts.state).toEqual({ kind: "signedOut", reason: "expired" });
    expect(accounts.lastServer).toEqual(SERVER);
    expect(sessions.session).toBeNull();
  });

  it("restores a valid session and refreshes on schedule", async () => {
    const { accounts, sessions, sleeper, transport, flags, clock } = manager(() => json(200, { token: "tok-2", expiresAt: "2026-11-01T15:00:00Z" }), session());
    await accounts.restore();
    expect(accounts.session?.token).toBe("tok-1");
    expect(flags).toEqual([true]);
    expect(transport.requests).toHaveLength(0);
    await settle();
    // One hour left, ten minute margin: sleeps fifty minutes.
    expect(sleeper.waits).toEqual([50 * 60 * 1_000]);
    clock.ms += 50 * 60 * 1_000;
    sleeper.wake();
    await settle();
    await settle();
    expect(accounts.session?.token).toBe("tok-2");
    expect(sessions.session?.token).toBe("tok-2");
    expect(transport.last.headers["Authorization"]).toBe("Bearer tok-1");
    accounts.dispose();
  });

  it("refreshes at once when the stored session is close to expiry", async () => {
    const { accounts } = manager(() => json(200, { token: "tok-2", expiresAt: "2026-11-01T15:00:00Z" }), session({ expiresAt: new Date(NOW.getTime() + 5 * 60 * 1_000) }));
    await accounts.restore();
    expect(accounts.session?.token).toBe("tok-2");
    accounts.dispose();
  });

  it("ends the session when LANA refuses the refresh, keeps it on a network failure", async () => {
    const refused = manager(() => json(401, {}), session({ expiresAt: new Date(NOW.getTime() + 60_000) }));
    await refused.accounts.restore();
    expect(refused.accounts.state).toEqual({ kind: "signedOut", reason: "expired" });
    expect(refused.sessions.session).toBeNull();
    expect(refused.flags).toEqual([true, false]);

    const offline = manager(() => "offline", session({ expiresAt: new Date(NOW.getTime() + 60_000) }));
    await offline.accounts.restore();
    expect(offline.accounts.isSignedIn).toBe(true);
    offline.accounts.dispose();
  });

  it("saves on sign in and clears on sign out even when the server cannot be reached", async () => {
    const { accounts, sessions, flags, transport } = manager(() => "offline");
    await accounts.restore();
    await accounts.didSignIn(session());
    expect(sessions.session).toEqual(session());
    expect(accounts.state).toEqual({ kind: "signedIn", session: session() });
    await accounts.signOut();
    expect(accounts.state).toEqual({ kind: "signedOut", reason: "signedOut" });
    expect(sessions.session).toBeNull();
    expect(accounts.lastServer).toEqual(SERVER);
    expect(flags).toEqual([true, false]);
    expect(transport.last.url).toBe("http://localhost:8080/api/v1/auth/logout");
  });

  it("retries an authorized call once after a 401, then signs out on a second", async () => {
    const { accounts } = manager(() => json(200, { token: "tok-2" }));
    await accounts.restore();
    await accounts.didSignIn(session());
    const tokens: string[] = [];
    const result = await accounts.authorized(async (token) => {
      tokens.push(token);
      if (token === "tok-1") throw new LanaAccountError("sessionExpired");
      return "ok";
    });
    expect(result).toBe("ok");
    expect(tokens).toEqual(["tok-1", "tok-2"]);
    await expect(accounts.authorized(async () => {
      throw new LanaAccountError("sessionExpired");
    })).rejects.toMatchObject({ kind: "sessionExpired" });
    expect(accounts.state).toEqual({ kind: "signedOut", reason: "expired" });
  });
});

describe("firm domain (LANA AI client rule)", () => {
  it("defaults to <organization id>.lanaai.io and prefers a custom domain", async () => {
    const { firmDomain } = await import("../../src/account/lanaServer.js");
    expect(firmDomain("  MWestbrooks ", "")).toBe("mwestbrooks.lanaai.io");
    expect(firmDomain("mwestbrooks", "https://lana.firm.com:8443/x")).toBe("lana.firm.com");
    expect(firmDomain("harlow", "https://")).toBe("harlow.lanaai.io");
    expect(firmDomain("", "")).toBe("");
  });
});
