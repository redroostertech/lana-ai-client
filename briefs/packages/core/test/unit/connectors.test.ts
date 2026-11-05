import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { utf8 } from "../../src/bytes/index.js";
import {
  actionFailure, ConnectorHub, ExecutorUnavailable, failureMessage, GatewayTargetResolver, matchReasonPhrase, MirrorCandidateSource,
  type ConnectorConfiguration,
} from "../../src/connectors/index.js";
import {
  ClioNoteExecutor, ClioTaskExecutor, ExecutorError, GraphDraftExecutor, HTTPError, InMemoryTokenStore, LedgerUnreadableResultError, OAuthError,
  type CandidateSource,
} from "../../src/executors/index.js";
import type { HandoffLog } from "../../src/handoff/index.js";
import { createInMemoryKeyVault, SECRET_ACCOUNTS, type KeyVault } from "../../src/keys/index.js";
import { StoreError } from "../../src/store/index.js";
import { EMPTY_LIST, FakeSleeper, FakeTransport, bodyText } from "../support/executorFakes.js";
import { openRig, type StoreRig } from "../support/storeRig.js";

const CONFIGURED: ConnectorConfiguration = { clioClientID: "clio-client", microsoftClientID: "ms-client" };
const TOKEN_REPLY = { status: 200, json: '{"access_token":"access-secret-1","refresh_token":"refresh-secret-1","expires_in":3600}' };
const WHO_AM_I = { status: 200, json: '{"data":{"id":77,"name":"Alicia Reyes"}}' };

class RecordingLog implements HandoffLog {
  readonly lines: string[] = [];
  info = (event: string, fields?: object) => void this.lines.push(JSON.stringify({ event, ...fields }));
  notice = (event: string, fields?: object) => void this.lines.push(JSON.stringify({ event, ...fields }));
  error = (event: string, fields?: object) => void this.lines.push(JSON.stringify({ event, ...fields }));
}

let rig: StoreRig;
let vault: KeyVault;
let tokens: InMemoryTokenStore;
let transport: FakeTransport;
let log: RecordingLog;

beforeEach(async () => {
  rig = await openRig();
  vault = createInMemoryKeyVault();
  tokens = new InMemoryTokenStore();
  transport = new FakeTransport();
  log = new RecordingLog();
});
afterEach(() => rig.cleanup());

function hub(configuration: ConnectorConfiguration = CONFIGURED): ConnectorHub {
  return new ConnectorHub({ configuration, secrets: vault, tokens, transport, store: rig.store, clock: rig.clock, sleeper: new FakeSleeper(rig.clock), log });
}

/** Plays the browser: reads the state from the sign-in page and returns the redirect. */
function redirectFor(authorizeURL: string, connector: string): string {
  const state = new URL(authorizeURL).searchParams.get("state") ?? "";
  return `lananotes-auth://oauth/${connector}?code=code-secret-9&state=${encodeURIComponent(state)}`;
}

async function connectClio(connectors: ConnectorHub): Promise<string> {
  transport.on("POST", "app.clio.com/oauth/token", TOKEN_REPLY);
  transport.on("GET", "users/who_am_i.json", WHO_AM_I);
  return connectors.completeAuthorization("clio", redirectFor(await connectors.authorizationURL("clio"), "clio"));
}

function form(body: string): Record<string, string> {
  return Object.fromEntries(new URLSearchParams(body).entries());
}

describe("ConnectorHub: connect, status, region", () => {
  it("reports not configured, disconnected, then connected with the who_am_i name", async () => {
    expect((await hub({ clioClientID: null, microsoftClientID: null }).snapshot("clio")).status).toEqual({
      kind: "notConfigured", reason: "Add your Clio client ID to lana.config.json (clioClientID).",
    });
    expect((await hub({ clioClientID: null, microsoftClientID: null }).snapshot("microsoft")).status).toEqual({
      kind: "notConfigured", reason: "Add your Microsoft application ID to lana.config.json (microsoftClientID).",
    });
    await expect(hub({ clioClientID: null, microsoftClientID: null }).authorizationURL("clio")).rejects.toThrow("Add your Clio client ID");

    const connectors = hub();
    expect(await connectors.snapshot("clio")).toEqual({ status: { kind: "disconnected" }, lastSync: null, mirroredRecords: null });
    await vault.setSecret(SECRET_ACCOUNTS.clioClientSecret, utf8("clio-secret-2"));
    const url = await connectors.authorizationURL("clio");
    const query = new URL(url).searchParams;
    expect(url.startsWith("https://app.clio.com/oauth/authorize?")).toBe(true);
    expect(query.get("client_id")).toBe("clio-client");
    expect(query.get("redirect_uri")).toBe("lananotes-auth://oauth/clio");
    expect(query.get("code_challenge_method")).toBe("S256");

    transport.on("POST", "app.clio.com/oauth/token", TOKEN_REPLY);
    transport.on("GET", "users/who_am_i.json", WHO_AM_I);
    expect(await connectors.completeAuthorization("clio", redirectFor(url, "clio"))).toBe("Alicia Reyes");
    const exchange = form(bodyText(transport.sent("POST", "oauth/token")[0]));
    expect(exchange).toMatchObject({ grant_type: "authorization_code", code: "code-secret-9", client_id: "clio-client", client_secret: "clio-secret-2" });
    expect(await tokens.load("clio")).toMatchObject({ accessToken: "access-secret-1", region: "us" });
    expect(await connectors.snapshot("clio")).toMatchObject({ status: { kind: "connected", account: "Alicia Reyes" } });
    // The name is cached: no second who_am_i.
    expect(transport.sent("GET", "who_am_i")).toHaveLength(1);
    expect((await rig.store.auditEntries()).at(-1)).toMatchObject({ event: "connector.linked", subject: "clio", detail: '{"connector":"clio","region":"us"}' });

    const lines = log.lines.join("\n");
    for (const secret of ["access-secret-1", "refresh-secret-1", "code-secret-9", "clio-secret-2", "Alicia"]) expect(lines).not.toContain(secret);
  });

  it("uses the chosen Clio region for sign-in and treats tokens from another region as disconnected", async () => {
    const connectors = hub();
    await connectors.setClioRegion("eu");
    expect(await connectors.clioRegion()).toBe("eu");
    const url = await connectors.authorizationURL("clio");
    expect(url.startsWith("https://eu.app.clio.com/oauth/authorize?")).toBe(true);
    transport.on("POST", "eu.app.clio.com/oauth/token", TOKEN_REPLY);
    transport.on("GET", "eu.app.clio.com/api/v4/users/who_am_i.json", WHO_AM_I);
    await connectors.completeAuthorization("clio", redirectFor(url, "clio"));
    expect((await connectors.snapshot("clio")).status.kind).toBe("connected");
    await connectors.setClioRegion("us");
    expect((await connectors.snapshot("clio")).status).toEqual({ kind: "disconnected" });
  });

  it("refuses a redirect for another sign-in and leaves no tokens", async () => {
    const connectors = hub();
    await connectors.authorizationURL("clio");
    await expect(connectors.completeAuthorization("clio", "lananotes-auth://oauth/clio?code=x&state=forged")).rejects.toBeInstanceOf(OAuthError);
    expect(await tokens.load("clio")).toBeNull();
  });

  it("names the Microsoft account from /me and falls back when the name cannot be read", async () => {
    const connectors = hub();
    const url = await connectors.authorizationURL("microsoft");
    expect(url.startsWith("https://login.microsoftonline.com/organizations/oauth2/v2.0/authorize?")).toBe(true);
    expect(new URL(url).searchParams.get("scope")).toBe("offline_access User.Read Mail.ReadWrite");
    transport.on("POST", "login.microsoftonline.com/organizations/oauth2/v2.0/token", TOKEN_REPLY);
    transport.on("GET", "graph.microsoft.com/v1.0/me?$select=displayName,mail", { status: 401 }, { status: 200, json: '{"displayName":null,"mail":"dana@firm.law"}' });
    // The first /me fails: the generic name, not cached, so the next status asks again.
    expect(await connectors.completeAuthorization("microsoft", redirectFor(url, "microsoft"))).toBe("Connected account");
    expect(form(bodyText(transport.sent("POST", "oauth2/v2.0/token")[0]))["client_secret"]).toBeUndefined();
    expect((await connectors.snapshot("microsoft")).status).toEqual({ kind: "connected", account: "dana@firm.law" });
  });
});

describe("ConnectorHub: mirror and disconnect", () => {
  it("pages matters and contacts into the mirror and records the sync", async () => {
    const connectors = hub();
    await expect(connectors.syncMirror()).rejects.toThrow("Connect this service first.");
    await connectClio(connectors);
    transport.on("GET", "matters.json?fields=", {
      status: 200,
      json: JSON.stringify({ data: [{ id: 4201, display_number: "00042", description: "Muller v. Acme", client: { id: 1, name: "Jose Muller" } }], meta: { paging: { next: "https://app.clio.com/api/v4/matters.json?page_token=2" } } }),
    });
    transport.on("GET", "matters.json?page_token=2", { status: 200, json: JSON.stringify({ data: [{ id: 4202, display_number: "00043" }], meta: { paging: {} } }) });
    transport.on("GET", "contacts.json?fields=", { status: 200, json: JSON.stringify({ data: [{ id: 9001, name: "Acme Corp", primary_email_address: "billing@acme.test", type: "Company" }], meta: { paging: {} } }) });
    expect(await connectors.syncMirror()).toBe(3);
    expect(transport.sent("GET", "matters.json?fields=")[0]?.url).toBe(
      "https://app.clio.com/api/v4/matters.json?fields=id,display_number,description,status,client%7Bid,name%7D&limit=200&order=id(asc)",
    );
    expect(rig.store.mirror.count("clio")).toBe(3);
    expect(rig.store.mirror.search("00043", "matter")).toEqual([{ source: "clio", externalID: "4202", kind: "matter", name: "00043", displayNumber: "00043", email: undefined, clientName: undefined }]);
    expect(await connectors.snapshot("clio")).toEqual({ status: { kind: "connected", account: "Alicia Reyes" }, lastSync: rig.clock.now(), mirroredRecords: 3 });
    expect(rig.store.settings.get("clio.last_sync")).toBe(rig.clock.now().toISOString());
    expect(log.lines.join("\n")).not.toContain("Acme");
  });

  it("runs one sync at a time", async () => {
    const connectors = hub();
    await connectClio(connectors);
    transport.on("GET", "matters.json", { status: 200, json: EMPTY_LIST, delayMs: 20 });
    transport.on("GET", "contacts.json", { status: 200, json: EMPTY_LIST });
    const [first, second] = await Promise.all([connectors.syncMirror(), connectors.syncMirror()]);
    expect([first, second]).toEqual([0, 0]);
    expect(transport.sent("GET", "matters.json")).toHaveLength(1);
  });

  it("disconnect deletes the tokens, clears the mirror and audits", async () => {
    const connectors = hub();
    await connectClio(connectors);
    rig.store.mirror.replace("clio", [{ source: "clio", externalID: "1", kind: "matter", name: "Lease" }]);
    await connectors.disconnect("clio");
    expect(await tokens.load("clio")).toBeNull();
    expect(rig.store.mirror.count("clio")).toBe(0);
    expect((await connectors.snapshot("clio")).status).toEqual({ kind: "disconnected" });
    expect((await rig.store.auditEntries()).at(-1)).toMatchObject({ event: "connector.unlinked", subject: "clio", detail: '{"connector":"clio"}' });
  });
});

describe("ConnectorHub: executors and live sources", () => {
  it("hands out executors only for what is connected", async () => {
    const connectors = hub();
    await expect(connectors.executor("note.log")).rejects.toThrow("Connect Clio in Connections to run this action.");
    await expect(connectors.executor("email.draft")).rejects.toThrow("Connect Microsoft 365 in Connections to run this action.");
    await expect(connectors.executor("calendar.hold")).rejects.toThrow("This action needs a newer LANA.");
    expect(await connectors.liveSources()).toEqual([]);
    await connectClio(connectors);
    expect(await connectors.executor("note.log")).toBeInstanceOf(ClioNoteExecutor);
    expect(await connectors.executor("task.create")).toBeInstanceOf(ClioTaskExecutor);
    expect((await connectors.liveSources()).map((source) => source.name)).toEqual(["clio"]);
    await tokens.save({ accessToken: "graph-token", expiresAt: new Date(rig.clock.now().getTime() + 3_600_000) }, "microsoft");
    expect(await connectors.executor("email.draft")).toBeInstanceOf(GraphDraftExecutor);
  });
});

describe("GatewayTargetResolver over the mirror", () => {
  function resolver(live: CandidateSource[] = []): GatewayTargetResolver {
    return new GatewayTargetResolver(new MirrorCandidateSource(rig.store.mirror), async () => live);
  }

  it("matches only a confident, unique record and offers near duplicates", async () => {
    rig.store.mirror.replace("clio", [
      { source: "clio", externalID: "4201", kind: "matter", name: "Muller v. Acme", displayNumber: "00042", clientName: "Jose Muller" },
      { source: "clio", externalID: "9001", kind: "contact", name: "Acme Corp", email: "billing@acme.test" },
    ]);
    const matter = await resolver().resolve({ kind: "matter", name: "Müller v. Acme" });
    expect(matter).toMatchObject({ outcome: "match", candidate: { id: "4201", kind: "matter", source: "clio" }, reasons: ["exact_name"] });
    expect(await resolver().resolve({ kind: "company", name: "Acme Corp" })).toMatchObject({ outcome: "match", candidate: { id: "9001", kind: "company" } });

    // A broader matter next to it: never chosen automatically.
    rig.store.mirror.replace("clio", [
      { source: "clio", externalID: "4201", kind: "matter", name: "Muller v. Acme", displayNumber: "00042", clientName: "Jose Muller" },
      { source: "clio", externalID: "4202", kind: "matter", name: "Muller v. Acme appeal", displayNumber: "00043", clientName: "Jose Muller" },
    ]);
    const twins = await resolver().resolve({ kind: "matter", name: "Müller v. Acme" });
    expect(twins.outcome).toBe("ambiguous");
    expect(twins.outcome === "ambiguous" && twins.options.map((option) => option.candidate.id)).toEqual(["4201", "4202"]);
    // The matter number said aloud settles it.
    expect(await resolver().resolve({ kind: "matter", name: "matter 00043" })).toMatchObject({ outcome: "match", candidate: { id: "4202" } });
    expect(await resolver().resolve({ kind: "matter", name: "Nothing like it" })).toEqual({ outcome: "no_match", suggestCreate: false });
  });

  it("treats the mirrored and live copy of one Clio contact as one record, never two distinct ids", async () => {
    rig.store.mirror.replace("clio", [{ source: "clio", externalID: "9001", kind: "contact", name: "Acme Corp", email: "billing@acme.test" }]);
    const sameRecord: CandidateSource = { name: "clio", search: async () => [{ id: "9001", kind: "company", name: "Acme Corp", email: "billing@acme.test", source: "clio" }] };
    expect(await resolver([sameRecord]).resolve({ kind: "contact", name: "Acme Corp" })).toMatchObject({ outcome: "match", candidate: { id: "9001", kind: "company" } });
    const twin: CandidateSource = { name: "clio", search: async () => [{ id: "9002", kind: "company", name: "Acme Corp", source: "clio" }] };
    expect((await resolver([twin]).resolve({ kind: "contact", name: "Acme Corp" })).outcome).toBe("ambiguous");
    const down: CandidateSource = { name: "clio", search: async () => Promise.reject(new Error("offline")) };
    await expect(resolver([down]).resolve({ kind: "contact", name: "Acme Corp" })).rejects.toThrow("offline");
  });

  it("merges live results into a search without duplicating mirrored records", async () => {
    rig.store.mirror.replace("clio", [{ source: "clio", externalID: "4201", kind: "matter", name: "Muller v. Acme", displayNumber: "00042" }]);
    const live: CandidateSource = {
      name: "clio",
      search: async () => [
        { id: "4201", kind: "matter", name: "Muller v. Acme", source: "clio" },
        { id: "4300", kind: "matter", name: "Muller estate", source: "clio" },
      ],
    };
    const failing: CandidateSource = { name: "down", search: async () => Promise.reject(new Error("offline")) };
    expect((await resolver([live, failing]).search("  muller ", "matter")).map((candidate) => candidate.id)).toEqual(["4201", "4300"]);
    expect(await resolver([live]).search("   ", "matter")).toEqual([]);
  });
});

describe("ActionFailure", () => {
  it("maps every error the way the Mac does", () => {
    const cases: [unknown, string][] = [
      [HTTPError.status(401), "auth"], [HTTPError.status(403), "auth"], [HTTPError.status(404), "not_found"], [HTTPError.status(429), "busy"],
      [HTTPError.status(503), "server"], [HTTPError.status(422), "rejected"], [HTTPError.transport("x"), "unreachable"], [HTTPError.invalidResponse(), "server"],
      [ExecutorError.planHashMismatch(), "executor"], [OAuthError.reauthorizationRequired(), "auth"], [ExecutorUnavailable.notConnected("Clio"), "not_connected"],
      [new StoreError("notFound", "x"), "store"], [new LedgerUnreadableResultError("k"), "ledger"], [Object.assign(new Error("x"), { name: "AbortError" }), "cancelled"],
      [new Error("other"), "unknown"],
    ];
    expect(cases.map(([error]) => actionFailure(error, "PC").code)).toEqual(cases.map(([, code]) => code));
    expect(actionFailure(HTTPError.status(503), "PC").message).toBe(failureMessage("server"));
    expect(actionFailure(ExecutorError.planHashMismatch(), "PC").message).toBe("This action changed after it was prepared. Review it again.");
    expect(actionFailure(new StoreError("notFound", "x"), "PC").message).toBe("LANA could not save this change on this PC. Try again.");
    expect(failureMessage(null)).toBe("The action did not finish. Retry checks for an earlier copy before sending.");
    expect(matchReasonPhrase("display_number")).toBe("Matter number said");
  });
});
