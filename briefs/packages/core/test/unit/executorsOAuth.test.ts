import { describe, expect, it } from "vitest";
import {
  CLIO_REDIRECT_URI, ClioClient, GraphConfiguration, InMemoryTokenStore, MICROSOFT_REDIRECT_URI, OAuthClient, OAuthError, PKCE,
  clioOAuthConfiguration, vaultTokenStore,
} from "../../src/executors/index.js";
import { createInMemoryKeyVault } from "../../src/keys/index.js";
import { FakeTransport, Harness, bodyText } from "../support/executorFakes.js";
import { ManualClock } from "../support/storeRig.js";

const configuration = clioOAuthConfiguration("eu", "client-1", "secret-1", CLIO_REDIRECT_URI);

function query(url: string): Record<string, string> {
  return Object.fromEntries(new URL(url).searchParams.entries());
}

function form(body: string): Record<string, string> {
  return Object.fromEntries(new URLSearchParams(body.replaceAll("+", "%2B")).entries());
}

async function rejection(promise: Promise<unknown>): Promise<OAuthError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof OAuthError) return error;
    throw error;
  }
  throw new Error("expected a rejection");
}

describe("OAuth PKCE client", () => {
  it("matches RFC 7636 appendix B", () => {
    const octets = Uint8Array.from([116, 24, 223, 180, 151, 153, 224, 37, 79, 250, 96, 125, 216, 173, 187, 186, 22, 212, 37, 77, 105, 214, 191, 240, 91, 88, 5, 88, 83, 132, 141, 121]);
    const pkce = PKCE.fromRandomBytes(octets);
    expect(pkce.verifier).toBe("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk");
    expect(pkce.challenge).toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
  });

  it("builds an authorize URL with state and challenge", () => {
    const client = new OAuthClient({ configuration, account: "clio", store: new InMemoryTokenStore(), transport: new FakeTransport() });
    const url = client.authorizationURL();
    const items = query(url);
    expect(new URL(url).host).toBe("eu.app.clio.com");
    expect(new URL(url).pathname).toBe("/oauth/authorize");
    expect(items["response_type"]).toBe("code");
    expect(items["client_id"]).toBe("client-1");
    expect(items["redirect_uri"]).toBe("lananotes-auth://oauth/clio");
    expect(items["code_challenge_method"]).toBe("S256");
    expect(items["code_challenge"]).toHaveLength(43);
    expect(items["state"]!.length).toBeGreaterThanOrEqual(32);
    expect(items["scope"]).toBeUndefined();
  });

  it("rejects a forged state without calling the token endpoint", async () => {
    const transport = new FakeTransport();
    const client = new OAuthClient({ configuration, account: "clio", store: new InMemoryTokenStore(), transport });
    client.authorizationURL();
    expect((await rejection(client.handleCallback("lananotes-auth://oauth/clio?code=abc&state=forged"))).reason.kind).toBe("stateMismatch");
    expect((await rejection(client.handleCallback("lananotes-auth://oauth/clio?code=abc"))).reason.kind).toBe("stateMismatch");
    expect(transport.requests).toHaveLength(0);
  });

  it("runs the injected presenter, exchanges the code with the verifier and stores the region", async () => {
    const clock = new ManualClock();
    const transport = new FakeTransport();
    transport.on("POST", "/oauth/token", { status: 200, json: '{"access_token":"at-1","refresh_token":"rt-1","expires_in":3600,"token_type":"bearer"}' });
    const store = new InMemoryTokenStore();
    const client = new OAuthClient({ configuration, account: "clio", store, transport, clock });
    let opened = "";
    const tokens = await client.authorize(async (authorizeURL) => {
      opened = authorizeURL;
      return `lananotes-auth://oauth/clio?code=the%20code%2B1&state=${encodeURIComponent(query(authorizeURL)["state"]!)}`;
    });
    expect(opened.startsWith("https://eu.app.clio.com/oauth/authorize?")).toBe(true);
    expect(tokens.accessToken).toBe("at-1");
    expect(tokens.region).toBe("eu");
    expect(tokens.expiresAt.getTime()).toBe(clock.now().getTime() + 3_600_000);
    const request = transport.requests[0]!;
    expect(request.url).toBe("https://eu.app.clio.com/oauth/token");
    expect(request.headers["Content-Type"]).toBe("application/x-www-form-urlencoded");
    const sent = form(bodyText(request));
    expect(sent["grant_type"]).toBe("authorization_code");
    expect(sent["code"]).toBe("the code+1");
    expect(sent["code_verifier"]).toHaveLength(43);
    expect(PKCE.method).toBe("S256");
    expect(new PKCE(sent["code_verifier"]!).challenge).toBe(query(opened)["code_challenge"]);
    expect(sent["client_secret"]).toBe("secret-1");
    expect((await store.load("clio"))?.refreshToken).toBe("rt-1");

    // The state is single use.
    const replay = await rejection(client.handleCallback(`lananotes-auth://oauth/clio?code=x&state=${query(opened)["state"]}`));
    expect(replay.reason.kind).toBe("noPendingAuthorization");
  });

  it("surfaces a denied authorization", async () => {
    const client = new OAuthClient({ configuration, account: "clio", store: new InMemoryTokenStore(), transport: new FakeTransport() });
    const denied = await rejection(client.authorize(async (url) => `lananotes-auth://oauth/clio?error=access_denied&state=${query(url)["state"]}`));
    expect(denied.reason).toEqual({ kind: "authorizationDenied", error: "access_denied" });
    expect(denied.message).toBe("Sign-in was cancelled or denied.");
  });

  it("does not refresh a fresh token", async () => {
    const clock = new ManualClock();
    const transport = new FakeTransport();
    const store = new InMemoryTokenStore({ clio: { accessToken: "at-1", refreshToken: "rt-1", expiresAt: new Date(clock.now().getTime() + 61_000) } });
    const client = new OAuthClient({ configuration, account: "clio", store, transport, clock });
    expect(await client.accessToken()).toBe("at-1");
    expect(transport.requests).toHaveLength(0);
  });

  it("shares one refresh between concurrent callers and keeps the old refresh token", async () => {
    const clock = new ManualClock();
    const transport = new FakeTransport();
    transport.on("POST", "/oauth/token", { status: 200, json: '{"access_token":"at-2","expires_in":2592000}', delayMs: 20 });
    const store = new InMemoryTokenStore({ clio: { accessToken: "at-1", refreshToken: "rt-1", expiresAt: new Date(clock.now().getTime() + 59_000) } });
    const client = new OAuthClient({ configuration, account: "clio", store, transport, clock });
    const tokens = await Promise.all(Array.from({ length: 12 }, () => client.accessToken()));
    expect(tokens.every((token) => token === "at-2")).toBe(true);
    expect(transport.requests).toHaveLength(1);
    const sent = form(bodyText(transport.requests[0]));
    expect(sent["grant_type"]).toBe("refresh_token");
    expect(sent["refresh_token"]).toBe("rt-1");
    expect((await store.load("clio"))?.refreshToken).toBe("rt-1");
    expect((await store.load("clio"))?.expiresAt.getTime()).toBe(clock.now().getTime() + 2_592_000_000);
  });

  it("refreshes inside an executor call and sends the new bearer token", async () => {
    const h = new Harness();
    h.transport.on("POST", "/oauth/token", { status: 200, json: '{"access_token":"at-new","refresh_token":"rt-2","expires_in":3600}' });
    h.transport.on("GET", "/users/who_am_i.json", { status: 200, json: '{"data":{"id":42,"name":"Pat"}}' });
    const store = new InMemoryTokenStore({ clio: { accessToken: "at-old", refreshToken: "rt-1", expiresAt: h.clock.now(), region: "us" } });
    const oauth = new OAuthClient({ configuration: clioOAuthConfiguration("us", "client-1", undefined, CLIO_REDIRECT_URI), account: "clio", store, transport: h.transport, clock: h.clock });
    const clio = new ClioClient({ region: "us", client: h.client, tokens: oauth });
    expect((await clio.whoAmI()).id).toBe("42");
    expect(h.transport.sent("GET", "who_am_i")[0]?.headers["Authorization"]).toBe("Bearer at-new");
    expect((await store.load("clio"))?.refreshToken).toBe("rt-2");
    expect(form(bodyText(h.transport.requests[0]))["client_secret"]).toBeUndefined();
  });

  it("clears tokens and asks to reauthorize on invalid_grant", async () => {
    const clock = new ManualClock();
    const transport = new FakeTransport();
    transport.on("POST", "/oauth/token", { status: 400, json: '{"error":"invalid_grant"}' });
    const store = new InMemoryTokenStore({ clio: { accessToken: "at-1", refreshToken: "rt-1", expiresAt: clock.now() } });
    const client = new OAuthClient({ configuration, account: "clio", store, transport, clock });
    const error = await rejection(client.accessToken());
    expect(error.reason.kind).toBe("reauthorizationRequired");
    expect(error.message).toBe("Your connection expired. Sign in again to continue.");
    expect(await store.load("clio")).toBeNull();
    expect((await rejection(client.accessToken())).reason.kind).toBe("notAuthorized");
  });

  it("maps other token endpoint failures", async () => {
    const clock = new ManualClock();
    const transport = new FakeTransport();
    transport.on("POST", "/oauth/token", { status: 500, json: "<html>" }, { status: 200, json: '{"access_token":""}' });
    const expired = { clio: { accessToken: "at-1", refreshToken: "rt-1", expiresAt: clock.now() } };
    const client = new OAuthClient({ configuration, account: "clio", store: new InMemoryTokenStore(expired), transport, clock });
    expect((await rejection(client.accessToken())).reason).toEqual({ kind: "tokenEndpoint", status: 500, error: undefined });
    expect((await rejection(client.accessToken())).reason.kind).toBe("malformedTokenResponse");
    const noRefresh = new InMemoryTokenStore({ clio: { accessToken: "at-1", expiresAt: clock.now() } });
    const bare = new OAuthClient({ configuration, account: "clio", store: noRefresh, transport, clock });
    expect((await rejection(bare.accessToken())).reason.kind).toBe("reauthorizationRequired");
    expect(await noRefresh.load("clio")).toBeNull();
  });

  it("configures Graph as a public client with scopes", () => {
    const config = GraphConfiguration.oauthConfiguration("app-1", MICROSOFT_REDIRECT_URI);
    expect(config.clientSecret).toBeUndefined();
    expect(config.authorizeURL).toBe("https://login.microsoftonline.com/organizations/oauth2/v2.0/authorize");
    const client = new OAuthClient({ configuration: config, account: "microsoft", store: new InMemoryTokenStore(), transport: new FakeTransport() });
    expect(query(client.authorizationURL())["scope"]).toBe("offline_access User.Read Mail.ReadWrite");
  });

  it("stores tokens in the KeyVault under the Mac app's accounts and JSON keys", async () => {
    const vault = createInMemoryKeyVault();
    const transport = new FakeTransport();
    transport.on("POST", "/oauth/token", { status: 200, json: '{"access_token":"at-1","refresh_token":"rt-1","expires_in":3600,"scope":"s"}' });
    const client = new OAuthClient({ configuration, account: "clio", store: vaultTokenStore(vault), transport, clock: new ManualClock() });
    await client.authorize(async (url) => `lananotes-auth://oauth/clio?code=c&state=${query(url)["state"]}`);
    const stored = await vault.oauthTokens("clio");
    expect(stored).toMatchObject({ accessToken: "at-1", refreshToken: "rt-1", scope: "s", region: "eu" });
    await client.signOut();
    expect(await vault.oauthTokens("clio")).toBeNull();
  });
});
